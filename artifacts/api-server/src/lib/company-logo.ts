export function logoDimensions(bytes: Buffer): { contentType: "image/png" | "image/jpeg"; width: number; height: number } {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error("Company logos must be 2 MB or smaller.");
  let width = 0, height = 0, contentType: "image/png" | "image/jpeg";
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(12, 16).toString() === "IHDR") {
    contentType = "image/png"; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    contentType = "image/jpeg";
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) { offset++; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break;
      }
      offset += length + 2;
    }
  } else throw new Error("Upload a PNG or JPEG logo; SVG and other formats are not supported.");
  if (!width || !height || width > 4000 || height > 4000) throw new Error("Logo dimensions must be between 1 and 4,000 pixels on each side.");
  return { contentType, width, height };
}
