// Pure, dependency-free QR card composition (runs in Node for tests/server and in the browser).
// Card geometry is a fixed 1000 x 1400 portrait canvas; qrPosition is {x, y, size} as fractions
// of card width/height (size is a fraction of card width, QR is always square).

export const CARD_WIDTH = 1000;
export const CARD_HEIGHT = 1400;

export interface QrPosition {
  x: number;
  y: number;
  size: number;
}

export interface QrCardData {
  id: string;
  kind: 'room' | 'department' | 'person';
  label: string;
  sublabel: string;
  url: string;
  /** Full <svg> markup produced by the `qrcode` package (type: 'svg', margin: 0). */
  qrSvg: string;
}

export type TemplateRef =
  | { mode: 'embedded'; dataUri: string }
  | { mode: 'linked'; href: string }
  | { mode: 'external' } // template supplied by the surrounding document (CSS background)
  | null;

export const DEFAULT_QR_POSITION: QrPosition = { x: 0.15, y: 0.27, size: 0.7 };

export function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function sanitizeQrPosition(pos: Partial<QrPosition> | null | undefined): QrPosition {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number' || typeof pos.size !== 'number') {
    return DEFAULT_QR_POSITION;
  }
  const size = Math.min(0.8, Math.max(0.1, pos.size));
  const x = Math.min(1 - size, Math.max(0, pos.x));
  const maxY = 1 - (size * CARD_WIDTH) / CARD_HEIGHT;
  const y = Math.min(maxY, Math.max(0, pos.y));
  return { x, y, size };
}

function nestQrSvg(qrSvg: string, x: number, y: number, size: number): string {
  if (!/^\s*<svg[\s>]/i.test(qrSvg)) {
    throw new Error('INVALID_QR_SVG');
  }
  return qrSvg.replace(
    /^\s*<svg\b/i,
    `<svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}"`
  );
}

export function composeCardSvg(params: {
  card: QrCardData;
  propertyName: string;
  template: TemplateRef;
  position: QrPosition | null | undefined;
}): string {
  const { card, propertyName, template } = params;
  const hasTemplate = template !== null;
  const pos = hasTemplate ? sanitizeQrPosition(params.position) : DEFAULT_QR_POSITION;

  const qrSize = pos.size * CARD_WIDTH;
  const qrX = pos.x * CARD_WIDTH;
  const qrY = pos.y * CARD_HEIGHT;
  const pad = Math.round(qrSize * 0.06);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" ` +
      `role="img" aria-label="${escapeXml(`${propertyName} tipping QR code: ${card.label}`)}">`
  );

  if (!template) {
    parts.push(
      `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#2A1E16"/><stop offset="1" stop-color="#4A3526"/></linearGradient></defs>`,
      `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bg)"/>`,
      `<text x="500" y="150" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" ` +
        `font-size="52" fill="#F5EBE0">${escapeXml(truncate(propertyName, 34))}</text>`,
      `<line x1="400" y1="190" x2="600" y2="190" stroke="#E6C79C" stroke-width="3"/>`
    );
  } else if (template.mode === 'embedded') {
    parts.push(
      `<image x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" preserveAspectRatio="xMidYMid slice" ` +
        `href="${template.dataUri}" xlink:href="${template.dataUri}"/>`
    );
  } else if (template.mode === 'linked') {
    const href = escapeXml(template.href);
    parts.push(
      `<image x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" preserveAspectRatio="xMidYMid slice" ` +
        `href="${href}" xlink:href="${href}"/>`
    );
  }

  // White plate behind the QR keeps it scannable on any template artwork.
  parts.push(
    `<rect x="${(qrX - pad).toFixed(2)}" y="${(qrY - pad).toFixed(2)}" ` +
      `width="${(qrSize + pad * 2).toFixed(2)}" height="${(qrSize + pad * 2).toFixed(2)}" rx="${pad}" fill="#FFFFFF"/>`,
    nestQrSvg(card.qrSvg, qrX, qrY, qrSize)
  );

  const plateBottom = qrY + qrSize + pad;
  const labelY = Math.min(CARD_HEIGHT - 110, plateBottom + 90);
  parts.push(
    `<rect x="150" y="${(labelY - 62).toFixed(2)}" width="700" height="${card.sublabel ? 128 : 92}" rx="22" ` +
      `fill="#2A1E16" fill-opacity="0.82"/>`,
    `<text x="500" y="${labelY.toFixed(2)}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" ` +
      `font-size="46" fill="#FAF6F0">${escapeXml(truncate(card.label, 28))}</text>`
  );
  if (card.sublabel) {
    parts.push(
      `<text x="500" y="${(labelY + 44).toFixed(2)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" ` +
        `font-size="28" fill="#E6C79C">${escapeXml(truncate(card.sublabel, 40))}</text>`
    );
  }
  parts.push(
    `<text x="500" y="${CARD_HEIGHT - 40}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" ` +
      `font-size="26" fill="${hasTemplate ? '#2A1E16' : '#E6C79C'}">Scan to say thank you</text>`,
    `</svg>`
  );
  return parts.join('');
}

