import type { EmailAdapter } from '../adapters/emailAdapter.ts';
import type { FeatureKey } from '../../shared/features.ts';
import type { AuthCaller, DbAdapter } from './types.ts';

export async function getSuperDashboard(db: DbAdapter, caller: AuthCaller) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'get_super_dashboard_metrics',
    {},
    []
  );
}

export async function getPropertySuperDetail(
  db: DbAdapter,
  caller: AuthCaller,
  propertyId: string
) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'get_property_super_detail',
    { p_property_id: propertyId },
    [propertyId]
  );
}

export async function onboardPropertyWizard(
  db: DbAdapter,
  caller: AuthCaller,
  payload: Record<string, unknown>
) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'onboard_property_wizard',
    { p_payload: payload },
    [payload]
  );
}

export async function updatePropertySettingsSuper(
  db: DbAdapter,
  caller: AuthCaller,
  propertyId: string,
  patch: Record<string, unknown>
) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'update_property_settings_super',
    { p_property_id: propertyId, p_patch: patch },
    [propertyId, patch]
  );
}

export async function setPropertyFeatureToggle(
  db: DbAdapter,
  caller: AuthCaller,
  propertyId: string,
  featureKey: FeatureKey,
  enabled: boolean
) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'set_property_feature_toggle',
    { p_property_id: propertyId, p_feature_key: featureKey, p_enabled: enabled },
    [propertyId, featureKey, enabled]
  );
}

export async function getPlatformPaymentsOverview(db: DbAdapter, caller: AuthCaller) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'get_platform_payments_overview',
    {},
    []
  );
}

export async function updatePlatformPaymentDefaults(
  db: DbAdapter,
  caller: AuthCaller,
  payoutWeekday: number,
  minWithdrawalCents: number,
  applyToAll: boolean
) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'update_platform_payment_defaults',
    {
      p_payout_weekday: payoutWeekday,
      p_min_withdrawal_cents: minWithdrawalCents,
      p_apply_to_all: applyToAll,
    },
    [payoutWeekday, minWithdrawalCents, applyToAll]
  );
}

export async function listPropertyAdminsSuper(db: DbAdapter, caller: AuthCaller) {
  return db.callRpc<Array<Record<string, unknown>>>(
    caller,
    'list_property_admins_super',
    {},
    []
  );
}

export async function invitePropertyAdminWorkflow(params: {
  db: DbAdapter;
  emailAdapter: EmailAdapter;
  caller: AuthCaller;
  propertyId: string;
  name: string;
  email: string;
  appOrigin?: string;
}) {
  const { db, emailAdapter, caller, propertyId, name, email, appOrigin } = params;
  const result = await db.callRpc<{
    person: Record<string, unknown>;
    propertyName: string;
    emailInviteEnabled: boolean;
  }>(
    caller,
    'invite_property_admin_super',
    { p_property_id: propertyId, p_name: name, p_email: email },
    [propertyId, name, email]
  );

  let emailSent = false;
  if (result.emailInviteEnabled) {
    const loginUrl = `${appOrigin || 'http://localhost:5173'}/login`;
    await emailAdapter.sendEmail({
      to: email.trim().toLowerCase(),
      subject: `You were invited as Property Admin for ${result.propertyName}`,
      text: `Hello ${name}, you have been invited as Property Admin for ${result.propertyName}. Sign in at ${loginUrl} to review and accept the Property Service Agreement.`,
      html: `<p>Hello ${name},</p><p>You have been invited as Property Admin for <strong>${result.propertyName}</strong>. Visit <a href="${loginUrl}">${loginUrl}</a> to sign in and complete onboarding.</p>`,
      template: 'invite',
      metadata: { propertyId, role: 'property_admin' },
    });
    emailSent = true;
  }

  return {
    ...result,
    emailSent,
  };
}

export async function removePropertyAdminSuper(
  db: DbAdapter,
  caller: AuthCaller,
  personId: string
) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'remove_property_admin_super',
    { p_person_id: personId },
    [personId]
  );
}
