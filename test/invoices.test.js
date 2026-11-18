import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../server/invoices.js';

function setup() {
  const d = { seasons: [{ id: 1, kind: 'haupt', from: '2026-07-01', to: '2026-08-31', label: 'Hauptsaison' }], stays: [] };
  I.ensure(d);
  d.invoiceSettings = I.cleanSettings({
    seller: { name: 'Erika Muster', street: 'Seestraße 5', zip: '88090', city: 'Immenstaad', phone: '07545 1', email: 'e@example.de', taxNumber: '61/123/45678', iban: 'DE02 1203 0000 0000 2020 51' },
    pricing: { extraAdult: 15, extraChild: 8, cleaning: 60 },
    kurtaxe: { groups: [{ label: 'Kinder bis 5', ageFrom: 0, ageTo: 5, rate: 0 }, { label: 'Kinder', ageFrom: 6, ageTo: 15, rate: '1,10', rateNeben: '0,80' }, { label: 'Erwachsene', ageFrom: 16, ageTo: 120, rate: '2,60', rateNeben: '1,90' }] },
  }, d.invoiceSettings);
  const inv = I.draftFromStay(d, { id: 1, start: '2026-06-27', end: '2026-07-04', price: 693, adults: 3, children: 2 },
    { id: 1, name: 'Familie Weber', address: 'Lindenweg 3, 70173 Stuttgart', email: 'w@example.org' }, 'Fewo 2');
  I.updateDraft(d, inv, { input: { ages: '45, 43, 19, 12, 4' }, deposit: '200' });
  I.recompute(d, inv);
  return { d, inv };
}

test('Mehrbelegung und Kurtaxe nach Alter und Saison', () => {
  const { inv } = setup();
  const by = k => inv.items.filter(i => i.kind === k);
  assert.equal(by('stay')[0].qty, 7); assert.equal(by('stay')[0].price, 99);
  assert.deepEqual(by('extra').map(i => [i.qty, i.price]), [[7, 15], [14, 8]]); // 1 Erwachsener + 2 Kinder über 2 Personen
  assert.equal(by('cleaning')[0].price, 60);
  // 4 Nächte Juni (übrige Zeit), 3 Nächte Juli (Hauptsaison); Kleinkind kostenlos
  assert.deepEqual(by('kurtaxe').map(i => [i.qty, i.price, i.vat]), [[3, 1.1, 0], [4, 0.8, 0], [9, 2.6, 0], [12, 1.9, 0]]);
  assert.equal(inv.buyer.zip, '70173');
});

test('Summen: netto + Steuer ergibt genau brutto, Kurtaxe ohne Steuer', () => {
  const { inv } = setup();
  const t = I.totals(inv.items, inv.deposit);
  assert.equal(t.gross, 1022.7);
  assert.deepEqual(t.vat, [{ rate: 7, gross: 970, net: 906.54, tax: 63.46 }, { rate: 0, gross: 52.7, net: 52.7, tax: 0 }]);
  assert.equal(t.due, 822.7);
  for (let g = 1; g < 400; g += 0.37) {
    const tt = I.totals([{ qty: 1, price: Math.round(g * 100) / 100, vat: 7 }]);
    const v = tt.vat[0];
    assert.equal(Math.round((v.net + v.tax) * 100) / 100, v.gross);
    // Abweichung zur exakt gerechneten Steuer höchstens 1 Cent (EN16931 BR-CO-17 erlaubt Rundungstoleranz)
    assert.ok(Math.abs(v.tax - Math.round(v.net * 7) / 100) <= 0.0100001);
  }
});

