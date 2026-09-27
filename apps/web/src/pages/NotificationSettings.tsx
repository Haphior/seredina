import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPut, ApiError } from '../lib/api';
import type { NotificationEventType, NotificationPreference } from '../lib/types';
import { useAuth } from '../auth/AuthContext';

type Row = Pick<NotificationPreference, 'eventType' | 'label' | 'inApp' | 'email'> & { source?: NotificationPreference['source'] };

/** Event types grouped the way people think about them. */
const GROUPS: { key: string; events: NotificationEventType[] }[] = [
  { key: 'tickets', events: ['TICKET_ASSIGNED', 'NEW_REPLY', 'TEAM_TICKET', 'TICKET_REOPENED', 'MENTIONED'] },
  { key: 'sla', events: ['SLA_WARNING', 'SLA_BREACHED'] },
  { key: 'assets', events: ['CONTRACT_EXPIRING'] },
];

export function NotificationSettings() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canSetDefaults = hasPermission('users:manage');
  const [preferences, setPreferences] = useState<Row[] | null>(null);
  const [defaults, setDefaults] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiGet<{ preferences: Row[] }>('/notification-preferences')
      .then((res) => setPreferences(res.preferences))
      .catch((err) => setError(err instanceof ApiError ? err.message : t('notificationSettings.loadFailed')));
    if (canSetDefaults) {
      apiGet<{ defaults: Row[] }>('/notification-defaults')
        .then((res) => setDefaults(res.defaults))
        .catch((err) => setError(err instanceof ApiError ? err.message : t('notificationSettings.loadFailed')));
    }
  }

  useEffect(load, [canSetDefaults]);

  async function toggle(eventType: NotificationEventType, field: 'inApp' | 'email', value: boolean) {
    setPreferences((prev) => prev?.map((p) => (p.eventType === eventType ? { ...p, [field]: value, source: 'user' } : p)) ?? null);
    try {
      await apiPut(`/notification-preferences/${eventType}`, { [field]: value });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('notificationSettings.saveFailed'));
      load();
    }
  }

  async function reset(eventType: NotificationEventType) {
    try {
      await apiDelete(`/notification-preferences/${eventType}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('notificationSettings.saveFailed'));
    }
  }

  async function toggleDefault(eventType: NotificationEventType, field: 'inApp' | 'email', value: boolean) {
    setDefaults((prev) => prev?.map((p) => (p.eventType === eventType ? { ...p, [field]: value } : p)) ?? null);
    try {
      await apiPut(`/notification-defaults/${eventType}`, { [field]: value });
      // Whoever follows the default (possibly me) now gets the new value.
      apiGet<{ preferences: Row[] }>('/notification-preferences').then((res) => setPreferences(res.preferences));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('notificationSettings.saveFailed'));
      load();
    }
  }

  return (
    <div className="px-8 py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('notificationSettings.title')}</h1>
      <p className="mb-6 max-w-3xl text-[13.5px] text-slate-500">{t('notificationSettings.intro')}</p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {preferences === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {preferences && (
        <PreferenceTable
          rows={preferences}
          onToggle={toggle}
          renderNote={(p) =>
            p.source === 'user' ? (
              <button onClick={() => reset(p.eventType)} className="text-[11.5px] text-slate-400 hover:text-indigo-600">
                {t('notificationSettings.useDefault')}
              </button>
            ) : p.source === 'workspace' ? (
              <span className="text-[11.5px] text-slate-400">{t('notificationSettings.fromWorkspace')}</span>
            ) : null
          }
        />
      )}

      {canSetDefaults && defaults && (
        <section className="mt-10">
          <h2 className="mb-1 text-[16px] font-bold text-slate-900">{t('notificationSettings.defaultsTitle')}</h2>
          <p className="mb-4 max-w-3xl text-[13px] text-slate-500">{t('notificationSettings.defaultsIntro')}</p>
          <PreferenceTable rows={defaults} onToggle={toggleDefault} />
        </section>
      )}
    </div>
  );
}

function PreferenceTable({
  rows,
  onToggle,
  renderNote,
}: {
  rows: Row[];
  onToggle: (eventType: NotificationEventType, field: 'inApp' | 'email', value: boolean) => void;
  renderNote?: (row: Row) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const byType = new Map(rows.map((r) => [r.eventType, r]));
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-[1fr_72px_72px] items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-400 sm:grid-cols-[1fr_90px_90px]">
        <span>{t('notificationSettings.event')}</span>
        <span>{t('notificationSettings.inApp')}</span>
        <span>{t('notificationSettings.email')}</span>
      </div>
      {GROUPS.map((group) => {
        const groupRows = group.events.map((e) => byType.get(e)).filter((r): r is Row => Boolean(r));
        if (groupRows.length === 0) return null;
        return (
          <div key={group.key}>
            <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {t(`notificationSettings.groups.${group.key}`)}
            </div>
            <div className="divide-y divide-slate-100">
              {groupRows.map((p) => {
                const label = t(`notificationSettings.events.${p.eventType}`, { defaultValue: p.label });
                return (
                  <div key={p.eventType} className="grid grid-cols-[1fr_72px_72px] items-center gap-3 px-5 py-3 sm:grid-cols-[1fr_90px_90px]">
                    <span className="min-w-0">
                      <span className="block text-[13.5px] text-slate-700">{label}</span>
                      {renderNote?.(p)}
                    </span>
                    <input
                      type="checkbox"
                      aria-label={`${label}: ${t('notificationSettings.inApp')}`}
                      checked={p.inApp}
                      onChange={(e) => onToggle(p.eventType, 'inApp', e.target.checked)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <input
                      type="checkbox"
                      aria-label={`${label}: ${t('notificationSettings.email')}`}
                      checked={p.email}
                      onChange={(e) => onToggle(p.eventType, 'email', e.target.checked)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
