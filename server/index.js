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
import { parseICS, buildICS, parsePastedPlan, parsePlanText, isValidDay, addDays } from './ical.js';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { monthPdf } from './report.js';
import { fetchHolidays, expandSeasons, copySeasons } from './holidays.js';
import { smoobuConfigured, smoobuAuthMode, listApartments as smoobuApartments, fetchReservations } from './smoobu.js';
import * as G from './guests.js';
import * as INV from './invoices.js';
import { loadImage } from './image.js';
import { comparePortal, cleanPortal } from './portals.js';
import { contractPdf, cleanContract, ensureContract, DEFAULT_CONTRACT, DEFAULT_TERMS_INVOICE, DEFAULT_TERMS_CONTRACT, PLACEHOLDERS, appendTerms, termsSnapshot } from './contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const VIEW_PORT = +(process.env.VIEW_PORT || 8080);
const ADMIN_PORT = +(process.env.ADMIN_PORT || 8081);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const VIEW_KEY = process.env.VIEW_KEY || '';          // optional: Zugangsschlüssel für die iPad-Ansicht
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''; // optional: Passwort für die PC-Ansicht
// Testbetrieb für Rechnungen: TEST-Nummern, Wasserzeichen, eigener Ablageordner, zählen nicht im echten USt-Bericht
const INVOICE_TEST_MODE = /^(1|true|ja|yes)$/i.test(process.env.INVOICE_TEST_MODE || '');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, ''); // z. B. https://kalender.example.de (Adresse der iPad-Ansicht)

const store = new Store(DATA_DIR);
const COLORS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

/* ---------- iCal-Abruf ---------- */

async function fetchIcs(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Fewo-Kalender/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Antwort ist kein iCal-Kalender');
  return parseICS(text).map(e => ({ uid: e.uid || '', start: e.start, end: e.end, summary: e.summary || '', description: e.description || '' }));
}

// Portal-Kalender (nur zur Kontrolle, fließen nicht in den Kalender ein)
async function fetchPortal(pt) {
  if (!pt.icalUrl) return;
  const cache = (store.data.portalCache ||= {});
  const prev = cache[pt.id] || {};
  try {
    cache[pt.id] = { fetchedAt: new Date().toISOString(), error: null, events: await fetchIcs(pt.icalUrl) };
  } catch (e) {
    cache[pt.id] = { ...prev, error: e.message, failedAt: new Date().toISOString(), events: prev.events || [] };
    console.error(`Abruf Portal ${pt.name} fehlgeschlagen:`, e.message);
  }
}

// Quelle "ical": Ergebnis direkt in den Cache. Quelle "smoobu": iCal-Link als Ersatz (backup) mit abrufen.
async function fetchApartment(apt) {
  if (!['ical', 'smoobu'].includes(apt.source) || !apt.icalUrl) return;
  const target = apt.source === 'ical' ? store.data.cache : (store.data.backup ||= {});
  const prev = target[apt.id] || {};
  try {
    const events = await fetchIcs(apt.icalUrl);
    target[apt.id] = { fetchedAt: new Date().toISOString(), error: null, events };
  } catch (e) {
    // letzten Stand behalten, Fehler merken
    target[apt.id] = { ...prev, error: `${e.message}`, failedAt: new Date().toISOString(), events: prev.events || [] };
    console.error(`Abruf ${apt.name} fehlgeschlagen:`, e.message);
  }
}

/* ---------- Smoobu-API-Abruf (alle Wohnungen mit Quelle "smoobu" in einem Durchgang) ---------- */

let lastSmoobuCount = -1;
async function fetchSmoobu() {
  const apts = store.data.apartments.filter(a => a.source === 'smoobu' && a.smoobuId);
  if (!apts.length) return;
  const y = new Date().getFullYear();
  try {
    const from = `${y - 1}-01-01`, to = `${y + 2}-12-31`;
    const all = await fetchReservations(from, to);
    if (all.length !== lastSmoobuCount) console.log(`Smoobu-API: ${all.length} Buchungen abgerufen.`);
    lastSmoobuCount = all.length;
    const now = new Date().toISOString();
    for (const a of apts) {
      const events = all.filter(b => String(b.aptId) === String(a.smoobuId)).map(b => ({
        uid: b.uid, start: b.start, end: b.end, summary: b.summary,
        description: b.notice, phone: b.phone, email: b.email, adults: b.adults, children: b.children, channel: b.channel, blocked: b.blocked,
      }));
      store.data.cache[a.id] = { fetchedAt: now, error: null, events };
    }
    syncGuests(all, { from, to });
  } catch (e) {
    for (const a of apts) {
      const prev = store.data.cache[a.id] || {};
      store.data.cache[a.id] = { ...prev, error: e.message, failedAt: new Date().toISOString(), events: prev.events || [] };
    }
    console.error('Smoobu-Abruf fehlgeschlagen:', e.message);
  }
}

