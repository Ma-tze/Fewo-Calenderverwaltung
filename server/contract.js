// Mietbedingungen (Anhang der Rechnung) und Mietvertrag (Papierversion) aus den Daten der Rechnung.
// Beide Vorlagen sind Listen von Abschnitten { title, text } und vollständig in der Maske änderbar.
// Platzhalter im Text werden beim Erzeugen ersetzt (siehe PLACEHOLDERS).

import { PdfDoc } from './pdf.js';
import { de, eur, totals, paymentSchedule } from './invoices.js';

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const deWd = d => `${WD[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${de(d)}`;
const nightsOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const qty = v => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','));

// Platzhalter: [Name] im Text. Blöcke stehen allein in einer Zeile und werden als eigener Absatz gesetzt.
export const PLACEHOLDERS = {
  '[Wohnung]': 'Bezeichnung und Beschreibung der Wohnung',
  '[Personen]': 'z. B. 2 Erwachsene, 2 Kinder (Alter: 10, 12)',
  '[Anreise]': 'Wochentag, Datum und Uhrzeit der Anreise',
  '[Abreise]': 'Wochentag, Datum und Uhrzeit der Abreise',
  '[Nächte]': 'Anzahl der Nächte',
  '[Gesamtbetrag]': 'Gesamtbetrag der Rechnung',
  '[Rechnungsnummer]': 'Nummer der Rechnung (im Entwurf: „wird noch vergeben“)',
  '[Preistabelle]': 'Block: alle Positionen mit Preisen und Gesamtbetrag',
  '[Zahlungstermine]': 'Block: Anzahlung und Restzahlung mit Terminen',
  '[Bankverbindung]': 'Block: Bank, IBAN und BIC',
  '[Besondere Vereinbarungen]': 'Text aus dem Feld „Besondere Vereinbarungen“ der Rechnung (leer = Zeile entfällt)',
};
export const BANK_MARK = '[Bankverbindung]';
const BLOCKS = ['[Preistabelle]', '[Zahlungstermine]', '[Bankverbindung]'];

const RULES = [
  { title: 'An- und Abreise', text: 'Die Anreise ist zwischen 14 und 15 Uhr möglich, bei späterer Anreise bitte 2 Tage vorher telefonisch absprechen, um lange Wartezeiten bei Ihrem Einzug zu vermeiden. Am Abreisetag ist die Wohnung bis 10 Uhr persönlich zu übergeben.' },
  { title: 'Rücktritt', text: 'Bei Rücktritt oder Nichtanreise des Gastes sind 90 % des Mietpreises zu bezahlen, falls die Wohnung nicht weitervermietet werden kann. Eine Reiserücktrittsversicherung wird dringend empfohlen.' },
  { title: 'Sorgfaltspflichten', text: 'Die Mieter haben die Mieträumlichkeiten und die Einrichtungsgegenstände pfleglich zu behandeln. Schuldhaft verursachte Schäden haben die Mieter zu ersetzen. Die Mieter sind verpflichtet, bei Bezug der Räumlichkeiten die Einrichtung auf ihre Vollständigkeit und ihre Gebrauchstauglichkeit hin zu überprüfen und Beanstandungen unverzüglich gegenüber dem Vermieter geltend zu machen. Während der Mietzeit eintretende Schäden haben die Mieter ebenfalls unverzüglich zu melden. Kommen die Mieter diesen Pflichten nicht nach, steht ihnen eine Mietminderung wegen dieser zu beanstandenden Punkte nicht zu.' },
  { title: 'Hausordnung', text: 'Die Mieter sind verpflichtet, sich an die Hausordnung zu halten. Die Hausordnung liegt in den angemieteten Räumlichkeiten aus.' },
  { title: 'Bankverbindung des Vermieters', text: '[Bankverbindung]' },
  { title: 'Haftung', text: 'Schadenersatzansprüche sind unabhängig von der Art der Pflichtverletzung ausgeschlossen, soweit nicht vorsätzliches oder grob fahrlässiges Handeln vorliegt. Dies gilt auch für unerlaubte Handlungen. Bei der Verletzung wesentlicher Vertragspflichten haftet der Vermieter für jede Fahrlässigkeit, jedoch nur bis zur Höhe des vorhersehbaren Schadens. Soweit die Haftung ausgeschlossen oder beschränkt ist, gilt dies auch für Organe, Angestellte und Arbeitnehmer sowie für Vertreter und Erfüllungsgehilfen.' },
  { title: 'Salvatorische Klausel', text: 'Sollten einzelne Bestimmungen dieses Vertrages ganz oder teilweise unwirksam sein oder werden oder sollte sich in dem Vertrag eine Lücke befinden, so soll hierdurch die Gültigkeit der übrigen Bestimmungen nicht berührt werden. Anstelle der unwirksamen Bestimmung oder zur Ausfüllung der Lücke soll eine angemessene Regelung treten, die, soweit rechtlich möglich, dem am nächsten kommt, was die Vertragsparteien gewollt haben oder nach dem Sinn und Zweck dieses Vertrages gewollt haben würden, wenn sie den Punkt bedacht hätten.' },
];
const INCLUDED = 'Der Preis ist inklusive Endreinigung, Bettwäsche und 2 Satz Handtücher/Woche. Dem Mieter werden 1 oder 2 Kombischlüssel mit Zugang zu Haus und Wohnung übergeben.';
const RESERVE = 'Der Vermieter behält sich vor, im Falle nicht rechtzeitiger Zahlungen vom Mietvertrag zurückzutreten. Der Vermieter ist dann berechtigt, eine Entschädigung geltend zu machen.';

