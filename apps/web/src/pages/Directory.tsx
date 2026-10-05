import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { DirectoryPerson, DirectoryRole, Organization, OrganizationType } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { Textarea } from '../components/Textarea';
import { SearchIcon } from '../components/icons';

const ORG_TYPES: OrganizationType[] = ['SUPPLIER', 'CUSTOMER', 'PARTNER', 'INTERNAL', 'OTHER'];
const ROLES: DirectoryRole[] = ['EXECUTIVE', 'MANAGEMENT', 'SALES', 'TECHNICAL', 'SUPPORT', 'BILLING', 'OTHER'];
const ORG_TONE: Record<OrganizationType, 'indigo' | 'emerald' | 'sky' | 'slate' | 'amber'> = {
  SUPPLIER: 'indigo',
  CUSTOMER: 'emerald',
  PARTNER: 'sky',
  INTERNAL: 'amber',
  OTHER: 'slate',
};

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

interface OrganizationDetail extends Organization {
  contacts: DirectoryPerson[];
  contracts: { id: string; name: string; type: string; endDate: string | null; nextPaymentDate: string | null }[];
  assets: { id: string; name: string; assetType: string; assetTag: string | null }[];
}

/**
 * The directory: companies (suppliers, customers, partners, internal areas)
 * and the people at them -- docs/adr/0076-directory-payments-inventory.md.
 */
export function Directory() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('contacts:manage');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'people' ? 'people' : 'organizations';

  return (
    <div className="px-4 py-5 md:px-8 md:py-7">
      <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('directory.title')}</h1>
      <p className="mb-5 max-w-3xl text-[13.5px] text-slate-500">{t('directory.intro')}</p>
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {(['organizations', 'people'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setParams(k === 'people' ? { tab: 'people' } : {})}
            className={`-mb-px border-b-2 px-3 py-2 text-[13.5px] font-semibold ${
              tab === k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t(`directory.tabs.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'organizations' ? <Organizations canManage={canManage} /> : <People canManage={canManage} />}
    </div>
  );
}

