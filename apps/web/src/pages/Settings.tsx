import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { SETTINGS_GROUPS } from '../lib/navigation';
import { SearchIcon } from '../components/icons';

/** Everything that configures the workspace, in one searchable place. */
export function Settings() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const groups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => !item.permission || hasPermission(item.permission))
      .map((item) => ({ ...item, name: t(`nav.items.${item.itemKey}`), description: t(`settings.descriptions.${item.itemKey}`) }))
      .filter((item) => !q || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="px-4 py-5 md:px-8 md:py-7">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 text-[22px] font-extrabold tracking-tight text-slate-900">{t('settings.title')}</h1>
          <p className="text-[13.5px] text-slate-500">{t('settings.intro')}</p>
        </div>
        <label className="relative w-full sm:w-72">
          <SearchIcon width={15} height={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.search')}
            aria-label={t('settings.search')}
            autoFocus
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-[13.5px] outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </label>
      </div>

      {groups.length === 0 && <p className="text-[13.5px] text-slate-500">{t('settings.noMatch')}</p>}

      <div className="flex flex-col gap-7">
        {groups.map((group) => (
          <section key={group.labelKey}>
            <h2 className="mb-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-400">{t(`nav.groups.${group.labelKey}`)}</h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                >
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600">
                    <item.icon width={16} height={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-slate-800">{item.name}</span>
                    <span className="block text-[12.5px] leading-snug text-slate-500">{item.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
