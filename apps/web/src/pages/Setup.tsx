import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPatch, apiPost, apiPut, ApiError } from '../lib/api';
import type { Team } from '../lib/types';
import { setLanguage } from '../i18n';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CheckIcon } from '../components/icons';

/**
 * First-run setup (docs/adr/0072-first-run-setup.md): five short steps that
 * take a new workspace from empty to usable. Every step writes the same data
 * a Settings page does, and every step can be skipped.
 */

type StepKey = 'organization' | 'email' | 'template' | 'team' | 'done';
const STEPS: StepKey[] = ['organization', 'email', 'template', 'team', 'done'];

type TemplateKey = 'it_internal' | 'customer_support' | 'manufacturing';
const TEMPLATES: TemplateKey[] = ['it_internal', 'customer_support', 'manufacturing'];

type Schedule = 'office' | 'early' | 'shifts' | 'always' | 'none';
const SCHEDULES: Schedule[] = ['office', 'early', 'shifts', 'always', 'none'];

interface SetupStatus {
  completed: boolean;
  tenantName: string;
  language: 'es' | 'en';
  businessHours: { timezone: string } | null;
  mailboxes: number;
  template: TemplateKey | null;
  users: number;
  teams: number;
}

export function Setup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requested = params.get('step') as StepKey | null;
  const step: StepKey = requested && STEPS.includes(requested) ? requested : 'organization';
  const index = STEPS.indexOf(step);

  function reload() {
    return apiGet<SetupStatus>('/setup')
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('setup.loadFailed')));
  }

  useEffect(() => {
    reload();
  }, [step]);

  function go(next: StepKey) {
    setParams({ step: next });
    window.scrollTo({ top: 0 });
  }

  async function finish() {
    try {
      await apiPost('/setup/complete', {});
    } finally {
      navigate('/dashboard');
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-8 md:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-indigo-600">{t('setup.kicker')}</p>
          <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900">{t('setup.title')}</h1>
          <p className="text-[13.5px] text-slate-500">{t('setup.intro')}</p>
        </div>
        {step !== 'done' && (
          <button onClick={finish} className="text-[12.5px] font-medium text-slate-400 hover:text-slate-700">
            {t('setup.skipAll')}
          </button>
        )}
      </div>

      <ol className="mb-7 flex gap-1.5" aria-label={t('setup.progress')}>
        {STEPS.map((key, i) => (
          <li key={key} className="flex-1">
            <button
              onClick={() => go(key)}
              aria-current={key === step ? 'step' : undefined}
              className="group block w-full text-left"
            >
              <span className={`block h-1.5 rounded-full ${i <= index ? 'bg-indigo-500' : 'bg-slate-200 group-hover:bg-slate-300'}`} />
              <span className={`mt-1.5 hidden text-[11.5px] font-medium sm:block ${key === step ? 'text-indigo-700' : 'text-slate-400'}`}>
                {i + 1}. {t(`setup.steps.${key}.short`)}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {!status && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {status && step === 'organization' && <OrganizationStep status={status} onDone={() => go('email')} />}
      {status && step === 'email' && <EmailStep status={status} onNext={() => go('template')} />}
      {status && step === 'template' && <TemplateStep status={status} onNext={() => go('team')} />}
      {status && step === 'team' && <TeamStep status={status} onNext={() => go('done')} />}
      {status && step === 'done' && <DoneStep status={status} onFinish={finish} />}
    </div>
  );
}

function StepHeader({ step }: { step: StepKey }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4">
      <h2 className="text-[18px] font-bold text-slate-900">{t(`setup.steps.${step}.title`)}</h2>
      <p className="text-[13.5px] text-slate-500">{t(`setup.steps.${step}.body`)}</p>
    </div>
  );
}

function Footer({ children, onSkip }: { children: ReactNode; onSkip?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      {onSkip ? (
        <button onClick={onSkip} className="text-[13px] font-medium text-slate-500 hover:text-slate-800">
          {t('setup.later')}
        </button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function ChoiceCard({ selected, onSelect, title, body, children }: { selected: boolean; onSelect: () => void; title: string; body?: string; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors ${
        selected ? 'border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-100' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <span className="text-[14px] font-semibold text-slate-800">{title}</span>
      {body && <span className="text-[12.5px] text-slate-500">{body}</span>}
      {children}
    </button>
  );
}

// -- 1. Organization --------------------------------------------------------

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function timezones(current: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    all = [];
  }
  return all.includes(current) ? all : [current, ...all];
}

function OrganizationStep({ status, onDone }: { status: SetupStatus; onDone: () => void }) {
  const { t } = useTranslation();
  const [tenantName, setTenantName] = useState(status.tenantName);
  const [language, setLang] = useState<'es' | 'en'>(status.language);
  const [timezone, setTimezone] = useState(status.businessHours?.timezone ?? browserTimezone());
  const [schedule, setSchedule] = useState<Schedule>(status.businessHours ? 'none' : 'office');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timezones(timezone), [timezone]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiPut('/setup/organization', { tenantName, language, timezone, schedule });
      setLanguage(language); // the console follows the workspace's language for the person setting it up
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('setup.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <StepHeader step="organization" />
      <div className="flex flex-col gap-5">
        <label className="block">
          <span className="mb-1 block text-[13px] font-semibold text-slate-700">{t('setup.organization.name')}</span>
          <input
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">{t('setup.organization.language')}</span>
          <div className="grid grid-cols-2 gap-2">
            <ChoiceCard selected={language === 'es'} onSelect={() => setLang('es')} title="Español" />
            <ChoiceCard selected={language === 'en'} onSelect={() => setLang('en')} title="English" />
          </div>
          <span className="mt-1 block text-[12px] text-slate-400">{t('setup.organization.languageHint')}</span>
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">{t('setup.organization.hours')}</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SCHEDULES.map((key) => (
              <ChoiceCard
                key={key}
                selected={schedule === key}
                onSelect={() => setSchedule(key)}
                title={t(`setup.schedules.${key}.title`)}
                body={key === 'none' && status.businessHours ? t('setup.schedules.keep') : t(`setup.schedules.${key}.body`)}
              />
            ))}
          </div>
          <label className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
            {t('setup.organization.timezone')}
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="max-w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px]"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
      <Footer>
        <Button onClick={save} isLoading={saving} disabled={!tenantName.trim()}>
          {t('setup.saveAndContinue')}
        </Button>
      </Footer>
    </Card>
  );
}

// -- 2. Email ----------------------------------------------------------------

function EmailStep({ status, onNext }: { status: SetupStatus; onNext: () => void }) {
  const { t } = useTranslation();
  const providers = [
    { key: 'microsoft_oauth', title: 'Microsoft 365 / Outlook' },
    { key: 'google_oauth', title: 'Google Workspace / Gmail' },
    { key: 'password', title: t('setup.email.other') },
  ];
  return (
    <Card>
      <StepHeader step="email" />
      {status.mailboxes > 0 ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13.5px] text-emerald-800">
          <CheckIcon width={16} height={16} />
          <span>{t('setup.email.connected', { count: status.mailboxes })}</span>
          <Link to="/email-channels?from=setup" className="ml-auto font-semibold hover:underline">
            {t('setup.email.manage')}
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {providers.map((p) => (
              <Link
                key={p.key}
                to={`/email-channels?new=${p.key}&from=setup`}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] font-semibold text-slate-800 hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                {p.title}
                <span className="block text-[12px] font-normal text-slate-500">
                  {p.key === 'password' ? t('setup.email.passwordHint') : t('setup.email.oauthHint')}
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-slate-500">{t('setup.email.why')}</p>
        </>
      )}
      <Footer onSkip={status.mailboxes > 0 ? undefined : onNext}>
        <Button onClick={onNext} variant={status.mailboxes > 0 ? 'primary' : 'secondary'}>
          {t('setup.continue')}
        </Button>
      </Footer>
    </Card>
  );
}

// -- 3. Template -------------------------------------------------------------

interface Created {
  teams: number;
  slaPolicies: number;
  macros: number;
  customFields: number;
  catalogItems: number;
}

function TemplateStep({ status, onNext }: { status: SetupStatus; onNext: () => void }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<TemplateKey | null>(status.template);
  const [created, setCreated] = useState<Created | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (!choice) return;
    setApplying(true);
    setError(null);
    try {
      const res = await apiPost<{ created: Created }>('/setup/template', { key: choice });
      setCreated(res.created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('setup.saveFailed'));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card>
      <StepHeader step="template" />
      <div className="flex flex-col gap-2.5">
        {TEMPLATES.map((key) => (
          <ChoiceCard key={key} selected={choice === key} onSelect={() => setChoice(key)} title={t(`setup.templates.${key}.title`)} body={t(`setup.templates.${key}.body`)}>
            <span className="mt-2 flex flex-wrap gap-1.5">
              {(t(`setup.templates.${key}.includes`, { returnObjects: true }) as string[]).map((item) => (
                <span key={item} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] text-slate-600">
                  {item}
                </span>
              ))}
            </span>
          </ChoiceCard>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] text-slate-500">{t('setup.template.note')}</p>

      {created && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          {t('setup.template.created', { ...created })}
        </div>
      )}
      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

      <Footer onSkip={created ? undefined : onNext}>
        {!created ? (
          <Button onClick={apply} isLoading={applying} disabled={!choice}>
            {t('setup.template.apply')}
          </Button>
        ) : (
          <Button onClick={onNext}>{t('setup.continue')}</Button>
        )}
      </Footer>
    </Card>
  );
}

// -- 4. Team -----------------------------------------------------------------

interface InviteResult {
  email: string;
  ok: boolean;
  message?: string;
}

/** "Ana Pérez <ana@x.cl>", "ana@x.cl" or "Ana Pérez, ana@x.cl" -- one person per line. */
function parsePeople(text: string): { name: string; email: string }[] {
  return text
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const email = line.match(/[^\s<>,;]+@[^\s<>,;]+/)?.[0] ?? '';
      const name = line.replace(email, '').replace(/[<>,]/g, ' ').trim() || email.split('@')[0];
      return { name, email };
    })
    .filter((p) => p.email);
}

function TeamStep({ status, onNext }: { status: SetupStatus; onNext: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [roleKey, setRoleKey] = useState('agent');
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState('');
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [sending, setSending] = useState(false);
  const people = parsePeople(text);
  const canInvite = status.mailboxes > 0;

  useEffect(() => {
    apiGet<{ teams: Team[] }>('/teams').then((r) => setTeams(r.teams)).catch(() => {});
  }, []);

  async function invite() {
    setSending(true);
    const out: InviteResult[] = [];
    const newIds: string[] = [];
    for (const person of people) {
      try {
        const user = await apiPost<{ id: string }>('/users', { ...person, invite: true, roleKey });
        newIds.push(user.id);
        out.push({ email: person.email, ok: true });
      } catch (err) {
        out.push({ email: person.email, ok: false, message: err instanceof ApiError ? err.message : '' });
      }
    }
    const team = teams.find((tm) => tm.id === teamId);
    if (team && newIds.length > 0) {
      await apiPatch(`/teams/${team.id}`, { memberIds: [...(team.memberIds ?? []), ...newIds] }).catch(() => {});
    }
    setResults(out);
    setText('');
    setSending(false);
  }

  return (
    <Card>
      <StepHeader step="team" />
      {!canInvite && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          {t('setup.team.needsMailbox')}{' '}
          <Link to="/users" className="font-semibold hover:underline">
            {t('setup.team.usersPage')}
          </Link>
        </p>
      )}
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold text-slate-700">{t('setup.team.people')}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          disabled={!canInvite}
          placeholder={'Ana Pérez <ana@empresa.cl>\nbruno@empresa.cl'}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
        />
        <span className="mt-1 block text-[12px] text-slate-400">{t('setup.team.peopleHint', { count: people.length })}</span>
      </label>
      <div className="mt-3 flex flex-wrap gap-3">
        <label className="text-[13px] text-slate-600">
          {t('setup.team.role')}{' '}
          <select value={roleKey} onChange={(e) => setRoleKey(e.target.value)} disabled={!canInvite} className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px]">
            <option value="agent">{t('roles.builtin.agent')}</option>
            <option value="team_lead">{t('roles.builtin.team_lead')}</option>
            <option value="admin">{t('roles.builtin.admin')}</option>
          </select>
        </label>
        {teams.length > 0 && (
          <label className="text-[13px] text-slate-600">
            {t('setup.team.team')}{' '}
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={!canInvite} className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px]">
              <option value="">{t('setup.team.noTeam')}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {results && (
        <ul className="mt-4 space-y-1 text-[13px]">
          {results.map((r) => (
            <li key={r.email} className={r.ok ? 'text-emerald-700' : 'text-rose-600'}>
              {r.ok ? '✓' : '✗'} {r.email}
              {!r.ok && r.message ? ` — ${r.message}` : ''}
            </li>
          ))}
        </ul>
      )}

      <Footer onSkip={onNext}>
        <Button variant="secondary" onClick={invite} isLoading={sending} disabled={!canInvite || people.length === 0}>
          {t('setup.team.invite', { count: people.length })}
        </Button>
        <Button onClick={onNext}>{t('setup.continue')}</Button>
      </Footer>
    </Card>
  );
}

// -- 5. Done -----------------------------------------------------------------

function DoneStep({ status, onFinish }: { status: SetupStatus; onFinish: () => void }) {
  const { t } = useTranslation();
  const checks = [
    { key: 'organization', done: true },
    { key: 'hours', done: Boolean(status.businessHours) },
    { key: 'email', done: status.mailboxes > 0 },
    { key: 'template', done: Boolean(status.template) },
    { key: 'team', done: status.users > 1 },
  ];
  const next = [
    { to: '/devices', key: 'agent' },
    { to: '/customer-portal', key: 'portal' },
    { to: '/customer-emails', key: 'emails' },
    { to: '/appearance', key: 'appearance' },
  ];
  return (
    <Card>
      <StepHeader step="done" />
      <ul className="mb-6 space-y-2">
        {checks.map((c) => (
          <li key={c.key} className="flex items-center gap-2.5 text-[14px]">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${c.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
              {c.done ? <CheckIcon width={12} height={12} /> : '·'}
            </span>
            <span className={c.done ? 'text-slate-800' : 'text-slate-500'}>{t(`setup.done.checks.${c.key}`)}</span>
          </li>
        ))}
      </ul>
      <h3 className="mb-2 text-[13px] font-semibold text-slate-700">{t('setup.done.nextTitle')}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {next.map((n) => (
          <Link key={n.key} to={n.to} className="rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50/50">
            <span className="block text-[13.5px] font-semibold text-slate-800">{t(`setup.done.next.${n.key}.title`)}</span>
            <span className="block text-[12.5px] text-slate-500">{t(`setup.done.next.${n.key}.body`)}</span>
          </Link>
        ))}
      </div>
      <Footer>
        <Button onClick={onFinish}>{t('setup.done.finish')}</Button>
      </Footer>
    </Card>
  );
}
