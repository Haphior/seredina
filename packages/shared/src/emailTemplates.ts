// Customer-facing email: the templates a tenant edits, their defaults in each
// language, and the branded HTML layout every email to a customer goes out
// in (docs/adr/0070-customer-email-templates.md). Pure functions, shared by
// apps/api (which renders ticket events and previews) and apps/worker (which
// renders agent replies at send time), so both produce the same email.

export type EmailLanguage = 'es' | 'en';
export const EMAIL_LANGUAGES: EmailLanguage[] = ['es', 'en'];

/** The moments a customer gets an email about their ticket. */
export type EmailEvent = 'ticket_created' | 'agent_reply' | 'ticket_resolved' | 'ticket_closed';
export const EMAIL_EVENTS: EmailEvent[] = ['ticket_created', 'agent_reply', 'ticket_resolved', 'ticket_closed'];

/** Tenant-wide settings for email to customers (Tenant.emailSettings). */
export interface EmailSettings {
  language: EmailLanguage;
  /** Display name on the From line: "Soporte Infraplast <soporte@...>". Empty = the company name. */
  senderName: string;
  /** Closing lines under every email: team name, phone, hours. */
  signature: string;
  /** Quote the customer's last message under an agent's reply. */
  quoteHistory: boolean;
  /** Add the satisfaction survey button to the "resolved" email. */
  surveyOnResolve: boolean;
  /** The logo at the top of every email; empty = the one from Branding. */
  logoUrl: string;
  /** A wide image under the header (a campaign, the company's look); empty = none. */
  bannerUrl: string;
  /** Where clicking the banner goes; empty = not a link. */
  bannerLink: string;
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  language: 'es',
  senderName: '',
  signature: '',
  quoteHistory: true,
  surveyOnResolve: true,
  logoUrl: '',
  bannerUrl: '',
  bannerLink: '',
};

/** Recommended banner size: shown 600 px wide, twice that for sharp screens. */
export const EMAIL_BANNER_WIDTH = 600;

export function parseEmailSettings(raw: unknown): EmailSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<EmailSettings>;
  return {
    language: EMAIL_LANGUAGES.includes(r.language as EmailLanguage) ? (r.language as EmailLanguage) : DEFAULT_EMAIL_SETTINGS.language,
    senderName: typeof r.senderName === 'string' ? r.senderName : '',
    signature: typeof r.signature === 'string' ? r.signature : '',
    quoteHistory: typeof r.quoteHistory === 'boolean' ? r.quoteHistory : DEFAULT_EMAIL_SETTINGS.quoteHistory,
    surveyOnResolve: typeof r.surveyOnResolve === 'boolean' ? r.surveyOnResolve : DEFAULT_EMAIL_SETTINGS.surveyOnResolve,
    logoUrl: typeof r.logoUrl === 'string' ? r.logoUrl : '',
    bannerUrl: typeof r.bannerUrl === 'string' ? r.bannerUrl : '',
    bannerLink: typeof r.bannerLink === 'string' ? r.bannerLink : '',
  };
}

/** One event's template: whether it's sent, its subject and its body. */
export interface EmailTemplate {
  enabled: boolean;
  subject: string;
  body: string;
}

/** The variables each event's template may use. */
export const EMAIL_VARIABLES: Record<EmailEvent, string[]> = {
  ticket_created: ['company', 'contact.name', 'contact.email', 'ticket.number', 'ticket.subject', 'portal_link'],
  agent_reply: ['company', 'contact.name', 'contact.email', 'ticket.number', 'ticket.subject', 'agent.name', 'message', 'portal_link'],
  ticket_resolved: ['company', 'contact.name', 'contact.email', 'ticket.number', 'ticket.subject', 'agent.name', 'portal_link'],
  ticket_closed: ['company', 'contact.name', 'contact.email', 'ticket.number', 'ticket.subject', 'agent.name', 'portal_link'],
};

