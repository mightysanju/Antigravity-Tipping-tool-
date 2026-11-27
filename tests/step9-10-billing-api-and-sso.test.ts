import crypto from 'node:crypto';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createSeededTestDb, SEED_IDS } from './helpers/pgliteDb';
import { PgliteDbAdapter, type AuthCaller } from '../src/server/services/types';
import { loadServerConfig } from '../src/server/config';
import { createPaymentAdapter } from '../src/server/adapters/paymentAdapter';
import { setPropertyFeatureToggle } from '../src/server/services/superAdminService';
import { resolveRoomViewWorkflow } from '../src/server/services/guestTippingService';
import {
  createPropertyApiKeyWorkflow,
  exchangeSsoTokenWorkflow,
  handleApiGatewayRequest,
  handleBillingWebhookWorkflow,
  mintServerSsoTokenWorkflow,
  revokePropertyApiKeyWorkflow,
  upsertSsoProviderWorkflow,
} from '../src/server/services/billingApiAndSsoService';

function signBillingEvent(
  secret: string,
  type: 'invoice.payment_failed' | 'invoice.paid',
  customerId: string,
  invoiceId: string
) {
  const payload = JSON.stringify({
    id: `evt_bill_${crypto.randomUUID().slice(0, 10)}`,
    object: 'event',
    api_version: '2025-02-24.acacia',
    created: Math.floor(Date.now() / 1000),
    type,
    data: {
      object: {
        id: invoiceId,
        object: 'invoice',
        customer: customerId,
        subscription: 'sub_mock_paloma',
        amount_due: 19900,
        amount_paid: type === 'invoice.paid' ? 19900 : 0,
        period_start: Math.floor(Date.now() / 1000) - 2592000,
        period_end: Math.floor(Date.now() / 1000),
      },
    },
  });
  const stripe = new Stripe('sk_test_mock_dev_key');
  const signatureHeader = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { rawBody: payload, signatureHeader };
}

