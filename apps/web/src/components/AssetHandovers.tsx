import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, ApiError } from '../lib/api';
import type { AssetDetail, AssetHandover, HandoverKind, MobileLine } from '../lib/types';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { Input } from './Input';
import { Modal } from './Modal';
import { SearchPicker, type PickerOption } from './SearchPicker';
import { Select } from './Select';
import { Textarea } from './Textarea';

/**
 * Who had this equipment and when: deliveries and returns, each with a
 * printable handover form (docs/adr/0078-mobile-inventory.md). Recording one
 * moves the asset's assignee, so `onChange` reloads the asset.
 */
export function AssetHandovers({ asset, onChange }: { asset: AssetDetail; onChange: () => void }) {
  const { t } = useTranslation();
  const [handovers, setHandovers] = useState<AssetHandover[] | null>(null);
  const [recording, setRecording] = useState<HandoverKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    apiGet<{ handovers: AssetHandover[] }>(`/assets/${asset.id}/handovers`)
      .then((r) => setHandovers(r.handovers))
      .catch(() => setHandovers([]));
  }, [asset.id]);
  useEffect(load, [load]);

  async function remove(h: AssetHandover) {
    if (!confirm(t('handovers.confirmDelete'))) return;
    try {
      await apiDelete(`/handovers/${h.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('handovers.deleteFailed'));
    }
  }

  return (
    <Card>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-400">{t('handovers.title')}</h2>
        <div className="flex shrink-0 gap-2 text-[12px] font-semibold">
          <button onClick={() => setRecording('DELIVERY')} className="text-indigo-600 hover:underline">
            {t('handovers.deliver')}
          </button>
          {asset.assignedContact && (
            <button onClick={() => setRecording('RETURN')} className="text-indigo-600 hover:underline">
              {t('handovers.return')}
            </button>
          )}
        </div>
      </div>
      {error && <p className="mb-2 text-[12.5px] text-rose-600">{error}</p>}
      {handovers === null ? null : handovers.length === 0 ? (
        <p className="text-[13px] text-slate-400">{t('handovers.empty')}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {handovers.map((h) => (
            <div key={h.id} className="rounded-md bg-slate-50 px-2.5 py-1.5 text-[12.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Badge tone={h.kind === 'DELIVERY' ? 'indigo' : 'slate'}>{t(`handovers.kind.${h.kind}`)}</Badge>
                  <span className="text-slate-500">{h.handedOverOn.slice(0, 10)}</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <Link to={`/handovers/${h.id}/print`} className="font-semibold text-indigo-600 hover:underline">
                    {t('handovers.print')}
                  </Link>
                  <button onClick={() => remove(h)} className="text-slate-400 hover:text-rose-600" aria-label={t('handovers.delete')}>
                    ×
                  </button>
                </span>
              </div>
              <div className="mt-0.5 text-slate-700">
                {h.contact ? (
                  <Link to={`/contacts/${h.contact.id}`} className="hover:underline">
                    {h.contact.name}
                  </Link>
                ) : (
                  '—'
                )}
                {h.mobileLine && <span className="text-slate-400"> · {h.mobileLine.phoneNumber}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {recording && (
        <HandoverModal
          asset={asset}
          kind={recording}
          onClose={() => setRecording(null)}
          onSaved={(h) => {
            setRecording(null);
            onChange();
            // Straight to the form to print and sign; it links back here.
            navigate(`/handovers/${h.id}/print`);
          }}
        />
      )}
    </Card>
  );
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function HandoverModal({
  asset,
  kind,
  onClose,
  onSaved,
}: {
  asset: AssetDetail;
  kind: HandoverKind;
  onClose: () => void;
  onSaved: (h: AssetHandover) => void;
}) {
  const { t } = useTranslation();
  const [person, setPerson] = useState<PickerOption | null>(kind === 'RETURN' && asset.assignedContact ? asset.assignedContact : null);
  const [date, setDate] = useState(today());
  const [condition, setCondition] = useState('');
  const [accessories, setAccessories] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<MobileLine[]>([]);
  const [lineId, setLineId] = useState(asset.mobileLines?.length === 1 ? asset.mobileLines[0].id : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<{ lines: MobileLine[] }>('/mobile-lines?status=ACTIVE')
      .then((r) => setLines(r.lines))
      .catch(() => {});
  }, []);

  const searchContacts = useCallback(
    (q: string) =>
      apiGet<{ contacts: { id: string; name: string; email: string }[] }>(`/contacts?search=${encodeURIComponent(q)}`).then((r) =>
        r.contacts.slice(0, 8).map((c) => ({ id: c.id, name: c.name, hint: c.email })),
      ),
    [],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!person) {
      setError(t(kind === 'DELIVERY' ? 'handovers.pickReceiver' : 'handovers.pickReturner'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const h = await apiPost<AssetHandover>(`/assets/${asset.id}/handovers`, {
        kind,
        contactId: person.id,
        handedOverOn: date,
        condition: condition || null,
        accessories: accessories || null,
        notes: notes || null,
        mobileLineId: lineId || null,
      });
      onSaved(h);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('handovers.saveFailed'));
      setSaving(false);
    }
  }

  return (
    <Modal title={t(kind === 'DELIVERY' ? 'handovers.deliverTitle' : 'handovers.returnTitle', { name: asset.name })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <SearchPicker
          label={t(kind === 'DELIVERY' ? 'handovers.receiver' : 'handovers.returner')}
          value={person}
          onChange={setPerson}
          search={searchContacts}
        />
        <Input label={t('handovers.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        {lines.length > 0 && (
          <Select label={t('handovers.line')} value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value="">{t('handovers.noLine')}</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.phoneNumber}
                {l.plan ? ` · ${l.plan}` : ''}
                {l.assignedContact ? ` · ${l.assignedContact.name}` : ''}
              </option>
            ))}
          </Select>
        )}
        <Input
          label={t('handovers.condition')}
          placeholder={t('handovers.conditionPlaceholder')}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        />
        <Input
          label={t('handovers.accessories')}
          placeholder={t('handovers.accessoriesPlaceholder')}
          value={accessories}
          onChange={(e) => setAccessories(e.target.value)}
        />
        <Textarea label={t('handovers.notes')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={saving}>
            {t('handovers.saveAndPrint')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