/** "Replies" can't be switched off: they're the conversation itself. */
export function eventCanBeDisabled(event: EmailEvent): boolean {
  return event !== 'agent_reply';
}

const DEFAULTS: Record<EmailLanguage, Record<EmailEvent, EmailTemplate>> = {
  es: {
    ticket_created: {
      enabled: true,
      subject: '[#{{ticket.number}}] Recibimos tu solicitud: {{ticket.subject}}',
      body:
        'Hola {{contact.name}},\n\n' +
        'Recibimos tu solicitud y quedó registrada con el número #{{ticket.number}}. Nuestro equipo la revisará y te responderá lo antes posible.\n\n' +
        'Si quieres agregar información o archivos, responde a este correo y quedará en la misma solicitud.',
    },
    agent_reply: {
      enabled: true,
      subject: 'Re: [#{{ticket.number}}] {{ticket.subject}}',
      body: '{{message}}',
    },
    ticket_resolved: {
      enabled: true,
      subject: '[#{{ticket.number}}] Solicitud resuelta: {{ticket.subject}}',
      body:
        'Hola {{contact.name}},\n\n' +
        'Tu solicitud #{{ticket.number}} quedó resuelta. Si el problema continúa o tienes otra consulta sobre esto, responde a este correo y la retomaremos.\n\n' +
        'Gracias por contactarnos.',
    },
    ticket_closed: {
      enabled: false,
      subject: '[#{{ticket.number}}] Solicitud cerrada: {{ticket.subject}}',
      body:
        'Hola {{contact.name}},\n\n' +
        'Cerramos tu solicitud #{{ticket.number}}. Si necesitas algo más, responde a este correo o escríbenos de nuevo.\n\n' +
        'Gracias por contactarnos.',
    },
  },
  en: {
    ticket_created: {
      enabled: true,
      subject: '[#{{ticket.number}}] We received your request: {{ticket.subject}}',
      body:
        'Hi {{contact.name}},\n\n' +
        "We received your request and logged it as #{{ticket.number}}. Our team will review it and get back to you as soon as possible.\n\n" +
        'To add details or files, reply to this email and they will be added to the same request.',
    },
    agent_reply: {
      enabled: true,
      subject: 'Re: [#{{ticket.number}}] {{ticket.subject}}',
      body: '{{message}}',
    },
    ticket_resolved: {
      enabled: true,
      subject: '[#{{ticket.number}}] Request resolved: {{ticket.subject}}',
      body:
        'Hi {{contact.name}},\n\n' +
        'Your request #{{ticket.number}} has been resolved. If the problem persists or you have a question about it, reply to this email and we will pick it up again.\n\n' +
        'Thank you for contacting us.',
    },
    ticket_closed: {
      enabled: false,
      subject: '[#{{ticket.number}}] Request closed: {{ticket.subject}}',
      body:
        'Hi {{contact.name}},\n\n' +
        'We closed your request #{{ticket.number}}. If you need anything else, reply to this email or write to us again.\n\n' +
        'Thank you for contacting us.',
    },
  },
};

export function defaultEmailTemplate(event: EmailEvent, language: EmailLanguage): EmailTemplate {
  return { ...DEFAULTS[language][event] };
}

