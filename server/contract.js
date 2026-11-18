// Mietvertrag für Direktgäste als PDF, gefüllt aus den Daten der Rechnung (bzw. des Rechnungsentwurfs).
// Feste Vertragstexte (Leistungen, Klauseln) und die Beschreibung je Wohnung kommen aus den Einstellungen.

import { PdfDoc } from './pdf.js';
import { de, eur, totals, paymentSchedule } from './invoices.js';

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const deWd = d => `${WD[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${de(d)}`;
const nightsOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const qty = v => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','));

export const BANK_MARK = '[Bankverbindung]';

export const DEFAULT_CONTRACT = () => ({
  place: 'Immenstaad',
  attachTerms: true,
  confirmText: 'Mit Ihrer Anzahlung bzw. Zahlung bestätigen Sie die Buchung und erkennen die beigefügten Mietbedingungen an.',
  checkIn: '15:00', checkOut: '10:00',
  included: 'Der Preis ist inklusive Endreinigung, Bettwäsche und 2 Satz Handtücher/Woche. Dem Mieter werden 1 oder 2 Kombischlüssel mit Zugang zu Haus und Wohnung übergeben.',
  paymentNote: 'Der Vermieter behält sich vor, im Falle nicht rechtzeitiger Zahlungen vom Mietvertrag zurückzutreten. Der Vermieter ist dann berechtigt, eine Entschädigung geltend zu machen.',
  defaultDescription: 'im Kapellenweg 7, 88090 Immenstaad (70 m², Wohnzimmer mit 2 Schrankbetten, Schlafzimmer, Bad/WC, WC extra, TV, Küchenzeile mit Herd, Mikrowelle, Spülmaschine, Kühlschrank mit kleinem Gefrierfach, Balkon: 2,7 x 5,0 m, Teilseesicht und Bergsicht), Nichtraucherwohnung, keine Tiere (allergikerfreundlich)',
  apartments: {},
  clauses: [
    { title: 'An- und Abreise', text: 'Die Anreise ist zwischen 14 und 15 Uhr möglich, bei späterer Anreise bitte 2 Tage vorher telefonisch absprechen, um lange Wartezeiten bei Ihrem Einzug zu vermeiden. Am Abreisetag ist die Wohnung bis 10 Uhr persönlich zu übergeben.' },
    { title: 'Rücktritt', text: 'Bei Rücktritt oder Nichtanreise des Gastes sind 90 % des Mietpreises zu bezahlen, falls die Wohnung nicht weitervermietet werden kann. Eine Reiserücktrittsversicherung wird dringend empfohlen.' },
    { title: 'Sorgfaltspflichten', text: 'Die Mieter haben die Mieträumlichkeiten und die Einrichtungsgegenstände pfleglich zu behandeln. Schuldhaft verursachte Schäden haben die Mieter zu ersetzen. Die Mieter sind verpflichtet, bei Bezug der Räumlichkeiten die Einrichtung auf ihre Vollständigkeit und ihre Gebrauchstauglichkeit hin zu überprüfen und Beanstandungen unverzüglich gegenüber dem Vermieter geltend zu machen. Während der Mietzeit eintretende Schäden haben die Mieter ebenfalls unverzüglich zu melden. Kommen die Mieter diesen Pflichten nicht nach, steht ihnen eine Mietminderung wegen dieser zu beanstandenden Punkte nicht zu.' },
    { title: 'Hausordnung', text: 'Die Mieter sind verpflichtet, sich an die Hausordnung zu halten. Die Hausordnung liegt in den angemieteten Räumlichkeiten aus.' },
    { title: 'Bankverbindung des Vermieters', text: BANK_MARK },
    { title: 'Haftung', text: 'Schadenersatzansprüche sind unabhängig von der Art der Pflichtverletzung ausgeschlossen, soweit nicht vorsätzliches oder grob fahrlässiges Handeln vorliegt. Dies gilt auch für unerlaubte Handlungen. Bei der Verletzung wesentlicher Vertragspflichten haftet der Vermieter für jede Fahrlässigkeit, jedoch nur bis zur Höhe des vorhersehbaren Schadens. Soweit die Haftung ausgeschlossen oder beschränkt ist, gilt dies auch für Organe, Angestellte und Arbeitnehmer sowie für Vertreter und Erfüllungsgehilfen.' },
    { title: 'Salvatorische Klausel', text: 'Sollten einzelne Bestimmungen dieses Vertrages ganz oder teilweise unwirksam sein oder werden oder sollte sich in dem Vertrag eine Lücke befinden, so soll hierdurch die Gültigkeit der übrigen Bestimmungen nicht berührt werden. Anstelle der unwirksamen Bestimmung oder zur Ausfüllung der Lücke soll eine angemessene Regelung treten, die, soweit rechtlich möglich, dem am nächsten kommt, was die Vertragsparteien gewollt haben oder nach dem Sinn und Zweck dieses Vertrages gewollt haben würden, wenn sie den Punkt bedacht hätten.' },
  ],
});

