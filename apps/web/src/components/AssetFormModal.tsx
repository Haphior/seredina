import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiGet } from '../lib/api';
import { ASSET_TYPE_GROUPS } from '../lib/assetTypes';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { Textarea } from './Textarea';
import { SearchPicker, type PickerOption } from './SearchPicker';
import type { Asset, AssetModel, AssetStatus, AssetType, Organization } from '../lib/types';

const ASSET_STATUSES: AssetStatus[] = ['ACTIVE', 'INACTIVE', 'RETIRED'];

// Equipment with no network or operating system of its own: the form hides
// those fields instead of showing empty boxes nobody will fill in.
const NO_NETWORK: AssetType[] = ['MONITOR', 'PERIPHERAL', 'DOCKING_STATION'];
const HAS_OS: AssetType[] = ['WORKSTATION', 'LAPTOP', 'SERVER', 'TABLET', 'MOBILE_DEVICE', 'OTHER'];

export interface AssetFormValues {
  name: string;
  assetType: AssetType;
  status: AssetStatus;
  ipAddress: string | null;
  macAddress: string | null;
  hostname: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  operatingSystem: string | null;
  modelId: string | null;
  // Inventory details -- docs/adr/0076-directory-payments-inventory.md.
  assetTag: string | null;
  location: string | null;
  assignedContactId: string | null;
  parentAssetId: string | null;
  purchaseDate: string | null;
  purchaseCost: number | null;
  purchaseCurrency: string | null;
  supplierId: string | null;
  warrantyEndDate: string | null;
  notes: string | null;
}

function toFormValues(asset?: Asset, defaults?: Partial<AssetFormValues>): AssetFormValues {
  return {
    name: asset?.name ?? '',
    assetType: asset?.assetType ?? defaults?.assetType ?? 'OTHER',
    status: asset?.status ?? 'ACTIVE',
    ipAddress: asset?.ipAddress ?? null,
    macAddress: asset?.macAddress ?? null,
    hostname: asset?.hostname ?? null,
    serialNumber: asset?.serialNumber ?? null,
    manufacturer: asset?.manufacturer ?? null,
    model: asset?.model ?? null,
    operatingSystem: asset?.operatingSystem ?? null,
    modelId: asset?.modelId ?? null,
    assetTag: asset?.assetTag ?? null,
    location: asset?.location ?? null,
    assignedContactId: asset?.assignedContactId ?? null,
    parentAssetId: asset?.parentAssetId ?? defaults?.parentAssetId ?? null,
    purchaseDate: asset?.purchaseDate?.slice(0, 10) ?? null,
    purchaseCost: asset?.purchaseCost ?? null,
    purchaseCurrency: asset?.purchaseCurrency ?? null,
    supplierId: asset?.supplierId ?? null,
    warrantyEndDate: asset?.warrantyEndDate?.slice(0, 10) ?? null,
    notes: asset?.notes ?? null,
  };
}

