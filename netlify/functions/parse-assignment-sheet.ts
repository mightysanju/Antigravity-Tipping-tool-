import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { createOcrAdapter } from '../../src/server/adapters/ocrAdapter.ts';
import { SupabaseUserDbAdapter, type AuthCaller } from '../../src/server/services/types.ts';
import { parseAssignmentSheetWorkflow } from '../../src/server/services/assignmentService.ts';

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

/** Parses a PDF (text extraction) or photo (OCR) into PROPOSED assignments. Saves nothing. */
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
    const source = body.source === 'photo' ? 'photo' : 'pdf';
    return json(
      200,
      await parseAssignmentSheetWorkflow({
        db,
        ocr: createOcrAdapter(config),
        caller,
        propertyId: String(body.propertyId || ''),
        date: String(body.date || ''),
        source,
        dataBase64: String(body.dataBase64 || ''),
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    const status = message.includes('FORBIDDEN') || message.includes('FEATURE_DISABLED') || message.includes('42501') ? 403 : 422;
    return json(status, { error: { code: 'PARSE_SHEET_ERROR', message } });
  }
};
