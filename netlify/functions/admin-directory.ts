import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { createEmailAdapter } from '../../src/server/adapters/emailAdapter.ts';
import { SupabaseUserDbAdapter, type AuthCaller } from '../../src/server/services/types.ts';
import {
  createPersonWorkflow,
  listDepartmentsAdmin,
  listPeopleAdmin,
  updatePersonWorkflow,
  upsertDepartmentAdmin,
} from '../../src/server/services/adminDirectoryService.ts';

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
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || config.supabaseServiceRoleKey;
    const db = new SupabaseUserDbAdapter(config.supabaseUrl, anonKey, config.supabaseServiceRoleKey);
    const emailAdapter = createEmailAdapter(config);

    const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
    switch (body.action) {
      case 'list_departments':
        return json(200, {
          departments: await listDepartmentsAdmin(db, caller, String(body.propertyId || '')),
        });
      case 'upsert_department':
        return json(
          200,
          await upsertDepartmentAdmin(db, caller, {
            propertyId: String(body.propertyId || ''),
            departmentId: (body.departmentId as string | null) ?? null,
            name: String(body.name || ''),
            isHousekeeping: Boolean(body.isHousekeeping),
            defaultDistribution: (body.defaultDistribution as 'split' | 'individual') || 'split',
          })
        );
      case 'list_people':
        return json(200, await listPeopleAdmin(db, caller, String(body.propertyId || '')));
      case 'create_person':
        return json(
          201,
          await createPersonWorkflow({
            db,
            emailAdapter,
            caller,
            input: {
              propertyId: String(body.propertyId || ''),
              name: String(body.name || ''),
              email: String(body.email || ''),
              role: (body.role as 'staff' | 'dept_manager' | 'property_admin') || 'staff',
              departmentId: (body.departmentId as string | null) ?? null,
              photoPath: (body.photoPath as string | null) ?? null,
            },
            appOrigin: event.headers.origin,
          })
        );
      case 'update_person':
        return json(
          200,
          await updatePersonWorkflow(db, caller, {
            personId: String(body.personId || ''),
            name: (body.name as string | null) ?? null,
            email: (body.email as string | null) ?? null,
            role: (body.role as 'staff' | 'dept_manager' | null) ?? null,
            departmentId: (body.departmentId as string | null) ?? null,
            status: (body.status as 'active' | 'inactive' | null) ?? null,
            photoPath: (body.photoPath as string | null) ?? null,
          })
        );
      default:
        return json(400, { error: { code: 'UNKNOWN_ACTION', message: 'Unsupported action' } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    const status = message.includes('FORBIDDEN') || message.includes('42501') ? 403 : 422;
    return json(status, { error: { code: 'ADMIN_DIRECTORY_ERROR', message } });
  }
};
