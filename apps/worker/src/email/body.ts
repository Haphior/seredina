import { convert } from 'html-to-text';
import { simpleParser, type ParsedMail } from 'mailparser';
import type { EmailLanguage } from '@seredina/shared';

const FORWARD_LABELS: Record<EmailLanguage, { header: string; from: string; date: string; subject: string; to: string }> = {
  es: { header: '---------- Mensaje reenviado ----------', from: 'De', date: 'Fecha', subject: 'Asunto', to: 'Para' },
  en: { header: '---------- Forwarded message ----------', from: 'From', date: 'Date', subject: 'Subject', to: 'To' },
};

/** Forwarded messages nested inside forwarded messages are read this deep. */
const MAX_DEPTH = 3;

/**
 * The readable body of an email:
 * - its plain-text part;
 * - or, when that's blank (some Outlook versions send an empty text part with
 *   the real content only in HTML), the HTML converted to text;
 * - followed by the text of any email forwarded *as an attachment*
 *   (message/rfc822, Outlook's and Gmail's "forward as attachment"), whose
 *   own body is otherwise empty.
 *
 * The .eml attachment is still saved on the ticket; this only makes what it
 * says readable in the conversation.
 */
export async function extractInboundBody(parsed: ParsedMail, language: EmailLanguage, depth = 0): Promise<string> {
  let body = (parsed.text ?? '').trim();
  if (!body && typeof parsed.html === 'string' && parsed.html.trim()) {
    body = htmlToPlainText(parsed.html);
  }

  if (depth < MAX_DEPTH) {
    for (const a of parsed.attachments) {
      if (a.contentType !== 'message/rfc822') continue;
      try {
        const inner = await simpleParser(a.content, {});
        const innerBody = await extractInboundBody(inner, language, depth + 1);
        body = [body, forwardedBlock(inner, innerBody, language)].filter(Boolean).join('\n\n');
      } catch {
        // An attachment that doesn't parse stays just an attachment.
      }
    }
  }
  return body;
}

export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true, ignoreHref: false } },
      { selector: 'style', format: 'skip' },
      { selector: 'head', format: 'skip' },
    ],
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function forwardedBlock(inner: ParsedMail, innerBody: string, language: EmailLanguage): string {
  const l = FORWARD_LABELS[language];
  const lines = [l.header];
  if (inner.from?.text) lines.push(`${l.from}: ${inner.from.text}`);
  if (inner.date) lines.push(`${l.date}: ${inner.date.toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  if (inner.subject) lines.push(`${l.subject}: ${inner.subject}`);
  const to = Array.isArray(inner.to) ? inner.to.map((t) => t.text).join(', ') : inner.to?.text;
  if (to) lines.push(`${l.to}: ${to}`);
  return `${lines.join('\n')}\n\n${innerBody}`.trim();
}
