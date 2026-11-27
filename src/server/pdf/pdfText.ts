import { getDocumentProxy } from 'unpdf';

interface PositionedItem {
  str: string;
  x: number;
  y: number;
}

/**
 * Extracts text from a text-based PDF and rebuilds visual lines from item coordinates, so
 * table cells on the same row ("101 | Maria Garcia") stay on one line regardless of column layout.
 * A blank line is emitted where the vertical gap is clearly larger than the normal line spacing,
 * which lets the matcher treat sections ("Floor 4" headers) as blocks.
 * Image-only (scanned) PDFs produce no text; callers should route those to photo OCR.
 */
export async function extractPdfTextLines(pdfBytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
  const out: string[] = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const items: PositionedItem[] = [];
    for (const raw of content.items) {
      const item = raw as { str?: string; transform?: number[] };
      if (!item.str || !item.str.trim() || !item.transform) continue;
      items.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
    }
    if (items.length === 0) continue;

    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Array<{ y: number; parts: PositionedItem[] }> = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= 2.5) last.parts.push(it);
      else lines.push({ y: it.y, parts: [it] });
    }

    const gaps: number[] = [];
    for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

    lines.forEach((line, idx) => {
      if (idx > 0 && median > 0 && gaps[idx - 1] > median * 1.6) out.push('');
      line.parts.sort((a, b) => a.x - b.x);
      out.push(line.parts.map((p) => p.str.trim()).join(' '));
    });
    out.push('');
  }
  return out.join('\n');
}
