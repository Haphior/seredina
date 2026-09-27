import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma, withTenantTx } from '@seredina/db';
import {
  defaultEmailTemplate,
  formatFrom,
  parseEmailSettings,
  renderBrandedEmail,
  renderTemplate,
  textToHtml,
  unknownVariables,
} from '@seredina/shared';
import { buildApp } from '../src/index';
import { addMessage, createTicketFromApi, getTicket, mergeTicket, seedDefaultTicketStatuses, updateTicket } from '../src/modules/tickets/service';
import { processTicketFollowup } from '../src/lib/ticketFollowup';
import { isAutomaticEmail } from '../../worker/src/email/ingest';
// vi.mock below is hoisted above these imports, so send.ts gets the recording transport.
import { sendEmailMessage } from '../../worker/src/email/send';

// The worker's sender, with the SMTP transport swapped for one that records
// what would have been sent.
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('../../worker/src/email/transport', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../worker/src/email/transport')>();
  return {
    ...real,
    createTransportForChannel: async () => ({
      sendMail: async (mail: Record<string, unknown>) => {
        sent.push(mail);
        return { messageId: String(mail.messageId ?? '') };
      },
    }),
  };
});

/** docs/adr/0070-customer-email-templates.md */
describe('customer email rendering', () => {
  const brand = { company: 'Infra & Co', language: 'es' as const, accentColor: '#0f766e', signature: 'Mesa de ayuda\nAnexo 214', portalLink: 'https://desk.example.com/portal/infra' };

  it('fills variables and escapes whatever a customer or agent typed', () => {
    const r = renderTemplate(
      { subject: '[#{{ticket.number}}]   {{ticket.subject}}', body: 'Hola {{contact.name}},\n\n{{message}}' },
      { company: 'X', contactName: '<b>Ana</b>', contactEmail: 'a@x', ticketNumber: 7, ticketSubject: 'Impresora\n<script>', message: 'Mira https://x.test/a?b=1&c=2.' },
    );
    expect(r.subject).toBe('[#7] Impresora <script>');
    const { html, text } = renderBrandedEmail(brand, { body: r.body, ticketNumber: 7, ticketSubject: 'Impresora <script>' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Ana</b>');
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(html).toContain('<a href="https://x.test/a?b=1&amp;c=2"');
    expect(html).toContain('Infra &amp; Co');
    expect(html).toContain('#0f766e');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('Solicitud #7');
    expect(html).toContain('Powered by <a href="https://github.com/Haphior/seredina"');
    expect(html).toContain('Ver mis solicitudes');
    expect(html).toContain('Mesa de ayuda<br>Anexo 214');
    expect(text).toContain('Mesa de ayuda\nAnexo 214');
    expect(text).toContain('Powered by Seredina');
    expect(text).toContain('solicitud #7');
  });

  it('refuses a logo or button that is not a plain http(s) URL', () => {
    const { html } = renderBrandedEmail(
      { ...brand, logoUrl: 'javascript:alert(1)', accentColor: 'red;background:url(x)' },
      { body: 'x', button: { label: 'Clic', url: 'javascript:alert(1)' } },
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('red;background');
    expect(html).not.toContain('Clic');
  });

  it('shows the banner under the logo, as a link when one is set', () => {
    const { html } = renderBrandedEmail(
      { ...brand, logoUrl: 'https://cdn.test/logo.png', bannerUrl: 'https://cdn.test/banner.jpg', bannerLink: 'https://infra.test/promo' },
      { body: 'x' },
    );
    expect(html).toContain('<img src="https://cdn.test/logo.png"');
    expect(html.indexOf('logo.png')).toBeLessThan(html.indexOf('banner.jpg'));
    expect(html).toContain('<a href="https://infra.test/promo" style="display:block;"><img src="https://cdn.test/banner.jpg"');
    expect(renderBrandedEmail({ ...brand, bannerUrl: 'data:image/png;base64,xx' }, { body: 'x' }).html).not.toContain('data:image');
  });

  it('turns blank lines into paragraphs and single newlines into breaks', () => {
    expect(textToHtml('uno\ndos\n\ntres', '#000')).toBe('<p style="margin:0 0 16px 0;">uno<br>dos</p><p style="margin:0 0 16px 0;">tres</p>');
  });

  it('has Spanish defaults with no English in them, and English ones too', () => {
    for (const event of ['ticket_created', 'ticket_resolved', 'ticket_closed'] as const) {
      const es = defaultEmailTemplate(event, 'es');
      // Variable names are code, not wording the customer sees.
      const wording = `${es.subject} ${es.body}`.replace(/\{\{[^}]+\}\}/g, '');
      expect(wording).toMatch(/solicitud/i);
      expect(wording).not.toMatch(/\b(the|your|request|ticket|we)\b/i);
      expect(defaultEmailTemplate(event, 'en').body).toMatch(/request/);
    }
    expect(defaultEmailTemplate('ticket_closed', 'es').enabled).toBe(false);
    expect(parseEmailSettings(null).language).toBe('es');
  });

  it('flags variables an event does not offer', () => {
    expect(unknownVariables('ticket_created', 'Hola {{contact.name}} {{message}} {{ nope }}')).toEqual(['message', 'nope']);
    expect(unknownVariables('agent_reply', '{{message}} {{agent.name}}')).toEqual([]);
  });

  it('quotes the sender name safely', () => {
    expect(formatFrom('Soporte "Infra"\r\nBcc: x', 'soporte@infra.test')).toBe('"Soporte InfraBcc: x" <soporte@infra.test>');
    expect(formatFrom('', 'a@b.c')).toBe('a@b.c');
  });

  it('recognizes automatic mail that must not get an acknowledgement', () => {
    const h = (entries: Array<[string, unknown]>) => new Map(entries);
    expect(isAutomaticEmail(h([['auto-submitted', 'auto-replied']]), 'ana@x.test')).toBe(true);
    expect(isAutomaticEmail(h([['auto-submitted', 'no']]), 'ana@x.test')).toBe(false);
    expect(isAutomaticEmail(h([['precedence', 'bulk']]), 'ana@x.test')).toBe(true);
    expect(isAutomaticEmail(h([['x-auto-response-suppress', 'All']]), 'ana@x.test')).toBe(true);
    expect(isAutomaticEmail(h([['list-id', '<news.x.test>']]), 'ana@x.test')).toBe(true);
    expect(isAutomaticEmail(h([]), 'MAILER-DAEMON@x.test')).toBe(true);
    expect(isAutomaticEmail(h([]), 'no-reply@x.test')).toBe(true);
    expect(isAutomaticEmail(h([]), 'ana@x.test')).toBe(false);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('customer email: ticket events', () => {
  let tenantId: string;
  let statusIds: Record<string, string>;
  let agentId: string;

  beforeEach(async () => {
    tenantId = randomUUID();
    process.env.WEB_ORIGIN = 'https://desk.example.com';
    await withTenantTx(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: `mail-${tenantId.slice(0, 8)}`, name: 'Infraplast', customerPortalEnabled: true } });
      const statuses = await seedDefaultTicketStatuses(tx, tenantId);
      statusIds = Object.fromEntries(statuses.map((s) => [s.key, s.id]));
      const agent = await tx.user.create({
        data: { tenantId, email: 'maria@infra.test', name: 'María Pérez', passwordHash: 'x', emailSignature: 'María Pérez\nSoporte TI' },
      });
      agentId = agent.id;
      await tx.emailChannel.create({
        data: {
          tenantId,
          name: 'Soporte',
          fromAddress: 'soporte@infra.test',
          imapHost: 'imap.infra.test',
          imapPort: 993,
          imapUsername: 'soporte',
          smtpHost: 'smtp.infra.test',
          smtpPort: 465,
          smtpUsername: 'soporte',
        },
      });
    });
    sent.length = 0;
  });

  const newTicket = (channel = 'email') =>
    createTicketFromApi(tenantId, { subject: 'No imprime', body: 'La impresora no responde.', contactEmail: 'ana@cliente.test', contactName: 'Ana Rojas', channel });

  const systemMessages = async (ticketId: string) => (await getTicket(tenantId, ticketId)).messages.filter((m) => m.authorType === 'SYSTEM');

  it('resolving sends the Spanish "resolved" email with the survey button', async () => {
    const ticket = await newTicket();
    await updateTicket(tenantId, ticket.id, { statusId: statusIds.resolved });

    const [msg] = await systemMessages(ticket.id);
    expect(msg.body).toContain(`Tu solicitud #${ticket.number} quedó resuelta`);
    expect(msg.body).toContain('Calificar la atención: https://desk.example.com/csat/');
    expect(msg.body).not.toMatch(/How did we do/);
    const meta = msg.emailMeta as { event: string; subject: string; button?: { url: string } };
    expect(meta.event).toBe('ticket_resolved');
    expect(meta.subject).toBe(`[#${ticket.number}] Solicitud resuelta: No imprime`);
    expect(meta.button?.url).toMatch(/^https:\/\/desk\.example\.com\/csat\//);

    // What the worker actually sends.
    await sendEmailMessage(tenantId, ticket.id, msg.id);
    const mail = sent.at(-1)!;
    expect(mail.from).toBe('"Infraplast" <soporte@infra.test>');
    expect(mail.to).toBe('ana@cliente.test');
    expect(mail.subject).toBe(meta.subject);
    expect(mail.html).toContain('Calificar la atención');
    expect(mail.html).toContain('Powered by');
    expect(mail.html).toContain('https://desk.example.com/portal/mail-');
    expect(mail.headers).toEqual({ 'Auto-Submitted': 'auto-generated' });
  });

  it('closing uses the "closed" email when turned on, and nothing goes out when the event is off', async () => {
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.emailTemplate.create({ data: { tenantId, event: 'ticket_closed', enabled: true, subject: 'Cerrado #{{ticket.number}}', body: 'Adiós {{contact.name}}' } }),
    );
    const t1 = await newTicket();
    await updateTicket(tenantId, t1.id, { statusId: statusIds.closed });
    const [closed] = await systemMessages(t1.id);
    expect((closed.emailMeta as { event: string }).event).toBe('ticket_closed');
    expect(closed.body).toContain('Adiós Ana Rojas');
    // The survey rides on it: the ticket skipped straight to closed.
    expect(closed.body).toContain('/csat/');

    await withTenantTx(prisma, tenantId, (tx) =>
      tx.emailTemplate.create({ data: { tenantId, event: 'ticket_resolved', enabled: false, subject: 'x', body: 'y' } }),
    );
    const t2 = await newTicket();
    await updateTicket(tenantId, t2.id, { statusId: statusIds.resolved });
    expect(await systemMessages(t2.id)).toHaveLength(0);
  });

  it('acknowledges a new request once, and never an automatic email', async () => {
    const ticket = await newTicket();
    await processTicketFollowup({ tenantId, ticketId: ticket.id, finalize: true, acknowledge: true });
    await processTicketFollowup({ tenantId, ticketId: ticket.id, finalize: true, acknowledge: true });
    const acks = await systemMessages(ticket.id);
    expect(acks).toHaveLength(1);
    expect(acks[0].body).toContain(`quedó registrada con el número #${ticket.number}`);
    expect((acks[0].emailMeta as { subject: string }).subject).toBe(`[#${ticket.number}] Recibimos tu solicitud: No imprime`);

    await sendEmailMessage(tenantId, ticket.id, acks[0].id);
    expect(sent.at(-1)!.headers).toEqual({ 'Auto-Submitted': 'auto-replied' });

    const auto = await newTicket();
    await processTicketFollowup({ tenantId, ticketId: auto.id, finalize: true, acknowledge: false });
    expect(await systemMessages(auto.id)).toHaveLength(0);
  });

  it("sends an agent's reply through the reply template with their signature and the customer's message quoted", async () => {
    await withTenantTx(prisma, tenantId, (tx) =>
      tx.tenant.update({ where: { id: tenantId }, data: { emailSettings: { senderName: 'Soporte Infraplast', signature: 'Infraplast S.A.' } } }),
    );
    const ticket = await newTicket();
    const reply = await addMessage(tenantId, ticket.id, { authorUserId: agentId, body: 'Hola Ana,\n\nYa quedó.', isPrivateNote: false });
    await sendEmailMessage(tenantId, ticket.id, reply.id);
    const mail = sent.at(-1)!;
    expect(mail.from).toBe('"Soporte Infraplast" <soporte@infra.test>');
    expect(mail.subject).toBe(`Re: [#${ticket.number}] No imprime`);
    expect(mail.html).toContain('Ya quedó.');
    expect(mail.html).toContain('María Pérez</strong><br>Soporte TI');
    expect(mail.html).toContain('Infraplast S.A.');
    expect(mail.html).toContain('Ana Rojas escribió:');
    expect(mail.html).toContain('La impresora no responde.');
    expect(mail.text).toContain('> La impresora no responde.');
    expect(mail.headers).toBeUndefined();
  });

  it('writes merge notices in the tenant language', async () => {
    const a = await newTicket();
    const b = await newTicket();
    await mergeTicket(tenantId, a.id, b.id);
    const [notice] = await systemMessages(a.id);
    expect(notice.body).toBe(`Esta solicitud se unió a la #${b.number} («No imprime»).`);
  });
});

describe.skipIf(!hasDb)('customer email: settings API', () => {
  const app = buildApp();
  const slug = `mailapi-${randomUUID().slice(0, 8)}`;
  let token: string;
  let ip = 0;
  const nextIp = () => `10.97.${Math.floor(++ip / 250)}.${ip % 250}`;
  const as = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.WEB_ORIGIN = 'https://desk.example.com';
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: nextIp(),
      payload: { tenantSlug: slug, tenantName: 'Mail API Co', adminEmail: 'admin@mailapi.test', adminName: 'Admin', password: 'admin-password-1' },
    });
    token = res.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the Spanish defaults, validates and saves a template, and restores the default', async () => {
    const list = await app.inject({ method: 'GET', url: '/email-templates', headers: as() });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.settings.language).toBe('es');
    const created = body.templates.find((t: { event: string }) => t.event === 'ticket_created');
    expect(created.subject).toContain('Recibimos tu solicitud');
    expect(created.custom).toBe(false);
    expect(body.defaults.en.ticket_created.subject).toContain('We received');

    const bad = await app.inject({
      method: 'PUT',
      url: '/email-templates/ticket_created',
      headers: as(),
      payload: { enabled: true, subject: 'Hola {{cliente}}', body: 'x' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('{{cliente}}');

    const noMessage = await app.inject({
      method: 'PUT',
      url: '/email-templates/agent_reply',
      headers: as(),
      payload: { enabled: true, subject: 'Re: {{ticket.subject}}', body: 'Hola' },
    });
    expect(noMessage.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PUT',
      url: '/email-templates/ticket_created',
      headers: as(),
      payload: { enabled: false, subject: 'Recibido #{{ticket.number}}', body: 'Gracias, {{contact.name}}.' },
    });
    expect(ok.statusCode).toBe(200);
    const saved = ok.json().templates.find((t: { event: string }) => t.event === 'ticket_created');
    expect(saved).toMatchObject({ enabled: false, subject: 'Recibido #{{ticket.number}}', custom: true });

    const reset = await app.inject({ method: 'DELETE', url: '/email-templates/ticket_created', headers: as() });
    expect(reset.json().templates.find((t: { event: string }) => t.event === 'ticket_created')).toMatchObject({ enabled: true, custom: false });
  });

  it('switches the defaults with the language and previews with sample data', async () => {
    const settings = await app.inject({
      method: 'PUT',
      url: '/email-templates/settings',
      headers: as(),
      payload: { language: 'en', senderName: 'Help Desk' },
    });
    expect(settings.json()).toMatchObject({ language: 'en', senderName: 'Help Desk', quoteHistory: true, surveyOnResolve: true });
    const list = (await app.inject({ method: 'GET', url: '/email-templates', headers: as() })).json();
    expect(list.templates.find((t: { event: string }) => t.event === 'ticket_resolved').subject).toContain('Request resolved');

    const preview = await app.inject({
      method: 'POST',
      url: '/email-templates/preview',
      headers: as(),
      payload: { event: 'agent_reply', subject: 'Re: {{ticket.subject}}', body: '{{message}}', settings: { language: 'es' } },
    });
    expect(preview.statusCode).toBe(200);
    const p = preview.json();
    expect(p.subject).toBe('Re: No puedo imprimir desde mi notebook');
    expect(p.html).toContain('Mail API Co');
    expect(p.html).toContain('Ana Rojas escribió:');
    expect(p.html).toContain('Powered by');
    expect(p.to).toBeUndefined();
  });

  it('uploads a logo and banner, serves them publicly and puts them in the emails', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
    const multipart = (data: Buffer, filename: string) => {
      const boundary = '----seredina-test';
      return {
        headers: { ...as(), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
          data,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      };
    };

    const svg = await app.inject({ method: 'POST', url: '/email-templates/images/banner', ...multipart(Buffer.from('<svg onload="x()"/>'), 'x.png') });
    expect(svg.statusCode).toBe(400);

    const up = await app.inject({ method: 'POST', url: '/email-templates/images/banner', ...multipart(png, 'banner.png') });
    expect(up.statusCode).toBe(200);
    const bannerUrl: string = up.json().bannerUrl;
    expect(bannerUrl).toMatch(new RegExp(`^https://desk\\.example\\.com/api/public/${slug}/email-images/banner\\?v=[0-9a-f]{12}$`));

    const served = await app.inject({ method: 'GET', url: `/public/${slug}/email-images/banner` });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.rawPayload.equals(png)).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/public/${slug}/email-images/other` })).statusCode).toBe(404);

    await app.inject({ method: 'PUT', url: '/email-templates/settings', headers: as(), payload: { bannerLink: 'https://mailapi.test/promo' } });
    expect(
      (await app.inject({ method: 'PUT', url: '/email-templates/settings', headers: as(), payload: { bannerLink: 'javascript:alert(1)' } })).statusCode,
    ).toBe(400);
    const preview = await app.inject({
      method: 'POST',
      url: '/email-templates/preview',
      headers: as(),
      payload: { event: 'ticket_created', subject: 'x', body: 'y' },
    });
    expect(preview.json().html).toContain(`<a href="https://mailapi.test/promo" style="display:block;"><img src="${bannerUrl.replace(/&/g, '&amp;')}"`);

    const removed = await app.inject({ method: 'DELETE', url: '/email-templates/images/banner', headers: as() });
    expect(removed.json()).toMatchObject({ bannerUrl: '', bannerLink: '' });
    expect((await app.inject({ method: 'GET', url: `/public/${slug}/email-images/banner` })).statusCode).toBe(404);
  });

  it('keeps an agent signature per user, and needs a mailbox for a test send', async () => {
    const put = await app.inject({ method: 'PUT', url: '/me/email-signature', headers: as(), payload: { signature: '  Admin\r\nTI  ' } });
    expect(put.json().signature).toBe('Admin\nTI');
    expect((await app.inject({ method: 'GET', url: '/me/email-signature', headers: as() })).json().signature).toBe('Admin\nTI');

    const test = await app.inject({
      method: 'POST',
      url: '/email-templates/test',
      headers: as(),
      payload: { event: 'ticket_created', subject: 'x', body: 'y' },
    });
    expect(test.statusCode).toBe(409);
  });
});
