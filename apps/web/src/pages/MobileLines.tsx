import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Asset, Contract, MobileLine, MobileLineStatus, Organization } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { SearchPicker, type PickerOption } from '../components/SearchPicker';
import { Select } from '../components/Select';
import { Textarea } from '../components/Textarea';
import { SearchIcon } from '../components/icons';

const STATUSES: MobileLineStatus[] = ['ACTIVE', 'SUSPENDED', 'CANCELLED'];
const STATUS_TONE: Record<MobileLineStatus, 'emerald' | 'amber' | 'slate'> = { ACTIVE: 'emerald', SUSPENDED: 'amber', CANCELLED: 'slate' };

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function money(amount: number, currency: string | null, lang: string) {
  try {
    return currency ? new Intl.NumberFormat(lang, { style: 'currency', currency }).format(amount) : amount.toLocaleString(lang);
  } catch {
    return `${amount} ${currency ?? ''}`;
  }
}

/**
 * Phone lines: the number, its carrier and plan, what it costs, which phone
 * it's in and who has it -- docs/adr/0078-mobile-inventory.md. Billing and
 * payment reminders live on the carrier's contract.
 */
export function MobileLines() {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('assets:manage');
  const [lines, setLines] = useState<MobileLine[] | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MobileLineStatus | ''>('ACTIVE');
  const [editing, setEditing] = useState<MobileLine | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (search.trim()) q.set('search', search.trim());
    if (status) q.set('status', status);
    apiGet<{ lines: MobileLine[] }>(`/mobile-lines?${q}`)
      .then((r) => setLines(r.lines))
      .catch((err) => setError(errorText(err, t('mobileLines.loadFailed'))));
  }, [search, status, t]);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  // What the lines shown cost a month, per currency.
  const totals = useMemo(() => {
    const sums = new Map<string, number>();
    for (const l of lines ?? []) {
      if (l.monthlyCost == null || l.status === 'CANCELLED') continue;
      const key = l.currency ?? '';
      sums.set(key, (sums.get(key) ?? 0) + l.monthlyCost);
    }
    return [...sums.entries()].map(([currency, amount]) => money(amount, currency || null, i18n.language));
  }, [lines, i18n.language]);

  async function remove(line: MobileLine) {
    if (!confirm(t('mobileLines.confirmDelete', { number: line.phoneNumber }))) return;
    try {
      await apiDelete(`/mobile-lines/${line.id}`);
      load();
    } catch (err) {
      setError(errorText(err, t('mobileLines.deleteFailed')));
    }
  }

  return (
    <div className="px-4 py-5 md:px-8 md:py-7">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('mobileLines.title')}</h1>
        {canManage && <Button onClick={() => setEditing('new')}>{t('mobileLines.new')}</Button>}
      </div>
      <p className="mb-5 max-w-3xl text-[13.5px] text-slate-500">{t('mobileLines.intro')}</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" width={15} height={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('mobileLines.searchPlaceholder')}
            aria-label={t('mobileLines.searchPlaceholder')}
            className="w-full rounded-md border border-slate-200 py-1.5 pl-8 pr-3 text-[13px] focus:border-indigo-400 focus:outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as MobileLineStatus | '')}
          aria-label={t('mobileLines.status')}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-[13px]"
        >
          <option value="">{t('mobileLines.anyStatus')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`mobileLines.statuses.${s}`)}
            </option>
          ))}
        </select>
        {totals.length > 0 && (
          <span className="text-[12.5px] text-slate-500">{t('mobileLines.monthlyTotal', { total: totals.join(' + ') })}</span>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      {lines === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {lines?.length === 0 && <p className="text-sm text-slate-500">{t('mobileLines.empty')}</p>}

      {lines && lines.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2.5">{t('mobileLines.number')}</th>
                <th className="px-4 py-2.5">{t('mobileLines.carrier')}</th>
                <th className="px-4 py-2.5">{t('mobileLines.plan')}</th>
                <th className="px-4 py-2.5">{t('mobileLines.monthlyCost')}</th>
                <th className="px-4 py-2.5">{t('mobileLines.phone')}</th>
                <th className="px-4 py-2.5">{t('mobileLines.assignedTo')}</th>
                <th className="px-4 py-2.5">{t('mobileLines.status')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-800">{l.phoneNumber}</td>
                  <td className="px-4 py-2.5 text-slate-600">{l.carrier?.name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {l.plan ?? '—'}
                    {l.dataAllowance && <span className="text-slate-400"> · {l.dataAllowance}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                    {l.monthlyCost == null ? '—' : money(l.monthlyCost, l.currency, i18n.language)}
                  </td>
                  <td className="px-4 py-2.5">
                    {l.asset ? (
                      <Link to={`/assets/${l.asset.id}`} className="text-indigo-700 hover:underline">
                        {l.asset.name}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {l.assignedContact ? (
                      <Link to={`/contacts/${l.assignedContact.id}`} className="text-indigo-700 hover:underline">
                        {l.assignedContact.name}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[l.status]} dot>
                      {t(`mobileLines.statuses.${l.status}`)}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs">
                    {canManage && (
                      <>
                        <button onClick={() => setEditing(l)} className="mr-3 font-semibold text-indigo-600 hover:underline">
                          {t('mobileLines.editAction')}
                        </button>
                        <button onClick={() => remove(l)} className="text-slate-400 hover:text-rose-600">
                          {t('mobileLines.deleteAction')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing && (
        <LineModal
          line={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function LineModal({ line, onClose, onSaved }: { line: MobileLine | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({
    phoneNumber: line?.phoneNumber ?? '',
    status: line?.status ?? ('ACTIVE' as MobileLineStatus),
    carrierId: line?.carrierId ?? '',
    plan: line?.plan ?? '',
    dataAllowance: line?.dataAllowance ?? '',
    monthlyCost: line?.monthlyCost == null ? '' : String(line.monthlyCost),
    currency: line?.currency ?? 'CLP',
    iccid: line?.iccid ?? '',
    contractEndDate: line?.contractEndDate?.slice(0, 10) ?? '',
    contractId: line?.contractId ?? '',
    notes: line?.notes ?? '',
  });
  const [phone, setPhone] = useState<PickerOption | null>(line?.asset ?? null);
  const [person, setPerson] = useState<PickerOption | null>(line?.assignedContact ?? null);
  const [carriers, setCarriers] = useState<Organization[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));

  useEffect(() => {
    apiGet<{ organizations: Organization[] }>('/organizations')
      .then((r) => setCarriers(r.organizations))
      .catch(() => {});
    apiGet<{ contracts: Contract[] }>('/contracts')
      .then((r) => setContracts(r.contracts))
      .catch(() => {});
  }, []);

  const searchPhones = useCallback(
    (q: string) =>
      apiGet<{ assets: Asset[] }>(`/assets?q=${encodeURIComponent(q)}&group=computers&limit=20`).then((r) =>
        r.assets
          .filter((a) => a.assetType === 'MOBILE_DEVICE' || a.assetType === 'TABLET')
          .slice(0, 8)
          .map((a) => ({ id: a.id, name: a.name, hint: a.assignedContact?.name ?? t(`assetType.${a.assetType}`) })),
      ),
    [t],
  );
  const searchContacts = useCallback(
    (q: string) =>
      apiGet<{ contacts: { id: string; name: string; email: string }[] }>(`/contacts?search=${encodeURIComponent(q)}`).then((r) =>
        r.contacts.slice(0, 8).map((c) => ({ id: c.id, name: c.name, hint: c.email })),
      ),
    [],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const body = {
      phoneNumber: f.phoneNumber,
      status: f.status,
      carrierId: f.carrierId || null,
      plan: f.plan || null,
      dataAllowance: f.dataAllowance || null,
      monthlyCost: f.monthlyCost === '' ? null : Number(f.monthlyCost),
      currency: f.currency ? f.currency.toUpperCase() : null,
      iccid: f.iccid || null,
      contractEndDate: f.contractEndDate || null,
      contractId: f.contractId || null,
      assetId: phone?.id ?? null,
      assignedContactId: person?.id ?? null,
      notes: f.notes || null,
    };
    try {
      if (line) await apiPatch(`/mobile-lines/${line.id}`, body);
      else await apiPost('/mobile-lines', body);
      onSaved();
    } catch (err) {
      setError(errorText(err, t('mobileLines.saveFailed')));
      setSaving(false);
    }
  }

  return (
    <Modal title={line ? t('mobileLines.edit') : t('mobileLines.new')} onClose={onClose}>
      <form onSubmit={submit} className="max-h-[74vh] space-y-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-2">
          <Input label={t('mobileLines.number')} placeholder="+56 9 1234 5678" value={f.phoneNumber} onChange={set('phoneNumber')} required />
          <Select label={t('mobileLines.status')} value={f.status} onChange={set('status')}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`mobileLines.statuses.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select label={t('mobileLines.carrier')} value={f.carrierId} onChange={set('carrierId')}>
            <option value="">—</option>
            {carriers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Input label={t('mobileLines.iccid')} inputMode="numeric" value={f.iccid} onChange={set('iccid')} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label={t('mobileLines.plan')} placeholder={t('mobileLines.planPlaceholder')} value={f.plan} onChange={set('plan')} />
          <Input label={t('mobileLines.dataAllowance')} placeholder="30 GB" value={f.dataAllowance} onChange={set('dataAllowance')} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Input label={t('mobileLines.monthlyCost')} type="number" min={0} step="0.01" value={f.monthlyCost} onChange={set('monthlyCost')} />
          <Input label={t('mobileLines.currency')} maxLength={3} value={f.currency} onChange={set('currency')} />
          <Input label={t('mobileLines.contractEnd')} type="date" value={f.contractEndDate} onChange={set('contractEndDate')} />
        </div>
        {contracts.length > 0 && (
          <div>
            <Select label={t('mobileLines.contract')} value={f.contractId} onChange={set('contractId')}>
              <option value="">—</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[11.5px] text-slate-400">{t('mobileLines.contractHint')}</p>
          </div>
        )}
        <SearchPicker label={t('mobileLines.phone')} value={phone} onChange={setPhone} search={searchPhones} placeholder={t('mobileLines.phonePlaceholder')} />
        <SearchPicker label={t('mobileLines.assignedTo')} value={person} onChange={setPerson} search={searchContacts} />
        <Textarea label={t('mobileLines.notes')} rows={2} value={f.notes} onChange={set('notes')} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
