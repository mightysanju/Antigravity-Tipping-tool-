import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createSeededTestDb, SEED_IDS } from './helpers/pgliteDb';
import { PgliteDbAdapter, type AuthCaller } from '../src/server/services/types';
import { setPropertyFeatureToggle } from '../src/server/services/superAdminService';
import {
  addRoomsAdmin,
  deleteRoomAdmin,
  expandRoomInput,
  generateQrCardsWorkflow,
  listRoomsAdmin,
  uploadPropertyBackdropWorkflow,
} from '../src/server/services/roomsAndQrService';
import {
  buildCardZip,
  buildPrintSheetHtml,
  composeCardSvg,
  crc32,
} from '../src/shared/qrCards';

// 1x1 transparent PNG
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('Step 4 Rooms, backdrop & QR card generation', () => {
  let db: PGlite;
  let adapter: PgliteDbAdapter;
  const A = SEED_IDS.properties.palomaA;
  const superCaller: AuthCaller = { uid: SEED_IDS.users.superAdmin, email: 'superadmin@frontdesktip.test' };
  const adminA: AuthCaller = { uid: SEED_IDS.users.adminA, email: 'admin.paloma@frontdesktip.test' };
  const adminB: AuthCaller = { uid: SEED_IDS.users.adminB, email: 'admin.harbor@frontdesktip.test' };
  const maria: AuthCaller = { uid: SEED_IDS.users.maria, email: 'maria.garcia@frontdesktip.test' };

  const toggle = (key: string, enabled: boolean) =>
    setPropertyFeatureToggle(adapter, superCaller, A, key as never, enabled);

  beforeAll(async () => {
    db = await createSeededTestDb();
    adapter = new PgliteDbAdapter(db);
    for (const key of ['room_qr_codes', 'department_qr_codes', 'personal_staff_qr_codes', 'qr_templates']) {
      await toggle(key, true);
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  it('adds single rooms and the 101-140 range idempotently with validation', async () => {
    expect(expandRoomInput({ rangeFrom: 101, rangeTo: 103 })).toEqual(['101', '102', '103']);
    expect(() => expandRoomInput({ rangeFrom: 1, rangeTo: 600 })).toThrow(/TOO_MANY_ROOMS/);
    expect(() => expandRoomInput({ rangeFrom: 5, rangeTo: 3 })).toThrow(/INVALID_ROOM_RANGE/);

    const range = await addRoomsAdmin(adapter, adminA, A, { rangeFrom: 101, rangeTo: 140 });
    // Seed already contains 101, 102, 103 for this property.
    expect(range.addedCount).toBe(37);
    expect(range.skippedExisting.sort()).toEqual(['101', '102', '103']);

    const single = await addRoomsAdmin(adapter, adminA, A, { roomNumber: 'PH-1' });
    expect(single.addedCount).toBe(1);
    await expect(addRoomsAdmin(adapter, adminA, A, { roomNumber: 'bad room!' })).rejects.toThrow(
      /INVALID_ROOM_NUMBER/
    );

    const view = await listRoomsAdmin(adapter, adminA, A);
    expect(view.rooms.length).toBeGreaterThanOrEqual(41);
    expect(view.rooms[0].roomNumber).toBe('101'); // numeric rooms sort numerically first
  });

  it('isolates properties and roles (AC-5 style) for rooms, backdrop and QR generation', async () => {
    await expect(listRoomsAdmin(adapter, adminB, A)).rejects.toThrow(/FORBIDDEN/);
    await expect(addRoomsAdmin(adapter, adminB, A, { roomNumber: '999' })).rejects.toThrow(/FORBIDDEN/);
    await expect(listRoomsAdmin(adapter, maria, A)).rejects.toThrow(/FORBIDDEN/);
    await expect(
      generateQrCardsWorkflow({ db: adapter, caller: adminB, propertyId: A, kind: 'room' })
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      uploadPropertyBackdropWorkflow(adapter, adminB, { propertyId: A, dataBase64: PNG_1X1.toString('base64') })
    ).rejects.toThrow(/FORBIDDEN/);
    // Super admin may act on any property.
    expect((await listRoomsAdmin(adapter, superCaller, A)).propertyName).toMatch(/Casa Paloma/);
  });

  it('blocks deleting rooms that have assignment history but deletes unused rooms', async () => {
    const view = await listRoomsAdmin(adapter, adminA, A);
    const r412 = view.rooms.find((r) => r.roomNumber === '412')!;
    await expect(deleteRoomAdmin(adapter, adminA, A, r412.id)).rejects.toThrow(/ROOM_HAS_ASSIGNMENTS/);
    const ph = view.rooms.find((r) => r.roomNumber === 'PH-1')!;
    await deleteRoomAdmin(adapter, adminA, A, ph.id);
    const after = await listRoomsAdmin(adapter, adminA, A);
    expect(after.rooms.find((r) => r.roomNumber === 'PH-1')).toBeUndefined();
  });

  it('generates room QR cards pointing at /tip/room/:id and packs a valid ZIP', async () => {
    const result = await generateQrCardsWorkflow({
      db: adapter,
      caller: adminA,
      propertyId: A,
      kind: 'room',
      appOrigin: 'https://tips.example.com/some/path',
    });
    expect(result.count).toBeGreaterThanOrEqual(40);
    expect(result.templateApplied).toBe(false);
    const card = result.cards.find((c) => c.label === 'Room 412')!;
    expect(card.url).toBe(`https://tips.example.com/tip/room/${SEED_IDS.rooms.r412}`);
    expect(card.qrSvg.startsWith('<svg')).toBe(true);

    const svg = composeCardSvg({ card, propertyName: 'Casa <Paloma> & Co', template: null, position: null });
    expect(svg).toContain('Room 412');
    expect(svg).toContain('Casa &lt;Paloma&gt; &amp; Co'); // XML-escaped
    expect(svg).not.toContain('<Paloma>');

    // Subset selection by ids
    const subset = await generateQrCardsWorkflow({
      db: adapter,
      caller: adminA,
      propertyId: A,
      kind: 'room',
      ids: [SEED_IDS.rooms.r101, SEED_IDS.rooms.r102],
    });
    expect(subset.cards.map((c) => c.label)).toEqual(['Room 101', 'Room 102']);

    // Real ZIP verification with the system unzip tool
    const zip = buildCardZip({ propertyName: 'Casa Paloma', cards: result.cards, template: null, position: null });
    const dir = mkdtempSync(path.join(tmpdir(), 'qrzip-'));
    try {
      const file = path.join(dir, 'cards.zip');
      writeFileSync(file, zip);
      const out = execFileSync('unzip', ['-t', file]).toString();
      expect(out).toContain('No errors detected');
      expect(out).toContain('room-room-412.svg');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);

    const sheet = buildPrintSheetHtml({
      propertyName: 'Casa Paloma',
      cards: subset.cards,
      templateDataUri: null,
      position: null,
    });
    expect(sheet.match(/class="card"/g)?.length).toBe(2);
  });

  it('enforces FT-6/7/8 toggles and limits personal QR to active frontline staff', async () => {
    await toggle('room_qr_codes', false);
    await expect(
      generateQrCardsWorkflow({ db: adapter, caller: adminA, propertyId: A, kind: 'room' })
    ).rejects.toThrow(/FEATURE_DISABLED:FT-8/);
    await toggle('room_qr_codes', true);

    await toggle('department_qr_codes', false);
    await expect(
      generateQrCardsWorkflow({ db: adapter, caller: adminA, propertyId: A, kind: 'department' })
    ).rejects.toThrow(/FEATURE_DISABLED:FT-6/);
    await toggle('department_qr_codes', true);
    const depts = await generateQrCardsWorkflow({ db: adapter, caller: adminA, propertyId: A, kind: 'department' });
    expect(depts.cards.map((c) => c.label)).toEqual(expect.arrayContaining(['Housekeeping', 'Front Desk', 'Valet']));
    expect(depts.cards[0].url).toMatch(/\/tip\/dept\//);

    await toggle('personal_staff_qr_codes', false);
    await expect(
      generateQrCardsWorkflow({ db: adapter, caller: adminA, propertyId: A, kind: 'person' })
    ).rejects.toThrow(/FEATURE_DISABLED:FT-7/);
    await toggle('personal_staff_qr_codes', true);

    const people = await generateQrCardsWorkflow({ db: adapter, caller: adminA, propertyId: A, kind: 'person' });
    const ids = people.cards.map((c) => c.id);
    expect(ids).toContain(SEED_IDS.people.maria);
    expect(ids).not.toContain(SEED_IDS.people.adminA); // property_admin excluded
    expect(ids).not.toContain(SEED_IDS.people.deptManagerA); // dept_manager excluded
    expect(ids).not.toContain(SEED_IDS.people.hannahB); // other property
    expect(people.cards[0].url).toMatch(/\/tip\/person\//);
  });

  it('stamps the property template only when FT-9 is on, and stores validated backdrops', async () => {
    const tplPath = `${A}/template.png`;
    await adapter.uploadPrivateObject('qr-templates', tplPath, PNG_1X1);
    await db.query(`UPDATE public.properties SET template_path = $1, qr_position = $2::jsonb WHERE id = $3`, [
      tplPath,
      JSON.stringify({ x: 0.2, y: 0.3, size: 0.5 }),
      A,
    ]);

    const on = await generateQrCardsWorkflow({
      db: adapter,
      caller: adminA,
      propertyId: A,
      kind: 'room',
      ids: [SEED_IDS.rooms.r101],
    });
    expect(on.templateApplied).toBe(true);
    expect(on.templateDataUri?.startsWith('data:image/png;base64,')).toBe(true);
    const stamped = composeCardSvg({
      card: on.cards[0],
      propertyName: 'Casa Paloma',
      template: { mode: 'embedded', dataUri: on.templateDataUri! },
      position: on.qrPosition,
    });
    expect(stamped).toContain('<image');
    expect(stamped).toContain('x="200.00" y="420.00"'); // 0.2*1000, 0.3*1400 (QR placement honoured)

    await toggle('qr_templates', false);
    const off = await generateQrCardsWorkflow({
      db: adapter,
      caller: adminA,
      propertyId: A,
      kind: 'room',
      ids: [SEED_IDS.rooms.r101],
    });
    expect(off.templateApplied).toBe(false);
    expect(off.templateDataUri).toBeNull();
    await toggle('qr_templates', true);

    // Backdrop upload: valid PNG accepted, path scoped to property; junk rejected
    const saved = await uploadPropertyBackdropWorkflow(adapter, adminA, {
      propertyId: A,
      dataBase64: PNG_1X1.toString('base64'),
    });
    expect(saved.heroPhotoPath?.startsWith(`${A}/hero-`)).toBe(true);
    expect(await adapter.getStoredObject('property-backdrops', saved.heroPhotoPath!)).not.toBeNull();
    await expect(
      uploadPropertyBackdropWorkflow(adapter, adminA, {
        propertyId: A,
        dataBase64: Buffer.from('<script>alert(1)</script>').toString('base64'),
      })
    ).rejects.toThrow(/UNSUPPORTED_IMAGE_TYPE/);
    await expect(
      uploadPropertyBackdropWorkflow(adapter, adminA, {
        propertyId: A,
        dataBase64: Buffer.concat([PNG_1X1, Buffer.alloc(4 * 1024 * 1024)]).toString('base64'),
      })
    ).rejects.toThrow(/BACKDROP_TOO_LARGE/);
  });
});
