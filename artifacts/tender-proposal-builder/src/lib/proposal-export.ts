import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { jsPDF } from 'jspdf';

const safeName = (value: string) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'proposal';

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportProposalDocx(title: string, content: string, kind: string) {
  const lines = content.split(/\r?\n/);
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })] }),
    ...lines.map(line => {
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) return new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][heading[1].length - 1], children: [new TextRun(heading[2])] });
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      if (bullet) return new Paragraph({ bullet: { level: 0 }, children: [new TextRun(bullet[1])] });
      return new Paragraph({ spacing: { after: 120 }, children: [new TextRun(line)] });
    }),
  ];
  const blob = await Packer.toBlob(new Document({ sections: [{ children }] }));
  save(blob, `${safeName(title)}-${kind}.docx`);
}

export function exportProposalPdf(title: string, content: string, kind: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 56; const width = doc.internal.pageSize.getWidth() - margin * 2; const bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;
  const write = (text: string, size: number, style: 'normal' | 'bold', gap: number) => {
    doc.setFont('helvetica', style); doc.setFontSize(size);
    const lineHeight = size * 1.4;
    for (const row of doc.splitTextToSize(text || ' ', width) as string[]) {
      if (y + lineHeight > bottom) { doc.addPage(); y = margin; }
      doc.text(row, margin, y); y += lineHeight;
    }
    y += gap;
  };
  write(title, 20, 'bold', 10);
  for (const line of content.split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) write(heading[2], heading[1].length === 1 ? 15 : 12.5, 'bold', 4);
    else write(line.replace(/^\s*[-*]\s+/, '\u2022 '), 10.5, 'normal', 2);
  }
  doc.save(`${safeName(title)}-${kind}.pdf`);
}
