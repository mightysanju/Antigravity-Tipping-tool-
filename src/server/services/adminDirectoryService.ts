import type { EmailAdapter } from '../adapters/emailAdapter.ts';
import type { AuthCaller, DbAdapter } from './types.ts';

export async function listDepartmentsAdmin(
  db: DbAdapter,
  caller: AuthCaller,
  propertyId: string
) {
  return db.callRpc<Array<Record<string, unknown>>>(
    caller,
    'list_admin_departments',
    { p_property_id: propertyId },
    [propertyId]
  );
}

export async function upsertDepartmentAdmin(
  db: DbAdapter,
  caller: AuthCaller,
  input: {
    propertyId: string;
    departmentId?: string | null;
    name: string;
    isHousekeeping: boolean;
    defaultDistribution: 'split' | 'individual';
  }
) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'upsert_admin_department',
    {
      p_property_id: input.propertyId,
      p_department_id: input.departmentId ?? null,
      p_name: input.name,
      p_is_housekeeping: input.isHousekeeping,
      p_default_distribution: input.defaultDistribution,
    },
    [
      input.propertyId,
      input.departmentId ?? null,
      input.name,
      input.isHousekeeping,
      input.defaultDistribution,
    ]
  );
}

export async function deleteDepartmentWithReassign(
  db: DbAdapter,
  caller: AuthCaller,
  departmentId: string,
  reassignToDepartmentId?: string | null
) {
  return db.callRpc<{ deletedDepartmentId: string; reassignedPeopleCount: number }>(
    caller,
    'delete_department_with_reassign',
    {
      p_department_id: departmentId,
      p_reassign_to_department_id: reassignToDepartmentId ?? null,
    },
    [departmentId, reassignToDepartmentId ?? null]
  );
}

export async function listPeopleAdmin(
  db: DbAdapter,
  caller: AuthCaller,
  propertyId: string
) {
  return db.callRpc<{
    people: Array<Record<string, unknown>>;
    toggles: Record<string, boolean>;
  }>(
    caller,
    'list_admin_people',
    { p_property_id: propertyId },
    [propertyId]
  );
}

export async function createPersonWorkflow(params: {
  db: DbAdapter;
  emailAdapter: EmailAdapter;
  caller: AuthCaller;
  input: {
    propertyId: string;
    name: string;
    email: string;
    role: 'staff' | 'dept_manager' | 'property_admin';
    departmentId: string | null;
    photoPath?: string | null;
  };
  appOrigin?: string;
}) {
  const { db, emailAdapter, caller, input, appOrigin } = params;
  const res = await db.callRpc<{
    person: Record<string, unknown>;
    propertyName: string;
    emailInviteEnabled: boolean;
  }>(
    caller,
    'create_admin_person',
    {
      p_property_id: input.propertyId,
      p_name: input.name,
      p_email: input.email,
      p_role: input.role,
      p_department_id: input.departmentId,
      p_photo_path: input.photoPath ?? null,
    },
    [
      input.propertyId,
      input.name,
      input.email,
      input.role,
      input.departmentId,
      input.photoPath ?? null,
    ]
  );

  let emailSent = false;
  if (res.emailInviteEnabled) {
    const joinUrl = `${appOrigin || 'http://localhost:5173'}/join/${input.propertyId}`;
    await emailAdapter.sendEmail({
      to: input.email.trim().toLowerCase(),
      subject: `Welcome to ${res.propertyName} on FrontDesk Tip`,
      text: `Hello ${input.name}, your account for ${res.propertyName} is ready. Scan your property Join QR or visit ${joinUrl} to verify your email and set your password.`,
      html: `<p>Hello ${input.name},</p><p>Your account for <strong>${res.propertyName}</strong> is ready. Visit <a href="${joinUrl}">${joinUrl}</a> to verify your email and set your password.</p>`,
      template: 'invite',
      metadata: { propertyId: input.propertyId, role: input.role },
    });
    emailSent = true;
  }

  return { ...res, emailSent };
}

export async function updatePersonWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  input: {
    personId: string;
    name?: string | null;
    email?: string | null;
    role?: 'staff' | 'dept_manager' | null;
    departmentId?: string | null;
    status?: 'active' | 'inactive' | null;
    photoPath?: string | null;
  }
) {
  return db.callRpc<Record<string, unknown>>(
    caller,
    'update_admin_person',
    {
      p_person_id: input.personId,
      p_name: input.name ?? null,
      p_email: input.email ?? null,
      p_role: input.role ?? null,
      p_department_id: input.departmentId ?? null,
      p_status: input.status ?? null,
      p_photo_path: input.photoPath ?? null,
    },
    [
      input.personId,
      input.name ?? null,
      input.email ?? null,
      input.role ?? null,
      input.departmentId ?? null,
      input.status ?? null,
      input.photoPath ?? null,
    ]
  );
}
