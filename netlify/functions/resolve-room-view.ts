import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { SupabaseUserDbAdapter } from '../../src/server/services/types.ts';
import {
  resolveRoomViewWorkflow,
  type TipTargetType,
} from '../../src/server/services/guestTippingService.ts';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET' } });
  }
  try {
    const config = loadServerConfig();
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || config.supabaseServiceRoleKey;
    const db = new SupabaseUserDbAdapter(config.supabaseUrl, anonKey, config.supabaseServiceRoleKey);

    const type = String(event.queryStringParameters?.type || 'room') as TipTargetType;
    const id = String(event.queryStringParameters?.id || '');
    const result = await resolveRoomViewWorkflow(db, type, id);
    if (!result.ok) {
      const status =
        result.code === 'RECIPIENT_UNAVAILABLE'
          ? 422
          : result.code === 'PROPERTY_RESTRICTED' || result.code === 'FEATURE_DISABLED'
            ? 403
            : 404;
      return json(status, result);
    }
    return json(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    return json(500, { error: { code: 'RESOLVE_ROOM_VIEW_ERROR', message } });
  }
};