export const DEFAULT_TERMS_INVOICE = () => [
  { title: 'Mietgegenstand', text: 'Vermietet wird die Ferienwohnung [Wohnung].' },
  { title: 'Mietdauer', text: 'vom [Anreise] bis zum [Abreise] ([Nächte] Nächte) für [Personen].' },
  { title: 'Leistungen', text: INCLUDED },
  { title: 'Zahlung', text: `Die Zahlungstermine stehen auf der Rechnung [Rechnungsnummer]. ${RESERVE}\nMit Ihrer Anzahlung bzw. Zahlung bestätigen Sie die Buchung und erkennen diese Mietbedingungen an.` },
  { title: 'Besondere Vereinbarungen', text: '[Besondere Vereinbarungen]' },
  ...RULES.map(r => ({ ...r })),
];

export const DEFAULT_TERMS_CONTRACT = () => [
  { title: 'Mietgegenstand', text: 'Vermietet wird die Ferienwohnung [Wohnung].' },
  { title: 'Mietdauer', text: 'Die Räumlichkeiten werden vermietet an [Personen]\nvom [Anreise] bis zum [Abreise] ([Nächte] Nächte).' },
  { title: 'Miete', text: `[Preistabelle]\n${INCLUDED}` },
  { title: 'Zahlungsweise', text: `[Zahlungstermine]\nBitte überweisen Sie auf das unten genannte Konto. ${RESERVE}` },
  { title: 'Besondere Vereinbarungen', text: '[Besondere Vereinbarungen]' },
  ...RULES.map(r => ({ ...r })),
];

export const DEFAULT_CONTRACT = () => ({
  place: 'Immenstaad',
  attachTerms: true,
  confirmText: 'Mit Ihrer Anzahlung bzw. Zahlung bestätigen Sie die Buchung und erkennen die beigefügten Mietbedingungen an.',
  checkIn: '15:00', checkOut: '10:00',
  defaultDescription: 'im Kapellenweg 7, 88090 Immenstaad (70 m², Wohnzimmer mit 2 Schrankbetten, Schlafzimmer, Bad/WC, WC extra, TV, Küchenzeile mit Herd, Mikrowelle, Spülmaschine, Kühlschrank mit kleinem Gefrierfach, Balkon: 2,7 x 5,0 m, Teilseesicht und Bergsicht), Nichtraucherwohnung, keine Tiere (allergikerfreundlich)',
  apartments: {},
  termsInvoice: DEFAULT_TERMS_INVOICE(),
  termsContract: DEFAULT_TERMS_CONTRACT(),
});

