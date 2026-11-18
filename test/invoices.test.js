import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../server/invoices.js';

function setup() {
  const d = { seasons: [{ id: 1, kind: 'haupt', from: '2026-07-01', to: '2026-08-31', label: 'Hauptsaison' }], stays: [] };
  I.ensure(d);
  d.invoiceSettings = I.cleanSettings({
    seller: { name: 'Erika Muster', street: 'Seestraße 5', zip: '88090', city: 'Immenstaad', phone: '07545 1', email: 'e@example.de', taxNumber: '61/123/45678', iban: 'DE02 1203 0000 0000 2020 51' },
    pricing: { extraAdult: 15, extraChild: 8, cleaning: 60 },
    kurtaxe: { mainFrom: '', mainTo: '', groups: [{ label: 'Kinder bis 5', ageFrom: 0, ageTo: 5, rate: 0 }, { label: 'Kinder', ageFrom: 6, ageTo: 15, rate: '1,10', rateNeben: '0,80' }, { label: 'Erwachsene', ageFrom: 16, ageTo: 120, rate: '2,60', rateNeben: '1,90' }] },
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
  // Ist: zunächst nur die vor der Rechnung erhaltene Anzahlung (200 €), anteilig auf 7 % und Kurtaxe
  let rep = I.vatReport(d, I.periodOf('quartal', 2026, 3));
  assert.equal(rep.rows.length, 1); assert.equal(rep.rows[0].gross, 200); assert.equal(rep.unpaid, 1);
  assert.throws(() => I.addPayment(inv, { date: '2026-07-08', amount: 900 }), /höher als der offene Betrag/);
  I.addPayment(inv, { date: '2026-07-08', amount: '822,70' });
  assert.equal(inv.paidAt, '2026-07-08');
  rep = I.vatReport(d, I.periodOf('quartal', 2026, 3));
  assert.deepEqual(rep.kz, { kz86: 906.54, tax7: 63.46, kz81: 0, tax19: 0 });
  assert.deepEqual(rep.other, { count: 1, gross: 535, net: 500, tax: 35, byChannel: [['Airbnb', 535]] });
  assert.equal(rep.unpaid, 0);
  d.invoiceSettings.taxation = 'soll'; I.removePayment(inv, 1);
  assert.equal(I.vatReport(d, I.periodOf('jahr', 2026)).rows.length, 1);
  assert.ok(I.vatReportPdf(rep).toString('latin1').startsWith('%PDF'));
  assert.match(I.vatReportCsv(rep), /R-2026-001;rechnung;2026-07-04/);
});

test('Zahlungsplan: Anzahlung nur bei Buchung weit genug im Voraus, sonst ganzer Betrag', () => {
  const { d, inv } = setup();
  d.invoiceSettings = I.cleanSettings({ payment: { depositPercent: 30, depositDays: 7, depositIfDaysAhead: 30, restDaysBeforeArrival: 14 } }, d.invoiceSettings);
  // Rechnung am 1.3. für Anreise 27.6.: Anzahlung 30 % von 822,70 bis 8.3., Rest bis 13.6.
  assert.deepEqual(I.paymentSchedule(d.invoiceSettings, inv, '2026-03-01'), [
    { label: 'Anzahlung (30 %)', amount: 246.81, dueDate: '2026-03-08' }, { label: 'Restzahlung', amount: 575.89, dueDate: '2026-06-13' }]);
  // kurzfristig (20 Tage vorher): alles, spätestens zur Anreise
  assert.deepEqual(I.paymentSchedule(d.invoiceSettings, inv, '2026-06-07'), [{ label: 'Gesamtbetrag', amount: 822.7, dueDate: '2026-06-21' }]);
  assert.deepEqual(I.paymentSchedule(d.invoiceSettings, inv, '2026-06-20'), [{ label: 'Gesamtbetrag', amount: 822.7, dueDate: '2026-06-27' }]);
  I.updateDraft(d, inv, { input: { plan: 'full' } });
  assert.equal(I.paymentSchedule(d.invoiceSettings, inv, '2026-03-01').length, 1);
  I.updateDraft(d, inv, { input: { plan: 'auto' } });
  I.issue(d, inv, '2026-03-01');
  assert.equal(inv.schedule.length, 2); assert.equal(inv.dueDate, '2026-06-13');
  const xml = I.xrechnungXml(inv);
  assert.match(xml, /Anzahlung \(30 %\): 246,81 € bis 08.03.2026; Restzahlung: 575,89 € bis 13.06.2026/);
  const pdf = I.invoicePdf(inv).buffer.toString('latin1');
  assert.match(pdf, /Zahlungsplan/);
});

test('QR-Code für die Überweisung (GiroCode)', async () => {
  const { qrMatrix, epcPayload } = await import('../server/qr.js');
  const t = epcPayload({ name: 'Erika Muster', iban: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001', amount: 280.92, text: 'R-2026-001 Anzahlung' });
  assert.equal(t, 'BCD\n002\n1\nSCT\nBYLADEM1001\nErika Muster\nDE02120300000000202051\nEUR280.92\n\n\nR-2026-001 Anzahlung');
  const m = qrMatrix(t);
  assert.equal(m.length, 41); // Version 6 bei Fehlerkorrektur M (mit zxing-cpp gegengelesen, siehe PR)
  // Suchmuster oben links: 7x7 Rahmen
  assert.deepEqual(m[0].slice(0, 7), Array(7).fill(true));
  assert.deepEqual(m[1].slice(0, 7), [true, false, false, false, false, false, true]);
  assert.throws(() => epcPayload({ name: 'X', iban: '', amount: 1 }));
});

test('Kurtaxe Immenstaad: feste Hauptsaison, Kinder bis 14 frei, Befreiung Geschäftsreise', async () => {
  const INV = await import('../server/invoices.js');
  const d = {}; INV.ensure(d);
  const S = d.invoiceSettings;
  const kt = items => items.filter(i => i.kind === 'kurtaxe').map(i => [i.qty, i.price]);
  // 29.10. bis 03.11.: 3 Nächte Hauptsaison (29., 30., 31.10.), 2 Nächte übrige Zeit
  const base = { from: '2026-10-29', to: '2026-11-03', perNight: 100, ages: [45, 15, 14, 3] };
  assert.deepEqual(kt(INV.computeItems(S, [], base)), [[6, 3.5], [4, 2.2]]);
  assert.deepEqual(kt(INV.computeItems(S, [], { ...base, ktExempt: 'Geschäftsreise' })), []);
  // alte Vorbelegung mit lauter 0-Sätzen wird ersetzt, eingetragene Sätze bleiben
  const old = { invoiceSettings: { kurtaxe: { label: 'Kurtaxe', groups: [{ label: 'x', ageFrom: 0, ageTo: 120, rate: 0, rateNeben: null }] } } };
  INV.ensure(old);
  assert.equal(old.invoiceSettings.kurtaxe.groups[1].rate, 3.5);
  const mine = { invoiceSettings: { kurtaxe: { groups: [{ label: 'x', ageFrom: 0, ageTo: 120, rate: 2, rateNeben: null }] } } };
  INV.ensure(mine);
  assert.equal(mine.invoiceSettings.kurtaxe.groups[0].rate, 2);
  assert.equal(INV.cleanSettings({ kurtaxe: { mainFrom: '1.5.' } }, S).kurtaxe.mainFrom, '05-01');
});
