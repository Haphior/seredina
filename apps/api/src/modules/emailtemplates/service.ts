import { prisma, withTenantTx, type Prisma } from '@seredina/db';
import {
  DEFAULT_EMAIL_SETTINGS,
  EMAIL_EVENTS,
  EMAIL_LANGUAGES,
  EMAIL_VARIABLES,
  defaultEmailTemplate,
  emailContextFor,
  emailString,
  eventCanBeDisabled,
  parseEmailSettings,
  renderBrandedEmail,
  renderTemplate,
  surveyButton,
  unknownVariables,
  type EmailContent,
  type EmailEvent,
  type EmailLanguage,
  type EmailSettings,
  type EmailString,
  type EmailTemplate,
} from '@seredina/shared';
import { contactEmailQueue } from '../../lib/queue';
import { webOrigin } from '../../lib/publicUrl';

/**
 * Customer email: the tenant's settings and per-event templates, previews
 * and test sends, and the simple branded emails (sign-in link, reset,
 * invitation). See docs/adr/0070-customer-email-templates.md.
 */
export class EmailTemplateError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Customer emails go out through the workspace's own connected mailbox. */
async function hasConnectedEmailChannel(tenantId: string): Promise<boolean> {
  const count = await withTenantTx(prisma, tenantId, (tx) => tx.emailChannel.count({ where: { connectionStatus: 'connected' } }));
  return count > 0;
}

const TENANT_EMAIL_FIELDS = { name: true, slug: true, branding: true, emailSettings: true, customerPortalEnabled: true } as const;

export async function loadEmailContext(tx: Prisma.TransactionClient, tenantId: string) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: TENANT_EMAIL_FIELDS });
  return { tenant, ...emailContextFor(tenant, webOrigin()) };
}

/** The tenant's language for everything Seredina writes on its behalf. */
export async function tenantLanguage(tenantId: string): Promise<EmailLanguage> {
  const tenant = await withTenantTx(prisma, tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { emailSettings: true } }));
  return parseEmailSettings(tenant.emailSettings).language;
}

/** The tenant's template for an event, or the default in its language. */
export async function templateFor(
  tx: Prisma.TransactionClient,
  tenantId: string,
  event: EmailEvent,
  language: EmailLanguage,
): Promise<EmailTemplate & { custom: boolean }> {
  const row = await tx.emailTemplate.findUnique({ where: { tenantId_event: { tenantId, event } } });
  if (!row) return { ...defaultEmailTemplate(event, language), custom: false };
  return { enabled: eventCanBeDisabled(event) ? row.enabled : true, subject: row.subject, body: row.body, custom: true };
}

export async function getEmailTemplates(tenantId: string) {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const { settings } = await loadEmailContext(tx, tenantId);
    const templates = [];
    for (const event of EMAIL_EVENTS) {
      const t = await templateFor(tx, tenantId, event, settings.language);
      templates.push({ event, ...t, canDisable: eventCanBeDisabled(event), variables: EMAIL_VARIABLES[event] });
    }
    const defaults = Object.fromEntries(
      EMAIL_LANGUAGES.map((lang) => [lang, Object.fromEntries(EMAIL_EVENTS.map((e) => [e, defaultEmailTemplate(e, lang)]))]),
    );
    return { settings, templates, defaults, hasEmailChannel: await hasConnectedEmailChannel(tenantId) };
  });
}

export async function updateEmailSettings(tenantId: string, patch: Partial<EmailSettings>): Promise<EmailSettings> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { emailSettings: true } });
    const next = parseEmailSettings({ ...DEFAULT_EMAIL_SETTINGS, ...parseEmailSettings(tenant.emailSettings), ...patch });
    await tx.tenant.update({ where: { id: tenantId }, data: { emailSettings: next as unknown as Prisma.InputJsonValue } });
    return next;
  });
}

export interface TemplateInput {
  enabled: boolean;
  subject: string;
  body: string;
}

function validateTemplate(event: EmailEvent, input: TemplateInput): void {
  const unknown = unknownVariables(event, `${input.subject}\n${input.body}`);
  if (unknown.length) {
    throw new EmailTemplateError(`Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.map((v) => `{{${v}}}`).join(', ')}`);
  }
  if (event === 'agent_reply' && !/\{\{\s*message\s*\}\}/.test(input.body)) {
    throw new EmailTemplateError('The reply template must include {{message}}: it is where the agent\'s reply goes.');
  }
}

export async function saveEmailTemplate(tenantId: string, event: EmailEvent, input: TemplateInput) {
  validateTemplate(event, input);
  const data = { enabled: eventCanBeDisabled(event) ? input.enabled : true, subject: input.subject.trim(), body: input.body.trim() };
  await withTenantTx(prisma, tenantId, (tx) =>
    tx.emailTemplate.upsert({
      where: { tenantId_event: { tenantId, event } },
      create: { tenantId, event, ...data },
      update: data,
    }),
  );
  return getEmailTemplates(tenantId);
}

export async function resetEmailTemplate(tenantId: string, event: EmailEvent) {
  await withTenantTx(prisma, tenantId, (tx) => tx.emailTemplate.deleteMany({ where: { event } }));
  return getEmailTemplates(tenantId);
}

