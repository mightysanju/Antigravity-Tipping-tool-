import type { AuthCaller, DbAdapter } from './types.ts';
import type { OcrAdapter } from '../adapters/ocrAdapter.ts';
import { extractPdfTextLines } from '../pdf/pdfText.ts';
import {
  matchAssignmentSheet,
  type AssignmentProposal,
  type Housekeeper,
} from '../../shared/assignmentMatcher.ts';

const MAX_SHEET_BYTES = 8 * 1024 * 1024;

export interface AssignmentContext {
  propertyName: string;
  timezone: string;
  today: string;
  date: string;
  rooms: string[];
  housekeepers: Housekeeper[];
  assignments: Array<{
    roomNumber: string;
    personId: string;
    personName: string;
    source: string;
    reassignedFromPersonId: string | null;
  }>;
  counts: Array<{ personId: string; name: string; roomCount: number }>;
  toggles: Record<string, boolean>;
}

export type AssignmentSource = 'pdf' | 'photo' | 'manual';

export async function getAssignmentContext(
  db: DbAdapter,
  caller: AuthCaller,
  propertyId: string,
  date: string
) {
  return db.callRpc<AssignmentContext>(
    caller,
    'get_assignment_context',
    { p_property_id: propertyId, p_date: date },
    [propertyId, date]
  );
}

function isPdf(buf: Buffer): boolean {
  return buf.length > 5 && buf.toString('latin1', 0, 5) === '%PDF-';
}

function imageMime(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export interface ReviewProposal extends AssignmentProposal {
  personName: string | null;
  candidates: Array<{ id: string; name: string }>;
  currentPersonId: string | null;
}

export interface ParseSheetResult {
  date: string;
  source: 'pdf' | 'photo';
  extractedCharCount: number;
  proposals: ReviewProposal[];
  unlistedRoomTokens: string[];
  housekeepers: Housekeeper[];
  rooms: string[];
  summary: { matched: number; ambiguous: number; unmatched: number };
  /** Nothing is saved by this call; the admin must confirm on the review screen. */
}

/** Extracts text (PDF) or runs OCR (photo), then proposes pairings. Never writes assignments. */
export async function parseAssignmentSheetWorkflow(params: {
  db: DbAdapter;
  ocr: OcrAdapter;
  caller: AuthCaller;
  propertyId: string;
  date: string;
  source: 'pdf' | 'photo';
  dataBase64: string;
}): Promise<ParseSheetResult> {
  const { db, ocr, caller, propertyId, date, source } = params;

  await db.callRpc(
    caller,
    'assert_assignment_source_enabled',
    { p_property_id: propertyId, p_source: source },
    [propertyId, source]
  );

  const body = Buffer.from(params.dataBase64, 'base64');
  if (body.length === 0) throw new Error('EMPTY_UPLOAD');
  if (body.length > MAX_SHEET_BYTES) throw new Error('SHEET_TOO_LARGE_MAX_8MB');

  let text: string;
  let storedType: string;
  if (source === 'pdf') {
    if (!isPdf(body)) throw new Error('NOT_A_PDF');
    text = await extractPdfTextLines(new Uint8Array(body));
    storedType = 'application/pdf';
    if (text.replace(/\s/g, '').length < 10) {
      throw new Error('PDF_NO_TEXT_USE_PHOTO_OCR');
    }
  } else {
    // The mock OCR adapter (tests/dev) reads plain text bodies; real OCR requires an actual image.
    const mime = imageMime(body);
    if (!mime && ocr.mode !== 'mock') throw new Error('UNSUPPORTED_IMAGE_TYPE');
    storedType = mime ?? 'text/plain';
    text = await ocr.extractTextFromImage(body, storedType);
  }

  const context = await getAssignmentContext(db, caller, propertyId, date);
  const result = matchAssignmentSheet({
    text,
    rooms: context.rooms,
    housekeepers: context.housekeepers,
  });

  if (db.uploadPrivateObject) {
    const ext = source === 'pdf' ? 'pdf' : storedType === 'image/png' ? 'png' : storedType === 'image/webp' ? 'webp' : 'jpg';
    await db.uploadPrivateObject(
      'assignment-sheets',
      `${propertyId}/${date}/${Date.now()}.${ext}`,
      body,
      storedType
    );
  }

  const nameById = new Map(context.housekeepers.map((h) => [h.id, h.name]));
  const currentByRoom = new Map(context.assignments.map((a) => [a.roomNumber, a.personId]));
  const proposals: ReviewProposal[] = result.proposals.map((p) => ({
    ...p,
    personName: p.personId ? nameById.get(p.personId) ?? null : null,
    candidates: p.candidateIds.map((id) => ({ id, name: nameById.get(id) ?? 'Unknown' })),
    currentPersonId: currentByRoom.get(p.roomNumber) ?? null,
  }));

  return {
    date,
    source,
    extractedCharCount: result.extractedCharCount,
    proposals,
    unlistedRoomTokens: result.unlistedRoomTokens,
    housekeepers: context.housekeepers,
    rooms: context.rooms,
    summary: {
      matched: proposals.filter((p) => p.status === 'matched').length,
      ambiguous: proposals.filter((p) => p.status === 'ambiguous').length,
      unmatched: proposals.filter((p) => p.status === 'unmatched').length,
    },
  };
}

export async function saveAssignmentsWorkflow(
  db: DbAdapter,
  caller: AuthCaller,
  input: {
    propertyId: string;
    date: string;
    source: AssignmentSource;
    items: Array<{ roomNumber: string; personId: string }>;
  }
) {
  return db.callRpc<{ savedCount: number; reassignedCount: number; unchangedCount: number }>(
    caller,
    'save_assignments',
    {
      p_property_id: input.propertyId,
      p_date: input.date,
      p_source: input.source,
      p_items: input.items,
    },
    [input.propertyId, input.date, input.source, JSON.stringify(input.items)]
  );
}
