// Monatsübersicht als PDF (A4 quer): Raster Wohnungen x Tage, darunter die Liste der Buchungen.

import { PdfDoc } from './pdf.js';
import { addDays } from './ical.js';

const COLORS = { p1: '#5b6878', p2: '#2a72b0', p3: '#2b7d4c', p4: '#a0560f', p5: '#7046a8', p6: '#0f7479', p7: '#a33a33', p8: '#66721a' };
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const SAT = '#f3dfb3', SATLINE = '#c08a1e';
const FG = '#1d2420', MUTED = '#6b7570', GRID = '#c9d0cc', WEEKEND = '#eef1ef', SCHOOL = '#e9dcf5', HAUPT = '#f2b84b', NEBEN = '#cfe3c1';

const de = d => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const dey = d => `${de(d)}${d.slice(0, 4)}`;
const nights = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const wday = d => new Date(`${d}T12:00:00Z`).getUTCDay();

export function monthPdf(cal, ym, { contacts = true, doc: into = null } = {}) {
  const [Y, M] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const next = M === 12 ? `${Y + 1}-01-01` : `${Y}-${String(M + 1).padStart(2, '0')}-01`;
  const days = nights(first, next);
  const title = `Belegung ${MONTHS[M - 1]} ${Y}`;

  const doc = into ? into.newPage() : new PdfDoc();
  const startPage = doc.pages.length - 1;
  const L = 28, R = 842 - 28, labelW = 92;
  const dayW = (R - L - labelW) / days;
  const xOf = d => L + labelW + nights(first, d) * dayW;
  const clampX = d => Math.max(L + labelW, Math.min(R, xOf(d)));
  const stamp = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });

  const header = (cont) => {
    doc.text(L, 40, cont ? `${title} (Fortsetzung)` : title, { size: 18, bold: true });
    doc.text(R - 150, 40, `Stand ${stamp}`, { size: 8, color: MUTED });
  };
  header(false);

  // Kopfzeilen: Saison/Ferien-Bänder, Wochentag, Tag
  let y = 56;
  const inMonth = x => x.start < next && x.end > first;
  const bandRow = (items, colorOf, label) => {
    doc.text(L, y + 9, label, { size: 7, color: MUTED });
    for (const it of items.filter(inMonth)) {
      const x1 = clampX(it.start < first ? first : it.start), x2 = clampX(it.end > next ? next : it.end);
      doc.fill(colorOf(it)).rect(x1, y, x2 - x1, 12);
      doc.text(x1 + 2, y + 9, it.name, { size: 7, color: FG, clip: [x1, y, x2 - x1, 12] });
    }
    y += 14;
  };
  bandRow(cal.seasons || [], s => (s.kind === 'haupt' ? HAUPT : NEBEN), 'Saison');
  bandRow((cal.holidays || []).filter(h => h.kind === 'school'), () => SCHOOL, 'Schulferien');

  const publicDays = new Set();
  for (const h of (cal.holidays || []).filter(h => h.kind !== 'school')) for (let d = h.start; d < h.end; d = addDays(d, 1)) publicDays.add(d);

  const gridTop = y;
  // Zeilen hoch genug: Balken oben, darunter Platz für handschriftliche Ergänzungen
  const rowH = 46, barH = 18, headH = 22;
  const rowsH = headH + cal.apartments.length * rowH;
  // Wochenenden / Feiertage hinterlegen
  for (let i = 0; i < days; i++) {
    const d = addDays(first, i), w = wday(d);
    if (w === 6) doc.fill(SAT).rect(L + labelW + i * dayW, gridTop, dayW, rowsH);
    else if (w === 0 || publicDays.has(d)) doc.fill(WEEKEND).rect(L + labelW + i * dayW, gridTop, dayW, rowsH);
  }
  for (let i = 0; i < days; i++) {
    const d = addDays(first, i), x = L + labelW + i * dayW, w = wday(d);
    const red = publicDays.has(d) || w === 0;
    const wd = WD[w], dn = String(i + 1);
    doc.text(x + (dayW - PdfDoc.width(wd, 7)) / 2, gridTop + 9, wd, { size: 7, color: red ? '#b42318' : MUTED });
    doc.text(x + (dayW - PdfDoc.width(dn, 9)) / 2, gridTop + 19, dn, { size: 9, bold: true, color: red ? '#b42318' : FG });
  }
  // Raster
  doc.stroke(GRID, 0.4);
  for (let i = 0; i <= days; i++) { const x = L + labelW + i * dayW; doc.line(x, gridTop, x, gridTop + rowsH); }
  for (let r = 0; r <= cal.apartments.length; r++) doc.line(L, gridTop + headH + r * rowH, R, gridTop + headH + r * rowH);
  // Samstag = Wechseltag: kräftige Linie
  doc.stroke(SATLINE, 1.2);
  for (let i = 0; i < days; i++) if (wday(addDays(first, i)) === 6) { const x = L + labelW + i * dayW; doc.line(x, gridTop, x, gridTop + rowsH); }

  const monthEvents = cal.events.filter(e => e.start < next && e.end > first).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.apt - b.apt));
  cal.apartments.forEach((a, r) => {
    const top = gridTop + headH + r * rowH;
    doc.fill(COLORS[a.color] || '#5b6878').rect(L, top + 6, 4, rowH - 12);
    doc.stroke('#e2e6e3', 0.3).line(L + labelW, top + 4 + barH + 4, R, top + 4 + barH + 4);
    doc.text(L + 8, top + 13, a.name, { size: 9, bold: true });
    if (a.nick && a.nick !== a.name) doc.text(L + 8, top + 24, a.nick, { size: 8, color: MUTED, clip: [L, top, labelW - 4, rowH] });
    for (const e of monthEvents.filter(e => e.apt === a.id)) {
      // Anreise nachmittags, Abreise vormittags: Balken von Tagesmitte zu Tagesmitte
      const x1 = e.start < first ? L + labelW : xOf(e.start) + dayW / 2;
      const x2 = e.end > next ? R : xOf(e.end) + dayW / 2;
      const w = Math.max(4, Math.min(R, x2) - x1);
      doc.fill(COLORS[a.color] || '#5b6878').rect(x1, top + 4, w, barH);
      doc.text(x1 + 3, top + 4 + barH / 2 + 3, e.title || 'Belegt', { size: 8, bold: true, color: '#ffffff', clip: [x1, top + 4, w, barH] });
    }
  });
  y = gridTop + rowsH + 22;

  // Liste der Buchungen
  const cols = contacts
    ? [['Wohnung', 56], ['Anreise', 50], ['Abreise', 50], ['N.', 16], ['Name', 112], ['Reisende / Notiz', 130], ['Telefon', 100], ['E-Mail', 130], ['Kanal', 42], ['Ergänzungen', 100]]
    : [['Wohnung', 70], ['Anreise', 60], ['Abreise', 60], ['Nächte', 36], ['Name', 170], ['Reisende / Notiz', 200], ['Ergänzungen', 190]];
  const aptName = id => cal.apartments.find(a => a.id === id)?.name || '';
  const aptColor = id => COLORS[cal.apartments.find(a => a.id === id)?.color] || '#5b6878';
  const listHead = () => {
    doc.text(L, y, `Buchungen im ${MONTHS[M - 1]} (${monthEvents.length})`, { size: 11, bold: true });
    y += 8;
    doc.fill('#e4e9e6').rect(L, y, R - L, 14);
    let x = L;
    for (const [h, w] of cols) { doc.text(x + 3, y + 10, h, { size: 7.5, bold: true, color: MUTED }); x += w; }
    y += 14;
  };
  listHead();
  const lineH = 18; // Zeilenhöhe zum Beschreiben
  monthEvents.forEach((e, i) => {
    if (y + lineH > 595 - 30) { doc.newPage(); header(true); y = 66; listHead(); }
    if (i % 2) doc.fill('#f5f7f6').rect(L, y, R - L, lineH);
    doc.stroke(GRID, 0.3).line(L, y, R, y); doc.line(L, y + lineH, R, y + lineH);
    const ex = R - cols[cols.length - 1][1]; doc.line(ex, y, ex, y + lineH);
    const phone = [e.phone, e.mobile].filter(Boolean).join(' / ');
    const vals = contacts
      ? [aptName(e.apt), dey(e.start), dey(e.end), String(nights(e.start, e.end)), e.title, e.note, phone, e.email, e.channel || (e.source === 'Belegungsplan' ? 'Firma' : '')]
      : [aptName(e.apt), dey(e.start), dey(e.end), String(nights(e.start, e.end)), e.title, e.note];
    let x = L;
    vals.forEach((v, c) => {
      const w = cols[c][1];
      if (c === 0) doc.fill(aptColor(e.apt)).rect(x + 1, y + 3, 3, lineH - 6);
      doc.text(x + (c === 0 ? 7 : 3), y + 12, v || '', { size: 8, bold: c === 4, clip: [x, y, w - 2, lineH] });
      x += w;
    });
    y += lineH;
  });
  if (!monthEvents.length) { doc.text(L + 3, y + 12, 'Keine Buchungen in diesem Monat.', { size: 9, color: MUTED }); y += lineH; }

  // Notizfläche: liniert bis zum Seitenende, mindestens 4 Zeilen (sonst neue Seite)
  const bottom = 595 - 30, noteH = 22;
  if (y + 24 + 4 * noteH > bottom) { doc.newPage(); header(true); y = 56; } else y += 16;
  doc.text(L, y, 'Notizen', { size: 11, bold: true });
  y += 6;
  doc.stroke('#b9c1bc', 0.4);
  for (let ly = y + noteH; ly <= bottom; ly += noteH) doc.line(L, ly, R, ly);

  // Fußzeile
  const own = doc.pages.slice(startPage);
  own.forEach((p, i) => {
    doc.cur = p;
    doc.text(L, 595 - 14, `Fewo-Kalender · ${title}${contacts ? '' : ' · ohne Kontaktdaten'}`, { size: 7, color: MUTED });
    if (own.length > 1) doc.text(R - 40, 595 - 14, `Seite ${i + 1}/${own.length}`, { size: 7, color: MUTED });
  });
  if (into) return { doc };
  return { buffer: doc.toBuffer(title), filename: `Belegung-${ym}${contacts ? '' : '-Aushang'}.pdf` };
}

// Mehrere Monate in einem PDF (z. B. ein ganzes Jahr = 12 Monatsseiten), jeder Monat beginnt auf einer neuen Seite.
export function monthsPdf(cal, from, to, { contacts = true } = {}) {
  const list = [];
  for (let [y, m] = from.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= to; m === 12 ? (y++, m = 1) : m++) list.push(`${y}-${String(m).padStart(2, '0')}`);
  if (list.length === 1) return monthPdf(cal, from, { contacts });
  const doc = new PdfDoc();
  doc.pages.length = 0;
  for (const ym of list) monthPdf(cal, ym, { contacts, doc });
  const [fy, fm] = from.split('-').map(Number), [ty, tm] = to.split('-').map(Number);
  const year = fm === 1 && tm === 12 && fy === ty;
  const title = year ? `Belegung ${fy}` : `Belegung ${MONTHS[fm - 1]} ${fy} bis ${MONTHS[tm - 1]} ${ty}`;
  return { buffer: doc.toBuffer(title), filename: `Belegung-${year ? fy : `${from}-bis-${to}`}${contacts ? '' : '-Aushang'}.pdf` };
}
