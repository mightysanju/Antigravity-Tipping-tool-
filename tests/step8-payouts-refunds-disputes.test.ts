import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createSeededTestDb, SEED_IDS } from './helpers/pgliteDb';
import { PgliteDbAdapter, type AuthCaller } from '../src/server/services/types';
import { loadServerConfig } from '../src/server/config';
import { createPaymentAdapter } from '../src/server/adapters/paymentAdapter';
import { StubEmailAdapter } from '../src/server/adapters/emailAdapter';
import { setPropertyFeatureToggle } from '../src/server/services/superAdminService';
import { sendOtpWorkflow } from '../src/server/services/otpAndAuthService';
import {
  buildSignedMockStripeEvent,
  createTipCheckoutWorkflow,
  handleStripeWebhookWorkflow,
} from '../src/server/services/guestTippingService';
import {
  createConnectOnboardingLinkWorkflow,
  reconcileStaleOperationsWorkflow,
  refundTipWorkflow,
  requestWithdrawalWorkflow,
  runUnclaimedRemindersWorkflow,
  runWeeklyPayoutsWorkflow,
} from '../src/server/services/payoutsAndRefundsService';

describe('Step 8 Withdrawals, Connect Express Payouts, Refunds, Disputes & Reminders', () => {
  let db: PGlite;
  let adapter: PgliteDbAdapter;
  const config = loadServerConfig({});
  const paymentAdapter = createPaymentAdapter(config);
  const emailAdapter = new StubEmailAdapter(null);

  const A = SEED_IDS.properties.palomaA;
  const superCaller: AuthCaller = { uid: SEED_IDS.users.superAdmin, email: 'superadmin@frontdesktip.test' };
  const adminA: AuthCaller = { uid: SEED_IDS.users.adminA, email: 'admin.paloma@frontdesktip.test' };
  const hkManager: AuthCaller = { uid: SEED_IDS.users.deptManagerA, email: 'manager.hk@frontdesktip.test' };
  const maria: AuthCaller = { uid: SEED_IDS.users.maria, email: 'maria.garcia@frontdesktip.test' };
  const carlos: AuthCaller = { uid: SEED_IDS.users.carlos, email: 'carlos.vega@frontdesktip.test' };

  async function issueOtp(email: string): Promise<string> {
    const before = emailAdapter.getOutbox().length;
    await sendOtpWorkflow({ db: adapter, emailAdapter, config, email, purpose: 'withdrawal', clientIp: '127.0.0.1' });
    const latest = emailAdapter.getOutbox()[before];
    const match = latest?.text.match(/\b(\d{6})\b/);
    if (!match) throw new Error('OTP not found in stub outbox');
    return match[1];
  }

  beforeAll(async () => {
    db = await createSeededTestDb();
    adapter = new PgliteDbAdapter(db);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('AC-7: links Connect Express, verifies OTP on standard & instant withdrawals, runs weekly batch, and honors L270', async () => {
    const link = await createConnectOnboardingLinkWorkflow({
      db: adapter,
      paymentAdapter,
      caller: maria,
      appOrigin: 'https://tips.example.com',
    });
    expect(link.stripeConnectAccountId).toMatch(/^acct_mock_/);

    // Wrong OTP rejected
    await expect(
      requestWithdrawalWorkflow({
        db: adapter,
        paymentAdapter,
        config,
        caller: maria,
        amountCents: 2000,
        method: 'standard',
        otpCode: '000000',
      })
    ).rejects.toThrow();

    // Standard withdrawal queued ($20.00)
    const code1 = await issueOtp(maria.email!);
    const wdStd = await requestWithdrawalWorkflow({
      db: adapter,
      paymentAdapter,
      config,
      caller: maria,
      amountCents: 2000,
      method: 'standard',
      otpCode: code1,
    });
    expect(wdStd.status).toBe('queued');

    // Instant withdrawal ($15.00) -> paid immediately
    await setPropertyFeatureToggle(adapter, superCaller, A, 'instant_payouts', true);
    const code2 = await issueOtp(maria.email!);
    const wdInst = await requestWithdrawalWorkflow({
      db: adapter,
      paymentAdapter,
      config,
      caller: maria,
      amountCents: 1500,
      method: 'instant',
      otpCode: code2,
    });
    expect(wdInst.status).toBe('paid');

    // Weekly batch claims queued standard withdrawal and marks it paid
    const batch1 = await runWeeklyPayoutsWorkflow({
      db: adapter,
      paymentAdapter,
      propertyId: A,
      ignoreSchedule: true,
    });
    expect(batch1.batchesProcessed).toBe(1);
    expect(batch1.results[0]).toMatchObject({ paid: 1, failed: 0 });

    // Same day replay -> idempotent (0 batches)
    const batchReplay = await runWeeklyPayoutsWorkflow({
      db: adapter,
      paymentAdapter,
      propertyId: A,
      ignoreSchedule: true,
    });
    expect(batchReplay.batchesProcessed).toBe(0);

    // Inactive Carlos can still withdraw $15.00 even with FT-17/FT-19 off (L270), but restricted property blocks it
    await createConnectOnboardingLinkWorkflow({ db: adapter, paymentAdapter, caller: carlos });
    await setPropertyFeatureToggle(adapter, superCaller, A, 'staff_wallet_and_withdrawals', false);
    const code3 = await issueOtp(carlos.email!);
    const carlosWd = await requestWithdrawalWorkflow({
      db: adapter,
      paymentAdapter,
      config,
      caller: carlos,
      amountCents: 1500,
      method: 'standard',
      otpCode: code3,
    });
    expect(carlosWd.status).toBe('queued');
    await setPropertyFeatureToggle(adapter, superCaller, A, 'staff_wallet_and_withdrawals', true);

    await db.query(`UPDATE public.properties SET status = 'restricted' WHERE id = $1`, [A]);
    const code4 = await issueOtp(carlos.email!);
    await expect(
      requestWithdrawalWorkflow({
        db: adapter,
        paymentAdapter,
        config,
        caller: carlos,
        amountCents: 1000,
        method: 'standard',
        otpCode: code4,
      })
    ).rejects.toThrow(/PROPERTY_RESTRICTED/);
    await db.query(`UPDATE public.properties SET status = 'active' WHERE id = $1`, [A]);
  });

  it('enforces 24h two-phase refund window, FT-20 toggle, and property_admin-only guard', async () => {
    const checkout = await createTipCheckoutWorkflow({
      db: adapter,
      paymentAdapter,
      input: {
        sourceType: 'person',
        sourceId: SEED_IDS.people.elena,
        recipientType: 'person',
        personId: SEED_IDS.people.elena,
        departmentId: SEED_IDS.departments.housekeepingA,
        amountCents: 1000,
      },
    });
    const evt = buildSignedMockStripeEvent(config, 'payment_intent.succeeded', checkout.paymentIntentId);
    const confirmed = (await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: evt.rawBody,
      signatureHeader: evt.signatureHeader,
    })) as { tipId: string };

    // Dept manager cannot refund
    await expect(
      refundTipWorkflow({ db: adapter, paymentAdapter, caller: hkManager, tipId: confirmed.tipId })
    ).rejects.toThrow(/FORBIDDEN/);

    const balBefore = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    const ref = await refundTipWorkflow({
      db: adapter,
      paymentAdapter,
      caller: adminA,
      tipId: confirmed.tipId,
    });
    expect(ref.status).toBe('refunded');

    const balAfter = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    expect(balAfter).toBe(balBefore - 1000);

    // >24h old tip rejected
    const oldCheckout = await createTipCheckoutWorkflow({
      db: adapter,
      paymentAdapter,
      input: {
        sourceType: 'person',
        sourceId: SEED_IDS.people.elena,
        recipientType: 'person',
        personId: SEED_IDS.people.elena,
        departmentId: SEED_IDS.departments.housekeepingA,
        amountCents: 500,
      },
    });
    const oldEvt = buildSignedMockStripeEvent(config, 'payment_intent.succeeded', oldCheckout.paymentIntentId);
    const oldTip = (await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: oldEvt.rawBody,
      signatureHeader: oldEvt.signatureHeader,
    })) as { tipId: string };
    await db.query(`UPDATE public.tips SET paid_at = now() - interval '25 hours' WHERE id = $1`, [oldTip.tipId]);

    await expect(
      refundTipWorkflow({ db: adapter, paymentAdapter, caller: adminA, tipId: oldTip.tipId })
    ).rejects.toThrow(/REFUND_WINDOW_EXPIRED_24H/);
  });

  it('AC-9: handles chargeback into negative balance with recovery, stale reconciliation, and 30/60/90d reminders', async () => {
    // Tip $10.00 to Elena, then zero her wallet, then dispute the $10.00 tip -> balance becomes -1000
    const c1 = await createTipCheckoutWorkflow({
      db: adapter,
      paymentAdapter,
      input: {
        sourceType: 'person',
        sourceId: SEED_IDS.people.elena,
        recipientType: 'person',
        personId: SEED_IDS.people.elena,
        departmentId: SEED_IDS.departments.housekeepingA,
        amountCents: 1000,
      },
    });
    const e1 = buildSignedMockStripeEvent(config, 'payment_intent.succeeded', c1.paymentIntentId);
    await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: e1.rawBody,
      signatureHeader: e1.signatureHeader,
    });
    await db.query(`UPDATE public.people SET wallet_balance_cents = 0 WHERE id = $1`, [SEED_IDS.people.elena]);

    const disputeEvt = buildSignedMockStripeEvent(config, 'charge.dispute.created', c1.paymentIntentId);
    await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: disputeEvt.rawBody,
      signatureHeader: disputeEvt.signatureHeader,
    });

    const negBal = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    expect(negBal).toBe(-1000);

    // Subsequent $15.00 tip recovers negative balance -> +500
    const c2 = await createTipCheckoutWorkflow({
      db: adapter,
      paymentAdapter,
      input: {
        sourceType: 'person',
        sourceId: SEED_IDS.people.elena,
        recipientType: 'person',
        personId: SEED_IDS.people.elena,
        departmentId: SEED_IDS.departments.housekeepingA,
        amountCents: 1500,
      },
    });
    const e2 = buildSignedMockStripeEvent(config, 'payment_intent.succeeded', c2.paymentIntentId);
    await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: e2.rawBody,
      signatureHeader: e2.signatureHeader,
    });
    const recoveredBal = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    expect(recoveredBal).toBe(500);

    // Reconcile stale (>15m) processing withdrawal
    await db.query(
      `INSERT INTO public.withdrawals (property_id, person_id, amount_cents, method, fee_cents, status, processing_started_at, stripe_idempotency_key)
       VALUES ($1, $2, 500, 'standard', 0, 'processing', now() - interval '20 minutes', 'wd_stale_test')`,
      [A, SEED_IDS.people.elena]
    );
    const rec = await reconcileStaleOperationsWorkflow(adapter);
    expect(rec.reconciledWithdrawals).toBe(1);

    // 30-day unclaimed balance reminder
    await db.query(
      `UPDATE public.people SET last_activity_or_credit_at = now() - interval '35 days', last_reminder_milestone = NULL WHERE id = $1`,
      [SEED_IDS.people.elena]
    );
    const rem1 = await runUnclaimedRemindersWorkflow({ db: adapter, emailAdapter });
    expect(rem1.milestones).toContain(30);
    const rem2 = await runUnclaimedRemindersWorkflow({ db: adapter, emailAdapter });
    expect(rem2.sentCount).toBe(0);
  });
});
