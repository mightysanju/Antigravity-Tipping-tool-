import { supabase } from './supabaseClient';
import type { FeatureKey } from '../shared/features';

interface DevCaller {
  authUserId: string;
  email: string;
}

let activeDevCaller: DevCaller | null = null;

export function setApiDevCaller(caller: DevCaller | null) {
  activeDevCaller = caller;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (jwt) {
    headers.Authorization = `Bearer ${jwt}`;
  } else if (import.meta.env.DEV && activeDevCaller) {
    headers['x-dev-user-id'] = activeDevCaller.authUserId;
    headers['x-dev-user-email'] = activeDevCaller.email;
  }
  return headers;
}

async function postJson<T>(devPath: string, prodPath: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const useDevApi = import.meta.env.DEV && !data.session?.access_token;
  const endpoint = useDevApi ? devPath : prodPath;
  const headers = await getAuthHeaders();

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const parsed = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  } & T;

  if (!res.ok) {
    throw new Error(parsed.error?.message || `Request failed (${res.status})`);
  }
  return parsed;
}

export type SuperAdminAction =
  | { action: 'dashboard' }
  | { action: 'property_detail'; propertyId: string }
  | { action: 'onboard_property'; payload: Record<string, unknown> }
  | { action: 'update_property'; propertyId: string; patch: Record<string, unknown> }
  | { action: 'set_feature_toggle'; propertyId: string; featureKey: FeatureKey; enabled: boolean }
  | { action: 'payments_overview' }
  | {
      action: 'update_payment_defaults';
      payoutWeekday: number;
      minWithdrawalCents: number;
      applyToAll: boolean;
    }
  | { action: 'list_admins' }
  | { action: 'invite_admin'; propertyId: string; name: string; email: string }
  | { action: 'remove_admin'; personId: string };

export function callSuperAdmin<T = Record<string, unknown>>(payload: SuperAdminAction): Promise<T> {
  return postJson<T>('/api/dev/super-admin', '/.netlify/functions/super-admin', payload);
}

export function callSignAgreement<
  T = { agreement: Record<string, unknown>; pdfStoragePath: string; pdfBase64: string },
>(payload: {
  signerType: 'property' | 'staff';
  signerId: string;
  propertyId: string;
  propertyName: string;
  typedName: string;
  checkboxConfirmed: boolean;
  version?: string;
}): Promise<T> {
  return postJson<T>('/api/dev/sign-agreement', '/.netlify/functions/sign-agreement', payload);
}

export function callAdminDirectory<T = Record<string, unknown>>(payload: {
  action: 'list_departments' | 'upsert_department' | 'list_people' | 'create_person' | 'update_person';
  propertyId?: string;
  departmentId?: string | null;
  name?: string | null;
  email?: string | null;
  role?: 'staff' | 'dept_manager' | 'property_admin' | null;
  status?: 'active' | 'inactive' | null;
  personId?: string;
  isHousekeeping?: boolean;
  defaultDistribution?: 'split' | 'individual';
  photoPath?: string | null;
}): Promise<T> {
  return postJson<T>('/api/dev/admin-directory', '/.netlify/functions/admin-directory', payload);
}

export function callDeleteDepartment(payload: {
  departmentId: string;
  reassignToDepartmentId?: string | null;
}) {
  return postJson<{ deletedDepartmentId: string; reassignedPeopleCount: number }>(
    '/api/dev/delete-department',
    '/.netlify/functions/delete-department',
    payload
  );
}

export function callSendOtp(payload: {
  email: string;
  purpose: 'login' | 'new_device' | 'withdrawal' | 'join_qr';
}) {
  return postJson<{ otpId: string; expiresAt: string }>(
    '/api/dev/send-otp',
    '/.netlify/functions/send-otp',
    payload
  );
}

export function callVerifyOtp(payload: {
  email: string;
  purpose: 'login' | 'new_device' | 'withdrawal' | 'join_qr';
  code: string;
  trustDevice?: boolean;
  authUserId?: string;
}) {
  return postJson<{ verified: boolean; reason?: string }>(
    '/api/dev/verify-otp',
    '/.netlify/functions/verify-otp',
    payload
  );
}

export function callLoginContext() {
  return postJson<{
    authenticated: boolean;
    role?: string;
    personId?: string;
    personName?: string;
    propertyId?: string;
    propertyName?: string;
    propertyStatus?: string;
    contractTermMonths?: number;
    noticeDays?: number;
    needsPropertyAgreement?: boolean;
    needsStaffAgreement?: boolean;
    trustedDevice?: boolean;
  }>('/api/dev/login-context', '/.netlify/functions/login-context', {});
}