const t = (v, n) => String(v ?? '').slice(0, n).trim();
const timeOk = v => /^([01]?\d|2[0-3]):[0-5]\d$/.test(v);

/** Eingaben aus der Einstellungsmaske prüfen und übernehmen. */
export function cleanContract(b, prev) {
  const out = structuredClone(prev);
  for (const k of ['place']) if (b[k] !== undefined) out[k] = t(b[k], 60);
  for (const k of ['checkIn', 'checkOut']) if (b[k] !== undefined) { const v = t(b[k], 5); if (!timeOk(v)) throw new Error('Uhrzeit bitte als HH:MM eingeben'); out[k] = v; }
  if (b.attachTerms !== undefined) out.attachTerms = !!b.attachTerms;
  for (const k of ['included', 'paymentNote', 'defaultDescription', 'confirmText']) if (b[k] !== undefined) out[k] = t(b[k], 2000);
  if (b.apartments) for (const [name, v] of Object.entries(b.apartments)) {
    const cur = out.apartments[name] || { label: '', description: '' };
    if (v.label !== undefined) cur.label = t(v.label, 60);
    if (v.description !== undefined) cur.description = t(v.description, 2000);
    out.apartments[t(name, 60)] = cur;
  }
  if (Array.isArray(b.clauses)) out.clauses = b.clauses.slice(0, 20).map(c => ({ title: t(c.title, 80), text: t(c.text, 4000) })).filter(c => c.title || c.text);
  return out;
}

function wrap(text, width, size) {
  const out = [];
  for (const para of String(text).split(/\n/)) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const x = line ? `${line} ${w}` : w;
      if (PdfDoc.width(x, size) > width && line) { out.push(line); line = w; } else line = x;
    }
    out.push(line);
  }
  return out;
}

/**
 * Mietbedingungen als zusätzliche Seite(n) an die Rechnung anhängen (Bestätigung durch Anzahlung statt Unterschrift).
 * Preise, Personen und Zahlungstermine stehen schon auf der Rechnung; hier stehen Mietobjekt, Zeiten und die Klauseln.
 */
export function appendTerms(doc, inv, S, C) {
  const sl = inv.status === 'entwurf' ? S.seller : inv.seller;
  const L = 56, R = 539, W = R - L;
  doc.newPage();
  let y = 70;
  const need = h => { if (y + h > 745) { doc.newPage(); y = 60; } };
  const para = (text, { size = 8.5, bold = false } = {}) => { for (const l of wrap(text, W, size)) { need(size + 4); doc.text(L, y, l, { size, bold }); y += size + 2.6; } };
  let no = 0;
  const head = title => { y += 5; need(34); no++; doc.text(L, y, `${no}. ${title}`, { size: 9.5, bold: true }); y += 12.5; };
  doc.text(L, y, 'Mietbedingungen', { size: 16, bold: true }); y += 16;
  doc.text(L, y, `zur Rechnung ${inv.number || '(Entwurf)'} · ${inv.buyer.name} · ${de(inv.from)} bis ${de(inv.to)}`, { size: 8.5, color: '#5f6863' }); y += 10;
  const apt = C.apartments?.[inv.aptName] || {};
  head('Mietgegenstand');
  para(`Vermietet wird die Ferienwohnung ${apt.label || inv.aptName || ''} ${apt.description || C.defaultDescription}`.replace(/\s+/g, ' '));
  head('Mietdauer');
  para(`vom ${deWd(inv.from)}, ${C.checkIn} Uhr, bis zum ${deWd(inv.to)}, ${C.checkOut} Uhr.`);
  if (C.included) { head('Leistungen'); para(C.included); }
  head('Zahlung');
  para(`Die Zahlungstermine stehen auf der Rechnung. ${C.paymentNote || ''}`.trim());
  if (C.confirmText) para(C.confirmText, { bold: true });
  for (const c of C.clauses || []) {
    head(c.title);
    if (c.text.includes(BANK_MARK)) {
      const bank = [sl.bank && `Name der Bank: ${sl.bank}`, sl.iban && `IBAN: ${sl.iban.replace(/(.{4})/g, '$1 ').trim()}`, sl.bic && `BIC: ${sl.bic}`].filter(Boolean);
      for (const l of bank) para(l);
      const rest = c.text.replace(BANK_MARK, '').trim();
      if (rest) para(rest);
    } else para(c.text);
  }
}

