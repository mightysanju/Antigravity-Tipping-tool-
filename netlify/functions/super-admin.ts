import { createClient } from '@supabase/supabase-js';
import type { Handler } from '@netlify/functions';
import { loadServerConfig } from '../../src/server/config.ts';
import { createEmailAdapter } from '../../src/server/adapters/emailAdapter.ts';
import { SupabaseUserDbAdapter, type AuthCaller } from '../../src/server/services/types.ts';
import type { FeatureKey } from '../../src/shared/features.ts';
import {
  getPlatformPaymentsOverview,
  getPropertySuperDetail,
  getSuperDashboard,
  invitePropertyAdminWorkflow,
  listPropertyAdminsSuper,
  onboardPropertyWizard,
  removePropertyAdminSuper,
  setPropertyFeatureToggle,
  updatePlatformPaymentDefaults,
  updatePropertySettingsSuper,
} from '../../src/server/services/superAdminService.ts';

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

    const body = JSON.parse(event.body || '{}') as {
      action?: string;
      propertyId?: string;
      payload?: Record<string, unknown>;
      patch?: Record<string, unknown>;
      featureKey?: FeatureKey;
      enabled?: boolean;
      payoutWeekday?: number;
      minWithdrawalCents?: number;
      applyToAll?: boolean;
      name?: string;
      email?: string;
      personId?: string;
    };

    switch (body.action) {
      case 'dashboard':
        return json(200, await getSuperDashboard(db, caller));
      case 'property_detail':
        return json(200, await getPropertySuperDetail(db, caller, String(body.propertyId || '')));
      case 'onboard_property':
        return json(201, await onboardPropertyWizard(db, caller, body.payload || {}));
      case 'update_property':
        return json(
          200,
          await updatePropertySettingsSuper(db, caller, String(body.propertyId || ''), body.patch || {})
        );
      case 'set_feature_toggle':
        return json(
          200,
          await setPropertyFeatureToggle(
            db,
            caller,
            String(body.propertyId || ''),
            body.featureKey as FeatureKey,
            Boolean(body.enabled)
          )
        );
      case 'payments_overview':
        return json(200, await getPlatformPaymentsOverview(db, caller));
      case 'update_payment_defaults':
        return json(
          200,
          await updatePlatformPaymentDefaults(
            db,
            caller,
            Number(body.payoutWeekday ?? 4),
            Number(body.minWithdrawalCents ?? 1000),
            Boolean(body.applyToAll)
          )
        );
      case 'list_admins':
        return json(200, { admins: await listPropertyAdminsSuper(db, caller) });
      case 'invite_admin':
        return json(
          201,
          await invitePropertyAdminWorkflow({
            db,
            emailAdapter,
            caller,
            propertyId: String(body.propertyId || ''),
            name: String(body.name || ''),
            email: String(body.email || ''),
            appOrigin: event.headers.origin,
          })
        );
      case 'remove_admin':
        return json(200, await removePropertyAdminSuper(db, caller, String(body.personId || '')));
      default:
        return json(400, { error: { code: 'UNKNOWN_ACTION', message: `Unsupported action '${body.action}'` } });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    const status =
      message.includes('REQUIRED') || message.includes('42501') || message.includes('FORBIDDEN')
        ? 403
        : message.includes('NOT_FOUND')
          ? 404
          : 422;
    return json(status, { error: { code: 'SUPER_ADMIN_ERROR', message } });
  }
};
