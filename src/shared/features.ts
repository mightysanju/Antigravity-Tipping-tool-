export const FEATURE_KEYS = [
  'guest_notes',
  'email_receipts',
  'tip_specific_housekeeper',
  'department_pool_tips',
  'tip_specific_person_in_dept',
  'department_qr_codes',
  'personal_staff_qr_codes',
  'room_qr_codes',
  'qr_templates',
  'pdf_assignment_upload',
  'camera_photo_ocr',
  'manual_assignment',
  'api_assignment_push',
  'mid_day_reassignment',
  'department_manager_role',
  'in_app_notifications',
  'staff_wallet_and_withdrawals',
  'instant_payouts',
  'weekly_batch_payouts',
  'refunds',
  'pool_distribution',
  'guest_paid_fee_option',
  'join_qr',
  'email_invites',
  'external_api',
  'single_sign_on',
  'tips_overview_export',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface FeatureMeta {
  key: FeatureKey;
  id: `FT-${number}`;
  label: string;
  group: 'Guest' | 'QR' | 'Assignments' | 'Staff & Payouts' | 'Admin & Integrations';
}

export const FEATURE_CATALOG: readonly FeatureMeta[] = [
  { key: 'guest_notes', id: 'FT-1', label: 'Guest notes', group: 'Guest' },
  { key: 'email_receipts', id: 'FT-2', label: 'Email receipts', group: 'Guest' },
  { key: 'tip_specific_housekeeper', id: 'FT-3', label: 'Tipping a specific housekeeper', group: 'Guest' },
  { key: 'department_pool_tips', id: 'FT-4', label: 'Department pool tips', group: 'Guest' },
  { key: 'tip_specific_person_in_dept', id: 'FT-5', label: 'Tipping a specific person within a department', group: 'Guest' },
  { key: 'department_qr_codes', id: 'FT-6', label: 'Department QR codes', group: 'QR' },
  { key: 'personal_staff_qr_codes', id: 'FT-7', label: 'Personal staff QR codes', group: 'QR' },
  { key: 'room_qr_codes', id: 'FT-8', label: 'Room QR codes', group: 'QR' },
  { key: 'qr_templates', id: 'FT-9', label: 'QR templates', group: 'QR' },
  { key: 'pdf_assignment_upload', id: 'FT-10', label: 'PDF assignment upload', group: 'Assignments' },
  { key: 'camera_photo_ocr', id: 'FT-11', label: 'Camera photo with OCR', group: 'Assignments' },
  { key: 'manual_assignment', id: 'FT-12', label: 'Manual assignment', group: 'Assignments' },
  { key: 'api_assignment_push', id: 'FT-13', label: 'API assignment push', group: 'Assignments' },
  { key: 'mid_day_reassignment', id: 'FT-14', label: 'Mid-day reassignment', group: 'Assignments' },
  { key: 'department_manager_role', id: 'FT-15', label: 'Department manager role', group: 'Admin & Integrations' },
  { key: 'in_app_notifications', id: 'FT-16', label: 'In-app notifications', group: 'Staff & Payouts' },
  { key: 'staff_wallet_and_withdrawals', id: 'FT-17', label: 'Staff wallet and withdrawals', group: 'Staff & Payouts' },
  { key: 'instant_payouts', id: 'FT-18', label: 'Instant payouts', group: 'Staff & Payouts' },
  { key: 'weekly_batch_payouts', id: 'FT-19', label: 'Weekly batch payouts', group: 'Staff & Payouts' },
  { key: 'refunds', id: 'FT-20', label: 'Refunds (24h window)', group: 'Admin & Integrations' },
  { key: 'pool_distribution', id: 'FT-21', label: 'Pool distribution (split & individual)', group: 'Admin & Integrations' },
  { key: 'guest_paid_fee_option', id: 'FT-22', label: 'Guest-paid fee option', group: 'Guest' },
  { key: 'join_qr', id: 'FT-23', label: 'Join QR onboarding', group: 'Admin & Integrations' },
  { key: 'email_invites', id: 'FT-24', label: 'Email invites', group: 'Admin & Integrations' },
  { key: 'external_api', id: 'FT-25', label: 'External API', group: 'Admin & Integrations' },
  { key: 'single_sign_on', id: 'FT-26', label: 'Single sign-on (SSO)', group: 'Admin & Integrations' },
  { key: 'tips_overview_export', id: 'FT-27', label: 'Tips overview CSV/PDF export', group: 'Admin & Integrations' },
];