function Organizations({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<OrganizationType | ''>('');
  const [editing, setEditing] = useState<Organization | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (search.trim()) qs.set('search', search.trim());
    if (type) qs.set('type', type);
    apiGet<{ organizations: Organization[] }>(`/organizations?${qs}`)
      .then((r) => setOrgs(r.organizations))
      .catch((err) => setError(errorText(err, t('directory.loadFailed'))));
  }, [search, type, t]);

  useEffect(() => {
    const h = setTimeout(load, 200);
    return () => clearTimeout(h);
  }, [load]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-[260px]">
          <Input
            hideLabel
            aria-label={t('directory.searchOrgs')}
            icon={<SearchIcon width={15} height={15} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('directory.searchOrgs')}
          />
        </div>
        <div className="w-[170px]">
          <Select hideLabel aria-label={t('directory.fields.type')} value={type} onChange={(e) => setType(e.target.value as OrganizationType | '')}>
            <option value="">{t('directory.anyType')}</option>
            {ORG_TYPES.map((o) => (
              <option key={o} value={o}>
                {t(`directory.orgType.${o}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1" />
        {canManage && <Button onClick={() => setEditing('new')}>{t('directory.newOrg')}</Button>}
      </div>
      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      {orgs === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {orgs?.length === 0 && <p className="text-sm text-slate-500">{t('directory.noOrgs')}</p>}
      {orgs && orgs.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-2.5">{t('directory.fields.name')}</th>
                <th className="px-5 py-2.5">{t('directory.fields.type')}</th>
                <th className="px-5 py-2.5">{t('directory.fields.contactInfo')}</th>
                <th className="px-5 py-2.5">{t('directory.fields.linked')}</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orgs.map((o) => (
                <tr key={o.id} className="align-top hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <button onClick={() => setViewing(o.id)} className="text-left font-semibold text-slate-800 hover:text-indigo-700">
                      {o.name}
                    </button>
                    {o.taxId && <p className="text-xs text-slate-400">{o.taxId}</p>}
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={ORG_TONE[o.type]}>{t(`directory.orgType.${o.type}`)}</Badge>
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {o.phone && <p>{o.phone}</p>}
                    {o.email && (
                      <a href={`mailto:${o.email}`} className="text-indigo-700 hover:underline">
                        {o.email}
                      </a>
                    )}
                    {!o.phone && !o.email && '—'}
                  </td>
                  <td className="px-5 py-3 text-[12.5px] text-slate-500">
                    {t('directory.counts', { people: o.contactCount ?? 0, contracts: o.contractCount ?? 0, assets: o.assetCount ?? 0 })}
                  </td>
                  <td className="space-x-3 whitespace-nowrap px-5 py-3 text-right text-xs">
                    {canManage && (
                      <>
                        <button onClick={() => setEditing(o)} className="text-slate-400 hover:text-indigo-600">
                          {t('directory.edit')}
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(t('directory.confirmDeleteOrg', { name: o.name }))) return;
                            try {
                              await apiDelete(`/organizations/${o.id}`);
                              load();
                            } catch (err) {
                              setError(errorText(err, t('directory.saveFailed')));
                            }
                          }}
                          className="text-slate-400 hover:text-rose-600"
                        >
                          {t('directory.delete')}
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
        <OrganizationModal
          org={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {viewing && <OrganizationView id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function OrganizationView({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  useEffect(() => {
    apiGet<OrganizationDetail>(`/organizations/${id}`).then(setOrg).catch(() => onClose());
  }, [id, onClose]);
  if (!org) return null;
  return (
    <Modal title={org.name} onClose={onClose}>
      <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={ORG_TONE[org.type]}>{t(`directory.orgType.${org.type}`)}</Badge>
          {org.taxId && <span className="text-slate-500">{org.taxId}</span>}
        </div>
        <dl className="grid grid-cols-2 gap-3">
          <Field label={t('directory.fields.phone')} value={org.phone} />
          <Field label={t('directory.fields.email')} value={org.email} href={org.email ? `mailto:${org.email}` : undefined} />
          <Field label={t('directory.fields.website')} value={org.website} href={org.website ?? undefined} />
          <Field label={t('directory.fields.address')} value={org.address} />
        </dl>
        {org.notes && <p className="whitespace-pre-line text-slate-500">{org.notes}</p>}
        <Section title={t('directory.peopleAt', { count: org.contacts.length })}>
          {org.contacts.map((p) => (
            <div key={p.id} className="rounded-md bg-slate-50 px-2.5 py-1.5">
              <span className="font-medium text-slate-800">{p.name}</span>
              <span className="text-slate-400">
                {' '}
                · {p.jobTitle || t(`directory.role.${p.role}`)}
              </span>
              <p className="text-[12px] text-slate-500">{[p.email, p.phone, p.mobile].filter(Boolean).join(' · ')}</p>
            </div>
          ))}
        </Section>
        <Section title={t('directory.contractsWith', { count: org.contracts.length })}>
          {org.contracts.map((c) => (
            <Link key={c.id} to="/contracts" className="block rounded-md bg-slate-50 px-2.5 py-1.5 font-medium text-indigo-700 hover:underline">
              {c.name}
              {c.nextPaymentDate && <span className="font-normal text-slate-400"> · {t('directory.nextPayment', { date: c.nextPaymentDate.slice(0, 10) })}</span>}
            </Link>
          ))}
        </Section>
        <Section title={t('directory.assetsFrom', { count: org.assets.length })}>
          {org.assets.map((a) => (
            <Link key={a.id} to={`/assets/${a.id}`} className="block rounded-md bg-slate-50 px-2.5 py-1.5 text-indigo-700 hover:underline">
              {a.name}
              <span className="text-slate-400"> · {t(`assetType.${a.assetType}`)}</span>
            </Link>
          ))}
        </Section>
      </div>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {children.length === 0 ? <p className="text-slate-400">—</p> : <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function Field({ label, value, href }: { label: string; value: string | null; href?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-700">
        {value ? (
          href ? (
            <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="text-indigo-700 hover:underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          '—'
        )}
      </dd>
    </div>
  );
}

function OrganizationModal({ org, onClose, onSaved }: { org: Organization | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: org?.name ?? '',
    type: org?.type ?? ('SUPPLIER' as OrganizationType),
    taxId: org?.taxId ?? '',
    website: org?.website ?? '',
    email: org?.email ?? '',
    phone: org?.phone ?? '',
    address: org?.address ?? '',
    notes: org?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (org) await apiPatch(`/organizations/${org.id}`, form);
      else await apiPost('/organizations', form);
      onSaved();
    } catch (err) {
      setError(errorText(err, t('directory.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={org ? t('directory.editOrg') : t('directory.newOrg')} onClose={onClose}>
      <form onSubmit={submit} className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
        <Input label={t('directory.fields.name')} value={form.name} onChange={set('name')} required />
        <div className="grid grid-cols-2 gap-2">
          <Select label={t('directory.fields.type')} value={form.type} onChange={set('type')}>
            {ORG_TYPES.map((o) => (
              <option key={o} value={o}>
                {t(`directory.orgType.${o}`)}
              </option>
            ))}
          </Select>
          <Input label={t('directory.fields.taxId')} value={form.taxId} onChange={set('taxId')} placeholder="76.123.456-7" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label={t('directory.fields.phone')} value={form.phone} onChange={set('phone')} />
          <Input label={t('directory.fields.email')} type="email" value={form.email} onChange={set('email')} />
        </div>
        <Input label={t('directory.fields.website')} value={form.website} onChange={set('website')} placeholder="www.example.com" />
        <Input label={t('directory.fields.address')} value={form.address} onChange={set('address')} />
        <Textarea label={t('directory.fields.notes')} rows={3} value={form.notes} onChange={set('notes')} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
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

function People({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const [people, setPeople] = useState<DirectoryPerson[] | null>(null);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<DirectoryRole | ''>('');
  const [orgId, setOrgId] = useState('');
  const [editing, setEditing] = useState<DirectoryPerson | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ organizations: Organization[] }>('/organizations')
      .then((r) => setOrgs(r.organizations))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (search.trim()) qs.set('search', search.trim());
    if (role) qs.set('role', role);
    if (orgId) qs.set('organizationId', orgId);
    apiGet<{ contacts: DirectoryPerson[] }>(`/directory-contacts?${qs}`)
      .then((r) => setPeople(r.contacts))
      .catch((err) => setError(errorText(err, t('directory.loadFailed'))));
  }, [search, role, orgId, t]);

  useEffect(() => {
    const h = setTimeout(load, 200);
    return () => clearTimeout(h);
  }, [load]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-[260px]">
          <Input
            hideLabel
            aria-label={t('directory.searchPeople')}
            icon={<SearchIcon width={15} height={15} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('directory.searchPeople')}
          />
        </div>
        <div className="w-[170px]">
          <Select hideLabel aria-label={t('directory.fields.role')} value={role} onChange={(e) => setRole(e.target.value as DirectoryRole | '')}>
            <option value="">{t('directory.anyRole')}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`directory.role.${r}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[200px]">
          <Select hideLabel aria-label={t('directory.fields.organization')} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">{t('directory.anyOrg')}</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1" />
        {canManage && <Button onClick={() => setEditing('new')}>{t('directory.newPerson')}</Button>}
      </div>
      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      {people === null && <p className="text-sm text-slate-500">{t('common.loading')}</p>}
      {people?.length === 0 && <p className="text-sm text-slate-500">{t('directory.noPeople')}</p>}
      {people && people.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-2.5">{t('directory.fields.name')}</th>
                <th className="px-5 py-2.5">{t('directory.fields.organization')}</th>
                <th className="px-5 py-2.5">{t('directory.fields.role')}</th>
                <th className="px-5 py-2.5">{t('directory.fields.email')}</th>
                <th className="px-5 py-2.5">{t('directory.fields.phones')}</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {people.map((p) => (
                <tr key={p.id} className="align-top hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <span className="font-semibold text-slate-800">{p.name}</span>
                    {p.jobTitle && <p className="text-xs text-slate-400">{p.jobTitle}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{p.organization?.name ?? '—'}</td>
                  <td className="px-5 py-3">
                    <Badge tone="slate">{t(`directory.role.${p.role}`)}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    {p.email ? (
                      <a href={`mailto:${p.email}`} className="text-indigo-700 hover:underline">
                        {p.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {p.phone && <p>{p.phone}</p>}
                    {p.mobile && <p>{p.mobile}</p>}
                    {!p.phone && !p.mobile && '—'}
                  </td>
                  <td className="space-x-3 whitespace-nowrap px-5 py-3 text-right text-xs">
                    {canManage && (
                      <>
                        <button onClick={() => setEditing(p)} className="text-slate-400 hover:text-indigo-600">
                          {t('directory.edit')}
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(t('directory.confirmDeletePerson', { name: p.name }))) return;
                            try {
                              await apiDelete(`/directory-contacts/${p.id}`);
                              load();
                            } catch (err) {
                              setError(errorText(err, t('directory.saveFailed')));
                            }
                          }}
                          className="text-slate-400 hover:text-rose-600"
                        >
                          {t('directory.delete')}
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
        <PersonModal
          person={editing === 'new' ? null : editing}
          orgs={orgs}
          defaultOrgId={orgId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function PersonModal({
  person,
  orgs,
  defaultOrgId,
  onClose,
  onSaved,
}: {
  person: DirectoryPerson | null;
  orgs: Organization[];
  defaultOrgId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: person?.name ?? '',
    organizationId: person?.organizationId ?? defaultOrgId,
    jobTitle: person?.jobTitle ?? '',
    role: person?.role ?? ('OTHER' as DirectoryRole),
    email: person?.email ?? '',
    phone: person?.phone ?? '',
    mobile: person?.mobile ?? '',
    notes: person?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = { ...form, organizationId: form.organizationId || null };
    try {
      if (person) await apiPatch(`/directory-contacts/${person.id}`, body);
      else await apiPost('/directory-contacts', body);
      onSaved();
    } catch (err) {
      setError(errorText(err, t('directory.saveFailed')));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={person ? t('directory.editPerson') : t('directory.newPerson')} onClose={onClose}>
      <form onSubmit={submit} className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
        <Input label={t('directory.fields.name')} value={form.name} onChange={set('name')} required />
        <div className="grid grid-cols-2 gap-2">
          <Select label={t('directory.fields.organization')} value={form.organizationId} onChange={set('organizationId')}>
            <option value="">—</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select label={t('directory.fields.role')} value={form.role} onChange={set('role')}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`directory.role.${r}`)}
              </option>
            ))}
          </Select>
        </div>
        <Input label={t('directory.fields.jobTitle')} value={form.jobTitle} onChange={set('jobTitle')} placeholder={t('directory.jobTitlePlaceholder')} />
        <Input label={t('directory.fields.email')} type="email" value={form.email} onChange={set('email')} />
        <div className="grid grid-cols-2 gap-2">
          <Input label={t('directory.fields.phone')} value={form.phone} onChange={set('phone')} />
          <Input label={t('directory.fields.mobile')} value={form.mobile} onChange={set('mobile')} />
        </div>
        <Textarea label={t('directory.fields.notes')} rows={3} value={form.notes} onChange={set('notes')} />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
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
