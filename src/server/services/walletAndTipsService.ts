import QRCode from 'qrcode';
import type { AuthCaller, DbAdapter } from './types.ts';

export interface StaffPortalContext {
  person: {
    id: string;
    name: string;
    status: 'active' | 'inactive';
    departmentId: string | null;
    departmentName: string;
    isHousekeeping: boolean;
    walletBalanceCents: number;
    stripeConnectAccountId: string | null;
  };
  property: {
    id: string;
    name: string;
    status: string;
    payoutWeekday: number;
    minWithdrawalCents: number;
    payoutFeePaidBy: 'property' | 'guest' | 'staff';
    timezone: string;
    heroPhotoPath: string | null;
  };
  heroBackdropUrl: string | null;
  toggles: Record<string, boolean>;
  todayDate: string;
  todayRooms: string[];
  recentTips: Array<{
    id: string;
    amountCents: number;
    netCents: number;
    roomNumber: string | null;
    note: string | null;
    status: string;
    paidAt: string;
  }>;
  ledgerEntries: Array<{
    id: string;
    type: string;
    amountCents: number;
    createdAt: string;
  }>;
  notifications: Array<{
    id: string;
    type: string;
    message: string;
    tipId: string | null;
    read: boolean;
    createdAt: string;
  }>;
  unreadCount: number;
  personalQr?: {
    url: string;
    svg: string;
  } | null;
}

export async function getStaffPortalWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  appOrigin?: string
): Promise<StaffPortalContext> {
  const ctx = await db.callRpc<Omit<StaffPortalContext, 'heroBackdropUrl' | 'personalQr'>>(
    caller,
    'get_staff_portal_context',
    {},
    []
  );

  let heroBackdropUrl: string | null = null;
  if (ctx.property.heroPhotoPath && db.createSignedStorageUrl) {
    heroBackdropUrl = await db.createSignedStorageUrl(
      'property-backdrops',
      ctx.property.heroPhotoPath,
      3600
    );
  }

  let personalQr: { url: string; svg: string } | null = null;
  if (ctx.person.status === 'active' && ctx.toggles.personal_staff_qr_codes !== false) {
    const origin = (appOrigin || 'http://localhost:5173').replace(/\/$/, '');
    const url = `${origin}/tip/person/${ctx.person.id}`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    personalQr = { url, svg };
  }

  return {
    ...ctx,
    heroBackdropUrl,
    personalQr,
  };
}

export async function markStaffNotificationsReadWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  ids?: string[] | null
) {
  return db.callRpc<{ markedReadCount: number }>(
    caller,
    'mark_staff_notifications_read',
    { p_ids: ids && ids.length > 0 ? ids : null },
    [ids && ids.length > 0 ? ids : null]
  );
}

export interface AdminTipsOverview {
  propertyName: string;
  timezone: string;
  scopedDepartmentId: string | null;
  toggles: Record<string, boolean>;
  kpis: {
    totalGrossCents: number;
    totalNetCents: number;
    tipCount: number;
    averageNetCents: number;
  };
  departments: Array<{
    id: string;
    name: string;
    defaultDistribution: 'split' | 'individual';
    unallocatedPoolCents: number;
    activeStaff: Array<{ id: string; name: string }>;
  }>;
  byPerson: Array<{
    personId: string;
    personName: string;
    departmentName: string;
    tipCount: number;
    totalNetCents: number;
  }>;
  tips: Array<{
    id: string;
    amountCents: number;
    feeCents: number;
    guestFeeCents: number;
    netCents: number;
    recipientType: 'person' | 'department_pool';
    personId: string | null;
    personName: string | null;
    departmentId: string;
    departmentName: string;
    roomNumber: string | null;
    note: string | null;
    status: string;
    paidAt: string;
  }>;
  poolDistributions: Array<{
    id: string;
    departmentId: string;
    departmentName: string;
    distributionDate: string;
    method: 'split' | 'individual';
    totalCents: number;
    allocations: Array<{ personId: string; amountCents: number }>;
    createdAt: string;
  }>;
}

export async function getAdminTipsOverviewWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  input: {
    propertyId: string;
    fromDate?: string | null;
    toDate?: string | null;
    departmentId?: string | null;
    personId?: string | null;
  }
) {
  return db.callRpc<AdminTipsOverview>(
    caller,
    'get_admin_tips_overview',
    {
      p_property_id: input.propertyId,
      p_from_date: input.fromDate || null,
      p_to_date: input.toDate || null,
      p_department_id: input.departmentId || null,
      p_person_id: input.personId || null,
    },
    [
      input.propertyId,
      input.fromDate || null,
      input.toDate || null,
      input.departmentId || null,
      input.personId || null,
    ]
  );
}

