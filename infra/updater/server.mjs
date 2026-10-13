// The updater service (docs/adr/0077-in-app-updates.md): the only part of
// Seredina that touches the host. It runs in its own container with the
// Docker socket and the installation's folder mounted, listens only on the
// compose network, and does exactly two things for the API, which must
// present UPDATER_TOKEN:
//
//   POST /tags    list a git repository's release tags (git ls-remote)
//   POST /update  back up the database, check out a release tag, rebuild
//   GET  /status  the running or last update, with its log
//
// No dependencies: plain Node. The code is read from the mounted
// installation, so after an update the container restarts into the new
// version of this file.
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';

const PORT = Number(process.env.UPDATER_PORT ?? 8090);
const TOKEN = process.env.UPDATER_TOKEN ?? '';
const DIR = process.env.SEREDINA_HOST_DIR ?? '';
const STATE_DIR = join(DIR, '.seredina-update');
const STATE_FILE = join(STATE_DIR, 'state.json');
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const URL_OK = /^(https?:\/\/|ssh:\/\/|git@)[^\s"'<>`$\;|&]+$/;
const MAX_LOG = 400;

if (!TOKEN || TOKEN.length < 32) {
  console.error('[updater] UPDATER_TOKEN must be set (32+ characters); refusing to start');
  process.exit(1);
}
if (!DIR || !existsSync(join(DIR, 'infra', 'docker-compose.yml'))) {
  console.error('[updater] SEREDINA_HOST_DIR must be the installation folder, mounted at the same path');
  process.exit(1);
}
mkdirSync(STATE_DIR, { recursive: true });

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { state: 'idle', target: null, startedAt: null, finishedAt: null, log: [] };
  }
}
function writeState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

// An update interrupted by a restart of this container can't still be running.
{
  const s = readState();
  if (s.state === 'running') {
    s.state = 'failed';
    s.finishedAt = new Date().toISOString();
    s.log.push('The updater restarted while the update was running.');
    writeState(s);
  }
}

/** Tokens and passwords in URLs never reach the log. */
const redact = (line) => line.replace(/(https?:\/\/)[^@\s/]+@/g, '$1***@');

function currentCheckout() {
  return new Promise((resolve) => {
    execFile('git', ['-C', DIR, 'describe', '--tags', '--always'], (err, out) => resolve(err ? null : out.trim()));
  });
}

let running = null;

function startUpdate(version, url, lang) {
  const state = { state: 'running', target: version, startedAt: new Date().toISOString(), finishedAt: null, log: [] };
  writeState(state);
  // A copy: the checkout replaces update.sh while it runs, and bash reads
  // its script as it goes.
  const script = join(STATE_DIR, 'update.sh');
  copyFileSync(join(DIR, 'infra', 'updater', 'update.sh'), script);
  const child = spawn('bash', [script, version], {
    cwd: DIR,
    env: { ...process.env, SEREDINA_SOURCE_URL: url, UPDATE_LANG: lang === 'en' ? 'en' : 'es' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running = child;
  const onData = (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (!line.trim()) continue;
      state.log.push(redact(line));
      if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
    }
    writeState(state);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => {
    running = null;
    state.state = code === 0 ? 'succeeded' : 'failed';
    state.finishedAt = new Date().toISOString();
    writeState(state);
    // Restart into the new version of this file (the container's restart
    // policy brings it back), once the API has had time to read the result.
    if (code === 0) setTimeout(() => process.exit(0), 3000);
  });
  return state;
}

function listTags(url) {
  return new Promise((resolve, reject) => {
    execFile('git', ['ls-remote', '--tags', '--refs', url], { timeout: 25_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, out) => {
      if (err) return reject(new Error('Could not read the repository (check the URL and credentials).'));
      resolve(
        out
          .split('\n')
          .map((l) => l.split('\trefs/tags/')[1])
          .filter((t) => t && TAG.test(t)),
      );
    });
  });
}

function authorized(req) {
  const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer /, ''));
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 10_000) throw new Error('body too large');
  }
  return data ? JSON.parse(data) : {};
}

createServer(async (req, res) => {
  try {
    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && req.url === '/status') {
      return send(res, 200, { ...readState(), checkout: await currentCheckout() });
    }
    if (req.method === 'POST' && req.url === '/tags') {
      const { url } = await readBody(req);
      if (typeof url !== 'string' || !URL_OK.test(url)) return send(res, 400, { error: 'invalid repository URL' });
      return send(res, 200, { tags: await listTags(url) });
    }
    if (req.method === 'POST' && req.url === '/update') {
      const { version, url, lang } = await readBody(req);
      if (typeof version !== 'string' || !TAG.test(version)) return send(res, 400, { error: 'invalid version' });
      if (typeof url !== 'string' || !URL_OK.test(url)) return send(res, 400, { error: 'invalid repository URL' });
      if (running) return send(res, 409, { error: 'An update is already running.' });
      return send(res, 202, startUpdate(version, url, lang));
    }
    return send(res, 404, { error: 'not found' });
  } catch (err) {
    return send(res, 500, { error: err instanceof Error ? err.message : 'error' });
  }
}).listen(PORT, () => console.log(`[updater] listening on :${PORT} for ${DIR}`));
