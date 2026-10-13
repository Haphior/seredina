import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from '../lib/api';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { formatDateTime } from '../lib/format';

interface Source {
  id: string;
  name: string;
  type: 'github' | 'git';
  location: string;
  hasToken: boolean;
  includePrereleases?: boolean;
  builtin: boolean;
}

interface Release {
  version: string;
  name: string | null;
  notes: string | null;
  publishedAt: string | null;
  url: string | null;
  prerelease: boolean;
}

interface CheckResult {
  checkedAt: string;
  sourceId: string;
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releases: Release[];
}

interface UpdaterStatus {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  target: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  checkout: string | null;
}

interface UpdatesView {
  current: string;
  sources: Source[];
  activeId: string;
  lastCheck: CheckResult | null;
  updater: { enabled: boolean; reachable: boolean; status: UpdaterStatus | null };
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Settings → Updates (docs/adr/0077-in-app-updates.md): which version runs,
 * what's newer at the chosen source (GitHub by default), and -- with the
 * updater service enabled -- installing it with a backup first.
 */
export function Updates() {
  const { t } = useTranslation();
  const [view, setView] = useState<UpdatesView | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [editing, setEditing] = useState<Source | 'new' | null>(null);
  const [confirming, setConfirming] = useState<Release | null>(null);
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(() => {
    apiGet<UpdatesView>('/system/updates')
      .then((v) => {
        setView(v);
        setCheck((c) => c ?? v.lastCheck);
        setStatus(v.updater.status);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setUnavailable(err.message);
        else setError(errorText(err, t('updates.loadFailed')));
      });
  }, [t]);
  useEffect(load, [load]);

  async function runCheck() {
    setChecking(true);
    setError(null);
    try {
      setCheck(await apiPost<CheckResult>('/system/updates/check'));
    } catch (err) {
      setError(errorText(err, t('updates.checkFailed')));
    } finally {
      setChecking(false);
    }
  }

  // While an update runs, the API itself restarts: polling carries on
  // through the gap and picks the result up when it's back.
  useEffect(() => {
    if (status?.state !== 'running') return;
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await apiGet<{ status: UpdaterStatus | null }>('/system/updates/status');
        setApiDown(false);
        if (r.status) setStatus(r.status);
        if (r.status && r.status.state !== 'running') load();
      } catch {
        setApiDown(true);
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [status?.state, load]);

  async function install(release: Release) {
    setConfirming(null);
    setError(null);
    try {
      setStatus(await apiPost<UpdaterStatus>('/system/updates/apply', { version: release.version }));
    } catch (err) {
      setError(errorText(err, t('updates.applyFailed')));
    }
  }

  async function setActive(id: string) {
    try {
      const r = await apiPut<{ sources: Source[]; activeId: string }>('/system/updates/active-source', { id });
      setView((v) => (v ? { ...v, ...r } : v));
      setCheck(null);
    } catch (err) {
      setError(errorText(err, t('updates.saveFailed')));
    }
  }

  async function removeSource(s: Source) {
    if (!confirm(t('updates.confirmRemoveSource', { name: s.name }))) return;
    try {
      const r = await apiDelete<{ sources: Source[]; activeId: string }>(`/system/updates/sources/${s.id}`);
      setView((v) => (v ? { ...v, ...r } : v));
    } catch (err) {
      setError(errorText(err, t('updates.saveFailed')));
    }
  }

  if (unavailable) {
    return (
      <div className="max-w-3xl px-8 py-7">
        <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('updates.title')}</h1>
        <p className="text-[13.5px] text-slate-500">{t('updates.cloudOnly')}</p>
      </div>
    );
  }

  const running = status?.state === 'running';
  const newer = check?.releases.filter((r) => r.version !== check.current) ?? [];

  return (
    <div className="max-w-4xl px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('updates.title')}</h1>
      <p className="mb-5 max-w-3xl text-[13.5px] text-slate-500">{t('updates.intro')}</p>
      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {!view && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {view && (
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-400">{t('updates.running')}</p>
                <p className="text-[24px] font-extrabold text-slate-900">{view.current}</p>
                {check && (
                  <p className="text-[12.5px] text-slate-500">
                    {check.updateAvailable ? (
                      <Badge tone="indigo" dot>
                        {t('updates.available', { version: check.latest })}
                      </Badge>
                    ) : (
                      <Badge tone="emerald" dot>
                        {t('updates.upToDate')}
                      </Badge>
                    )}{' '}
                    {t('updates.checkedAt', { date: formatDateTime(check.checkedAt) })}
                  </p>
                )}
              </div>
              <Button onClick={runCheck} isLoading={checking} disabled={running}>
                {t('updates.check')}
              </Button>
            </div>
          </Card>

          {status && status.state !== 'idle' && (
            <Card className="p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[15px] font-bold text-slate-800">{t('updates.progressTitle', { version: status.target })}</h2>
                <Badge tone={status.state === 'running' ? 'sky' : status.state === 'succeeded' ? 'emerald' : 'rose'} dot>
                  {t(`updates.state.${status.state}`)}
                </Badge>
              </div>
              {running && <p className="mb-2 text-[12.5px] text-slate-500">{apiDown ? t('updates.restarting') : t('updates.runningHint')}</p>}
              {status.state === 'succeeded' && <p className="mb-2 text-[12.5px] text-emerald-700">{t('updates.succeededHint')}</p>}
              {status.state === 'failed' && <p className="mb-2 text-[12.5px] text-rose-700">{t('updates.failedHint')}</p>}
              <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[12px] leading-5 text-slate-100">{status.log.join('\n') || '…'}</pre>
            </Card>
          )}

          {check && (
            <Card className="p-5">
              <h2 className="mb-3 text-[15px] font-bold text-slate-800">
                {newer.length ? t('updates.newReleases', { count: newer.length }) : t('updates.noNewReleases')}
              </h2>
              <div className="space-y-3">
                {newer.map((r, i) => (
                  <div key={r.version} className="rounded-lg border border-slate-200 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-bold text-slate-900">{r.version}</span>
                        {i === 0 && <Badge tone="indigo">{t('updates.latest')}</Badge>}
                        {r.prerelease && <Badge tone="amber">{t('updates.prerelease')}</Badge>}
                        {r.publishedAt && <span className="text-[12px] text-slate-400">{formatDateTime(r.publishedAt)}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-indigo-600 hover:underline">
                            {t('updates.viewNotes')}
                          </a>
                        )}
                        {view.updater.enabled && view.updater.reachable && (
                          <Button size="sm" onClick={() => setConfirming(r)} disabled={running}>
                            {t('updates.install')}
                          </Button>
                        )}
                      </div>
                    </div>
                    {r.notes && <ReleaseNotes notes={r.notes} />}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <UpdaterCard view={view} latest={check?.updateAvailable ? check.latest : null} />

          <Card className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-slate-800">{t('updates.sourcesTitle')}</h2>
              <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
                {t('updates.addSource')}
              </Button>
            </div>
            <p className="mb-3 text-[12.5px] text-slate-500">{t('updates.sourcesHint')}</p>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {view.sources.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-[13px]">
                  <label className="flex min-w-0 items-center gap-2.5">
                    <input type="radio" name="source" checked={view.activeId === s.id} onChange={() => setActive(s.id)} disabled={running} />
                    <span className="min-w-0">
                      <span className="font-semibold text-slate-800">{s.name}</span>
                      <span className="block truncate text-[12px] text-slate-400">
                        {t(`updates.type.${s.type}`)} · {s.location}
                        {s.hasToken ? ` · ${t('updates.withToken')}` : ''}
                      </span>
                    </span>
                  </label>
                  {s.builtin ? (
                    <Badge tone="slate">{t('updates.default')}</Badge>
                  ) : (
                    <span className="space-x-3 text-xs">
                      <button onClick={() => setEditing(s)} className="text-slate-400 hover:text-indigo-600">
                        {t('updates.edit')}
                      </button>
                      <button onClick={() => removeSource(s)} className="text-slate-400 hover:text-rose-600">
                        {t('updates.remove')}
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {editing && (
        <SourceModal
          source={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            setEditing(null);
            setView((v) => (v ? { ...v, ...r } : v));
          }}
        />
      )}

      {confirming && (
        <Modal title={t('updates.confirmTitle', { version: confirming.version })} onClose={() => setConfirming(null)}>
          <div className="space-y-3 text-[13.5px] text-slate-600">
            <p>{t('updates.confirmIntro', { from: view?.current, to: confirming.version })}</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>{t('updates.step1')}</li>
              <li>{t('updates.step2')}</li>
              <li>{t('updates.step3')}</li>
            </ol>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">{t('updates.confirmWarning')}</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => install(confirming)}>{t('updates.installNow')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Release notes as written (Markdown), shown as plain text, folded when long. */
function ReleaseNotes({ notes }: { notes: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const long = notes.length > 600;
  return (
    <div className="mt-2">
      <div className={`space-y-0.5 text-[12.5px] leading-5 text-slate-600 ${!open && long ? 'max-h-32 overflow-hidden' : ''}`}>
        {notes
          .replace(/\r\n/g, '\n')
          .trim()
          .split('\n')
          .map((raw, i) => {
            // Headings, list items and **bold** markers, as text: no HTML from
            // the release reaches the page.
            const line = raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
            const heading = /^#{1,6}\s+(.*)$/.exec(line);
            if (heading) return <p key={i} className="pt-1.5 font-bold text-slate-800">{heading[1]}</p>;
            const item = /^(\s*)[-*]\s+(.*)$/.exec(line);
            if (item) {
              return (
                <p key={i} className="flex gap-1.5" style={{ paddingLeft: item[1].length * 6 }}>
                  <span className="text-slate-400">•</span>
                  <span>{item[2]}</span>
                </p>
              );
            }
            return line.trim() ? <p key={i}>{line}</p> : <div key={i} className="h-1.5" />;
          })}
      </div>
      {long && (
        <button onClick={() => setOpen((o) => !o)} className="mt-1 text-[12px] font-semibold text-indigo-600 hover:underline">
          {open ? t('updates.showLess') : t('updates.showMore')}
        </button>
      )}
    </div>
  );
}

/** Whether the console can install updates, and if not, how to do it. */
function UpdaterCard({ view, latest }: { view: UpdatesView; latest: string | null }) {
  const { t } = useTranslation();
  const target = latest ?? 'vX.Y.Z';
  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-slate-800">{t('updates.updaterTitle')}</h2>
        {view.updater.enabled ? (
          view.updater.reachable ? (
            <Badge tone="emerald" dot>
              {t('updates.updaterOn')}
            </Badge>
          ) : (
            <Badge tone="rose" dot>
              {t('updates.updaterDown')}
            </Badge>
          )
        ) : (
          <Badge tone="slate">{t('updates.updaterOff')}</Badge>
        )}
      </div>
      {view.updater.enabled && view.updater.reachable ? (
        <p className="text-[12.5px] text-slate-500">
          {t('updates.updaterOnHint')}
          {view.updater.status?.checkout ? ` ${t('updates.checkout', { ref: view.updater.status.checkout })}` : ''}
        </p>
      ) : (
        <>
          <p className="mb-2 text-[12.5px] text-slate-500">{view.updater.enabled ? t('updates.updaterDownHint') : t('updates.updaterOffHint')}</p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-[12px] leading-5 text-slate-100">
            {view.updater.enabled
              ? 'docker compose --env-file .env -f infra/docker-compose.yml logs updater'
              : `# ${t('updates.enableComment')}\nbash scripts/enable-updater.sh\n\n# ${t('updates.manualComment')}\ngit fetch --tags && git checkout ${target}\ndocker compose --env-file .env -f infra/docker-compose.yml up -d --build`}
          </pre>
        </>
      )}
    </Card>
  );
}

function SourceModal({
  source,
  onClose,
  onSaved,
}: {
  source: Source | null;
  onClose: () => void;
  onSaved: (r: { sources: Source[]; activeId: string }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(source?.name ?? '');
  const [type, setType] = useState<'github' | 'git'>(source?.type ?? 'github');
  const [location, setLocation] = useState(source?.location ?? '');
  const [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [prereleases, setPrereleases] = useState(Boolean(source?.includePrereleases));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name,
      type,
      location,
      includePrereleases: prereleases,
      token: token ? token : clearToken ? null : source ? undefined : null,
    };
    try {
      onSaved(source ? await apiPut(`/system/updates/sources/${source.id}`, body) : await apiPost('/system/updates/sources', body));
    } catch (err) {
      setError(errorText(err, t('updates.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={source ? t('updates.editSource') : t('updates.addSource')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Input label={t('updates.sourceName')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('updates.sourceNamePlaceholder')} required />
        <Select label={t('updates.sourceType')} value={type} onChange={(e) => setType(e.target.value as 'github' | 'git')}>
          <option value="github">{t('updates.type.github')}</option>
          <option value="git">{t('updates.type.git')}</option>
        </Select>
        <Input
          label={type === 'github' ? t('updates.githubRepo') : t('updates.gitUrl')}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={type === 'github' ? 'mi-empresa/seredina' : 'https://git.empresa.cl/ti/seredina.git'}
          required
        />
        <Input
          label={t('updates.token')}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={source?.hasToken ? t('updates.tokenKept') : t('updates.tokenOptional')}
          autoComplete="new-password"
        />
        {source?.hasToken && (
          <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
            <input type="checkbox" checked={clearToken} onChange={(e) => setClearToken(e.target.checked)} />
            {t('updates.removeToken')}
          </label>
        )}
        <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
          <input type="checkbox" checked={prereleases} onChange={(e) => setPrereleases(e.target.checked)} />
          {t('updates.includePrereleases')}
        </label>
        <p className="text-[12px] text-slate-400">{type === 'git' ? t('updates.gitHint') : t('updates.githubHint')}</p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={saving}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