/** Fixed wording around the templates: the layout, the survey, the simple emails. */
const STRINGS = {
  es: {
    requestLabel: 'Solicitud #{n}',
    replyHint: 'Para responder, contesta este correo sin cambiar el asunto: tu mensaje quedará en la solicitud #{n}.',
    surveyTitle: '¿Cómo te atendimos?',
    surveyText: 'Tu opinión nos ayuda a mejorar. Son solo unos segundos.',
    surveyButton: 'Calificar la atención',
    portalLink: 'Ver mis solicitudes',
    quoteIntro: '{name} escribió:',
    noSubject: '(sin asunto)',
    poweredBy: 'Powered by',
    portalSignInSubject: 'Tu enlace de acceso a {company}',
    portalSignInBody:
      'Usa este enlace para ver y responder tus solicitudes con {company}. Funciona una sola vez y vence en 20 minutos.\n\nSi no lo pediste, puedes ignorar este correo.',
    portalSignInButton: 'Entrar al portal',
    resetSubject: 'Restablece tu contraseña de {company}',
    resetBody:
      'Hola {name},\n\nAlguien pidió restablecer la contraseña de {email} en {company}. Usa el botón para elegir una nueva: el enlace funciona una sola vez y vence en 30 minutos.\n\nSi no fuiste tú, ignora este correo: tu contraseña no cambia.',
    resetButton: 'Elegir una contraseña nueva',
    inviteSubject: 'Te invitaron a la mesa de ayuda de {company}',
    inviteBy: '{inviter} te invitó',
    inviteByUnknown: 'Te invitaron',
    inviteBody:
      'Hola {name},\n\n{by} a la mesa de ayuda de {company}. Usa el botón para elegir tu contraseña: el enlace vence en 7 días.\n\nDespués, entra en {login} con la organización «{slug}» y tu correo {email}.',
    inviteButton: 'Elegir mi contraseña',
    testNote: 'Este es un correo de prueba con datos de ejemplo.',
    notifyAssignedBody: 'Te asignaron la solicitud #{n}: {subject}',
    notifyAssignedSubject: '[#{n}] Asignada a ti: {subject}',
    notifyReplyBody: 'Nueva respuesta en la solicitud #{n}: {subject}',
    notifyReplySubject: '[#{n}] Nueva respuesta: {subject}',
    notifyTeamBody: 'Llegó la solicitud #{n} a {team}, sin responsable: {subject}',
    notifyTeamSubject: '[#{n}] Nueva en {team}: {subject}',
    notifySlaWarningBody: 'La {milestone} de la solicitud #{n} vence en {left}: {subject}',
    notifySlaWarningSubject: '[#{n}] SLA por vencer: {subject}',
    notifySlaBreachedBody: 'Se venció el plazo de {milestone} de la solicitud #{n}: {subject}',
    notifySlaBreachedSubject: '[#{n}] SLA vencido: {subject}',
    slaFirstResponse: 'primera respuesta',
    slaResolution: 'resolución',
    notifyMentionBody: '{name} te mencionó en una nota de la solicitud #{n}: {subject}',
    notifyMentionSubject: '[#{n}] {name} te mencionó: {subject}',
    notifyReopenedBody: 'El cliente reabrió la solicitud #{n}: {subject}',
    notifyReopenedSubject: '[#{n}] Reabierta: {subject}',
    contractEndingBody: '{name} vence el {end}{assets}.',
    contractEndingSubject: 'Contrato por vencer el {end}: {name}',
    mergedInto: 'Esta solicitud se unió a la #{n} («{subject}»).',
    mergedFrom: 'La solicitud #{n} («{subject}») se unió a esta.',
  },
  en: {
    requestLabel: 'Request #{n}',
    replyHint: "To reply, answer this email without changing the subject: your message will be added to request #{n}.",
    surveyTitle: 'How did we do?',
    surveyText: 'Your feedback helps us improve. It only takes a few seconds.',
    surveyButton: 'Rate our service',
    portalLink: 'View my requests',
    quoteIntro: '{name} wrote:',
    noSubject: '(no subject)',
    poweredBy: 'Powered by',
    portalSignInSubject: 'Your sign-in link for {company}',
    portalSignInBody:
      "Use this link to see and reply to your requests with {company}. It works once and expires in 20 minutes.\n\nIf you didn't ask for it, you can ignore this email.",
    portalSignInButton: 'Open the portal',
    resetSubject: 'Reset your {company} password',
    resetBody:
      "Hi {name},\n\nSomeone asked to reset the password for {email} on {company}. Use the button to choose a new one: the link works once and expires in 30 minutes.\n\nIf it wasn't you, ignore this email: your password doesn't change.",
    resetButton: 'Choose a new password',
    inviteSubject: "You're invited to the {company} help desk",
    inviteBy: '{inviter} invited you',
    inviteByUnknown: 'You were invited',
    inviteBody:
      'Hi {name},\n\n{by} to the {company} help desk. Use the button to choose your password: the link expires in 7 days.\n\nAfterwards, sign in at {login} with the organization "{slug}" and your email {email}.',
    inviteButton: 'Choose my password',
    testNote: 'This is a test email with sample data.',
    notifyAssignedBody: 'You were assigned to #{n}: {subject}',
    notifyAssignedSubject: '[#{n}] Assigned to you: {subject}',
    notifyReplyBody: 'New reply on #{n}: {subject}',
    notifyReplySubject: '[#{n}] New reply: {subject}',
    notifyTeamBody: '#{n} landed in {team} with nobody assigned: {subject}',
    notifyTeamSubject: '[#{n}] New in {team}: {subject}',
    notifySlaWarningBody: 'The {milestone} target of #{n} is due in {left}: {subject}',
    notifySlaWarningSubject: '[#{n}] SLA due soon: {subject}',
    notifySlaBreachedBody: 'The {milestone} target of #{n} was missed: {subject}',
    notifySlaBreachedSubject: '[#{n}] SLA missed: {subject}',
    slaFirstResponse: 'first response',
    slaResolution: 'resolution',
    notifyMentionBody: '{name} mentioned you in a note on #{n}: {subject}',
    notifyMentionSubject: '[#{n}] {name} mentioned you: {subject}',
    notifyReopenedBody: 'The customer reopened #{n}: {subject}',
    notifyReopenedSubject: '[#{n}] Reopened: {subject}',
    contractEndingBody: '{name} ends on {end}{assets}.',
    contractEndingSubject: 'Contract ending {end}: {name}',
    mergedInto: 'This ticket was merged into #{n} ("{subject}").',
    mergedFrom: 'Merged ticket #{n} ("{subject}") into this ticket.',
  },
} as const;

