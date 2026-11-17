// Fewo-Kalender – Server
// Zwei Ports, ein Prozess:
//   VIEW_PORT  (Standard 8080): iPad-Ansicht, groß, nur lesen
//   ADMIN_PORT (Standard 8081): PC-Ansicht, kompakt, mit Einstellungen und Fewo-1-Plan
// Der Admin-Port soll NICHT ins Internet freigegeben werden (nur Heimnetz).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { parseICS, buildICS, parsePastedPlan, isValidDay, addDays } from './ical.js';
import { fetchHolidays, expandSeasons } from './holidays.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const VIEW_PORT = +(process.env.VIEW_PORT || 8080);
const ADMIN_PORT = +(process.env.ADMIN_PORT || 8081);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const VIEW_KEY = process.env.VIEW_KEY || '';          // optional: Zugangsschlüssel für die iPad-Ansicht
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''; // optional: Passwort für die PC-Ansicht
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, ''); // z. B. https://kalender.example.de (Adresse der iPad-Ansicht)

const store = new Store(DATA_DIR);
const COLORS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

/* ---------- iCal-Abruf ---------- */

async function fetchApartment(apt) {
  if (apt.source !== 'ical' || !apt.icalUrl) return;
  const prev = store.data.cache[apt.id] || {};
  try {
    const res = await fetch(apt.icalUrl, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Fewo-Kalender/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Antwort ist kein iCal-Kalender');
    const events = parseICS(text).map(e => ({ uid: e.uid || '', start: e.start, end: e.end, summary: e.summary || '', description: e.description || '' }));
    store.data.cache[apt.id] = { fetchedAt: new Date().toISOString(), error: null, events };
  } catch (e) {
    // letzten Stand behalten, Fehler merken
    store.data.cache[apt.id] = { ...prev, error: `${e.message}`, failedAt: new Date().toISOString(), events: prev.events || [] };
    console.error(`Abruf ${apt.name} fehlgeschlagen:`, e.message);
  }
}

let refreshing = null;
async function refreshAll() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    await Promise.all(store.data.apartments.map(fetchApartment));
    store.save();
  })().finally(() => { refreshing = null; });
  return refreshing;
}

let timer = null;
function schedule() {
  clearInterval(timer);
  const min = Math.max(5, +store.data.settings.intervalMinutes || 15);
  timer = setInterval(refreshAll, min * 60000);
}

/* ---------- Daten für den Kalender ---------- */

function sourceLabel(apt) { return apt.source === 'own' ? 'Belegungsplan' : 'Smoobu'; }

function calendarPayload() {
  const apartments = store.data.apartments.map(a => {
    const c = store.data.cache[a.id] || {};
    return { id: a.id, name: a.name, nick: a.nick, color: a.color, source: a.source,
      configured: a.source === 'own' || !!a.icalUrl, fetchedAt: a.source === 'own' ? null : c.fetchedAt || null, error: a.source === 'own' ? null : c.error || null };
  });
  const events = [];
  for (const a of store.data.apartments) {
    if (a.source === 'own') {
      for (const e of store.data.firm) events.push({ id: `f${e.id}`, apt: a.id, start: e.from, end: e.to, title: e.name, note: e.note || '', source: sourceLabel(a) });
    } else {
      const c = store.data.cache[a.id];
      (c?.events || []).forEach((e, i) => events.push({ id: `${a.id}-${e.uid || i}`, apt: a.id, start: e.start, end: e.end, title: e.summary, note: e.description || '', source: sourceLabel(a) }));
    }
  }
  const y = new Date().getFullYear();
  const holidays = [
    ...(store.data.holidays?.items || []),
    ...store.data.manualHolidays.map(h => ({ start: h.start, end: h.end, name: h.name, kind: 'school' })),
  ];
  const seasons = expandSeasons(store.data.seasons, [y - 1, y, y + 1, y + 2]);
  return { apartments, events, holidays, seasons, serverTime: new Date().toISOString() };
}