/**
 * Mietvertrag erzeugen.
 * inv: Rechnung oder Entwurf; S: aktuelle Rechnungseinstellungen (für Entwurf: Vermieterdaten, Zahlungsplan);
 * C: Vertragseinstellungen; opts: { logo, today }
 */
export function contractPdf(inv, S, C, { logo = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const draft = inv.status === 'entwurf';
  const sl = draft ? S.seller : inv.seller;
  const sched = draft ? paymentSchedule(S, inv, today) : inv.schedule || [];
  const T = draft ? totals(inv.items, inv.deposit) : inv.totals;
  const doc = new PdfDoc({ width: 595, height: 842 });
  const L = 62, R = 533, W = R - L, MUTED = '#5f6863', LINE = '#c9d0cc';
  let y = 56;
  const need = h => { if (y + h > 790) { doc.newPage(); y = 60; } };
  const para = (text, { size = 9.5, bold = false, color, indent = 0, gap = 3 } = {}) => {
    for (const l of wrap(text, W - indent, size)) { need(size + 4); doc.text(L + indent, y, l, { size, bold, color }); y += size + gap; }
  };
  let no = 0;
  const head = title => { y += 8; need(40); no++; doc.text(L, y, `${no}. ${title}`, { size: 10.5, bold: true }); y += 15; };

  if (logo) { const sz = doc.image(logo, R - 120, 28, 120, 70); y = Math.max(y, 28 + sz.h - 10); }
  doc.text(L, y + 20, 'Mietvertrag', { size: 20, bold: true }); y += 30;
  if (inv.number) doc.text(L, y + 4, `zu Rechnung ${inv.number}`, { size: 8.5, color: MUTED });
  y += 24;

  // Vertragsparteien
  const left = [sl.name, sl.street, `${sl.zip} ${sl.city}`.trim(), sl.phone && `Telefon: ${sl.phone}`, sl.mobile && `Mobil: ${sl.mobile}`].filter(Boolean);
  const b = inv.buyer;
  const right = [b.name, b.street, `${b.zip} ${b.city}`.trim(), b.country && b.country !== 'DE' ? b.country : '', b.phone && `Telefon: ${b.phone}`, b.email && `E-Mail: ${b.email}`].filter(Boolean);
  doc.text(L, y, 'Zwischen', { size: 9.5, color: MUTED }); y += 16;
  const top = y;
  left.forEach((l, i) => doc.text(L, top + i * 13, l, { size: 10, bold: i === 0 }));
  doc.text(L + 215, top + 13, 'und', { size: 10, color: MUTED });
  right.forEach((l, i) => doc.text(L + 270, top + i * 13, l, { size: 10, bold: i === 0 }));
  y = top + Math.max(left.length, right.length) * 13 + 10;
  doc.text(L, y, 'wird folgender Mietvertrag geschlossen:', { size: 9.5 }); y += 6;

  // 1. Mietgegenstand
  const apt = C.apartments?.[inv.aptName] || {};
  head('Mietgegenstand');
  para(`Vermietet wird die Ferienwohnung ${apt.label || inv.aptName || ''} ${apt.description || C.defaultDescription}`.replace(/\s+/g, ' '));

  // 2. Mietdauer
  head('Mietdauer');
  const ages = inv.input?.adults != null ? inv.input.childAges || [] : (inv.input?.ages || []).filter(a => a <= 17);
  const adults = inv.input?.adults != null ? inv.input.adults : (inv.input?.ages || []).filter(a => a > 17).length;
  const persons = `${adults} Erwachsene${ages.length ? `, ${ages.length} ${ages.length === 1 ? 'Kind' : 'Kinder'} (Alter: ${ages.join(', ')})` : ''}`;
  para(`Die Räumlichkeiten werden vermietet an ${persons}`);
  para(`vom ${deWd(inv.from)}, ${C.checkIn} Uhr, bis zum ${deWd(inv.to)}, ${C.checkOut} Uhr (${nightsOf(inv.from, inv.to)} Nächte).`, { bold: true });

  // 3. Miete: Positionen wie auf der Rechnung
  head('Miete');
  const cols = { text: L, qty: L + 290, price: L + 370, sum: R };
  const right_ = (x, yy, s, o = {}) => doc.text(x - PdfDoc.width(s, o.size || 9), yy, s, { size: 9, ...o });
  need(16);
  doc.text(cols.text, y, 'Leistung', { size: 8, bold: true, color: MUTED }); right_(cols.qty + 30, y, 'Menge', { size: 8, bold: true, color: MUTED });
  right_(cols.price + 50, y, 'Einzelpreis', { size: 8, bold: true, color: MUTED }); right_(cols.sum, y, 'Gesamt', { size: 8, bold: true, color: MUTED });
  y += 5; doc.stroke(LINE, 0.5).line(L, y, R, y); y += 12;
  for (const it of inv.items) {
    const lines = wrap(it.text, 280, 9);
    need(lines.length * 11 + 4);
    lines.forEach((l, i) => doc.text(cols.text, y + i * 11, l, { size: 9 }));
    right_(cols.qty + 30, y, `${qty(it.qty)} ${it.unit}`.trim()); right_(cols.price + 50, y, eur(it.price)); right_(cols.sum, y, eur(Math.round(it.qty * it.price * 100) / 100));
    y += lines.length * 11 + 3;
  }
  doc.stroke(LINE, 0.5).line(L + 260, y - 4, R, y - 4); y += 8;
  doc.text(L + 260, y, 'Gesamtbetrag', { size: 10, bold: true }); right_(R, y, eur(T.gross), { size: 10, bold: true }); y += 14;
  if (T.deposit) { doc.text(L + 260, y, 'bereits erhalten', { size: 9 }); right_(R, y, eur(-T.deposit)); y += 12; doc.text(L + 260, y, 'noch zu zahlen', { size: 9.5, bold: true }); right_(R, y, eur(T.due), { size: 9.5, bold: true }); y += 14; }
  doc.text(L, y, 'Alle Preise inklusive Umsatzsteuer; die Kurtaxe ist nicht umsatzsteuerpflichtig.', { size: 8, color: MUTED }); y += 14;
  if (C.included) para(C.included);

  // 4. Zahlungsweise
  head('Zahlungsweise');
  if (sched.length) for (const p of sched) para(`${p.label}: ${eur(p.amount)} bis spätestens ${de(p.dueDate)}`, { bold: true });
  else if (T.due <= 0) para('Der Mietpreis ist vollständig bezahlt.');
  para(`Bitte überweisen Sie auf das unten genannte Konto${inv.number ? ` mit dem Verwendungszweck ${inv.number}` : ''}. ${C.paymentNote || ''}`.trim());

  // weitere Klauseln
  for (const c of C.clauses || []) {
    head(c.title);
    if (c.text.includes(BANK_MARK)) {
      const bank = [sl.bank && `Name der Bank: ${sl.bank}`, sl.accountHolder && `Kontoinhaber: ${sl.accountHolder}`, sl.iban && `IBAN: ${sl.iban.replace(/(.{4})/g, '$1 ').trim()}`, sl.bic && `BIC: ${sl.bic}`].filter(Boolean);
      for (const l of bank.length ? bank : ['(Bankverbindung bitte unter „Vermieterdaten und Preise“ eintragen)']) para(l, { bold: bank.length > 0 });
      const rest = c.text.replace(BANK_MARK, '').trim();
      if (rest) para(rest);
    } else para(c.text);
  }

  // Unterschriften
  y += 28; need(110);
  const sig = (x, place, date, who) => {
    doc.text(x, y, `${place || '____________________'}, den ${date || '____________'}`, { size: 9.5 });
    doc.stroke('#1d2420', 0.5).line(x, y + 42, x + 200, y + 42);
    doc.text(x, y + 54, who, { size: 8.5, color: MUTED });
  };
  sig(L, C.place, de(inv.date || today), '(Vermieter)');
  sig(L + 260, '', '', '(Mieter)');
  // Fußzeile
  doc.pages.forEach((p, i) => { doc.cur = p; doc.text(L, 815, `Mietvertrag ${b.name}, ${de(inv.from)} bis ${de(inv.to)}`, { size: 7, color: MUTED }); doc.text(R - 40, 815, `Seite ${i + 1}/${doc.pages.length}`, { size: 7, color: MUTED }); });
  return doc.toBuffer(`Mietvertrag ${b.name}`);
}