export type EmailString = keyof (typeof STRINGS)['es'];

/** A fixed phrase in the tenant's language, with {placeholders} filled in. */
export function emailString(language: EmailLanguage, key: EmailString, values: Record<string, string | number> = {}): string {
  return STRINGS[language][key].replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

const VARIABLE = /\{\{\s*([a-z_.]+)\s*\}\}/g;

/** The variables a template uses that its event doesn't offer. */
export function unknownVariables(event: EmailEvent, text: string): string[] {
  const allowed = new Set(EMAIL_VARIABLES[event]);
  const unknown = new Set<string>();
  for (const m of text.matchAll(VARIABLE)) if (!allowed.has(m[1])) unknown.add(m[1]);
  return [...unknown];
}

/** Fills {{variables}} in with plain-text values (unknown or missing ones become empty). */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(VARIABLE, (_m, name: string) => values[name] ?? '');
}

/** Values for a template's variables. */
export interface EmailVariables {
  company: string;
  contactName: string;
  contactEmail: string;
  ticketNumber: number;
  ticketSubject: string;
  agentName?: string;
  message?: string;
  portalLink?: string;
}

function variableMap(v: EmailVariables): Record<string, string> {
  return {
    company: v.company,
    'contact.name': v.contactName,
    'contact.email': v.contactEmail,
    'ticket.number': String(v.ticketNumber),
    'ticket.subject': v.ticketSubject,
    'agent.name': v.agentName ?? '',
    message: v.message ?? '',
    portal_link: v.portalLink ?? '',
  };
}

