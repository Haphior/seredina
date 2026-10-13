import { randomUUID } from 'node:crypto';
import { prisma, type Prisma } from '@seredina/db';
import { decryptSecret, encryptSecret } from '@seredina/shared';
import { SEREDINA_VERSION } from '../../lib/version';

/**
 * In-app updates for a self-hosted install (docs/adr/0077-in-app-updates.md).
 * The API finds out which releases exist, from GitHub (the default) or any
 * git repository the admin adds, and asks the `updater` service to install
 * one. The updater is the only part that touches the host (git, Docker); it
 * is optional, and without it this still answers "is there a new version"
 * and shows the commands to run by hand.
 */

export class UpdateError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type SourceType = 'github' | 'git';

export interface UpdateSource {
  id: string;
  name: string;
  type: SourceType;
  /** owner/repo for GitHub; a clone URL for git. */
  location: string;
  /** For a private repository: a GitHub token, or a git password/token. Encrypted at rest. */
  tokenEncrypted?: string | null;
  includePrereleases?: boolean;
  builtin?: boolean;
}

export interface ReleaseInfo {
  version: string; // the tag, e.g. v0.4.0
  name: string | null;
  notes: string | null;
  publishedAt: string | null;
  url: string | null;
  prerelease: boolean;
}

export const DEFAULT_SOURCE: UpdateSource = {
  id: 'github-default',
  name: 'GitHub (Haphior/seredina)',
  type: 'github',
  location: 'Haphior/seredina',
  builtin: true,
};

const SOURCES_KEY = 'updates.sources';
const LAST_CHECK_KEY = 'updates.lastCheck';
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function isSelfHosted(): boolean {
  return process.env.SEREDINA_MODE === 'self_hosted';
}

function encryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY is not set');
  return key;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** -1, 0 or 1, comparing v1.2.3[-pre] tags the semver way (a prerelease sorts before its release). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('-', 2);
    return { nums: core.split('.').map((n) => Number(n) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) < (y.nums[i] ?? 0) ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export function currentVersion(): string {
  return SEREDINA_VERSION === 'dev' ? 'dev' : `v${SEREDINA_VERSION.replace(/^v/, '')}`;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

interface StoredSources {
  sources: UpdateSource[];
  activeId: string;
}

async function readSetting<T>(key: string): Promise<T | null> {
  const row = await prisma.instanceSetting.findUnique({ where: { key } });
  return row ? (row.value as unknown as T) : null;
}

async function writeSetting(key: string, value: unknown) {
  await prisma.instanceSetting.upsert({
    where: { key },
    create: { key, value: value as Prisma.InputJsonValue },
    update: { value: value as Prisma.InputJsonValue },
  });
}

async function loadSources(): Promise<StoredSources> {
  const stored = await readSetting<StoredSources>(SOURCES_KEY);
  const custom = (stored?.sources ?? []).filter((s) => !s.builtin);
  const sources = [DEFAULT_SOURCE, ...custom];
  const activeId = sources.some((s) => s.id === stored?.activeId) ? stored!.activeId : DEFAULT_SOURCE.id;
  return { sources, activeId };
}

/** What the console sees: never the token, only whether one is set. */
function publicSource(s: UpdateSource) {
  const { tokenEncrypted, ...rest } = s;
  return { ...rest, hasToken: Boolean(tokenEncrypted), builtin: Boolean(s.builtin) };
}

export interface SourceInput {
  name: string;
  type: SourceType;
  location: string;
  /** undefined = keep, '' or null = remove, a string = set. */
  token?: string | null;
  includePrereleases?: boolean;
}

function validateSource(input: SourceInput) {
  if (input.type === 'github' && !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(input.location)) {
    throw new UpdateError('Write the GitHub repository as owner/name, for example Haphior/seredina.');
  }
  if (input.type === 'git' && !/^(https?:\/\/|ssh:\/\/|git@)[^\s"'<>]+$/.test(input.location)) {
    throw new UpdateError('Write a git repository URL, for example https://git.example.com/it/seredina.git.');
  }
}

export async function getSources() {
  const { sources, activeId } = await loadSources();
  return { sources: sources.map(publicSource), activeId };
}

export async function saveSource(id: string | null, input: SourceInput) {
  validateSource(input);
  const { sources, activeId } = await loadSources();
  if (id === DEFAULT_SOURCE.id) throw new UpdateError('The default source cannot be changed. Add another one instead.');
  const existing = id ? sources.find((s) => s.id === id) : undefined;
  if (id && !existing) throw new UpdateError('source not found', 404);
  const tokenEncrypted =
    input.token === undefined ? existing?.tokenEncrypted ?? null : input.token ? encryptSecret(input.token, encryptionKey()) : null;
  const source: UpdateSource = {
    id: existing?.id ?? randomUUID(),
    name: input.name.trim(),
    type: input.type,
    location: input.location.trim(),
    tokenEncrypted,
    includePrereleases: Boolean(input.includePrereleases),
  };
  const next = existing ? sources.map((s) => (s.id === source.id ? source : s)) : [...sources, source];
  await writeSetting(SOURCES_KEY, { sources: next.filter((s) => !s.builtin), activeId });
  return getSources();
}

export async function deleteSource(id: string) {
  if (id === DEFAULT_SOURCE.id) throw new UpdateError('The default source cannot be removed.');
  const { sources, activeId } = await loadSources();
  if (!sources.some((s) => s.id === id)) throw new UpdateError('source not found', 404);
  const next = sources.filter((s) => s.id !== id && !s.builtin);
  await writeSetting(SOURCES_KEY, { sources: next, activeId: activeId === id ? DEFAULT_SOURCE.id : activeId });
  return getSources();
}

export async function setActiveSource(id: string) {
  const { sources } = await loadSources();
  if (!sources.some((s) => s.id === id)) throw new UpdateError('source not found', 404);
  await writeSetting(SOURCES_KEY, { sources: sources.filter((s) => !s.builtin), activeId: id });
  return getSources();
}

// ---------------------------------------------------------------------------
// The updater service
// ---------------------------------------------------------------------------

function updaterConfig() {
  const token = process.env.UPDATER_TOKEN;
  if (!token) return null;
  return { url: (process.env.UPDATER_URL ?? 'http://updater:8090').replace(/\/$/, ''), token };
}

async function callUpdater<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const cfg = updaterConfig();
  if (!cfg) throw new UpdateError('The updater service is not enabled on this server.', 409);
  let res: Response;
  try {
    res = await fetch(`${cfg.url}${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    });
  } catch {
    throw new UpdateError('The updater service is not responding. Check that its container is running.', 502);
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new UpdateError(body.error ?? `updater error ${res.status}`, res.status === 409 ? 409 : 502);
  return body;
}

export interface UpdaterStatus {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  target: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  log: string[];
  checkout: string | null;
}

export async function updaterStatus(): Promise<{ enabled: boolean; reachable: boolean; status: UpdaterStatus | null }> {
  if (!updaterConfig()) return { enabled: false, reachable: false, status: null };
  try {
    return { enabled: true, reachable: true, status: await callUpdater<UpdaterStatus>('/status', { timeoutMs: 5_000 }) };
  } catch {
    return { enabled: true, reachable: false, status: null };
  }
}

// ---------------------------------------------------------------------------
// Checking for releases
// ---------------------------------------------------------------------------

async function githubReleases(source: UpdateSource): Promise<ReleaseInfo[]> {
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'seredina-updater' };
  if (source.tokenEncrypted) headers.authorization = `Bearer ${decryptSecret(source.tokenEncrypted, encryptionKey())}`;
  const base = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/repos/${source.location}/releases?per_page=30`, { headers, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UpdateError('Could not reach GitHub from this server. Check its internet access.', 502);
  }
  if (res.status === 404) throw new UpdateError('Repository not found on GitHub (or it is private and needs a token).', 502);
  if (!res.ok) throw new UpdateError(`GitHub answered ${res.status}.`, 502);
  const rows = (await res.json()) as {
    tag_name: string;
    name: string | null;
    body: string | null;
    published_at: string | null;
    html_url: string;
    draft: boolean;
    prerelease: boolean;
  }[];
  return rows
    .filter((r) => !r.draft && TAG.test(r.tag_name) && (source.includePrereleases || !r.prerelease))
    .map((r) => ({ version: r.tag_name, name: r.name, notes: r.body, publishedAt: r.published_at, url: r.html_url, prerelease: r.prerelease }));
}

async function gitReleases(source: UpdateSource): Promise<ReleaseInfo[]> {
  // Listing a git repository's tags needs git, which only the updater has.
  const { tags } = await callUpdater<{ tags: string[] }>('/tags', { method: 'POST', body: { url: authenticatedGitUrl(source) }, timeoutMs: 30_000 });
  return tags
    .filter((t) => TAG.test(t) && (source.includePrereleases || !t.includes('-')))
    .map((t) => ({ version: t, name: null, notes: null, publishedAt: null, url: null, prerelease: t.includes('-') }));
}

/** The clone URL the updater fetches from, with the token in it for a private repository. */
function authenticatedGitUrl(source: UpdateSource): string {
  const token = source.tokenEncrypted ? decryptSecret(source.tokenEncrypted, encryptionKey()) : null;
  if (source.type === 'github') {
    return token ? `https://x-access-token:${encodeURIComponent(token)}@github.com/${source.location}.git` : `https://github.com/${source.location}.git`;
  }
  if (token && /^https?:\/\//.test(source.location)) {
    const url = new URL(source.location);
    url.username = url.username || 'oauth2';
    url.password = token;
    return url.toString();
  }
  return source.location;
}

export interface CheckResult {
  checkedAt: string;
  sourceId: string;
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releases: ReleaseInfo[];
}

export async function checkForUpdates(): Promise<CheckResult> {
  const { sources, activeId } = await loadSources();
  const source = sources.find((s) => s.id === activeId) ?? DEFAULT_SOURCE;
  const releases = (source.type === 'github' ? await githubReleases(source) : await gitReleases(source)).sort((a, b) =>
    compareVersions(b.version, a.version),
  );
  const current = currentVersion();
  const latest = releases[0]?.version ?? null;
  const result: CheckResult = {
    checkedAt: new Date().toISOString(),
    sourceId: source.id,
    current,
    latest,
    updateAvailable: Boolean(latest && current !== 'dev' && compareVersions(latest, current) > 0),
    // Newer releases, plus the running one for reference; older ones aren't offered.
    releases: releases.filter((r) => current === 'dev' || compareVersions(r.version, current) >= 0).slice(0, 15),
  };
  await writeSetting(LAST_CHECK_KEY, result);
  return result;
}

export async function lastCheck(): Promise<CheckResult | null> {
  return readSetting<CheckResult>(LAST_CHECK_KEY);
}

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

/** Hands the update to the updater: back up, fetch the tag, rebuild. */
export async function startUpdate(version: string, language: 'es' | 'en' = 'es') {
  if (!TAG.test(version)) throw new UpdateError('Pick a release version, such as v0.4.0.');
  const { sources, activeId } = await loadSources();
  const source = sources.find((s) => s.id === activeId) ?? DEFAULT_SOURCE;
  return callUpdater<UpdaterStatus>('/update', {
    method: 'POST',
    body: { version, url: authenticatedGitUrl(source), lang: language },
    timeoutMs: 15_000,
  });
}
