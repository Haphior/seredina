import type { AssetType } from './types';

/**
 * Equipment types grouped the way an IT team thinks about them. Mirrors
 * packages/shared/src/assetTypes.ts (the console doesn't depend on that
 * package) -- docs/adr/0076-directory-payments-inventory.md.
 */
export const ASSET_TYPE_GROUPS: { key: 'computers' | 'network' | 'peripherals' | 'infrastructure' | 'other'; types: AssetType[] }[] = [
  { key: 'computers', types: ['WORKSTATION', 'LAPTOP', 'SERVER', 'TABLET', 'MOBILE_DEVICE'] },
  { key: 'network', types: ['NETWORK_DEVICE', 'SWITCH', 'ROUTER', 'FIREWALL', 'ACCESS_POINT'] },
  { key: 'peripherals', types: ['MONITOR', 'PERIPHERAL', 'DOCKING_STATION', 'PRINTER', 'SCANNER', 'PROJECTOR', 'IP_PHONE', 'CAMERA'] },
  { key: 'infrastructure', types: ['STORAGE', 'UPS'] },
  { key: 'other', types: ['OTHER'] },
];

export const ASSET_TYPES: AssetType[] = ASSET_TYPE_GROUPS.flatMap((g) => g.types);
