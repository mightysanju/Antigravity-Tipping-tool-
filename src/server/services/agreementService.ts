import type { EmailAdapter } from '../adapters/emailAdapter.ts';
import { generateSignedAgreementPdf } from '../pdf/minimalPdf.ts';
import type { AuthCaller, DbAdapter } from './types.ts';

export const AGREEMENT_VERSION = '2026.1';

export const PROPERTY_AGREEMENT_CLAUSES: readonly string[] = [
  '1. Subscription & Zero Tip Commission: Property subscribes to FrontDesk Tip at the configured flat monthly or yearly SaaS fee. Platform takes 0% commission from guest tips.',
  '2. Term & Renewal: Agreement defaults to a 12-month auto-renewing term with 30 days written termination notice prior to renewal (or the custom term/notice configured for the property).',
  '3. Billing & Non-Payment Restriction: Failed subscription invoices follow Stripe Smart Retries; unresolved non-payment sets property status to restricted, pausing guest tips and withdrawals until settled.',
  '4. Stripe Connect Express & Chargebacks: Staff payouts run through Stripe Connect Express (Separate Charges & Transfers). Properties do not cover guest card chargebacks; disputed tips are recovered from recipient wallets.',
  '5. Legal Review Notice: Template copy subject to final legal counsel approval prior to live commercial rollout.',
];

export const STAFF_AGREEMENT_CLAUSES: readonly string[] = [
  '1. In-App Wallet & Payouts: Confirmed guest tips credit your in-app wallet after Stripe webhook verification. Standard weekly payouts run on your property payout day; optional instant debit payouts carry the disclosed debit fee.',
  '2. Stripe Connect Express Onboarding: You link your bank account or debit card directly inside Stripe-hosted Express onboarding. FrontDesk Tip never stores your bank account, card number, or SSN.',
  '3. Refunds & Chargeback Recovery: Property admins may refund a tip within 24 hours if your wallet covers it. Cardholder chargebacks deduct from your wallet balance and recover from future tips if your balance goes negative.',
  '4. Unclaimed Balances: Your earned balance remains yours even if your status becomes inactive or the property cancels; reminders issue at 30, 60, and 90 days of inactivity.',
  '5. Legal Review Notice: Template copy subject to final legal counsel approval prior to live commercial rollout.',
];

export interface SignAgreementInput {
  signerType: 'property' | 'staff';
  signerId: string;
  propertyId: string;
  propertyName: string;
  typedName: string;
  checkboxConfirmed: boolean;
  ipAddress: string;
  userAgent: string;
  version?: string;
}

export async function signAgreementWorkflow(params: {
  db: DbAdapter;
  emailAdapter?: EmailAdapter;
  caller: AuthCaller;
  input: SignAgreementInput;
}) {
  const { db, emailAdapter, caller, input } = params;
  const version = input.version || AGREEMENT_VERSION;
  const signedAtIso = new Date().toISOString();
  const safeVersion = version.replace(/[^a-z0-9._-]/gi, '');
  const pdfStoragePath = `${input.propertyId}/${input.signerType}_${input.signerId}_v${safeVersion}_${Date.now()}.pdf`;

  const clauses =
    input.signerType === 'property' ? PROPERTY_AGREEMENT_CLAUSES : STAFF_AGREEMENT_CLAUSES;

  const pdfBuffer = generateSignedAgreementPdf({
    title:
      input.signerType === 'property'
        ? 'FRONTDESK TIP - PROPERTY SERVICE AGREEMENT'
        : 'FRONTDESK TIP - STAFF PAYOUT & TERMS AGREEMENT',
    propertyName: input.propertyName,
    signerType: input.signerType,
    typedName: input.typedName.trim(),
    signerEmail: caller.email ?? 'verified-account@frontdesktip.test',
    version,
    signedAtIso,
    ipAddress: input.ipAddress || '127.0.0.1',
    clauses,
  });

  const agreement = await db.callRpc<Record<string, unknown>>(
    caller,
    'record_signed_agreement',
    {
      p_signer_type: input.signerType,
      p_signer_id: input.signerId,
      p_property_id: input.propertyId,
      p_version: version,
      p_typed_name: input.typedName,
      p_checkbox_confirmed: input.checkboxConfirmed,
      p_ip_address: input.ipAddress || '127.0.0.1',
      p_user_agent: input.userAgent || 'unknown',
      p_pdf_storage_path: pdfStoragePath,
    },
    [
      input.signerType,
      input.signerId,
      input.propertyId,
      version,
      input.typedName,
      input.checkboxConfirmed,
      input.ipAddress || '127.0.0.1',
      input.userAgent || 'unknown',
      pdfStoragePath,
    ]
  );

  if (db.uploadPrivateObject) {
    await db.uploadPrivateObject('signed-agreements', pdfStoragePath, pdfBuffer, 'application/pdf');
  }

  if (emailAdapter && caller.email) {
    await emailAdapter.sendEmail({
      to: caller.email,
      subject: `Signed Agreement Confirmation (${input.propertyName})`,
      text: `Your ${input.signerType} agreement (v${version}) was signed by ${input.typedName} at ${signedAtIso}.`,
      html: `<p>Your ${input.signerType} agreement (v${version}) was signed by <strong>${input.typedName}</strong> at ${signedAtIso}.</p>`,
      template: 'agreement',
      metadata: { propertyId: input.propertyId, pdfStoragePath },
    });
  }

  return {
    agreement,
    pdfStoragePath,
    pdfBase64: pdfBuffer.toString('base64'),
  };
}
