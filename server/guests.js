// Eigene Gästedatenbank: Gäste und ihre Aufenthalte (mit Preis), unabhängig vom Buchungsanbieter.
// Daten aus Smoobu werden übernommen und bleiben gespeichert, auch wenn Smoobu später wegfällt.
// Reine Funktionen auf dem Datenobjekt (store.data), damit sie sich einfach testen lassen.

export const RETENTION_YEARS = 3; // Vorschlag zur Löschfrist (DSGVO), nur als Hinweis in der Oberfläche

const s = (v, n) => String(v ?? '').slice(0, n).trim();
export const normEmail = e => s(e, 200).toLowerCase();
// Telefon: nur Ziffern, führende 00/0/49 weg, letzte 9 Ziffern vergleichen
export function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '').replace(/^00/, '').replace(/^49/, '').replace(/^0+/, '');
  return d.length >= 7 ? d.slice(-9) : '';
}
export const normName = n => s(n, 120).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/\b(herr|frau|hr|fr|familie|fam|dr)\.?\s+/g, '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

export function ensure(d) {
  d.guests ||= [];
  d.stays ||= [];
  return d;
}

const nextId = list => list.reduce((m, e) => Math.max(m, e.id), 0) + 1;
const nowIso = () => new Date().toISOString();

export function findGuestFor(d, b) {
  const gid = b.guestId ? String(b.guestId) : '';
  if (gid) { const g = d.guests.find(g => (g.smoobuGuestIds || []).includes(gid)); if (g) return g; }
  const em = normEmail(b.email);
  if (em) { const g = d.guests.find(g => normEmail(g.email) === em || (g.emails || []).map(normEmail).includes(em)); if (g) return g; }
  const ph = normPhone(b.phone);
  if (ph) { const g = d.guests.find(g => normPhone(g.phone) === ph); if (g) return g; }
  return null;
}

function newGuest(d, b) {
  const g = { id: nextId(d.guests), name: s(b.summary || b.name, 120) || 'Unbekannt', email: s(b.email, 200), phone: s(b.phone, 40), address: '', notes: '', ads: '',
    smoobuGuestIds: b.guestId ? [String(b.guestId)] : [], createdAt: nowIso(), updatedAt: nowIso() };
  d.guests.push(g);
  return g;
}

// Ergänzt fehlende Kontaktdaten, überschreibt nie, was von Hand eingetragen wurde
function enrich(g, b) {
  if (!g.email && b.email) g.email = s(b.email, 200);
  else if (b.email && normEmail(b.email) !== normEmail(g.email)) {
    g.emails ||= [];
    if (!g.emails.map(normEmail).includes(normEmail(b.email))) g.emails.push(s(b.email, 200));
  }
  if (!g.phone && b.phone) g.phone = s(b.phone, 40);
  if (b.guestId && !(g.smoobuGuestIds ||= []).includes(String(b.guestId))) g.smoobuGuestIds.push(String(b.guestId));
}

/**
 * Übernimmt Smoobu-Buchungen in die Gästedatenbank.
 * bookings: Ergebnis von fetchReservations (ohne stornierte), aptBySmoobu: Smoobu-Wohnungs-ID -> eigene Wohnungs-ID.
 * window {from,to}: abgefragter Zeitraum. Aufenthalte aus Smoobu, die ganz in diesem Zeitraum liegen und nicht mehr
 * geliefert werden, gelten als storniert. Gelöscht wird nichts.
 */
export function syncBookings(d, bookings, aptBySmoobu = {}, window = null) {
  ensure(d);
  let newGuests = 0, newStays = 0, updated = 0;
  const seen = new Set();
  for (const b of bookings) {
    if (b.blocked || !b.start || !b.end) continue;
    const bid = String(b.uid);
    seen.add(bid);
    let st = d.stays.find(x => x.smoobuBookingId === bid);
    let g = st ? d.guests.find(x => x.id === st.guestId) : null;
    if (!g) g = findGuestFor(d, b);
    if (!g) { g = newGuest(d, b); newGuests++; } else enrich(g, b);
    const fields = {
      guestId: g.id, aptId: aptBySmoobu[String(b.aptId)] ?? null, smoobuAptId: b.aptId != null ? String(b.aptId) : '',
      start: b.start, end: b.end, adults: +b.adults || 0, children: +b.children || 0,
      price: Number.isFinite(b.price) ? b.price : null, pricePaid: !!b.pricePaid, channel: s(b.channel, 60), status: 'ok',
    };
    if (!st) {
      d.stays.push({ id: nextId(d.stays), smoobuBookingId: bid, source: 'smoobu', note: '', ...fields, createdAt: nowIso() });
      newStays++;
    } else {
      // von Hand geänderter Preis bleibt erhalten
      if (st.priceManual) { fields.price = st.price; }
      const changed = Object.keys(fields).some(k => st[k] !== fields[k]);
      if (changed) { Object.assign(st, fields); updated++; }
    }
  }
  if (window) {
    for (const st of d.stays) {
      if (st.source === 'smoobu' && st.status === 'ok' && !seen.has(st.smoobuBookingId) && st.start >= window.from && st.end <= window.to) {
        st.status = 'storniert'; updated++;
      }
    }
  }
  return { newGuests, newStays, updated };
}

