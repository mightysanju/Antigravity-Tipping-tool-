import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole } from '../src/server/db/localPgliteBootstrap';
import { createSeededTestDb, SEED_IDS } from './helpers/pgliteDb';
import { PgliteDbAdapter, type AuthCaller } from '../src/server/services/types';
import { loadServerConfig } from '../src/server/config';
import { createPaymentAdapter } from '../src/server/adapters/paymentAdapter';
import { StubEmailAdapter } from '../src/server/adapters/emailAdapter';
import { setPropertyFeatureToggle } from '../src/server/services/superAdminService';
import {
  buildSignedMockStripeEvent,
  createTipCheckoutWorkflow,
  handleStripeWebhookWorkflow,
} from '../src/server/services/guestTippingService';
import {
  distributePoolWorkflow,
  exportTipsWorkflow,
  getAdminTipsOverviewWorkflow,
  getStaffPortalWorkflow,
  markStaffNotificationsReadWorkflow,
} from '../src/server/services/walletAndTipsService';

describe('Step 7 Staff Wallet, Notifications, Tips Overview & Pool Distribution', () => {
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

  beforeAll(async () => {
    db = await createSeededTestDb();
    adapter = new PgliteDbAdapter(db);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('loads staff portal for active & inactive (withdraw-only) staff and marks notifications read', async () => {
    const mariaView = await getStaffPortalWorkflow(adapter, maria, 'https://tips.example.com');
    expect(mariaView.person.walletBalanceCents).toBe(14200);
    expect(mariaView.todayRooms).toContain('412');
    expect(mariaView.personalQr?.url).toBe(`https://tips.example.com/tip/person/${SEED_IDS.people.maria}`);
    expect(mariaView.personalQr?.svg).toContain('<svg');

    // Trigger a live tip notification for Maria
    const checkout = await createTipCheckoutWorkflow({
      db: adapter,
      paymentAdapter,
      input: {
        sourceType: 'person',
        sourceId: SEED_IDS.people.maria,
        recipientType: 'person',
        personId: SEED_IDS.people.maria,
        departmentId: SEED_IDS.departments.housekeepingA,
        amountCents: 300,
        note: 'Great turndown service!',
      },
    });
    const evt = buildSignedMockStripeEvent(config, 'payment_intent.succeeded', checkout.paymentIntentId);
    await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: evt.rawBody,
      signatureHeader: evt.signatureHeader,
    });

    const afterTip = await getStaffPortalWorkflow(adapter, maria);
    expect(afterTip.person.walletBalanceCents).toBe(14500);
    expect(afterTip.unreadCount).toBeGreaterThanOrEqual(1);
    await markStaffNotificationsReadWorkflow(adapter, maria);
    const afterRead = await getStaffPortalWorkflow(adapter, maria);
    expect(afterRead.unreadCount).toBe(0);

    // Inactive Carlos still accesses withdraw-only wallet even if FT-17/FT-19 are off (L270)
    await setPropertyFeatureToggle(adapter, superCaller, A, 'staff_wallet_and_withdrawals', false);
    const carlosView = await getStaffPortalWorkflow(adapter, carlos);
    expect(carlosView.person.status).toBe('inactive');
    expect(carlosView.person.walletBalanceCents).toBe(2500);
    expect(carlosView.todayRooms).toEqual([]);
    expect(carlosView.personalQr).toBeNull();
    await setPropertyFeatureToggle(adapter, superCaller, A, 'staff_wallet_and_withdrawals', true);

    await expect(getStaffPortalWorkflow(adapter, adminA)).rejects.toThrow(/STAFF_ONLY_FORBIDDEN/);
  });

  it('conserves exact cents on pool split across active staff only, blocks double-distribute, and denies staff SELECT on pool_distributions', async () => {
    // Tip $10.01 (1001 cents) into Housekeeping Pool
    const poolCheckout = await createTipCheckoutWorkflow({
      db: adapter,
      paymentAdapter,
      input: {
        sourceType: 'dept',
        sourceId: SEED_IDS.departments.housekeepingA,
        recipientType: 'department_pool',
        departmentId: SEED_IDS.departments.housekeepingA,
        amountCents: 1001,
      },
    });
    const evt = buildSignedMockStripeEvent(config, 'payment_intent.succeeded', poolCheckout.paymentIntentId);
    await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: evt.rawBody,
      signatureHeader: evt.signatureHeader,
    });

    const overviewBefore = await getAdminTipsOverviewWorkflow(adapter, adminA, { propertyId: A });
    const hkDept = overviewBefore.departments.find((d) => d.id === SEED_IDS.departments.housekeepingA)!;
    expect(hkDept.unallocatedPoolCents).toBe(1001);

    const elenaBefore = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    const mariaBefore = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.maria])).rows[0].wallet_balance_cents
    );

    const dist = await distributePoolWorkflow(adapter, adminA, {
      propertyId: A,
      departmentId: SEED_IDS.departments.housekeepingA,
      method: 'split',
    });
    expect(dist.totalCents).toBe(1001);
    // Only Maria & Elena (2 active role='staff'); Sophia (dept_manager) & Carlos (inactive) excluded
    expect(dist.allocations.length).toBe(2);
    const allocSum = dist.allocations.reduce((s, a) => s + a.amountCents, 0);
    expect(allocSum).toBe(1001);
    expect(dist.allocations.map((a) => a.amountCents).sort()).toEqual([500, 501]);

    const elenaAfter = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    const mariaAfter = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.maria])).rows[0].wallet_balance_cents
    );
    expect(elenaAfter - elenaBefore + (mariaAfter - mariaBefore)).toBe(1001);

    // Double-distribution blocked
    await expect(
      distributePoolWorkflow(adapter, adminA, {
        propertyId: A,
        departmentId: SEED_IDS.departments.housekeepingA,
        method: 'split',
      })
    ).rejects.toThrow(/POOL_EMPTY/);

    // AC-6: Staff cannot SELECT pool_distributions directly
    const staffRead = await asRole(db, { role: 'authenticated', uid: SEED_IDS.users.maria }, (tx) =>
      tx.query(`SELECT id FROM public.pool_distributions`)
    );
    expect(staffRead.rows.length).toBe(0);
  });

  it('scopes dept_manager to own department and exports CSV & PDF gated by FT-27', async () => {
    const mgrView = await getAdminTipsOverviewWorkflow(adapter, hkManager, { propertyId: A });
    expect(mgrView.scopedDepartmentId).toBe(SEED_IDS.departments.housekeepingA);
    expect(mgrView.departments.map((d) => d.id)).toEqual([SEED_IDS.departments.housekeepingA]);

    await expect(
      distributePoolWorkflow(adapter, hkManager, {
        propertyId: A,
        departmentId: SEED_IDS.departments.frontDeskA,
        method: 'split',
      })
    ).rejects.toThrow(/FORBIDDEN/);

    const csv = await exportTipsWorkflow(adapter, adminA, { propertyId: A, format: 'csv' });
    expect(Buffer.from(csv.dataBase64, 'base64').toString('utf8')).toContain('Tip ID,Paid At,Department');

    const pdf = await exportTipsWorkflow(adapter, adminA, { propertyId: A, format: 'pdf' });
    expect(Buffer.from(pdf.dataBase64, 'base64').toString('latin1').startsWith('%PDF-1.4')).toBe(true);

    await setPropertyFeatureToggle(adapter, superCaller, A, 'tips_overview_export', false);
    await expect(
      exportTipsWorkflow(adapter, adminA, { propertyId: A, format: 'csv' })
    ).rejects.toThrow(/FEATURE_DISABLED:FT-27/);
    await setPropertyFeatureToggle(adapter, superCaller, A, 'tips_overview_export', true);
  });
});
