import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createSeededTestDb, SEED_IDS } from './helpers/pgliteDb';
import { PgliteDbAdapter, type AuthCaller } from '../src/server/services/types';
import { loadServerConfig } from '../src/server/config';
import { createPaymentAdapter } from '../src/server/adapters/paymentAdapter';
import { StubEmailAdapter } from '../src/server/adapters/emailAdapter';
import { setPropertyFeatureToggle } from '../src/server/services/superAdminService';
import { saveAssignmentsWorkflow } from '../src/server/services/assignmentService';
import {
  buildSignedMockStripeEvent,
  createTipCheckoutWorkflow,
  handleStripeWebhookWorkflow,
  resolveRoomViewWorkflow,
} from '../src/server/services/guestTippingService';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('Step 6 Guest Tipping, Checkout Intents & Stripe Webhook (AC-1..AC-4)', () => {
  let db: PGlite;
  let adapter: PgliteDbAdapter;
  const config = loadServerConfig({});
  const paymentAdapter = createPaymentAdapter(config);
  const emailAdapter = new StubEmailAdapter(null);

  const A = SEED_IDS.properties.palomaA;
  const superCaller: AuthCaller = { uid: SEED_IDS.users.superAdmin, email: 'superadmin@frontdesktip.test' };
  const adminA: AuthCaller = { uid: SEED_IDS.users.adminA, email: 'admin.paloma@frontdesktip.test' };

  beforeAll(async () => {
    db = await createSeededTestDb();
    adapter = new PgliteDbAdapter(db);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('AC-1 & AC-2: resolves assigned room, unassigned room, dept, and person with strict PII minimization', async () => {
    // Upload a property backdrop and verify signed URL is returned
    const backdropPath = `${A}/hero-test.png`;
    await adapter.uploadPrivateObject('property-backdrops', backdropPath, PNG_1X1);
    await db.query(`UPDATE public.properties SET hero_photo_path = $1 WHERE id = $2`, [backdropPath, A]);

    // AC-1: Room 412 assigned to Maria Garcia today
    const r412 = await resolveRoomViewWorkflow(adapter, 'room', SEED_IDS.rooms.r412);
    expect(r412.ok).toBe(true);
    expect(r412.heroBackdropUrl).toContain('/api/dev/storage-object?bucket=property-backdrops');
    expect(r412.assignedHousekeeper).toMatchObject({
      personId: SEED_IDS.people.maria,
      displayName: 'Maria Garcia',
    });
    const raw412 = JSON.stringify(r412);
    expect(raw412).not.toContain('@frontdesktip.test'); // zero emails
    expect(raw412).not.toContain('wallet_balance'); // zero balances
    expect(raw412).not.toContain('Sophia Alvarez'); // dept_manager excluded
    expect(raw412).not.toContain('Carlos Vega'); // inactive staff excluded

    // AC-2: Room 101 has no assignment today -> assignedHousekeeper === null, Housekeeping lists Pool + active staff
    const r101 = await resolveRoomViewWorkflow(adapter, 'room', SEED_IDS.rooms.r101);
    expect(r101.ok).toBe(true);
    expect(r101.assignedHousekeeper).toBeNull();
    const hk = r101.departments?.find((d) => d.isHousekeeping);
    expect(hk?.poolEnabled).toBe(true);
    expect(hk?.staff.map((s) => s.displayName)).toEqual(['Elena Rostova', 'Maria Garcia']);

    // Inactive person falls back to department pool when FT-4 is on, or returns RECIPIENT_UNAVAILABLE when off
    const inactiveFallback = await resolveRoomViewWorkflow(adapter, 'person', SEED_IDS.people.carlos);
    expect(inactiveFallback.ok).toBe(true);
    expect(inactiveFallback.mode).toBe('person_fallback_pool');

    await setPropertyFeatureToggle(adapter, superCaller, A, 'department_pool_tips', false);
    const inactiveBlocked = await resolveRoomViewWorkflow(adapter, 'person', SEED_IDS.people.carlos);
    expect(inactiveBlocked).toMatchObject({ ok: false, code: 'RECIPIENT_UNAVAILABLE' });
    await setPropertyFeatureToggle(adapter, superCaller, A, 'department_pool_tips', true);

    // Invalid UUID and restricted property
    expect(await resolveRoomViewWorkflow(adapter, 'room', 'not-a-uuid')).toMatchObject({
      ok: false,
      code: 'TARGET_NOT_FOUND',
    });
  });

  it('AC-3: commits tip, wallet balance, ledger, notification, and email receipt ONLY on signed webhook (idempotent)', async () => {
    const beforeBal = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    const beforeTips = Number((await db.query<{ c: string }>(`SELECT COUNT(*)::TEXT AS c FROM public.tips`)).rows[0].c);

    // 1. Create checkout intent ($10.00 tip, guest pays fee = 2.9% + $0.30 = $0.59)
    const checkout = await createTipCheckoutWorkflow({
      db: adapter,
      paymentAdapter,
      input: {
        sourceType: 'room',
        sourceId: SEED_IDS.rooms.r101,
        recipientType: 'person',
        personId: SEED_IDS.people.elena,
        departmentId: SEED_IDS.departments.housekeepingA,
        amountCents: 1000,
        note: 'Spotless suite, thank you!',
        guestEmail: 'guest@example.com',
      },
    });
    expect(checkout.amountCents).toBe(1000);
    expect(checkout.guestFeeCents).toBe(59);
    expect(checkout.chargeCents).toBe(1059);
    expect(checkout.netCents).toBe(1000);

    // Before webhook: 0 new tips, wallet unchanged
    const midTips = Number((await db.query<{ c: string }>(`SELECT COUNT(*)::TEXT AS c FROM public.tips`)).rows[0].c);
    expect(midTips).toBe(beforeTips);
    const midBal = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    expect(midBal).toBe(beforeBal);

    // 2. Invalid signature fails
    const signed = buildSignedMockStripeEvent(config, 'payment_intent.succeeded', checkout.paymentIntentId);
    await expect(
      handleStripeWebhookWorkflow({
        db: adapter,
        paymentAdapter,
        emailAdapter,
        rawBody: signed.rawBody,
        signatureHeader: 't=123,v1=bad',
      })
    ).rejects.toThrow();

    // 3. Valid signed webhook commits tip + ledger + wallet + notification + email receipt
    const outboxBefore = emailAdapter.getOutbox().length;
    const ok1 = (await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: signed.rawBody,
      signatureHeader: signed.signatureHeader,
    })) as { deduplicated?: boolean; tipId?: string };
    expect(ok1.deduplicated).toBe(false);

    const afterBal = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    expect(afterBal).toBe(beforeBal + 1000);
    expect(emailAdapter.getOutbox().length).toBe(outboxBefore + 1);

    const notifs = await db.query<{ message: string }>(
      `SELECT message FROM public.notifications WHERE person_id = $1 AND tip_id = $2`,
      [SEED_IDS.people.elena, ok1.tipId]
    );
    expect(notifs.rows[0]?.message).toContain('$10.00');
    expect(notifs.rows[0]?.message).toContain('Room 101');

    // 4. Replay exact event -> deduplicated, no double credit
    const ok2 = (await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: signed.rawBody,
      signatureHeader: signed.signatureHeader,
    })) as { deduplicated?: boolean };
    expect(ok2.deduplicated).toBe(true);
    const replayBal = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    expect(replayBal).toBe(beforeBal + 1000);
  });

  it('AC-4: blocks stale checkout with ASSIGNMENT_CHANGED after mid-day reassignment, while preserving in-flight tips', async () => {
    // Guest loads Room 412 at T0 (Maria assigned). Starts an in-flight checkout for Maria.
    const inFlightMaria = await createTipCheckoutWorkflow({
      db: adapter,
      paymentAdapter,
      input: {
        sourceType: 'room',
        sourceId: SEED_IDS.rooms.r412,
        recipientType: 'person',
        personId: SEED_IDS.people.maria,
        departmentId: SEED_IDS.departments.housekeepingA,
        amountCents: 500,
        expectedPersonId: SEED_IDS.people.maria,
      },
    });

    // Admin reassigns Room 412 from Maria to Elena mid-day
    const today = (
      await db.query<{ d: string }>(`SELECT (now() AT TIME ZONE 'America/Chicago')::DATE::TEXT AS d`)
    ).rows[0].d;
    await saveAssignmentsWorkflow(adapter, adminA, {
      propertyId: A,
      date: today,
      source: 'manual',
      items: [{ roomNumber: '412', personId: SEED_IDS.people.elena }],
    });

    // (a) Another guest with stale T0 page tries to submit for Maria -> ASSIGNMENT_CHANGED
    await expect(
      createTipCheckoutWorkflow({
        db: adapter,
        paymentAdapter,
        input: {
          sourceType: 'room',
          sourceId: SEED_IDS.rooms.r412,
          recipientType: 'person',
          personId: SEED_IDS.people.maria,
          departmentId: SEED_IDS.departments.housekeepingA,
          amountCents: 500,
          expectedPersonId: SEED_IDS.people.maria,
        },
      })
    ).rejects.toThrow(/ASSIGNMENT_CHANGED/);

    // (b) In-flight checkout started pre-reassignment still credits Maria on webhook
    const mariaBefore = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.maria])).rows[0].wallet_balance_cents
    );
    const mariaEvt = buildSignedMockStripeEvent(config, 'payment_intent.succeeded', inFlightMaria.paymentIntentId);
    await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: mariaEvt.rawBody,
      signatureHeader: mariaEvt.signatureHeader,
    });
    const mariaAfter = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.maria])).rows[0].wallet_balance_cents
    );
    expect(mariaAfter).toBe(mariaBefore + 500);

    // (c) Post-reassignment checkout credits Elena
    const elenaBefore = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    const freshElena = await createTipCheckoutWorkflow({
      db: adapter,
      paymentAdapter,
      input: {
        sourceType: 'room',
        sourceId: SEED_IDS.rooms.r412,
        recipientType: 'person',
        personId: SEED_IDS.people.elena,
        departmentId: SEED_IDS.departments.housekeepingA,
        amountCents: 800,
        expectedPersonId: SEED_IDS.people.elena,
      },
    });
    const elenaEvt = buildSignedMockStripeEvent(config, 'payment_intent.succeeded', freshElena.paymentIntentId);
    await handleStripeWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      emailAdapter,
      rawBody: elenaEvt.rawBody,
      signatureHeader: elenaEvt.signatureHeader,
    });
    const elenaAfter = Number(
      (await db.query<{ wallet_balance_cents: string }>(`SELECT wallet_balance_cents::TEXT FROM public.people WHERE id = $1`, [SEED_IDS.people.elena])).rows[0].wallet_balance_cents
    );
    expect(elenaAfter).toBe(elenaBefore + 800);
  });
});
