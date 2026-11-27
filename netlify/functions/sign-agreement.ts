import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { createEmailAdapter } from '../../src/server/adapters/emailAdapter.ts';
import { SupabaseUserDbAdapter, type AuthCaller } from '../../src/server/services/types.ts';
import { signAgreementWorkflow } from '../../src/server/services/agreementService.ts';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
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

    const body = JSON.parse(event.body || '{}') as {
      signerType?: 'property' | 'staff';
      signerId?: string;
      propertyId?: string;
      propertyName?: string;
      typedName?: string;
      checkboxConfirmed?: boolean;
      version?: string;
    };

    if (!body.signerType || !body.signerId || !body.propertyId || !body.typedName) {
      return json(400, { error: { code: 'INVALID_REQUEST', message: 'Missing required signature fields' } });
    }

    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || config.supabaseServiceRoleKey;
    const db = new SupabaseUserDbAdapter(config.supabaseUrl, anonKey, config.supabaseServiceRoleKey);
    const emailAdapter = createEmailAdapter(config);

    const clientIp =
      event.headers['x-nf-client-connection-ip'] ||
      event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      '127.0.0.1';
    const userAgent = event.headers['user-agent'] || 'unknown';

    const result = await signAgreementWorkflow({
      db,
      emailAdapter,
      caller,
      input: {
        signerType: body.signerType,
        signerId: body.signerId,
        propertyId: body.propertyId,
        propertyName: body.propertyName || 'Hotel Property',
        typedName: body.typedName,
        checkboxConfirmed: Boolean(body.checkboxConfirmed),
        ipAddress: clientIp,
        userAgent,
        version: body.version,
      },
    });

    return json(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    const status =
      message.includes('FORBIDDEN') || message.includes('42501')
        ? 403
        : message.includes('REQUIRED') || message.includes('INVALID')
          ? 422
          : 500;
    return json(status, { error: { code: 'SIGN_AGREEMENT_FAILED', message } });
  }
};
