import type { EmailAdapter } from '../adapters/emailAdapter.ts';
import type { PaymentAdapter } from '../adapters/paymentAdapter.ts';
import type { ServerConfig } from '../config.ts';
import { computeOtpHmac } from './otpAndAuthService.ts';
import type { AuthCaller, DbAdapter } from './types.ts';

/**
 * Generates or resumes a Stripe Connect Express onboarding link for the signed-in staff member.
 * Works for active and inactive withdraw-only staff.
 */
export async function createConnectOnboardingLinkWorkflow(params: {
  db: DbAdapter;
  paymentAdapter: PaymentAdapter;
  caller: AuthCaller;
  appOrigin?: string;
}) {
  const { db, paymentAdapter, caller, appOrigin } = params;
  const staff = await db.callRpc<{
    person: {
      id: string;
      name: string;
      stripeConnectAccountId: string | null;
    };
    property: { id: string };
  }>(caller, 'get_staff_portal_context', {}, []);

  const origin = (appOrigin || 'http://localhost:5173').replace(/\/$/, '');
  const result = await paymentAdapter.payoutExecutor.createConnectExpressOnboardingLink({
    personId: staff.person.id,
    propertyId: staff.property.id,
    email: caller.email || '',
    name: staff.person.name,
    existingAccountId: staff.person.stripeConnectAccountId,
    returnUrl: `${origin}/staff`,
    refreshUrl: `${origin}/staff`,
  });

  if (result.stripeConnectAccountId !== staff.person.stripeConnectAccountId) {
    await db.callRpc(
      caller,
      'set_staff_connect_account',
      { p_account_id: result.stripeConnectAccountId },
      [result.stripeConnectAccountId]
    );
  }

  return result;
}

/**
 * Verifies 6-digit email OTP (purpose='withdrawal'), debits wallet atomically,
 * and for 'instant' withdrawals executes immediate Connect payout (reversing on failure).
 */
export async function requestWithdrawalWorkflow(params: {
  db: DbAdapter;
  paymentAdapter: PaymentAdapter;
  config: ServerConfig;
  caller: AuthCaller;
  amountCents: number;
  method: 'standard' | 'instant';
  otpCode: string;
}) {
  const { db, paymentAdapter, config, caller, amountCents, method, otpCode } = params;
  const staff = await db.callRpc<{
    person: { id: string; status: 'active' | 'inactive' };
  }>(caller, 'get_staff_portal_context', {}, []);

  const email = (caller.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error('EMAIL_REQUIRED_FOR_OTP');
  }

  const codeHash = computeOtpHmac(config.otpServerSecret, email, 'withdrawal', otpCode);
  const otpRes = await db.callServiceRpc<{ verified: boolean; reason?: string }>(
    'verify_hashed_otp_and_trust_device',
    {
      p_email: email,
      p_purpose: 'withdrawal',
      p_code_hash: codeHash,
      p_trust_device: false,
      p_auth_user_id: caller.uid,
      p_device_token_hash: null,
      p_user_agent: null,
      p_ip: null,
    },
    [
      email,
      'withdrawal',
      codeHash,
      false,
      caller.uid,
      null,
      null,
      null,
    ]
  );
  if (!otpRes.verified) {
    throw new Error(otpRes.reason || 'INVALID_OR_EXPIRED_OTP');
  }

  const wd = await db.callServiceRpc<{
    withdrawalId: string;
    propertyId: string;
    personId: string;
    destinationAccountId: string;
    amountCents: number;
    feeCents: number;
    netPayoutCents: number;
    method: 'standard' | 'instant';
    status: string;
    idempotencyKey: string;
  }>(
    'create_staff_withdrawal',
    {
      p_person_id: staff.person.id,
      p_amount_cents: Math.round(amountCents),
      p_method: method,
    },
    [staff.person.id, Math.round(amountCents), method]
  );

  if (method === 'instant') {
    try {
      const payout = await paymentAdapter.payoutExecutor.executeTransferAndPayout({
        withdrawalId: wd.withdrawalId,
        destinationAccountId: wd.destinationAccountId,
        netPayoutCents: wd.netPayoutCents,
        method: 'instant',
        idempotencyKey: wd.idempotencyKey,
      });
      await db.callServiceRpc(
        'finalize_withdrawal_payout',
        {
          p_withdrawal_id: wd.withdrawalId,
          p_success: true,
          p_stripe_payout_id: payout.stripePayoutId,
          p_failure_reason: null,
        },
        [wd.withdrawalId, true, payout.stripePayoutId, null]
      );
      return { ...wd, status: 'paid', stripePayoutId: payout.stripePayoutId };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'INSTANT_PAYOUT_FAILED';
      await db.callServiceRpc(
        'finalize_withdrawal_payout',
        {
          p_withdrawal_id: wd.withdrawalId,
          p_success: false,
          p_stripe_payout_id: null,
          p_failure_reason: reason,
        },
        [wd.withdrawalId, false, null, reason]
      );
      throw new Error(`INSTANT_PAYOUT_FAILED_REVERSED: ${reason}`);
    }
  }

  return wd;
}

