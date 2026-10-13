// One-time fixture generator, not a runtime dependency.
// Usage: node generate-tender-scans.mjs /path/to/NotoNaskhArabic-Regular.ttf /path/to/NotoSans-Regular.ttf
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
const require = createRequire(import.meta.url);
const { createCanvas, GlobalFonts } = createRequire(require.resolve("pdf-parse"))("@napi-rs/canvas");
if (!process.argv[2] || !process.argv[3]) throw new Error("Provide the Noto Naskh Arabic and Noto Sans font files.");
GlobalFonts.registerFromPath(process.argv[2], "FixtureArabic");
GlobalFonts.registerFromPath(process.argv[3], "FixtureLatin");
const width = 1800, height = 850;
const fixtures = {
  urdu: [
    "حکومت پنجاب محکمہ تعلیم",
    "سرکاری ٹینڈر نوٹس",
    "ٹینڈر نوٹس",
    "کمپیوٹر کی فراہمی",
    "بولی جمع کرانے کی آخری تاریخ",
    "تمام قیمتیں پاکستانی روپے میں",
  ],
  mixed: [
    "حکومت پنجاب",
    "GOVERNMENT OF PUNJAB",
    "محکمہ تعلیم",
    "Tender Notice IT-2026-024",
    "کمپیوٹر کی فراہمی",
    "Quantity 24 units - Bid security PKR 50000",
    "Submission deadline 20 October 2026",
  ],
};
function scanPdf(rgb) {
  const pixels = deflateSync(rgb);
  const draw = `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`;
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>\nstream\n`), pixels, Buffer.from("\nendstream")]),
    Buffer.from(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`),
  ];
  const parts = [Buffer.from("%PDF-1.4\n")], offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(parts).length);
    parts.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n"));
  });
  const start = Buffer.concat(parts).length;
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`));
  return Buffer.concat(parts);
}
for (const [name, lines] of Object.entries(fixtures)) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "black"; ctx.textAlign = "center";
  lines.forEach((text, index) => {
    ctx.font = /[a-z]/i.test(text) ? '52px "FixtureLatin"' : '60px "FixtureArabic"';
    ctx.fillText(text, width / 2, 110 + index * 105);
  });
  writeFileSync(new URL(`${name}-tender.png`, import.meta.url), canvas.toBuffer("image/png"));
  const rgba = ctx.getImageData(0, 0, width, height).data, rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  writeFileSync(new URL(`${name}-tender.pdf`, import.meta.url), scanPdf(rgb));
}
