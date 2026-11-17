import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hmacHeaders, canonicalQuery, mapBooking } from '../server/smoobu.js';

test('HMAC-Signatur nach Smoobu-Schema (unabhängig mit Python nachgerechnet)', () => {
  const query = canonicalQuery(new URLSearchParams({ to: '2026-12-31', page: '1', from: '2026-01-01' }));
  assert.equal(query, 'from=2026-01-01&page=1&to=2026-12-31');
  const h = hmacHeaders({ method: 'GET', path: '/api/reservations', query, key: 'KEY123', secret: 'SECRET',
    timestamp: '2026-11-17T12:00:00Z', nonce: '11111111-2222-4333-8444-555555555555' });
  assert.equal(h['X-Signature'], '/VZw38NEm1skCOqWt4yg/GQtltWXC2eVT+ZR0c1Dzso=');
  assert.equal(h['X-API-Key'], 'KEY123');
});

test('Buchung aus der API wird übernommen', () => {
  const b = mapBooking({ id: 292, type: 'reservation', arrival: '2026-11-24', departure: '2026-12-01', apartment: { id: 38 }, channel: { id: 13, name: 'Direct booking' },
    'guest-name': 'Steffen Hansen', email: 'g@example.org', phone: '0170 1', adults: 2, children: 1, notice: 'spät', 'is-blocked-booking': false });
  assert.deepEqual(b, { uid: '292', start: '2026-11-24', end: '2026-12-01', summary: 'Steffen Hansen', aptId: 38, phone: '0170 1', email: 'g@example.org',
    adults: 2, children: 1, notice: 'spät', channel: 'Direct booking', blocked: false, cancelled: false });
});
