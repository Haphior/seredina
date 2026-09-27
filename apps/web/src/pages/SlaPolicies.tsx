import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPut, ApiError } from '../lib/api';
import type { SlaPolicy, TicketPriority } from '../lib/types';
import { PRIORITY_TONE } from '../lib/format';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

type Unit = 'min' | 'h' | 'd';
const UNIT_MINUTES: Record<Unit, number> = { min: 1, h: 60, d: 1440 };

interface Duration {
  value: string;
  unit: Unit;
}

interface RowState {
  firstResponse: Duration;
  resolution: Duration;
  businessHoursOnly: boolean;
}

/** A common starting point for a help desk; one click fills every empty row with it. */
const SUGGESTED: Record<TicketPriority, { firstResponse: number; resolution: number }> = {
  URGENT: { firstResponse: 15, resolution: 4 * 60 },
  HIGH: { firstResponse: 60, resolution: 8 * 60 },
  NORMAL: { firstResponse: 4 * 60, resolution: 2 * 1440 },
  LOW: { firstResponse: 8 * 60, resolution: 5 * 1440 },
};

/** Minutes shown in the largest unit that divides them evenly: 480 -> 8 h, 2880 -> 2 d. */
function toDuration(minutes: number): Duration {
  if (minutes % 1440 === 0) return { value: String(minutes / 1440), unit: 'd' };
  if (minutes % 60 === 0) return { value: String(minutes / 60), unit: 'h' };
  return { value: String(minutes), unit: 'min' };
}

function toMinutes(d: Duration): number | null {
  const n = Number(d.value.replace(',', '.'));
  if (!d.value.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * UNIT_MINUTES[d.unit]);
}

const EMPTY_ROW: RowState = {
  firstResponse: { value: '', unit: 'h' },
  resolution: { value: '', unit: 'h' },
  businessHoursOnly: false,
};

