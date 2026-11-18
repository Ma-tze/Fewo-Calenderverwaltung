// Rechnungen für Direktgäste: Preisbausteine, Berechnung, Nummernkreis, Festschreiben, Storno,
// Rechnungs-PDF, E-Rechnung (XRechnung, UN/CEFACT CII) und Umsatzsteuer-Bericht.
// Alle Preise werden brutto eingegeben (wie in der Vermietung üblich), die Umsatzsteuer wird herausgerechnet.

import { PdfDoc } from './pdf.js';
import { expandSeasons } from './holidays.js';
import { qrMatrix, epcPayload } from './qr.js';

const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const s = (v, n) => String(v ?? '').slice(0, n).trim();
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const nightsOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export const de = d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
export const eur = v => `${(v < 0 ? '-' : '')}${Math.abs(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €`;
const num = v => {
  if (v === '' || v == null) return 0;
  if (typeof v === 'number') return v;
  const t = String(v).replace(/\s|€/g, '');
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

/* ---------- Einstellungen ---------- */

export const DEFAULT_SETTINGS = () => ({
  seller: { name: '', street: '', zip: '', city: '', country: 'DE', phone: '', mobile: '', email: '', taxNumber: '', vatId: '', iban: '', bic: '', bank: '', accountHolder: '' },
  numberPrefix: 'R', counters: {}, logo: { enabled: false, file: '', name: '' }, paymentDays: 14, vatRate: 7, taxation: 'ist', footer: '',
  payment: { depositPercent: 0, depositDays: 7, depositIfDaysAhead: 30, restDaysBeforeArrival: 14 },
  pricing: { includedPersons: 2, extraAdult: 0, extraChild: 0, childMaxAge: 15, infantMaxAge: 2, cleaning: 0 },
  // Vorbelegung nach Kurtaxesatzung Immenstaad (6. Änderung, ab 01.01.2026)
  kurtaxe: { label: 'Kurtaxe', mainFrom: '04-01', mainTo: '10-31', groups: IMMENSTAAD_KT() },
});

export const IMMENSTAAD_KT = () => [
  { label: 'Kinder bis 14 Jahre (befreit)', ageFrom: 0, ageTo: 14, rate: 0, rateNeben: null },
  { label: 'ab 15 Jahre', ageFrom: 15, ageTo: 120, rate: 3.5, rateNeben: 2.2 },
];

export const KT_EXEMPT = ['Geschäftsreise', 'Familienbesuch'];

export function ensure(d) {
  const def = DEFAULT_SETTINGS();
  const cur = d.invoiceSettings || {};
  d.invoiceSettings = { ...def, ...cur, seller: { ...def.seller, ...(cur.seller || {}) }, payment: { ...def.payment, ...(cur.payment || {}) }, pricing: { ...def.pricing, ...(cur.pricing || {}) },
    kurtaxe: { ...def.kurtaxe, ...(cur.kurtaxe || {}) }, logo: { ...def.logo, ...(cur.logo || {}) }, counters: { ...(cur.counters || {}) } };
  // alte, nie ausgefüllte Vorbelegung (alle Sätze 0) durch die Immenstaader Sätze ersetzen
  const K = d.invoiceSettings.kurtaxe;
  if (!K.groups?.length || K.groups.every(g => !g.rate && !g.rateNeben)) K.groups = IMMENSTAAD_KT();
  d.invoices ||= [];
  return d;
}

// IBAN-Prüfziffer nach ISO 13616 (Modulo 97)
function ibanOk(iban) {
  const r = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let m = 0; for (const ch of r) m = (m * 10 + +ch) % 97;
  return m === 1;
}

export function cleanSettings(b, prev) {
  const out = structuredClone(prev);
  if (b.seller) for (const k of Object.keys(out.seller)) if (b.seller[k] !== undefined) out.seller[k] = s(b.seller[k], k === 'name' ? 120 : 200);
  if (out.seller.iban) out.seller.iban = out.seller.iban.replace(/\s/g, '').toUpperCase();
  if (out.seller.iban && (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(out.seller.iban) || !ibanOk(out.seller.iban))) throw new Error('IBAN ist ungültig (Prüfziffer stimmt nicht). Bitte prüfen.');
  if (out.seller.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.seller.email)) throw new Error('E-Mail sieht ungültig aus.');
  if (b.numberPrefix !== undefined) out.numberPrefix = s(b.numberPrefix, 10).replace(/[^A-Za-z0-9-]/g, '');
  if (b.paymentDays !== undefined) { const n = Math.trunc(num(b.paymentDays)); if (!(n >= 0 && n <= 120)) throw new Error('Zahlungsziel ungültig'); out.paymentDays = n; }
  if (b.vatRate !== undefined) { const n = num(b.vatRate); if (![7, 19, 0].includes(n)) throw new Error('Steuersatz bitte 7, 19 oder 0'); out.vatRate = n; }
  if (b.taxation !== undefined) { if (!['ist', 'soll'].includes(b.taxation)) throw new Error('Versteuerung ungültig'); out.taxation = b.taxation; }
  if (b.footer !== undefined) out.footer = s(b.footer, 500);
  if (b.logo && b.logo.enabled !== undefined) out.logo.enabled = !!b.logo.enabled && !!out.logo.file;
  if (b.nextNumber !== undefined) {
    const { year, value } = b.nextNumber; const v = Math.trunc(num(value));
    if (!Number.isInteger(year) || !(v >= 1 && v < 1e6)) throw new Error('Nummer ungültig');
    const used = Math.max(0, ...out.counters[year] ? [out.counters[year]] : [0]);
    if (v <= used) throw new Error(`Für ${year} wurde schon bis Nummer ${used} vergeben. Die nächste Nummer muss größer sein.`);
    out.counters[year] = v - 1;
  }
  if (b.payment) for (const k of Object.keys(out.payment)) if (b.payment[k] !== undefined) {
    const v = Math.trunc(num(b.payment[k]));
    if (!Number.isFinite(v) || v < 0 || v > (k === 'depositPercent' ? 100 : 730)) throw new Error('Zahlungsbedingung ungültig');
    out.payment[k] = v;
  }
  if (b.pricing) for (const k of Object.keys(out.pricing)) if (b.pricing[k] !== undefined) {
    const v = num(b.pricing[k]); if (!Number.isFinite(v) || v < 0 || v > 1e5) throw new Error('Preisbaustein ungültig'); out.pricing[k] = r2(v);
  }
  if (b.kurtaxe) {
    if (b.kurtaxe.label !== undefined) out.kurtaxe.label = s(b.kurtaxe.label, 40) || 'Kurtaxe';
    for (const k of ['mainFrom', 'mainTo']) if (b.kurtaxe[k] !== undefined) {
      const v = String(b.kurtaxe[k] || '').trim();
      const m = v.match(/^(\d{1,2})\.(\d{1,2})\.?$/) || v.match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
      let md = '';
      if (m) md = v.includes('.') ? `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : `${m[1]}-${m[2]}`;
      if (v && !(md && !isNaN(Date.parse(`2024-${md}`)))) throw new Error('Datum der Kurtaxe-Hauptsaison bitte als TT.MM. eingeben');
      out.kurtaxe[k] = md;
    }
    if (Array.isArray(b.kurtaxe.groups)) out.kurtaxe.groups = b.kurtaxe.groups.slice(0, 10).map(g => {
      const ageFrom = Math.trunc(num(g.ageFrom)), ageTo = Math.trunc(num(g.ageTo));
      if (!(ageFrom >= 0 && ageTo >= ageFrom && ageTo <= 120)) throw new Error('Altersgrenzen der Kurtaxe ungültig');
      const rate = r2(num(g.rate)); const rn = g.rateNeben === '' || g.rateNeben == null ? null : r2(num(g.rateNeben));
      if (!(rate >= 0 && rate < 100) || (rn != null && !(rn >= 0 && rn < 100))) throw new Error('Kurtaxe-Satz ungültig');
      return { label: s(g.label, 40) || `${ageFrom} bis ${ageTo} Jahre`, ageFrom, ageTo, rate, rateNeben: rn };
    }).sort((a, b) => a.ageFrom - b.ageFrom);
  }
  return out;
}

/* ---------- Berechnung ---------- */

// Ordnet jede Nacht einer Saison zu ('haupt' oder 'neben'). Mit festen Kurtaxe-Daten (MM-TT) zählen diese,
// sonst die Hauptsaisons aus den Einstellungen; Nächte ohne Saison zählen als 'neben'.
function seasonNights(seasons, from, to, K = {}) {
  if (K.mainFrom && K.mainTo) {
    let haupt = 0, neben = 0;
    for (let d = from; d < to; d = addDays(d, 1)) {
      const md = d.slice(5);
      const inMain = K.mainFrom <= K.mainTo ? md >= K.mainFrom && md <= K.mainTo : md >= K.mainFrom || md <= K.mainTo;
      inMain ? haupt++ : neben++;
    }
    return { haupt, neben };
  }
  const years = []; for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) years.push(y);
  const exp = expandSeasons(seasons || [], years);
  let haupt = 0, neben = 0;
  for (let d = from; d < to; d = addDays(d, 1)) (exp.some(x => x.kind === 'haupt' && x.start <= d && x.end > d) ? haupt++ : neben++);
  return { haupt, neben };
}

/**
 * Positionen aus den Eingaben berechnen.
 * input: { from, to, aptName, perNight, adults: Anzahl, childAges: [Zahlen], cleaning: bool, ktExempt }
 * (ältere Entwürfe haben statt adults/childAges eine Liste ages mit allen Altersangaben)
 */
// Erwachsene ohne Altersangabe zählen als volljährig, Kinder mit ihrem Alter
export function travellerAges(input) {
  const list = input.adults != null ? [...Array(Math.max(0, Math.trunc(num(input.adults)) || 0)).fill(40), ...(input.childAges || [])] : (input.ages || []);
  return list.map(a => Math.trunc(num(a))).filter(a => a >= 0 && a <= 120);
}

export function computeItems(settings, seasons, input) {
  const { pricing: P, kurtaxe: K, vatRate } = settings;
  const n = nightsOf(input.from, input.to);
  if (!(n > 0)) throw new Error('Bitte Anreise und Abreise prüfen.');
  const ages = travellerAges(input);
  const items = [];
  const per = r2(num(input.perNight));
  items.push({ text: `Übernachtung ${input.aptName || ''}`.trim() + `, ${de(input.from)} bis ${de(input.to)}`, qty: n, unit: 'Nacht', price: per, vat: vatRate, kind: 'stay' });
  const adults = ages.filter(a => a > P.childMaxAge).length;
  const children = ages.filter(a => a <= P.childMaxAge && a > P.infantMaxAge).length;
  const included = Math.max(0, Math.trunc(P.includedPersons));
  const extraAdults = Math.max(0, adults - included);
  const extraChildren = Math.max(0, children - Math.max(0, included - adults));
  if (extraAdults && P.extraAdult) items.push({ text: `Mehrbelegung Erwachsene (${extraAdults} Pers. ab ${included + 1}. Person)`, qty: extraAdults * n, unit: 'Pers.-Nacht', price: P.extraAdult, vat: vatRate, kind: 'extra' });
  if (extraChildren && P.extraChild) items.push({ text: `Mehrbelegung Kinder bis ${P.childMaxAge} Jahre (${extraChildren} Kind${extraChildren > 1 ? 'er' : ''})`, qty: extraChildren * n, unit: 'Pers.-Nacht', price: P.extraChild, vat: vatRate, kind: 'extra' });
  if (input.cleaning && P.cleaning) items.push({ text: 'Endreinigung', qty: 1, unit: 'pauschal', price: P.cleaning, vat: vatRate, kind: 'cleaning' });
  const sn = seasonNights(seasons, input.from, input.to, K);
  if (KT_EXEMPT.includes(input.ktExempt)) return items;
  for (const g of K.groups) {
    const cnt = ages.filter(a => a >= g.ageFrom && a <= g.ageTo).length;
    if (!cnt) continue;
    const rn = g.rateNeben == null ? g.rate : g.rateNeben;
    const parts = g.rate === rn ? [[n, g.rate, '']] : [[sn.haupt, g.rate, ', Hauptsaison'], [sn.neben, rn, ', übrige Zeit']];
    for (const [nn, rate, suffix] of parts) if (nn && rate) items.push({ text: `${K.label} ${g.label} (${cnt} Pers.${suffix})`, qty: cnt * nn, unit: 'Pers.-Nacht', price: rate, vat: 0, kind: 'kurtaxe' });
  }
  return items;
}

export function cleanItems(items) {
  if (!Array.isArray(items)) throw new Error('Positionen fehlen');
  return items.slice(0, 40).map(it => {
    const qty = r2(num(it.qty)), price = r2(num(it.price)), vat = num(it.vat);
    if (!Number.isFinite(qty) || !Number.isFinite(price) || Math.abs(qty) > 1e5 || Math.abs(price) > 1e6) throw new Error('Menge oder Preis ungültig');
    if (![0, 7, 19].includes(vat)) throw new Error('Steuersatz bitte 7, 19 oder 0');
    return { text: s(it.text, 200) || 'Position', qty, unit: s(it.unit, 20) || 'Stück', price, vat, kind: ['stay', 'extra', 'cleaning', 'kurtaxe'].includes(it.kind) ? it.kind : (vat === 0 ? 'kurtaxe' : 'other') };
  }).filter(it => it.qty !== 0);
}

/**
 * Summen aus Bruttopositionen. Je Steuersatz wird der Nettobetrag so gewählt, dass
 * netto + gerundete Steuer genau die Bruttosumme ergibt (wichtig für die E-Rechnung).
 */
export function totals(items, deposit = 0) {
  const lines = items.map(it => ({ ...it, gross: r2(it.qty * it.price) }));
  const groups = {};
  for (const l of lines) (groups[l.vat] ||= []).push(l);
  const vat = [];
  for (const [rate, ls] of Object.entries(groups)) {
    const r = +rate, gross = r2(ls.reduce((a, l) => a + l.gross, 0));
    let net = r2(gross / (1 + r / 100));
    for (const c of [net, r2(net - 0.01), r2(net + 0.01)]) if (r2(c + r2(c * r / 100)) === gross) { net = c; break; }
    const tax = r2(gross - net);
    // Netto je Zeile, Rundungsrest auf die größte Zeile
    ls.forEach(l => { l.net = r2(l.gross / (1 + r / 100)); });
    const diff = r2(net - ls.reduce((a, l) => a + l.net, 0));
    if (diff) { const big = ls.reduce((m, l) => (Math.abs(l.gross) > Math.abs(m.gross) ? l : m), ls[0]); big.net = r2(big.net + diff); }
    vat.push({ rate: r, gross, net, tax });
  }
  vat.sort((a, b) => b.rate - a.rate);
  const gross = r2(lines.reduce((a, l) => a + l.gross, 0));
  const net = r2(vat.reduce((a, v) => a + v.net, 0));
  const tax = r2(vat.reduce((a, v) => a + v.tax, 0));
  const dep = r2(num(deposit));
  return { lines, vat, gross, net, tax, deposit: dep, due: r2(gross - dep) };
}

/* ---------- Zahlungsplan und Zahlungen ---------- */

/**
 * Anzahlung (Prozent, Frist ab Rechnungsdatum), wenn die Anreise mehr als depositIfDaysAhead Tage entfernt ist;
 * Restzahlung dann restDaysBeforeArrival Tage vor Anreise. Sonst ist der ganze Betrag fällig.
 */
export function paymentSchedule(S, inv, date) {
  const t = totals(inv.items, inv.deposit);
  if (inv.kind === 'storno' || !(t.due > 0)) return [];
  const P = S.payment;
  const ahead = nightsOf(date, inv.from);
  const fullDue = () => { const d = addDays(date, S.paymentDays); return ahead > 0 && d > inv.from ? inv.from : d; };
  // Abweichende Anzahlung (Betrag und/oder Termin) aus dem Entwurf, z. B. „erst am 20.01. anweisen“
  const ovAmt = inv.input?.depositAmount > 0 ? Math.min(inv.input.depositAmount, t.due) : 0, ovDue = inv.input?.depositDue || '';
  const custom = inv.input?.plan !== 'full' && (ovAmt || ovDue);
  if (custom || (inv.input?.plan !== 'full' && P.depositPercent > 0 && P.depositPercent < 100 && ahead > P.depositIfDaysAhead)) {
    const dep = ovAmt || (P.depositPercent > 0 ? r2(t.due * P.depositPercent / 100) : t.due);
    const depDue = ovDue || addDays(date, P.depositDays);
    if (dep >= t.due - 0.005) return [{ label: 'Gesamtbetrag', amount: t.due, dueDate: depDue }];
    let restDue = addDays(inv.from, -P.restDaysBeforeArrival);
    if (restDue < depDue) restDue = depDue;
    return [{ label: ovAmt ? 'Anzahlung' : `Anzahlung (${P.depositPercent} %)`, amount: dep, dueDate: depDue }, { label: 'Restzahlung', amount: r2(t.due - dep), dueDate: restDue }];
  }
  return [{ label: 'Gesamtbetrag', amount: t.due, dueDate: fullDue() }];
}

// Zahlungen: eine vor der Rechnung erhaltene Anzahlung zählt zum Rechnungsdatum
export function paymentsOf(inv) {
  const list = [...(inv.payments || [])];
  if (inv.status === 'ausgestellt' && inv.deposit) list.unshift({ id: 0, date: inv.date, amount: Math.abs(inv.deposit), note: 'vor Rechnung erhalten', implicit: true });
  return list.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Zu zahlen bzw. bei Storno zu erstatten: erstattet wird nur, was auf die alte Rechnung tatsächlich überwiesen wurde
const dueOf = inv => (inv.kind === 'storno' && inv.refundDue != null ? inv.refundDue : Math.abs(inv.totals.due));

export function openAmount(inv) {
  if (inv.status !== 'ausgestellt') return null;
  const paid = r2((inv.payments || []).reduce((a, p) => a + p.amount, 0));
  return r2(dueOf(inv) - paid);
}

function refreshPaid(inv) {
  const due = dueOf(inv);
  let sum = 0; inv.paidAt = null;
  for (const p of [...(inv.payments || [])].sort((a, b) => (a.date < b.date ? -1 : 1))) { sum = r2(sum + p.amount); if (sum >= due - 0.005) { inv.paidAt = p.date; break; } }
  if (!(due > 0.005) && (inv.payments || []).length === 0) inv.paidAt = inv.date;
}

export function addPayment(inv, b) {
  if (inv.status !== 'ausgestellt') throw new Error('Erst festschreiben.');
  const date = String(b.date || '');
  if (!isDay(date)) throw new Error('Bitte ein Datum angeben.');
  const amount = r2(num(b.amount));
  if (!(amount > 0 && amount < 1e6)) throw new Error('Betrag ungültig');
  if (amount > openAmount(inv) + 0.005) throw new Error(`Der Betrag ist höher als der offene Betrag (${eur(openAmount(inv))}).`);
  inv.payments ||= [];
  const p = { id: inv.payments.reduce((m, x) => Math.max(m, x.id), 0) + 1, date, amount, note: s(b.note, 80) };
  inv.payments.push(p);
  refreshPaid(inv);
  return p;
}

export function removePayment(inv, pid) {
  inv.payments = (inv.payments || []).filter(p => p.id !== pid);
  refreshPaid(inv);
}

/* ---------- Entwürfe, Festschreiben, Storno ---------- */

const nextId = list => list.reduce((m, e) => Math.max(m, e.id), 0) + 1;

function splitAddress(a) {
  const t = String(a || '').split(/\n|,/).map(x => x.trim()).filter(Boolean);
  const zi = t.findIndex(x => /^(?:[A-Z]{1,2}-)?\d{4,5}\s+\S/.test(x));
  if (zi < 0) return { street: t[0] || '', zip: '', city: t.slice(1).join(', '), country: 'DE' };
  const m = t[zi].match(/^(?:([A-Z]{1,2})-)?(\d{4,5})\s+(.+)$/);
  const cc = m[1] === 'A' ? 'AT' : m[1] === 'CH' ? 'CH' : m[1] && m[1].length === 2 ? m[1] : (m[2].length === 4 ? 'AT' : 'DE');
  return { street: t.slice(0, zi).join(', '), zip: m[2], city: m[3], country: t[zi + 1] && /schweiz/i.test(t[zi + 1]) ? 'CH' : cc };
}

export function draftFromStay(d, stay, guest, aptName) {
  ensure(d);
  const S = d.invoiceSettings;
  const n = nightsOf(stay.start, stay.end);
  const persons = (stay.adults || 0) + (stay.children || 0) || 2;
  // Smoobu kennt nur die Anzahl der Kinder; ihr Alter (vorbelegt mit 10) bitte im Entwurf eintragen
  const input = { from: stay.start, to: stay.end, aptName, perNight: stay.price != null && n ? r2(stay.price / n) : 0,
    adults: Math.max(stay.adults || 0, stay.children ? 0 : persons), childAges: Array(stay.children || 0).fill(10), cleaning: !!S.pricing.cleaning };
  const inv = {
    id: nextId(d.invoices), status: 'entwurf', kind: 'rechnung', number: null, stayId: stay.id, guestId: guest.id,
    buyer: { name: guest.name, ...splitAddress(guest.address), email: guest.email || '', phone: guest.phone || '', vatId: '', reference: '' },
    from: stay.start, to: stay.end, aptName, input, items: [], deposit: 0, note: '', eInvoice: false,
    createdAt: new Date().toISOString(),
  };
  inv.items = computeItems(S, d.seasons, input);
  d.invoices.push(inv);
  return inv;
}

export function updateDraft(d, inv, b) {
  if (inv.status !== 'entwurf') throw new Error('Diese Rechnung ist festgeschrieben und kann nicht mehr geändert werden. Bitte stornieren.');
  if (b.buyer) for (const k of ['name', 'street', 'zip', 'city', 'country', 'email', 'phone', 'vatId', 'reference']) if (b.buyer[k] !== undefined) inv.buyer[k] = s(b.buyer[k], k === 'street' || k === 'name' ? 160 : 100);
  if (inv.buyer.country) inv.buyer.country = inv.buyer.country.toUpperCase().slice(0, 2);
  if (b.from !== undefined || b.to !== undefined) {
    const from = b.from ?? inv.from, to = b.to ?? inv.to;
    if (!isDay(from) || !isDay(to) || to <= from) throw new Error('Bitte Leistungszeitraum prüfen.');
    inv.from = from; inv.to = to; inv.input.from = from; inv.input.to = to;
  }
  if (b.aptName !== undefined) inv.aptName = inv.input.aptName = s(b.aptName, 60);
  if (b.input) {
    if (b.input.perNight !== undefined) inv.input.perNight = r2(num(b.input.perNight));
    const ageList = v => (Array.isArray(v) ? v : String(v).split(/[,;\s]+/)).filter(x => x !== '').map(x => Math.trunc(num(x))).filter(a => a >= 0 && a <= 120).slice(0, 20);
    if (b.input.adults !== undefined || b.input.childAges !== undefined) {
      if (inv.input.adults == null) { const old = travellerAges(inv.input); inv.input.adults = old.filter(a => a > 17).length; inv.input.childAges = old.filter(a => a <= 17); }
      if (b.input.adults !== undefined) { const v = Math.trunc(num(b.input.adults)); if (!(v >= 0 && v <= 20)) throw new Error('Anzahl Erwachsene ungültig'); inv.input.adults = v; }
      if (b.input.childAges !== undefined) inv.input.childAges = ageList(b.input.childAges);
      delete inv.input.ages;
    }
    if (b.input.ages !== undefined) inv.input.ages = (Array.isArray(b.input.ages) ? b.input.ages : String(b.input.ages).split(/[,;\s]+/)).filter(x => x !== '').map(x => Math.trunc(num(x))).filter(a => a >= 0 && a <= 120).slice(0, 20);
    if (b.input.cleaning !== undefined) inv.input.cleaning = !!b.input.cleaning;
    if (b.input.ktExempt !== undefined) {
      inv.input.ktExempt = b.input.ktExempt === true ? 'Geschäftsreise' : KT_EXEMPT.includes(b.input.ktExempt) ? b.input.ktExempt : '';
      // nur die Kurtaxe-Positionen neu setzen, Handänderungen an anderen Positionen bleiben
      const kt = computeItems(d.invoiceSettings, d.seasons, inv.input).filter(i => i.kind === 'kurtaxe');
      inv.items = (inv.items || []).filter(i => i.kind !== 'kurtaxe').concat(kt);
    }
    if (b.input.depositAmount !== undefined) { const v = r2(num(b.input.depositAmount)); if (!(v >= 0 && v < 1e6)) throw new Error('Anzahlung ungültig'); inv.input.depositAmount = v || 0; }
    if (b.input.depositDue !== undefined) { const v = String(b.input.depositDue || ''); if (v && !isDay(v)) throw new Error('Datum der Anzahlung ungültig'); inv.input.depositDue = v; }
    if (b.input.special !== undefined) inv.input.special = s(b.input.special, 2000);
    if (b.input.plan !== undefined) inv.input.plan = b.input.plan === 'full' ? 'full' : 'auto';
  }
  if (b.items) inv.items = cleanItems(b.items);
  if (b.deposit !== undefined) { const v = r2(num(b.deposit)); if (!(v >= 0 && v < 1e6)) throw new Error('Anzahlung ungültig'); inv.deposit = v; }
  if (b.note !== undefined) inv.note = s(b.note, 600);
  if (b.eInvoice !== undefined) inv.eInvoice = !!b.eInvoice;
  return inv;
}

export function recompute(d, inv) {
  if (inv.status !== 'entwurf') throw new Error('Festgeschrieben');
  inv.items = computeItems(d.invoiceSettings, d.seasons, inv.input);
  return inv;
}

export function checkIssuable(S, inv) {
  const miss = [];
  const sl = S.seller;
  if (!sl.name) miss.push('Name der Vermieterin');
  if (!sl.street || !sl.zip || !sl.city) miss.push('Anschrift der Vermieterin');
  if (!sl.taxNumber && !sl.vatId) miss.push('Steuernummer oder USt-IdNr.');
  if (!inv.buyer.name) miss.push('Name des Gastes');
  if (!inv.buyer.street || !inv.buyer.zip || !inv.buyer.city) miss.push('Anschrift des Gastes');
  if (!inv.items.length) miss.push('mindestens eine Position');
  if (!sl.iban && inv.kind !== 'storno' && totals(inv.items, inv.deposit).due > 0) miss.push('IBAN der Vermieterin (für Überweisung und GiroCode)');
  if (inv.eInvoice) {
    if (!sl.email) miss.push('E-Mail der Vermieterin (für die E-Rechnung)');
    if (!sl.phone) miss.push('Telefon der Vermieterin (für die E-Rechnung)');
    if (!sl.iban) miss.push('IBAN (für die E-Rechnung)');
    if (!inv.buyer.email) miss.push('E-Mail des Gastes (für die E-Rechnung)');
  }
  return miss;
}

// Im Testbetrieb eigener Nummernkreis TEST-Jahr-Nr., der echte Zähler bleibt unberührt
function nextNumber(S, year, test = false) {
  const key = test ? `TEST-${year}` : year;
  S.counters[key] = (S.counters[key] || 0) + 1;
  const prefix = test ? 'TEST' : S.numberPrefix;
  return `${prefix ? prefix + '-' : ''}${year}-${String(S.counters[key]).padStart(3, '0')}`;
}

export function issue(d, inv, today = new Date().toISOString().slice(0, 10), { test = false } = {}) {
  ensure(d);
  const S = d.invoiceSettings;
  if (inv.status !== 'entwurf') throw new Error('Schon festgeschrieben');
  const miss = checkIssuable(S, inv);
  if (miss.length) throw new Error(`Bitte noch ergänzen: ${miss.join(', ')}.`);
  if (test) inv.test = true; else delete inv.test;
  inv.number = nextNumber(S, +today.slice(0, 4), !!inv.test);
  inv.date = today;
  inv.schedule = paymentSchedule(S, inv, today);
  inv.dueDate = inv.schedule.length ? inv.schedule[inv.schedule.length - 1].dueDate : today;
  inv.seller = structuredClone(S.seller);
  inv.footer = S.footer;
  inv.totals = totals(inv.items, inv.deposit);
  inv.status = 'ausgestellt';
  inv.issuedAt = new Date().toISOString();
  inv.payments = [];
  refreshPaid(inv);
  return inv;
}

export function cancel(d, inv, today = new Date().toISOString().slice(0, 10)) {
  if (inv.status !== 'ausgestellt' || inv.kind !== 'rechnung') throw new Error('Nur festgeschriebene Rechnungen können storniert werden.');
  if (d.invoices.some(x => x.refId === inv.id)) throw new Error('Diese Rechnung ist schon storniert.');
  const S = d.invoiceSettings;
  const st = {
    id: nextId(d.invoices), kind: 'storno', refId: inv.id, refNumber: inv.number, refDate: inv.date, stayId: inv.stayId, guestId: inv.guestId,
    buyer: structuredClone(inv.buyer), from: inv.from, to: inv.to, aptName: inv.aptName, input: structuredClone(inv.input),
    items: inv.items.map(it => ({ ...it, qty: -it.qty })), deposit: -inv.deposit, note: `Stornorechnung zu Rechnung ${inv.number} vom ${de(inv.date)}.`,
    eInvoice: inv.eInvoice, createdAt: new Date().toISOString(), ...(inv.test ? { test: true } : {}),
  };
  st.number = nextNumber(S, +today.slice(0, 4), !!inv.test);
  st.date = today; st.dueDate = today;
  st.seller = structuredClone(inv.seller); st.footer = inv.footer;
  st.totals = totals(st.items, st.deposit);
  st.status = 'ausgestellt'; st.issuedAt = new Date().toISOString(); st.schedule = []; st.payments = [];
  st.refundDue = Math.min(Math.abs(st.totals.due), r2((inv.payments || []).reduce((a, p) => a + p.amount, 0)));
  refreshPaid(st);
  inv.cancelledBy = st.id;
  d.invoices.push(st);
  return st;
}

/**
 * Festgeschriebene Rechnung korrigieren: Storno mit neuer Nummer und ein neuer Entwurf als Kopie.
 * Bereits gezahlte Beträge werden nicht erstattet, sondern mit der neuen Rechnung verrechnet
 * (Storno gilt damit als ausgeglichen, der Entwurf führt sie als bereits erhaltene Zahlung).
 */
export function correct(d, inv, today = new Date().toISOString().slice(0, 10)) {
  const st = cancel(d, inv, today);
  const paid = r2((inv.payments || []).reduce((a, p) => a + p.amount, 0));
  const carry = Math.min(paid, openAmount(st));
  if (carry > 0.005) {
    st.payments.push({ id: 1, date: today, amount: carry, note: 'verrechnet mit der neuen Rechnung' });
    refreshPaid(st);
  }
  const draft = {
    id: nextId(d.invoices), status: 'entwurf', kind: 'rechnung', number: null, stayId: inv.stayId, guestId: inv.guestId,
    buyer: structuredClone(inv.buyer), from: inv.from, to: inv.to, aptName: inv.aptName, input: structuredClone(inv.input),
    items: structuredClone(inv.items), deposit: r2((inv.deposit || 0) + carry), note: inv.note, eInvoice: inv.eInvoice,
    replaces: inv.id, replacesNumber: inv.number, replacesDate: inv.date, createdAt: new Date().toISOString(),
  };
  d.invoices.push(draft);
  return { storno: st, draft };
}

/* ---------- PDF ---------- */

function wrap(text, width, size) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (PdfDoc.width(t, size) > width && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

export function invoicePdf(inv, { draftSettings = null, xml = null, logo = null, note = '', appendPages = null } = {}) {
  const draft = inv.status === 'entwurf';
  const sl = draft ? draftSettings.seller : inv.seller;
  const t = draft ? totals(inv.items, inv.deposit) : inv.totals;
  const doc = new PdfDoc({ width: 595, height: 842 });
  const L = 56, R = 539, MUTED = '#5f6863', LINE = '#c9d0cc';
  const title = inv.kind === 'storno' ? 'Stornorechnung' : 'Rechnung';
  // Logo oben links über dem Anschriftfeld; der Entwurfs-/Testvermerk rückt dann nach rechts
  if (logo) doc.image(logo, L, 24, 170, 96);
  const markX = logo ? 340 : L;
  if (draft) doc.text(markX, 30, logo ? 'ENTWURF – keine gültige Rechnung' : 'ENTWURF – keine gültige Rechnung', { size: logo ? 9 : 11, bold: true, color: '#b03a2e' });
  else if (inv.test) doc.text(markX, 30, logo ? 'TESTRECHNUNG – keine gültige Rechnung' : 'TESTRECHNUNG – nur zur Probe, keine gültige Rechnung', { size: logo ? 9 : 11, bold: true, color: '#b03a2e' });
  // Absender
  const sender = [sl.name, sl.street, `${sl.zip} ${sl.city}`].filter(x => x.trim()).join(' · ');
  doc.text(L, 132, sender, { size: 7, color: MUTED });
  doc.stroke(LINE, 0.4).line(L, 135, L + 240, 135);
  let y = 152;
  for (const l of [inv.buyer.name, inv.buyer.street, `${inv.buyer.zip} ${inv.buyer.city}`.trim(), inv.buyer.country && inv.buyer.country !== 'DE' ? inv.buyer.country : ''].filter(Boolean)) { doc.text(L, y, l, { size: 10.5 }); y += 14; }
  // Briefkopf rechts
  let ry = 60;
  doc.text(340, ry, sl.name || '(Name der Vermieterin)', { size: 12, bold: true }); ry += 15;
  for (const l of [sl.street, `${sl.zip} ${sl.city}`.trim(), sl.phone && `Tel. ${sl.phone}`, sl.email].filter(Boolean)) { doc.text(340, ry, l, { size: 9, color: MUTED }); ry += 12; }
  ry = Math.max(ry + 8, 150);
  const meta = [[`${title}snummer`, inv.number || '(wird beim Festschreiben vergeben)'], [`${title}sdatum`, de(inv.date) || de(new Date().toISOString().slice(0, 10))],
    ['Leistungszeitraum', `${de(inv.from)} bis ${de(inv.to)}`], ...(inv.buyer.reference ? [['Ihre Referenz', inv.buyer.reference]] : []),
    ...(inv.kind === 'storno' ? [['Bezieht sich auf', `Rechnung ${inv.refNumber} vom ${de(inv.refDate)}`]] : [])];
  for (const [k, v] of meta) { doc.text(340, ry, k, { size: 8.5, color: MUTED }); doc.text(430, ry, v, { size: 8.5 }); ry += 12; }
  y = Math.max(y, ry) + 26;
  doc.text(L, y, `${title}${inv.number ? ` ${inv.number}` : ''}`, { size: 16, bold: true }); y += 20;
  const intro = inv.kind === 'storno' ? `hiermit stornieren wir die Rechnung ${inv.refNumber} vollständig.` : `vielen Dank für Ihre${inv.from > (inv.date || new Date().toISOString().slice(0, 10)) ? ' Buchung' : 'n Aufenthalt'}${inv.aptName ? ` in ${inv.aptName}` : ''}. Wir berechnen Ihnen:`;
  doc.text(L, y, `Guten Tag ${inv.buyer.name},`, { size: 10 }); y += 14;
  doc.text(L, y, intro, { size: 10 }); y += 22;
  // Tabelle
  const cols = { pos: L, text: L + 22, qty: 330, unit: 360, price: 430, vat: 465, sum: R };
  const head = () => {
    doc.fill('#eef1ef').rect(L - 4, y - 11, R - L + 8, 16);
    doc.text(cols.pos, y, 'Pos.', { size: 8, bold: true }); doc.text(cols.text, y, 'Leistung', { size: 8, bold: true });
    doc.text(cols.qty - PdfDoc.width('Menge', 8), y, 'Menge', { size: 8, bold: true }); doc.text(cols.unit, y, 'Einheit', { size: 8, bold: true });
    doc.text(cols.price - PdfDoc.width('Einzelpreis', 8) + 20, y, 'Einzelpreis', { size: 8, bold: true }); doc.text(cols.vat, y, 'USt', { size: 8, bold: true });
    doc.text(cols.sum - PdfDoc.width('Gesamt', 8), y, 'Gesamt', { size: 8, bold: true });
    y += 16;
  };
  head();
  const right = (x, yy, txt, o = {}) => doc.text(x - PdfDoc.width(txt, o.size || 9), yy, txt, { size: 9, ...o });
  t.lines.forEach((l, i) => {
    const lines = wrap(l.text, cols.qty - cols.text - 34, 9);
    if (y + lines.length * 12 > 700) { doc.newPage(); y = 60; head(); }
    doc.text(cols.pos, y, String(i + 1), { size: 9 });
    lines.forEach((tx, j) => doc.text(cols.text, y + j * 12, tx, { size: 9 }));
    right(cols.qty, y, String(l.qty).replace('.', ','));
    doc.text(cols.unit, y, l.unit, { size: 8, color: MUTED });
    right(cols.price + 20, y, eur(l.price));
    doc.text(cols.vat, y, l.vat ? `${l.vat} %` : '–', { size: 9 });
    right(cols.sum, y, eur(l.gross));
    y += lines.length * 12 + 4;
    doc.stroke(LINE, 0.3).line(L, y - 9, R, y - 9);
  });
  if (y > 640) { doc.newPage(); y = 60; }
  y += 6;
  const row = (k, v, o = {}) => { doc.text(300, y, k, { size: 9.5, ...o }); right(R, y, v, { size: 9.5, ...o }); y += 14; };
  row('Gesamtbetrag (brutto)', eur(t.gross), { bold: true });
  for (const v of t.vat) {
    if (v.rate) row(`darin ${v.rate} % USt auf ${eur(v.net)} netto`, eur(v.tax), { color: MUTED });
    else row('Kurtaxe, nicht umsatzsteuerbar', eur(v.gross), { color: MUTED });
  }
  if (t.deposit) row(inv.kind === 'storno' ? 'Erstattung Anzahlung' : inv.replacesNumber ? 'abzüglich bereits gezahlt' : 'abzüglich erhaltene Anzahlung', eur(-t.deposit));
  doc.stroke('#1d2420', 0.8).line(300, y - 9, R, y - 9);
  row(inv.kind === 'storno' ? 'Gutschrift' : 'Zu zahlen', eur(t.due), { bold: true, size: 11 });
  y += 10;
  const texts = [];
  const sched = draft ? paymentSchedule(draftSettings, inv, new Date().toISOString().slice(0, 10)) : inv.schedule || [];
  if (sched.length) {
    const ref = inv.number || 'Rechnungsnummer';
    const qrSize = 78, withQr = !!(sl.iban && sl.name);
    const blockH = withQr ? qrSize + 26 : 16;
    if (y + 30 + blockH > 760) { doc.newPage(); y = 60; }
    doc.text(L, y, sched.length > 1 ? 'Zahlungsplan' : 'Zahlung', { size: 10.5, bold: true }); y += 16;
    if (withQr) {
      const colW = (R - L) / Math.max(2, sched.length);
      sched.forEach((p, k) => {
        const x0 = L + k * colW;
        const m = qrMatrix(epcPayload({ name: sl.accountHolder || sl.name, iban: sl.iban, bic: sl.bic, amount: p.amount, text: `${ref} ${p.label.replace(/ \(.*\)/, '')}` }));
        const cell = qrSize / m.length;
        doc.fill('#000000');
        m.forEach((row, yy) => row.forEach((dk, xx) => { if (dk) doc.rect(x0 + xx * cell, y + yy * cell, cell + 0.05, cell + 0.05); }));
        doc.text(x0 + qrSize + 12, y + 14, p.label, { size: 9.5, bold: true });
        doc.text(x0 + qrSize + 12, y + 30, eur(p.amount), { size: 12, bold: true });
        doc.text(x0 + qrSize + 12, y + 46, `fällig bis ${de(p.dueDate)}`, { size: 9.5 });
        doc.text(x0 + qrSize + 12, y + 60, 'QR-Code mit der Banking-App', { size: 7.5, color: MUTED });
        doc.text(x0 + qrSize + 12, y + 70, 'scannen (GiroCode)', { size: 7.5, color: MUTED });
      });
      y += qrSize + 18;
    } else {
      for (const p of sched) { doc.text(L, y, `${p.label}: ${eur(p.amount)} fällig bis ${de(p.dueDate)}`, { size: 9.5 }); y += 13; }
      if (draft) { doc.text(L, y, 'Hinweis (nur im Entwurf): Der GiroCode erscheint, sobald unter „Vermieterdaten und Preise“ Name und IBAN eingetragen sind.', { size: 8.5, bold: true, color: '#b03a2e' }); y += 13; }
    }
    texts.push(`Bitte überweisen Sie ${sched.length > 1 ? 'die Beträge' : 'den Betrag'} zu den genannten Terminen auf das unten genannte Konto. Verwendungszweck: ${ref}.`);
  }
  if (note) texts.push(note);
  if (inv.replacesNumber) texts.push(`Diese Rechnung ersetzt die stornierte Rechnung ${inv.replacesNumber} vom ${de(inv.replacesDate)}.`);
  if (inv.input?.ktExempt === 'Geschäftsreise') texts.push('Geschäftsreise: von der Kurtaxe befreit.');
  if (inv.note) texts.push(inv.note);
  if (inv.buyer.vatId) texts.push(`USt-IdNr. des Leistungsempfängers: ${inv.buyer.vatId}`);
  if (xml) texts.push('Diese Rechnung enthält eine E-Rechnung (XRechnung) als eingebettete Datei.');
  for (const tx of texts) for (const l of wrap(tx, R - L, 9.5)) { doc.text(L, y, l, { size: 9.5 }); y += 13; }
  // Fußzeile
  const foot = [
    [sl.name, sl.street, `${sl.zip} ${sl.city}`.trim()].filter(Boolean).join(', '),
    [sl.taxNumber && `Steuernummer ${sl.taxNumber}`, sl.vatId && `USt-IdNr. ${sl.vatId}`].filter(Boolean).join(' · '),
    [sl.bank, sl.iban && `IBAN ${sl.iban.replace(/(.{4})/g, '$1 ').trim()}`, sl.bic && `BIC ${sl.bic}`, sl.accountHolder && `Inhaber: ${sl.accountHolder}`].filter(Boolean).join(' · '),
    ...(draft ? draftSettings.footer : inv.footer || '') ? [draft ? draftSettings.footer : inv.footer] : [],
  ].filter(Boolean);
  if (appendPages) appendPages(doc);
  const last = doc.pages.length;
  doc.pages.forEach((p, i) => {
    doc.cur = p;
    let fy = 800 - foot.length * 10;
    doc.stroke(LINE, 0.4).line(L, fy - 12, R, fy - 12);
    for (const f of foot) { doc.text(L, fy, f, { size: 7.5, color: MUTED }); fy += 10; }
    if (last > 1) doc.text(R - 40, 820, `Seite ${i + 1}/${last}`, { size: 7.5, color: MUTED });
  });
  const name = `${inv.kind === 'storno' ? 'Storno' : 'Rechnung'}-${inv.number || `Entwurf-${inv.id}`}`;
  return { buffer: doc.toBuffer(name, xml ? [{ name: 'xrechnung.xml', data: xml, mime: 'text/xml', desc: 'XRechnung (UN/CEFACT CII)' }] : []), filename: `${name}.pdf` };
}

/* ---------- E-Rechnung: XRechnung 3.0 in UN/CEFACT CII ---------- */

const x = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const a2 = v => v.toFixed(2);
const ymd = d => d.replace(/-/g, '');
const UNIT = { Nacht: 'DAY', 'Pers.-Nacht': 'DAY', pauschal: 'C62', Stück: 'C62' };

export function xrechnungXml(inv) {
  if (inv.status !== 'ausgestellt') throw new Error('E-Rechnung erst nach dem Festschreiben');
  const sl = inv.seller, b = inv.buyer, t = inv.totals;
  const storno = inv.kind === 'storno';
  const sign = storno ? -1 : 1; // Gutschrift (381) mit positiven Beträgen
  const cat = r => (r ? 'S' : 'E');
  const lines = t.lines.map((l, i) => {
    const net = r2(sign * l.net), qty = r2(sign * l.qty);
    const unitNet = qty ? Math.round((net / qty) * 10000) / 10000 : 0;
    return `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${x(l.text)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${unitNet}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${UNIT[l.unit] || 'C62'}">${qty}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat(l.vat)}</ram:CategoryCode>${l.vat ? `<ram:RateApplicablePercent>${l.vat}</ram:RateApplicablePercent>` : '<ram:RateApplicablePercent>0</ram:RateApplicablePercent>'}</ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${a2(net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
  }).join('');
  const taxes = t.vat.map(v => `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${a2(sign * v.tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${v.rate ? '' : '<ram:ExemptionReason>Durchlaufender Posten (Kurtaxe), nicht umsatzsteuerbar</ram:ExemptionReason>'}
        <ram:BasisAmount>${a2(sign * v.net)}</ram:BasisAmount><ram:CategoryCode>${cat(v.rate)}</ram:CategoryCode><ram:RateApplicablePercent>${v.rate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`).join('');
  const taxReg = [sl.vatId && `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(sl.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>`,
    sl.taxNumber && `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(sl.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>`].filter(Boolean).join('');
  const due = r2(sign * t.due), dep = r2(sign * t.deposit);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${x(inv.number)}</ram:ID><ram:TypeCode>${storno ? 381 : 380}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${ymd(inv.date)}</udt:DateTimeString></ram:IssueDateTime>${inv.note ? `
    <ram:IncludedNote><ram:Content>${x(inv.note)}</ram:Content></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${x(b.reference || inv.number)}</ram:BuyerReference>
      <ram:SellerTradeParty>${sl.vatId ? '' : `
        <ram:ID>${x(sl.taxNumber)}</ram:ID>`}
        <ram:Name>${x(sl.name)}</ram:Name>
        <ram:DefinedTradeContact><ram:PersonName>${x(sl.name)}</ram:PersonName><ram:TelephoneUniversalCommunication><ram:CompleteNumber>${x(sl.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication><ram:EmailURIUniversalCommunication><ram:URIID>${x(sl.email)}</ram:URIID></ram:EmailURIUniversalCommunication></ram:DefinedTradeContact>
        <ram:PostalTradeAddress><ram:PostcodeCode>${x(sl.zip)}</ram:PostcodeCode><ram:LineOne>${x(sl.street)}</ram:LineOne><ram:CityName>${x(sl.city)}</ram:CityName><ram:CountryID>${x(sl.country || 'DE')}</ram:CountryID></ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(sl.email)}</ram:URIID></ram:URIUniversalCommunication>
        ${taxReg}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${x(b.name)}</ram:Name>
        <ram:PostalTradeAddress><ram:PostcodeCode>${x(b.zip)}</ram:PostcodeCode><ram:LineOne>${x(b.street)}</ram:LineOne><ram:CityName>${x(b.city)}</ram:CityName><ram:CountryID>${x(b.country || 'DE')}</ram:CountryID></ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(b.email)}</ram:URIID></ram:URIUniversalCommunication>${b.vatId ? `
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(b.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>${x(inv.number)}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(sl.iban)}</ram:IBANID>${sl.accountHolder ? `<ram:AccountName>${x(sl.accountHolder)}</ram:AccountName>` : ''}</ram:PayeePartyCreditorFinancialAccount>${sl.bic ? `
        <ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${x(sl.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>${taxes}
      <ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">${ymd(inv.from)}</udt:DateTimeString></ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">${ymd(inv.to)}</udt:DateTimeString></ram:EndDateTime></ram:BillingSpecifiedPeriod>
      <ram:SpecifiedTradePaymentTerms>${storno || !(inv.schedule || []).length ? `<ram:Description>${storno ? 'Gutschrift wird erstattet.' : 'Bereits bezahlt.'}</ram:Description>` : `<ram:Description>${x(inv.schedule.map(p => `${p.label}: ${eur(p.amount)} bis ${de(p.dueDate)}`).join('; '))}. Ohne Abzug.</ram:Description><ram:DueDateDateTime><udt:DateTimeString format="102">${ymd(inv.schedule[0].dueDate)}</udt:DateTimeString></ram:DueDateDateTime>`}</ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${a2(sign * t.net)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${a2(sign * t.net)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${a2(sign * t.tax)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${a2(sign * t.gross)}</ram:GrandTotalAmount>${dep ? `
        <ram:TotalPrepaidAmount>${a2(dep)}</ram:TotalPrepaidAmount>` : ''}
        <ram:DuePayableAmount>${a2(due)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>${storno ? `
      <ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${x(inv.refNumber)}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${ymd(inv.refDate)}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

/* ---------- Umsatzsteuer-Bericht ---------- */

export function periodOf(kind, year, q) {
  if (kind === 'jahr') return { from: `${year}-01-01`, to: `${year + 1}-01-01`, label: `Jahr ${year}` };
  const m = (q - 1) * 3 + 1;
  const to = q === 4 ? `${year + 1}-01-01` : `${year}-${String(m + 3).padStart(2, '0')}-01`;
  return { from: `${year}-${String(m).padStart(2, '0')}-01`, to, label: `${q}. Quartal ${year}` };
}

/**
 * Soll-Versteuerung: maßgeblich ist das Ende des Leistungszeitraums (Abreise).
 * Ist-Versteuerung: maßgeblich ist der Zahlungseingang (bezahlt am).
 */
export function vatReport(d, period, today = new Date().toISOString().slice(0, 10), { includeTest = false } = {}) {
  ensure(d);
  const S = d.invoiceSettings;
  // Testrechnungen zählen nur im Testbetrieb mit
  const issued = d.invoices.filter(i => i.status === 'ausgestellt' && (includeTest || !i.test));
  const inP = x => x && x >= period.from && x < period.to;
  // Je Rechnung der im Zeitraum zu versteuernde Anteil: Soll = ganze Rechnung nach Leistungsende,
  // Ist = Zahlungen im Zeitraum, anteilig auf die Steuersätze verteilt (auch Anzahlungen)
  const rows = [];
  for (const inv of issued) {
    let share = 0, paid = [];
    if (S.taxation === 'soll') share = inP(addDays(inv.to, -1)) ? 1 : 0;
    else {
      paid = paymentsOf(inv).filter(p => inP(p.date));
      const base = Math.abs(inv.totals.gross);
      share = base ? paid.reduce((a, p) => a + p.amount, 0) / base : 0;
    }
    if (!share) continue;
    const vat = inv.totals.vat.map(v => ({ rate: v.rate, gross: r2(v.gross * share), net: r2(v.net * share), tax: r2(v.tax * share) }));
    rows.push({ number: inv.number, date: inv.date, kind: inv.kind, buyer: inv.buyer.name, from: inv.from, to: inv.to, paidAt: paid.map(p => p.date).join(', ') || inv.paidAt || '',
      gross: r2(vat.reduce((a, v) => a + v.gross, 0)), invoiceGross: inv.totals.gross, partial: share < 0.9999, vat });
  }
  rows.sort((a, b) => (a.number < b.number ? -1 : 1));
  const byRate = {};
  for (const r of rows) for (const v of r.vat) {
    const g = (byRate[v.rate] ||= { rate: v.rate, gross: 0, net: 0, tax: 0 });
    g.gross = r2(g.gross + v.gross); g.net = r2(g.net + v.net); g.tax = r2(g.tax + v.tax);
  }
  const unpaid = S.taxation === 'ist' ? issued.filter(i => i.kind === 'rechnung' && !i.cancelledBy && i.date < period.to && (openAmount(i) || 0) > 0.005).length : 0;
  // Aufenthalte aus der Gästedatenbank ohne App-Rechnung (z. B. Airbnb/Booking), nur zur Information
  const invoicedStays = new Set(issued.map(i => i.stayId).filter(Boolean));
  const other = (d.stays || []).filter(st => st.status !== 'storniert' && st.price != null && !invoicedStays.has(st.id)
    && addDays(st.end, -1) >= period.from && addDays(st.end, -1) < period.to);
  const otherGross = r2(other.reduce((a, st) => a + st.price, 0));
  const otherNet = r2(otherGross / (1 + S.vatRate / 100));
  return {
    period, taxation: S.taxation, rows,
    byRate: Object.values(byRate).sort((a, b) => b.rate - a.rate), unpaid,
    kz: { kz86: r2(byRate[7]?.net || 0), tax7: r2(byRate[7]?.tax || 0), kz81: r2(byRate[19]?.net || 0), tax19: r2(byRate[19]?.tax || 0) },
    other: { count: other.length, gross: otherGross, net: otherNet, tax: r2(otherGross - otherNet), byChannel: Object.entries(other.reduce((m, st) => { m[st.channel || 'ohne Kanal'] = r2((m[st.channel || 'ohne Kanal'] || 0) + st.price); return m; }, {})) },
    createdAt: today,
  };
}

export function vatReportPdf(rep, sellerName = '') {
  const doc = new PdfDoc({ width: 595, height: 842 });
  const L = 50, R = 545, MUTED = '#5f6863';
  const right = (xx, yy, t, o = {}) => doc.text(xx - PdfDoc.width(t, o.size || 9), yy, t, { size: 9, ...o });
  let y = 60;
  doc.text(L, y, `Umsatzsteuer-Bericht ${rep.period.label}`, { size: 16, bold: true }); y += 16;
  doc.text(L, y, `${sellerName ? sellerName + ' · ' : ''}${rep.taxation === 'ist' ? 'Ist-Versteuerung (nach Zahlungseingang)' : 'Soll-Versteuerung (nach Leistungsende)'} · erstellt ${de(rep.createdAt)}`, { size: 8.5, color: MUTED }); y += 28;
  doc.text(L, y, 'Für die Umsatzsteuer-Voranmeldung (Rechnungen aus der App)', { size: 11, bold: true }); y += 18;
  const kz = [['Kz 86: Umsätze zu 7 % (netto)', eur(rep.kz.kz86)], ['darauf Umsatzsteuer 7 %', eur(rep.kz.tax7)], ['Kz 81: Umsätze zu 19 % (netto)', eur(rep.kz.kz81)], ['darauf Umsatzsteuer 19 %', eur(rep.kz.tax19)]];
  for (const [k, v] of kz) { doc.text(L, y, k, { size: 10 }); right(R, y, v, { size: 10 }); y += 15; }
  const ex = rep.byRate.find(r => r.rate === 0);
  if (ex) { doc.text(L, y, 'Kurtaxe (durchlaufender Posten, nicht in die Voranmeldung)', { size: 10, color: MUTED }); right(R, y, eur(ex.gross), { size: 10, color: MUTED }); y += 15; }
  if (rep.unpaid) { y += 4; doc.text(L, y, `Hinweis: ${rep.unpaid} Rechnung(en) noch nicht vollständig bezahlt. Bei Ist-Versteuerung zählen nur erfasste Zahlungen.`, { size: 8.5, color: '#b03a2e' }); y += 14; }
  y += 14;
  doc.text(L, y, `Rechnungen im Zeitraum (${rep.rows.length})`, { size: 11, bold: true }); y += 16;
  const head = () => { doc.fill('#eef1ef').rect(L - 4, y - 10, R - L + 8, 14); for (const [xx, t] of [[L, 'Nummer'], [L + 75, 'Datum'], [L + 135, 'Gast'], [L + 290, 'Zeitraum'], [L + 380, 'bezahlt']]) doc.text(xx, y, t, { size: 8, bold: true }); right(R, y, rep.taxation === 'ist' ? 'gezahlt im Zeitraum' : 'Brutto', { size: 8, bold: true }); y += 15; };
  head();
  for (const r of rep.rows) {
    if (y > 780) { doc.newPage(); y = 60; head(); }
    doc.text(L, y, r.number + (r.kind === 'storno' ? ' (Storno)' : ''), { size: 8.5 }); doc.text(L + 75, y, de(r.date), { size: 8.5 });
    doc.text(L + 135, y, r.buyer, { size: 8.5, clip: [L + 135, y - 10, 150, 14] }); doc.text(L + 290, y, `${de(r.from).slice(0, 6)}–${de(r.to)}`, { size: 8.5 });
    doc.text(L + 380, y, r.paidAt.split(', ').map(de).join(', '), { size: 8.5, clip: [L + 380, y - 10, 60, 14] }); right(R, y, eur(r.gross) + (r.partial ? ` von ${eur(r.invoiceGross)}` : ''), { size: 8.5 }); y += 13;
  }
  if (!rep.rows.length) { doc.text(L, y, 'Keine Rechnungen in diesem Zeitraum.', { size: 9, color: MUTED }); y += 13; }
  y += 18; if (y > 700) { doc.newPage(); y = 60; }
  doc.text(L, y, 'Zur Information: Aufenthalte ohne App-Rechnung (z. B. Airbnb, Booking.com)', { size: 11, bold: true }); y += 16;
  doc.text(L, y, `${rep.other.count} Aufenthalte mit Abreise im Zeitraum, Preise laut Gästedatenbank (brutto):`, { size: 9, color: MUTED }); y += 14;
  for (const [ch, v] of rep.other.byChannel) { doc.text(L + 10, y, ch, { size: 9 }); right(R, y, eur(v)); y += 13; }
  doc.text(L + 10, y, 'Summe brutto / darin rechnerisch Umsatzsteuer', { size: 9, bold: true }); right(R, y, `${eur(rep.other.gross)} / ${eur(rep.other.tax)}`, { size: 9, bold: true }); y += 16;
  for (const l of wrap('Diese Beträge stammen aus Smoobu bzw. der Gästedatenbank und können Kurtaxe, Reinigung oder Portalgebühren anders enthalten als die Abrechnung der Portale. Für die Voranmeldung bitte mit den Auszahlungsberichten der Portale abgleichen.', R - L, 8.5)) { doc.text(L, y, l, { size: 8.5, color: MUTED }); y += 11; }
  return doc.toBuffer(`USt-Bericht ${rep.period.label}`);
}

export function vatReportCsv(rep) {
  const c = v => { const t = String(v ?? ''); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const e = v => v.toFixed(2).replace('.', ',');
  const head = ['Nummer', 'Art', 'Datum', 'Gast', 'Anreise', 'Abreise', 'bezahlt am', rep.taxation === 'ist' ? 'gezahlt im Zeitraum' : 'Brutto', 'Netto 7 %', 'USt 7 %', 'Netto 19 %', 'USt 19 %', 'Kurtaxe'];
  const rows = rep.rows.map(r => {
    const g = rate => r.vat.find(v => v.rate === rate) || { net: 0, tax: 0, gross: 0 };
    return [r.number, r.kind, r.date, r.buyer, r.from, r.to, r.paidAt, e(r.gross), e(g(7).net), e(g(7).tax), e(g(19).net), e(g(19).tax), e(g(0).gross)];
  });
  return '﻿' + [head, ...rows].map(r => r.map(c).join(';')).join('\r\n') + '\r\n';
}
