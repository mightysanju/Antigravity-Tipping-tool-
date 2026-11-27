import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { SupabaseUserDbAdapter } from '../../src/server/services/types.ts';
import { handleApiGatewayRequest } from '../../src/server/services/billingApiAndSsoService.ts';

export const handler: Handler = async (event) => {
  const config = loadServerConfig();
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || config.supabaseServiceRoleKey;
  const db = new SupabaseUserDbAdapter(config.supabaseUrl, anonKey, config.supabaseServiceRoleKey);

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const apiKey =
    (event.headers['x-api-key'] || event.headers['X-API-Key']) ??
    (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null);

  const rawPath = event.path.replace(/^\/\.netlify\/functions\/api-gateway/, '') || '/';
  const body = event.body ? (JSON.parse(event.body) as Record<string, unknown>) : {};

  const res = await handleApiGatewayRequest({
    db,
    apiKey: apiKey ? String(apiKey) : null,
    method: event.httpMethod,
    path: rawPath.startsWith('/v1') ? rawPath.slice(3) : rawPath,
    query: (event.queryStringParameters as Record<string, string | undefined>) ?? {},
    body,
  });

  return {
    statusCode: res.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(res.body),
  };
};