/* ---------- HTTP-Helfer ---------- */

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new Error('zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('ungültiges JSON')); } });
    req.on('error', reject);
  });
}

function serveStatic(res, urlPath, mode) {
  let p = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Verboten', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
    if (p === '/index.html') buf = Buffer.from(buf.toString('utf8').replace('data-mode="view"', `data-mode="${mode}"`));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': p === '/index.html' ? 'no-store' : 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

/* ---------- Routen ---------- */

async function handle(req, res, mode) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // Eigener Fewo-1-Feed (iCal), geschützt durch geheimen Token im Pfad
  const feed = p.match(/^\/ical\/fewo-(\d+)-([a-f0-9]+)\.ics$/);
  if (feed && req.method === 'GET') {
    const apt = store.apartment(+feed[1]);
    if (!apt || apt.source !== 'own' || !safeEqual(feed[2], store.data.feedToken)) return send(res, 404, 'Nicht gefunden', 'text/plain');
    return send(res, 200, buildICS(store.data.firm, { name: `${apt.name} ${apt.nick}` }), 'text/calendar; charset=utf-8');
  }

  // Zugangsschutz
  if (mode === 'view' && VIEW_KEY) {
    const given = url.searchParams.get('key');
    if (given && safeEqual(given, VIEW_KEY)) {
      return send(res, 302, '', 'text/plain', { Location: '/', 'Set-Cookie': `fk=${encodeURIComponent(VIEW_KEY)}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (!safeEqual(cookies(req).fk || '', VIEW_KEY)) return send(res, 401, 'Bitte den Einrichtungs-Link verwenden.', 'text/plain; charset=utf-8');
  }
  if (mode === 'admin' && ADMIN_PASSWORD) {
    const h = req.headers.authorization || '';
    const pass = h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':') : '';
    if (!safeEqual(pass, ADMIN_PASSWORD)) return send(res, 401, 'Anmeldung nötig', 'text/plain; charset=utf-8', { 'WWW-Authenticate': 'Basic realm="Fewo-Kalender Verwaltung", charset="UTF-8"' });
  }

  if (p === '/api/info') return send(res, 200, { mode });
  if (p === '/api/calendar' && req.method === 'GET') return send(res, 200, calendarPayload());

  if (p.startsWith('/api/admin/')) {
    if (mode !== 'admin') return send(res, 403, { error: 'Nur über die PC-Ansicht möglich.' });
    try { return await handleAdmin(req, res, p, url); }
    catch (e) { return send(res, 400, { error: e.message }); }
  }

  if (p.startsWith('/api/')) return send(res, 404, { error: 'Unbekannt' });
  if (req.method !== 'GET') return send(res, 405, 'Methode nicht erlaubt', 'text/plain');
  return serveStatic(res, p, mode);
}

function feedPath() {
  const own = store.data.apartments.find(a => a.source === 'own');
  return own ? `/ical/fewo-${own.id}-${store.data.feedToken}.ics` : null;
}

function cleanFirm(e) {
  const from = String(e.from || ''), to = String(e.to || '');
  if (!isValidDay(from) || !isValidDay(to)) throw new Error('Bitte gültige Daten angeben.');
  if (to <= from) throw new Error('„Bis“ muss nach „Von“ liegen.');
  return { from, to, name: String(e.name || '').slice(0, 120).trim() || 'Firma', note: String(e.note || '').slice(0, 300) };
}

async function handleAdmin(req, res, p, url) {
  const m = req.method;
  const d = store.data;

  if (p === '/api/admin/config' && m === 'GET') {
    return send(res, 200, {
      apartments: d.apartments.map(a => ({ ...a, icalUrl: undefined, hasUrl: !!a.icalUrl, urlHost: a.icalUrl ? safeHost(a.icalUrl) : '' })),
      settings: d.settings, colors: COLORS,
      feedUrl: feedPath() ? `${PUBLIC_URL || `http://${(req.headers.host || 'localhost').replace(/:\d+$/, '')}:${VIEW_PORT}`}${feedPath()}` : '',
      status: d.apartments.map(a => ({ id: a.id, ...(d.cache[a.id] ? { fetchedAt: d.cache[a.id].fetchedAt, error: d.cache[a.id].error, count: d.cache[a.id].events?.length || 0 } : {}) })),
      firm: [...d.firm].sort((a, b) => a.from.localeCompare(b.from)),
      seasons: d.seasons,
      manualHolidays: d.manualHolidays,
      holidayStatus: { fetchedAt: d.holidays?.fetchedAt || null, error: d.holidays?.error || null, count: d.holidays?.items?.length || 0 },
    });
  }

  let am = p.match(/^\/api\/admin\/apartments\/(\d+)$/);
  if (am && m === 'PUT') {
    const apt = store.apartment(+am[1]);
    if (!apt) throw new Error('Wohnung unbekannt');
    const b = await readJson(req);
    if (b.nick !== undefined) apt.nick = String(b.nick).slice(0, 40).trim() || apt.name;
    if (b.color !== undefined) { if (!COLORS.includes(b.color)) throw new Error('Farbe unbekannt'); apt.color = b.color; }
    if (b.source !== undefined) { if (!['ical', 'own'].includes(b.source)) throw new Error('Quelle unbekannt'); apt.source = b.source; }
    if (b.icalUrl !== undefined) {
      const u = String(b.icalUrl).trim();
      if (u && !/^https?:\/\//i.test(u)) throw new Error('Der Link muss mit https:// beginnen.');
      apt.icalUrl = u; delete d.cache[apt.id];
    }
    store.save();
    if (b.icalUrl !== undefined || b.source !== undefined) await fetchApartment(apt), store.save();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/apartments/order' && m === 'PUT') {
    const { ids } = await readJson(req);
    if (!Array.isArray(ids) || ids.length !== d.apartments.length || !d.apartments.every(a => ids.includes(a.id))) throw new Error('Reihenfolge ungültig');
    d.apartments.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    store.save();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/settings' && m === 'PUT') {
    const b = await readJson(req);
    const n = +b.intervalMinutes;
    if (![5, 10, 15, 30, 60].includes(n)) throw new Error('Intervall ungültig');
    d.settings.intervalMinutes = n; store.save(); schedule();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/refresh' && m === 'POST') { await Promise.all([refreshAll(), fetchHolidays(store)]); store.save(); return send(res, 200, { ok: true }); }

  // Saisons (jährlich wiederkehrend)
  if (p === '/api/admin/seasons' && m === 'POST') {
    const s = cleanSeason(await readJson(req));
    const entry = { id: store.nextId('seasons'), ...s };
    d.seasons.push(entry); store.save();
    return send(res, 200, entry);
  }
  const sm = p.match(/^\/api\/admin\/seasons\/(\d+)$/);
  if (sm && m === 'PUT') {
    const entry = d.seasons.find(e => e.id === +sm[1]);
    if (!entry) throw new Error('Saison unbekannt');
    Object.assign(entry, cleanSeason({ ...entry, ...(await readJson(req)) })); store.save();
    return send(res, 200, entry);
  }
  if (sm && m === 'DELETE') { d.seasons = d.seasons.filter(e => e.id !== +sm[1]); store.save(); return send(res, 200, { ok: true }); }

  // Eigene Ferien-/Sperrzeiträume (z. B. wenn der Abruf nicht klappt)
  if (p === '/api/admin/holidays' && m === 'POST') {
    const b = await readJson(req);
    const start = String(b.start || ''), endIncl = String(b.end || '');
    if (!isValidDay(start) || !isValidDay(endIncl) || endIncl < start) throw new Error('Bitte gültige Daten angeben.');
    const entry = { id: store.nextId('manualHolidays'), start, end: addDays(endIncl, 1), name: String(b.name || 'Ferien').slice(0, 60) };
    d.manualHolidays.push(entry); store.save();
    return send(res, 200, entry);
  }
  const hm = p.match(/^\/api\/admin\/holidays\/(\d+)$/);
  if (hm && m === 'DELETE') { d.manualHolidays = d.manualHolidays.filter(e => e.id !== +hm[1]); store.save(); return send(res, 200, { ok: true }); }

  if (p === '/api/admin/feed-token' && m === 'POST') {
    d.feedToken = crypto.randomBytes(12).toString('hex'); store.save();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/firm' && m === 'POST') {
    const e = cleanFirm(await readJson(req));
    const entry = { id: store.nextFirmId(), ...e };
    d.firm.push(entry); store.save();
    return send(res, 200, entry);
  }
  const fm = p.match(/^\/api\/admin\/firm\/(\d+)$/);
  if (fm && m === 'PUT') {
    const entry = d.firm.find(e => e.id === +fm[1]);
    if (!entry) throw new Error('Eintrag unbekannt');
    Object.assign(entry, cleanFirm({ ...entry, ...(await readJson(req)) }));
    store.save();
    return send(res, 200, entry);
  }
  if (fm && m === 'DELETE') {
    d.firm = d.firm.filter(e => e.id !== +fm[1]); store.save();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/firm/bulk' && m === 'POST') {
    const { ids, action, days } = await readJson(req);
    if (!Array.isArray(ids)) throw new Error('Keine Einträge gewählt');
    const set = new Set(ids.map(Number));
    if (action === 'delete') d.firm = d.firm.filter(e => !set.has(e.id));
    else if (action === 'shift') {
      const n = Math.trunc(+days);
      if (!Number.isFinite(n) || Math.abs(n) > 3650) throw new Error('Tage ungültig');
      d.firm.filter(e => set.has(e.id)).forEach(e => { e.from = addDays(e.from, n); e.to = addDays(e.to, n); });
    } else throw new Error('Aktion unbekannt');
    store.save();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/firm/paste' && m === 'POST') {
    const { text } = await readJson(req);
    const rows = parsePastedPlan(text || '');
    rows.forEach(r => d.firm.push({ id: store.nextFirmId(), ...r }));
    store.save();
    return send(res, 200, { added: rows.length });
  }

  return send(res, 404, { error: 'Unbekannt' });
}

function cleanSeason(s) {
  const md = v => /^\d{2}-\d{2}$/.test(v) && isValidDay(`2024-${v}`);
  if (!['haupt', 'neben'].includes(s.kind)) throw new Error('Art muss Haupt- oder Nebensaison sein.');
  if (!md(s.from) || !md(s.to)) throw new Error('Bitte Tag und Monat angeben.');
  return { kind: s.kind, from: s.from, to: s.to, label: String(s.label || '').slice(0, 40) || (s.kind === 'haupt' ? 'Hauptsaison' : 'Nebensaison') };
}

function safeHost(u) { try { return new URL(u).host; } catch { return ''; } }

/* ---------- Start ---------- */

function start(port, mode) {
  const server = http.createServer((req, res) => {
    handle(req, res, mode).catch(e => { console.error(e); if (!res.headersSent) send(res, 500, { error: 'Interner Fehler' }); });
  });
  server.listen(port, () => console.log(`Fewo-Kalender ${mode === 'view' ? 'iPad-Ansicht' : 'PC-Verwaltung'}: http://localhost:${port}`));
  return server;
}

start(VIEW_PORT, 'view');
start(ADMIN_PORT, 'admin');
schedule();
refreshAll();
// Ferien beim Start und dann täglich aktualisieren
fetchHolidays(store).then(() => store.save());
setInterval(() => fetchHolidays(store).then(() => store.save()), 24 * 3600000);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('Beende …'); process.exit(0); });