/** A template with its variables filled in: a one-line subject and a plain-text body. */
export function renderTemplate(template: Pick<EmailTemplate, 'subject' | 'body'>, v: EmailVariables): { subject: string; body: string } {
  const values = variableMap(v);
  return {
    subject: fillTemplate(template.subject, values).replace(/\s+/g, ' ').trim().slice(0, 250),
    body: fillTemplate(template.body, values).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

/** What the branded layout needs to know about the tenant. */
export interface EmailBrand {
  company: string;
  logoUrl?: string | null;
  accentColor?: string | null;
  language: EmailLanguage;
  /** Company signature from the settings. */
  signature?: string;
  /** Link to the customer portal, shown in the footer when set. */
  portalLink?: string | null;
  /** A wide image under the header, optionally a link. */
  bannerUrl?: string | null;
  bannerLink?: string | null;
}

export interface EmailContent {
  /** The rendered body, plain text. */
  body: string;
  /** Ticket context for the header and the reply hint; absent for sign-in/reset/invite emails. */
  ticketNumber?: number;
  ticketSubject?: string;
  /** The agent's own signature (or name), under their reply. */
  agentSignature?: string;
  /** A button: the survey, a sign-in link. */
  button?: { title?: string; text?: string; label: string; url: string };
  /** The customer's previous message, quoted under a reply. */
  quote?: { author: string; body: string };
  /** Hidden inbox-preview line. */
  preheader?: string;
}

const DEFAULT_ACCENT = '#4f46e5';
const SEREDINA_URL = 'https://github.com/Haphior/seredina';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

/** Plain text to email-safe HTML: escaped, paragraphs on blank lines, <br> on single ones, links clickable. */
export function textToHtml(text: string, linkColor: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => {
      const html = escapeHtml(para)
        .replace(URL_IN_TEXT, (url) => `<a href="${url}" style="color:${linkColor};text-decoration:underline;">${url}</a>`)
        .replace(/\n/g, '<br>');
      return `<p style="margin:0 0 16px 0;">${html}</p>`;
    })
    .join('');
}

function safeColor(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_ACCENT;
}

function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\/[^\s"'<>]+$/.test(url) ? url : null;
}

/**
 * The finished email: an institutional HTML layout (the company's logo or
 * name in its color, the message on a white card, the signatures, an
 * optional button and quoted message, a footer with the reply hint and
 * "Powered by Seredina") and the matching plain-text part. Table-based with
 * inline styles, which is what Outlook, Gmail and Apple Mail all render.
 */
export function renderBrandedEmail(brand: EmailBrand, content: EmailContent): { html: string; text: string } {
  const accent = safeColor(brand.accentColor);
  const lang = brand.language;
  const logo = safeUrl(brand.logoUrl);
  const company = escapeHtml(brand.company);
  const portal = safeUrl(brand.portalLink);
  const button = content.button && safeUrl(content.button.url) ? content.button : undefined;

  const header = logo
    ? `<img src="${logo}" alt="${company}" height="48" style="display:block;height:48px;width:auto;max-width:240px;border:0;outline:none;">`
    : `<span style="font-size:20px;font-weight:700;color:${accent};letter-spacing:-0.2px;">${company}</span>`;

  const bannerSrc = safeUrl(brand.bannerUrl);
  const bannerHref = safeUrl(brand.bannerLink);
  const bannerImg = bannerSrc
    ? `<img src="${bannerSrc}" alt="${company}" width="${EMAIL_BANNER_WIDTH}" style="display:block;width:100%;max-width:${EMAIL_BANNER_WIDTH}px;height:auto;border:0;outline:none;">`
    : '';
  const bannerHtml = bannerImg
    ? `<tr><td style="padding:0 0 22px 0;font-size:0;line-height:0;">${bannerHref ? `<a href="${bannerHref}" style="display:block;">${bannerImg}</a>` : bannerImg}</td></tr>`
    : '';

  const label =
    content.ticketNumber !== undefined
      ? `<tr><td style="padding:0 40px 4px 40px;font-size:12px;line-height:18px;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;font-weight:600;">${escapeHtml(
          emailString(lang, 'requestLabel', { n: content.ticketNumber }),
        )}${content.ticketSubject ? ` &middot; <span style="text-transform:none;letter-spacing:0;font-weight:400;">${escapeHtml(content.ticketSubject)}</span>` : ''}</td></tr>`
      : '';

  const signatures = [content.agentSignature, brand.signature].filter((s): s is string => Boolean(s && s.trim()));
  const signatureHtml = signatures.length
    ? `<tr><td style="padding:4px 40px 8px 40px;font-size:14px;line-height:21px;color:#4b5563;">${signatures
        .map((s, i) => {
          const lines = escapeHtml(s.trim()).split('\n');
          // The agent's name (their signature's first line) stands out.
          if (i === 0 && content.agentSignature) lines[0] = `<strong style="color:#1f2937;">${lines[0]}</strong>`;
          return `<p style="margin:0 0 12px 0;">${lines.join('<br>')}</p>`;
        })
        .join('')}</td></tr>`
    : '';

  const buttonHtml = button
    ? `<tr><td style="padding:8px 40px 24px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #eef0f3;border-radius:10px;">
          <tr><td style="padding:20px 24px;">
            ${button.title ? `<p style="margin:0 0 4px 0;font-size:16px;font-weight:700;color:#111827;">${escapeHtml(button.title)}</p>` : ''}
            ${button.text ? `<p style="margin:0 0 16px 0;font-size:14px;line-height:21px;color:#4b5563;">${escapeHtml(button.text)}</p>` : ''}
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${accent};">
              <a href="${button.url}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(button.label)}</a>
            </td></tr></table>
          </td></tr>
        </table>
      </td></tr>`
    : '';

  const quoteHtml = content.quote
    ? `<tr><td style="padding:0 40px 24px 40px;">
        <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;">${escapeHtml(emailString(lang, 'quoteIntro', { name: content.quote.author }))}</p>
        <div style="border-left:3px solid #e5e7eb;padding:2px 0 2px 14px;font-size:13px;line-height:20px;color:#6b7280;">${textToHtml(
          content.quote.body,
          '#6b7280',
        ).replace(/margin:0 0 16px 0/g, 'margin:0 0 10px 0')}</div>
      </td></tr>`
    : '';

  const replyHint =
    content.ticketNumber !== undefined ? `<p style="margin:0 0 6px 0;">${escapeHtml(emailString(lang, 'replyHint', { n: content.ticketNumber }))}</p>` : '';
  const portalHtml = portal
    ? ` &middot; <a href="${portal}" style="color:${accent};text-decoration:none;">${escapeHtml(emailString(lang, 'portalLink'))}</a>`
    : '';

  const preheader = content.preheader ?? content.body.replace(/\s+/g, ' ').slice(0, 140);

  const html = `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${company}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;font-family:${FONT};">
  <tr><td align="center" style="padding:32px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr><td style="height:5px;line-height:5px;font-size:0;background:${accent};">&nbsp;</td></tr>
      <tr><td style="padding:28px 40px 20px 40px;">${header}</td></tr>
      ${bannerHtml}
      ${label}
      <tr><td style="padding:12px 40px 8px 40px;font-size:15px;line-height:24px;color:#1f2937;">${textToHtml(content.body, accent)}</td></tr>
      ${signatureHtml}
      ${buttonHtml}
      ${quoteHtml}
      <tr><td style="padding:18px 40px;background:#f9fafb;border-top:1px solid #eef0f3;font-size:12px;line-height:18px;color:#6b7280;">
        ${replyHint}<p style="margin:0;">${company}${portalHtml}</p>
      </td></tr>
    </table>
    <p style="margin:18px 0 0 0;font-size:11px;line-height:16px;color:#9ca3af;font-family:${FONT};">${escapeHtml(emailString(lang, 'poweredBy'))} <a href="${SEREDINA_URL}" style="color:#6b7280;font-weight:600;text-decoration:none;">Seredina</a></p>
  </td></tr>
</table>
</body></html>`;

  const text = [
    content.body.trim(),
    signatures.map((s) => s.trim()).join('\n\n'),
    button ? `${[button.title, button.text].filter(Boolean).join(' ')}\n${button.label}: ${button.url}`.trim() : '',
    content.quote ? `${emailString(lang, 'quoteIntro', { name: content.quote.author })}\n${content.quote.body.trim().split('\n').map((l) => `> ${l}`).join('\n')}` : '',
    '--',
    content.ticketNumber !== undefined ? emailString(lang, 'replyHint', { n: content.ticketNumber }) : '',
    portal ? `${brand.company} · ${emailString(lang, 'portalLink')}: ${portal}` : brand.company,
    `${emailString(lang, 'poweredBy')} Seredina`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { html, text };
}

/**
 * Stored on the automatic message of a ticket event (Message.emailMeta): the
 * rendered subject and body, and the button, which the worker lays out as
 * the branded email. The message's own body is the same text with the
 * button's link spelled out, for the timeline and non-email channels.
 */
export interface EmailMeta {
  event: EmailEvent;
  subject: string;
  body: string;
  button?: { title?: string; text?: string; label: string; url: string };
}

export function parseEmailMeta(raw: unknown): EmailMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<EmailMeta>;
  if (!EMAIL_EVENTS.includes(r.event as EmailEvent) || typeof r.subject !== 'string' || typeof r.body !== 'string') return null;
  const b = r.button;
  const button = b && typeof b.label === 'string' && typeof b.url === 'string' ? b : undefined;
  return { event: r.event as EmailEvent, subject: r.subject, body: r.body, button };
}

/** The customer portal's address, when the portal is on and the server knows its origin. */
export function portalHomeLink(webOrigin: string | undefined, tenantSlug: string, portalEnabled: boolean): string | null {
  const origin = (webOrigin ?? '').replace(/\/$/, '');
  return portalEnabled && origin ? `${origin}/portal/${tenantSlug}` : null;
}

/** A ticket event's survey button, in the tenant's language. */
export function surveyButton(language: EmailLanguage, url: string): NonNullable<EmailContent['button']> {
  return {
    title: emailString(language, 'surveyTitle'),
    text: emailString(language, 'surveyText'),
    label: emailString(language, 'surveyButton'),
    url,
  };
}

/** Caps a quoted message, so a long thread doesn't bury the reply. */
export function quoteExcerpt(body: string, max = 1500): string {
  const t = body.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** "Name" <address>, with the name quoted safely. */
export function formatFrom(name: string, address: string): string {
  const clean = name.replace(/["\r\n\\]/g, '').trim();
  return clean ? `"${clean}" <${address}>` : address;
}

/** The tenant row fields the layout reads. */
export interface EmailTenant {
  name: string;
  slug: string;
  branding: unknown;
  emailSettings: unknown;
  customerPortalEnabled: boolean;
}

/** Everything about the tenant an email needs: its settings, its brand and the From line. */
export function emailContextFor(tenant: EmailTenant, webOrigin: string | undefined, fromAddress?: string) {
  const settings = parseEmailSettings(tenant.emailSettings);
  const branding = (tenant.branding && typeof tenant.branding === 'object' ? tenant.branding : {}) as { logoUrl?: string; accentColor?: string };
  const portalLink = portalHomeLink(webOrigin, tenant.slug, tenant.customerPortalEnabled);
  const brand: EmailBrand = {
    company: tenant.name,
    logoUrl: settings.logoUrl || branding.logoUrl || null,
    bannerUrl: settings.bannerUrl || null,
    bannerLink: settings.bannerLink || null,
    accentColor: branding.accentColor ?? null,
    language: settings.language,
    signature: settings.signature,
    portalLink,
  };
  return {
    settings,
    brand,
    portalLink,
    from: fromAddress ? formatFrom(settings.senderName || tenant.name, fromAddress) : undefined,
  };
}
