/**
 * A minimal one-page PDF (A6 label) with text lines, written without a library. Enough for
 * the mock courier's waybills; real couriers return their own labels.
 */
export interface WaybillContent {
  carrierLabel: string;
  trackingNumber: string;
  reference: string;
  serviceName: string;
  codAmount: string | null;
  from: string[];
  to: string[];
  items: string;
  weightKg: string;
  test: boolean;
}

/** PDF string literal escaping; non-Latin-1 characters become "?" (built-in fonts). */
function text(value: string): string {
  return value
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function waybillPdf(content: WaybillContent): Buffer {
  const lines: { size: number; bold?: boolean; value: string; gap?: number }[] = [];
  if (content.test)
    lines.push({ size: 10, bold: true, value: 'TEST LABEL - NOT A REAL SHIPMENT', gap: 6 });
  lines.push({ size: 16, bold: true, value: content.carrierLabel });
  lines.push({ size: 20, bold: true, value: content.trackingNumber, gap: 4 });
  lines.push({ size: 9, value: `${content.serviceName}   Ref: ${content.reference}` });
  if (content.codAmount) {
    lines.push({
      size: 14,
      bold: true,
      value: `COLLECT ON DELIVERY: PHP ${content.codAmount}`,
      gap: 6,
    });
  }
  lines.push({ size: 9, bold: true, value: 'TO:', gap: 8 });
  for (const l of content.to) lines.push({ size: 10, value: l });
  lines.push({ size: 9, bold: true, value: 'FROM:', gap: 8 });
  for (const l of content.from) lines.push({ size: 9, value: l });
  lines.push({ size: 9, value: `Items: ${content.items}`, gap: 8 });
  lines.push({ size: 9, value: `Weight: ${content.weightKg} kg` });

  const width = 298; // A6 portrait in points
  const height = 420;
  let y = height - 30;
  const ops: string[] = [];
  for (const line of lines) {
    y -= (line.gap ?? 0) + line.size + 3;
    ops.push(
      `BT /${line.bold ? 'F2' : 'F1'} ${line.size} Tf 20 ${y} Td (${text(line.value).slice(0, 60)}) Tj ET`,
    );
  }
  // A frame around the label.
  ops.push(`10 10 ${width - 20} ${height - 20} re S`);
  const stream = ops.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