export function SlaPolicies() {
  const { t } = useTranslation();
  const [policies, setPolicies] = useState<SlaPolicy[] | null>(null);
  const [rows, setRows] = useState<Record<TicketPriority, RowState>>({ LOW: EMPTY_ROW, NORMAL: EMPTY_ROW, HIGH: EMPTY_ROW, URGENT: EMPTY_ROW });
  const [dirty, setDirty] = useState<Set<TicketPriority>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function load() {
    apiGet<{ slaPolicies: SlaPolicy[] }>('/sla-policies')
      .then((res) => {
        setPolicies(res.slaPolicies);
        const next = { LOW: EMPTY_ROW, NORMAL: EMPTY_ROW, HIGH: EMPTY_ROW, URGENT: EMPTY_ROW } as Record<TicketPriority, RowState>;
        for (const p of res.slaPolicies) {
          next[p.priority] = {
            firstResponse: toDuration(p.firstResponseMinutes),
            resolution: toDuration(p.resolutionMinutes),
            businessHoursOnly: p.businessHoursOnly,
          };
        }
        setRows(next);
        setDirty(new Set());
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('sla.loadFailed')));
  }

  useEffect(load, []);

  function updateRow(priority: TicketPriority, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [priority]: { ...prev[priority], ...patch } }));
    setDirty((prev) => new Set(prev).add(priority));
    setSaved(false);
  }

  function fillSuggested() {
    for (const priority of PRIORITIES) {
      const row = rows[priority];
      if (row.firstResponse.value || row.resolution.value) continue;
      updateRow(priority, {
        firstResponse: toDuration(SUGGESTED[priority].firstResponse),
        resolution: toDuration(SUGGESTED[priority].resolution),
      });
    }
  }

  const invalid = PRIORITIES.filter((p) => {
    if (!dirty.has(p)) return false;
    const row = rows[p];
    const empty = !row.firstResponse.value && !row.resolution.value;
    return !empty && (toMinutes(row.firstResponse) === null || toMinutes(row.resolution) === null);
  });

  async function saveAll() {
    setError(null);
    setSaving(true);
    try {
      for (const priority of PRIORITIES) {
        if (!dirty.has(priority)) continue;
        const row = rows[priority];
        const firstResponseMinutes = toMinutes(row.firstResponse);
        const resolutionMinutes = toMinutes(row.resolution);
        if (firstResponseMinutes === null || resolutionMinutes === null) continue; // an untouched empty row
        await apiPut('/sla-policies', { priority, firstResponseMinutes, resolutionMinutes, businessHoursOnly: row.businessHoursOnly });
      }
      load();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sla.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(priority: TicketPriority) {
    const existing = policies?.find((p) => p.priority === priority);
    if (!existing) return;
    if (!confirm(t('sla.confirmRemove', { priority: t(`priority.${priority}`) }))) return;
    try {
      await apiDelete(`/sla-policies/${existing.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sla.removeFailed'));
    }
  }

  const anyEmpty = PRIORITIES.some((p) => !rows[p].firstResponse.value && !rows[p].resolution.value);

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('sla.title')}</h1>
        {policies !== null && anyEmpty && (
          <Button variant="secondary" size="sm" onClick={fillSuggested}>
            {t('sla.useSuggested')}
          </Button>
        )}
      </div>
      <p className="mb-5 max-w-3xl text-[13.5px] text-slate-500">{t('sla.intro')}</p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {policies === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {policies !== null && (
        <>
          <div className="flex flex-col gap-2.5">
            {PRIORITIES.map((priority) => {
              const row = rows[priority];
              const configured = policies.some((p) => p.priority === priority);
              const label = t(`priority.${priority}`);
              return (
                <Card key={priority} className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <span className="w-24 flex-shrink-0">
                    <Badge tone={PRIORITY_TONE[priority]} dot>
                      {label}
                    </Badge>
                  </span>

                  <DurationField
                    label={t('sla.firstResponse')}
                    ariaLabel={t('sla.firstResponseAria', { priority: label })}
                    value={row.firstResponse}
                    placeholder={toDuration(SUGGESTED[priority].firstResponse).value}
                    onChange={(firstResponse) => updateRow(priority, { firstResponse })}
                  />
                  <DurationField
                    label={t('sla.resolution')}
                    ariaLabel={t('sla.resolutionAria', { priority: label })}
                    value={row.resolution}
                    placeholder={toDuration(SUGGESTED[priority].resolution).value}
                    onChange={(resolution) => updateRow(priority, { resolution })}
                  />

                  <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={row.businessHoursOnly}
                      onChange={(e) => updateRow(priority, { businessHoursOnly: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-100"
                    />
                    {t('sla.businessHoursOnly')}
                  </label>

                  <div className="ml-auto flex items-center gap-3">
                    {!configured && <span className="text-[12px] text-slate-400">{t('sla.noTarget')}</span>}
                    {configured && (
                      <button onClick={() => remove(priority)} className="text-xs text-slate-400 hover:text-rose-600">
                        {t('sla.remove')}
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={saveAll} isLoading={saving} disabled={dirty.size === 0 || invalid.length > 0}>
              {saving ? t('common.saving') : t('sla.saveChanges')}
            </Button>
            {invalid.length > 0 && <span className="text-[12.5px] text-rose-600">{t('sla.bothNeeded')}</span>}
            {saved && dirty.size === 0 && <span className="text-[12.5px] text-emerald-600">{t('sla.saved')}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function DurationField({
  label,
  ariaLabel,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: Duration;
  placeholder: string;
  onChange: (value: Duration) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        value={value.value}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
        placeholder={placeholder}
        className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
      <select
        aria-label={`${ariaLabel} (${t('sla.unit')})`}
        value={value.unit}
        onChange={(e) => onChange({ ...value, unit: e.target.value as Unit })}
        className="rounded-lg border border-slate-200 bg-white px-1.5 py-1.5 text-[13px]"
      >
        <option value="min">{t('sla.units.min')}</option>
        <option value="h">{t('sla.units.h')}</option>
        <option value="d">{t('sla.units.d')}</option>
      </select>
    </div>
  );
}
