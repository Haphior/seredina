import { useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from './Avatar';

export interface MentionCandidate {
  id: string;
  name: string;
  email: string;
}

/** The "@query" being typed right before the caret, if any. */
const ACTIVE_MENTION = /(^|\s)@([^\s@]{0,40})$/;

/**
 * The people a text mentions: everyone whose "@Full Name" appears in it.
 * Stateless on purpose -- deleting a mention from the text un-mentions them,
 * with nothing to keep in sync.
 */
export function mentionedIn(text: string, people: MentionCandidate[]): string[] {
  return people.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id);
}

/**
 * A textarea that, when `mentions` is on, offers colleagues after an "@" and
 * inserts "@Full Name". See docs/adr/0071-teams-and-notification-events.md.
 */
export function MentionTextarea({
  value,
  onValueChange,
  people,
  mentions,
  className = '',
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
  people: MentionCandidate[];
  mentions: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const matches =
    query === null
      ? []
      : people
          .filter((p) => {
            const q = query.toLowerCase();
            return p.name.toLowerCase().includes(q) || p.email.toLowerCase().startsWith(q);
          })
          .slice(0, 6);

  function refreshQuery(text: string, caret: number) {
    const m = mentions ? ACTIVE_MENTION.exec(text.slice(0, caret)) : null;
    setQuery(m ? m[2] : null);
    setHighlighted(0);
  }

  function pick(person: MentionCandidate) {
    const el = ref.current;
    if (!el || query === null) return;
    const caret = el.selectionStart;
    const start = caret - query.length - 1; // the "@"
    const next = `${value.slice(0, start)}@${person.name} ${value.slice(caret)}`;
    onValueChange(next);
    setQuery(null);
    const pos = start + person.name.length + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (query === null || matches.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(matches[highlighted]);
    } else if (e.key === 'Escape') {
      setQuery(null);
    }
  }

  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={ref}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          refreshQuery(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        aria-autocomplete={mentions ? 'list' : undefined}
        aria-expanded={query !== null}
        className={className}
      />
      {query !== null && (
        <div
          role="listbox"
          className="absolute bottom-full left-2 z-20 mb-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          {matches.length === 0 && <p className="px-3 py-2 text-[12.5px] text-slate-400">{t('ticketDetail.mentionNobody')}</p>}
          {matches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${i === highlighted ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
            >
              <Avatar name={p.name} size={22} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-slate-800">{p.name}</span>
                <span className="block truncate text-[11.5px] text-slate-400">{p.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
