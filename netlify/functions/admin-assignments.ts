import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { SupabaseUserDbAdapter, type AuthCaller } from '../../src/server/services/types.ts';
import {
  getAssignmentContext,
  saveAssignmentsWorkflow,
  type AssignmentSource,
} from '../../src/server/services/assignmentService.ts';

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
    const propertyId = String(body.propertyId || '');
    const date = String(body.date || '');

    switch (body.action) {
      case 'context':
        return json(200, await getAssignmentContext(db, caller, propertyId, date));
      case 'save':
        return json(
          200,
          await saveAssignmentsWorkflow(db, caller, {
            propertyId,
            date,
            source: String(body.source || '') as AssignmentSource,
            items: Array.isArray(body.items)
              ? (body.items as Array<{ roomNumber: string; personId: string }>)
              : [],
          })
        );
      default:
        return json(400, { error: { code: 'UNKNOWN_ACTION', message: 'Unsupported action' } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    const status = message.includes('FORBIDDEN') || message.includes('FEATURE_DISABLED') || message.includes('42501') ? 403 : 422;
    return json(status, { error: { code: 'ASSIGNMENTS_ERROR', message } });
  }
};
