import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { SupabaseUserDbAdapter } from '../../src/server/services/types.ts';
import { verifyOtpWorkflow, type OtpPurpose } from '../../src/server/services/otpAndAuthService.ts';

function json(statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } });
  }
  try {
    const config = loadServerConfig();
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || config.supabaseServiceRoleKey;
    const db = new SupabaseUserDbAdapter(config.supabaseUrl, anonKey, config.supabaseServiceRoleKey);

    const body = JSON.parse(event.body || '{}') as {
      email?: string;
      purpose?: OtpPurpose;
      code?: string;
      trustDevice?: boolean;
      authUserId?: string;
    };

    if (!body.email || !body.purpose || !body.code) {
      return json(400, { error: { code: 'INVALID_REQUEST', message: 'email, purpose, and code required' } });
    }

    const clientIp =
      event.headers['x-nf-client-connection-ip'] ||
      event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      '127.0.0.1';

    const res = await verifyOtpWorkflow({
      db,
      config,
      email: body.email,
      purpose: body.purpose,
      code: body.code,
      trustDevice: body.trustDevice,
      authUserId: body.authUserId,
      userAgent: event.headers['user-agent'] || 'unknown',
      clientIp,
    });

    const headers: Record<string, string> = {};
    if (res.verified && res.deviceToken) {
      headers['Set-Cookie'] = `fdp_td=${res.deviceToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
    }
    return json(res.verified ? 200 : 422, { verified: res.verified, reason: res.reason }, headers);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    return json(422, { error: { code: 'VERIFY_OTP_ERROR', message } });
  }
};