export async function callJoinByQrGet(propertyId: string) {
  const { data } = await supabase.auth.getSession();
  const useDevApi = import.meta.env.DEV && !data.session?.access_token;
  const base = useDevApi ? '/api/dev/join-by-qr' : '/.netlify/functions/join-by-qr';
  const res = await fetch(`${base}?propertyId=${encodeURIComponent(propertyId)}`);
  return (await res.json()) as {
    ok: boolean;
    code?: string;
    propertyId?: string;
    propertyName?: string;
    staff?: Array<{ personId: string; displayName: string; departmentName: string | null }>;
  };
}

export function callJoinByQrPost<T = Record<string, unknown>>(payload: Record<string, unknown>) {
  return postJson<T>('/api/dev/join-by-qr', '/.netlify/functions/join-by-qr', payload);
}

export interface RoomsAdminView {
  propertyName: string;
  rooms: Array<{ id: string; roomNumber: string; createdAt: string }>;
  toggles: Record<string, boolean>;
  templatePath: string | null;
  heroPhotoPath: string | null;
  qrPosition: { x: number; y: number; size: number } | null;
}

export function callAdminRooms<T = Record<string, unknown>>(payload: {
  action: 'list_rooms' | 'add_rooms' | 'delete_room' | 'upload_backdrop';
  propertyId: string;
  roomNumber?: string | null;
  rangeFrom?: number | null;
  rangeTo?: number | null;
  prefix?: string | null;
  roomId?: string;
  dataBase64?: string;
}): Promise<T> {
  return postJson<T>('/api/dev/admin-rooms', '/.netlify/functions/admin-rooms', payload);
}

export function callGenerateQrCards(payload: {
  propertyId: string;
  kind: 'room' | 'department' | 'person';
  ids?: string[] | null;
}) {
  return postJson<import('../server/services/roomsAndQrService').GenerateQrCardsResult>(
    '/api/dev/generate-qr-cards',
    '/.netlify/functions/generate-qr-cards',
    payload
  );
}

export type AssignmentContextView = import('../server/services/assignmentService').AssignmentContext;
export type ParseSheetView = import('../server/services/assignmentService').ParseSheetResult;

export function callAdminAssignmentsContext(propertyId: string, date: string) {
  return postJson<AssignmentContextView>('/api/dev/admin-assignments', '/.netlify/functions/admin-assignments', {
    action: 'context',
    propertyId,
    date,
  });
}

export function callAdminAssignmentsSave(payload: {
  propertyId: string;
  date: string;
  source: 'pdf' | 'photo' | 'manual';
  items: Array<{ roomNumber: string; personId: string }>;
}) {
  return postJson<{ savedCount: number; reassignedCount: number; unchangedCount: number }>(
    '/api/dev/admin-assignments',
    '/.netlify/functions/admin-assignments',
    { action: 'save', ...payload }
  );
}

export function callParseAssignmentSheet(payload: {
  propertyId: string;
  date: string;
  source: 'pdf' | 'photo';
  dataBase64: string;
}) {
  return postJson<ParseSheetView>(
    '/api/dev/parse-assignment-sheet',
    '/.netlify/functions/parse-assignment-sheet',
    payload
  );
}

export type ResolvedTipTargetView = import('../server/services/guestTippingService').ResolvedTipTarget;
export type PublicDepartmentSummary = import('../server/services/guestTippingService').PublicDepartmentSummary;
export type PublicStaffSummary = import('../server/services/guestTippingService').PublicStaffSummary;
export type TipTargetType = import('../server/services/guestTippingService').TipTargetType;

