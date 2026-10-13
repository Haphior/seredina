import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@seredina/db';
import { buildApp } from '../src/index';
import { compareVersions } from '../src/modules/updates/service';

describe('version order', () => {
  it('compares release tags the semver way', () => {
    expect(compareVersions('v0.4.0', 'v0.3.1')).toBe(1);
    expect(compareVersions('v0.3.1', 'v0.3.1')).toBe(0);
    expect(compareVersions('v0.10.0', 'v0.9.9')).toBe(1);
    expect(compareVersions('v1.0.0-rc.1', 'v1.0.0')).toBe(-1);
    expect(compareVersions('v1.0.0-rc.2', 'v1.0.0-rc.1')).toBe(1);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);

/** A stand-in for GitHub's releases API and for the updater service. */
function fakeServer(handler: (path: string, body: unknown, auth: string | undefined) => [number, unknown]) {
  const calls: { path: string; body: unknown; auth?: string }[] = [];
  const server = createServer(async (req, res) => {
    let data = '';
    for await (const c of req) data += c;
    const body = data ? JSON.parse(data) : undefined;
    calls.push({ path: req.url ?? '', body, auth: req.headers.authorization });
    const [status, payload] = handler(req.url ?? '', body, req.headers.authorization);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  return { server, calls };
}

const listen = (s: Server) => new Promise<string>((r) => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

describe.skipIf(!hasDb)('in-app updates', () => {
  const app = buildApp();
  let token: string;
  const as = () => ({ authorization: `Bearer ${token}` });
  const github = fakeServer((path, _b, auth) => {
    if (path.startsWith('/repos/Haphior/seredina/releases')) {
      return [
        200,
        [
          { tag_name: 'v99.1.0-rc.1', name: 'RC', body: 'rc', published_at: '2026-10-12T00:00:00Z', html_url: 'https://x/rc', draft: false, prerelease: true },
          { tag_name: 'v99.0.0', name: 'v99.0.0', body: '## Novedades\n- Todo', published_at: '2026-10-10T00:00:00Z', html_url: 'https://x/99', draft: false, prerelease: false },
          { tag_name: 'v99.2.0', name: 'draft', body: '', published_at: null, html_url: 'https://x/d', draft: true, prerelease: false },
          { tag_name: 'v0.0.1', name: 'old', body: '', published_at: '2020-01-01T00:00:00Z', html_url: 'https://x/old', draft: false, prerelease: false },
        ],
      ];
    }
    if (path.startsWith('/repos/acme/private/releases')) {
      return auth === 'Bearer secret-gh-token' ? [200, []] : [404, { message: 'Not Found' }];
    }
    return [404, {}];
  });
  const updater = fakeServer((path) => {
    if (path === '/status') return [200, { state: 'idle', target: null, startedAt: null, finishedAt: null, log: [], checkout: 'v0.3.1' }];
    if (path === '/update') return [202, { state: 'running', target: 'v99.0.0', startedAt: new Date().toISOString(), finishedAt: null, log: [] }];
    if (path === '/tags') return [200, { tags: ['v0.1.0', 'v99.3.0', 'v99.4.0-beta'] }];
    return [404, {}];
  });

  beforeAll(async () => {
    process.env.GITHUB_API_URL = await listen(github.server);
    process.env.UPDATER_URL = await listen(updater.server);
    process.env.UPDATER_TOKEN = 'u'.repeat(64);
    await prisma.instanceSetting.deleteMany({ where: { key: { startsWith: 'updates.' } } });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: '10.99.1.1',
      payload: { tenantSlug: `upd-${randomUUID().slice(0, 8)}`, tenantName: 'Upd', adminEmail: 'admin@upd.test', adminName: 'Admin', password: 'admin-password-1' },
    });
    token = res.json().token;
    process.env.SEREDINA_MODE = 'self_hosted';
  });

  afterAll(async () => {
    delete process.env.SEREDINA_MODE;
    delete process.env.UPDATER_TOKEN;
    github.server.close();
    updater.server.close();
    await prisma.instanceSetting.deleteMany({ where: { key: { startsWith: 'updates.' } } });
    await app.close();
  });

  it('is not offered on a cloud install', async () => {
    process.env.SEREDINA_MODE = 'cloud';
    expect((await app.inject({ method: 'GET', url: '/system/updates', headers: as() })).statusCode).toBe(404);
    process.env.SEREDINA_MODE = 'self_hosted';
  });

  it('finds newer releases on GitHub, without drafts, pre-releases or older ones', async () => {
    const view = (await app.inject({ method: 'GET', url: '/system/updates', headers: as() })).json();
    expect(view).toMatchObject({ activeId: 'github-default', updater: { enabled: true, reachable: true } });
    expect(view.sources).toEqual([expect.objectContaining({ id: 'github-default', location: 'Haphior/seredina', builtin: true, hasToken: false })]);

    const check = (await app.inject({ method: 'POST', url: '/system/updates/check', headers: as() })).json();
    expect(check).toMatchObject({ latest: 'v99.0.0', updateAvailable: true });
    expect(check.releases.map((r: { version: string }) => r.version)).toEqual(['v99.0.0']);
    expect(check.releases[0].notes).toContain('Novedades');
    // Remembered for the next visit.
    expect((await app.inject({ method: 'GET', url: '/system/updates', headers: as() })).json().lastCheck.latest).toBe('v99.0.0');
  });

  it('installs through the updater, from the active source', async () => {
    const res = await app.inject({ method: 'POST', url: '/system/updates/apply', headers: as(), payload: { version: 'v99.0.0' } });
    expect(res.statusCode).toBe(202);
    const call = updater.calls.find((c) => c.path === '/update')!;
    expect(call.auth).toBe(`Bearer ${'u'.repeat(64)}`);
    expect(call.body).toEqual({ version: 'v99.0.0', url: 'https://github.com/Haphior/seredina.git', lang: 'es' });
    expect((await app.inject({ method: 'POST', url: '/system/updates/apply', headers: as(), payload: { version: 'main; rm -rf /' } })).statusCode).toBe(400);
  });

  it('adds sources: a private GitHub fork with a token, and a git mirror', async () => {
    const bad = await app.inject({ method: 'POST', url: '/system/updates/sources', headers: as(), payload: { name: 'x', type: 'github', location: 'not a repo' } });
    expect(bad.statusCode).toBe(400);

    const fork = await app.inject({
      method: 'POST',
      url: '/system/updates/sources',
      headers: as(),
      payload: { name: 'Fork', type: 'github', location: 'acme/private', token: 'secret-gh-token' },
    });
    expect(fork.statusCode).toBe(201);
    const forkSource = fork.json().sources.find((s: { name: string }) => s.name === 'Fork');
    expect(forkSource).toMatchObject({ hasToken: true });
    expect(JSON.stringify(fork.json())).not.toContain('secret-gh-token');

    await app.inject({ method: 'PUT', url: '/system/updates/active-source', headers: as(), payload: { id: forkSource.id } });
    const check = (await app.inject({ method: 'POST', url: '/system/updates/check', headers: as() })).json();
    expect(check).toMatchObject({ latest: null, updateAvailable: false });
    await app.inject({ method: 'POST', url: '/system/updates/apply', headers: as(), payload: { version: 'v99.0.0' } });
    expect(updater.calls.filter((c) => c.path === '/update').at(-1)!.body).toMatchObject({
      url: 'https://x-access-token:secret-gh-token@github.com/acme/private.git',
    });

    const mirror = await app.inject({
      method: 'POST',
      url: '/system/updates/sources',
      headers: as(),
      payload: { name: 'Espejo', type: 'git', location: 'https://git.empresa.cl/ti/seredina.git' },
    });
    const mirrorSource = mirror.json().sources.find((s: { name: string }) => s.name === 'Espejo');
    await app.inject({ method: 'PUT', url: '/system/updates/active-source', headers: as(), payload: { id: mirrorSource.id } });
    const tags = (await app.inject({ method: 'POST', url: '/system/updates/check', headers: as() })).json();
    expect(tags).toMatchObject({ latest: 'v99.3.0', updateAvailable: true });

    // The default can't be removed; removing the active one falls back to it.
    expect((await app.inject({ method: 'DELETE', url: '/system/updates/sources/github-default', headers: as() })).statusCode).toBe(400);
    const removed = (await app.inject({ method: 'DELETE', url: `/system/updates/sources/${mirrorSource.id}`, headers: as() })).json();
    expect(removed.activeId).toBe('github-default');
  });

  it('works without the updater: checks still run, installing says how to enable it', async () => {
    delete process.env.UPDATER_TOKEN;
    const view = (await app.inject({ method: 'GET', url: '/system/updates', headers: as() })).json();
    expect(view.updater).toEqual({ enabled: false, reachable: false, status: null });
    const res = await app.inject({ method: 'POST', url: '/system/updates/apply', headers: as(), payload: { version: 'v99.0.0' } });
    expect(res.statusCode).toBe(409);
    process.env.UPDATER_TOKEN = 'u'.repeat(64);
  });
});
