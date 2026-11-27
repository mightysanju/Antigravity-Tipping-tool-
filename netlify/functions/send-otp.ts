import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { createEmailAdapter } from '../../src/server/adapters/emailAdapter.ts';
import { SupabaseUserDbAdapter } from '../../src/server/services/types.ts';
import { sendOtpWorkflow, type OtpPurpose } from '../../src/server/services/otpAndAuthService.ts';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
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
    const emailAdapter = createEmailAdapter(config);

    const body = JSON.parse(event.body || '{}') as { email?: string; purpose?: OtpPurpose };
    if (!body.email || !body.purpose) {
      return json(400, { error: { code: 'INVALID_REQUEST', message: 'email and purpose required' } });
    }

    const clientIp =
      event.headers['x-nf-client-connection-ip'] ||
      event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      '127.0.0.1';

    const res = await sendOtpWorkflow({
      db,
      emailAdapter,
      config,
      email: body.email,
      purpose: body.purpose,
      clientIp,
    });
    return json(200, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    const status = message.includes('RATE_LIMITED') ? 429 : 422;
    return json(status, { error: { code: 'SEND_OTP_ERROR', message } });
  }
};