describe('Steps 9 & 10 Billing Sync, External API Gateway & Single Sign-On', () => {
  let db: PGlite;
  let adapter: PgliteDbAdapter;
  const config = loadServerConfig({});
  const paymentAdapter = createPaymentAdapter(config);

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

  it('Step 9: restricts active property on invoice.payment_failed (blocking guest & withdrawals) and restores on invoice.paid', async () => {
    const failedEvt = signBillingEvent(
      config.stripeWebhookSecret,
      'invoice.payment_failed',
      'cus_mock_paloma',
      'in_mock_fail_1'
    );
    const res1 = await handleBillingWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      rawBody: failedEvt.rawBody,
      signatureHeader: failedEvt.signatureHeader,
    });
    expect(res1).toMatchObject({ ok: true, status: 'restricted' });

    // Guest tipping blocked
    const guest = await resolveRoomViewWorkflow(adapter, 'room', SEED_IDS.rooms.r412);
    expect(guest).toMatchObject({ ok: false, code: 'PROPERTY_RESTRICTED' });

    // Withdrawal blocked
    await db.query(`UPDATE public.people SET stripe_connect_account_id = 'acct_mock_test' WHERE id = $1`, [SEED_IDS.people.maria]);
    await expect(
      adapter.callServiceRpc('create_staff_withdrawal', {}, [SEED_IDS.people.maria, 1000, 'standard'])
    ).rejects.toThrow(/PROPERTY_RESTRICTED/);

    // Invoice mirrored in public.invoices
    const inv = await db.query<{ status: string }>(
      `SELECT status FROM public.invoices WHERE stripe_invoice_id = 'in_mock_fail_1'`
    );
    expect(inv.rows[0]?.status).toBe('open');

    // invoice.paid restores active
    const paidEvt = signBillingEvent(
      config.stripeWebhookSecret,
      'invoice.paid',
      'cus_mock_paloma',
      'in_mock_fail_1'
    );
    const res2 = await handleBillingWebhookWorkflow({
      db: adapter,
      paymentAdapter,
      rawBody: paidEvt.rawBody,
      signatureHeader: paidEvt.signatureHeader,
    });
    expect(res2).toMatchObject({ ok: true, status: 'active' });
  });

  it('Step 10A: enforces API key auth, scopes, toggles, PII omission, and revocation on api-gateway', async () => {
    // Non-super-admin cannot create API keys
    await expect(
      createPropertyApiKeyWorkflow(adapter, adminA, {
        propertyId: A,
        label: 'Unauthorized Key',
        scopes: ['people:read'],
      })
    ).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);

    const created = await createPropertyApiKeyWorkflow(adapter, superCaller, {
      propertyId: A,
      label: 'PMS Integration',
      scopes: ['assignments:write', 'people:read', 'tips:read'],
    });
    expect(created.rawKey).toMatch(/^fdp_live_/);

    // Missing / wrong key -> 401
    expect(
      (await handleApiGatewayRequest({ db: adapter, apiKey: null, method: 'GET', path: '/people' })).status
    ).toBe(401);
    expect(
      (await handleApiGatewayRequest({ db: adapter, apiKey: 'fdp_live_wrong', method: 'GET', path: '/people' })).status
    ).toBe(401);

    // Wrong scope -> 403
    expect(
      (
        await handleApiGatewayRequest({
          db: adapter,
          apiKey: created.rawKey,
          method: 'POST',
          path: '/people',
          body: { name: 'X', email: 'x@test.com', role: 'staff' },
        })
      ).status
    ).toBe(403);

    // Enable FT-25 & FT-13 and push assignments by externalEmail
    await setPropertyFeatureToggle(adapter, superCaller, A, 'external_api', true);
    await setPropertyFeatureToggle(adapter, superCaller, A, 'api_assignment_push', true);

    const push = await handleApiGatewayRequest({
      db: adapter,
      apiKey: created.rawKey,
      method: 'POST',
      path: '/assignments',
      body: {
        date: '2026-11-26',
        assignments: [
          { roomNumber: '101', externalEmail: 'maria.garcia@frontdesktip.test' },
          { roomNumber: '999', externalEmail: 'maria.garcia@frontdesktip.test' },
        ],
      },
    });
    expect(push.status).toBe(200);
    expect(push.body).toMatchObject({ savedCount: 1, unmatchedRooms: ['999'] });

    // GET /tips omits guest_email PII
    const tips = await handleApiGatewayRequest({
      db: adapter,
      apiKey: created.rawKey,
      method: 'GET',
      path: '/tips',
    });
    expect(tips.status).toBe(200);
    expect(JSON.stringify(tips.body)).not.toContain('guestEmail');

    // Revoke key -> 401
    await revokePropertyApiKeyWorkflow(adapter, superCaller, created.id);
    expect(
      (await handleApiGatewayRequest({ db: adapter, apiKey: created.rawKey, method: 'GET', path: '/people' })).status
    ).toBe(401);
  });

  it('Step 10B: verifies server_minted and partner_asymmetric (RS256) SSO, blocks replay, cross-property, and super_admin', async () => {
    await setPropertyFeatureToggle(adapter, superCaller, A, 'single_sign_on', true);

    // 1. server_minted mode
    await upsertSsoProviderWorkflow(adapter, superCaller, {
      propertyId: A,
      clientId: 'pms-paloma-hs',
      authMode: 'server_minted',
      clientSecret: 'super-partner-secret-123',
      enabled: true,
    });

    const minted = await mintServerSsoTokenWorkflow({
      db: adapter,
      config,
      clientId: 'pms-paloma-hs',
      clientSecret: 'super-partner-secret-123',
      email: 'admin.paloma@frontdesktip.test',
    });
    expect(minted.redirectUrl).toContain('/login#sso=');

    const exchanged = await exchangeSsoTokenWorkflow({ db: adapter, config, token: minted.token });
    expect(exchanged).toMatchObject({ ok: true, role: 'property_admin', propertyId: A });

    // Replay blocked
    await expect(exchangeSsoTokenWorkflow({ db: adapter, config, token: minted.token })).rejects.toThrow(
      /SSO_TOKEN_REPLAYED/
    );

    // Super Admin SSO rejected
    const superMint = await mintServerSsoTokenWorkflow({
      db: adapter,
      config,
      clientId: 'pms-paloma-hs',
      clientSecret: 'super-partner-secret-123',
      email: 'superadmin@frontdesktip.test',
    });
    await expect(exchangeSsoTokenWorkflow({ db: adapter, config, token: superMint.token })).rejects.toThrow(
      /SUPER_ADMIN_SSO_FORBIDDEN/
    );

    // Cross-property user rejected
    const crossMint = await mintServerSsoTokenWorkflow({
      db: adapter,
      config,
      clientId: 'pms-paloma-hs',
      clientSecret: 'super-partner-secret-123',
      email: 'admin.harbor@frontdesktip.test',
    });
    await expect(exchangeSsoTokenWorkflow({ db: adapter, config, token: crossMint.token })).rejects.toThrow(
      /CROSS_PROPERTY_OR_INACTIVE_SSO_FORBIDDEN/
    );

    // 2. partner_asymmetric (RS256) mode
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    await upsertSsoProviderWorkflow(adapter, superCaller, {
      propertyId: A,
      clientId: 'pms-paloma-rsa',
      authMode: 'partner_asymmetric',
      publicKeyPem: publicKey,
      enabled: true,
    });

    const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const pay = Buffer.from(
      JSON.stringify({
        iss: 'pms-paloma-rsa',
        sub: 'maria.garcia@frontdesktip.test',
        propertyId: A,
        jti: crypto.randomUUID(),
        exp: Math.floor(Date.now() / 1000) + 60,
      })
    ).toString('base64url');
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${hdr}.${pay}`), privateKey).toString('base64url');
    const rsaToken = `${hdr}.${pay}.${sig}`;

    const rsaExchanged = await exchangeSsoTokenWorkflow({ db: adapter, config, token: rsaToken });
    expect(rsaExchanged).toMatchObject({ ok: true, role: 'staff', propertyId: A });
  });
});
