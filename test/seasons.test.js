import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSeasons, copySeasons, expandSeasons } from '../server/holidays.js';

test('alte Saisons ohne Jahr werden für zwei Jahre fest eingetragen', () => {
  const m = migrateSeasons([{ id: 1, kind: 'haupt', from: '07-01', to: '08-31', label: 'Hauptsaison' }], [2026, 2027]);
  assert.deepEqual(m.map(s => [s.from, s.to]), [['2026-07-01', '2026-08-31'], ['2027-07-01', '2027-08-31']]);
  assert.equal(migrateSeasons(m, [2026]), null);
});

test('Kopie ins Folgejahr behält die Wochentage', () => {
  const c = copySeasons([{ kind: 'haupt', from: '2026-07-04', to: '2026-09-05', label: 'H' }], 2026, 2027);
  assert.deepEqual([c[0].from, c[0].to], ['2027-07-03', '2027-09-04']);
  assert.equal(new Date(c[0].from).getUTCDay(), new Date('2026-07-04').getUTCDay());
});

test('feste Saison wird genau einmal ausgegeben, Ende exklusiv', () => {
  const e = expandSeasons([{ kind: 'neben', from: '2026-12-20', to: '2027-01-06' }], [2025, 2026, 2027]);
  assert.deepEqual(e, [{ start: '2026-12-20', end: '2027-01-07', kind: 'neben', name: 'Nebensaison' }]);
});