export async function callResolveRoomView(type: TipTargetType, id: string): Promise<ResolvedTipTargetView> {
  const base = import.meta.env.DEV ? '/api/dev/resolve-room-view' : '/.netlify/functions/resolve-room-view';
  const res = await fetch(`${base}?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
  const parsed = (await res.json().catch(() => ({}))) as ResolvedTipTargetView;
  return parsed;
}

export async function callCreateTipCheckout(payload: {
  sourceType: TipTargetType;
  sourceId: string;
  recipientType: 'person' | 'department_pool';
  personId?: string | null;
  departmentId: string;
  amountCents: number;
  note?: string | null;
  guestEmail?: string | null;
  expectedPersonId?: string | null;
}) {
  const endpoint = import.meta.env.DEV
    ? '/api/dev/create-tip-checkout'
    : '/.netlify/functions/create-tip-checkout';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const parsed = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
    checkoutIntentId?: string;
    paymentIntentId?: string;
    clientSecret?: string;
    paymentMode?: 'mock' | 'stripe_test' | 'stripe_live';
    propertyName?: string;
    recipientName?: string;
    amountCents?: number;
    guestFeeCents?: number;
    chargeCents?: number;
    netCents?: number;
  };
  if (!res.ok) {
    const err = new Error(parsed.error?.message || `Checkout failed (${res.status})`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = parsed.error?.code;
    err.status = res.status;
    throw err;
  }
  return parsed as {
    checkoutIntentId: string;
    paymentIntentId: string;
    clientSecret: string;
    paymentMode: 'mock' | 'stripe_test' | 'stripe_live';
    propertyName: string;
    recipientName: string;
    amountCents: number;
    guestFeeCents: number;
    chargeCents: number;
    netCents: number;
  };
}

export function callMockCompleteTip(paymentIntentId: string) {
  return postJson<{ ok: boolean; tipId?: string; deduplicated?: boolean }>(
    '/api/dev/mock-complete-tip',
    '/api/dev/mock-complete-tip',
    { paymentIntentId }
  );
}

export type StaffPortalView = import('../server/services/walletAndTipsService').StaffPortalContext;
export type AdminTipsOverviewView = import('../server/services/walletAndTipsService').AdminTipsOverview;

export function callStaffPortal(payload: { action?: 'context' | 'mark_read'; ids?: string[] } = {}) {
  return postJson<StaffPortalView & { markedReadCount?: number }>(
    '/api/dev/staff-portal',
    '/.netlify/functions/staff-portal',
    payload
  );
}

export function callAdminTipsOverview(payload: {
  propertyId: string;
  fromDate?: string | null;
  toDate?: string | null;
  departmentId?: string | null;
  personId?: string | null;
}) {
  return postJson<AdminTipsOverviewView>(
    '/api/dev/admin-tips',
    '/.netlify/functions/admin-tips',
    payload
  );
}

export function callDistributePool(payload: {
  propertyId: string;
  departmentId: string;
  method: 'split' | 'individual';
  allocations?: Array<{ personId: string; amountCents: number }> | null;
}) {
  return postJson<{
    distributionId: string;
    departmentId: string;
    method: 'split' | 'individual';
    totalCents: number;
    allocations: Array<{ personId: string; amountCents: number }>;
  }>('/api/dev/distribute-pool', '/.netlify/functions/distribute-pool', payload);
}

export function callExportTips(payload: {
  propertyId: string;
  format: 'csv' | 'pdf';
  fromDate?: string | null;
  toDate?: string | null;
  departmentId?: string | null;
  personId?: string | null;
}) {
  return postJson<{ contentType: string; filename: string; dataBase64: string }>(
    '/api/dev/export-tips',
    '/.netlify/functions/export-tips',
    payload
  );
}

export function callCreateConnectOnboardingLink() {
  return postJson<{ stripeConnectAccountId: string; onboardingUrl: string }>(
    '/api/dev/create-connect-onboarding-link',
    '/.netlify/functions/create-connect-onboarding-link',
    {}
  );
}

export function callRequestWithdrawal(payload: {
  amountCents: number;
  method: 'standard' | 'instant';
  otpCode: string;
}) {
  return postJson<{
    withdrawalId: string;
    amountCents: number;
    feeCents: number;
    netPayoutCents: number;
    method: 'standard' | 'instant';
    status: string;
  }>('/api/dev/request-withdrawal', '/.netlify/functions/request-withdrawal', payload);
}

export function callRefundTip(tipId: string) {
  return postJson<{ tipId: string; status: string; stripeRefundId: string }>(
    '/api/dev/refund-tip',
    '/.netlify/functions/refund-tip',
    { tipId }
  );
}

export type ApiKeyScope = import('../server/services/billingApiAndSsoService').ApiKeyScope;

export function callSuperIntegrations<T = Record<string, unknown>>(payload: {
  action: 'get' | 'create_key' | 'revoke_key' | 'upsert_sso';
  propertyId?: string;
  label?: string;
  scopes?: ApiKeyScope[];
  keyId?: string;
  clientId?: string;
  authMode?: 'server_minted' | 'partner_asymmetric';
  clientSecret?: string | null;
  publicKeyPem?: string | null;
  jwksUrl?: string | null;
  allowedOrigins?: string[];
  enabled?: boolean;
}): Promise<T> {
  return postJson<T>('/api/dev/super-integrations', '/.netlify/functions/super-integrations', payload);
}

export function callSsoExchange(token: string) {
  return postJson<{
    ok: boolean;
    personId: string;
    authUserId: string | null;
    name: string;
    email: string;
    role: 'property_admin' | 'dept_manager' | 'staff';
    propertyId: string;
  }>('/api/dev/sso-token', '/.netlify/functions/sso-token', { action: 'exchange', token });
}
