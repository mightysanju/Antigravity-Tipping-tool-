import crypto from 'node:crypto';
import type { EmailAdapter } from '../adapters/emailAdapter.ts';
import type { ServerConfig } from '../config.ts';
import { signAgreementWorkflow } from './agreementService.ts';
import type { AuthCaller, DbAdapter } from './types.ts';

export type OtpPurpose = 'login' | 'new_device' | 'withdrawal' | 'join_qr';

export function computeOtpHmac(
  secret: string,
  email: string,
  purpose: OtpPurpose,
  code: string
): string {
  const normalized = `${email.trim().toLowerCase()}:${purpose}:${code.trim()}`;
  return crypto.createHmac('sha256', secret).update(normalized).digest('hex');
}

export function hashDeviceToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function sendOtpWorkflow(params: {
  db: DbAdapter;
  emailAdapter: EmailAdapter;
  config: ServerConfig;
  email: string;
  purpose: OtpPurpose;
  clientIp: string;
}) {
  const { db, emailAdapter, config, email, purpose, clientIp } = params;
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const hashedCode = computeOtpHmac(config.otpServerSecret, email, purpose, code);

  const created = await db.callServiceRpc<{ otpId: string; expiresAt: string }>(
    'create_hashed_otp_with_rate_limit',
    {
      p_email: email,
      p_purpose: purpose,
      p_client_ip: clientIp || '127.0.0.1',
      p_hashed_code: hashedCode,
    },
    [email, purpose, clientIp || '127.0.0.1', hashedCode]
  );

  await emailAdapter.sendEmail({
    to: email.trim().toLowerCase(),
    subject: 'Your FrontDesk Tip Verification Code',
    text: `Your 6-digit verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your 6-digit verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
    template: 'otp',
    metadata: { purpose },
  });

  return {
    otpId: created.otpId,
    expiresAt: created.expiresAt,
  };
}

export async function verifyOtpWorkflow(params: {
  db: DbAdapter;
  config: ServerConfig;
  email: string;
  purpose: OtpPurpose;
  code: string;
  trustDevice?: boolean;
  authUserId?: string | null;
  userAgent?: string | null;
  clientIp?: string | null;
}) {
  const { db, config, email, purpose, code, trustDevice, authUserId, userAgent, clientIp } = params;
  const submittedHash = computeOtpHmac(config.otpServerSecret, email, purpose, code);

  let rawDeviceToken: string | null = null;
  let deviceTokenHash: string | null = null;
  if (trustDevice && authUserId) {
    rawDeviceToken = crypto.randomBytes(32).toString('base64url');
    deviceTokenHash = hashDeviceToken(rawDeviceToken);
  }

  const res = await db.callServiceRpc<{
    verified: boolean;
    reason?: string;
    attemptsRemaining?: number;
  }>(
    'verify_hashed_otp_and_trust_device',
    {
      p_email: email,
      p_purpose: purpose,
      p_submitted_hash: submittedHash,
      p_trust_device: Boolean(trustDevice && authUserId),
      p_auth_user_id: authUserId ?? null,
      p_device_token_hash: deviceTokenHash,
      p_user_agent: userAgent ?? null,
      p_ip: clientIp ?? '127.0.0.1',
    },
    [
      email,
      purpose,
      submittedHash,
      Boolean(trustDevice && authUserId),
      authUserId ?? null,
      deviceTokenHash,
      userAgent ?? null,
      clientIp ?? '127.0.0.1',
    ]
  );

  return {
    ...res,
    deviceToken: res.verified ? rawDeviceToken : null,
  };
}

export async function checkTrustedDeviceWorkflow(
  db: DbAdapter,
  authUserId: string,
  rawDeviceToken: string | null
): Promise<boolean> {
  if (!rawDeviceToken) return false;
  const tokenHash = hashDeviceToken(rawDeviceToken);
  return db.callServiceRpc<boolean>(
    'check_trusted_device',
    { p_auth_user_id: authUserId, p_device_token_hash: tokenHash },
    [authUserId, tokenHash]
  );
}

export async function listJoinableStaffWorkflow(db: DbAdapter, propertyId: string) {
  return db.callAnonRpc<{
    ok: boolean;
    code?: string;
    propertyId?: string;
    propertyName?: string;
    staff?: Array<{ personId: string; displayName: string; departmentName: string | null }>;
  }>('list_joinable_staff', { p_property_id: propertyId }, [propertyId]);
}

export async function sendJoinQrOtpWorkflow(params: {
  db: DbAdapter;
  emailAdapter: EmailAdapter;
  config: ServerConfig;
  propertyId: string;
  personId: string;
  clientIp: string;
}) {
  const { db, emailAdapter, config, propertyId, personId, clientIp } = params;
  const rec = await db.callServiceRpc<{
    ok: boolean;
    code?: string;
    personId?: string;
    name?: string;
    email?: string;
    propertyName?: string;
  }>(
    'get_joinable_staff_server_record',
    { p_property_id: propertyId, p_person_id: personId },
    [propertyId, personId]
  );

  if (!rec.ok || !rec.email) {
    throw new Error(rec.code || 'PERSON_UNAVAILABLE');
  }

  const otp = await sendOtpWorkflow({
    db,
    emailAdapter,
    config,
    email: rec.email,
    purpose: 'join_qr',
    clientIp,
  });

  // Return masked hint only (never raw email to unauthenticated caller)
  const [localPart, domain] = rec.email.split('@');
  const masked = `${localPart.slice(0, 2)}***@${domain}`;

  return {
    otpId: otp.otpId,
    expiresAt: otp.expiresAt,
    maskedEmail: masked,
    propertyName: rec.propertyName,
  };
}

export async function completeJoinQrWorkflow(params: {
  db: DbAdapter;
  emailAdapter: EmailAdapter;
  config: ServerConfig;
  propertyId: string;
  personId: string;
  code: string;
  password: string;
  typedName: string;
  checkboxConfirmed: boolean;
  clientIp: string;
  userAgent: string;
}) {
  const {
    db,
    emailAdapter,
    config,
    propertyId,
    personId,
    code,
    password,
    typedName,
    checkboxConfirmed,
    clientIp,
    userAgent,
  } = params;

  if (!password || password.length < 8) {
    throw new Error('PASSWORD_TOO_SHORT: Password must be at least 8 characters');
  }

  const rec = await db.callServiceRpc<{
    ok: boolean;
    code?: string;
    name?: string;
    email?: string;
    propertyName?: string;
  }>(
    'get_joinable_staff_server_record',
    { p_property_id: propertyId, p_person_id: personId },
    [propertyId, personId]
  );

  if (!rec.ok || !rec.email) {
    throw new Error(rec.code || 'PERSON_UNAVAILABLE');
  }

  const verification = await verifyOtpWorkflow({
    db,
    config,
    email: rec.email,
    purpose: 'join_qr',
    code,
    clientIp,
    userAgent,
  });

  if (!verification.verified) {
    throw new Error(verification.reason || 'OTP_INVALID');
  }

  if (!db.createAuthUser) {
    throw new Error('AUTH_USER_PROVISIONING_UNAVAILABLE');
  }

  const authUserId = await db.createAuthUser(rec.email, password, rec.name || typedName);
  const linkedPerson = await db.callServiceRpc<Record<string, unknown>>(
    'complete_join_by_qr',
    { p_property_id: propertyId, p_person_id: personId, p_auth_user_id: authUserId },
    [propertyId, personId, authUserId]
  );

  const caller: AuthCaller = { uid: authUserId, email: rec.email };
  const signed = await signAgreementWorkflow({
    db,
    emailAdapter,
    caller,
    input: {
      signerType: 'staff',
      signerId: personId,
      propertyId,
      propertyName: rec.propertyName || 'Hotel Property',
      typedName,
      checkboxConfirmed,
      ipAddress: clientIp,
      userAgent,
    },
  });

  const signedAgreement = signed.agreement as { signed_at?: string };

  return {
    person: {
      ...linkedPerson,
      agreement_signed_at: signedAgreement.signed_at ?? new Date().toISOString(),
    } as Record<string, unknown>,
    authUserId,
    agreement: signed.agreement,
    pdfStoragePath: signed.pdfStoragePath,
  };
}

export async function getLoginAccountContext(db: DbAdapter, caller: AuthCaller) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'get_login_account_context',
    {},
    []
  );
}
