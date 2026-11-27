import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { SupabaseUserDbAdapter, type AuthCaller } from '../../src/server/services/types.ts';
import {
  createPropertyApiKeyWorkflow,
  getSuperIntegrationsWorkflow,
  revokePropertyApiKeyWorkflow,
  upsertSsoProviderWorkflow,
  type ApiKeyScope,
} from '../../src/server/services/billingApiAndSsoService.ts';

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function authenticateBearer(
  authHeader: string | undefined,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<AuthCaller | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return null;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { uid: data.user.id, email: data.user.email ?? undefined, jwt };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } });
  }
  try {
    const config = loadServerConfig();
    const caller = await authenticateBearer(
      event.headers.authorization || event.headers.Authorization,
      config.supabaseUrl,
      config.supabaseServiceRoleKey
    );
    if (!caller) {
      return json(401, { error: { code: 'UNAUTHORIZED', message: 'Valid session required' } });
    }
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || config.supabaseServiceRoleKey;
    const db = new SupabaseUserDbAdapter(config.supabaseUrl, anonKey, config.supabaseServiceRoleKey);
    const body = JSON.parse(event.body || '{}') as Record<string, unknown>;

    switch (body.action) {
      case 'get':
        return json(200, await getSuperIntegrationsWorkflow(db, caller, String(body.propertyId || '')));
      case 'create_key':
        return json(
          201,
          await createPropertyApiKeyWorkflow(db, caller, {
            propertyId: String(body.propertyId || ''),
            label: String(body.label || 'Integration Key'),
            scopes: Array.isArray(body.scopes) ? (body.scopes as ApiKeyScope[]) : [],
          })
        );
      case 'revoke_key':
        return json(200, await revokePropertyApiKeyWorkflow(db, caller, String(body.keyId || '')));
      case 'upsert_sso':
        return json(
          200,
          await upsertSsoProviderWorkflow(db, caller, {
            propertyId: String(body.propertyId || ''),
            clientId: String(body.clientId || ''),
            authMode: body.authMode === 'partner_asymmetric' ? 'partner_asymmetric' : 'server_minted',
            clientSecret: (body.clientSecret as string | null) ?? null,
            publicKeyPem: (body.publicKeyPem as string | null) ?? null,
            jwksUrl: (body.jwksUrl as string | null) ?? null,
            allowedOrigins: Array.isArray(body.allowedOrigins) ? (body.allowedOrigins as string[]) : [],
            enabled: Boolean(body.enabled),
          })
        );
      default:
        return json(400, { error: { code: 'UNKNOWN_ACTION', message: 'Unsupported action' } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    const status = message.includes('SUPER_ADMIN') || message.includes('42501') ? 403 : 422;
    return json(status, { error: { code: 'INTEGRATIONS_ERROR', message } });
  }
};