/** Gespeicherte Einstellungen vervollständigen (auch Übernahme der ersten Fassung mit einer gemeinsamen Klauselliste). */
export function ensureContract(cur = {}) {
  const C = { ...DEFAULT_CONTRACT(), ...cur };
  if (!cur.termsContract && Array.isArray(cur.clauses)) {
    const rules = cur.clauses.map(c => ({ title: c.title, text: c.text }));
    C.termsInvoice = [...DEFAULT_TERMS_INVOICE().slice(0, 5), ...rules];
    C.termsContract = [...DEFAULT_TERMS_CONTRACT().slice(0, 5), ...rules];
  }
  delete C.clauses; delete C.included; delete C.paymentNote;
  return C;
}

const t = (v, n) => String(v ?? '').slice(0, n).trim();
const timeOk = v => /^([01]?\d|2[0-3]):[0-5]\d$/.test(v);
const cleanList = list => list.slice(0, 30).map(c => ({ title: t(c.title, 80), text: t(c.text, 5000) })).filter(c => c.title || c.text);

/** Eingaben aus der Einstellungsmaske prüfen und übernehmen. */
export function cleanContract(b, prev) {
  const out = structuredClone(prev);
  if (b.place !== undefined) out.place = t(b.place, 60);
  for (const k of ['checkIn', 'checkOut']) if (b[k] !== undefined) { const v = t(b[k], 5); if (!timeOk(v)) throw new Error('Uhrzeit bitte als HH:MM eingeben'); out[k] = v; }
  for (const k of ['defaultDescription', 'confirmText']) if (b[k] !== undefined) out[k] = t(b[k], 2000);
  if (b.attachTerms !== undefined) out.attachTerms = !!b.attachTerms;
  if (b.apartments) for (const [name, v] of Object.entries(b.apartments)) {
    const cur = out.apartments[t(name, 60)] || { label: '', description: '' };
    if (v.label !== undefined) cur.label = t(v.label, 60);
    if (v.description !== undefined) cur.description = t(v.description, 2000);
    out.apartments[t(name, 60)] = cur;
  }
  if (Array.isArray(b.termsInvoice)) out.termsInvoice = cleanList(b.termsInvoice);
  if (Array.isArray(b.termsContract)) out.termsContract = cleanList(b.termsContract);
  return out;
}

/** Stand der Vorlagen beim Festschreiben, damit ein später gedruckter Vertrag die damaligen Bedingungen zeigt. */
export function termsSnapshot(C, aptName) {
  const apt = C.apartments?.[aptName] || {};
  return { place: C.place, checkIn: C.checkIn, checkOut: C.checkOut, apt: { label: apt.label || '', description: apt.description || C.defaultDescription },
    termsInvoice: structuredClone(C.termsInvoice), termsContract: structuredClone(C.termsContract) };
}

function wrap(text, width, size) {
  const out = [];
  let line = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const x = line ? `${line} ${w}` : w;
    if (PdfDoc.width(x, size) > width && line) { out.push(line); line = w; } else line = x;
  }
  if (line) out.push(line);
  return out;
}

