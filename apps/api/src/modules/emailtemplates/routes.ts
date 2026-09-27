import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { EMAIL_EVENTS, EMAIL_LANGUAGES, type EmailEvent } from '@seredina/shared';
import { requirePermission } from '../rbac/permissions';
import { auditRequest } from '../audit/service';
import {
  EmailTemplateError,
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

const settingsSchema = z
  .object({
    language: z.enum(EMAIL_LANGUAGES as ['es', 'en']),
    senderName: z.string().max(100),
    signature: z.string().max(2000),
    quoteHistory: z.boolean(),
    surveyOnResolve: z.boolean(),
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
