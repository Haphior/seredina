import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { apiGet } from '../lib/api';
import { SETTINGS_GROUPS, SIDEBAR_GROUPS, settingsItemFor } from '../lib/navigation';
import { useMediaQuery } from '../lib/useMediaQuery';
import { ThemeProvider } from '../theme/ThemeContext';
import { Avatar } from './Avatar';
import { GuidedTour } from './GuidedTour';
import { LanguageSwitcher } from './LanguageSwitcher';
import { NotificationBell } from './NotificationBell';
import { BackArrowIcon, CloseIcon, GearIcon, HelpIcon, LogoutIcon, MenuIcon, ShieldIcon } from './icons';
import { Logo } from './Logo';
import { roleDisplayName } from '../lib/format';

interface Me {
  name: string;
  email: string;
  role: { key: string } | null;
  tenantName: string;
  tourCompletedAt: string | null;
}

export function Layout() {
  const { t } = useTranslation();
  const { logout, hasPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [showTour, setShowTour] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // One sidebar mounted at a time (it holds the bell, which polls, and the
  // tour's anchors): the fixed one from md up, the drawer below.
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const currentSetting = settingsItemFor(location.pathname);
  const hasAnySettings = SETTINGS_GROUPS.some((g) => g.items.some((i) => !i.permission || hasPermission(i.permission)));

  // The drawer closes once you've picked where to go.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    apiGet<Me>('/auth/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  // Auto-runs once, for a user who's never seen it, on first landing at
  // /dashboard (where a fresh login/registration always redirects to) --
  // one of the tour's own steps points at the Dashboard's "Get started"
  // widget, so running it from any other page would just show that step's
  // fallback centered card instead of the real thing. Replaying it later
  // (the help button below) always navigates to /dashboard first for the
  // same reason.
  useEffect(() => {
    if (me && !me.tourCompletedAt && location.pathname === '/dashboard') {
      setShowTour(true);
    }
  }, [me, location.pathname]);

  // inDrawer: on a phone the top bar already has the bell, so the drawer's
  // header has its close button there instead.
  const renderSidebar = (inDrawer: boolean) => (
    <>
        <div className="flex flex-col gap-0.5 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <Logo size={26} />
              <span className="text-[15px] font-extrabold tracking-tight text-slate-900">Seredina</span>
            </div>
            {inDrawer ? (
              <button onClick={() => setDrawerOpen(false)} aria-label={t('layout.closeMenu')} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <CloseIcon width={18} height={18} />
              </button>
            ) : (
              <NotificationBell />
            )}
          </div>
          <span className="truncate pl-[35px] text-xs text-slate-400">{me?.tenantName ?? ' '}</span>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {SIDEBAR_GROUPS.map((group) => {
            const visibleItems = group.items.filter((item) => !item.permission || hasPermission(item.permission));
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.labelKey}>
                <span className="mb-1 block px-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {t(`nav.groups.${group.labelKey}`)}
                </span>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      data-tour={`nav-${item.itemKey}`}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium ${
                          isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                        }`
                      }
                    >
                      <item.icon />
                      {t(`nav.items.${item.itemKey}`)}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
          {hasAnySettings && (
            <div>
              <NavLink
                to="/settings"
                data-tour="nav-settings"
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium ${
                    isActive || currentSetting ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                <GearIcon />
                {t('nav.items.settings')}
              </NavLink>
            </div>
          )}
        </nav>

        <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5">
          <div className="flex-1" data-tour="language-switcher">
            <LanguageSwitcher />
          </div>
          <button
            onClick={() => {
              if (location.pathname !== '/dashboard') navigate('/dashboard');
              setShowTour(true);
            }}
            aria-label={t('tour.replay')}
            title={t('tour.replay')}
            className="flex-shrink-0 text-slate-400 hover:text-slate-700"
          >
            <HelpIcon width={16} height={16} />
          </button>
        </div>
        <div className="flex items-center gap-2.5 border-t border-slate-100 px-4 py-3.5">
          <Avatar name={me?.name ?? '?'} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-slate-800">{me?.name ?? '…'}</div>
            <div className="truncate text-[11.5px] text-slate-400">{me?.role ? roleDisplayName({ key: me.role.key, name: me.role.key }, t) : ''}</div>
          </div>
          <button
            onClick={() => navigate('/account/security')}
            aria-label={t('layout.accountSecurity')}
            title={t('layout.accountSecurity')}
            className="flex-shrink-0 text-slate-400 hover:text-slate-700"
          >
            <ShieldIcon width={16} height={16} />
          </button>
          <button onClick={logout} aria-label={t('layout.logOut')} className="flex-shrink-0 text-slate-400 hover:text-slate-700">
            <LogoutIcon width={16} height={16} />
          </button>
        </div>
    </>
  );

  return (
    <ThemeProvider>
    <div className="flex h-screen flex-col bg-slate-50 font-sans text-slate-900 md:flex-row">
      {/* Phones and small tablets: a top bar, and the sidebar as a drawer. */}
      {!isDesktop && (
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label={t('layout.openMenu')}
          aria-expanded={drawerOpen}
          className="-ml-1 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
        >
          <MenuIcon width={20} height={20} />
        </button>
        <Link to="/dashboard" className="flex min-w-0 items-center gap-2">
          <Logo size={22} />
          <span className="truncate text-[14.5px] font-extrabold tracking-tight text-slate-900">{me?.tenantName ?? 'Seredina'}</span>
        </Link>
        {!drawerOpen && <NotificationBell />}
      </header>
      )}
      {!isDesktop && drawerOpen && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={t('layout.menu')}>
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawerOpen(false)} />
          <aside className="relative flex h-full w-[280px] max-w-[85vw] flex-col bg-white shadow-xl">
            {renderSidebar(true)}
          </aside>
        </div>
      )}

      {isDesktop && <aside className="flex w-[248px] flex-shrink-0 flex-col border-r border-slate-200 bg-white">{renderSidebar(false)}</aside>}
      <main className="min-w-0 flex-1 overflow-y-auto">
        {currentSetting && (
          <div className="px-4 pt-4 md:px-8 md:pt-5">
            <Link to="/settings" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-400 hover:text-indigo-600">
              <BackArrowIcon width={13} height={13} />
              {t('nav.items.settings')}
            </Link>
          </div>
        )}
        <Outlet />
      </main>
      {showTour && location.pathname === '/dashboard' && (
        <GuidedTour onClose={() => setShowTour(false)} />
      )}
    </div>
    </ThemeProvider>
  );
}