test('Festschreiben: fortlaufende Nummer, danach unveränderbar, Storno mit neuer Nummer', () => {
  const { d, inv } = setup();
  d.invoiceSettings = I.cleanSettings({ nextNumber: { year: 2026, value: 12 } }, d.invoiceSettings);
  I.issue(d, inv, '2026-07-04');
  assert.equal(inv.number, 'R-2026-012');
  assert.equal(inv.dueDate, '2026-07-18');
  assert.throws(() => I.updateDraft(d, inv, { note: 'x' }), /festgeschrieben/);
  assert.throws(() => I.cleanSettings({ nextNumber: { year: 2026, value: 5 } }, d.invoiceSettings), /größer/);
  const st = I.cancel(d, inv, '2026-07-10');
  assert.equal(st.number, 'R-2026-013');
  assert.equal(st.totals.gross, -1022.7);
  assert.throws(() => I.cancel(d, inv), /schon storniert/);
  const xml = I.xrechnungXml(st);
  assert.match(xml, /<ram:TypeCode>381<\/ram:TypeCode>/);
  assert.match(xml, /<ram:GrandTotalAmount>1022.70<\/ram:GrandTotalAmount>/);
  assert.match(xml, /<ram:IssuerAssignedID>R-2026-012<\/ram:IssuerAssignedID>/);
});

test('Ohne Pflichtangaben kein Festschreiben', () => {
  const { d, inv } = setup();
  inv.buyer.street = '';
  inv.eInvoice = true; inv.buyer.email = '';
  assert.throws(() => I.issue(d, inv), /Anschrift des Gastes.*E-Mail des Gastes/);
});

test('E-Rechnung enthält Pflichtfelder (geprüft mit EN16931- und XRechnung-Regeln, siehe PR)', () => {
  const { d, inv } = setup();
  inv.eInvoice = true;
  I.issue(d, inv, '2026-07-04');
  const xml = I.xrechnungXml(inv);
  for (const s of ['urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0', '<ram:BuyerReference>R-2026-001</ram:BuyerReference>',
    '<ram:ID>61/123/45678</ram:ID>', '<ram:IBANID>DE02120300000000202051</ram:IBANID>', '<ram:CategoryCode>E</ram:CategoryCode>',
    '<ram:TaxBasisTotalAmount>959.24</ram:TaxBasisTotalAmount>', '<ram:TaxTotalAmount currencyID="EUR">63.46</ram:TaxTotalAmount>',
    '<ram:TotalPrepaidAmount>200.00</ram:TotalPrepaidAmount>', '<ram:DuePayableAmount>822.70</ram:DuePayableAmount>']) assert.ok(xml.includes(s), s);
  const { buffer } = I.invoicePdf(inv, { xml });
  const s = buffer.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && s.includes('/EmbeddedFiles') && s.includes('<rsm:CrossIndustryInvoice'));
});

test('USt-Bericht: Ist-Versteuerung nach Zahlung, Soll nach Abreise, Portal-Aufenthalte getrennt', () => {
  const { d, inv } = setup();
  I.issue(d, inv, '2026-07-04');
  d.stays.push({ id: 2, status: 'ok', price: 535, start: '2026-08-01', end: '2026-08-06', channel: 'Airbnb' }, { id: 1, status: 'ok', price: 693, start: inv.from, end: inv.to });
  let rep = I.vatReport(d, I.periodOf('quartal', 2026, 3));
  assert.equal(rep.rows.length, 0); assert.equal(rep.unpaid, 1);
  inv.paidAt = '2026-07-08';
  rep = I.vatReport(d, I.periodOf('quartal', 2026, 3));
  assert.deepEqual(rep.kz, { kz86: 906.54, tax7: 63.46, kz81: 0, tax19: 0 });
  assert.deepEqual(rep.other, { count: 1, gross: 535, net: 500, tax: 35, byChannel: [['Airbnb', 535]] });
  d.invoiceSettings.taxation = 'soll'; inv.paidAt = null;
  assert.equal(I.vatReport(d, I.periodOf('jahr', 2026)).rows.length, 1);
  assert.ok(I.vatReportPdf(rep).toString('latin1').startsWith('%PDF'));
  assert.match(I.vatReportCsv(rep), /R-2026-001;rechnung;2026-07-04/);
});
