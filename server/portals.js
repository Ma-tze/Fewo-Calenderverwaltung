// Abgleich der Portal-Kalender (ferienwohnungen-bodensee.de, bodenseeurlaub.de) mit der Belegung in der App.
// Beide Portale führen die Wohnungen als EIN Objekt. Erwartet wird daher:
//   Portal "belegt"  <=>  alle zugeordneten Wohnungen sind laut App (Smoobu) belegt.
// Gezählt wird nach Nächten: Ein Eintrag von 10.–14. belegt die Nächte 10., 11., 12. und 13.

import { addDays } from './ical.js';

export const DEFAULT_PORTALS = () => ([
  { id: 1, name: 'ferienwohnungen-bodensee.de', icalUrl: '', apts: [2, 3, 4] },
  { id: 2, name: 'bodenseeurlaub.de', icalUrl: '', apts: [2, 3, 4] },
]);

// Menge der belegten Nächte (YYYY-MM-DD) aus einer Liste von {start, end} im Bereich [from, to)
export function nights(events, from, to) {
  const s = new Set();
  for (const e of events || []) {
    if (!e?.start || !e?.end) continue;
    let d = e.start < from ? from : e.start;
    const end = e.end > to ? to : e.end;
    for (let i = 0; d < end && i < 4000; i++, d = addDays(d, 1)) s.add(d);
  }
  return s;
}

// Vergleicht Tag für Tag.
//   aptEvents: { aptId: [{start, end}] }   (Belegung laut App, je Wohnung)
//   portalEvents: [{start, end}]           (Export des Portals)
// Ergebnis: days[] mit Zustand je Nacht und ranges[] mit zusammengefassten Abweichungen.
//   state "ok-belegt"  alle Wohnungen belegt, Portal belegt
//   state "ok-frei"    mind. eine Wohnung frei, Portal frei
//   state "portal-zu"  Portal meldet belegt, in der App ist aber noch eine Wohnung frei
//   state "portal-offen" alle Wohnungen belegt, Portal zeigt frei (Gäste können anfragen)
export function comparePortal({ aptIds, aptEvents, portalEvents, from, to }) {
  const occ = Object.fromEntries(aptIds.map(id => [id, nights(aptEvents[id] || [], from, to)]));
  const portal = nights(portalEvents, from, to);
  const days = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    const busy = aptIds.filter(id => occ[id].has(d));
    const free = aptIds.filter(id => !occ[id].has(d));
    const all = aptIds.length > 0 && free.length === 0;
    const p = portal.has(d);
    const state = all && p ? 'ok-belegt' : !all && !p ? 'ok-frei' : p ? 'portal-zu' : 'portal-offen';
    days.push({ d, busy, free, portal: p, state });
  }
  const ranges = [];
  for (const x of days) {
    if (x.state.startsWith('ok')) continue;
    const last = ranges[ranges.length - 1];
    const key = x.state + '|' + x.free.join(',');
    if (last && last.key === key && last.to === x.d) { last.to = addDays(x.d, 1); last.nights++; continue; }
    ranges.push({ key, state: x.state, from: x.d, to: addDays(x.d, 1), nights: 1, free: x.free });
  }
  return {
    days,
    ranges: ranges.map(({ key, ...r }) => r),
    counts: {
      nights: days.length,
      ok: days.filter(x => x.state.startsWith('ok')).length,
      portalZu: days.filter(x => x.state === 'portal-zu').length,
      portalOffen: days.filter(x => x.state === 'portal-offen').length,
      portalNights: days.filter(x => x.portal).length,
    },
  };
}

export function cleanPortal(b, apartments) {
  const name = String(b.name ?? '').trim().slice(0, 80);
  const ids = new Set(apartments.map(a => a.id));
  const apts = Array.isArray(b.apts) ? [...new Set(b.apts.map(Number))].filter(id => ids.has(id)) : undefined;
  return { name, apts };
}
