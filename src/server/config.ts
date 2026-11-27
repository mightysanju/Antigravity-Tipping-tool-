export type PaymentMode = 'mock' | 'stripe_test' | 'stripe_live';
export type EmailMode = 'stub' | 'mailpit' | 'resend';
export type OcrMode = 'mock' | 'tesseract';

export interface ServerConfig {
  isProd: boolean;
  deployContext: string | undefined;
  paymentMode: PaymentMode;
  emailMode: EmailMode;
  ocrMode: OcrMode;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  resendApiKey: string;
  emailFrom: string;
  mailpitSmtpHost: string;
  mailpitSmtpPort: number;
  otpServerSecret: string;
  ssoTokenSigningKey: string;
  cronSecret: string;
}

const VALID_PAYMENT_MODES = new Set<PaymentMode>(['mock', 'stripe_test', 'stripe_live']);
const VALID_EMAIL_MODES = new Set<EmailMode>(['stub', 'mailpit', 'resend']);
const VALID_OCR_MODES = new Set<OcrMode>(['mock', 'tesseract']);

function isStrongSecret(value: string | undefined): boolean {
  if (!value || value.length < 32) return false;
  if (value === 'whsec_mock_dev') return false;
  if (value.startsWith('dev_only_')) return false;
  return true;
}

/**
 * Loads server configuration and enforces fail-closed production invariants.
 * In Netlify preview deploys (`CONTEXT=deploy-preview`, even with `NODE_ENV=production`),
 * `isProd` evaluates to `false`, allowing `stripe_test` and `stub` modes cleanly.
 */
export function loadServerConfig(
  env: Record<string, string | undefined> = process.env
): ServerConfig {
  const deployContext = env.NETLIFY_CONTEXT ?? env.CONTEXT;
  const isProd =
    deployContext === 'production' ||
    (!deployContext && env.NODE_ENV === 'production');

  const rawPaymentMode = env.PAYMENT_MODE;
  const rawEmailMode = env.EMAIL_MODE;
  const rawOcrMode = env.OCR_MODE;

  if (isProd) {
    if (rawPaymentMode !== 'stripe_live') {
      throw new Error(
        `PRODUCTION_BOOT_GUARD: PAYMENT_MODE must be 'stripe_live' in production (got '${rawPaymentMode ?? 'unset'}')`
      );
    }
    if (!env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
      throw new Error(
        'PRODUCTION_BOOT_GUARD: STRIPE_SECRET_KEY must start with sk_live_ in production'
      );
    }
    if (rawEmailMode !== 'resend') {
      throw new Error(
        `PRODUCTION_BOOT_GUARD: EMAIL_MODE must be 'resend' in production (got '${rawEmailMode ?? 'unset'}')`
      );
    }
    if (!env.RESEND_API_KEY?.trim()) {
      throw new Error('PRODUCTION_BOOT_GUARD: RESEND_API_KEY is required in production');
    }
    if (rawOcrMode !== 'tesseract') {
      throw new Error(
        `PRODUCTION_BOOT_GUARD: OCR_MODE must be 'tesseract' in production (got '${rawOcrMode ?? 'unset'}')`
      );
    }
    if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      throw new Error(
        'PRODUCTION_BOOT_GUARD: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production'
      );
    }
    if (!isStrongSecret(env.STRIPE_WEBHOOK_SECRET)) {
      throw new Error(
        'PRODUCTION_BOOT_GUARD: STRIPE_WEBHOOK_SECRET must be >= 32 chars and non-dev in production'
      );
    }
    if (!isStrongSecret(env.OTP_SERVER_SECRET)) {
      throw new Error(
        'PRODUCTION_BOOT_GUARD: OTP_SERVER_SECRET must be >= 32 chars and non-dev in production'
      );
    }
    if (!isStrongSecret(env.SSO_TOKEN_SIGNING_KEY)) {
      throw new Error(
        'PRODUCTION_BOOT_GUARD: SSO_TOKEN_SIGNING_KEY must be >= 32 chars and non-dev in production'
      );
    }
    if (!isStrongSecret(env.CRON_SECRET)) {
      throw new Error(
        'PRODUCTION_BOOT_GUARD: CRON_SECRET must be >= 32 chars and non-dev in production'
      );
    }
  }

  const paymentMode: PaymentMode = (rawPaymentMode as PaymentMode) || 'mock';
  const emailMode: EmailMode = (rawEmailMode as EmailMode) || 'stub';
  const ocrMode: OcrMode = (rawOcrMode as OcrMode) || 'mock';

  if (!VALID_PAYMENT_MODES.has(paymentMode)) {
    throw new Error(`INVALID_CONFIG: Unknown PAYMENT_MODE '${paymentMode}'`);
  }
  if (!VALID_EMAIL_MODES.has(emailMode)) {
    throw new Error(`INVALID_CONFIG: Unknown EMAIL_MODE '${emailMode}'`);
  }
  if (!VALID_OCR_MODES.has(ocrMode)) {
    throw new Error(`INVALID_CONFIG: Unknown OCR_MODE '${ocrMode}'`);
  }

  return {
    isProd,
    deployContext,
    paymentMode,
    emailMode,
    ocrMode,
    supabaseUrl: env.SUPABASE_URL || 'http://127.0.0.1:54321',
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || 'local-service-role-key-placeholder',
    stripeSecretKey: env.STRIPE_SECRET_KEY || 'sk_test_mock_dev_key',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || 'whsec_mock_dev',
    resendApiKey: env.RESEND_API_KEY || '',
    emailFrom: env.EMAIL_FROM || 'noreply@local.frontdesktip.test',
    mailpitSmtpHost: env.MAILPIT_SMTP_HOST || '127.0.0.1',
    mailpitSmtpPort: Number(env.MAILPIT_SMTP_PORT || '54325'),
    otpServerSecret: env.OTP_SERVER_SECRET || 'dev_only_otp_server_secret_do_not_use_in_prod_32chars',
    ssoTokenSigningKey: env.SSO_TOKEN_SIGNING_KEY || 'dev_only_sso_signing_key_do_not_use_in_prod_32chars',
    cronSecret: env.CRON_SECRET || 'dev_only_cron_secret_do_not_use_in_prod_32chars',
  };
}
