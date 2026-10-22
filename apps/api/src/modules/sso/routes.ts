import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../rbac/permissions';
import { auditRequest, recordAudit, requestOrigin } from '../audit/service';
import { getActiveUserPermissions } from '../auth/service';
import { webOrigin } from '../../lib/publicUrl';
import {
  completeSso,
  deleteSsoSettings,
  getSsoSettings,
  issueSsoExchangeToken,
  OidcError,
  redeemSsoExchangeToken,
  saveSsoSettings,
  SSO_PROVIDERS,
  SsoError,
  startSso,
} from './service';

const settingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(SSO_PROVIDERS),
  issuer: z.string().max(500).default(''),
  clientId: z.string().min(1).max(500),
  clientSecret: z.string().min(1).max(2000).optional(),
  allowedDomains: z.array(z.string().max(253)).max(50).default([]),
  autoProvision: z.boolean().default(false),
  defaultRoleKey: z.string().min(1).max(50).default('agent'),
  enforced: z.boolean().default(false),
});

function loginPageWithError(message: string): string {
  return `${webOrigin()}/login?sso_error=${encodeURIComponent(message.slice(0, 300))}`;
}

// Binds a sign-in to the browser that started it (see startSso). Lax, so it
// still comes along on the IdP's top-level redirect back to the callback.
// Set by hand: it's the API's only cookie, not worth a plugin.
const BINDING_COOKIE = 'seredina_sso';

function bindingCookie(value: string, maxAgeS: number): string {
  const secure = webOrigin().startsWith('https://') ? '; Secure' : '';
  return `${BINDING_COOKIE}=${value}; Path=/; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${secure}`;
}

function readBindingCookie(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === BINDING_COOKIE) return rest.join('=');
  }
  return undefined;
}

export default async function ssoRoutes(app: FastifyInstance) {
  app.get('/sso-settings', { preHandler: [app.authenticate, requirePermission('users:manage')] }, async (request, reply) => {
    return reply.send(await getSsoSettings(request.user.tenantId));
  });

  app.put('/sso-settings', { preHandler: [app.authenticate, requirePermission('users:manage')] }, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const settings = await saveSsoSettings(request.user.tenantId, parsed.data, request.user.permissions);
      const { clientSecret, ...logged } = parsed.data;
      await auditRequest(request, 'sso.settings_updated', { type: 'sso_settings' }, { ...logged, clientSecretChanged: Boolean(clientSecret) });
      return reply.send(settings);
    } catch (err) {
      if (err instanceof SsoError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.delete('/sso-settings', { preHandler: [app.authenticate, requirePermission('users:manage')] }, async (request, reply) => {
    await deleteSsoSettings(request.user.tenantId);
    await auditRequest(request, 'sso.settings_deleted', { type: 'sso_settings' });
    return reply.code(204).send();
  });

  // The login page's "Sign in with SSO" button is a plain link here. Every
  // outcome is a redirect -- to the IdP, or back to the login page with a reason.
  app.get('/auth/sso/start', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const q = request.query as { tenantSlug?: string; email?: string };
    if (!q.tenantSlug) return reply.redirect(loginPageWithError('Enter your organization first.'));
    try {
      const { url, browserBinding } = await startSso(q.tenantSlug, q.email || undefined);
      reply.header('set-cookie', bindingCookie(browserBinding, 10 * 60));
      return reply.redirect(url);
    } catch (err) {
      request.log.warn({ err }, 'SSO start failed');
      const message = err instanceof SsoError || err instanceof OidcError ? err.message : 'Single sign-on is unavailable right now.';
      return reply.redirect(loginPageWithError(message));
    }
  });

  app.get('/auth/sso/callback', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    if (q.error) return reply.redirect(loginPageWithError(q.error_description || q.error));
    if (!q.code || !q.state) return reply.redirect(loginPageWithError('The sign-in was interrupted. Try again.'));
    const browserBinding = readBindingCookie(request.headers.cookie);
    // One sign-in per cookie, whatever the outcome.
    reply.header('set-cookie', bindingCookie('', 0));

    try {
      const result = await completeSso(q.state, q.code, browserBinding);
      await recordAudit(result.tenantId, {
        action: 'auth.login_succeeded',
        actorType: 'user',
        actorUserId: result.userId,
        actorLabel: result.email,
        metadata: { method: 'sso', ...(result.provisioned ? { provisioned: true } : {}) },
        ...requestOrigin(request),
      });
      if (result.provisioned) {
        await recordAudit(result.tenantId, {
          action: 'user.created',
          actorType: 'system',
          target: { type: 'user', id: result.userId, label: result.email },
          metadata: { via: 'sso' },
        });
      }
      // A fragment, not a query string: never sent to any server or written to access logs.
      return reply.redirect(`${webOrigin()}/login/sso#${issueSsoExchangeToken(result)}`);
    } catch (err) {
      request.log.warn({ err }, 'SSO callback failed');
      const message = err instanceof SsoError || err instanceof OidcError ? err.message : 'Single sign-on failed.';
      return reply.redirect(loginPageWithError(message));
    }
  });

  // The console trades the one-time token for a session.
  app.post('/auth/sso/exchange', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = z.object({ token: z.string().min(1).max(2000) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const redeemed = await redeemSsoExchangeToken(parsed.data.token);
    if (!redeemed) return reply.code(401).send({ error: 'This sign-in link has expired. Sign in again.' });
    const permissions = await getActiveUserPermissions(redeemed.tenantId, redeemed.userId);
    if (!permissions) return reply.code(401).send({ error: 'This account can no longer sign in.' });
    const token = app.jwt.sign({ sub: redeemed.userId, tenantId: redeemed.tenantId, permissions });
    return reply.send({ token });
  });
}
