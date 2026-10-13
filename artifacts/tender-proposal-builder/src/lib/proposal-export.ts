import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { objectUrl } from '@/components/library/shared';

export type ExportBranding = { companyName: string; logoObjectPath: string | null };
export type ExportOptions = { status: string; branding: ExportBranding };
type Logo = { bytes: Uint8Array; dataUrl: string; type: 'png' | 'jpg'; width: number; height: number };
type Block = { kind: 'line'; text: string } | { kind: 'table'; rows: string[][] };

const safeName = (value: string) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'proposal';
export const statusBanner = (status: string) => status === 'approved' ? 'Human reviewed - not certified' : 'DRAFT - HUMAN REVIEW REQUIRED';

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadLogo(path: string | null): Promise<Logo | null> {
  if (!path) return null;
  let res: Response;
  try { res = await fetch(objectUrl(path), { credentials: 'include' }); } catch { throw new Error('The saved company logo could not be loaded. Export cancelled; check your connection and try again.'); }
  if (!res.ok) throw new Error(`The saved company logo could not be loaded (${res.status}). Export cancelled; replace or retry the logo.`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const png = buf[0] === 0x89 && buf[1] === 0x50; const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!png && !jpg) throw new Error('The saved company logo is not a valid PNG or JPEG. Export cancelled.');
  const mime = png ? 'image/png' : 'image/jpeg';
  const blob = new Blob([buf], { type: mime });
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { throw new Error('The saved company logo could not be decoded. Export cancelled.'); }
  const dataUrl = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error('Logo read failed.')); r.readAsDataURL(blob); });
  const logo = { bytes: buf, dataUrl, type: png ? 'png' as const : 'jpg' as const, width: bmp.width, height: bmp.height };
  bmp.close();
  return logo;
}
const fit = (w: number, h: number, maxW: number, maxH: number) => { const s = Math.min(maxW / w, maxH / h, 1); return { w: Math.round(w * s), h: Math.round(h * s) }; };

function parseBlocks(content: string): Block[] {
  const out: Block[] = []; let rows: string[][] | null = null;
  const flush = () => { if (rows && rows.length) out.push({ kind: 'table', rows }); rows = null; };
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-')) continue;
      (rows ??= []).push(line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')));
    } else { flush(); out.push({ kind: 'line', text: line }); }
  }
  flush(); return out;
}

export async function exportProposalDocx(title: string, content: string, kind: string, opts: ExportOptions): Promise<Blob> {
  const logo = await loadLogo(opts.branding.logoObjectPath);
  const cover: Paragraph[] = [];
  if (logo) { const s = fit(logo.width, logo.height, 220, 100); cover.push(new Paragraph({ spacing: { after: 240 }, children: [new ImageRun({ type: logo.type, data: logo.bytes, transformation: { width: s.w, height: s.h } })] })); }
  if (opts.branding.companyName) cover.push(new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ text: opts.branding.companyName, bold: true, size: 32 })] }));
  cover.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })] }));
  cover.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `${kind === 'commercial' ? 'Commercial' : 'Technical'} proposal`, size: 26 })] }));
  cover.push(new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: statusBanner(opts.status), bold: true, color: opts.status === 'approved' ? '1F5F3F' : 'A02020', size: 26 })] }));
  cover.push(new Paragraph({ children: [new PageBreak()] }));
  const body: (Paragraph | Table)[] = [];
  const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  for (const b of parseBlocks(content)) {
    if (b.kind === 'table') {
      const cols = Math.max(...b.rows.map(r => r.length));
      body.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: b.rows.map((r, i) => new TableRow({ tableHeader: i === 0, cantSplit: true, children: Array.from({ length: cols }, (_, c) => new TableCell({ borders: { top: border, bottom: border, left: border, right: border }, shading: i === 0 ? { fill: 'E8E4DA' } : undefined, margins: { top: 60, bottom: 60, left: 90, right: 90 }, children: [new Paragraph({ children: [new TextRun({ text: r[c] ?? '', bold: i === 0 })] })] })) })) }));
      body.push(new Paragraph({ children: [] }));
      continue;
    }
    const line = b.text;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) body.push(new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][heading[1].length - 1], children: [new TextRun(heading[2])] }));
    else { const bullet = /^\s*[-*]\s+(.*)$/.exec(line); body.push(bullet ? new Paragraph({ bullet: { level: 0 }, children: [new TextRun(bullet[1])] }) : new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.LEFT, children: [new TextRun(line)] })); }
  }
  const blob = await Packer.toBlob(new Document({ sections: [{ children: [...cover, ...body] }] }));
  saveBlob(blob, `${safeName(title)}-${kind}.docx`);
  return blob;
}

export async function exportProposalPdf(title: string, content: string, kind: string, opts: ExportOptions): Promise<Blob> {
  const logo = await loadLogo(opts.branding.logoObjectPath);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 56; const pw = doc.internal.pageSize.getWidth(); const width = pw - margin * 2; const bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin + 40;
  if (logo) { const s = fit(logo.width, logo.height, 220, 100); doc.addImage(logo.dataUrl, logo.type === 'png' ? 'PNG' : 'JPEG', margin, y, s.w, s.h); y += s.h + 28; }
  if (opts.branding.companyName) { doc.setFont('helvetica', 'bold'); doc.setFontSize(18); for (const r of doc.splitTextToSize(opts.branding.companyName, width) as string[]) { doc.text(r, margin, y); y += 24; } y += 20; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(26); for (const r of doc.splitTextToSize(title, width) as string[]) { doc.text(r, margin, y); y += 32; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.text(`${kind === 'commercial' ? 'Commercial' : 'Technical'} proposal`, margin, y + 6);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(opts.status === 'approved' ? 31 : 160, opts.status === 'approved' ? 95 : 32, opts.status === 'approved' ? 63 : 32); doc.text(statusBanner(opts.status), margin, y + 34); doc.setTextColor(0);
  doc.addPage(); y = margin;
  const write = (text: string, size: number, style: 'normal' | 'bold', gap: number) => {
    doc.setFont('helvetica', style); doc.setFontSize(size); const lh = size * 1.4;
    for (const row of doc.splitTextToSize(text || ' ', width) as string[]) { if (y + lh > bottom) { doc.addPage(); y = margin; } doc.text(row, margin, y); y += lh; }
    y += gap;
  };
  for (const b of parseBlocks(content)) {
    if (b.kind === 'table') {
      const [head, ...rest] = b.rows;
      autoTable(doc, { startY: y, head: [head], body: rest, margin: { left: margin, right: margin, bottom: margin }, styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak', valign: 'top' }, headStyles: { fillColor: [60, 60, 56] }, rowPageBreak: 'avoid' });
      y = ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY) + 12;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(b.text);
    if (heading) write(heading[2], heading[1].length === 1 ? 15 : 12.5, 'bold', 4);
    else write(b.text.replace(/^\s*[-*]\s+/, '\u2022 '), 10.5, 'normal', 2);
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(110); doc.text(`${statusBanner(opts.status)}  |  Page ${i} of ${n}`, margin, doc.internal.pageSize.getHeight() - 28); doc.setTextColor(0); }
  const blob = doc.output('blob');
  saveBlob(blob, `${safeName(title)}-${kind}.pdf`);
  return blob;
}