export async function distributePoolWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  input: {
    propertyId: string;
    departmentId: string;
    method: 'split' | 'individual';
    allocations?: Array<{ personId: string; amountCents: number }> | null;
  }
) {
  return db.callRpc<{
    distributionId: string;
    departmentId: string;
    method: 'split' | 'individual';
    totalCents: number;
    allocations: Array<{ personId: string; amountCents: number }>;
  }>(
    caller,
    'distribute_department_pool',
    {
      p_property_id: input.propertyId,
      p_department_id: input.departmentId,
      p_method: input.method,
      p_allocations: input.allocations ?? null,
    },
    [
      input.propertyId,
      input.departmentId,
      input.method,
      input.allocations ? JSON.stringify(input.allocations) : null,
    ]
  );
}

function csvCell(val: string | number | null | undefined): string {
  const s = val == null ? '' : String(val);
  // Guard against spreadsheet formula injection (=, +, -, @)
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function escapePdfLiteral(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildPayrollPdf(overview: AdminTipsOverview): Buffer {
  const lines: Array<{ text: string; size: number; gap: number }> = [
    { text: `${overview.propertyName} - Payroll Tips Export`, size: 14, gap: 20 },
    {
      text: `Total Tips: ${overview.kpis.tipCount} | Net Total: $${(overview.kpis.totalNetCents / 100).toFixed(2)} | Avg: $${(overview.kpis.averageNetCents / 100).toFixed(2)}`,
      size: 10,
      gap: 18,
    },
    { text: '--------------------------------------------------------------------------------', size: 9, gap: 14 },
  ];

  for (const row of overview.byPerson) {
    lines.push({
      text: `${row.personName} (${row.departmentName}) - ${row.tipCount} tip(s) - Net $${(row.totalNetCents / 100).toFixed(2)}`,
      size: 10,
      gap: 14,
    });
  }

  if (overview.tips.length > 0) {
    lines.push({ text: '--------------------------------------------------------------------------------', size: 9, gap: 14 });
    lines.push({ text: 'Recent Tip Detail (Latest 25):', size: 10, gap: 15 });
    for (const tip of overview.tips.slice(0, 25)) {
      const target = tip.personName || `${tip.departmentName} Pool`;
      const room = tip.roomNumber ? `Rm ${tip.roomNumber}` : 'Direct';
      lines.push({
        text: `${tip.paidAt.slice(0, 10)} | ${target} | ${room} | Net $${(tip.netCents / 100).toFixed(2)} | ${tip.status}`,
        size: 9,
        gap: 12,
      });
    }
  }

  const streamOps: string[] = ['BT'];
  let y = 748;
  for (const row of lines) {
    if (y < 48) break;
    streamOps.push(`/F1 ${row.size} Tf`, `1 0 0 1 48 ${y} Tm`, `(${escapePdfLiteral(row.text)}) Tj`);
    y -= row.gap;
  }
  streamOps.push('ET');
  const streamContent = streamOps.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'utf8')} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  ];
  const chunks: string[] = ['%PDF-1.4\n'];
  let offset = Buffer.byteLength(chunks[0], 'utf8');
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(offset);
    chunks.push(obj);
    offset += Buffer.byteLength(obj, 'utf8');
  }
  const xref = offset;
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const off of offsets) chunks.push(`${String(off).padStart(10, '0')} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.from(chunks.join(''), 'utf8');
}

export async function exportTipsWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  input: {
    propertyId: string;
    format: 'csv' | 'pdf';
    fromDate?: string | null;
    toDate?: string | null;
    departmentId?: string | null;
    personId?: string | null;
  }
): Promise<{ contentType: string; filename: string; dataBase64: string }> {
  const overview = await getAdminTipsOverviewWorkflow(db, caller, input);
  if (overview.toggles.tips_overview_export === false) {
    throw new Error('FEATURE_DISABLED:FT-27');
  }

  if (input.format === 'pdf') {
    const pdf = buildPayrollPdf(overview);
    return {
      contentType: 'application/pdf',
      filename: 'tips-payroll-export.pdf',
      dataBase64: pdf.toString('base64'),
    };
  }

  const header = [
    'Tip ID',
    'Paid At',
    'Department',
    'Recipient Type',
    'Recipient Name',
    'Room',
    'Gross USD',
    'Fee USD',
    'Guest Fee USD',
    'Net USD',
    'Status',
    'Note',
  ].join(',');
  const rows = overview.tips.map((t) =>
    [
      csvCell(t.id),
      csvCell(t.paidAt),
      csvCell(t.departmentName),
      csvCell(t.recipientType),
      csvCell(t.personName || `${t.departmentName} Pool`),
      csvCell(t.roomNumber || ''),
      csvCell((t.amountCents / 100).toFixed(2)),
      csvCell((t.feeCents / 100).toFixed(2)),
      csvCell((t.guestFeeCents / 100).toFixed(2)),
      csvCell((t.netCents / 100).toFixed(2)),
      csvCell(t.status),
      csvCell(t.note || ''),
    ].join(',')
  );
  const csv = [header, ...rows].join('\n');
  return {
    contentType: 'text/csv;charset=utf-8',
    filename: 'tips-payroll-export.csv',
    dataBase64: Buffer.from(csv, 'utf8').toString('base64'),
  };
}
