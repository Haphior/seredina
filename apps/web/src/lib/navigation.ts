import type { ComponentType, SVGProps } from 'react';
import type { Permission } from './types';
import {
  AssetsIcon,
  BellIcon,
  BoltIcon,
  BookIcon,
  BrandIcon,
  BuildingIcon,
  CalendarIcon,
  CatalogIcon,
  CheckIcon,
  ChecklistIcon,
  ClockIcon,
  DashboardIcon,
  DevicesIcon,
  DownloadIcon,
  KeyIcon,
  LayersIcon,
  MailIcon,
  PaletteIcon,
  PaperPlaneIcon,
  ServiceMapIcon,
  ShieldIcon,
  SlidersIcon,
  SparkleIcon,
  TicketIcon,
  UsersIcon,
  WarningIcon,
  WebhookIcon,
} from '../components/icons';

export interface NavItem {
  to: string;
  /** Indexes `nav.items.*` (and `settings.descriptions.*` for settings pages). */
  itemKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  permission?: Permission;
}

export interface NavGroup {
  /** Indexes `nav.groups.*`. */
  labelKey: string;
  items: NavItem[];
}

/**
 * The sidebar: day-to-day work only. Everything that configures the
 * workspace lives on the Settings page (SETTINGS_GROUPS) -- 27 admin pages
 * in the sidebar buried the daily ones and pushed the rest below the fold.
 */
export const SIDEBAR_GROUPS: NavGroup[] = [
  {
    labelKey: 'work',
    items: [
      { to: '/dashboard', itemKey: 'dashboard', icon: DashboardIcon },
      { to: '/tickets', itemKey: 'tickets', icon: TicketIcon },
      { to: '/contacts', itemKey: 'contacts', icon: UsersIcon, permission: 'tickets:read' },
      { to: '/directory', itemKey: 'directory', icon: BuildingIcon, permission: 'tickets:read' },
      { to: '/processes', itemKey: 'processes', icon: ChecklistIcon, permission: 'tickets:write' },
      { to: '/problems', itemKey: 'problems', icon: WarningIcon, permission: 'tickets:write' },
      { to: '/knowledge-base', itemKey: 'knowledgeBase', icon: BookIcon, permission: 'tickets:read' },
    ],
  },
  {
    labelKey: 'cmdb',
    items: [
      { to: '/assets', itemKey: 'assets', icon: AssetsIcon },
      { to: '/devices', itemKey: 'devices', icon: DevicesIcon, permission: 'assets:read' },
      { to: '/contracts', itemKey: 'contracts', icon: CatalogIcon, permission: 'assets:read' },
      { to: '/equipment-catalog', itemKey: 'equipmentCatalog', icon: LayersIcon, permission: 'assets:manage' },
      { to: '/services', itemKey: 'services', icon: ServiceMapIcon, permission: 'assets:manage' },
    ],
  },
];

/** The Settings page, grouped by what you're trying to set up. */
export const SETTINGS_GROUPS: NavGroup[] = [
  {
    labelKey: 'channels',
    items: [
      { to: '/email-channels', itemKey: 'emailChannels', icon: MailIcon, permission: 'channels:manage' },
      { to: '/customer-emails', itemKey: 'customerEmails', icon: MailIcon, permission: 'channels:manage' },
      { to: '/customer-portal', itemKey: 'customerPortal', icon: UsersIcon, permission: 'tickets:manage_all' },
      { to: '/telegram', itemKey: 'telegram', icon: PaperPlaneIcon, permission: 'channels:manage' },
      { to: '/monitoring-integrations', itemKey: 'monitoringIntegrations', icon: WarningIcon, permission: 'channels:manage' },
      { to: '/webhooks', itemKey: 'webhooks', icon: WebhookIcon, permission: 'tickets:manage_all' },
      { to: '/api-keys', itemKey: 'apiKeys', icon: KeyIcon },
    ],
  },
  {
    labelKey: 'service',
    items: [
      { to: '/ticket-statuses', itemKey: 'ticketStatuses', icon: CheckIcon, permission: 'tickets:manage_all' },
      { to: '/sla-policies', itemKey: 'slaPolicies', icon: ClockIcon, permission: 'tickets:manage_all' },
      { to: '/business-hours', itemKey: 'businessHours', icon: CalendarIcon, permission: 'tickets:manage_all' },
      { to: '/macros', itemKey: 'macros', icon: BoltIcon, permission: 'tickets:manage_all' },
      { to: '/custom-fields', itemKey: 'customFields', icon: SlidersIcon, permission: 'tickets:manage_all' },
      { to: '/service-catalog', itemKey: 'serviceCatalog', icon: CatalogIcon, permission: 'tickets:manage_all' },
      { to: '/process-templates', itemKey: 'processTemplates', icon: ChecklistIcon, permission: 'tickets:manage_all' },
      { to: '/on-call', itemKey: 'onCall', icon: BellIcon, permission: 'tickets:manage_all' },
    ],
  },
  {
    labelKey: 'people',
    items: [
      { to: '/users', itemKey: 'users', icon: UsersIcon, permission: 'users:manage' },
      { to: '/teams', itemKey: 'teams', icon: UsersIcon, permission: 'tickets:manage_all' },
      { to: '/roles', itemKey: 'roles', icon: ShieldIcon, permission: 'roles:manage' },
      { to: '/notification-settings', itemKey: 'notificationSettings', icon: BellIcon },
      { to: '/sso', itemKey: 'sso', icon: KeyIcon, permission: 'users:manage' },
      { to: '/audit-log', itemKey: 'auditLog', icon: ChecklistIcon, permission: 'audit:read' },
    ],
  },
  {
    labelKey: 'ai',
    items: [
      { to: '/ai-settings', itemKey: 'aiSettings', icon: SparkleIcon, permission: 'tickets:manage_all' },
      { to: '/ai-usage', itemKey: 'aiUsage', icon: SparkleIcon, permission: 'tickets:manage_all' },
      { to: '/ai-agent-activity', itemKey: 'aiAgentActivity', icon: ShieldIcon, permission: 'tickets:manage_all' },
    ],
  },
  {
    labelKey: 'organization',
    items: [
      { to: '/setup', itemKey: 'setup', icon: ChecklistIcon, permission: 'tickets:manage_all' },
      { to: '/appearance', itemKey: 'appearance', icon: PaletteIcon, permission: 'tickets:manage_all' },
      { to: '/branding', itemKey: 'branding', icon: BrandIcon, permission: 'tickets:manage_all' },
      { to: '/data-export', itemKey: 'dataExport', icon: DownloadIcon, permission: 'tickets:manage_all' },
    ],
  },
];

export const SETTINGS_PATHS = new Set(SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.to)));

/** The settings item a path belongs to (including its sub-pages), if any. */
export function settingsItemFor(pathname: string): NavItem | undefined {
  for (const group of SETTINGS_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return item;
    }
  }
  return undefined;
}
