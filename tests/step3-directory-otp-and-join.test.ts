import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createSeededTestDb, SEED_IDS } from './helpers/pgliteDb';
import { PgliteDbAdapter, type AuthCaller } from '../src/server/services/types';
import { StubEmailAdapter } from '../src/server/adapters/emailAdapter';
import { loadServerConfig } from '../src/server/config';
import {
  createPersonWorkflow,
  deleteDepartmentWithReassign,
  listDepartmentsAdmin,
  listPeopleAdmin,
  updatePersonWorkflow,
  upsertDepartmentAdmin,
} from '../src/server/services/adminDirectoryService';
import {
  checkTrustedDeviceWorkflow,
  completeJoinQrWorkflow,
  getLoginAccountContext,
  listJoinableStaffWorkflow,
  sendJoinQrOtpWorkflow,
  sendOtpWorkflow,
  verifyOtpWorkflow,
} from '../src/server/services/otpAndAuthService';
import { setPropertyFeatureToggle } from '../src/server/services/superAdminService';

describe('Step 3 Directory, Salted/Keyed Email OTP, Trusted Devices & Join QR', () => {
  let db: PGlite;
  let dbAdapter: PgliteDbAdapter;
  let emailAdapter: StubEmailAdapter;
  const config = loadServerConfig({});

  const superCaller: AuthCaller = {
    uid: SEED_IDS.users.superAdmin,
    email: 'superadmin@frontdesktip.test',
  };
  const adminACaller: AuthCaller = {
    uid: SEED_IDS.users.adminA,
    email: 'admin.paloma@frontdesktip.test',
  };
  const mariaCaller: AuthCaller = {
    uid: SEED_IDS.users.maria,
    email: 'maria.garcia@frontdesktip.test',
  };

  beforeAll(async () => {
    db = await createSeededTestDb();
    dbAdapter = new PgliteDbAdapter(db);
    emailAdapter = new StubEmailAdapter(null);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('manages departments with AC-8 forced reassignment and enforces FT-15/FT-24/email-lock on people', async () => {
    const dept = await upsertDepartmentAdmin(dbAdapter, adminACaller, {
      propertyId: SEED_IDS.properties.palomaA,
      name: 'Pool & Cabana',
      isHousekeeping: false,
      defaultDistribution: 'split',
    });
    const deptId = String(dept.id);

    const created = await createPersonWorkflow({
      db: dbAdapter,
      emailAdapter,
      caller: adminACaller,
      input: {
        propertyId: SEED_IDS.properties.palomaA,
        name: 'Rosa Martinez',
        email: 'rosa.martinez@frontdesktip.test',
        role: 'staff',
        departmentId: deptId,
      },
    });
    expect(created.emailSent).toBe(true);
    const rosa = created.person as { id: string; auth_user_id: string | null };
    expect(rosa.auth_user_id).toBeNull();

    // Deleting Pool & Cabana without target fails; with target succeeds
    await expect(
      deleteDepartmentWithReassign(dbAdapter, adminACaller, deptId, null)
    ).rejects.toThrow(/REASSIGN_TARGET_REQUIRED/);

    const delRes = await deleteDepartmentWithReassign(
      dbAdapter,
      adminACaller,
      deptId,
      SEED_IDS.departments.frontDeskA
    );
    expect(delRes.reassignedPeopleCount).toBe(1);

    const deptsAfter = await listDepartmentsAdmin(dbAdapter, adminACaller, SEED_IDS.properties.palomaA);
    expect(deptsAfter.some((d) => d.id === deptId)).toBe(false);

    // Disable FT-15 (department_manager_role) -> creating dept_manager blocked
    await setPropertyFeatureToggle(
      dbAdapter,
      superCaller,
      SEED_IDS.properties.palomaA,
      'department_manager_role',
      false
    );
    await expect(
      createPersonWorkflow({
        db: dbAdapter,
        emailAdapter,
        caller: adminACaller,
        input: {
          propertyId: SEED_IDS.properties.palomaA,
          name: 'Blocked Manager',
          email: 'blocked.mgr@frontdesktip.test',
          role: 'dept_manager',
          departmentId: SEED_IDS.departments.frontDeskA,
        },
      })
    ).rejects.toThrow(/FEATURE_DISABLED/);
    await setPropertyFeatureToggle(
      dbAdapter,
      superCaller,
      SEED_IDS.properties.palomaA,
      'department_manager_role',
      true
    );

    // Claimed staff email cannot be changed by property_admin
    await expect(
      updatePersonWorkflow(dbAdapter, adminACaller, {
        personId: SEED_IDS.people.maria,
        email: 'hijacked@frontdesktip.test',
      })
    ).rejects.toThrow(/CLAIMED_EMAIL_LOCKED/);

    const listRes = await listPeopleAdmin(dbAdapter, adminACaller, SEED_IDS.properties.palomaA);
    expect(listRes.people.length).toBeGreaterThanOrEqual(5);
  });

  it('enforces OTP HMAC hashing, 3-per-10m send rate limit, concurrent FOR UPDATE 5-attempt cap & trusted devices', async () => {
    const targetEmail = 'maria.garcia@frontdesktip.test';

    // 3 sends succeed; 4th in 10 min is rate limited
    for (let i = 0; i < 3; i += 1) {
      await sendOtpWorkflow({
        db: dbAdapter,
        emailAdapter,
        config,
        email: targetEmail,
        purpose: 'new_device',
        clientIp: '198.51.100.10',
      });
    }

    await expect(
      sendOtpWorkflow({
        db: dbAdapter,
        emailAdapter,
        config,
        email: targetEmail,
        purpose: 'new_device',
        clientIp: '198.51.100.10',
      })
    ).rejects.toThrow(/RATE_LIMITED_EMAIL/);

    // Extract latest OTP from stub outbox and verify DB never stores plaintext
    const latestEmail = emailAdapter.getOutbox()[emailAdapter.getOutbox().length - 1];
    const match = latestEmail.text.match(/\b(\d{6})\b/);
    expect(match).not.toBeNull();
    const realCode = match![1];

    const rawDbOtp = await db.query<{ hashed_code: string }>(
      `SELECT hashed_code FROM public.otp_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
      [targetEmail]
    );
    expect(rawDbOtp.rows[0].hashed_code).not.toBe(realCode);
    expect(rawDbOtp.rows[0].hashed_code).toHaveLength(64);

    // Fire 6 concurrent wrong guesses -> FOR UPDATE serializes cleanly without CHECK crash, revoking at 5
    const wrongGuesses = await Promise.all(
      Array.from({ length: 6 }, () =>
        verifyOtpWorkflow({
          db: dbAdapter,
          config,
          email: targetEmail,
          purpose: 'new_device',
          code: '000000',
        })
      )
    );
    expect(wrongGuesses.every((r) => r.verified === false)).toBe(true);
    expect(wrongGuesses.some((r) => r.reason === 'OTP_MAX_ATTEMPTS')).toBe(true);

    // Fresh purpose ('login') verifies and persists trusted_devices token
    await sendOtpWorkflow({
      db: dbAdapter,
      emailAdapter,
      config,
      email: targetEmail,
      purpose: 'login',
      clientIp: '198.51.100.10',
    });
    const loginEmail = emailAdapter.getOutbox()[emailAdapter.getOutbox().length - 1];
    const loginCode = loginEmail.text.match(/\b(\d{6})\b/)![1];

    const verified = await verifyOtpWorkflow({
      db: dbAdapter,
      config,
      email: targetEmail,
      purpose: 'login',
      code: loginCode,
      trustDevice: true,
      authUserId: SEED_IDS.users.maria,
      userAgent: 'vitest-browser',
      clientIp: '198.51.100.10',
    });
    expect(verified.verified).toBe(true);
    expect(verified.deviceToken).toBeTruthy();

    expect(
      await checkTrustedDeviceWorkflow(dbAdapter, SEED_IDS.users.maria, verified.deviceToken!)
    ).toBe(true);
    expect(
      await checkTrustedDeviceWorkflow(dbAdapter, SEED_IDS.users.maria, 'forged_token')
    ).toBe(false);

    const ctx = await getLoginAccountContext(dbAdapter, mariaCaller);
    expect(ctx.role).toBe('staff');
    expect(ctx.needsStaffAgreement).toBe(false);
  });

  it('enforces Join QR unclaimed directory (zero emails), OTP claim, Staff Agreement & FT-23 gate', async () => {
    // Public directory lists ONLY unclaimed active staff (Liam Patel) with zero emails
    const joinList = await listJoinableStaffWorkflow(dbAdapter, SEED_IDS.properties.palomaA);
    expect(joinList.ok).toBe(true);
    const serialized = JSON.stringify(joinList);
    expect(serialized).toContain('Liam Patel');
    expect(serialized).not.toContain('liam.patel@frontdesktip.test');
    expect(serialized).not.toContain('Maria Garcia'); // already claimed
    expect(serialized).not.toContain('Sophia Alvarez'); // dept_manager

    // Send Join QR OTP -> returns masked email only
    const otpSent = await sendJoinQrOtpWorkflow({
      db: dbAdapter,
      emailAdapter,
      config,
      propertyId: SEED_IDS.properties.palomaA,
      personId: SEED_IDS.people.liamUnclaimed,
      clientIp: '198.51.100.20',
    });
    expect(otpSent.maskedEmail).toBe('li***@frontdesktip.test');

    const latest = emailAdapter.getOutbox()[emailAdapter.getOutbox().length - 1];
    const code = latest.text.match(/\b(\d{6})\b/)![1];

    // Complete Join QR -> creates auth user, links auth_user_id, signs Staff Agreement
    const completed = await completeJoinQrWorkflow({
      db: dbAdapter,
      emailAdapter,
      config,
      propertyId: SEED_IDS.properties.palomaA,
      personId: SEED_IDS.people.liamUnclaimed,
      code,
      password: 'SecureHotelPass!2026',
      typedName: 'Liam Patel',
      checkboxConfirmed: true,
      clientIp: '198.51.100.20',
      userAgent: 'vitest-mobile',
    });
    expect((completed.person as { auth_user_id: string }).auth_user_id).toBe(completed.authUserId);
    expect((completed.person as { agreement_signed_at: string | null }).agreement_signed_at).toBeTruthy();

    // Repeat Join QR attempt fails with ALREADY_ONBOARDED
    await expect(
      sendJoinQrOtpWorkflow({
        db: dbAdapter,
        emailAdapter,
        config,
        propertyId: SEED_IDS.properties.palomaA,
        personId: SEED_IDS.people.liamUnclaimed,
        clientIp: '198.51.100.20',
      })
    ).rejects.toThrow(/ALREADY_ONBOARDED/);

    // Disabling FT-23 blocks Join QR
    await setPropertyFeatureToggle(
      dbAdapter,
      superCaller,
      SEED_IDS.properties.palomaA,
      'join_qr',
      false
    );
    const blocked = await listJoinableStaffWorkflow(dbAdapter, SEED_IDS.properties.palomaA);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('FEATURE_DISABLED');
  });
});
