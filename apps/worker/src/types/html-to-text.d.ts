// html-to-text ships no types; this is the one function the worker uses
// (src/email/body.ts).
declare module 'html-to-text' {
  export function convert(html: string, options?: Record<string, unknown>): string;
}
