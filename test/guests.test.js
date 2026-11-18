import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../server/guests.js';

const bk = (o) => ({ uid: '1', start: '2025-07-05', end: '2025-07-12', summary: 'Anna Berger', aptId: 38, email: '', phone: '', adults: 2, children: 0, channel: 'Airbnb', blocked: false, guestId: '', price: 700, pricePaid: true, ...o });

test('Stammgast wird über Smoobu-Gast-ID, E-Mail oder Telefon wiedererkannt', () => {
  const d = {};
  G.syncBookings(d, [
    bk({ uid: '1', guestId: '9' }),
    bk({ uid: '2', start: '2026-07-04', end: '2026-07-11', guestId: '9', price: 760 }),
    bk({ uid: '3', start: '2026-08-01', end: '2026-08-08', summary: 'Max Roth', email: 'Max@Example.org' }),
    bk({ uid: '4', start: '2027-08-07', end: '2027-08-14', summary: 'M. Roth', email: 'max@example.org' }),
    bk({ uid: '5', start: '2026-09-01', end: '2026-09-05', summary: 'Eva K', phone: '+49 170 1234567' }),
    bk({ uid: '6', start: '2027-09-01', end: '2027-09-05', summary: 'Eva Klein', phone: '0170/1234567' }),
    bk({ uid: '7', blocked: true }),
  ], { 38: 2 });
  assert.equal(d.guests.length, 3);
  assert.equal(d.stays.length, 6);
  assert.deepEqual(G.visitInfo(d, '2'), { guestId: 1, visit: 2 });
  assert.equal(G.visitInfo(d, '4').visit, 2);
  assert.equal(G.visitInfo(d, '6').visit, 2);
  assert.equal(d.stays[0].aptId, 2);
  assert.equal(d.stays[1].price, 760);
});

test('Abgleich ist wiederholbar, Storno wird markiert statt gelöscht, Handpreis bleibt', () => {
  const d = {};
  const list = [bk({ uid: '1' }), bk({ uid: '2', start: '2025-08-01', end: '2025-08-05' })];
  G.syncBookings(d, list, {}, { from: '2025-01-01', to: '2027-12-31' });
  G.updateStay(d, 1, { price: '650,50' });
  const r = G.syncBookings(d, [bk({ uid: '1', price: 999 })], {}, { from: '2025-01-01', to: '2027-12-31' });
  assert.equal(d.stays.length, 2);
  assert.equal(d.stays[0].price, 650.5);
  assert.equal(d.stays[1].status, 'storniert');
  assert.equal(r.newStays, 0);
  // Daten bleiben, auch wenn Smoobu gar nichts mehr liefert (Anbieterwechsel) und kein Zeitraum geprüft wird
  G.syncBookings(d, []);
  assert.equal(d.stays.length, 2);
});

test('Gästeliste, Doppelte, Zusammenführen und Löschfrist', () => {
  const d = {};
  G.syncBookings(d, [bk({ uid: '1', summary: 'Hr. Peter Müller' }), bk({ uid: '2', summary: 'Müller Peter', start: '2026-05-01', end: '2026-05-04', price: 300 })]);
  let list = G.guestList(d, '2026-11-18');
  assert.equal(list.length, 2);
  assert.ok(list.every(g => g.possibleDuplicate));
  G.mergeGuests(d, list[1].id, list[0].id);
  list = G.guestList(d, '2026-11-18');
  assert.equal(list.length, 1);
  assert.equal(list[0].visits, 2);
  assert.equal(list[0].revenue, 1000);
  assert.equal(list[0].lastStay.start, '2026-05-01');
  assert.deepEqual(G.expiredGuests(d, '2029-05-05'), [list[0].id]);
  assert.deepEqual(G.expiredGuests(d, '2029-05-03'), []);
});

test('Manuelle Gäste und Aufenthalte, CSV-Export', () => {
  const d = {};
  const g = G.addGuest(d, { name: 'Familie Weber', email: 'w@example.de', ads: 'ja' });
  G.addStay(d, g.id, { start: '2026-06-06', end: '2026-06-13', aptId: 3, price: '1.050,00', adults: 2, children: 2, channel: 'ferienwohnungen-bodensee.de' });
  assert.throws(() => G.addStay(d, g.id, { start: '2026-06-13', end: '2026-06-06' }));
  assert.throws(() => G.addGuest(d, { name: '' }));
  const csv = G.staysCsv(d);
  assert.ok(csv.startsWith('﻿Gast-Nr;Name'));
  assert.match(csv, /Familie Weber;w@example\.de;;;ja;;2026-06-06;2026-06-13;7;Fewo 3;2;2;1050,00;150,00;ferienwohnungen-bodensee\.de;ok;manuell/);
});