export function AssetFormModal({
  asset,
  defaults,
  defaultParent,
  onClose,
  onSubmit,
}: {
  asset?: Asset;
  /** Prefills for a new asset, e.g. a monitor added from its computer's page. */
  defaults?: Partial<AssetFormValues>;
  defaultParent?: PickerOption;
  onClose: () => void;
  onSubmit: (values: AssetFormValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<AssetFormValues>(() => toFormValues(asset, defaults));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [catalogModels, setCatalogModels] = useState<AssetModel[]>([]);
  const [suppliers, setSuppliers] = useState<Organization[]>([]);
  const [assignee, setAssignee] = useState<PickerOption | null>(asset?.assignedContact ?? null);
  const [parent, setParent] = useState<PickerOption | null>(asset?.parentAsset ?? defaultParent ?? null);

  useEffect(() => {
    apiGet<{ assetModels: AssetModel[] }>('/asset-models')
      .then((res) => setCatalogModels(res.assetModels))
      .catch(() => {}); // catalog picker is a convenience; a load failure shouldn't block editing an asset by hand
    apiGet<{ organizations: Organization[] }>('/organizations')
      .then((res) => setSuppliers(res.organizations))
      .catch(() => {});
  }, []);

  const searchContacts = useCallback(
    (q: string) =>
      apiGet<{ contacts: { id: string; name: string; email: string }[] }>(`/contacts?search=${encodeURIComponent(q)}`).then((r) =>
        r.contacts.slice(0, 8).map((c) => ({ id: c.id, name: c.name, hint: c.email })),
      ),
    [],
  );
  const searchAssets = useCallback(
    (q: string) =>
      apiGet<{ assets: Asset[] }>(`/assets?q=${encodeURIComponent(q)}&limit=8`).then((r) =>
        r.assets.filter((a) => a.id !== asset?.id).map((a) => ({ id: a.id, name: a.name, hint: t(`assetType.${a.assetType}`) })),
      ),
    [asset?.id, t],
  );

  function setField<K extends keyof AssetFormValues>(key: K, value: AssetFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }
  const text = (key: keyof AssetFormValues) => ({
    value: (values[key] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => setField(key, (e.target.value || null) as never),
  });

  function pickCatalogModel(modelId: string) {
    if (!modelId) {
      setField('modelId', null);
      return;
    }
    const picked = catalogModels.find((m) => m.id === modelId);
    if (!picked) return;
    setValues((v) => ({
      ...v,
      modelId: picked.id,
      assetType: picked.assetType,
      manufacturer: picked.manufacturer.name,
      model: picked.name,
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        ...values,
        assignedContactId: assignee?.id ?? null,
        parentAssetId: parent?.id ?? null,
        purchaseCurrency: values.purchaseCurrency ? values.purchaseCurrency.toUpperCase() : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('assetForm.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const networked = !NO_NETWORK.includes(values.assetType);

  return (
    <Modal title={asset ? t('assetForm.edit') : t('assetForm.new')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="max-h-[74vh] space-y-3 overflow-y-auto pr-1">
        <Input label={t('assetForm.name')} value={values.name} onChange={(e) => setField('name', e.target.value)} required />

        <div className="grid grid-cols-2 gap-2">
          <Select label={t('assetForm.type')} value={values.assetType} onChange={(e) => setField('assetType', e.target.value as AssetType)}>
            {ASSET_TYPE_GROUPS.map((g) => (
              <optgroup key={g.key} label={t(`assetGroup.${g.key}`)}>
                {g.types.map((o) => (
                  <option key={o} value={o}>
                    {t(`assetType.${o}`)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <Select label={t('assetForm.status')} value={values.status} onChange={(e) => setField('status', e.target.value as AssetStatus)}>
            {ASSET_STATUSES.map((o) => (
              <option key={o} value={o}>
                {t(`assetStatus.${o}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Input label={t('assetForm.assetTag')} placeholder="TI-00123" {...text('assetTag')} />
          <Input label={t('assetForm.serial')} {...text('serialNumber')} />
        </div>

        {catalogModels.length > 0 && (
          <Select label={t('assetForm.catalogModel')} value={values.modelId ?? ''} onChange={(e) => pickCatalogModel(e.target.value)}>
            <option value="">{t('assetForm.catalogPick')}</option>
            {catalogModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.manufacturer.name} / {m.name}
              </option>
            ))}
          </Select>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Input label={t('assetForm.manufacturer')} {...text('manufacturer')} />
          <Input label={t('assetForm.model')} {...text('model')} />
        </div>

        {networked && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Input label={t('assetForm.ip')} placeholder="192.168.1.10" {...text('ipAddress')} />
              <Input label={t('assetForm.mac')} {...text('macAddress')} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input label={t('assetForm.hostname')} {...text('hostname')} />
              {HAS_OS.includes(values.assetType) && <Input label={t('assetForm.os')} {...text('operatingSystem')} />}
            </div>
          </>
        )}

        <p className="pt-2 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">{t('assetForm.inventorySection')}</p>
        <div className="grid grid-cols-2 gap-2">
          <SearchPicker label={t('assetForm.assignedTo')} value={assignee} onChange={setAssignee} search={searchContacts} />
          <Input label={t('assetForm.location')} placeholder={t('assetForm.locationPlaceholder')} {...text('location')} />
        </div>
        <SearchPicker label={t('assetForm.connectedTo')} value={parent} onChange={setParent} search={searchAssets} placeholder={t('assetForm.connectedToPlaceholder')} />

        <p className="pt-2 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">{t('assetForm.purchaseSection')}</p>
        <div className="grid grid-cols-2 gap-2">
          <Select label={t('assetForm.supplier')} value={values.supplierId ?? ''} onChange={(e) => setField('supplierId', e.target.value || null)}>
            <option value="">—</option>
            {suppliers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Input label={t('assetForm.purchaseDate')} type="date" {...text('purchaseDate')} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Input
            label={t('assetForm.purchaseCost')}
            type="number"
            min={0}
            step="0.01"
            value={values.purchaseCost ?? ''}
            onChange={(e) => setField('purchaseCost', e.target.value === '' ? null : Number(e.target.value))}
          />
          <Input label={t('assetForm.currency')} maxLength={3} placeholder="CLP" {...text('purchaseCurrency')} />
          <Input label={t('assetForm.warrantyEnd')} type="date" {...text('warrantyEndDate')} />
        </div>
        <Textarea label={t('assetForm.notes')} rows={2} value={values.notes ?? ''} onChange={(e) => setField('notes', e.target.value || null)} />

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
