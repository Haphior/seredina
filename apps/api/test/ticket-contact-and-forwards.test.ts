import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simpleParser } from 'mailparser';
import { buildApp } from '../src/index';
import { extractInboundBody } from '../../worker/src/email/body';

const forwardedAsAttachment = [
  'From: jefa@cliente.cl',
  'To: soporte@empresa.cl',
  'Subject: FW: Impresora',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="B"',
  '',
  '--B',
  'Content-Type: text/plain; charset=utf-8',
  '',
  '',
  '--B',
  'Content-Type: message/rfc822',
  'Content-Disposition: attachment; filename="original.eml"',
  '',
  'From: Ana Rojas <ana@cliente.cl>',
  'To: jefa@cliente.cl',
  'Subject: Impresora sin conexion',
  'Date: Mon, 12 Oct 2026 09:30:00 +0000',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>La impresora del <b>piso 2</b> no imprime.</p>',
  '',
  '--B--',
  '',
].join('\r\n');

const blankTextWithHtml = [
  'From: a@x.cl',
  'Subject: FW: alt',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="A"',
  '',
  '--A',
  'Content-Type: text/plain; charset=utf-8',
  '',
  ' ',
  '--A',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<html><head><style>p{color:red}</style></head><body><p>Cuerpo solo en HTML</p><img src="cid:logo"></body></html>',
  '--A--',
  '',
].join('\r\n');

describe('inbound email body', () => {
  it('reads an email forwarded as an attachment', async () => {
    const body = await extractInboundBody(await simpleParser(forwardedAsAttachment), 'es');
    expect(body).toContain('---------- Mensaje reenviado ----------');
    expect(body).toContain('De: "Ana Rojas" <ana@cliente.cl>');
    expect(body).toContain('Asunto: Impresora sin conexion');
    expect(body).toContain('La impresora del piso 2 no imprime.');
  });

  it('falls back to the HTML when the text part is blank', async () => {
    const body = await extractInboundBody(await simpleParser(blankTextWithHtml), 'en');
    expect(body).toBe('Cuerpo solo en HTML');
  });

  it('keeps a normal text body as it is', async () => {
    const parsed = await simpleParser('From: a@x.cl\r\nSubject: hola\r\nContent-Type: text/plain\r\n\r\nNecesito ayuda\r\n');
    expect(await extractInboundBody(parsed, 'es')).toBe('Necesito ayuda');
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("changing a ticket's contact", () => {
  const app = buildApp();
  const slug = `tc-${randomUUID().slice(0, 8)}`;
  let token: string;
  const as = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: '10.99.0.1',
      payload: { tenantSlug: slug, tenantName: 'Contactos SpA', adminEmail: 'admin@tc.test', adminName: 'Admin Uno', password: 'admin-password-1' },
    });
    token = res.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('moves the ticket to an existing or new contact and leaves an internal note', async () => {
    const ticket = (
      await app.inject({ method: 'POST', url: '/tickets', headers: as(), payload: { subject: 'FW: Impresora', body: 'x', contactEmail: 'jefa@cliente.cl', contactName: 'Jefa' } })
    ).json();
    const other = (
      await app.inject({ method: 'POST', url: '/tickets', headers: as(), payload: { subject: 'otro', body: 'y', contactEmail: 'ana@cliente.cl', contactName: 'Ana Rojas' } })
    ).json();

    const moved = await app.inject({ method: 'PUT', url: `/tickets/${ticket.id}/contact`, headers: as(), payload: { contactId: other.contactId } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().contact).toMatchObject({ name: 'Ana Rojas', email: 'ana@cliente.cl' });
    const note = moved.json().messages.find((m: { authorType: string }) => m.authorType === 'SYSTEM');
    expect(note).toMatchObject({ isPrivateNote: true, body: 'Admin Uno cambió el contacto de Jefa <jefa@cliente.cl> a Ana Rojas <ana@cliente.cl>.' });
    // The first message still reads as written by the original contact.
    const first = moved.json().messages.find((m: { authorType: string }) => m.authorType === 'CONTACT');
    expect(first.authorContact).toMatchObject({ name: 'Jefa', email: 'jefa@cliente.cl' });

    const created = await app.inject({ method: 'PUT', url: `/tickets/${ticket.id}/contact`, headers: as(), payload: { email: 'Pedro@Cliente.cl', name: 'Pedro' } });
    expect(created.json().contact).toMatchObject({ name: 'Pedro', email: 'pedro@cliente.cl' });

    expect((await app.inject({ method: 'PUT', url: `/tickets/${ticket.id}/contact`, headers: as(), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/tickets/${ticket.id}/contact`, headers: as(), payload: { contactId: randomUUID() } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/tickets/${randomUUID()}/contact`, headers: as(), payload: { email: 'x@y.cl' } })).statusCode).toBe(404);
  });
});
