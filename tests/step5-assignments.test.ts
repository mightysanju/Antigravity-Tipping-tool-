import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createSeededTestDb, SEED_IDS } from './helpers/pgliteDb';
import { PgliteDbAdapter, type AuthCaller } from '../src/server/services/types';
import { setPropertyFeatureToggle } from '../src/server/services/superAdminService';
import { createOcrAdapter } from '../src/server/adapters/ocrAdapter';
import { loadServerConfig } from '../src/server/config';
import {
  getAssignmentContext,
  parseAssignmentSheetWorkflow,
  saveAssignmentsWorkflow,
} from '../src/server/services/assignmentService';
import { extractPdfTextLines } from '../src/server/pdf/pdfText';
import { matchAssignmentSheet } from '../src/shared/assignmentMatcher';

// ---- helpers ----
function buildPdf(rows: Array<{ y: number; cells: Array<{ x: number; text: string }> }>): Buffer {
  const ops: string[] = ['BT', '/F1 11 Tf'];
  for (const row of rows) {
    for (const cell of row.cells) {
      ops.push(`1 0 0 1 ${cell.x} ${row.y} Tm`, `(${cell.text.replace(/[()\\]/g, '')}) Tj`);
    }
  }
  ops.push('ET');
  return assemblePdf(ops.join('\n'));
}
function assemblePdf(stream: string): Buffer {
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(out));
    out += o;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

describe('Step 5 sheet matching rules (section 17) - synthetic corpus', () => {
  const hks = [
    { id: 'maria-g', name: 'Maria Garcia' },
    { id: 'maria-l', name: 'Maria Lopez' },
    { id: 'elena', name: 'Elena Rostova' },
    { id: 'carlos', name: 'Carlos Vega' },
  ];
  const rooms = ['101', '102', '104', '105', '106', '412', '414', 'PH-1'];
  const byRoom = (r: ReturnType<typeof matchAssignmentSheet>) =>
    Object.fromEntries(r.proposals.map((p) => [p.roomNumber, p]));

  it('case 1: clean two-column sheet, case/whitespace-insensitive', () => {
    const r = matchAssignmentSheet({
      text: 'Room   Attendant\n101    ELENA   rostova\n102  carlos vega\nPH-1 Maria  Garcia',
      rooms,
      housekeepers: hks,
    });
    const m = byRoom(r);
    expect(m['101']).toMatchObject({ status: 'matched', personId: 'elena', method: 'full_name' });
    expect(m['102']).toMatchObject({ status: 'matched', personId: 'carlos' });
    expect(m['PH-1']).toMatchObject({ status: 'matched', personId: 'maria-g' });
  });

  it('case 2: multi-section PMS export pairs by line and by block, no fixed layout', () => {
    const r = matchAssignmentSheet({
      text: [
        'FLOOR 4 - Elena Rostova',
        '412 Check-out',
        '414 Stayover',
        '',
        'FLOOR 1',
        '101 Check-out   Carlos Vega   10:30 AM  11/26/2026',
        '102 Stayover Maria Garcia',
      ].join('\n'),
      rooms,
      housekeepers: hks,
    });
    const m = byRoom(r);
    expect(m['412']).toMatchObject({ status: 'matched', personId: 'elena', method: 'block' });
    expect(m['414']).toMatchObject({ status: 'matched', personId: 'elena', method: 'block' });
    expect(m['101']).toMatchObject({ status: 'matched', personId: 'carlos', method: 'full_name' });
    expect(m['102']).toMatchObject({ status: 'matched', personId: 'maria-g' });
    expect(r.unlistedRoomTokens).toEqual([]); // dates/times are not mistaken for rooms
  });

  it('case 3: comma-inverted names and several rooms on one line', () => {
    const r = matchAssignmentSheet({
      text: '104 - Garcia, Maria\n101, 102   Vega,  Carlos',
      rooms,
      housekeepers: hks,
    });
    const m = byRoom(r);
    expect(m['104']).toMatchObject({ status: 'matched', personId: 'maria-g' });
    expect(m['101']).toMatchObject({ status: 'matched', personId: 'carlos' });
    expect(m['102']).toMatchObject({ status: 'matched', personId: 'carlos' });
  });

  it('case 4: shared first name is flagged ambiguous, never guessed; unique first name is accepted', () => {
    const r = matchAssignmentSheet({ text: '105 Maria\n106 Elena', rooms, housekeepers: hks });
    const m = byRoom(r);
    expect(m['105'].status).toBe('ambiguous');
    expect(m['105'].personId).toBeNull();
    expect(m['105'].candidateIds.sort()).toEqual(['maria-g', 'maria-l']);
    expect(m['106']).toMatchObject({ status: 'matched', personId: 'elena', method: 'first_name' });
  });

  it('case 5: unknown names go to unmatched; unlisted rooms are reported, not assigned', () => {
    const r = matchAssignmentSheet({
      text: '106 Temp Agency\n999 Maria Garcia\n412 Elena Rostova',
      rooms,
      housekeepers: hks,
    });
    const m = byRoom(r);
    expect(m['106']).toMatchObject({ status: 'unmatched', personId: null });
    expect(m['999']).toBeUndefined();
    expect(r.unlistedRoomTokens).toEqual(['999']);
    expect(m['412'].status).toBe('matched');
  });

  it('flags a room listed for two different people as ambiguous instead of picking one', () => {
    const r = matchAssignmentSheet({ text: '101 Elena Rostova\n101 Carlos Vega', rooms, housekeepers: hks });
    const p = byRoom(r)['101'];
    expect(p.status).toBe('ambiguous');
    expect(p.candidateIds.sort()).toEqual(['carlos', 'elena']);
  });
});

