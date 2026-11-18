// Bilder für den PDF-Schreiber vorbereiten (ohne Abhängigkeiten): PNG wird entpackt und als RGB + Alpha
// neu komprimiert, JPEG wird unverändert übernommen (PDF kann JPEG direkt anzeigen).
import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buf) {
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  if (!w || !h || w > 4000 || h > 4000) throw new Error('Bildgröße nicht unterstützt (höchstens 4000 x 4000 Pixel).');
  if (depth !== 8 || interlace) throw new Error('Dieses PNG-Format wird nicht unterstützt. Bitte als normales PNG (8 Bit) oder JPG speichern.');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error('Unbekannter PNG-Farbtyp.');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, px = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[i] = v & 0xff;
    }
    prev = out;
  }
  const rgb = Buffer.alloc(w * h * 3), alpha = Buffer.alloc(w * h, 255);
  let hasAlpha = false;
  for (let i = 0; i < w * h; i++) {
    let r, g, bl, al = 255;
    if (type === 0) { r = g = bl = px[i]; if (trns && trns.length >= 2 && px[i] === trns[1]) al = 0; }
    else if (type === 4) { r = g = bl = px[i * 2]; al = px[i * 2 + 1]; }
    else if (type === 2) { r = px[i * 3]; g = px[i * 3 + 1]; bl = px[i * 3 + 2]; }
    else if (type === 6) { r = px[i * 4]; g = px[i * 4 + 1]; bl = px[i * 4 + 2]; al = px[i * 4 + 3]; }
    else { const k = px[i]; if (!palette || k * 3 + 2 >= palette.length) throw new Error('PNG-Palette fehlt.'); r = palette[k * 3]; g = palette[k * 3 + 1]; bl = palette[k * 3 + 2]; if (trns && k < trns.length) al = trns[k]; }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = bl; alpha[i] = al;
    if (al !== 255) hasAlpha = true;
  }
  return { kind: 'raw', w, h, data: zlib.deflateSync(rgb), alpha: hasAlpha ? zlib.deflateSync(alpha) : null };
}

function parseJpeg(buf) {
  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) { pos++; continue; }
    const m = buf[pos + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
      const h = buf.readUInt16BE(pos + 5), w = buf.readUInt16BE(pos + 7), comps = buf[pos + 9];
      if (![1, 3].includes(comps)) throw new Error('JPG-Farbformat (z. B. CMYK) wird nicht unterstützt. Bitte als RGB-JPG oder PNG speichern.');
      return { kind: 'jpeg', w, h, comps, data: buf };
    }
    pos += 2 + buf.readUInt16BE(pos + 2);
  }
  throw new Error('JPG-Datei ist beschädigt.');
}

/** Liest PNG oder JPG und liefert ein Bildobjekt für PdfDoc.image(). */
export function loadImage(buf) {
  if (buf.subarray(0, 8).equals(PNG_SIG)) return decodePng(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return parseJpeg(buf);
  throw new Error('Bitte eine PNG- oder JPG-Datei wählen.');
}
