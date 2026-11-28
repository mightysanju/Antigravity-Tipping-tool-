import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import {
  checkTrustedDeviceWorkflow,
  getLoginAccountContext,
} from '../../src/server/services/otpAndAuthService.ts';
import { SupabaseUserDbAdapter, type AuthCaller } from '../../src/server/services/types.ts';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return cookies;
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

    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
    const trusted = await checkTrustedDeviceWorkflow(db, caller.uid, cookies.fdp_td ?? null);
    const ctx = await getLoginAccountContext(db, caller);

    return json(200, { ...ctx, trustedDevice: trusted });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to load login context';
    return json(422, { error: { code: 'LOGIN_CONTEXT_ERROR', message } });
  }
};
