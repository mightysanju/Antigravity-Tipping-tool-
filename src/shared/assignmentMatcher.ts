// Rule-based assignment sheet matcher (spec section 17). Pure and dependency-free.
// Rules implemented: (2) room tokens must equal a property room number, (3) full name first, then a
// first name only when unique among active housekeepers, (4) pair on the same line or same block,
// (5) anything uncertain is returned as unmatched/ambiguous for manual fix, (6) shared first names
// are never guessed, (7) no fixed column layout.

export interface Housekeeper {
  id: string;
  name: string;
}

export type ProposalStatus = 'matched' | 'ambiguous' | 'unmatched';
export type MatchMethod = 'full_name' | 'first_name' | 'block';

export interface AssignmentProposal {
  roomNumber: string;
  status: ProposalStatus;
  personId: string | null;
  /** Housekeepers the admin may pick from when status is ambiguous. */
  candidateIds: string[];
  method: MatchMethod | null;
  sourceLine: string;
}

export interface MatchResult {
  proposals: AssignmentProposal[];
  /** Numeric tokens (3-5 digits) that look like rooms but are not in the property room list. */
  unlistedRoomTokens: string[];
  extractedCharCount: number;
}

interface LineName {
  personId: string | null;
  candidateIds: string[];
  method: 'full_name' | 'first_name';
}

function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDatesAndTimes(line: string): string {
  return line
    .replace(/\b\d{1,4}[/.]\d{1,2}[/.]\d{1,4}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ');
}

function roomTokens(line: string): string[] {
  return stripDatesAndTimes(line).match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g) ?? [];
}

function findNames(line: string, hks: Array<Housekeeper & { first: string; variants: string[] }>): LineName[] {
  let working = ` ${normalize(line)} `;
  const found: LineName[] = [];

  const variants: Array<{ text: string; hk: (typeof hks)[number] }> = [];
  for (const hk of hks) for (const v of hk.variants) variants.push({ text: v, hk });
  variants.sort((a, b) => b.text.length - a.text.length);

  for (const { text, hk } of variants) {
    const needle = ` ${text} `;
    while (working.includes(needle)) {
      // Another housekeeper with identical full name makes this ambiguous.
      const twins = hks.filter((o) => o.variants.includes(text));
      if (twins.length > 1) {
        found.push({ personId: null, candidateIds: twins.map((t) => t.id), method: 'full_name' });
      } else {
        found.push({ personId: hk.id, candidateIds: [hk.id], method: 'full_name' });
      }
      working = working.replace(needle, '  ');
    }
  }

  const remaining = working.trim().split(' ').filter(Boolean);
  const used = new Set<string>();
  for (const token of remaining) {
    if (used.has(token)) continue;
    const holders = hks.filter((hk) => hk.first === token);
    if (holders.length === 0) continue;
    used.add(token);
    if (holders.length === 1) {
      found.push({ personId: holders[0].id, candidateIds: [holders[0].id], method: 'first_name' });
    } else {
      found.push({ personId: null, candidateIds: holders.map((h) => h.id), method: 'first_name' });
    }
  }
  return found;
}

function summarize(names: LineName[]): { personId: string | null; candidateIds: string[]; method: MatchMethod | null } {
  const unique = new Map<string, LineName>();
  const ambiguousCandidates = new Set<string>();
  for (const n of names) {
    if (n.personId) unique.set(n.personId, n);
    else n.candidateIds.forEach((id) => ambiguousCandidates.add(id));
  }
  if (unique.size === 1 && ambiguousCandidates.size === 0) {
    const only = [...unique.values()][0];
    return { personId: only.personId, candidateIds: [only.personId!], method: only.method };
  }
  const all = new Set<string>([...unique.keys(), ...ambiguousCandidates]);
  return { personId: null, candidateIds: [...all], method: null };
}

export function matchAssignmentSheet(params: {
  text: string;
  rooms: string[];
  housekeepers: Housekeeper[];
}): MatchResult {
  const roomLookup = new Map(params.rooms.map((r) => [r.toLowerCase(), r]));
  const hks = params.housekeepers.map((hk) => {
    const parts = normalize(hk.name).split(' ').filter(Boolean);
    const first = parts[0] ?? '';
    const rest = parts.slice(1).join(' ');
    const variants = rest ? [`${first} ${rest}`, `${rest} ${first}`] : [first];
    return { ...hk, first, variants: variants.filter(Boolean) };
  });

  const rawLines = params.text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
  const extractedCharCount = rawLines.join('').length;

  // Blocks are runs of non-empty lines.
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of rawLines) {
    if (line === '') {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);

  const proposals: AssignmentProposal[] = [];
  const unlisted = new Set<string>();

  for (const block of blocks) {
    const analyzed = block.map((line) => {
      const tokens = roomTokens(line);
      const rooms: string[] = [];
      let roomLike = false;
      for (const t of tokens) {
        const hit = roomLookup.get(t.toLowerCase());
        if (hit) {
          roomLike = true;
          if (!rooms.includes(hit)) rooms.push(hit);
        } else if (/^\d{3,5}$/.test(t)) {
          roomLike = true;
          unlisted.add(t);
        }
      }
      return { line, rooms, roomLike, names: findNames(line, hks) };
    });

    // Names on lines with no room-like token act as block headers. A line carrying an unlisted
    // room number (e.g. 999) is a data row, not a header, so its name must not leak to other rows.
    const headerNames = analyzed.filter((a) => !a.roomLike).flatMap((a) => a.names);
    const headerSummary = headerNames.length ? summarize(headerNames) : null;

    for (const a of analyzed) {
      if (a.rooms.length === 0) continue;
      let pick: { personId: string | null; candidateIds: string[]; method: MatchMethod | null };
      if (a.names.length > 0) {
        pick = summarize(a.names);
      } else if (headerSummary) {
        pick = { ...headerSummary, method: headerSummary.personId ? 'block' : null };
      } else {
        pick = { personId: null, candidateIds: [], method: null };
      }
      for (const room of a.rooms) {
        proposals.push({
          roomNumber: room,
          status: pick.personId ? 'matched' : pick.candidateIds.length > 0 ? 'ambiguous' : 'unmatched',
          personId: pick.personId,
          candidateIds: pick.candidateIds,
          method: pick.method,
          sourceLine: a.line,
        });
      }
    }
  }

  // A room listed twice for different people is a conflict: never guess.
  const byRoom = new Map<string, AssignmentProposal[]>();
  for (const p of proposals) byRoom.set(p.roomNumber, [...(byRoom.get(p.roomNumber) ?? []), p]);
  const finalProposals: AssignmentProposal[] = [];
  for (const [room, list] of byRoom) {
    const people = new Set(list.map((p) => p.personId).filter(Boolean) as string[]);
    const allMatched = list.every((p) => p.status === 'matched');
    if (list.length === 1) {
      finalProposals.push(list[0]);
    } else if (allMatched && people.size === 1) {
      finalProposals.push(list[0]);
    } else {
      const candidates = new Set<string>();
      list.forEach((p) => p.candidateIds.forEach((c) => candidates.add(c)));
      finalProposals.push({
        roomNumber: room,
        status: candidates.size ? 'ambiguous' : 'unmatched',
        personId: null,
        candidateIds: [...candidates],
        method: null,
        sourceLine: list.map((p) => p.sourceLine).join(' | '),
      });
    }
  }

  return { proposals: finalProposals, unlistedRoomTokens: [...unlisted].sort(), extractedCharCount };
}
