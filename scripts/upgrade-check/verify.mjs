// Reads the previous release's data back through *this* code's API after the
// upgrade (see scripts/upgrade-check.sh). Checks what every release must keep
// working, not any one feature: sign-in with old passwords, every ticket and
// its conversation, assignments, and that new tickets continue the numbering.
import { readFileSync } from 'node:fs';

const API = process.env.API ?? 'http://localhost:4191';
const seed = JSON.parse(readFileSync(process.env.SEED, 'utf8'));
let failed = 0;

async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function check(label, ok, detail = '') {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed++;
}

const login = (email) => call('POST', '/auth/login', { tenantSlug: 'upgrade-check', email, password: seed.password });
const { token } = await login('admin@upgrade-check.test');
const agent = await login('agent@upgrade-check.test');
check('old passwords still sign in', Boolean(token && agent.token));

const listed = await call('GET', '/tickets', null, token);
const tickets = listed.tickets ?? listed;
check('every ticket is listed', tickets.length === seed.tickets.length, `${tickets.length}/${seed.tickets.length}`);

for (const old of seed.tickets) {
  const ticket = await call('GET', `/tickets/${old.id}`, null, token);
  const conversation = ticket.messages ?? [];
  check(`#${old.number} reads back with its conversation`, ticket.subject === old.subject && conversation.length >= 3, `${conversation.length} messages`);
}
const assigned = await call('GET', `/tickets/${seed.tickets[0].id}`, null, token);
check('assignment kept', assigned.assigneeId === seed.agentId);

const next = await call('POST', '/tickets', { subject: 'After the upgrade', body: 'x', contactEmail: 'customer1@upgrade-check.test', contactName: 'Customer 1' }, token);
const lastNumber = Math.max(...seed.tickets.map((t) => t.number));
check('new tickets continue the numbering', next.number === lastNumber + 1, `#${next.number}`);

const prefs = await call('GET', '/notification-preferences', null, agent.token);
const assignedPref = (prefs.preferences ?? []).find((p) => p.eventType === 'TICKET_ASSIGNED');
if (seed.prefSet) check('notification choices kept', assignedPref?.email === true);

if (failed > 0) {
  console.error(`[upgrade-check] ${failed} check(s) failed`);
  process.exit(1);
}
