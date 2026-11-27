import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createSeededTestDb, queryWithSavepoint, SEED_IDS } from './helpers/pgliteDb';
import { loadServerConfig } from '../src/server/config';
import { createPaymentAdapter } from '../src/server/adapters/paymentAdapter';
import { StubEmailAdapter } from '../src/server/adapters/emailAdapter';
import { computeGuestFeeCents, computeEffectiveTipMinCents } from '../src/shared/types';
import { FEATURE_KEYS } from '../src/shared/features';
import { buildSignedMockStripeWebhook } from './helpers/webhookTestHelper';

describe('Step 1 Architecture, RLS Isolation, Guest Minimization & Prod Guards', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createSeededTestDb();
  });

  afterAll(async () => {
    await db?.close();
  });

  it('provisions all 24 tables, 6 private buckets, and all 27 feature toggles per property', async () => {
    const tablesRes = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    expect(Number(tablesRes.rows[0].count)).toBe(24);

    const bucketsRes = await db.query<{ id: string; public: boolean }>(
      `SELECT id, public FROM storage.buckets ORDER BY id`
    );
    expect(bucketsRes.rows.map((b) => b.id)).toEqual([
      'assignment-sheets',
      'property-backdrops',
      'qr-exports',
      'qr-templates',
      'signed-agreements',
      'staff-photos',
    ]);
    expect(bucketsRes.rows.every((b) => b.public === false)).toBe(true);

    const featRes = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.property_features WHERE property_id = $1`,
      [SEED_IDS.properties.palomaA]
    );
    expect(Number(featRes.rows[0].count)).toBe(FEATURE_KEYS.length);
    expect(FEATURE_KEYS.length).toBe(27);
  });

  it('AC-5: isolates multi-property tenant reads and blocks cross-property writes', async () => {
    await asRole(db, { role: 'authenticated', uid: SEED_IDS.users.adminA }, async (tx) => {
      const ownProps = await tx.query<{ id: string }>(
        `SELECT id FROM public.properties_staff_view`
      );
      expect(ownProps.rows.map((r) => r.id)).toEqual([SEED_IDS.properties.palomaA]);

      const crossPeople = await tx.query<{ id: string }>(
        `SELECT id FROM public.people WHERE property_id = $1`,
        [SEED_IDS.properties.harborB]
      );
      expect(crossPeople.rows).toHaveLength(0);

      const crossTips = await tx.query<{ id: string }>(
        `SELECT id FROM public.tips WHERE property_id = $1`,
        [SEED_IDS.properties.harborB]
      );
      expect(crossTips.rows).toHaveLength(0);

      const crossLedger = await tx.query<{ id: string }>(
        `SELECT id FROM public.ledger WHERE property_id = $1`,
        [SEED_IDS.properties.harborB]
      );
      expect(crossLedger.rows).toHaveLength(0);

      const crossAgreements = await tx.query<{ id: string }>(
        `SELECT id FROM public.agreements WHERE property_id = $1`,
        [SEED_IDS.properties.harborB]
      );
      expect(crossAgreements.rows).toHaveLength(0);

      // Cross-property admin details RPC rejected
      await expect(
        queryWithSavepoint(tx, `SELECT * FROM public.get_admin_property_details($1)`, [
          SEED_IDS.properties.harborB,
        ])
      ).rejects.toThrow(/FORBIDDEN_PROPERTY_ACCESS/);

      // Cross-property room insert rejected by RLS
      await expect(
        queryWithSavepoint(
          tx,
          `INSERT INTO public.rooms (property_id, room_number) VALUES ($1, '999')`,
          [SEED_IDS.properties.harborB]
        )
      ).rejects.toThrow();

      // Cross-property person creation via RPC rejected
      await expect(
        queryWithSavepoint(
          tx,
          `SELECT * FROM public.create_person_record($1, 'Intruder', 'x@test.com', 'staff', $2)`,
          [SEED_IDS.properties.harborB, SEED_IDS.departments.housekeepingB]
        )
      ).rejects.toThrow(/CROSS_PROPERTY_OR_ROLE_FORBIDDEN/);
    });
  });

  it('AC-6: blocks staff & admin direct mutations to balances, ledger, people, and pool_distributions', async () => {
    // Staff Maria isolation & write restrictions
    await asRole(db, { role: 'authenticated', uid: SEED_IDS.users.maria }, async (tx) => {
      const seenPeople = await tx.query<{ id: string; wallet_balance_cents: string }>(
        `SELECT id, wallet_balance_cents::text FROM public.people`
      );
      expect(seenPeople.rows).toHaveLength(1);
      expect(seenPeople.rows[0].id).toBe(SEED_IDS.people.maria);
      expect(Number(seenPeople.rows[0].wallet_balance_cents)).toBe(14200);

      // Direct UPDATE on people.wallet_balance_cents denied
      await expect(
        queryWithSavepoint(
          tx,
          `UPDATE public.people SET wallet_balance_cents = 999999 WHERE id = $1`,
          [SEED_IDS.people.maria]
        )
      ).rejects.toThrow(/permission denied/);

      // Direct ledger mutation denied
      await expect(
        queryWithSavepoint(
          tx,
          `INSERT INTO public.ledger (property_id, person_id, type, amount_cents, ref_id, idempotency_key)
           VALUES ($1, $2, 'tip_credit', 50000, $2, 'forged:1')`,
          [SEED_IDS.properties.palomaA, SEED_IDS.people.maria]
        )
      ).rejects.toThrow(/permission denied/);

      // Coworker pool_distributions allocations hidden from staff
      const poolRows = await tx.query(`SELECT id FROM public.pool_distributions`);
      expect(poolRows.rows).toHaveLength(0);

      // Billing columns on properties hidden from staff
      await expect(
        queryWithSavepoint(tx, `SELECT stripe_customer_id FROM public.properties`)
      ).rejects.toThrow(/permission denied/);
    });

    // Property Admin A also denied direct UPDATE on people.wallet_balance_cents and property_admin escalation
    await asRole(db, { role: 'authenticated', uid: SEED_IDS.users.adminA }, async (tx) => {
      await expect(
        queryWithSavepoint(
          tx,
          `UPDATE public.people SET wallet_balance_cents = 999999 WHERE id = $1`,
          [SEED_IDS.people.maria]
        )
      ).rejects.toThrow(/permission denied/);

      await expect(
        queryWithSavepoint(
          tx,
          `SELECT * FROM public.create_person_record($1, 'Rogue Admin', 'rogue@test.com', 'property_admin', NULL)`,
          [SEED_IDS.properties.palomaA]
        )
      ).rejects.toThrow(/PROPERTY_ADMIN_ESCALATION_FORBIDDEN/);
    });

    // Inactive staff Carlos keeps read-only access to withdraw-only row, ledger, and safe property view
    await asRole(db, { role: 'authenticated', uid: SEED_IDS.users.carlos }, async (tx) => {
      const carlosRow = await tx.query<{ status: string; wallet_balance_cents: string }>(
        `SELECT status, wallet_balance_cents::text FROM public.people`
      );
      expect(carlosRow.rows).toEqual([{ status: 'inactive', wallet_balance_cents: '2500' }]);

      const propView = await tx.query<{ payout_fee_paid_by: string }>(
        `SELECT payout_fee_paid_by FROM public.properties_staff_view`
      );
      expect(propView.rows[0].payout_fee_paid_by).toBe('property');
    });

    // Immutability trigger blocks UPDATE and DELETE on ledger even as table owner
    await expect(
      db.query(`UPDATE public.ledger SET amount_cents = 0`)
    ).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(db.query(`DELETE FROM public.ledger`)).rejects.toThrow(/LEDGER_IMMUTABLE/);

    // Wallet reconciliation invariant: 0 mismatched rows
    const recon = await db.query(
      `SELECT p.id FROM public.people p
       WHERE p.wallet_balance_cents <> COALESCE((SELECT SUM(l.amount_cents) FROM public.ledger l WHERE l.person_id = p.id), 0)`
    );
    expect(recon.rows).toHaveLength(0);
  });

  it('AC-8: blocks direct delete of department with people and enforces atomic reassignment', async () => {
    let spaDeptId = '';
    await asRole(db, { role: 'authenticated', uid: SEED_IDS.users.adminA }, async (tx) => {
      const tempDept = await tx.query<{ id: string }>(
        `INSERT INTO public.departments (property_id, name, is_housekeeping)
         VALUES ($1, 'Spa & Concierge', false) RETURNING id`,
        [SEED_IDS.properties.palomaA]
      );
      spaDeptId = tempDept.rows[0].id;

      // Move Liam Patel into Spa & Concierge via update_person_record
      await tx.query(`SELECT * FROM public.update_person_record($1, NULL, NULL, NULL, $2)`, [
        SEED_IDS.people.liamUnclaimed,
        spaDeptId,
      ]);

      // Deleting without reassignment target fails (REASSIGN_TARGET_REQUIRED)
      await expect(
        queryWithSavepoint(tx, `SELECT public.delete_department_with_reassign($1, NULL)`, [
          spaDeptId,
        ])
      ).rejects.toThrow(/REASSIGN_TARGET_REQUIRED/);
    });

    // Even direct table DELETE at DB layer is blocked by composite FK ON DELETE RESTRICT
    await expect(
      db.query(`DELETE FROM public.departments WHERE id = $1`, [spaDeptId])
    ).rejects.toThrow(/violates foreign key constraint/);

    // Reassigning back to Valet atomically succeeds and removes Spa & Concierge
    await asRole(db, { role: 'authenticated', uid: SEED_IDS.users.adminA }, async (tx) => {
      const res = await tx.query<{ delete_department_with_reassign: { reassignedPeopleCount: number } }>(
        `SELECT public.delete_department_with_reassign($1, $2)`,
        [spaDeptId, SEED_IDS.departments.valetA]
      );
      expect(res.rows[0].delete_department_with_reassign.reassignedPeopleCount).toBe(1);
    });
  });

  it('minimizes guest anon view, enforces role=staff only, and hides restricted properties', async () => {
    await asRole(db, { role: 'anon' }, async (tx) => {
      // Direct table queries rejected
      await expect(queryWithSavepoint(tx, `SELECT * FROM public.people`)).rejects.toThrow(
        /permission denied/
      );
      await expect(queryWithSavepoint(tx, `SELECT * FROM public.tips`)).rejects.toThrow(
        /permission denied/
      );

      // Room 412 shows Maria (role='staff'), excludes dept_manager & inactive & zero emails/balances
      const res = await tx.query<{ get_public_tip_target: Record<string, unknown> }>(
        `SELECT public.get_public_tip_target('room', $1)`,
        [SEED_IDS.rooms.r412]
      );
      const payload = res.rows[0].get_public_tip_target;
      expect(payload.ok).toBe(true);
      expect((payload.assignedHousekeeper as { personId: string }).personId).toBe(SEED_IDS.people.maria);

      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain('maria.garcia@frontdesktip.test');
      expect(serialized).not.toContain('Sophia Alvarez'); // dept_manager excluded
      expect(serialized).not.toContain('Carlos Vega'); // inactive excluded
      expect(serialized).not.toContain('14200'); // wallet balance excluded

      // Inactive person Carlos falls back to Front Desk department pool (FT-4 = true)
      const inactiveFallback = await tx.query<{ get_public_tip_target: Record<string, unknown> }>(
        `SELECT public.get_public_tip_target('person', $1)`,
        [SEED_IDS.people.carlos]
      );
      expect(inactiveFallback.rows[0].get_public_tip_target.mode).toBe('person_fallback_pool');
    });
  });

  it('enforces fail-closed production boot guards and exercises mock Payment & Stub Email adapters', async () => {
    // Local dev boots with zero external secrets
    const localCfg = loadServerConfig({});
    expect(localCfg.isProd).toBe(false);
    expect(localCfg.paymentMode).toBe('mock');
    expect(localCfg.emailMode).toBe('stub');

    // Netlify deploy-preview with NODE_ENV=production allows stripe_test + stub cleanly
    const previewCfg = loadServerConfig({
      CONTEXT: 'deploy-preview',
      NODE_ENV: 'production',
      PAYMENT_MODE: 'stripe_test',
      EMAIL_MODE: 'stub',
      OCR_MODE: 'mock',
    });
    expect(previewCfg.isProd).toBe(false);

    // Production rejects stripe_test / mock / stub / sk_test_ / dev secrets
    expect(() =>
      loadServerConfig({
        CONTEXT: 'production',
        PAYMENT_MODE: 'stripe_test',
        EMAIL_MODE: 'resend',
        OCR_MODE: 'tesseract',
      })
    ).toThrow(/PRODUCTION_BOOT_GUARD/);

    expect(() =>
      loadServerConfig({
        CONTEXT: 'production',
        PAYMENT_MODE: 'stripe_live',
        STRIPE_SECRET_KEY: 'sk_test_wrong',
        EMAIL_MODE: 'resend',
        RESEND_API_KEY: 're_live_123',
        OCR_MODE: 'tesseract',
        SUPABASE_URL: 'https://proj.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'srv_key',
        STRIPE_WEBHOOK_SECRET: 'whsec_mock_dev',
        OTP_SERVER_SECRET: 'a'.repeat(32),
        SSO_TOKEN_SIGNING_KEY: 'b'.repeat(32),
        CRON_SECRET: 'c'.repeat(32),
      })
    ).toThrow(/PRODUCTION_BOOT_GUARD/);

    // Mock PaymentAdapter webhook signature verification + fee gross-up + StubEmailAdapter
    const payment = createPaymentAdapter(localCfg);
    const { rawBody, signatureHeader } = buildSignedMockStripeWebhook({
      id: 'evt_test_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_mock_123' } },
    });
    const verified = payment.verifyWebhookEvent(rawBody, signatureHeader);
    expect(verified.id).toBe('evt_test_1');
    expect(() => payment.verifyWebhookEvent(rawBody, 't=1,v1=bad')).toThrow();

    expect(computeGuestFeeCents(1000)).toBe(61);
    expect(computeEffectiveTipMinCents('guest', 100)).toBe(100);
    expect(computeEffectiveTipMinCents('property', 100)).toBe(200);

    const emailAdapter = new StubEmailAdapter(null);
    await emailAdapter.sendEmail({
      to: 'maria@test.com',
      subject: 'Your OTP',
      text: 'Code: 482910',
      html: '<p>Code: 482910</p>',
      template: 'otp',
    });
    expect(emailAdapter.getOutbox()).toHaveLength(1);
  });
});
