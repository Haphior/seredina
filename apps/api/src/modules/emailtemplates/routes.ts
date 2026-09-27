import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { EMAIL_EVENTS, EMAIL_LANGUAGES, type EmailEvent } from '@seredina/shared';
import { requirePermission } from '../rbac/permissions';
import { auditRequest } from '../audit/service';
import {
  EmailTemplateError,
  MAX_EMAIL_IMAGE_BYTES,
  deleteEmailImage,
  getPublicEmailImage,
  saveEmailImage,
  getEmailSignature,
  getEmailTemplates,
  previewEmail,
  resetEmailTemplate,
  saveEmailTemplate,
  sendTestEmail,
  setEmailSignature,
  updateEmailSettings,
} from './service';

// Customer email settings and templates -- docs/adr/0070-customer-email-templates.md.

const eventSchema = z.enum(EMAIL_EVENTS as [EmailEvent, ...EmailEvent[]]);

const httpUrlOrEmpty = z
  .string()
  .max(2000)
  .refine((v) => v === '' || /^https?:\/\/[^\s"'<>]+$/.test(v), 'must be an http(s) address');

const imageKindSchema = z.enum(['logo', 'banner']);

const settingsSchema = z
  .object({
    language: z.enum(EMAIL_LANGUAGES as ['es', 'en']),
    senderName: z.string().max(100),
    signature: z.string().max(2000),
    quoteHistory: z.boolean(),
    surveyOnResolve: z.boolean(),
    // A pasted address instead of an upload; '' clears it.
    logoUrl: httpUrlOrEmpty,
    bannerUrl: httpUrlOrEmpty,
    bannerLink: httpUrlOrEmpty,
  })
  .partial();

const templateSchema = z.object({
  enabled: z.boolean().default(true),
  subject: z.string().trim().min(1).max(250),
  body: z.string().trim().min(1).max(20_000),
});

const previewSchema = z.object({
  event: eventSchema,
  subject: z.string().max(250),
  body: z.string().max(20_000),
  settings: settingsSchema.optional(),
});

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof EmailTemplateError) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export default async function emailTemplateRoutes(app: FastifyInstance) {
  const manage = { preHandler: [app.authenticate, requirePermission('channels:manage')] };

  app.get('/email-templates', manage, async (request, reply) => reply.send(await getEmailTemplates(request.user.tenantId)));

  app.put('/email-templates/settings', manage, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const settings = await updateEmailSettings(request.user.tenantId, parsed.data);
    await auditRequest(request, 'email_settings.updated', { type: 'tenant', id: request.user.tenantId }, { language: settings.language });
    return reply.send(settings);
  });

  app.put('/email-templates/:event', manage, async (request, reply) => {
    const event = eventSchema.safeParse((request.params as { event: string }).event);
    if (!event.success) return reply.code(404).send({ error: 'unknown email event' });
    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await saveEmailTemplate(request.user.tenantId, event.data, parsed.data);
      await auditRequest(request, 'email_template.updated', { type: 'email_template', id: event.data, label: event.data }, { enabled: parsed.data.enabled });
      return reply.send(result);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/email-templates/:event', manage, async (request, reply) => {
    const event = eventSchema.safeParse((request.params as { event: string }).event);
    if (!event.success) return reply.code(404).send({ error: 'unknown email event' });
    const result = await resetEmailTemplate(request.user.tenantId, event.data);
    await auditRequest(request, 'email_template.reset', { type: 'email_template', id: event.data, label: event.data });
    return reply.send(result);
  });

  app.post('/email-templates/preview', manage, async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { to: _to, ...preview } = await previewEmail(request.user.tenantId, request.user.sub, parsed.data);
    return reply.send(preview);
  });

  app.post('/email-templates/test', manage, async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return reply.send(await sendTestEmail(request.user.tenantId, request.user.sub, parsed.data));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post(
    '/email-templates/images/:kind',
    // Over the 1 MB global body limit, like attachments (see attachments/routes.ts).
    { ...manage, bodyLimit: MAX_EMAIL_IMAGE_BYTES + 1024 * 1024 },
    async (request, reply) => {
      const kind = imageKindSchema.safeParse((request.params as { kind: string }).kind);
      if (!kind.success) return reply.code(404).send({ error: 'unknown image' });
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: 'no file provided' });
      const data = await file.toBuffer();
      if (file.file.truncated) return reply.code(400).send({ error: 'The image is larger than 2 MB.' });
      try {
        const settings = await saveEmailImage(request.user.tenantId, kind.data, data);
        await auditRequest(request, 'email_settings.updated', { type: 'tenant', id: request.user.tenantId }, { image: kind.data });
        return reply.send(settings);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.delete('/email-templates/images/:kind', manage, async (request, reply) => {
    const kind = imageKindSchema.safeParse((request.params as { kind: string }).kind);
    if (!kind.success) return reply.code(404).send({ error: 'unknown image' });
    const settings = await deleteEmailImage(request.user.tenantId, kind.data);
    await auditRequest(request, 'email_settings.updated', { type: 'tenant', id: request.user.tenantId }, { image: kind.data, removed: true });
    return reply.send(settings);
  });

  // Public: mail clients (and Gmail's image proxy) load the logo and banner
  // from here, with no session. Only these two images are reachable.
  app.get('/public/:tenantSlug/email-images/:kind', async (request, reply) => {
    const { tenantSlug, kind } = request.params as { tenantSlug: string; kind: string };
    const parsed = imageKindSchema.safeParse(kind);
    if (!parsed.success) return reply.code(404).send({ error: 'not found' });
    const image = await getPublicEmailImage(tenantSlug, parsed.data);
    if (!image) return reply.code(404).send({ error: 'not found' });
    return reply
      .header('content-type', image.mimeType)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=86400')
      .header('etag', `"${image.sha256}"`)
      .send(Buffer.from(image.data));
  });

  // Every agent's own signature, under their replies to customers.
  app.get('/me/email-signature', { preHandler: app.authenticate }, async (request, reply) =>
    reply.send(await getEmailSignature(request.user.tenantId, request.user.sub)),
  );

  app.put('/me/email-signature', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = z.object({ signature: z.string().max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return reply.send(await setEmailSignature(request.user.tenantId, request.user.sub, parsed.data.signature));
  });
}
