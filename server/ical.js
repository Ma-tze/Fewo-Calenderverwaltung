// Minimaler iCal-Parser und -Generator für ganztägige Belegungen.
// Datumswerte werden durchgehend als "YYYY-MM-DD" (lokales Datum, Europe/Berlin) geführt.

const TZ = process.env.TZ_DISPLAY || 'Europe/Berlin';

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function escapeText(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export function icsDateToDay(value, params = []) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (hh && z) {
    // UTC-Zeitpunkt in lokales Datum umrechnen
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss));
    return dt.toLocaleDateString('sv-SE', { timeZone: TZ });
  }
  return `${y}-${mo}-${d}`;
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function parseICS(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start && cur.status !== 'CANCELLED') {
        if (!cur.end || cur.end <= cur.start) cur.end = addDays(cur.start, 1);
        events.push(cur);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    const val = line.slice(i + 1);
    switch (name.toUpperCase()) {
      case 'DTSTART': cur.start = icsDateToDay(val, params); break;
      case 'DTEND': cur.end = icsDateToDay(val, params); break;
      case 'SUMMARY': cur.summary = unescapeText(val).trim(); break;
      case 'DESCRIPTION': cur.description = unescapeText(val).trim(); break;
      case 'UID': cur.uid = val.trim(); break;
      case 'STATUS': cur.status = val.trim().toUpperCase(); break;
    }
  }
  return events;
}

function fold(line) {
  // Zeilen nach RFC 5545 auf max. 75 Zeichen falten (zeichenbasiert, reicht hier)
  const out = [];
  let rest = line;
  while (rest.length > 75) { out.push(rest.slice(0, 75)); rest = ' ' + rest.slice(75); }
  out.push(rest);
  return out.join('\r\n');
}

export function buildICS(entries, { name = 'Fewo-Kalender', uidDomain = 'fewo-kalender' } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fewo-Kalender//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const e of entries) {
    lines.push('BEGIN:VEVENT',
      `UID:${e.id}@${uidDomain}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${e.from.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${e.to.replace(/-/g, '')}`,
      `SUMMARY:${escapeText(e.name || 'Belegt')}`);
    if (e.note) lines.push(`DESCRIPTION:${escapeText(e.note)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Zeilen wie "04.05.2027 – 29.05.2027 Hr. Novak" oder "1.6.27 bis 30.6.27 Team B"
export function parsePastedPlan(text) {
  const re = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*(?:-|–|—|bis)\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*(.*)/i;
  const yr = y => (y.length === 2 ? 2000 + +y : +y);
  const pad = n => String(n).padStart(2, '0');
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    const from = `${yr(m[3])}-${pad(m[2])}-${pad(m[1])}`;
    const to = `${yr(m[6])}-${pad(m[5])}-${pad(m[4])}`;
    if (!isValidDay(from) || !isValidDay(to) || to <= from) continue;
    out.push({ from, to, name: m[7].trim() || 'Firma', note: '' });
  }
  return out;
}

export function isValidDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
