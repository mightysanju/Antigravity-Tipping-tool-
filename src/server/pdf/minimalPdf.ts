export interface SignedAgreementPdfInput {
  title: string;
  propertyName: string;
  signerType: 'property' | 'staff';
  typedName: string;
  signerEmail: string;
  version: string;
  signedAtIso: string;
  ipAddress: string;
  clauses: readonly string[];
}

function toPrintableAscii(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function escapePdfLiteral(value: string): string {
  return toPrintableAscii(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text: string, maxChars = 84): string[] {
  const words = toPrintableAscii(text).trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Generates a self-contained, valid %PDF-1.4 document with exact byte offsets.
 */
export function generateSignedAgreementPdf(input: SignedAgreementPdfInput): Buffer {
  const lines: Array<{ text: string; size: number; gap: number }> = [
    { text: input.title, size: 15, gap: 22 },
    { text: `Property: ${input.propertyName}   |   Agreement Version: ${input.version}`, size: 10, gap: 18 },
    { text: '--------------------------------------------------------------------------------', size: 10, gap: 16 },
  ];

  for (const clause of input.clauses) {
    const wrapped = wrapText(clause, 86);
    wrapped.forEach((line, idx) => {
      lines.push({ text: line, size: 10, gap: idx === wrapped.length - 1 ? 18 : 13 });
    });
  }

  lines.push({
    text: '--------------------------------------------------------------------------------',
    size: 10,
    gap: 18,
  });
  lines.push({ text: 'ELECTRONIC CLICK-TO-ACCEPT EXECUTION RECORD', size: 11, gap: 16 });
  lines.push({ text: `Signer Type: ${input.signerType.toUpperCase()}`, size: 10, gap: 14 });
  lines.push({ text: `Typed Legal Name: ${input.typedName}`, size: 10, gap: 14 });
  lines.push({ text: `Account Email: ${input.signerEmail}`, size: 10, gap: 14 });
  lines.push({ text: `Timestamp (UTC): ${input.signedAtIso}`, size: 10, gap: 14 });
  lines.push({ text: `Recorded IP Address: ${input.ipAddress}`, size: 10, gap: 14 });
  lines.push({ text: 'Checkbox Confirmed: YES (Immutable Audit Record)', size: 10, gap: 14 });

  const streamOps: string[] = ['BT'];
  let y = 744;
  for (const row of lines) {
    if (y < 52) break;
    streamOps.push(`/F1 ${row.size} Tf`);
    streamOps.push(`1 0 0 1 54 ${y} Tm`);
    streamOps.push(`(${escapePdfLiteral(row.text)}) Tj`);
    y -= row.gap;
  }
  streamOps.push('ET');

  const streamContent = streamOps.join('\n');
  const streamLength = Buffer.byteLength(streamContent, 'utf8');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  ];

  const chunks: string[] = ['%PDF-1.4\n'];
  let byteOffset = Buffer.byteLength(chunks[0], 'utf8');
  const offsets: number[] = [];

  for (const obj of objects) {
    offsets.push(byteOffset);
    chunks.push(obj);
    byteOffset += Buffer.byteLength(obj, 'utf8');
  }

  const xrefStart = byteOffset;
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  for (const offset of offsets) {
    chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.from(chunks.join(''), 'utf8');
}
