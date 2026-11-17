import test from 'node:test';
import assert from 'node:assert/strict';
import { monthPdf } from '../server/report.js';

const cal = {
  apartments: [{ id: 1, name: 'Fewo 1', nick: 'Firma', color: 'p1' }, { id: 2, name: 'Fewo 2', nick: 'Fewo 2', color: 'p2' }],
  events: Array.from({ length: 40 }, (_, i) => ({ id: String(i), apt: 1 + (i % 2), start: '2026-12-0' + (1 + (i % 9)), end: '2026-12-15', title: `Gäste „Müller“ ${i}`, note: '', phone: '0751 1', email: 'a@b.de', source: 'Smoobu' })),
  holidays: [{ start: '2026-12-23', end: '2027-01-10', name: 'Weihnachtsferien', kind: 'school' }],
  seasons: [],
};

test('Monats-PDF ist gültig und bricht lange Listen auf weitere Seiten um', () => {
  const { buffer, filename } = monthPdf(cal, '2026-12');
  const s = buffer.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.equal(filename, 'Belegung-2026-12.pdf');
  assert.ok(+s.match(/\/Count (\d+)/)[1] >= 2);
  assert.ok(s.includes('M\xfcller')); // Umlaut als WinAnsi
  // xref-Offsets zeigen auf Objekte
  const xref = +s.match(/startxref\n(\d+)/)[1];
  assert.equal(s.slice(xref, xref + 4), 'xref');
});

test('Aushang-Variante ohne Kontaktdaten', () => {
  const { buffer, filename } = monthPdf(cal, '2026-12', { contacts: false });
  assert.equal(filename, 'Belegung-2026-12-Aushang.pdf');
  assert.ok(!buffer.toString('latin1').includes('a@b.de'));
});
