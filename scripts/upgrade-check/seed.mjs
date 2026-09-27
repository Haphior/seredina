// Fills the *previous* release with data through its own API (see
// scripts/upgrade-check.sh). Uses only long-standing endpoints so it keeps
// working as the "from" release moves forward; anything optional is tried
// and skipped if that release doesn't have it. Prints what verify.mjs needs.
const API = process.env.API ?? 'http://localhost:4191';
const PASSWORD = 'Upgrade-check!2026';

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

async function optional(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[seed] skipped ${label}: ${err.message}`);
    return null;
  }
}

const { token } = await call('POST', '/auth/register', {
  tenantSlug: 'upgrade-check',
  tenantName: 'Upgrade Check',
  adminEmail: 'admin@upgrade-check.test',
  adminName: 'Admin',
  password: PASSWORD,
});
const agent = await call('POST', '/users', { email: 'agent@upgrade-check.test', name: 'Agent', password: PASSWORD, roleKey: 'agent' }, token);
const agentToken = (await call('POST', '/auth/login', { tenantSlug: 'upgrade-check', email: 'agent@upgrade-check.test', password: PASSWORD })).token;

const prefSet = Boolean(await optional('notification preference', () => call('PUT', '/notification-preferences/TICKET_ASSIGNED', { email: true }, agentToken)));
await optional('custom status', () => call('POST', '/ticket-statuses', { key: 'waiting_parts', label: 'Waiting for parts', category: 'PENDING' }, token));
await optional('SLA policy', () => call('PUT', '/sla-policies', { priority: 'URGENT', firstResponseMinutes: 15, resolutionMinutes: 240, businessHoursOnly: false }, token));
await optional('custom field', () => call('POST', '/custom-fields', { key: 'line', label: 'Line', fieldType: 'SELECT', options: ['A', 'B'] }, token));
await optional('macro', () => call('POST', '/macros', { name: 'Ask for a photo', actions: { addReply: { body: 'Please send a photo', isPrivateNote: false } } }, token));
await optional('API key', () => call('POST', '/api-keys', { name: 'ERP' }, token));

const tickets = [];
for (let i = 1; i <= 5; i++) {
  const ticket = await call(
    'POST',
    '/tickets',
    { subject: `Ticket ${i}`, body: `Body ${i}`, contactEmail: `customer${i}@upgrade-check.test`, contactName: `Customer ${i}`, priority: i % 2 ? 'URGENT' : 'NORMAL' },
    token,
  );
  await call('POST', `/tickets/${ticket.id}/messages`, { body: `Internal note ${i}`, isPrivateNote: true }, token);
  await call('POST', `/tickets/${ticket.id}/messages`, { body: `Reply ${i}`, isPrivateNote: false }, token);
  tickets.push({ id: ticket.id, number: ticket.number, subject: ticket.subject });
}
const teams = (await call('GET', '/teams', null, token)).teams;
await call('PATCH', `/tickets/${tickets[0].id}`, { assigneeId: agent.id, teamId: teams[0]?.id }, token);

console.log(JSON.stringify({ password: PASSWORD, agentId: agent.id, prefSet, tickets }));