// Gäste und Aufenthalte aus Smoobu in die eigene Gästedatenbank übernehmen (bleibt auch ohne Smoobu erhalten)
function aptBySmoobu() {
  return Object.fromEntries(store.data.apartments.filter(a => a.smoobuId).map(a => [String(a.smoobuId), a.id]));
}
function syncGuests(bookings, window) {
  try {
    const r = G.syncBookings(store.data, bookings, aptBySmoobu(), window);
    if (r.newGuests || r.newStays) console.log(`Gästedatenbank: ${r.newGuests} neue Gäste, ${r.newStays} neue Aufenthalte.`);
    return r;
  } catch (e) { console.error('Gästedatenbank: Abgleich fehlgeschlagen:', e.message); return null; }
}

// Klappt der Smoobu-API-Abruf nicht (Fehler oder kein Zugang), zeigt der Kalender den iCal-Stand.
function applyFallback() {
  for (const a of store.data.apartments) {
    if (a.source !== 'smoobu') continue;
    const c = store.data.cache[a.id] || {};
    const bk = store.data.backup?.[a.id];
    const apiOk = smoobuConfigured() && a.smoobuId && c.fetchedAt && !c.error;
    if (apiOk || !a.icalUrl || !bk?.fetchedAt || bk.error) continue;
    const why = !smoobuConfigured() ? 'kein API-Zugang in .env' : !a.smoobuId ? 'keine Smoobu-Wohnung zugeordnet' : c.error || 'noch kein API-Abruf';
    if (!c.fallback || c.fallbackWhy !== why) console.log(`${a.name}: Smoobu-API nicht nutzbar (${why}), zeige iCal-Stand.`);
    store.data.cache[a.id] = { ...c, events: bk.events, fallback: true, fallbackAt: bk.fetchedAt, fallbackWhy: why };
  }
}

let refreshing = null;
async function refreshAll() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    await Promise.all([...store.data.apartments.map(fetchApartment), fetchSmoobu(), ...(store.data.portals || []).map(fetchPortal)]);
    applyFallback();
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
function isConfigured(a) { return a.source === 'own' || (a.source === 'ical' && !!a.icalUrl) || (a.source === 'smoobu' && ((!!a.smoobuId && smoobuConfigured()) || !!a.icalUrl)); }

function calendarPayload() {
  const apartments = store.data.apartments.map(a => {
    const c = store.data.cache[a.id] || {};
    return { id: a.id, name: a.name, nick: a.nick, color: a.color, source: a.source,
      configured: isConfigured(a), via: a.source === 'own' ? 'own' : a.source === 'ical' ? 'ical' : c.fallback ? 'ical-ersatz' : 'api', fetchedAt: a.source === 'own' ? null : (c.fallback ? c.fallbackAt : c.fetchedAt) || null, error: a.source === 'own' || c.fallback ? null : c.error || null };
  });
  const events = [];
  for (const a of store.data.apartments) {
    if (a.source === 'own') {
      for (const e of store.data.firm) events.push({ id: `f${e.id}`, apt: a.id, start: e.from, end: e.to, title: e.name, note: e.note || '', phone: e.phone || '', mobile: e.mobile || '', email: e.email || '', source: sourceLabel(a) });
    } else {
      const c = store.data.cache[a.id];
      (c?.events || []).forEach((e, i) => {
        const persons = e.adults || e.children ? `${(e.adults || 0) + (e.children || 0)} Reisende${e.children ? `, davon ${e.children} Kind${e.children > 1 ? 'er' : ''}` : ''}` : '';
        const vi = a.source === 'smoobu' && !c.fallback && e.uid ? G.visitInfo(store.data, e.uid) : null;
        events.push({ id: `${a.id}-${e.uid || i}`, apt: a.id, start: e.start, end: e.end, title: e.summary, note: [persons, e.description].filter(Boolean).join(' · '),
          phone: e.phone || '', mobile: '', email: e.email || '', channel: e.channel || '', source: sourceLabel(a),
          ...(vi ? { guestId: vi.guestId, visit: vi.visit } : {}) });
      });
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

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Datei zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function pdfToText(buf) {
  return new Promise((resolve, reject) => {
    if (buf.subarray(0, 5).toString() !== '%PDF-') return reject(new Error('Das ist keine PDF-Datei.'));
    const file = path.join(os.tmpdir(), `plan-${crypto.randomBytes(6).toString('hex')}.pdf`);
    fs.writeFileSync(file, buf);
    execFile('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { timeout: 20000, maxBuffer: 5e6 }, (err, out) => {
      fs.rm(file, () => {});
      if (err) return reject(new Error(err.code === 'ENOENT' ? 'PDF-Import ist auf diesem Server nicht verfügbar (pdftotext fehlt).' : 'PDF konnte nicht gelesen werden.'));
      resolve(out);
    });
  });
}

function readJson(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('zu groß')); req.destroy(); } else chunks.push(c); });
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
    return send(res, 200, buildICS(store.data.firm, { name: `${apt.name} ${apt.nick}`, includeNotes: false }), 'text/calendar; charset=utf-8');
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
  const pdfm = p === '/export/monat.pdf' && req.method === 'GET';
  if (pdfm) {
    const ym = url.searchParams.get('m') || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return send(res, 400, 'Monat bitte als JJJJ-MM angeben.', 'text/plain; charset=utf-8');
    const { buffer, filename } = monthPdf(calendarPayload(), ym, { contacts: url.searchParams.get('kontakt') !== '0' });
    return send(res, 200, buffer, 'application/pdf', { 'Content-Disposition': `inline; filename="${filename}"` });
  }

  if (p.startsWith('/api/admin/') || p === '/export/gaeste.csv' || p.startsWith('/export/rechnung/') || p.startsWith('/export/mietvertrag/') || p.startsWith('/export/ust-bericht.')) {
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
  const s = (v, n) => String(v || '').slice(0, n).trim();
  return { from, to, name: s(e.name, 120) || 'Firma', note: s(e.note, 300), phone: s(e.phone, 40), mobile: s(e.mobile, 40), email: s(e.email, 200) };
}

