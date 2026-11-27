import QRCode from 'qrcode';
import type { AuthCaller, DbAdapter } from './types.ts';
import type { QrCardData, QrPosition } from '../../shared/qrCards.ts';

export type QrKind = 'room' | 'department' | 'person';

const MAX_RANGE = 500;
const MAX_TEMPLATE_BYTES = 3 * 1024 * 1024;
const MAX_BACKDROP_BYTES = 4 * 1024 * 1024;

export async function listRoomsAdmin(db: DbAdapter, caller: AuthCaller, propertyId: string) {
  return db.callRpc<{
    propertyName: string;
    rooms: Array<{ id: string; roomNumber: string; createdAt: string }>;
    toggles: Record<string, boolean>;
    templatePath: string | null;
    heroPhotoPath: string | null;
    qrPosition: QrPosition | null;
  }>(caller, 'list_admin_rooms', { p_property_id: propertyId }, [propertyId]);
}

/** Expands either a single room number or a numeric range (e.g. 101–140) into room numbers. */
export function expandRoomInput(input: {
  roomNumber?: string | null;
  rangeFrom?: number | null;
  rangeTo?: number | null;
  prefix?: string | null;
}): string[] {
  if (input.rangeFrom != null || input.rangeTo != null) {
    const from = Number(input.rangeFrom);
    const to = Number(input.rangeTo);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
      throw new Error('INVALID_ROOM_RANGE');
    }
    if (to - from + 1 > MAX_RANGE) {
      throw new Error('TOO_MANY_ROOMS_MAX_500');
    }
    const prefix = (input.prefix ?? '').trim();
    const out: string[] = [];
    for (let n = from; n <= to; n++) out.push(`${prefix}${n}`);
    return out;
  }
  const single = (input.roomNumber ?? '').trim();
  if (!single) throw new Error('NO_ROOM_NUMBERS');
  return [single];
}

export async function addRoomsAdmin(
  db: DbAdapter,
  caller: AuthCaller,
  propertyId: string,
  input: Parameters<typeof expandRoomInput>[0]
) {
  const numbers = expandRoomInput(input);
  return db.callRpc<{ addedCount: number; skippedExisting: string[] }>(
    caller,
    'add_admin_rooms',
    { p_property_id: propertyId, p_numbers: numbers },
    [propertyId, numbers]
  );
}

export async function deleteRoomAdmin(
  db: DbAdapter,
  caller: AuthCaller,
  propertyId: string,
  roomId: string
) {
  return db.callRpc<{ deletedRoomId: string }>(
    caller,
    'delete_admin_room',
    { p_property_id: propertyId, p_room_id: roomId },
    [propertyId, roomId]
  );
}

function sniffImage(buf: Buffer): { mime: string; ext: 'png' | 'jpg' | 'webp' } | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    buf.length > 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Validates image magic bytes + size, stores in the private property-backdrops bucket, then records the path. */
export async function uploadPropertyBackdropWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  input: { propertyId: string; dataBase64: string }
) {
  if (!db.uploadPrivateObject) throw new Error('STORAGE_UNAVAILABLE');
  const body = Buffer.from(input.dataBase64, 'base64');
  if (body.length === 0) throw new Error('EMPTY_UPLOAD');
  if (body.length > MAX_BACKDROP_BYTES) throw new Error('BACKDROP_TOO_LARGE_MAX_4MB');
  const kind = sniffImage(body);
  if (!kind) throw new Error('UNSUPPORTED_IMAGE_TYPE');

  // Authorize BEFORE writing to storage: this RPC raises for cross-property callers.
  await db.callRpc(caller, 'list_admin_rooms', { p_property_id: input.propertyId }, [input.propertyId]);

  const objectPath = `${input.propertyId}/hero-${Date.now()}.${kind.ext}`;
  await db.uploadPrivateObject('property-backdrops', objectPath, body, kind.mime);
  return db.callRpc<{ propertyId: string; heroPhotoPath: string | null }>(
    caller,
    'set_admin_property_backdrop',
    { p_property_id: input.propertyId, p_path: objectPath },
    [input.propertyId, objectPath]
  );
}

export interface GenerateQrCardsResult {
  propertyName: string;
  kind: QrKind;
  count: number;
  templateApplied: boolean;
  /** data: URI of the template, sent once (not per card). */
  templateDataUri: string | null;
  templateExtension: 'png' | 'jpg' | 'webp' | null;
  qrPosition: QrPosition | null;
  cards: QrCardData[];
}

function pathFor(kind: QrKind, id: string): string {
  if (kind === 'room') return `/tip/room/${id}`;
  if (kind === 'department') return `/tip/dept/${id}`;
  return `/tip/person/${id}`;
}

function normalizeOrigin(origin: string | undefined): string {
  const candidate = origin && origin.trim() ? origin.trim() : 'http://localhost:5173';
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('INVALID_APP_ORIGIN');
  }
  return parsed.origin;
}

export async function generateQrCardsWorkflow(params: {
  db: DbAdapter;
  caller: AuthCaller;
  propertyId: string;
  kind: QrKind;
  ids?: string[] | null;
  appOrigin?: string;
}): Promise<GenerateQrCardsResult> {
  const { db, caller, propertyId, kind } = params;
  const ids = params.ids && params.ids.length > 0 ? params.ids : null;

  const resolved = await db.callRpc<{
    propertyName: string;
    templateEnabled: boolean;
    templatePath: string | null;
    qrPosition: QrPosition | null;
    targets: Array<{ id: string; kind: QrKind; label: string; sublabel: string }>;
  }>(
    caller,
    'get_qr_targets',
    { p_property_id: propertyId, p_kind: kind, p_ids: ids },
    [propertyId, kind, ids]
  );

  if (resolved.targets.length === 0) throw new Error('NO_QR_TARGETS');
  if (resolved.targets.length > MAX_RANGE) throw new Error('TOO_MANY_QR_TARGETS_MAX_500');

  const origin = normalizeOrigin(params.appOrigin);

  let templateDataUri: string | null = null;
  let templateExtension: 'png' | 'jpg' | 'webp' | null = null;
  if (resolved.templateEnabled && resolved.templatePath && db.getStoredObject) {
    const bytes = await db.getStoredObject('qr-templates', resolved.templatePath);
    if (bytes) {
      if (bytes.length > MAX_TEMPLATE_BYTES) throw new Error('TEMPLATE_TOO_LARGE_MAX_3MB');
      const kindInfo = sniffImage(bytes);
      if (kindInfo) {
        templateDataUri = `data:${kindInfo.mime};base64,${bytes.toString('base64')}`;
        templateExtension = kindInfo.ext;
      }
    }
  }

  const cards: QrCardData[] = [];
  for (const target of resolved.targets) {
    const url = `${origin}${pathFor(kind, target.id)}`;
    const qrSvg = await QRCode.toString(url, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
    });
    cards.push({
      id: target.id,
      kind,
      label: target.label,
      sublabel: target.sublabel,
      url,
      qrSvg,
    });
  }

  return {
    propertyName: resolved.propertyName,
    kind,
    count: cards.length,
    templateApplied: templateDataUri !== null,
    templateDataUri,
    templateExtension,
    qrPosition: resolved.qrPosition,
    cards,
  };
}
