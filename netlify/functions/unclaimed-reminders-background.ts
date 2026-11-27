import crypto from 'node:crypto';
import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { createEmailAdapter } from '../../src/server/adapters/emailAdapter.ts';
import { SupabaseUserDbAdapter } from '../../src/server/services/types.ts';
import { runUnclaimedRemindersWorkflow } from '../../src/server/services/payoutsAndRefundsService.ts';

function authorizedCron(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ') || !secret) return false;
  const token = header.slice(7).trim();
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const handler: Handler = async (event) => {
  const config = loadServerConfig();
  if (!authorizedCron(event.headers.authorization || event.headers.Authorization, config.cronSecret)) {
    return { statusCode: 401, body: JSON.stringify({ error: { code: 'UNAUTHORIZED' } }) };
  }
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || config.supabaseServiceRoleKey;
  const db = new SupabaseUserDbAdapter(config.supabaseUrl, anonKey, config.supabaseServiceRoleKey);
  const emailAdapter = createEmailAdapter(config);
  const res = await runUnclaimedRemindersWorkflow({
    db,
    emailAdapter,
    appOrigin: process.env.URL,
  });
  return { statusCode: 200, body: JSON.stringify(res) };
};
