import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { createEmailAdapter } from '../../src/server/adapters/emailAdapter.ts';
import { SupabaseUserDbAdapter } from '../../src/server/services/types.ts';
import {
  completeJoinQrWorkflow,
  listJoinableStaffWorkflow,
  sendJoinQrOtpWorkflow,
} from '../../src/server/services/otpAndAuthService.ts';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: Handler = async (event) => {
  try {
    const config = loadServerConfig();
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || config.supabaseServiceRoleKey;
    const db = new SupabaseUserDbAdapter(config.supabaseUrl, anonKey, config.supabaseServiceRoleKey);
    const emailAdapter = createEmailAdapter(config);

    const clientIp =
      event.headers['x-nf-client-connection-ip'] ||
      event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      '127.0.0.1';
    const userAgent = event.headers['user-agent'] || 'unknown';

    if (event.httpMethod === 'GET') {
      const propertyId = event.queryStringParameters?.propertyId || '';
      const list = await listJoinableStaffWorkflow(db, propertyId);
      const status = list.ok ? 200 : list.code === 'FEATURE_DISABLED' ? 403 : 404;
      return json(status, list);
    }

    if (event.httpMethod !== 'POST') {
      return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or POST' } });
    }

    const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
    if (body.action === 'send_otp') {
      const res = await sendJoinQrOtpWorkflow({
        db,
        emailAdapter,
        config,
        propertyId: String(body.propertyId || ''),
        personId: String(body.personId || ''),
        clientIp,
      });
      return json(200, res);
    }

    if (body.action === 'complete') {
      const res = await completeJoinQrWorkflow({
        db,
        emailAdapter,
        config,
        propertyId: String(body.propertyId || ''),
        personId: String(body.personId || ''),
        code: String(body.code || ''),
        password: String(body.password || ''),
        typedName: String(body.typedName || ''),
        checkboxConfirmed: Boolean(body.checkboxConfirmed),
        clientIp,
        userAgent,
      });
      return json(200, res);
    }

    return json(400, { error: { code: 'UNKNOWN_ACTION', message: 'Use send_otp or complete' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    const status = message.includes('RATE_LIMITED')
      ? 429
      : message.includes('ALREADY_ONBOARDED')
        ? 409
        : message.includes('FEATURE_DISABLED')
          ? 403
          : 422;
    return json(status, { error: { code: 'JOIN_QR_ERROR', message } });
  }
};
