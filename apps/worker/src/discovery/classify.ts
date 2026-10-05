import type { AssetType } from '@seredina/db';

/**
 * A heuristic seed, not a fingerprinting engine -- substring-matches the SNMP
 * sysDescr banner (which vendors format however they like) against common markers.
 * Wrong or "OTHER" guesses are expected and fine to correct by hand later; the goal
 * is a useful starting classification for most of a scan, not a guarantee for all of it.
 *
 * Specific kinds are checked before the operating system: a NAS, a UPS card
 * or an access point often runs Linux, and "Linux" alone would file it as a
 * server (docs/adr/0076-directory-payments-inventory.md).
 */
const RULES: [AssetType, string[]][] = [
  ['PRINTER', ['printer', 'laserjet', 'officejet', 'deskjet', 'imagerunner', 'bizhub', 'workcentre', 'ecosys', 'mfp']],
  ['UPS', ['ups ', ' ups', 'apc web/snmp', 'network management card', 'smart-ups', 'eaton', 'powerware', 'liebert']],
  ['STORAGE', ['synology', 'diskstation', 'qnap', 'netapp', 'truenas', 'freenas', 'readynas', 'nas ']],
  ['IP_PHONE', ['ip phone', 'yealink', 'polycom', 'grandstream', 'snom', 'cisco ip phone']],
  ['CAMERA', ['ip camera', 'network camera', 'hikvision', 'dahua', 'axis ', 'nvr', 'dvr']],
  ['FIREWALL', ['fortigate', 'fortinet', 'palo alto', 'pan-os', 'sonicwall', 'pfsense', 'opnsense', 'sophos', 'checkpoint', 'firewall', 'adaptive security appliance']],
  ['ACCESS_POINT', ['access point', 'unifi ap', 'uap-', 'aironet', 'aruba ap', 'instant on ap', 'wireless ap']],
  ['SWITCH', ['switch', 'catalyst', 'procurve', 'aruba 2', 'powerconnect', 'netgear gs', 'tl-sg', 'edgeswitch', 'usw-', 'cbs3', 'sg3']],
  ['ROUTER', ['router', 'routeros', 'mikrotik', 'edgerouter', ' isr', 'ios xe', 'juniper', 'junos']],
];

export function classifyAsset(sysDescr: string | undefined): AssetType {
  if (!sysDescr) return 'OTHER';
  const d = ` ${sysDescr.toLowerCase()} `;

  for (const [type, markers] of RULES) {
    if (markers.some((m) => d.includes(m))) return type;
  }
  if (d.includes('windows')) return d.includes('server') ? 'SERVER' : 'WORKSTATION';
  if (d.includes('linux') || d.includes('ubuntu') || d.includes('debian') || d.includes('centos')) return 'SERVER';
  // Network vendors whose banners don't say which kind of device it is.
  if (d.includes('cisco') || d.includes('ubiquiti') || d.includes('unifi') || d.includes('tp-link') || d.includes('huawei')) return 'NETWORK_DEVICE';

  return 'OTHER';
}