async function handleAdmin(req, res, p, url) {
  const m = req.method;
  const d = store.data;

  if (p === '/api/admin/config' && m === 'GET') {
    return send(res, 200, {
      apartments: d.apartments.map(a => ({ ...a, icalUrl: undefined, hasUrl: !!a.icalUrl, urlHost: a.icalUrl ? safeHost(a.icalUrl) : '' })),
      smoobu: { configured: smoobuConfigured(), auth: smoobuAuthMode() },
      settings: d.settings, colors: COLORS,
      feedUrl: feedPath() ? `${PUBLIC_URL || `http://${(req.headers.host || 'localhost').replace(/:\d+$/, '')}:${process.env.IPAD_PORT || VIEW_PORT}`}${feedPath()}` : '',
      status: d.apartments.map(a => ({ id: a.id, ...(d.cache[a.id] ? { fetchedAt: d.cache[a.id].fetchedAt, error: d.cache[a.id].error, count: d.cache[a.id].events?.length || 0, fallback: !!d.cache[a.id].fallback, fallbackAt: d.cache[a.id].fallbackAt || null } : {}),
        backup: d.backup?.[a.id] ? { fetchedAt: d.backup[a.id].fetchedAt, error: d.backup[a.id].error, count: d.backup[a.id].events?.length || 0 } : null })),
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
    if (b.source !== undefined) { if (!['ical', 'own', 'smoobu'].includes(b.source)) throw new Error('Quelle unbekannt'); apt.source = b.source; delete d.cache[apt.id];
      // Smoobu-API: Abruf alle 5 Minuten als Standard
      if (b.source === 'smoobu' && d.settings.intervalMinutes > 5) { d.settings.intervalMinutes = 5; schedule(); } }
    if (b.smoobuId !== undefined) { apt.smoobuId = b.smoobuId ? String(b.smoobuId).replace(/\D/g, '') : ''; delete d.cache[apt.id]; }
    if (b.icalUrl !== undefined) {
      const u = String(b.icalUrl).trim();
      if (u && !/^https?:\/\//i.test(u)) throw new Error('Der Link muss mit https:// beginnen.');
      apt.icalUrl = u; if (apt.source === 'ical') delete d.cache[apt.id]; if (d.backup) delete d.backup[apt.id];
    }
    store.save();
    if (b.icalUrl !== undefined || b.source !== undefined || b.smoobuId !== undefined) { await Promise.all([fetchApartment(apt), fetchSmoobu()]); applyFallback(); store.save(); }
    return send(res, 200, { ok: true });
  }

  // Portal-Abgleich
  if (p === '/api/admin/portals' && m === 'GET') {
    const months = Math.min(18, Math.max(1, +url.searchParams.get('months') || 6));
    const now = new Date();
    const from = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const to = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1 + months, 1)).toISOString().slice(0, 10);
    const aptEvents = Object.fromEntries(d.apartments.map(a => [a.id, a.source === 'own'
      ? d.firm.map(e => ({ start: e.from, end: e.to }))
      : (d.cache[a.id]?.events || []).map(e => ({ start: e.start, end: e.end }))]));
    const portals = (d.portals || []).map(pt => {
      const c = d.portalCache?.[pt.id] || {};
      const aptIds = pt.apts.filter(id => d.apartments.some(a => a.id === id));
      const cmp = pt.icalUrl && c.fetchedAt ? comparePortal({ aptIds, aptEvents, portalEvents: c.events || [], from, to }) : null;
      return { id: pt.id, name: pt.name, apts: aptIds, hasUrl: !!pt.icalUrl, urlHost: pt.icalUrl ? safeHost(pt.icalUrl) : '',
        fetchedAt: c.fetchedAt || null, error: c.error || null, count: c.events?.length || 0,
        events: (c.events || []).filter(e => e.end > from && e.start < to).map(e => ({ start: e.start, end: e.end, summary: e.summary })),
        ...(cmp || {}) };
    });
    return send(res, 200, { from, to, months, portals,
      apartments: d.apartments.map(a => ({ id: a.id, name: a.name, nick: a.nick, color: a.color, source: a.source })) });
  }
  if (p === '/api/admin/portals' && m === 'POST') {
    const b = await readJson(req);
    const c = cleanPortal(b, d.apartments);
    if (!c.name) throw new Error('Bitte einen Namen angeben.');
    const id = (d.portals || []).reduce((mx, x) => Math.max(mx, x.id), 0) + 1;
    (d.portals ||= []).push({ id, name: c.name, icalUrl: '', apts: c.apts || d.apartments.filter(a => a.source !== 'own').map(a => a.id) });
    store.save();
    return send(res, 200, { ok: true, id });
  }
  const ptm = p.match(/^\/api\/admin\/portals\/(\d+)$/);
  if (ptm && (m === 'PUT' || m === 'DELETE')) {
    const pt = (d.portals || []).find(x => x.id === +ptm[1]);
    if (!pt) throw new Error('Portal unbekannt');
    if (m === 'DELETE') { d.portals = d.portals.filter(x => x !== pt); if (d.portalCache) delete d.portalCache[pt.id]; store.save(); return send(res, 200, { ok: true }); }
    const b = await readJson(req);
    const c = cleanPortal(b, d.apartments);
    if (b.name !== undefined) { if (!c.name) throw new Error('Bitte einen Namen angeben.'); pt.name = c.name; }
    if (c.apts) pt.apts = c.apts;
    if (b.icalUrl !== undefined) {
      const u = String(b.icalUrl).trim();
      if (u && !/^https?:\/\//i.test(u)) throw new Error('Der Link muss mit https:// beginnen.');
      pt.icalUrl = u; if (d.portalCache) delete d.portalCache[pt.id];
    }
    store.save();
    if (b.icalUrl !== undefined) { await fetchPortal(pt); store.save(); }
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

  if (p === '/api/admin/smoobu/apartments' && m === 'GET') {
    return send(res, 200, { apartments: await smoobuApartments() });
  }

  if (p === '/api/admin/refresh' && m === 'POST') { await Promise.all([refreshAll(), fetchHolidays(store)]); store.save(); return send(res, 200, { ok: true }); }

  // Saisons (jährlich wiederkehrend)
  if (p === '/api/admin/seasons' && m === 'POST') {
    const s = cleanSeason(await readJson(req));
    const entry = { id: store.nextId('seasons'), ...s };
    d.seasons.push(entry); sortSeasons(); store.save();
    return send(res, 200, entry);
  }
  if (p === '/api/admin/seasons/copy' && m === 'POST') {
    const { fromYear, toYear } = await readJson(req);
    if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear === toYear) throw new Error('Jahre ungültig');
    if (d.seasons.some(s => String(s.from).startsWith(`${toYear}-`))) throw new Error(`Für ${toYear} gibt es schon Saisons. Bitte erst löschen oder einzeln anpassen.`);
    const copies = copySeasons(d.seasons, fromYear, toYear);
    if (!copies.length) throw new Error(`Für ${fromYear} sind keine Saisons eingetragen.`);
    for (const c of copies) d.seasons.push({ id: store.nextId('seasons'), ...c });
    sortSeasons(); store.save();
    return send(res, 200, { ok: true, added: copies.length });
  }
  const sm = p.match(/^\/api\/admin\/seasons\/(\d+)$/);
  if (sm && m === 'PUT') {
    const entry = d.seasons.find(e => e.id === +sm[1]);
    if (!entry) throw new Error('Saison unbekannt');
    Object.assign(entry, cleanSeason({ ...entry, ...(await readJson(req)) })); sortSeasons(); store.save();
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
  // Vorschau: Text oder PDF lesen, noch nichts speichern
  if (p === '/api/admin/firm/parse' && m === 'POST') {
    const { text } = await readJson(req);
    return send(res, 200, parsePlanText(text || ''));
  }
  if (p === '/api/admin/firm/pdf' && m === 'POST') {
    const text = await pdfToText(await readRaw(req, 5e6));
    return send(res, 200, parsePlanText(text));
  }
  // Übernehmen, optional bestehende Einträge im Zeitraum des Plans ersetzen
  if (p === '/api/admin/firm/import' && m === 'POST') {
    const { rows, replace } = await readJson(req);
    if (!Array.isArray(rows) || !rows.length) throw new Error('Keine Zeiträume zum Übernehmen.');
    const clean = rows.map(cleanFirm);
    let removed = 0;
    if (replace) {
      const min = clean.reduce((a, r) => (r.from < a ? r.from : a), clean[0].from);
      const max = clean.reduce((a, r) => (r.to > a ? r.to : a), clean[0].to);
      const before = d.firm.length;
      d.firm = d.firm.filter(e => !(e.from < max && e.to > min));
      removed = before - d.firm.length;
    } else {
      // exakte Dubletten nicht doppelt anlegen
      for (let i = clean.length - 1; i >= 0; i--) if (d.firm.some(e => e.from === clean[i].from && e.to === clean[i].to && e.name === clean[i].name)) clean.splice(i, 1);
    }
    clean.forEach(r => d.firm.push({ id: store.nextFirmId(), ...r }));
    store.save();
    return send(res, 200, { added: clean.length, removed });
  }

  if (p === '/api/admin/firm/paste' && m === 'POST') {
    const { text } = await readJson(req);
    const rows = parsePastedPlan(text || '');
    rows.forEach(r => d.firm.push({ id: store.nextFirmId(), ...r }));
    store.save();
    return send(res, 200, { added: rows.length });
  }

  const r = await handleGuests(req, res, p, m, d);
  if (r !== false) return r;
  const ri = await handleInvoices(req, res, p, m, d, url);
  if (ri !== false) return ri;

  return send(res, 404, { error: 'Unbekannt' });
}

/* ---------- Gästedatenbank ---------- */

async function handleGuests(req, res, p, m, d) {
  G.ensure(d);
  const aptName = id => d.apartments.find(a => a.id === id)?.name || '';
  if (p === '/export/gaeste.csv' && m === 'GET') {
    const day = new Date().toISOString().slice(0, 10);
    return send(res, 200, G.staysCsv(d, aptName), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="gaeste-${day}.csv"` });
  }
  if (p === '/api/admin/guests' && m === 'GET') {
    return send(res, 200, { guests: G.guestList(d), expired: G.expiredGuests(d).length, retentionYears: G.RETENTION_YEARS,
      smoobu: smoobuConfigured(), apartments: d.apartments.map(a => ({ id: a.id, name: a.name, nick: a.nick, color: a.color, source: a.source })) });
  }
  if (p === '/api/admin/guests' && m === 'POST') { const g = G.addGuest(d, await readJson(req)); store.save(); return send(res, 200, g); }
  if (p === '/api/admin/guests/merge' && m === 'POST') {
    const { keepId, dropId } = await readJson(req);
    const g = G.mergeGuests(d, +keepId, +dropId); store.save(); return send(res, 200, g);
  }
  if (p === '/api/admin/guests/cleanup' && m === 'POST') {
    const ids = G.expiredGuests(d); ids.forEach(id => G.deleteGuest(d, id)); store.save();
    return send(res, 200, { deleted: ids.length });
  }
  if (p === '/api/admin/guests/import' && m === 'POST') {
    const { fromYear } = await readJson(req);
    const y = new Date().getFullYear();
    if (!Number.isInteger(fromYear) || fromYear < 2000 || fromYear > y) throw new Error('Jahr ungültig');
    const from = `${fromYear}-01-01`, to = `${y + 2}-12-31`;
    const all = await fetchReservations(from, to);
    const r = G.syncBookings(d, all, aptBySmoobu(), { from, to }); store.save();
    return send(res, 200, { bookings: all.length, ...r });
  }
  const gm = p.match(/^\/api\/admin\/guests\/(\d+)$/);
  if (gm) {
    const g = d.guests.find(x => x.id === +gm[1]);
    if (!g) throw new Error('Gast unbekannt');
    if (m === 'GET') return send(res, 200, { guest: g, stays: G.guestStays(d, g.id), invoices: (d.invoices || []).filter(i => i.guestId === g.id).map(i => invSummary(d, i)) });
    if (m === 'PUT') { Object.assign(g, G.cleanGuest(await readJson(req), g), { updatedAt: new Date().toISOString() }); store.save(); return send(res, 200, g); }
    if (m === 'DELETE') { G.deleteGuest(d, g.id); store.save(); return send(res, 200, { ok: true }); }
  }
  const gs = p.match(/^\/api\/admin\/guests\/(\d+)\/stays$/);
  if (gs && m === 'POST') { const st = G.addStay(d, +gs[1], await readJson(req)); store.save(); return send(res, 200, st); }
  const sm = p.match(/^\/api\/admin\/stays\/(\d+)$/);
  if (sm && m === 'PUT') { const st = G.updateStay(d, +sm[1], await readJson(req)); store.save(); return send(res, 200, st); }
  if (sm && m === 'DELETE') { d.stays = d.stays.filter(x => x.id !== +sm[1]); store.save(); return send(res, 200, { ok: true }); }
  return false;
}

/* ---------- Rechnungen ---------- */

const INV_DIR = path.join(DATA_DIR, 'rechnungen');
const INV_TEST_DIR = path.join(DATA_DIR, 'rechnungen-test');
const LOGO_DIR = path.join(DATA_DIR, 'logo');
const DEFAULT_LOGO = path.join(__dirname, 'assets', 'logo-default.png');
let logoCache = { file: null, img: null };
// Logo für die Rechnung, falls eingeschaltet (aufbereitet und zwischengespeichert)
// Rechnung mit Hinweis „Bestätigung durch Anzahlung“ und angehängten Mietbedingungen (nicht bei Storno)
function termsOpts(inv, S) {
  const C = S.contract;
  if (!C?.attachTerms || inv.kind !== 'rechnung') return {};
  return { note: C.confirmText || '', appendPages: doc => appendTerms(doc, inv, S, C) };
}
function currentLogo(S) {
  if (!S.logo?.enabled || !S.logo.file) return null;
  if (logoCache.file !== S.logo.file) {
    try { logoCache = { file: S.logo.file, img: loadImage(fs.readFileSync(path.join(LOGO_DIR, S.logo.file))) }; }
    catch (e) { console.error('Logo nicht lesbar:', e.message); logoCache = { file: S.logo.file, img: null }; }
  }
  return logoCache.img;
}
// Beim ersten Start mit Rechnungen das mitgelieferte Logo übernehmen (einmalig, danach entscheidet die Einstellung)
function initLogo(d) {
  const S = d.invoiceSettings;
  if (S.logo.initialized || !fs.existsSync(DEFAULT_LOGO)) return;
  try {
    fs.mkdirSync(LOGO_DIR, { recursive: true });
    if (!S.logo.file) { fs.copyFileSync(DEFAULT_LOGO, path.join(LOGO_DIR, 'logo-standard.png')); S.logo = { enabled: true, file: 'logo-standard.png', name: 'Ferienwohnungen Eberle' }; }
    S.logo.initialized = true; store.save();
  } catch (e) { console.error('Logo konnte nicht angelegt werden:', e.message); }
}
const invDir = inv => (inv.test ? INV_TEST_DIR : INV_DIR);
function archive(inv) {
  // Festgeschriebene Rechnung einmalig als Datei ablegen (unveränderbar, GoBD); später wird nur diese Datei ausgeliefert
  fs.mkdirSync(invDir(inv), { recursive: true });
  const base = path.join(invDir(inv), inv.number.replace(/[^A-Za-z0-9-]/g, '_'));
  const xml = inv.eInvoice ? INV.xrechnungXml(inv) : null;
  const pdf = INV.invoicePdf(inv, { xml, ...termsOpts(inv, store.data.invoiceSettings), logo: currentLogo(store.data.invoiceSettings) }).buffer;
  const written = [];
  try {
    if (xml) { fs.writeFileSync(base + '.xml', xml, { flag: 'wx' }); written.push(base + '.xml'); }
    fs.writeFileSync(base + '.pdf', pdf, { flag: 'wx' }); written.push(base + '.pdf');
  } catch (e) { written.forEach(f => fs.rmSync(f, { force: true })); throw e; }
  inv.files = { pdf: path.basename(base) + '.pdf', xml: xml ? path.basename(base) + '.xml' : null };
}

function invSummary(d, i) {
  const t = i.status === 'entwurf' ? INV.totals(i.items, i.deposit) : i.totals;
  return { id: i.id, number: i.number, kind: i.kind, status: i.status, date: i.date || null, from: i.from, to: i.to, buyer: i.buyer.name, guestId: i.guestId, stayId: i.stayId,
    gross: t.gross, due: t.due, paidAt: i.paidAt || null, open: INV.openAmount(i), eInvoice: !!i.eInvoice, test: !!i.test, cancelledBy: i.cancelledBy || null, refNumber: i.refNumber || null, aptName: i.aptName };
}

async function handleInvoices(req, res, p, m, d, url) {
  INV.ensure(d);
  initLogo(d);
  d.invoiceSettings.contract = ensureContract(d.invoiceSettings.contract);
  const S = d.invoiceSettings;
  if (p === '/api/admin/invoice-logo' && m === 'GET') {
    if (!S.logo.file) return send(res, 404, 'Kein Logo', 'text/plain; charset=utf-8');
    const f = path.join(LOGO_DIR, S.logo.file);
    return send(res, 200, fs.readFileSync(f), /\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png', { 'Cache-Control': 'no-store' });
  }
  if (p === '/api/admin/invoice-logo' && m === 'POST') {
    const b = await readJson(req, 6e6);
    const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length || buf.length > 4e6) throw new Error('Bitte eine Bilddatei bis 4 MB wählen.');
    const img = loadImage(buf); // prüft das Format
    const file = `logo-${Date.now()}.${img.kind === 'jpeg' ? 'jpg' : 'png'}`;
    fs.mkdirSync(LOGO_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOGO_DIR, file), buf);
    const old = S.logo.file;
    S.logo = { enabled: true, file, name: String(b.name || '').slice(0, 120), initialized: true };
    if (old && old !== file) fs.rmSync(path.join(LOGO_DIR, old), { force: true });
    store.save(); return send(res, 200, { ok: true, settings: S });
  }
  if (p === '/api/admin/contract-settings' && m === 'PUT') {
    S.contract = cleanContract(await readJson(req, 2e5), S.contract); store.save(); return send(res, 200, { settings: S });
  }
  if (p === '/api/admin/contract-settings/reset' && m === 'POST') {
    // eine Vorlage (Rechnung oder Vertrag) auf den Ausgangstext zurücksetzen, oder aus der anderen übernehmen
    const { which, from } = await readJson(req);
    if (!['termsInvoice', 'termsContract'].includes(which)) throw new Error('Unbekannte Vorlage');
    S.contract[which] = from === 'other' ? structuredClone(S.contract[which === 'termsInvoice' ? 'termsContract' : 'termsInvoice'])
      : which === 'termsInvoice' ? DEFAULT_TERMS_INVOICE() : DEFAULT_TERMS_CONTRACT();
    store.save(); return send(res, 200, { settings: S });
  }
  const cx = p.match(/^\/export\/mietvertrag\/(\d+)\.pdf$/);
  if (cx && m === 'GET') {
    const inv = d.invoices.find(i => i.id === +cx[1] && i.kind === 'rechnung');
    if (!inv) return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
    const buf = contractPdf(inv, S, S.contract, { logo: currentLogo(S) });
    const fn = `Mietvertrag-${inv.buyer.name.replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '_')}-${inv.from}.pdf`;
    return send(res, 200, buf, 'application/pdf', { 'Content-Disposition': `inline; filename="${fn.replace(/[^\x20-\x7e]/g, '_')}"` });
  }
  if (p === '/api/admin/invoice-settings' && m === 'GET') return send(res, 200, { settings: S, year: new Date().getFullYear(), placeholders: PLACEHOLDERS });
  if (p === '/api/admin/invoice-settings' && m === 'PUT') { d.invoiceSettings = INV.cleanSettings(await readJson(req), S); store.save(); return send(res, 200, { settings: d.invoiceSettings }); }
  if (p === '/api/admin/invoices' && m === 'GET') {
    return send(res, 200, { invoices: [...d.invoices].sort((a, b) => (b.id - a.id)).map(i => invSummary(d, i)), taxation: S.taxation,
      testMode: INVOICE_TEST_MODE, testCount: d.invoices.filter(i => i.test).length, sellerReady: !!(S.seller.name && S.seller.taxNumber) });
  }
  if (p === '/api/admin/invoices' && m === 'POST') {
    const { stayId } = await readJson(req);
    const stay = (d.stays || []).find(x => x.id === +stayId);
    if (!stay) throw new Error('Aufenthalt unbekannt');
    const open = d.invoices.find(i => i.stayId === stay.id && i.kind === 'rechnung' && !i.cancelledBy);
    if (open) return send(res, 200, { id: open.id, existing: true });
    const guest = d.guests.find(g => g.id === stay.guestId);
    const inv = INV.draftFromStay(d, stay, guest, d.apartments.find(a => a.id === stay.aptId)?.name || '');
    store.save();
    return send(res, 200, { id: inv.id });
  }
  const rp = p.match(/^\/api\/admin\/ust-bericht$/);
  if ((rp && m === 'GET') || ((p === '/export/ust-bericht.pdf' || p === '/export/ust-bericht.csv') && m === 'GET')) {
    const kind = url.searchParams.get('art') === 'jahr' ? 'jahr' : 'quartal';
    const year = +url.searchParams.get('jahr'), q = +url.searchParams.get('q') || 1;
    if (!(year >= 2000 && year <= 2100) || !(q >= 1 && q <= 4)) throw new Error('Zeitraum ungültig');
    const rep = INV.vatReport(d, INV.periodOf(kind, year, q), undefined, { includeTest: INVOICE_TEST_MODE });
    if (rp) return send(res, 200, rep);
    const fn = `USt-Bericht-${kind === 'jahr' ? year : `${year}-Q${q}`}`;
    if (p.endsWith('.csv')) return send(res, 200, INV.vatReportCsv(rep), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${fn}.csv"` });
    return send(res, 200, INV.vatReportPdf(rep, S.seller.name), 'application/pdf', { 'Content-Disposition': `inline; filename="${fn}.pdf"` });
  }
  const ex = p.match(/^\/export\/rechnung\/(\d+)\.(pdf|xml)$/);
  if (ex && m === 'GET') {
    const inv = d.invoices.find(i => i.id === +ex[1]);
    if (!inv) return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
    const name = `${inv.kind === 'storno' ? 'Storno' : 'Rechnung'}-${inv.number || `Entwurf-${inv.id}`}`;
    if (ex[2] === 'xml') {
      if (inv.status !== 'ausgestellt' || !inv.files?.xml) throw new Error('Für diese Rechnung gibt es keine E-Rechnung.');
      return send(res, 200, fs.readFileSync(path.join(invDir(inv), inv.files.xml)), 'application/xml; charset=utf-8', { 'Content-Disposition': `attachment; filename="${name}.xml"` });
    }
    const buf = inv.status === 'ausgestellt' && inv.files?.pdf ? fs.readFileSync(path.join(invDir(inv), inv.files.pdf)) : INV.invoicePdf(inv, { draftSettings: S, logo: currentLogo(S), ...termsOpts(inv, S) }).buffer;
    return send(res, 200, buf, 'application/pdf', { 'Content-Disposition': `inline; filename="${name}.pdf"` });
  }
  if (p === '/api/admin/invoices/test-cleanup' && m === 'POST') {
    // Testrechnungen samt Storno und Dateien entfernen; echte Rechnungen bleiben unberührt
    const gone = new Set(d.invoices.filter(i => i.test).map(i => i.id));
    for (const i of d.invoices) if (gone.has(i.id) && i.files) for (const f of [i.files.pdf, i.files.xml]) if (f) fs.rmSync(path.join(INV_TEST_DIR, f), { force: true });
    d.invoices = d.invoices.filter(i => !gone.has(i.id));
    for (const i of d.invoices) { if (gone.has(i.cancelledBy)) delete i.cancelledBy; if (gone.has(i.replaces)) { delete i.replaces; delete i.replacesNumber; delete i.replacesDate; } }
    for (const k of Object.keys(d.invoiceSettings.counters)) if (k.startsWith('TEST-')) delete d.invoiceSettings.counters[k];
    store.save(); return send(res, 200, { ok: true, removed: gone.size });
  }
  const pm = p.match(/^\/api\/admin\/invoices\/(\d+)\/payments(?:\/(\d+))?$/);
  if (pm) {
    const inv = d.invoices.find(i => i.id === +pm[1]);
    if (!inv) throw new Error('Rechnung unbekannt');
    if (m === 'POST' && !pm[2]) { INV.addPayment(inv, await readJson(req)); store.save(); return send(res, 200, { ok: true }); }
    if (m === 'DELETE' && pm[2]) { INV.removePayment(inv, +pm[2]); store.save(); return send(res, 200, { ok: true }); }
  }
  const im = p.match(/^\/api\/admin\/invoices\/(\d+)(?:\/(recompute|issue|cancel|correct))?$/);
  if (!im) return false;
  const inv = d.invoices.find(i => i.id === +im[1]);
  if (!inv) throw new Error('Rechnung unbekannt');
  const act = im[2];
  if (!act && m === 'GET') {
    const t = inv.status === 'entwurf' ? INV.totals(inv.items, inv.deposit) : inv.totals;
    const today = new Date().toISOString().slice(0, 10);
    return send(res, 200, { invoice: inv, totals: t, missing: inv.status === 'entwurf' ? INV.checkIssuable(S, inv) : [], settings: S,
      schedule: inv.status === 'entwurf' ? INV.paymentSchedule(S, inv, today) : inv.schedule || [], payments: INV.paymentsOf(inv), open: INV.openAmount(inv) });
  }
  if (!act && m === 'PUT') { INV.updateDraft(d, inv, await readJson(req)); store.save(); return send(res, 200, { ok: true }); }
  if (!act && m === 'DELETE') {
    if (inv.status !== 'entwurf') throw new Error('Festgeschriebene Rechnungen werden nicht gelöscht, sondern storniert.');
    d.invoices = d.invoices.filter(i => i.id !== inv.id); store.save(); return send(res, 200, { ok: true });
  }
  if (act === 'recompute' && m === 'POST') { INV.recompute(d, inv); store.save(); return send(res, 200, { ok: true }); }
  if (act === 'issue' && m === 'POST') {
    const before = structuredClone(d.invoiceSettings.counters);
    INV.issue(d, inv, undefined, { test: INVOICE_TEST_MODE });
    if (inv.kind === 'rechnung') inv.terms = termsSnapshot(d.invoiceSettings.contract, inv.aptName);
    try { archive(inv); } catch (e) { inv.status = 'entwurf'; inv.number = null; delete inv.terms; d.invoiceSettings.counters = before; throw new Error(`Rechnung konnte nicht abgelegt werden: ${e.message}`); }
    store.save(); return send(res, 200, { ok: true, number: inv.number });
  }
  if (act === 'cancel' && m === 'POST') { const st = INV.cancel(d, inv); archive(st); store.save(); return send(res, 200, { ok: true, id: st.id, number: st.number }); }
  if (act === 'correct' && m === 'POST') {
    const { storno, draft } = INV.correct(d, inv); archive(storno); store.save();
    return send(res, 200, { ok: true, id: draft.id, number: storno.number });
  }
  return false;
}

function sortSeasons() { store.data.seasons.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)); }

function cleanSeason(s) {
  if (!['haupt', 'neben'].includes(s.kind)) throw new Error('Art muss Haupt- oder Nebensaison sein.');
  if (!isValidDay(s.from) || !isValidDay(s.to)) throw new Error('Bitte Datum mit Jahr angeben.');
  if (s.to < s.from) throw new Error('„Bis“ liegt vor „Von“.');
  if (addDays(s.from, 400) < s.to) throw new Error('Eine Saison kann höchstens ein gutes Jahr lang sein.');
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
