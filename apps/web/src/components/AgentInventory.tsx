import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentInventory as Inventory } from '../lib/types';
import { formatDateTime } from '../lib/format';
import { Badge, type BadgeTone } from './Badge';
import { Card } from './Card';
import { Input } from './Input';

/**
 * The agent's full inventory on an asset's page
 * (docs/adr/0069-full-agent-inventory.md): an overview of what matters at a
 * glance, and a tab per part. A tab only shows when the agent sent data for
 * it -- a Mac has no Windows updates, a laptop no listening services.
 */

type Tab = 'overview' | 'hardware' | 'storage' | 'network' | 'software' | 'security' | 'updates' | 'services' | 'ports' | 'server';

export function AgentInventory({ inventory, collectedAt, assetName }: { inventory: Inventory; collectedAt: string | null; assetName: string }) {
  const { t } = useTranslation();
  const inv = inventory;
  const tabs = useMemo(() => {
    const present: Tab[] = ['overview', 'hardware', 'storage', 'network'];
    if (inv.software?.length) present.push('software');
    present.push('security');
    if (inv.updates?.installed?.length || inv.updates?.pending !== undefined) present.push('updates');
    if (inv.services?.length) present.push('services');
    if (inv.ports?.length) present.push('ports');
    if (inv.serverRoles?.length || inv.virtualMachines?.length) present.push('server');
    return present;
  }, [inv]);
  const [tab, setTab] = useState<Tab>('overview');

  function download() {
    const blob = new Blob([JSON.stringify(inv, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${assetName.replace(/[^\w.-]+/g, '_')}-inventory.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-400">{t('assetDetail.agentInventory')}</h2>
        <div className="flex items-center gap-3 text-[12px] text-slate-400">
          {collectedAt && <span>{t('inventory.collectedAt', { date: formatDateTime(collectedAt) })}</span>}
          <button type="button" onClick={download} className="font-semibold text-indigo-600 hover:underline">
            {t('inventory.downloadJson')}
          </button>
        </div>
      </div>

      <div role="tablist" aria-label={t('assetDetail.agentInventory')} className="mb-4 flex flex-wrap gap-1 border-b border-slate-100 pb-2">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-md px-2.5 py-1 text-[12.5px] font-semibold ${
              tab === id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            {t(`inventory.tabs.${id}`)}
            {tabCount(inv, id) !== null && <span className="ml-1 font-normal text-slate-400">{tabCount(inv, id)}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'overview' && <Overview inv={inv} />}
        {tab === 'hardware' && <Hardware inv={inv} />}
        {tab === 'storage' && <Storage inv={inv} />}
        {tab === 'network' && <Network inv={inv} />}
        {tab === 'software' && <Software inv={inv} />}
        {tab === 'security' && <Security inv={inv} />}
        {tab === 'updates' && <Updates inv={inv} />}
        {tab === 'services' && <Services inv={inv} />}
        {tab === 'ports' && <Ports inv={inv} />}
        {tab === 'server' && <Server inv={inv} />}
      </div>
    </Card>
  );
}

function tabCount(inv: Inventory, tab: Tab): number | null {
  switch (tab) {
    case 'software':
      return inv.software?.length ?? null;
    case 'services':
      return inv.services?.length ?? null;
    case 'ports':
      return inv.ports?.length ?? null;
    case 'updates':
      return inv.updates?.installed?.length || null;
    default:
      return null;
  }
}

// --- building blocks -------------------------------------------------------

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-5 gap-y-3 text-[13px] sm:grid-cols-2">{children}</dl>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === '' || (Array.isArray(children) && children.length === 0);
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="break-words text-slate-700">{empty ? '—' : children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  const { t } = useTranslation();
  if (rows.length === 0) return <p className="text-[12.5px] text-slate-400">{empty ?? t('inventory.none')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap py-1.5 pr-4 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => (
                <td key={j} className="py-1.5 pr-4 align-top">
                  {c ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function YesNo({ value, good = true }: { value: boolean | undefined; good?: boolean }) {
  const { t } = useTranslation();
  if (value === undefined) return <span className="text-slate-400">{t('inventory.unknown')}</span>;
  const tone: BadgeTone = value === good ? 'emerald' : 'rose';
  return (
    <Badge tone={tone} dot>
      {value ? t('inventory.yes') : t('inventory.no')}
    </Badge>
  );
}

function OnOff({ value }: { value: boolean | undefined }) {
  const { t } = useTranslation();
  if (value === undefined) return <span className="text-slate-400">{t('inventory.unknown')}</span>;
  return (
    <Badge tone={value ? 'emerald' : 'rose'} dot>
      {value ? t('inventory.on') : t('inventory.off')}
    </Badge>
  );
}

function gb(value: number | undefined) {
  return value === undefined ? null : value >= 1000 ? `${(value / 1000).toFixed(1)} TB` : `${value.toFixed(value < 10 ? 1 : 0)} GB`;
}

function mb(value: number | undefined) {
  return value ? (value >= 1024 ? `${(value / 1024).toFixed(value % 1024 ? 1 : 0)} GB` : `${value} MB`) : null;
}

function joined(list: string[] | undefined) {
  return list && list.length ? list.join(', ') : null;
}

function useFilter<T>(items: T[] | undefined, text: (item: T) => string) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items ?? []).filter((item) => !needle || text(item).toLowerCase().includes(needle));
  }, [items, q, text]);
  return { q, setQ, filtered };
}

function Search({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="mb-3 max-w-xs">
      <Input hideLabel aria-label={label} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// --- tabs ------------------------------------------------------------------

function Overview({ inv }: { inv: Inventory }) {
  const { t } = useTranslation();
  const s = inv.system ?? {};
  const os = inv.os ?? {};
  const cpu = inv.cpu ?? {};
  const sec = inv.security ?? {};
  const avOn = sec.antivirus?.some((a) => a.enabled);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {s.role && <Badge tone="indigo">{t(`inventory.role.${s.role}`)}</Badge>}
        {s.formFactor && <Badge tone="slate">{t(`inventory.formFactor.${s.formFactor}`)}</Badge>}
        {s.virtual && <Badge tone="sky">{s.hypervisor ? t('inventory.virtualOn', { hypervisor: s.hypervisor }) : t('inventory.virtual')}</Badge>}
        {os.pendingReboot && (
          <Badge tone="amber" dot>
            {t('inventory.pendingReboot')}
          </Badge>
        )}
        {sec.systemDiskEncrypted === false && (
          <Badge tone="rose" dot>
            {t('inventory.notEncrypted')}
          </Badge>
        )}
        {sec.antivirus && sec.antivirus.length > 0 && !avOn && (
          <Badge tone="rose" dot>
            {t('inventory.noActiveAntivirus')}
          </Badge>
        )}
        {(inv.updates?.pendingSecurity ?? 0) > 0 && (
          <Badge tone="amber" dot>
            {t('inventory.securityUpdatesPending', { count: inv.updates!.pendingSecurity })}
          </Badge>
        )}
      </div>
      <Facts>
        <Fact label={t('inventory.manufacturerModel')}>{[s.manufacturer, s.model].filter(Boolean).join(' ') || null}</Fact>
        <Fact label={t('inventory.serial')}>{s.serialNumber}</Fact>
        <Fact label={t('inventory.os')}>{[os.name, os.version && !os.name?.includes(os.version) ? os.version : null].filter(Boolean).join(' ') || null}</Fact>
        <Fact label={t('inventory.build')}>{[os.build, os.arch].filter(Boolean).join(' · ') || null}</Fact>
        <Fact label="CPU">
          {cpu.model}
          {(cpu.cores || cpu.threads) && (
            <span className="block text-[12px] text-slate-400">
              {t('inventory.cpuCounts', { sockets: cpu.sockets ?? 1, cores: cpu.cores ?? '?', threads: cpu.threads ?? '?' })}
              {cpu.speedMhz ? ` · ${(cpu.speedMhz / 1000).toFixed(2)} GHz` : ''}
            </span>
          )}
        </Fact>
        <Fact label={t('inventory.memory')}>
          {mb(inv.memory?.totalMb)}
          {inv.memory?.slots ? (
            <span className="block text-[12px] text-slate-400">
              {t('inventory.slotsUsed', { used: inv.memory.modules?.length ?? 0, slots: inv.memory.slots })}
            </span>
          ) : null}
        </Fact>
        <Fact label={t('inventory.lastBoot')}>{os.lastBoot ? formatDateTime(os.lastBoot) : null}</Fact>
        <Fact label={t('inventory.installDate')}>{os.installDate}</Fact>
        <Fact label={t('inventory.loggedOn')}>{joined(inv.users?.loggedOn) ?? inv.users?.lastLogon}</Fact>
        <Fact label={t('inventory.domain')}>{s.domain}</Fact>
        <Fact label={t('inventory.ipAddresses')}>{joined(inv.network?.filter((n) => !n.virtual).flatMap((n) => n.ipv4 ?? []))}</Fact>
        <Fact label={t('inventory.timezone')}>{s.timezone}</Fact>
      </Facts>
    </>
  );
}

function Hardware({ inv }: { inv: Inventory }) {
  const { t } = useTranslation();
  const s = inv.system ?? {};
  return (
    <>
      <Section title={t('inventory.system')}>
        <Facts>
          <Fact label={t('inventory.manufacturer')}>{s.manufacturer}</Fact>
          <Fact label={t('inventory.model')}>{s.model}</Fact>
          <Fact label={t('inventory.serial')}>{s.serialNumber}</Fact>
          <Fact label="UUID">{s.uuid}</Fact>
          <Fact label="BIOS / UEFI">{[s.biosVendor, s.biosVersion, s.biosDate].filter(Boolean).join(' · ') || null}</Fact>
          <Fact label={t('inventory.hypervisor')}>{s.virtual ? (s.hypervisor ?? t('inventory.virtual')) : t('inventory.physical')}</Fact>
        </Facts>
      </Section>
      <Section title={t('inventory.memoryModules')}>
        <Table
          head={[t('inventory.slot'), t('inventory.size'), t('inventory.type'), t('inventory.speed'), t('inventory.manufacturer'), t('inventory.serial'), t('inventory.partNumber')]}
          rows={(inv.memory?.modules ?? []).map((m) => [m.slot, mb(m.sizeMb), m.type, m.speedMhz ? `${m.speedMhz} MHz` : null, m.manufacturer, m.serialNumber, m.partNumber])}
        />
      </Section>
      <Section title={t('inventory.gpus')}>
        <Table
          head={[t('inventory.name'), t('inventory.vendor'), t('inventory.memory'), t('inventory.driver')]}
          rows={(inv.gpus ?? []).map((g) => [g.name, g.vendor, mb(g.memoryMb), g.driverVersion])}
        />
      </Section>
      <Section title={t('inventory.monitors')}>
        <Table
          head={[t('inventory.manufacturer'), t('inventory.model'), t('inventory.serial'), t('inventory.year')]}
          rows={(inv.monitors ?? []).map((m) => [m.manufacturer, m.model, m.serialNumber, m.year])}
        />
      </Section>
      {inv.batteries && inv.batteries.length > 0 && (
        <Section title={t('inventory.batteries')}>
          <Table
            head={[t('inventory.name'), t('inventory.manufacturer'), t('inventory.chemistry'), t('inventory.health'), t('inventory.cycles')]}
            rows={inv.batteries.map((b) => [
              b.name,
              b.manufacturer,
              b.chemistry,
              b.healthPercent !== undefined ? (
                <Badge tone={b.healthPercent >= 80 ? 'emerald' : b.healthPercent >= 60 ? 'amber' : 'rose'}>{b.healthPercent}%</Badge>
              ) : null,
              b.cycleCount,
            ])}
          />
        </Section>
      )}
      {inv.printers && inv.printers.length > 0 && (
        <Section title={t('inventory.printers')}>
          <Table
            head={[t('inventory.name'), t('inventory.driver'), t('inventory.port'), '']}
            rows={inv.printers.map((p) => [
              p.name,
              p.driver,
              p.port,
              [p.default && t('inventory.default'), p.shared && t('inventory.shared'), p.network && t('inventory.network')].filter(Boolean).join(', '),
            ])}
          />
        </Section>
      )}
    </>
  );
}

function Storage({ inv }: { inv: Inventory }) {
  const { t } = useTranslation();
  return (
    <>
      <Section title={t('inventory.physicalDisks')}>
        <Table
          head={[t('inventory.model'), t('inventory.type'), t('inventory.size'), t('inventory.interface'), t('inventory.serial'), t('inventory.health')]}
          rows={(inv.disks ?? []).map((d) => [
            d.model || d.name,
            d.type && d.type !== 'unknown' ? d.type.toUpperCase() : null,
            gb(d.sizeGb),
            d.interface,
            d.serialNumber,
            d.health,
          ])}
        />
      </Section>
      <Section title={t('inventory.volumes')}>
        <Table
          head={[t('inventory.mount'), t('inventory.fileSystem'), t('inventory.size'), t('inventory.free'), t('inventory.encrypted')]}
          rows={(inv.volumes ?? []).map((v) => {
            const pct = v.totalGb ? Math.round(((v.freeGb ?? 0) / v.totalGb) * 100) : null;
            return [
              <span>
                {v.mount}
                {v.label && <span className="text-slate-400"> · {v.label}</span>}
              </span>,
              v.fileSystem,
              gb(v.totalGb),
              pct === null ? null : <span className={pct < 10 ? 'font-semibold text-rose-600' : pct < 20 ? 'text-amber-700' : ''}>{`${gb(v.freeGb)} (${pct}%)`}</span>,
              v.encrypted === undefined ? null : <YesNo value={v.encrypted} />,
            ];
          })}
        />
      </Section>
    </>
  );
}

function Network({ inv }: { inv: Inventory }) {
  const { t } = useTranslation();
  const [showVirtual, setShowVirtual] = useState(false);
  const all = inv.network ?? [];
  const shown = showVirtual ? all : all.filter((n) => !n.virtual);
  const hidden = all.length - shown.length;
  return (
    <>
      <Table
        head={[t('inventory.adapter'), 'MAC', 'IPv4', t('inventory.gateway'), 'DNS', t('inventory.speed'), '']}
        rows={shown.map((n) => [
          <span>
            {n.name}
            {n.description && n.description !== n.name && <span className="block text-[11.5px] text-slate-400">{n.description}</span>}
          </span>,
          <span className="font-mono text-[11.5px]">{n.mac}</span>,
          joined(n.ipv4),
          n.gateway,
          joined(n.dns),
          n.speedMbps ? (n.speedMbps >= 1000 ? `${n.speedMbps / 1000} Gb/s` : `${n.speedMbps} Mb/s`) : null,
          [n.up === false && t('inventory.down'), n.dhcp && 'DHCP', n.virtual && t('inventory.virtual')].filter(Boolean).join(', '),
        ])}
      />
      {hidden > 0 && (
        <button type="button" onClick={() => setShowVirtual(true)} className="mt-2 text-[12px] font-semibold text-indigo-600 hover:underline">
          {t('inventory.showVirtualAdapters', { count: hidden })}
        </button>
      )}
    </>
  );
}

function Software({ inv }: { inv: Inventory }) {
  const { t } = useTranslation();
  const { q, setQ, filtered } = useFilter(inv.software, (s) => `${s.name} ${s.publisher ?? ''} ${s.version ?? ''}`);
  return (
    <>
      <Search value={q} onChange={setQ} label={t('inventory.searchSoftware')} />
      <Table
        head={[t('inventory.name'), t('inventory.version'), t('inventory.publisher'), t('inventory.installed'), t('inventory.arch')]}
        rows={filtered.slice(0, 500).map((s) => [s.name, s.version, s.publisher, s.installDate, s.arch])}
        empty={t('inventory.noMatches')}
      />
      {filtered.length > 500 && <p className="mt-2 text-[12px] text-slate-400">{t('inventory.showingFirst', { count: 500, total: filtered.length })}</p>}
    </>
  );
}

function Security({ inv }: { inv: Inventory }) {
  const { t } = useTranslation();
  const sec = inv.security ?? {};
  return (
    <>
      <Facts>
        <Fact label={t('inventory.diskEncryption')}>
          <YesNo value={sec.systemDiskEncrypted} />
          {sec.encryptionMethod && <span className="ml-1.5 text-[12px] text-slate-400">{sec.encryptionMethod}</span>}
        </Fact>
        <Fact label={t('inventory.firewall')}>
          <OnOff value={sec.firewallEnabled} />
        </Fact>
        <Fact label="Secure Boot">
          <OnOff value={sec.secureBoot} />
        </Fact>
        <Fact label="TPM">
          <YesNo value={sec.tpmPresent} />
          {sec.tpmVersion && <span className="ml-1.5 text-[12px] text-slate-400">{sec.tpmVersion}</span>}
        </Fact>
        {Object.entries(sec.features ?? {}).map(([name, value]) => (
          <Fact key={name} label={t(`inventory.features.${name}`, { defaultValue: name })}>
            {t(`inventory.featureValues.${value}`, { defaultValue: value })}
          </Fact>
        ))}
        <Fact label={t('inventory.pendingRebootLabel')}>
          <YesNo value={inv.os?.pendingReboot} good={false} />
        </Fact>
      </Facts>
      <div className="mt-5">
        <Section title={t('inventory.antivirus')}>
          <Table
            head={[t('inventory.name'), t('inventory.active'), t('inventory.upToDate'), t('inventory.version')]}
            rows={(sec.antivirus ?? []).map((a) => [
              a.name,
              a.enabled === undefined ? null : <YesNo value={a.enabled} />,
              a.upToDate === undefined ? null : <YesNo value={a.upToDate} />,
              a.version,
            ])}
          />
        </Section>
        <Section title={t('inventory.securityAgents')}>
          <p className="text-[12.5px] text-slate-600">{joined(sec.agents) ?? t('inventory.noneDetected')}</p>
        </Section>
        <Section title={t('inventory.localAdmins')}>
          <p className="text-[12.5px] text-slate-600">{joined(inv.users?.localAdmins) ?? '—'}</p>
        </Section>
        <Section title={t('inventory.localUsers')}>
          <p className="text-[12.5px] text-slate-600">{joined(inv.users?.localUsers) ?? '—'}</p>
        </Section>
      </div>
    </>
  );
}

function Updates({ inv }: { inv: Inventory }) {
  const { t } = useTranslation();
  const u = inv.updates ?? {};
  return (
    <>
      <Facts>
        <Fact label={t('inventory.lastUpdate')}>{u.lastInstalled}</Fact>
        {u.pending !== undefined && (
          <Fact label={t('inventory.pendingUpdates')}>
            {u.pending}
            {u.pendingSecurity ? <span className="ml-1 text-amber-700">{t('inventory.ofWhichSecurity', { count: u.pendingSecurity })}</span> : null}
          </Fact>
        )}
      </Facts>
      {u.installed && u.installed.length > 0 && (
        <div className="mt-4">
          <Table
            head={[t('inventory.update'), t('inventory.description'), t('inventory.installed')]}
            rows={u.installed.map((h) => [h.id, h.description, h.installedOn])}
          />
        </div>
      )}
    </>
  );
}

const STATE_TONE: Record<string, BadgeTone> = { running: 'emerald', stopped: 'slate', failed: 'rose' };

function Services({ inv }: { inv: Inventory }) {
  const { t } = useTranslation();
  const [runningOnly, setRunningOnly] = useState(true);
  const base = useMemo(() => (inv.services ?? []).filter((s) => !runningOnly || s.state === 'running' || s.state === 'failed'), [inv.services, runningOnly]);
  const { q, setQ, filtered } = useFilter(base, (s) => `${s.name} ${s.displayName ?? ''}`);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Search value={q} onChange={setQ} label={t('inventory.searchServices')} />
        <label className="mb-3 flex items-center gap-1.5 text-[12.5px] text-slate-600">
          <input type="checkbox" checked={runningOnly} onChange={(e) => setRunningOnly(e.target.checked)} />
          {t('inventory.runningOnly')}
        </label>
      </div>
      <Table
        head={[t('inventory.name'), t('inventory.description'), t('inventory.state'), t('inventory.startMode')]}
        rows={filtered.map((s) => [
          <span className="font-mono text-[11.5px]">{s.name}</span>,
          s.displayName,
          s.state ? <Badge tone={STATE_TONE[s.state] ?? 'slate'}>{t(`inventory.states.${s.state}`, { defaultValue: s.state })}</Badge> : null,
          s.startMode ? t(`inventory.startModes.${s.startMode}`, { defaultValue: s.startMode }) : null,
        ])}
        empty={t('inventory.noMatches')}
      />
    </>
  );
}

function Ports({ inv }: { inv: Inventory }) {
  const { t } = useTranslation();
  return (
    <Table
      head={[t('inventory.port'), t('inventory.protocol'), t('inventory.address'), t('inventory.process')]}
      rows={(inv.ports ?? []).map((p) => [p.port, p.protocol.toUpperCase(), p.address, p.process])}
    />
  );
}

function Server({ inv }: { inv: Inventory }) {
  const { t } = useTranslation();
  return (
    <>
      <Section title={t('inventory.roles')}>
        {inv.serverRoles && inv.serverRoles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {inv.serverRoles.map((r) => (
              <Badge key={r} tone="indigo">
                {r}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-slate-400">{t('inventory.none')}</p>
        )}
      </Section>
      <Section title={t('inventory.guests')}>
        <Table
          head={[t('inventory.name'), t('inventory.type'), t('inventory.state'), t('inventory.image')]}
          rows={(inv.virtualMachines ?? []).map((g) => [g.name, g.type, g.state, g.image])}
        />
      </Section>
    </>
  );
}
