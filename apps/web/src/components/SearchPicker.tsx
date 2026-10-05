import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface PickerOption {
  id: string;
  name: string;
  hint?: string | null;
}

/**
 * One record picked by typing part of its name: a person, an asset. Shows
 * the choice as a chip with a clear button; `search` runs a moment after
 * typing stops.
 */
export function SearchPicker({
  label,
  value,
  onChange,
  search,
  placeholder,
}: {
  label: string;
  value: PickerOption | null;
  onChange: (v: PickerOption | null) => void;
  search: (q: string) => Promise<PickerOption[]>;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickerOption[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      search(query.trim())
        .then((r) => !cancelled && setResults(r))
        .catch(() => !cancelled && setResults([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, search]);

  return (
    <div>
      <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-700">{label}</span>
      {value ? (
        <div className="flex items-center justify-between rounded-[9px] border border-slate-200 bg-slate-50 px-3 py-2 text-[13.5px]">
          <span className="truncate text-slate-800">
            {value.name}
            {value.hint && <span className="ml-1.5 text-[12px] text-slate-400">{value.hint}</span>}
          </span>
          <button type="button" onClick={() => onChange(null)} className="ml-2 text-[12px] font-semibold text-slate-400 hover:text-rose-600">
            {t('common.remove')}
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder ?? t('common.typeToSearch')}
            aria-label={label}
            className="w-full rounded-[9px] border border-slate-200 bg-white px-3 py-2 text-[13.5px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onChange(r);
                    setQuery('');
                    setResults([]);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-slate-50"
                >
                  {r.name}
                  {r.hint && <span className="ml-1.5 text-[12px] text-slate-400">{r.hint}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