const nights = st => Math.round((Date.parse(st.end) - Date.parse(st.start)) / 864e5);

export function guestStays(d, gid) {
  return d.stays.filter(x => x.guestId === gid).sort((a, b) => (a.start < b.start ? 1 : -1));
}

// Liste für die Übersicht: Besuche, letzter/nächster Aufenthalt, Umsatz
export function guestList(d, today = new Date().toISOString().slice(0, 10)) {
  ensure(d);
  const dupKeys = new Map();
  for (const g of d.guests) { const k = normName(g.name); if (k) dupKeys.set(k, (dupKeys.get(k) || 0) + 1); }
  return d.guests.map(g => {
    const st = d.stays.filter(x => x.guestId === g.id && x.status !== 'storniert');
    const past = st.filter(x => x.start <= today).sort((a, b) => (a.start < b.start ? 1 : -1));
    const fut = st.filter(x => x.start > today).sort((a, b) => (a.start < b.start ? -1 : 1));
    const priced = st.filter(x => x.price != null);
    return {
      ...g, visits: st.length, pastVisits: past.length, nights: st.reduce((n, x) => n + nights(x), 0),
      lastStay: past[0] ? { start: past[0].start, end: past[0].end, aptId: past[0].aptId, price: past[0].price } : null,
      nextStay: fut[0] ? { start: fut[0].start, end: fut[0].end, aptId: fut[0].aptId } : null,
      revenue: priced.reduce((n, x) => n + x.price, 0),
      possibleDuplicate: (dupKeys.get(normName(g.name)) || 0) > 1,
      lastActivity: [...st].sort((a, b) => (a.end < b.end ? 1 : -1))[0]?.end || g.createdAt?.slice(0, 10) || '',
    };
  }).sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : a.name.localeCompare(b.name)));
}

// Wie oft war der Gast vor diesem Aufenthalt schon da? (für die Kennzeichnung „Stammgast“ im Kalender)
export function visitInfo(d, smoobuBookingId) {
  const st = (d.stays || []).find(x => x.smoobuBookingId === String(smoobuBookingId));
  if (!st) return null;
  const before = d.stays.filter(x => x.guestId === st.guestId && x.status !== 'storniert' && x.start < st.start).length;
  return { guestId: st.guestId, visit: before + 1 };
}

export function cleanGuest(b, prev = {}) {
  const g = {
    name: s(b.name ?? prev.name, 120), email: s(b.email ?? prev.email, 200), phone: s(b.phone ?? prev.phone, 40),
    address: s(b.address ?? prev.address, 300), notes: s(b.notes ?? prev.notes, 2000), ads: b.ads ?? prev.ads ?? '',
  };
  if (!g.name) throw new Error('Bitte einen Namen angeben.');
  if (!['', 'ja', 'nein'].includes(g.ads)) throw new Error('Angabe zur Werbung ungültig.');
  if (g.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email)) throw new Error('E-Mail-Adresse sieht ungültig aus.');
  return g;
}

