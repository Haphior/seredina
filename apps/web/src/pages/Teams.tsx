import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import type { Team, UserSummary } from '../lib/types';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';

export function Teams() {
  const { t } = useTranslation();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);

  function load() {
    Promise.all([apiGet<{ teams: Team[] }>('/teams'), apiGet<{ users: UserSummary[] }>('/users')])
      .then(([teamRes, userRes]) => {
        setTeams(teamRes.teams);
        setUsers(userRes.users.filter((u) => u.isActive));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('teams.loadFailed')));
  }

  useEffect(load, []);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  async function remove(team: Team) {
    const message = team.ticketCount
      ? t('teams.confirmDeleteWithTickets', { name: team.name, count: team.ticketCount })
      : t('teams.confirmDelete', { name: team.name });
    if (!confirm(message)) return;
    try {
      await apiDelete(`/teams/${team.id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('teams.deleteFailed'));
    }
  }

  return (
    <div className="px-8 py-7">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">{t('teams.title')}</h1>
        <Button onClick={() => setShowCreate(true)}>{t('teams.new')}</Button>
      </div>
      <p className="mb-5 text-[13.5px] text-slate-500">{t('teams.intro')}</p>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
      {teams === null && !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>}

      {teams && teams.length === 0 && (
        <Card className="flex flex-col items-start gap-3">
          <p className="text-[14px] text-slate-600">{t('teams.empty')}</p>
          <Button size="sm" onClick={() => setShowCreate(true)}>{t('teams.new')}</Button>
        </Card>
      )}

      {teams && teams.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-slate-100">
            {teams.map((team) => {
              const members = (team.memberIds ?? []).map((id) => userById.get(id)).filter((u): u is UserSummary => Boolean(u));
              return (
                <div key={team.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-slate-800">{team.name}</div>
                    <div className="text-[12.5px] text-slate-500">
                      {t('teams.memberCount', { count: members.length })} · {t('teams.ticketCount', { count: team.ticketCount ?? 0 })}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex -space-x-2">
                      {members.slice(0, 6).map((u) => (
                        <span key={u.id} title={u.name} className="rounded-full ring-2 ring-white">
                          <Avatar name={u.name} size={28} />
                        </span>
                      ))}
                      {members.length > 6 && (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 ring-2 ring-white">
                          +{members.length - 6}
                        </span>
                      )}
                    </div>
                    <button onClick={() => setEditing(team)} className="text-xs text-slate-400 hover:text-indigo-600">
                      {t('teams.edit')}
                    </button>
                    <button onClick={() => remove(team)} className="text-xs text-slate-400 hover:text-rose-600">
                      {t('teams.delete')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {showCreate && <TeamModal users={users} onClose={() => setShowCreate(false)} onSaved={load} />}
      {editing && <TeamModal team={editing} users={users} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function TeamModal({
  team,
  users,
  onClose,
  onSaved,
}: {
  team?: Team;
  users: UserSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(team?.name ?? '');
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set(team?.memberIds ?? []));
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const visible = users.filter((u) => {
    const q = filter.trim().toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  function toggle(id: string) {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = { name, memberIds: [...memberIds] };
      if (team) await apiPatch(`/teams/${team.id}`, body);
      else await apiPost('/teams', body);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('teams.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={team ? t('teams.editTitle', { name: team.name }) : t('teams.new')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Input label={t('teams.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('teams.namePlaceholder')} required maxLength={100} />

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-slate-700">{t('teams.members')}</span>
            <span className="text-[12px] text-slate-400">{t('teams.selected', { count: memberIds.size })}</span>
          </div>
          {users.length > 6 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('teams.searchPeople')}
              aria-label={t('teams.searchPeople')}
              className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] outline-none focus:border-indigo-400"
            />
          )}
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            {visible.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50">
                <input type="checkbox" checked={memberIds.has(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4 accent-indigo-600" />
                <Avatar name={u.name} size={28} />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] text-slate-800">{u.name}</span>
                  <span className="block truncate text-[12px] text-slate-400">{u.email}</span>
                </span>
              </label>
            ))}
            {visible.length === 0 && <p className="px-3 py-3 text-[13px] text-slate-400">{t('teams.noPeople')}</p>}
          </div>
          <span className="mt-1 block text-xs text-slate-400">{t('teams.membersHint')}</span>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
