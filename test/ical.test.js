import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, buildICS, parsePastedPlan, addDays, isValidDay } from '../server/ical.js';
import { expandSeasons, mapOpenHolidays } from '../server/holidays.js';

const SAMPLE = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Smoobu//DE',
  'BEGIN:VEVENT', 'UID:abc-1', 'DTSTART;VALUE=DATE:20261114', 'DTEND;VALUE=DATE:20261121', 'SUMMARY:Maier\\, Familie', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:abc-2', 'DTSTART:20261124T150000Z', 'DTEND:20261201T090000Z', 'SUMMARY:Huber mit sehr langem Na', ' men', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:abc-3', 'DTSTART;VALUE=DATE:20261205', 'DTEND;VALUE=DATE:20261212', 'STATUS:CANCELLED', 'SUMMARY:Storniert', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:abc-4', 'DTSTART;VALUE=DATE:20261224', 'SUMMARY:Ohne Ende', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseICS liest ganztägige und zeitbasierte Einträge', () => {
  const ev = parseICS(SAMPLE);
  assert.equal(ev.length, 3, 'stornierte Einträge werden ignoriert');
  assert.deepEqual([ev[0].start, ev[0].end, ev[0].summary], ['2026-11-14', '2026-11-21', 'Maier, Familie']);
  assert.deepEqual([ev[1].start, ev[1].end], ['2026-11-24', '2026-12-01']);
  assert.equal(ev[1].summary, 'Huber mit sehr langem Namen', 'gefaltete Zeilen werden zusammengesetzt');
  assert.equal(ev[2].end, '2026-12-25', 'fehlendes Ende = 1 Tag');
});

test('UTC-Zeit kurz vor Mitternacht ergibt deutsches Datum', () => {
  const ev = parseICS('BEGIN:VEVENT\nDTSTART:20260630T230000Z\nDTEND:20260702T080000Z\nEND:VEVENT');
  assert.equal(ev[0].start, '2026-07-01');
});

test('buildICS erzeugt einen Kalender, der wieder eingelesen werden kann', () => {
  const ics = buildICS([{ id: 7, from: '2026-11-16', to: '2026-12-19', name: 'Hr. Petrović; Hr. Ilić', note: 'Montage, Werk 2' }]);
  assert.match(ics, /BEGIN:VCALENDAR/);
  const back = parseICS(ics);
  assert.deepEqual([back[0].start, back[0].end, back[0].summary, back[0].description], ['2026-11-16', '2026-12-19', 'Hr. Petrović; Hr. Ilić', 'Montage, Werk 2']);
});

test('parsePastedPlan erkennt typische Zeilen aus dem PDF', () => {
  const rows = parsePastedPlan('Belegung 2027\n04.05.2027 – 29.05.2027 Hr. Novak\n1.6.27 bis 30.6.27 Team B\n31.02.2027 - 03.03.2027 ungültig\n10.07.2027-01.07.2027 falsch herum');
  assert.deepEqual(rows, [
    { from: '2027-05-04', to: '2027-05-29', name: 'Hr. Novak', note: '' },
    { from: '2027-06-01', to: '2027-06-30', name: 'Team B', note: '' },
  ]);
});

test('Datumshelfer', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-29', -1), '2026-03-28');
  assert.ok(isValidDay('2028-02-29'));
  assert.ok(!isValidDay('2027-02-29'));
});

test('Saisons werden je Jahr ausgerollt, auch über den Jahreswechsel', () => {
  const s = expandSeasons([{ kind: 'haupt', from: '07-01', to: '08-31' }, { kind: 'neben', from: '12-20', to: '01-06', label: 'Winter' }], [2026]);
  assert.deepEqual(s[0], { start: '2026-07-01', end: '2026-09-01', kind: 'haupt', name: 'Hauptsaison' });
  assert.deepEqual(s[1], { start: '2026-12-20', end: '2027-01-07', kind: 'neben', name: 'Winter' });
});

test('OpenHolidays-Antwort wird übernommen (Ende inklusive → exklusiv)', () => {
  const r = mapOpenHolidays([{ startDate: '2026-12-23', endDate: '2027-01-09', name: [{ language: 'EN', text: 'Christmas' }, { language: 'DE', text: 'Weihnachtsferien' }] }], 'school');
  assert.deepEqual(r, [{ start: '2026-12-23', end: '2027-01-10', name: 'Weihnachtsferien', kind: 'school' }]);
});