const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function cleanStay(b, prev = {}) {
  const v = k => (b[k] !== undefined ? b[k] : prev[k]);
  const start = String(v('start') || ''), end = String(v('end') || '');
  if (!isDay(start) || !isDay(end)) throw new Error('Bitte gültige Daten angeben.');
  if (end <= start) throw new Error('Die Abreise muss nach der Anreise liegen.');
  let price = v('price');
  if (price === '' || price == null) price = null;
  else {
    price = typeof price === 'number' ? price : Number(String(price).replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (!Number.isFinite(price) || price < 0 || price > 1e6) throw new Error('Preis ungültig.');
    price = Math.round(price * 100) / 100;
  }
  const aptId = v('aptId') === '' || v('aptId') == null ? null : +v('aptId');
  return { start, end, aptId, price, adults: Math.max(0, Math.trunc(+v('adults') || 0)), children: Math.max(0, Math.trunc(+v('children') || 0)),
    channel: s(v('channel'), 60), note: s(v('note'), 500), status: v('status') === 'storniert' ? 'storniert' : 'ok', pricePaid: !!v('pricePaid') };
}

export function addGuest(d, b) {
  ensure(d);
  const g = { id: nextId(d.guests), ...cleanGuest(b), smoobuGuestIds: [], createdAt: nowIso(), updatedAt: nowIso() };
  d.guests.push(g);
  return g;
}

export function addStay(d, gid, b) {
  ensure(d);
  if (!d.guests.some(g => g.id === gid)) throw new Error('Gast unbekannt');
  const st = { id: nextId(d.stays), guestId: gid, source: 'manuell', smoobuBookingId: null, ...cleanStay(b), createdAt: nowIso() };
  d.stays.push(st);
  return st;
}

export function updateStay(d, id, b) {
  const st = d.stays.find(x => x.id === id);
  if (!st) throw new Error('Aufenthalt unbekannt');
  const c = cleanStay(b, st);
  if (b.price !== undefined && st.source === 'smoobu') st.priceManual = true;
  if (b.guestId !== undefined) {
    if (!d.guests.some(g => g.id === +b.guestId)) throw new Error('Gast unbekannt');
    st.guestId = +b.guestId;
  }
  Object.assign(st, c);
  return st;
}

// Zwei Gäste zusammenführen: alle Aufenthalte gehen an "keep", fehlende Angaben werden ergänzt
export function mergeGuests(d, keepId, dropId) {
  if (keepId === dropId) throw new Error('Bitte zwei verschiedene Gäste wählen.');
  const keep = d.guests.find(g => g.id === keepId), drop = d.guests.find(g => g.id === dropId);
  if (!keep || !drop) throw new Error('Gast unbekannt');
  for (const k of ['email', 'phone', 'address']) if (!keep[k] && drop[k]) keep[k] = drop[k];
  if (drop.email && keep.email !== drop.email) { keep.emails ||= []; if (!keep.emails.includes(drop.email)) keep.emails.push(drop.email); }
  for (const e of drop.emails || []) { keep.emails ||= []; if (!keep.emails.includes(e)) keep.emails.push(e); }
  if (drop.notes) keep.notes = [keep.notes, drop.notes].filter(Boolean).join('\n');
  if (!keep.ads && drop.ads) keep.ads = drop.ads;
  keep.smoobuGuestIds = [...new Set([...(keep.smoobuGuestIds || []), ...(drop.smoobuGuestIds || [])])];
  d.stays.forEach(st => { if (st.guestId === dropId) st.guestId = keepId; });
  d.guests = d.guests.filter(g => g.id !== dropId);
  keep.updatedAt = nowIso();
  return keep;
}

export function deleteGuest(d, gid) {
  d.guests = d.guests.filter(g => g.id !== gid);
  d.stays = d.stays.filter(st => st.guestId !== gid);
}

// Gäste, deren letzter Aufenthalt länger als RETENTION_YEARS zurückliegt (Vorschlag zum Löschen)
export function expiredGuests(d, today = new Date().toISOString().slice(0, 10)) {
  const y = +today.slice(0, 4) - RETENTION_YEARS;
  const limit = `${y}${today.slice(4)}`;
  return guestList(d, today).filter(g => g.lastActivity && g.lastActivity < limit && !g.nextStay).map(g => g.id);
}

const csvCell = v => { const t = String(v ?? ''); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const euro = n => (n == null ? '' : n.toFixed(2).replace('.', ','));

// Export für Excel (Semikolon, UTF-8 mit BOM): eine Zeile pro Aufenthalt, damit beim Anbieterwechsel nichts verloren geht
export function staysCsv(d, aptName = id => (id == null ? '' : `Fewo ${id}`)) {
  ensure(d);
  const head = ['Gast-Nr', 'Name', 'E-Mail', 'Telefon', 'Adresse', 'Werbung erlaubt', 'Notiz Gast', 'Anreise', 'Abreise', 'Nächte', 'Wohnung', 'Erwachsene', 'Kinder', 'Preis gesamt (EUR)', 'Preis pro Nacht (EUR)', 'Kanal', 'Status', 'Quelle', 'Smoobu-Buchung', 'Notiz Aufenthalt'];
  const rows = [];
  for (const g of [...d.guests].sort((a, b) => a.name.localeCompare(b.name))) {
    const st = guestStays(d, g.id);
    const base = [g.id, g.name, [g.email, ...(g.emails || [])].filter(Boolean).join(', '), g.phone, g.address, g.ads, g.notes];
    if (!st.length) rows.push([...base, ...Array(13).fill('')]);
    for (const x of st) {
      const n = nights(x);
      rows.push([...base, x.start, x.end, n, aptName(x.aptId), x.adults, x.children, euro(x.price), x.price != null && n ? euro(x.price / n) : '', x.channel, x.status, x.source, x.smoobuBookingId || '', x.note]);
    }
  }
  return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
