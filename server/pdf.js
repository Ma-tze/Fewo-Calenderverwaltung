// Sehr kleiner PDF-Schreiber ohne Abhängigkeiten: Rechtecke, Linien, Text (Helvetica, WinAnsi).
// Koordinaten von oben links in Punkt (1 pt = 1/72 Zoll). A4 quer = 842 x 595.

const CP1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };

function encodeText(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    let c = ch.codePointAt(0);
    if (CP1252[ch]) c = CP1252[ch];
    else if (c > 255 || (c >= 0x80 && c < 0xa0)) c = 0x3f; // '?'
    else if (c < 32) c = 32;
    const b = String.fromCharCode(c);
    out += b === '(' || b === ')' || b === '\\' ? '\\' + b : b;
  }
  return out;
}

const n = v => (Math.round(v * 100) / 100).toString();

function rgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}

export class PdfDoc {
  constructor({ width = 842, height = 595 } = {}) {
    this.W = width; this.H = height; this.pages = []; this.images = []; this.newPage();
  }
  // Bild (aus image.js loadImage) in ein Feld einpassen, Seitenverhältnis bleibt; liefert die tatsächliche Größe
  image(img, x, y, maxW, maxH) {
    const sc = Math.min(maxW / img.w, maxH / img.h), w = img.w * sc, h = img.h * sc;
    let k = this.images.indexOf(img);
    if (k < 0) { this.images.push(img); k = this.images.length - 1; }
    this.cur.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(this.#y(y + h))} cm /Im${k + 1} Do Q`);
    return { w, h };
  }
  newPage() { this.cur = []; this.pages.push(this.cur); return this; }
  #y(y) { return this.H - y; }
  fill(hex) { const [r, g, b] = rgb(hex); this.cur.push(`${n(r)} ${n(g)} ${n(b)} rg`); return this; }
  stroke(hex, w = 0.5) { const [r, g, b] = rgb(hex); this.cur.push(`${n(r)} ${n(g)} ${n(b)} RG ${n(w)} w`); return this; }
  rect(x, y, w, h, mode = 'f') { this.cur.push(`${n(x)} ${n(this.#y(y + h))} ${n(w)} ${n(h)} re ${mode}`); return this; }
  line(x1, y1, x2, y2) { this.cur.push(`${n(x1)} ${n(this.#y(y1))} m ${n(x2)} ${n(this.#y(y2))} l S`); return this; }
  // Text mit Grundlinie bei y; optional auf ein Rechteck beschnitten
  text(x, y, s, { size = 9, bold = false, color = '#1d2420', clip = null } = {}) {
    const [r, g, b] = rgb(color);
    const t = `BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(r)} ${n(g)} ${n(b)} rg ${n(x)} ${n(this.#y(y))} Td (${encodeText(s)}) Tj ET`;
    if (clip) this.cur.push(`q ${n(clip[0])} ${n(this.#y(clip[1] + clip[3]))} ${n(clip[2])} ${n(clip[3])} re W n ${t} Q`);
    else this.cur.push(t);
    return this;
  }
  // grobe Breite (Helvetica): Ziffern 0,556 em, sonst Mittelwert
  static width(s, size) { let w = 0; for (const ch of String(s)) w += (/\d/.test(ch) ? 0.556 : /[il.,:;|' ]/.test(ch) ? 0.28 : /[mwMW]/.test(ch) ? 0.85 : /[A-Z]/.test(ch) ? 0.68 : 0.53) * size; return w; }

  // files: [{ name, data (string|Buffer), mime, desc }] werden als eingebettete Dateien angehängt
  toBuffer(title = 'Fewo-Kalender', files = []) {
    const objs = [];
    const add = s => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesId = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    // Bilder als XObjects; Transparenz von PNG über eine Graustufen-Maske (SMask)
    const imgIds = this.images.map(im => {
      const bin = d => d.toString('latin1');
      if (im.kind === 'jpeg') return add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.comps === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n${bin(im.data)}\nendstream`);
      const sm = im.alpha ? add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${im.alpha.length} >>\nstream\n${bin(im.alpha)}\nendstream`) : 0;
      return add(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${sm ? ` /SMask ${sm} 0 R` : ''} /Length ${im.data.length} >>\nstream\n${bin(im.data)}\nendstream`);
    });
    const xobj = imgIds.length ? ` /XObject << ${imgIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >>` : '';
    const kids = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const len = Buffer.byteLength(stream, 'latin1');
      const c = add(`<< /Length ${len} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.W} ${this.H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xobj} >> /Contents ${c} 0 R >>`));
    }
    const specs = files.map(f => {
      const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
      const ef = add(`<< /Type /EmbeddedFile /Subtype /${f.mime.replace('/', '#2F')} /Length ${data.length} /Params << /Size ${data.length} >> >>\nstream\n${data.toString('latin1')}\nendstream`);
      return add(`<< /Type /Filespec /F (${encodeText(f.name)}) /UF (${encodeText(f.name)}) /Desc (${encodeText(f.desc || f.name)}) /AFRelationship /Alternative /EF << /F ${ef} 0 R /UF ${ef} 0 R >> >>`);
    });
    const names = specs.length ? ` /Names << /EmbeddedFiles << /Names [${files.map((f, i) => `(${encodeText(f.name)}) ${specs[i]} 0 R`).join(' ')}] >> >> /AF [${specs.map(sp => `${sp} 0 R`).join(' ')}]` : '';
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${names} >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title (${encodeText(title)}) /Producer (Fewo-Kalender) >>`);
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}