// Daten für die Platzhalter
function context(inv, S, C, today) {
  const draft = inv.status === 'entwurf';
  const snap = !draft && inv.terms ? inv.terms : null;
  const base = snap ? { ...C, ...snap } : C;
  const aptCfg = snap ? snap.apt : (() => { const a = C.apartments?.[inv.aptName] || {}; return { label: a.label || '', description: a.description || C.defaultDescription }; })();
  const kids = inv.input?.adults != null ? inv.input.childAges || [] : (inv.input?.ages || []).filter(a => a <= 17);
  const adults = inv.input?.adults != null ? inv.input.adults : (inv.input?.ages || []).filter(a => a > 17).length;
  const T = draft ? totals(inv.items, inv.deposit) : inv.totals;
  return {
    sl: draft ? S.seller : inv.seller, base, T,
    sched: draft ? paymentSchedule(S, inv, today) : inv.schedule || [],
    vals: {
      '[Wohnung]': `${aptCfg.label || inv.aptName || ''} ${aptCfg.description || ''}`.replace(/\s+/g, ' ').trim(),
      '[Personen]': `${adults} Erwachsene${kids.length ? `, ${kids.length} ${kids.length === 1 ? 'Kind' : 'Kinder'} (Alter: ${kids.join(', ')})` : ''}`,
      '[Anreise]': `${deWd(inv.from)}, ${base.checkIn} Uhr`,
      '[Abreise]': `${deWd(inv.to)}, ${base.checkOut} Uhr`,
      '[Nächte]': String(nightsOf(inv.from, inv.to)),
      '[Gesamtbetrag]': eur(T.gross),
      '[Rechnungsnummer]': inv.number || '(Nummer wird beim Festschreiben vergeben)',
      '[Besondere Vereinbarungen]': inv.input?.special || '',
    },
  };
}

// Abschnitte setzen; leere Abschnitte (z. B. ohne besondere Vereinbarungen) entfallen samt Überschrift
function renderSections(doc, sections, ctx, inv, { L, R, top, bottom, size = 9, headSize = 10, y }) {
  const W = R - L, MUTED = '#5f6863', LINE = '#c9d0cc';
  const need = h => { if (y + h > bottom) { doc.newPage(); y = top; } };
  const para = (text, bold = false) => { for (const l of wrap(text, W, size)) { need(size + 4); doc.text(L, y, l, { size, bold }); y += size + 3; } };
  const right = (x, yy, s, o = {}) => doc.text(x - PdfDoc.width(s, o.size || size), yy, s, { size, ...o });
  const block = name => {
    const { sl, sched, T } = ctx;
    if (name === '[Bankverbindung]') {
      const bank = [sl.bank && `Name der Bank: ${sl.bank}`, sl.accountHolder && `Kontoinhaber: ${sl.accountHolder}`, sl.iban && `IBAN: ${sl.iban.replace(/(.{4})/g, '$1 ').trim()}`, sl.bic && `BIC: ${sl.bic}`].filter(Boolean);
      for (const l of bank.length ? bank : ['(Bankverbindung bitte unter „Vermieterdaten und Preise“ eintragen)']) para(l, bank.length > 0);
    } else if (name === '[Zahlungstermine]') {
      if (sched.length) for (const p of sched) para(`${p.label}: ${eur(p.amount)} bis spätestens ${de(p.dueDate)}`, true);
      else para(T.due <= 0 ? 'Der Mietpreis ist vollständig bezahlt.' : `Gesamtbetrag: ${eur(T.due)}`, true);
    } else if (name === '[Preistabelle]') {
      const c = { qty: L + 320, price: L + 400 };
      need(16);
      doc.text(L, y, 'Leistung', { size: 8, bold: true, color: MUTED }); right(c.qty, y, 'Menge', { size: 8, bold: true, color: MUTED });
      right(c.price, y, 'Einzelpreis', { size: 8, bold: true, color: MUTED }); right(R, y, 'Gesamt', { size: 8, bold: true, color: MUTED });
      y += 5; doc.stroke(LINE, 0.5).line(L, y, R, y); y += 12;
      for (const it of inv.items) {
        const lines = wrap(it.text, 250, size);
        need(lines.length * 11 + 4);
        lines.forEach((l, i) => doc.text(L, y + i * 11, l, { size }));
        right(c.qty, y, `${qty(it.qty)} ${it.unit}`.trim()); right(c.price, y, eur(it.price)); right(R, y, eur(Math.round(it.qty * it.price * 100) / 100));
        y += lines.length * 11 + 3;
      }
      doc.stroke(LINE, 0.5).line(L + 260, y - 4, R, y - 4); y += 8;
      doc.text(L + 260, y, 'Gesamtbetrag', { size: size + 1, bold: true }); right(R, y, eur(T.gross), { size: size + 1, bold: true }); y += 14;
      if (T.deposit) { doc.text(L + 260, y, 'bereits erhalten', { size }); right(R, y, eur(-T.deposit)); y += 12; doc.text(L + 260, y, 'noch zu zahlen', { size, bold: true }); right(R, y, eur(T.due), { bold: true }); y += 14; }
      doc.text(L, y, 'Alle Preise inklusive Umsatzsteuer; die Kurtaxe ist nicht umsatzsteuerpflichtig.', { size: 7.5, color: MUTED }); y += 13;
    }
  };
  let no = 0;
  for (const sec of sections) {
    let text = sec.text || '';
    for (const [k, v] of Object.entries(ctx.vals)) if (!BLOCKS.includes(k)) text = text.split(k).join(v);
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    y += 6; need(36); no++;
    if (sec.title) { doc.text(L, y, `${no}. ${sec.title}`, { size: headSize, bold: true }); y += headSize + 4; }
    for (const l of lines) {
      if (BLOCKS.includes(l)) block(l);
      else {
        // ein Block mitten im Satz: davor/danach als Absatz
        const parts = l.split(/(\[Preistabelle\]|\[Zahlungstermine\]|\[Bankverbindung\])/).map(p => p.trim()).filter(Boolean);
        for (const p of parts) BLOCKS.includes(p) ? block(p) : para(p);
      }
    }
  }
  return y;
}

