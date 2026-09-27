import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload, ApiError } from '../lib/api';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Textarea } from '../components/Textarea';
import { Badge } from '../components/Badge';

type Language = 'es' | 'en';
type EmailEvent = 'ticket_created' | 'agent_reply' | 'ticket_resolved' | 'ticket_closed';

interface EmailSettings {
  language: Language;
  senderName: string;
  signature: string;
  quoteHistory: boolean;
  surveyOnResolve: boolean;
  logoUrl: string;
  bannerUrl: string;
  bannerLink: string;
}

interface TemplateView {
  event: EmailEvent;
  enabled: boolean;
  subject: string;
  body: string;
  custom: boolean;
  canDisable: boolean;
  variables: string[];
}

interface TemplatesResponse {
  settings: EmailSettings;
  templates: TemplateView[];
  defaults: Record<Language, Record<EmailEvent, { enabled: boolean; subject: string; body: string }>>;
  hasEmailChannel: boolean;
}

interface Preview {
  subject: string;
  html: string;
  text: string;
  unknownVariables: string[];
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Administration → Customer emails (docs/adr/0070-customer-email-templates.md):
 * the language, sender name and signature of every email to customers, and
 * the wording of each automatic one, with a live preview of the branded email.
 */
export function CustomerEmails() {
  const { t } = useTranslation();
  const [data, setData] = useState<TemplatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<TemplatesResponse>('/email-templates')
      .then(setData)
      .catch((err) => setError(errorText(err, t('customerEmails.loadFailed'))));
  }, [t]);
  useEffect(load, [load]);

  return (
    <div className="max-w-5xl px-4 py-5 md:px-8 md:py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('customerEmails.title')}</h1>
      <p className="mb-5 max-w-3xl text-[13.5px] text-slate-500">{t('customerEmails.intro')}</p>
      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {data === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {data && (
        <div className="space-y-6">
          {!data.hasEmailChannel && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              {t('customerEmails.needsEmail')}{' '}
              <Link to="/email-channels" className="font-semibold underline">
                {t('nav.items.emailChannels')}
              </Link>
            </p>
          )}
          <SettingsCard settings={data.settings} onSaved={load} />
          {data.templates.map((tpl) => (
            <TemplateCard
              key={`${tpl.event}-${data.settings.language}-${tpl.custom}-${tpl.subject}`}
              template={tpl}
              defaults={data.defaults[data.settings.language][tpl.event]}
              canTest={data.hasEmailChannel}
              onChanged={setData}
            />
          ))}
          <p className="text-[12.5px] text-slate-500">
            {t('customerEmails.signatureHint')}{' '}
            <Link to="/account/security" className="font-semibold text-indigo-600 hover:underline">
              {t('customerEmails.signatureLink')}
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

function SettingsCard({ settings, onSaved }: { settings: EmailSettings; onSaved: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof EmailSettings>(k: K, v: EmailSettings[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await apiPut('/email-templates/settings', form);
      setMessage({ ok: true, text: t('customerEmails.saved') });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, t('customerEmails.saveFailed')) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-[15px] font-bold text-slate-800">{t('customerEmails.settingsTitle')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label={t('customerEmails.language')} value={form.language} onChange={(e) => set('language', e.target.value as Language)}>
          <option value="es">Español</option>
          <option value="en">English</option>
        </Select>
        <Input
          label={t('customerEmails.senderName')}
          value={form.senderName}
          maxLength={100}
          placeholder={t('customerEmails.senderNamePlaceholder')}
          onChange={(e) => set('senderName', e.target.value)}
        />
      </div>
      <p className="-mt-2 text-[12.5px] text-slate-500">{t('customerEmails.languageHint')}</p>
      <Textarea
        label={t('customerEmails.companySignature')}
        rows={3}
        maxLength={2000}
        value={form.signature}
        placeholder={t('customerEmails.companySignaturePlaceholder')}
        onChange={(e) => set('signature', e.target.value)}
      />
      <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <ImageField
          kind="logo"
          url={form.logoUrl}
          onUrl={(v) => set('logoUrl', v)}
          onUploaded={(next) => setForm((f) => ({ ...f, logoUrl: next.logoUrl }))}
        />
        <ImageField
          kind="banner"
          url={form.bannerUrl}
          onUrl={(v) => set('bannerUrl', v)}
          onUploaded={(next) => setForm((f) => ({ ...f, bannerUrl: next.bannerUrl, bannerLink: next.bannerLink }))}
        />
      </div>
      {form.bannerUrl && (
        <Input
          label={t('customerEmails.bannerLink')}
          value={form.bannerLink}
          placeholder="https://"
          onChange={(e) => set('bannerLink', e.target.value.trim())}
        />
      )}
      <Check label={t('customerEmails.quoteHistory')} hint={t('customerEmails.quoteHistoryHint')} checked={form.quoteHistory} onChange={(v) => set('quoteHistory', v)} />
      <Check label={t('customerEmails.survey')} hint={t('customerEmails.surveyHint')} checked={form.surveyOnResolve} onChange={(v) => set('surveyOnResolve', v)} />
      <div className="flex items-center gap-3">
        <Button onClick={save} isLoading={saving}>
          {t('customerEmails.save')}
        </Button>
        {message && <span className={`text-[13px] ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</span>}
      </div>
    </Card>
  );
}

function TemplateCard({
  template,
  defaults,
  canTest,
  onChanged,
}: {
  template: TemplateView;
  defaults: { subject: string; body: string };
  canTest: boolean;
  onChanged: (data: TemplatesResponse) => void;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(template.enabled);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState<'save' | 'reset' | 'test' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const dirty = enabled !== template.enabled || subject !== template.subject || body !== template.body;

  // The preview follows the text as it's typed, a moment after typing stops.
  useEffect(() => {
    if (!showPreview) return;
    const timer = setTimeout(() => {
      apiPost<Preview>('/email-templates/preview', { event: template.event, subject, body })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [showPreview, subject, body, template.event]);

  function insertVariable(name: string) {
    const token = `{{${name}}}`;
    const el = bodyRef.current;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function run(kind: 'save' | 'reset' | 'test') {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'save') {
        onChanged(await apiPut<TemplatesResponse>(`/email-templates/${template.event}`, { enabled, subject, body }));
      } else if (kind === 'reset') {
        onChanged(await apiDelete<TemplatesResponse>(`/email-templates/${template.event}`));
      } else {
        const res = await apiPost<{ to: string }>('/email-templates/test', { event: template.event, subject, body });
        setMessage({ ok: true, text: t('customerEmails.testSent', { to: res.to }) });
      }
    } catch (err) {
      setMessage({ ok: false, text: errorText(err, t('customerEmails.saveFailed')) });
    } finally {
      setBusy(null);
    }
  }

  const isDefault = subject === defaults.subject && body === defaults.body;

  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-bold text-slate-800">{t(`customerEmails.events.${template.event}.title`)}</h2>
          {template.custom ? <Badge tone="indigo">{t('customerEmails.custom')}</Badge> : <Badge tone="slate">{t('customerEmails.default')}</Badge>}
        </div>
        {template.canDisable && (
          <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
            />
            {t('customerEmails.enabled')}
          </label>
        )}
      </div>
      <p className="mb-4 text-[13px] text-slate-500">{t(`customerEmails.events.${template.event}.when`, { message: '{{message}}' })}</p>

      <div className={`space-y-3 ${enabled ? '' : 'opacity-60'}`}>
        <Input label={t('customerEmails.subject')} value={subject} maxLength={250} onChange={(e) => setSubject(e.target.value)} />
        {/* A plain textarea: the variable chips insert at its cursor, which needs a ref. */}
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">{t('customerEmails.body')}</span>
          <textarea
            ref={bodyRef}
            rows={7}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-[9px] border border-slate-200 bg-white px-3 py-2 text-[13.5px] text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </label>
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-slate-500">{t('customerEmails.variables')}</p>
          <div className="flex flex-wrap gap-1.5">
            {template.variables.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                title={t(`customerEmails.vars.${v.replace('.', '_')}`)}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[12px] text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => run('save')} isLoading={busy === 'save'} disabled={!dirty}>
          {t('customerEmails.save')}
        </Button>
        <Button variant="ghost" onClick={() => setShowPreview((s) => !s)}>
          {showPreview ? t('customerEmails.hidePreview') : t('customerEmails.preview')}
        </Button>
        <Button variant="ghost" onClick={() => run('test')} isLoading={busy === 'test'} disabled={!canTest}>
          {t('customerEmails.sendTest')}
        </Button>
        {(template.custom || !isDefault) && (
          <Button variant="ghost" onClick={() => run('reset')} isLoading={busy === 'reset'}>
            {t('customerEmails.restore')}
          </Button>
        )}
        {message && <span className={`text-[13px] ${message.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</span>}
      </div>

      {showPreview && preview && (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[13px]">
            <span className="font-semibold text-slate-500">{t('customerEmails.subject')}: </span>
            <span className="text-slate-800">{preview.subject}</span>
            {preview.unknownVariables.length > 0 && (
              <p className="mt-1 text-rose-600">
                {t('customerEmails.unknownVariables', { list: preview.unknownVariables.map((v) => `{{${v}}}`).join(', ') })}
              </p>
            )}
          </div>
          {/* sandbox with no permissions: the preview can't run script or navigate this page. */}
          <iframe title={t('customerEmails.preview')} sandbox="" srcDoc={preview.html} className="h-[560px] w-full bg-slate-100" />
        </div>
      )}
    </Card>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
      />
      <span>
        <span className="block text-[13.5px] font-semibold text-slate-800">{label}</span>
        <span className="block text-[12.5px] text-slate-500">{hint}</span>
      </span>
    </label>
  );
}

/**
 * The email logo or banner: upload an image (stored by Seredina and served
 * to mail clients) or paste the address of one hosted elsewhere.
 */
function ImageField({
  kind,
  url,
  onUrl,
  onUploaded,
}: {
  kind: 'logo' | 'banner';
  url: string;
  onUrl: (v: string) => void;
  onUploaded: (settings: EmailSettings) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      onUploaded(await apiUpload<EmailSettings>(`/email-templates/images/${kind}`, form));
    } catch (err) {
      setError(errorText(err, t('customerEmails.uploadFailed')));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      onUploaded(await apiDelete<EmailSettings>(`/email-templates/images/${kind}`));
    } catch (err) {
      setError(errorText(err, t('customerEmails.uploadFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-1 text-[12.5px] font-semibold text-slate-700">{t(`customerEmails.${kind}.label`)}</p>
      <p className="mb-2 text-[12px] text-slate-500">{t(`customerEmails.${kind}.hint`)}</p>
      <div
        className={`mb-2 flex items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-200 bg-slate-50 ${kind === 'banner' ? 'h-24' : 'h-16'}`}
      >
        {url ? (
          <img src={url} alt="" className={kind === 'banner' ? 'h-full w-full object-cover' : 'max-h-12 max-w-[220px]'} />
        ) : (
          <span className="text-[12px] text-slate-400">{t(`customerEmails.${kind}.empty`)}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <Button size="sm" variant="ghost" isLoading={busy} onClick={() => input.current?.click()}>
          {t('customerEmails.upload')}
        </Button>
        {url && (
          <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
            {t('customerEmails.removeImage')}
          </Button>
        )}
      </div>
      <div className="mt-2">
        <Input
          hideLabel
          aria-label={t(`customerEmails.${kind}.urlLabel`)}
          value={url}
          placeholder={t('customerEmails.orPasteUrl')}
          onChange={(e) => onUrl(e.target.value.trim())}
        />
      </div>
      {error && <p className="mt-1 text-[12.5px] text-rose-600">{error}</p>}
    </div>
  );
}
