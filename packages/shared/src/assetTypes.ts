// The kinds of equipment in the inventory, grouped the way an IT team thinks
// about them -- docs/adr/0076-directory-payments-inventory.md. One list for
// the API's validation, the console's pickers and the MCP server, so a new
// type is added in one place (plus the AssetType enum in schema.prisma).

export const ASSET_TYPE_GROUPS = {
  computers: ['WORKSTATION', 'LAPTOP', 'SERVER', 'TABLET', 'MOBILE_DEVICE'],
  network: ['NETWORK_DEVICE', 'SWITCH', 'ROUTER', 'FIREWALL', 'ACCESS_POINT'],
  peripherals: ['MONITOR', 'PERIPHERAL', 'DOCKING_STATION', 'PRINTER', 'SCANNER', 'PROJECTOR', 'IP_PHONE', 'CAMERA'],
  infrastructure: ['STORAGE', 'UPS'],
  other: ['OTHER'],
} as const;

export type AssetTypeGroup = keyof typeof ASSET_TYPE_GROUPS;
export type AssetTypeName = (typeof ASSET_TYPE_GROUPS)[AssetTypeGroup][number];

export const ASSET_TYPES = Object.values(ASSET_TYPE_GROUPS).flat() as AssetTypeName[];

export function assetTypeGroup(type: string): AssetTypeGroup {
  for (const [group, types] of Object.entries(ASSET_TYPE_GROUPS)) {
    if ((types as readonly string[]).includes(type)) return group as AssetTypeGroup;
  }
  return 'other';
}