export async function runWeeklyPayoutsWorkflow(params: {
  db: DbAdapter;
  paymentAdapter: PaymentAdapter;
  propertyId?: string | null;
  ignoreSchedule?: boolean;
}) {
  const { db, paymentAdapter, propertyId = null, ignoreSchedule = false } = params;
  const batches = await db.callServiceRpc<
    Array<{
      batchId: string;
      propertyId: string;
      payoutDate: string;
      withdrawals: Array<{
        withdrawalId: string;
        destinationAccountId: string;
        netPayoutCents: number;
        idempotencyKey: string;
      }>;
    }>
  >(
    'claim_weekly_payout_batch',
    { p_property_id: propertyId, p_ignore_schedule: ignoreSchedule },
    [propertyId, ignoreSchedule]
  );

  const results: Array<{ batchId: string; paid: number; failed: number }> = [];
  for (const batch of batches) {
    let paid = 0;
    let failed = 0;
    for (const w of batch.withdrawals) {
      try {
        const res = await paymentAdapter.payoutExecutor.executeTransferAndPayout({
          withdrawalId: w.withdrawalId,
          destinationAccountId: w.destinationAccountId,
          netPayoutCents: w.netPayoutCents,
          method: 'standard',
          idempotencyKey: w.idempotencyKey,
        });
        await db.callServiceRpc(
          'finalize_withdrawal_payout',
          {
            p_withdrawal_id: w.withdrawalId,
            p_success: true,
            p_stripe_payout_id: res.stripePayoutId,
            p_failure_reason: null,
          },
          [w.withdrawalId, true, res.stripePayoutId, null]
        );
        paid++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'BATCH_PAYOUT_FAILED';
        await db.callServiceRpc(
          'finalize_withdrawal_payout',
          {
            p_withdrawal_id: w.withdrawalId,
            p_success: false,
            p_stripe_payout_id: null,
            p_failure_reason: reason,
          },
          [w.withdrawalId, false, null, reason]
        );
        failed++;
      }
    }
    results.push({ batchId: batch.batchId, paid, failed });
  }

  return { batchesProcessed: results.length, results };
}

/**
 * Two-phase refund:
 * 1) start_tip_refund sets status = 'refund_pending' & generates attempt idempotency key
 * 2) Calls paymentAdapter.refundPaymentIntent; if mock mode, immediately finalizes (real Stripe finalizes via charge.refunded webhook)
 */
export async function refundTipWorkflow(params: {
  db: DbAdapter;
  paymentAdapter: PaymentAdapter;
  caller: AuthCaller;
  tipId: string;
}) {
  const { db, paymentAdapter, caller, tipId } = params;
  const started = await db.callRpc<{
    tipId: string;
    paymentIntentId: string;
    attemptId: string;
    idempotencyKey: string;
  }>(caller, 'start_tip_refund', { p_tip_id: tipId }, [tipId]);

  try {
    const refund = await paymentAdapter.refundPaymentIntent({
      paymentIntentId: started.paymentIntentId,
      idempotencyKey: started.idempotencyKey,
      metadata: { tip_id: started.tipId, attempt_id: started.attemptId },
    });

    if (paymentAdapter.mode === 'mock') {
      await db.callServiceRpc(
        'finalize_tip_refund',
        { p_tip_id: started.tipId, p_success: true, p_event_id: null },
        [started.tipId, true, null]
      );
      return { tipId: started.tipId, status: 'refunded', stripeRefundId: refund.stripeRefundId };
    }

    return {
      tipId: started.tipId,
      status: 'refund_pending',
      stripeRefundId: refund.stripeRefundId,
    };
  } catch (err) {
    await db.callServiceRpc(
      'finalize_tip_refund',
      { p_tip_id: started.tipId, p_success: false, p_event_id: null },
      [started.tipId, false, null]
    );
    throw err;
  }
}

export async function reconcileStaleOperationsWorkflow(db: DbAdapter) {
  return db.callServiceRpc<{ reconciledWithdrawals: number; reconciledRefunds: number }>(
    'reconcile_stale_operations',
    {},
    []
  );
}

export async function runUnclaimedRemindersWorkflow(params: {
  db: DbAdapter;
  emailAdapter: EmailAdapter;
  appOrigin?: string;
}) {
  const { db, emailAdapter, appOrigin } = params;
  const claimed = await db.callServiceRpc<
    Array<{
      personId: string;
      email: string;
      name: string;
      propertyName: string;
      balanceCents: number;
      milestoneDays: 30 | 60 | 90;
    }>
  >('claim_unclaimed_balance_reminders', {}, []);

  const origin = (appOrigin || 'http://localhost:5173').replace(/\/$/, '');
  for (const item of claimed) {
    const amount = `$${(item.balanceCents / 100).toFixed(2)}`;
    await emailAdapter.sendEmail({
      to: item.email,
      subject: `Reminder: ${amount} waiting in your ${item.propertyName} tip wallet`,
      text: `Hi ${item.name}, you have ${amount} in unclaimed tips (${item.milestoneDays}-day reminder). Sign in at ${origin}/login to withdraw your balance.`,
      html: `<p>Hi ${item.name},</p><p>You have <strong>${amount}</strong> waiting in your <strong>${item.propertyName}</strong> tip wallet (${item.milestoneDays}-day reminder). Sign in at <a href="${origin}/login">${origin}/login</a> to withdraw.</p>`,
      template: 'unclaimed_reminder',
      metadata: { personId: item.personId, milestoneDays: String(item.milestoneDays) },
    });
  }

  return { sentCount: claimed.length, milestones: claimed.map((c) => c.milestoneDays) };
}
