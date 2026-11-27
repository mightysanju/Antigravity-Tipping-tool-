export type AppRole = 'super_admin' | 'property_admin' | 'dept_manager' | 'staff';

export type PropertyStatus = 'pending' | 'active' | 'restricted' | 'cancelled';
export type PaymentFeePaidBy = 'property' | 'guest' | 'staff';
export type PayoutFeePaidBy = 'property' | 'staff';

export interface AuthSessionUser {
  authUserId: string;
  email: string;
  name: string;
  role: AppRole;
  propertyId: string | null;
  departmentId: string | null;
  personId: string | null;
  status: 'active' | 'inactive';
  agreementSignedAt: string | null;
}

export function getRoleHomeRoute(role: AppRole): string {
  switch (role) {
    case 'super_admin':
      return '/super/dashboard';
    case 'property_admin':
      return '/admin/departments';
    case 'dept_manager':
      return '/admin/assignments';
    case 'staff':
      return '/staff';
  }
}

/**
 * Stripe US card gross-up so recipient receives full `amountCents`
 * when `payment_fee_paid_by === 'guest'` (2.9% + $0.30).
 */
export function computeGuestFeeCents(amountCents: number): number {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return 0;
  return Math.ceil((amountCents + 30) / (1 - 0.029)) - amountCents;
}

export function computeEffectiveTipMinCents(
  paymentFeePaidBy: PaymentFeePaidBy,
  configuredMinCents: number
): number {
  if (paymentFeePaidBy === 'guest') return Math.max(100, configuredMinCents);
  return Math.max(200, configuredMinCents);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