/** Example values for a preview or a test email. */
function sampleFor(language: EmailLanguage, company: string, portalLink: string | null, agentName: string) {
  const es = language === 'es';
  return {
    variables: {
      company,
      contactName: es ? 'Ana Rojas' : 'Ana Rojas',
      contactEmail: 'ana.rojas@example.com',
      ticketNumber: 1042,
      ticketSubject: es ? 'No puedo imprimir desde mi notebook' : "I can't print from my laptop",
      agentName,
      message: es
        ? 'Hola Ana,\n\nYa reinstalamos el controlador de la impresora del segundo piso. ¿Puedes intentar imprimir de nuevo y contarnos si funciona?'
        : 'Hi Ana,\n\nWe reinstalled the driver for the second-floor printer. Could you try printing again and let us know if it works?',
      portalLink: portalLink ?? '',
    },
    quote: es
      ? 'Desde esta mañana no puedo imprimir: la impresora aparece desconectada.'
      : 'Since this morning I cannot print: the printer shows as offline.',
  };
}

export interface PreviewInput {
  event: EmailEvent;
  subject: string;
  body: string;
  /** Unsaved settings from the form, so the preview follows them. */
  settings?: Partial<EmailSettings>;
}

/** The email as the customer would get it, with sample data. */
export async function previewEmail(tenantId: string, userId: string, input: PreviewInput) {
  const unknown = unknownVariables(input.event, `${input.subject}\n${input.body}`);
  const { tenant, user } = await withTenantTx(prisma, tenantId, async (tx) => ({
    tenant: await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: TENANT_EMAIL_FIELDS }),
    user: await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, emailSignature: true } }),
  }));
  const merged = { ...tenant, emailSettings: { ...parseEmailSettings(tenant.emailSettings), ...input.settings } };
  const { settings, brand, portalLink } = emailContextFor(merged, webOrigin());
  const language = settings.language;
  const sample = sampleFor(language, tenant.name, portalLink, user.name);
  const rendered = renderTemplate(input, sample.variables);

  const content: EmailContent = {
    body: rendered.body,
    ticketNumber: sample.variables.ticketNumber,
    ticketSubject: sample.variables.ticketSubject,
  };
  if (input.event === 'agent_reply') {
    content.agentSignature = user.emailSignature?.trim() || user.name;
    if (settings.quoteHistory) content.quote = { author: sample.variables.contactName, body: sample.quote };
  }
  if ((input.event === 'ticket_resolved' || input.event === 'ticket_closed') && settings.surveyOnResolve) {
    const origin = webOrigin() || 'https://helpdesk.example.com';
    content.button = surveyButton(language, `${origin}/csat/${tenant.slug}/ejemplo`);
  }
  const { html, text } = renderBrandedEmail(brand, content);
  return { subject: rendered.subject, html, text, unknownVariables: unknown, to: user.email };
}

/** Sends the preview to the signed-in user's own address. */
export async function sendTestEmail(tenantId: string, userId: string, input: PreviewInput): Promise<{ to: string }> {
  if (!(await hasConnectedEmailChannel(tenantId))) {
    throw new EmailTemplateError('Connect an email channel first: customer emails are sent from it.', 409);
  }
  const preview = await previewEmail(tenantId, userId, input);
  if (preview.unknownVariables.length) {
    throw new EmailTemplateError(`Unknown variables: ${preview.unknownVariables.map((v) => `{{${v}}}`).join(', ')}`);
  }
  await contactEmailQueue.add(
    'send',
    { tenantId, to: preview.to, subject: preview.subject, text: preview.text, html: preview.html },
    { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 100, removeOnFail: 100 },
  );
  return { to: preview.to };
}

export async function getEmailSignature(tenantId: string, userId: string): Promise<{ signature: string; name: string }> {
  const user = await withTenantTx(prisma, tenantId, (tx) =>
    tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, emailSignature: true } }),
  );
  return { signature: user.emailSignature ?? '', name: user.name };
}

export async function setEmailSignature(tenantId: string, userId: string, signature: string): Promise<{ signature: string; name: string }> {
  const clean = signature.replace(/\r\n/g, '\n').trim();
  const user = await withTenantTx(prisma, tenantId, (tx) =>
    tx.user.update({ where: { id: userId }, data: { emailSignature: clean || null }, select: { name: true, emailSignature: true } }),
  );
  return { signature: user.emailSignature ?? '', name: user.name };
}

/**
 * A one-off email that isn't about a ticket (portal sign-in link, password
 * reset, invitation) in the tenant's language and layout, with one button.
 */
export async function brandedNotice(
  tenantId: string,
  keys: { subject: EmailString; body: EmailString; button: EmailString },
  values: Record<string, string | number>,
  url: string,
  options: { showPortal?: boolean } = {},
): Promise<{ subject: string; text: string; html: string; language: EmailLanguage }> {
  const ctx = await withTenantTx(prisma, tenantId, (tx) => loadEmailContext(tx, tenantId));
  const language = ctx.settings.language;
  const all = { company: ctx.tenant.name, ...values };
  const brand = options.showPortal ? ctx.brand : { ...ctx.brand, portalLink: null };
  const { html, text } = renderBrandedEmail(brand, {
    body: emailString(language, keys.body, all),
    button: { label: emailString(language, keys.button, all), url },
  });
  return { subject: emailString(language, keys.subject, all), text, html, language };
}