describe('Step 5 assignment workflows (PDF/OCR parse, review-then-save, reassignment, gates)', () => {
  let db: PGlite;
  let adapter: PgliteDbAdapter;
  const A = SEED_IDS.properties.palomaA;
  const superCaller: AuthCaller = { uid: SEED_IDS.users.superAdmin, email: 'superadmin@frontdesktip.test' };
  const adminA: AuthCaller = { uid: SEED_IDS.users.adminA, email: 'admin.paloma@frontdesktip.test' };
  const adminB: AuthCaller = { uid: SEED_IDS.users.adminB, email: 'admin.harbor@frontdesktip.test' };
  const hkManager: AuthCaller = { uid: SEED_IDS.users.deptManagerA, email: 'manager.hk@frontdesktip.test' };
  const maria: AuthCaller = { uid: SEED_IDS.users.maria, email: 'maria.garcia@frontdesktip.test' };
  const mockOcr = createOcrAdapter(loadServerConfig({}));
  let today = '';
  let tomorrow = '';

  const toggle = (key: string, enabled: boolean) =>
    setPropertyFeatureToggle(adapter, superCaller, A, key as never, enabled);
  const countAssignments = async () =>
    Number(((await db.query<{ n: string }>('SELECT COUNT(*)::TEXT AS n FROM public.assignments')).rows[0]).n);

  beforeAll(async () => {
    db = await createSeededTestDb();
    adapter = new PgliteDbAdapter(db);
    for (const key of [
      'pdf_assignment_upload',
      'camera_photo_ocr',
      'manual_assignment',
      'mid_day_reassignment',
      'department_manager_role',
    ]) {
      await toggle(key, true);
    }
    const ctx = await getAssignmentContext(adapter, adminA, A, '2000-01-01');
    today = ctx.today;
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    tomorrow = d.toISOString().slice(0, 10);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('extracts rows from a real PDF (cells on one row stay on one line) and proposes without saving', async () => {
    const pdf = buildPdf([
      { y: 740, cells: [{ x: 54, text: 'Room' }, { x: 300, text: 'Attendant' }] },
      { y: 724, cells: [{ x: 54, text: '101' }, { x: 300, text: 'Maria Garcia' }] },
      { y: 708, cells: [{ x: 54, text: '102' }, { x: 300, text: 'Elena Rostova' }] },
      { y: 692, cells: [{ x: 54, text: '103' }, { x: 300, text: 'Temp Agency' }] },
    ]);
    const text = await extractPdfTextLines(new Uint8Array(pdf));
    expect(text).toContain('101 Maria Garcia');

    const before = await countAssignments();
    const res = await parseAssignmentSheetWorkflow({
      db: adapter,
      ocr: mockOcr,
      caller: adminA,
      propertyId: A,
      date: today,
      source: 'pdf',
      dataBase64: pdf.toString('base64'),
    });
    const m = Object.fromEntries(res.proposals.map((p) => [p.roomNumber, p]));
    expect(m['101']).toMatchObject({ status: 'matched', personName: 'Maria Garcia' });
    expect(m['102']).toMatchObject({ status: 'matched', personName: 'Elena Rostova' });
    expect(m['103'].status).toBe('unmatched');
    expect(res.summary).toEqual({ matched: 2, ambiguous: 0, unmatched: 1 });
    expect(await countAssignments()).toBe(before); // nothing saved before confirmation
    // Carlos is inactive and must not be offered as a housekeeper
    expect(res.housekeepers.map((h) => h.name)).toEqual(['Elena Rostova', 'Maria Garcia']);
  });

  it('routes an image-only (no text) PDF to photo OCR and rejects non-PDF uploads', async () => {
    const imageOnly = assemblePdf('q 100 0 0 100 0 0 cm Q');
    await expect(
      parseAssignmentSheetWorkflow({
        db: adapter, ocr: mockOcr, caller: adminA, propertyId: A, date: today, source: 'pdf',
        dataBase64: imageOnly.toString('base64'),
      })
    ).rejects.toThrow(/PDF_NO_TEXT_USE_PHOTO_OCR/);
    await expect(
      parseAssignmentSheetWorkflow({
        db: adapter, ocr: mockOcr, caller: adminA, propertyId: A, date: today, source: 'pdf',
        dataBase64: Buffer.from('not a pdf').toString('base64'),
      })
    ).rejects.toThrow(/NOT_A_PDF/);
  });

  it('parses photo OCR output through the same matcher (mock OCR adapter)', async () => {
    const res = await parseAssignmentSheetWorkflow({
      db: adapter,
      ocr: mockOcr,
      caller: adminA,
      propertyId: A,
      date: today,
      source: 'photo',
      dataBase64: Buffer.from('lO1 maria garcia\n102  Elena Rostova\n412 Maria Garcia').toString('base64'),
    });
    const m = Object.fromEntries(res.proposals.map((p) => [p.roomNumber, p]));
    expect(m['lO1']).toBeUndefined(); // OCR garbage is not a room: nothing guessed
    expect(m['102'].status).toBe('matched');
    expect(m['412']).toMatchObject({ status: 'matched', currentPersonId: SEED_IDS.people.maria });
  });

  it('saves reviewed assignments, then reassigns mid-day keeping history (FT-14)', async () => {
    const saved = await saveAssignmentsWorkflow(adapter, adminA, {
      propertyId: A,
      date: today,
      source: 'pdf',
      items: [
        { roomNumber: '101', personId: SEED_IDS.people.maria },
        { roomNumber: '102', personId: SEED_IDS.people.elena },
        { roomNumber: '412', personId: SEED_IDS.people.maria }, // already Maria (seed) -> unchanged
      ],
    });
    expect(saved).toEqual({ savedCount: 2, reassignedCount: 0, unchangedCount: 1 });

    const re = await saveAssignmentsWorkflow(adapter, adminA, {
      propertyId: A,
      date: today,
      source: 'manual',
      items: [{ roomNumber: '101', personId: SEED_IDS.people.elena }],
    });
    expect(re).toEqual({ savedCount: 1, reassignedCount: 1, unchangedCount: 0 });
    const row = (
      await db.query<{ person_id: string; reassigned_from_person_id: string }>(
        `SELECT person_id, reassigned_from_person_id FROM public.assignments WHERE room_number = '101' AND assignment_date = $1::date`,
        [today]
      )
    ).rows[0];
    expect(row.person_id).toBe(SEED_IDS.people.elena);
    expect(row.reassigned_from_person_id).toBe(SEED_IDS.people.maria);

    const ctx = await getAssignmentContext(adapter, adminA, A, today);
    const counts = Object.fromEntries(ctx.counts.map((c) => [c.name, c.roomCount]));
    expect(counts).toEqual({ 'Elena Rostova': 2, 'Maria Garcia': 1 });

    await toggle('mid_day_reassignment', false);
    await expect(
      saveAssignmentsWorkflow(adapter, adminA, {
        propertyId: A, date: today, source: 'manual',
        items: [{ roomNumber: '101', personId: SEED_IDS.people.maria }],
      })
    ).rejects.toThrow(/FEATURE_DISABLED:FT-14/);
    // New (non-reassigning) saves still work with FT-14 off
    expect(
      (
        await saveAssignmentsWorkflow(adapter, adminA, {
          propertyId: A, date: tomorrow, source: 'manual',
          items: [{ roomNumber: '101', personId: SEED_IDS.people.maria }],
        })
      ).savedCount
    ).toBe(1);
    await toggle('mid_day_reassignment', true);
  });

  it('validates housekeepers, rooms, dates and duplicates; enforces input-method toggles', async () => {
    const base = { propertyId: A, date: today, source: 'manual' as const };
    await expect(
      saveAssignmentsWorkflow(adapter, adminA, { ...base, items: [{ roomNumber: '103', personId: SEED_IDS.people.carlos }] })
    ).rejects.toThrow(/INVALID_HOUSEKEEPER/); // inactive
    await expect(
      saveAssignmentsWorkflow(adapter, adminA, { ...base, items: [{ roomNumber: '103', personId: SEED_IDS.people.adminA }] })
    ).rejects.toThrow(/INVALID_HOUSEKEEPER/); // not frontline staff
    await expect(
      saveAssignmentsWorkflow(adapter, adminA, { ...base, items: [{ roomNumber: '201', personId: SEED_IDS.people.maria }] })
    ).rejects.toThrow(/ROOM_NOT_FOUND/); // other property's room
    await expect(
      saveAssignmentsWorkflow(adapter, adminA, {
        ...base,
        items: [
          { roomNumber: '103', personId: SEED_IDS.people.maria },
          { roomNumber: '103', personId: SEED_IDS.people.elena },
        ],
      })
    ).rejects.toThrow(/DUPLICATE_ROOM_IN_REQUEST/);
    await expect(
      saveAssignmentsWorkflow(adapter, adminA, {
        ...base, date: '2020-01-01', items: [{ roomNumber: '103', personId: SEED_IDS.people.maria }],
      })
    ).rejects.toThrow(/ASSIGNMENT_DATE_IN_PAST/);

    await toggle('manual_assignment', false);
    await expect(
      saveAssignmentsWorkflow(adapter, adminA, { ...base, items: [{ roomNumber: '103', personId: SEED_IDS.people.maria }] })
    ).rejects.toThrow(/FEATURE_DISABLED:FT-12/);
    await toggle('manual_assignment', true);

    await toggle('pdf_assignment_upload', false);
    await expect(
      parseAssignmentSheetWorkflow({
        db: adapter, ocr: mockOcr, caller: adminA, propertyId: A, date: today, source: 'pdf',
        dataBase64: buildPdf([{ y: 700, cells: [{ x: 54, text: '101 Maria Garcia' }] }]).toString('base64'),
      })
    ).rejects.toThrow(/FEATURE_DISABLED:FT-10/);
    await toggle('pdf_assignment_upload', true);

    await toggle('camera_photo_ocr', false);
    await expect(
      parseAssignmentSheetWorkflow({
        db: adapter, ocr: mockOcr, caller: adminA, propertyId: A, date: today, source: 'photo',
        dataBase64: Buffer.from('101 Maria Garcia').toString('base64'),
      })
    ).rejects.toThrow(/FEATURE_DISABLED:FT-11/);
    await toggle('camera_photo_ocr', true);
  });

  it('limits access: other property admin and staff are denied; housekeeping manager needs FT-15', async () => {
    await expect(getAssignmentContext(adapter, adminB, A, today)).rejects.toThrow(/FORBIDDEN/);
    await expect(getAssignmentContext(adapter, maria, A, today)).rejects.toThrow(/FORBIDDEN/);
    await expect(
      saveAssignmentsWorkflow(adapter, adminB, {
        propertyId: A, date: today, source: 'manual',
        items: [{ roomNumber: '103', personId: SEED_IDS.people.maria }],
      })
    ).rejects.toThrow(/FORBIDDEN/);

    expect((await getAssignmentContext(adapter, hkManager, A, today)).propertyName).toMatch(/Casa Paloma/);
    await toggle('department_manager_role', false);
    await expect(getAssignmentContext(adapter, hkManager, A, today)).rejects.toThrow(/FORBIDDEN/);
    await toggle('department_manager_role', true);
    expect((await getAssignmentContext(adapter, superCaller, A, today)).rooms.length).toBeGreaterThan(0);
  });
});