/** Mietbedingungen als zusätzliche Seite(n) an die Rechnung anhängen. */
export function appendTerms(doc, inv, S, C, today = new Date().toISOString().slice(0, 10)) {
  const ctx = context(inv, S, C, today);
  doc.newPage();
  const L = 56, R = 539;
  doc.text(L, 70, 'Mietbedingungen', { size: 16, bold: true });
  doc.text(L, 86, `zur Rechnung ${inv.number || '(Entwurf)'} · ${inv.buyer.name} · ${de(inv.from)} bis ${de(inv.to)}`, { size: 8.5, color: '#5f6863' });
  renderSections(doc, ctx.base.termsInvoice || [], ctx, inv, { L, R, top: 60, bottom: 745, size: 8.5, headSize: 9.5, y: 96 });
}

/** Mietvertrag (Papierversion mit Unterschriften). */
export function contractPdf(inv, S, C, { logo = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const ctx = context(inv, S, C, today);
  const { sl, base } = ctx;
  const doc = new PdfDoc({ width: 595, height: 842 });
  const L = 62, R = 533, MUTED = '#5f6863';
  let y = 56;
  if (logo) { const sz = doc.image(logo, R - 120, 28, 120, 70); y = Math.max(y, 28 + sz.h - 10); }
  doc.text(L, y + 20, 'Mietvertrag', { size: 20, bold: true }); y += 30;
  if (inv.number) doc.text(L, y + 4, `zu Rechnung ${inv.number}`, { size: 8.5, color: MUTED });
  y += 24;
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
  y = renderSections(doc, base.termsContract || [], ctx, inv, { L, R, top: 60, bottom: 790, size: 9.5, headSize: 10.5, y });
  // Unterschriften
  y += 28; if (y + 80 > 790) { doc.newPage(); y = 80; }
  const sig = (x, place, date, who) => {
    doc.text(x, y, `${place || '____________________'}, den ${date || '____________'}`, { size: 9.5 });
    doc.stroke('#1d2420', 0.5).line(x, y + 42, x + 200, y + 42);
    doc.text(x, y + 54, who, { size: 8.5, color: MUTED });
  };
  sig(L, base.place, de(inv.date || today), '(Vermieter)');
  sig(L + 260, '', '', '(Mieter)');
  doc.pages.forEach((p, i) => { doc.cur = p; doc.text(L, 815, `Mietvertrag ${b.name}, ${de(inv.from)} bis ${de(inv.to)}`, { size: 7, color: MUTED }); doc.text(R - 40, 815, `Seite ${i + 1}/${doc.pages.length}`, { size: 7, color: MUTED }); });
  return doc.toBuffer(`Mietvertrag ${b.name}`);
}
