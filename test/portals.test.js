import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePortal, nights, cleanPortal } from '../server/portals.js';

test('nights zählt Nächte ohne Abreisetag und schneidet auf den Zeitraum zu', () => {
  const n = nights([{ start: '2026-11-28', end: '2026-12-02' }], '2026-12-01', '2026-12-10');
  assert.deepEqual([...n], ['2026-12-01']);
});

test('comparePortal: belegt nur, wenn alle Wohnungen belegt sind', () => {
  const aptEvents = {
    2: [{ start: '2027-07-03', end: '2027-07-17' }],
    3: [{ start: '2027-07-03', end: '2027-07-10' }],
    4: [{ start: '2027-07-01', end: '2027-07-12' }],
  };
  // Portal blockiert 03.–12.07. (zu lang: 10. und 11. ist Fewo 3 frei) und nichts sonst
  const portalEvents = [{ start: '2027-07-03', end: '2027-07-12' }];
  const r = comparePortal({ aptIds: [2, 3, 4], aptEvents, portalEvents, from: '2027-07-01', to: '2027-07-20' });
  assert.equal(r.counts.nights, 19);
  assert.equal(r.counts.portalZu, 2);
  assert.equal(r.counts.portalOffen, 0);
  assert.deepEqual(r.ranges, [{ state: 'portal-zu', from: '2027-07-10', to: '2027-07-12', nights: 2, free: [3] }]);
  assert.equal(r.days.find(x => x.d === '2027-07-05').state, 'ok-belegt');
  assert.equal(r.days.find(x => x.d === '2027-07-15').state, 'ok-frei');
});

test('comparePortal: alles belegt, Portal offen wird gemeldet', () => {
  const ev = [{ start: '2027-08-01', end: '2027-08-08' }];
  const r = comparePortal({ aptIds: [2, 3], aptEvents: { 2: ev, 3: ev }, portalEvents: [], from: '2027-08-01', to: '2027-08-10' });
  assert.deepEqual(r.ranges, [{ state: 'portal-offen', from: '2027-08-01', to: '2027-08-08', nights: 7, free: [] }]);
});

test('cleanPortal filtert unbekannte Wohnungen', () => {
  assert.deepEqual(cleanPortal({ name: ' X ', apts: [2, '3', 9, 2] }, [{ id: 2 }, { id: 3 }]), { name: 'X', apts: [2, 3] });
});
