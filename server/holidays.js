// Schulferien und Feiertage Baden-Württemberg über die OpenHolidays-API (openholidaysapi.org, kostenlos, ohne Schlüssel).
// Ergebnis wird gespeichert; schlägt der Abruf fehl, bleibt der letzte Stand erhalten.
// Zusätzlich lassen sich Zeiträume von Hand ergänzen (Einstellungen am PC).

import { addDays, isValidDay } from './ical.js';

const API = 'https://openholidaysapi.org';
const REGION = process.env.HOLIDAY_REGION || 'DE-BW';

function pickName(names) {
  if (!Array.isArray(names)) return '';
  return (names.find(n => n.language === 'DE') || names[0] || {}).text || '';
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function mapOpenHolidays(list, kind) {
  return (Array.isArray(list) ? list : [])
    .filter(h => isValidDay(h.startDate) && isValidDay(h.endDate))
    .map(h => ({ start: h.startDate, end: addDays(h.endDate, 1), name: pickName(h.name) || (kind === 'school' ? 'Ferien' : 'Feiertag'), kind }));
}

export async function fetchHolidays(store) {
  const y = new Date().getFullYear();
  // Die API erlaubt höchstens 1095 Tage pro Abfrage, daher zwei Abfragen: Vorjahr bis nächstes Jahr, dann übernächstes Jahr.
  const ranges = [[`${y - 1}-01-01`, `${y + 1}-12-31`], [`${y + 2}-01-01`, `${y + 2}-12-31`]];
  const prev = store.data.holidays || {};
  try {
    const items = [];
    for (const [from, to] of ranges) {
      const q = `countryIsoCode=DE&subdivisionCode=${REGION}&languageIsoCode=DE&validFrom=${from}&validTo=${to}`;
      const [school, pub] = await Promise.all([
        getJson(`${API}/SchoolHolidays?${q}`),
        getJson(`${API}/PublicHolidays?${q}`),
      ]);
      items.push(...mapOpenHolidays(school, 'school'), ...mapOpenHolidays(pub, 'public'));
    }
    // doppelte Einträge (Ferien über den Jahreswechsel) entfernen
    const seen = new Set();
    const unique = items.filter(h => { const k = `${h.kind}|${h.start}|${h.end}|${h.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!unique.length) throw new Error('Keine Daten erhalten');
    store.data.holidays = { fetchedAt: new Date().toISOString(), error: null, items: unique };
  } catch (e) {
    store.data.holidays = { ...prev, error: e.message, items: prev.items || [] };
    console.error('Ferien-Abruf fehlgeschlagen:', e.message);
  }
}

// Saisons sind jährlich wiederkehrend ("MM-DD" bis "MM-DD", inklusive). Über den Jahreswechsel ist erlaubt.
export function expandSeasons(seasons, years) {
  const out = [];
  for (const s of seasons || []) {
    if (!/^\d{2}-\d{2}$/.test(s.from) || !/^\d{2}-\d{2}$/.test(s.to)) continue;
    for (const y of years) {
      const start = `${y}-${s.from}`;
      const endYear = s.to < s.from ? y + 1 : y;
      const endIncl = `${endYear}-${s.to}`;
      if (!isValidDay(start) || !isValidDay(endIncl)) continue;
      out.push({ start, end: addDays(endIncl, 1), kind: s.kind, name: s.label || (s.kind === 'haupt' ? 'Hauptsaison' : 'Nebensaison') });
    }
  }
  return out;
}
