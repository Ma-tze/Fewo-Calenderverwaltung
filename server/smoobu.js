// Smoobu-API (lesend). Zugang über HMAC (empfohlen) oder alten Api-Key (abgekündigt).
// Schlüssel kommen ausschließlich aus Umgebungsvariablen (.env auf dem Server), nie aus der Oberfläche.

import crypto from 'node:crypto';

const BASE = (process.env.SMOOBU_BASE_URL || 'https://login.smoobu.com').replace(/\/+$/, '');
const KEY = process.env.SMOOBU_API_KEY || '';
const SECRET = process.env.SMOOBU_API_SECRET || '';
const MODE = (process.env.SMOOBU_AUTH || (SECRET ? 'hmac' : 'legacy')).toLowerCase();

export const smoobuConfigured = () => !!KEY && (MODE === 'legacy' || !!SECRET);
export const smoobuAuthMode = () => (smoobuConfigured() ? MODE : null);

function rfc3986(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function canonicalQuery(params) {
  return [...params.entries()].map(([k, v]) => [rfc3986(k), rfc3986(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
}

export function hmacHeaders({ method, path, query, body = '', key = KEY, secret = SECRET, timestamp, nonce }) {
  const ts = timestamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const n = nonce || crypto.randomUUID();
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const canonical = [method.toUpperCase(), path, query, ts, n, bodyHash, key].join('\n');
  const sig = crypto.createHmac('sha256', secret).update(canonical).digest('base64');
  return { 'X-API-Key': key, 'X-Timestamp': ts, 'X-Nonce': n, 'X-Signature': sig };
}

async function request(path, params = {}) {
  if (!smoobuConfigured()) throw new Error('Smoobu-Zugang ist nicht eingerichtet (SMOOBU_API_KEY/SMOOBU_API_SECRET in .env).');
  const sp = new URLSearchParams(params);
  const query = canonicalQuery(sp);
  const auth = MODE === 'legacy' ? { 'Api-Key': KEY } : hmacHeaders({ method: 'GET', path, query });
  const res = await fetch(`${BASE}${path}${query ? '?' + query : ''}`, {
    headers: { accept: 'application/json', 'Cache-Control': 'no-cache', ...auth },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`Smoobu lehnt den Zugang ab (HTTP ${res.status}). Schlüssel prüfen.`);
  if (res.status === 429) throw new Error('Smoobu: zu viele Anfragen, später erneut.');
  if (!res.ok) throw new Error(`Smoobu: HTTP ${res.status}`);
  return res.json();
}

export async function listApartments() {
  const j = await request('/api/apartments');
  return (j.apartments || []).map(a => ({ id: a.id, name: a.name }));
}

const day = v => (typeof v === 'string' ? v.slice(0, 10) : '');

export function mapBooking(b) {
  const start = day(b.arrival || b['arrival-date'] || b.arrivalDate);
  const end = day(b.departure || b['departure-date'] || b.departureDate);
  const name = b['guest-name'] || [b.firstname, b.lastname].filter(Boolean).join(' ') || (b['is-blocked-booking'] ? 'Blockiert' : 'Belegt');
  return {
    uid: String(b.id), start, end,
    summary: name,
    aptId: b.apartment?.id ?? null,
    phone: b.phone || '', email: b.email || '',
    adults: +b.adults || 0, children: +b.children || 0,
    notice: b.notice || '',
    channel: b.channel?.name || '',
    blocked: !!b['is-blocked-booking'],
    cancelled: b.type === 'cancellation',
    guestId: b.guestId != null ? String(b.guestId) : '',
    price: b.price === '' || b.price == null || !Number.isFinite(+b.price) ? null : +b.price,
    pricePaid: b['price-paid'] === true || /^(yes|ja|true|1)$/i.test(String(b['price-paid'] ?? '')),
  };
}

// Alle Buchungen im Zeitraum, seitenweise
export async function fetchReservations(from, to) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const j = await request('/api/reservations', { from, to, pageSize: '100', page: String(page), showCancellation: 'false' });
    (j.bookings || []).forEach(b => out.push(mapBooking(b)));
    if (!j.page_count || page >= j.page_count) break;
  }
  return out.filter(b => b.start && b.end && b.end > b.start && !b.cancelled);
}
