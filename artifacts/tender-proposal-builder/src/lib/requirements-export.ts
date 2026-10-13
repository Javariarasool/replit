import type ExcelJS from 'exceljs';
import type { Evidence, RequirementItem } from '@workspace/api-client-react';
import { catLabel, reqCategories } from '@/components/requirements/shared';
import { saveBlob } from './proposal-export';

const safe = (v: string) => v.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'tender';
const selected = (r: RequirementItem) => r.options.find(o => o.id === r.selectedOptionId);
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function addSheet(wb: ExcelJS.Workbook, name: string, cols: [string, number][], rows: (string | number | null)[][]) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  const head = ws.getRow(1); head.font = { bold: true }; head.alignment = { vertical: 'middle', wrapText: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E4DA' } };
  for (const r of rows) ws.addRow(r.map(c => c === null ? null : typeof c === 'number' ? c : { richText: [{ text: c }] }));
  ws.eachRow((row, i) => { if (i > 1) row.alignment = { vertical: 'top', wrapText: true }; });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}
const baseCols: [string, number][] = [['ID', 14], ['Title', 32], ['Category', 14], ['Description', 50], ['Source quote', 50], ['Reference', 24], ['Review status', 14], ['Evidence filenames', 34], ['Verified URLs', 40], ['Selected supplier', 24], ['Selected product', 28], ['Selected model', 20], ['Quantity', 10], ['Unit', 10], ['Gaps', 40]];
const baseRow = (r: RequirementItem, files: Evidence[]): (string | number | null)[] => {
  const o = selected(r);
  return [r.id, r.title, catLabel(r.category), r.description, r.sourceQuote, r.sourceReference, r.reviewStatus,
    r.evidenceIds.map(id => files.find(f => f.id === id)?.name).filter(Boolean).join('\n'),
    r.webEvidence.filter(w => w.verified).map(w => w.url).join('\n'),
    o?.supplier ?? '', o?.product ?? '', o?.model ?? '', r.quantity, r.unit ?? '', o ? o.gaps.join('\n') : ''];
};
const priceCols: [string, number][] = [['Unit price (PKR)', 16], ['Tax basis', 14], ['Price source', 40], ['Price checked on', 24], ['Price notes / validity to confirm', 44]];
const priceCells = (r: RequirementItem, files: Evidence[]): (string | number | null)[] => {
  const o = selected(r);
  return o ? [o.pricePkr, o.taxStatus,
    [o.priceType, o.priceSourceUrl, o.quoteEvidenceId ? `Uploaded quotation: ${files.find(f => f.id === o.quoteEvidenceId)?.name ?? o.quoteEvidenceId}` : ''].filter(Boolean).join(' - '),
    o.checkedAt, o.priceNotes] : [null, '', '', '', ''];
};

export async function exportRequirementsXlsx(opts: { mode: 'filtered' | 'all'; filter: string; rows: RequirementItem[]; allRows: RequirementItem[]; files: Evidence[]; tenderTitle: string }): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(); let suffix: string;
  if (opts.mode === 'filtered') {
    const withPrice = opts.filter === 'commercial';
    addSheet(wb, opts.filter === 'all' ? 'All requirements' : catLabel(opts.filter), withPrice ? [...baseCols, ...priceCols] : baseCols, opts.rows.map(r => withPrice ? [...baseRow(r, opts.files), ...priceCells(r, opts.files)] : baseRow(r, opts.files)));
    suffix = `requirements-${opts.filter}`;
  } else {
    for (const [id, label] of reqCategories) addSheet(wb, label, baseCols, opts.allRows.filter(r => r.category === id).map(r => baseRow(r, opts.files)));
    addSheet(wb, 'Pricing', [['ID', 14], ['Title', 32], ['Category', 14], ['Selected supplier', 24], ['Selected product', 28], ['Selected model', 20], ['Quantity', 10], ['Unit', 10], ...priceCols],
      opts.allRows.map(r => { const o = selected(r); return [r.id, r.title, catLabel(r.category), o?.supplier ?? '', o?.product ?? '', o?.model ?? '', r.quantity, r.unit ?? '', ...priceCells(r, opts.files)]; }));
    suffix = 'requirements-all-groups-with-pricing';
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: MIME });
  saveBlob(blob, `${safe(opts.tenderTitle)}-${suffix}.xlsx`);
  return blob;
}
