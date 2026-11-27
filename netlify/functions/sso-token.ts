import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { SupabaseUserDbAdapter } from '../../src/server/services/types.ts';
import {
  exchangeSsoTokenWorkflow,
  mintServerSsoTokenWorkflow,
} from '../../src/server/services/billingApiAndSsoService.ts';

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } });
  }
  try {
    const config = loadServerConfig();
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || config.supabaseServiceRoleKey;
    const db = new SupabaseUserDbAdapter(config.supabaseUrl, anonKey, config.supabaseServiceRoleKey);

    const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
    if (body.action === 'exchange') {
      return json(
        200,
        await exchangeSsoTokenWorkflow({
          db,
          config,
          token: String(body.token || ''),
        })
      );
    }

    return json(
      200,
      await mintServerSsoTokenWorkflow({
        db,
        config,
        clientId: String(body.clientId || ''),
        clientSecret: String(body.clientSecret || ''),
        email: String(body.email || ''),
        appOrigin: event.headers.origin || process.env.URL,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SSO authentication failed';
    const status = message.includes('FORBIDDEN') || message.includes('DISABLED') ? 403 : 401;
    return json(status, { error: { code: 'SSO_ERROR', message } });
  }
};
