import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createSeededTestDb, SEED_IDS } from './helpers/pgliteDb';
import { PgliteDbAdapter, type AuthCaller } from '../src/server/services/types';
import { StubEmailAdapter } from '../src/server/adapters/emailAdapter';
import { signAgreementWorkflow } from '../src/server/services/agreementService';
import {
  getPlatformPaymentsOverview,
  getPropertySuperDetail,
  getSuperDashboard,
  invitePropertyAdminWorkflow,
  listPropertyAdminsSuper,
  onboardPropertyWizard,
  removePropertyAdminSuper,
  setPropertyFeatureToggle,
  updatePlatformPaymentDefaults,
  updatePropertySettingsSuper,
} from '../src/server/services/superAdminService';
import { FEATURE_KEYS } from '../src/shared/features';

describe('Step 2 Super Admin Onboarding, 27 Feature Toggles & Click-to-Accept Contracts', () => {
  let db: PGlite;
  let dbAdapter: PgliteDbAdapter;
  let emailAdapter: StubEmailAdapter;

  const superCaller: AuthCaller = {
    uid: SEED_IDS.users.superAdmin,
    email: 'superadmin@frontdesktip.test',
  };
  const adminACaller: AuthCaller = {
    uid: SEED_IDS.users.adminA,
    email: 'admin.paloma@frontdesktip.test',
  };

  let onboardedPropertyId = '';

  beforeAll(async () => {
    db = await createSeededTestDb();
    dbAdapter = new PgliteDbAdapter(db);
    emailAdapter = new StubEmailAdapter(null);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('onboards a pending property via 7-step wizard with QR coordinates, hero photo & nullable-dept admin', async () => {
    const wizardPayload = {
      name: 'Solis Cove Resort',
      address: '100 Ocean Palms Blvd, Miami, FL',
      contactName: 'Elena Navarro',
      contactEmail: 'gm@soliscove.test',
      adminName: 'Elena Navarro',
      adminEmail: 'elena.navarro@soliscove.test',
      planType: 'monthly',
      planPriceCents: 24900,
      contractTermMonths: 12,
      noticeDays: 30,
      paymentFeePaidBy: 'guest',
      payoutFeePaidBy: 'property',
      payoutWeekday: 4,
      timezone: 'America/New_York',
      minWithdrawalCents: 1000,
      templatePath: 'templates/solis-card.png',
      heroPhotoPath: 'backdrops/solis-cove.webp',
      qrPosition: { x: 0.35, y: 0.45, size: 0.28 },
      defaultFeaturesEnabled: true,
      departments: [
        { name: 'Housekeeping', isHousekeeping: true, defaultDistribution: 'split' },
        { name: 'Pool & Cabana', isHousekeeping: false, defaultDistribution: 'individual' },
      ],
    };

    // Non-super-admin blocked
    await expect(
      onboardPropertyWizard(dbAdapter, adminACaller, wizardPayload)
    ).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);

    const created = await onboardPropertyWizard(dbAdapter, superCaller, wizardPayload);
    onboardedPropertyId = String(created.propertyId);
    expect(onboardedPropertyId).toBeTruthy();

    const detail = await getPropertySuperDetail(dbAdapter, superCaller, onboardedPropertyId);
    const prop = detail.property as Record<string, unknown>;
    expect(prop.status).toBe('pending');
    expect(prop.hero_photo_path).toBe('backdrops/solis-cove.webp');
    expect(prop.qr_position).toEqual({ x: 0.35, y: 0.45, size: 0.28 });
    expect((detail.features as unknown[]).length).toBe(27);
    expect((detail.departments as unknown[]).length).toBe(2);
    expect((detail.admins as Array<{ email: string }>).map((a) => a.email)).toEqual([
      'elena.navarro@soliscove.test',
    ]);
  });

  it('blocks activating pending property until Property Service Agreement is signed and generates immutable PDF', async () => {
    // Cannot set status='active' before agreement is signed
    await expect(
      updatePropertySettingsSuper(dbAdapter, superCaller, onboardedPropertyId, {
        status: 'active',
      })
    ).rejects.toThrow(/PROPERTY_AGREEMENT_REQUIRED/);

    // Sign agreement via click-to-accept workflow
    const signed = await signAgreementWorkflow({
      db: dbAdapter,
      emailAdapter,
      caller: superCaller,
      input: {
        signerType: 'property',
        signerId: onboardedPropertyId,
        propertyId: onboardedPropertyId,
        propertyName: 'Solis Cove Resort',
        typedName: 'Elena Navarro',
        checkboxConfirmed: true,
        ipAddress: '203.0.113.42',
        userAgent: 'vitest-agent',
      },
    });

    const pdfBytes = Buffer.from(signed.pdfBase64, 'base64');
    const pdfText = pdfBytes.toString('utf8');
    expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdfText).toContain('Elena Navarro');
    expect(pdfText).toContain('Solis Cove Resort');
    expect(pdfText).toContain('203.0.113.42');

    // Stored PDF object exists in signed-agreements
    const stored = await dbAdapter.getStoredObject('signed-agreements', signed.pdfStoragePath);
    expect(stored?.equals(pdfBytes)).toBe(true);

    // Property is now active
    const detail = await getPropertySuperDetail(dbAdapter, superCaller, onboardedPropertyId);
    expect((detail.property as Record<string, unknown>).status).toBe('active');
    expect((detail.agreements as unknown[]).length).toBe(1);

    // Agreements & signed-agreements storage objects are immutable
    await expect(
      db.query(`UPDATE public.agreements SET typed_name = 'Tampered'`)
    ).rejects.toThrow(/AGREEMENT_IMMUTABLE/);
    await expect(db.query(`DELETE FROM public.agreements`)).rejects.toThrow(/AGREEMENT_IMMUTABLE/);
    await expect(
      db.query(`DELETE FROM storage.objects WHERE bucket_id = 'signed-agreements'`)
    ).rejects.toThrow(/SIGNED_AGREEMENT_OBJECT_IMMUTABLE/);
  });

  it('enforces super-admin-only control over all 27 feature toggles without deleting historical data', async () => {
    await expect(
      setPropertyFeatureToggle(dbAdapter, adminACaller, SEED_IDS.properties.palomaA, 'guest_notes', false)
    ).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);

    // Disable and verify every single one of the 27 toggles, then restore
    for (const key of FEATURE_KEYS) {
      await setPropertyFeatureToggle(
        dbAdapter,
        superCaller,
        SEED_IDS.properties.palomaA,
        key,
        false
      );

      await expect(
        db.query(`SELECT public.assert_property_feature_enabled($1, $2)`, [
          SEED_IDS.properties.palomaA,
          key,
        ])
      ).rejects.toThrow(/FEATURE_DISABLED/);
    }

    // Historical tips and ledger data remain intact when toggles are turned off (L270)
    const tipCountRes = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.tips WHERE property_id = $1`,
      [SEED_IDS.properties.palomaA]
    );
    expect(Number(tipCountRes.rows[0].count)).toBeGreaterThan(0);

    for (const key of FEATURE_KEYS) {
      await setPropertyFeatureToggle(
        dbAdapter,
        superCaller,
        SEED_IDS.properties.palomaA,
        key,
        true
      );
    }
  });

  it('computes cross-property dashboard KPIs, updates payout defaults, and respects FT-24 on admin invites', async () => {
    await expect(getSuperDashboard(dbAdapter, adminACaller)).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);

    const dash = await getSuperDashboard(dbAdapter, superCaller);
    const kpis = dash.kpis as { totalTipsCents: number; activeSubscriptionsCount: number };
    expect(kpis.totalTipsCents).toBe(21700);
    expect(kpis.activeSubscriptionsCount).toBe(3);

    const payments = await getPlatformPaymentsOverview(dbAdapter, superCaller);
    expect((payments.properties as unknown[]).length).toBeGreaterThanOrEqual(4);

    const updated = await updatePlatformPaymentDefaults(dbAdapter, superCaller, 5, 1500, true);
    expect(updated.payoutWeekday).toBe(5);
    expect(updated.minWithdrawalCents).toBe(1500);

    // Invite with FT-24 = true sends invite email
    const countBefore = emailAdapter.getOutbox().length;
    const inviteRes = await invitePropertyAdminWorkflow({
      db: dbAdapter,
      emailAdapter,
      caller: superCaller,
      propertyId: onboardedPropertyId,
      name: 'Marco Bellini',
      email: 'marco@soliscove.test',
    });
    expect(inviteRes.emailSent).toBe(true);
    expect(emailAdapter.getOutbox().length).toBe(countBefore + 1);

    // Disable FT-24 (email_invites) -> creates admin row without sending email
    await setPropertyFeatureToggle(dbAdapter, superCaller, onboardedPropertyId, 'email_invites', false);
    const inviteMuted = await invitePropertyAdminWorkflow({
      db: dbAdapter,
      emailAdapter,
      caller: superCaller,
      propertyId: onboardedPropertyId,
      name: 'Nadia Chen',
      email: 'nadia@soliscove.test',
    });
    expect(inviteMuted.emailSent).toBe(false);
    expect(emailAdapter.getOutbox().length).toBe(countBefore + 1);

    // Deactivate invited admin
    const removed = await removePropertyAdminSuper(
      dbAdapter,
      superCaller,
      String((inviteMuted.person as { id: string }).id)
    );
    expect(removed.status).toBe('inactive');

    const admins = await listPropertyAdminsSuper(dbAdapter, superCaller);
    expect(admins.length).toBeGreaterThanOrEqual(4);
  });
});
