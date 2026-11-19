// Einfache, dateibasierte Ablage (JSON) für Einstellungen, Fewo-1-Plan und den letzten iCal-Stand.
// Für 4 Wohnungen völlig ausreichend; geschrieben wird atomar (temp-Datei + rename).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrateSeasons } from './holidays.js';
import { DEFAULT_PORTALS } from './portals.js';

const DEFAULTS = () => ({
  version: 1,
  apartments: [
    { id: 1, name: 'Fewo 1', nick: 'Firma', color: 'p1', source: 'own', icalUrl: '' },
    { id: 2, name: 'Fewo 2', nick: 'Fewo 2', color: 'p2', source: 'ical', icalUrl: '' },
    { id: 3, name: 'Fewo 3', nick: 'Fewo 3', color: 'p3', source: 'ical', icalUrl: '' },
    { id: 4, name: 'Fewo 4', nick: 'Fewo 4', color: 'p4', source: 'ical', icalUrl: '' },
  ],
  settings: { intervalMinutes: 5 },
  firm: [],
  seasons: [
    // Startwerte ohne Jahr, werden beim Laden in feste Daten für dieses und nächstes Jahr umgewandelt
    { id: 1, kind: 'neben', from: '04-01', to: '06-30', label: 'Nebensaison' },
    { id: 2, kind: 'haupt', from: '07-01', to: '08-31', label: 'Hauptsaison' },
    { id: 3, kind: 'neben', from: '09-01', to: '10-31', label: 'Nebensaison' },
  ],
  manualHolidays: [], // { id, start, end (exklusiv), name }
  holidays: { fetchedAt: null, error: null, items: [] },
  feedToken: crypto.randomBytes(12).toString('hex'),
  guests: [], // Gästedatenbank: { id, name, email, phone, address, notes, ads, smoobuGuestIds }
  stays: [],  // Aufenthalte: { id, guestId, aptId, start, end, price, adults, children, channel, status, source, smoobuBookingId }
  portals: DEFAULT_PORTALS(), // Portal-Kalender zum Abgleich: { id, name, icalUrl, apts: [aptId] }
  portalCache: {}, // portalId -> { fetchedAt, error, events }
  cache: {}, // aptId -> { fetchedAt, error, events: [{uid,start,end,summary,description}] }
});

function migrate(d) {
  const y = new Date().getFullYear();
  const m = migrateSeasons(d.seasons, [y, y + 1]);
  if (m) d.seasons = m;
  return d;
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'fewo-kalender.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = this.#load();
    this.save(); // evtl. umgewandelte Daten (z. B. Saisons mit Jahr) sofort festschreiben
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const def = DEFAULTS();
      return migrate({ ...def, ...raw, settings: { ...def.settings, ...(raw.settings || {}) } });
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Konnte Daten nicht lesen, starte mit Standardwerten:', e.message);
      const d = migrate(DEFAULTS());
      this.data = d;
      this.save();
      return d;
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    this.#backup();
  }

  #backup() {
    // eine Sicherung pro Tag, die letzten 14 behalten
    const day = new Date().toISOString().slice(0, 10);
    const bdir = path.join(this.dir, 'backup');
    const target = path.join(bdir, `fewo-kalender-${day}.json`);
    try {
      fs.mkdirSync(bdir, { recursive: true });
      fs.copyFileSync(this.file, target);
      const files = fs.readdirSync(bdir).filter(f => f.endsWith('.json')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(bdir, f));
    } catch (e) {
      console.error('Sicherung fehlgeschlagen:', e.message);
    }
  }

  apartment(id) { return this.data.apartments.find(a => a.id === id); }
  nextId(list) { return (this.data[list] || []).reduce((m, e) => Math.max(m, e.id), 0) + 1; }
  nextFirmId() { return this.data.firm.reduce((m, e) => Math.max(m, e.id), 0) + 1; }
}