export function safeFileName(label: string, fallback: string): string {
  const cleaned = label
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return cleaned || fallback;
}

export function buildPrintSheetHtml(params: {
  propertyName: string;
  cards: QrCardData[];
  templateDataUri: string | null;
  position: QrPosition | null | undefined;
}): string {
  const { propertyName, cards, templateDataUri, position } = params;
  const template: TemplateRef = templateDataUri ? { mode: 'external' } : null;
  const cells = cards
    .map(
      (card) =>
        `<div class="card">${composeCardSvg({ card, propertyName, template, position })}</div>`
    )
    .join('\n');
  const tplVar = templateDataUri ? `--tpl: url("${templateDataUri}");` : '--tpl: none;';
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/>` +
    `<title>${escapeXml(propertyName)} QR cards</title>` +
    `<style>@page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{margin:0;font-family:Helvetica,Arial,sans-serif}` +
    `.sheet{${tplVar}display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}` +
    `.card{break-inside:avoid;aspect-ratio:5/7;background:var(--tpl) center/cover no-repeat;border:0.2mm dashed #bbb;overflow:hidden}` +
    `.card svg{display:block;width:100%;height:100%}` +
    `@media screen{body{padding:12px;background:#eee}.sheet{max-width:1100px;margin:auto}}</style></head>` +
    `<body><div class="sheet">${cells}</div></body></html>`
  );
}

// ---- Minimal ZIP writer (STORE method; CRC32) ----

let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) =>
    new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const concat = (...arrs: Uint8Array[]) => {
    const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
    let p = 0;
    for (const a of arrs) {
      out.set(a, p);
      p += a.length;
    }
    return out;
  };

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const crc = crc32(file.data);
    const local = concat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
      u32(crc), u32(file.data.length), u32(file.data.length),
      u16(nameBytes.length), u16(0), nameBytes
    );
    chunks.push(local, file.data);
    central.push(
      concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
        u32(crc), u32(file.data.length), u32(file.data.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes
      )
    );
    offset += local.length + file.data.length;
  }

  const centralBytes = concat(...central);
  const end = concat(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralBytes.length), u32(offset), u16(0)
  );
  return concat(...chunks, centralBytes, end);
}

export function buildCardZip(params: {
  propertyName: string;
  cards: QrCardData[];
  template: { bytes: Uint8Array; extension: 'png' | 'jpg' | 'webp' } | null;
  position: QrPosition | null | undefined;
}): Uint8Array {
  const { propertyName, cards, template, position } = params;
  const enc = new TextEncoder();
  const templateName = template ? `template.${template.extension}` : null;
  const used = new Set<string>();
  const files: Array<{ name: string; data: Uint8Array }> = [];

  for (const card of cards) {
    const base = `${card.kind}-${safeFileName(card.label, card.id.slice(0, 8))}`;
    let name = `${base}.svg`;
    let n = 2;
    while (used.has(name)) name = `${base}-${n++}.svg`;
    used.add(name);
    const svg = composeCardSvg({
      card,
      propertyName,
      template: templateName ? { mode: 'linked', href: templateName } : null,
      position,
    });
    files.push({ name, data: enc.encode(svg) });
  }
  if (template && templateName) files.push({ name: templateName, data: template.bytes });
  return buildZip(files);
}
