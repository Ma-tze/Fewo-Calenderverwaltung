# Fewo-Kalender

Einfacher Belegungskalender für vier Ferienwohnungen, gedacht für ein iPad.
Konzept: [docs/KONZEPT.md](docs/KONZEPT.md) · Klickbarer Entwurf: [mockup/index.html](mockup/index.html)

**Stand: Phase 1 (nur Anzeige).**

- **Fewo 2–4** kommen über die **Smoobu-API** (Abruf alle 5 Minuten, einstellbar) mit Telefon, E-Mail, Personen und Kanal. Der **iCal-Link** aus Smoobu bleibt als Ersatz hinterlegt und springt ein, wenn die API nicht antwortet. Ohne API-Schlüssel geht auch nur iCal.
- **Fewo 1** (Firma) hat einen eigenen Kalender. Er wird am PC als Tabelle gepflegt und auch als iCal-Link bereitgestellt.
- **Ansichten:** 4 Wochen, 3 Monate und Jahr, jeweils mit Schulferien und Feiertagen in Baden-Württemberg sowie Haupt- und Nebensaison.
- **Zwei Ports** (auf dem Homeserver, in `.env` änderbar):
  - `8090`: iPad-Ansicht mit großer Schrift und großen Knöpfen, nur lesen.
  - `8091`: PC-Verwaltung mit kompakter Darstellung und ⚙ Einstellungen.

## Installation auf dem Homeserver (Debian + Docker)

```bash
git clone https://github.com/Ma-tze/Fewo-Calenderverwaltung.git fewo-kalender
cd fewo-kalender
git checkout claude/project-thread-scoe0v    # bis der Stand in main übernommen ist
cp .env.example .env                         # Ports, Passwort, Adresse anpassen
ss -tlnp | grep -E ':(8090|8091) '           # keine Ausgabe = Ports frei
docker compose up -d --build
```

Danach:

1. Am PC `http://homesrv:8091` öffnen und auf **⚙ Einstellungen** klicken.
2. Bei Fewo 2–4 den jeweiligen **iCal-Link aus Smoobu** einfügen und speichern. Der Link steht in Smoobu im Kalender-Export der jeweiligen Wohnung. Die App ruft den Kalender sofort ab und zeigt den Status an.
3. Unter **Belegungsplan Fewo 1** auf **PDF-Belegungsplan hochladen** klicken und das PDF der Firma auswählen. Die App zeigt eine Vorschau, Wochen mit „Keine Belegung“ werden übersprungen. Mit „Übernehmen“ werden die Einträge im Zeitraum des Plans ersetzt. Telefon, Handy und E-Mail werden mit übernommen. Sie erscheinen in der Buchungskarte (auch auf dem iPad), aber nicht im iCal-Link von Fewo 1.
4. Namen, Farben, Reihenfolge und **Haupt-/Nebensaison** nach Wunsch anpassen.
5. Auf dem iPad in Safari `http://homesrv:8090` öffnen, dann **Teilen → Zum Home-Bildschirm**. Ab jetzt öffnet sich der Kalender wie eine App.

`homesrv` steht hier für den Namen oder die IP-Adresse des Servers im Heimnetz.

### Monat als PDF

In der PC-Ansicht oben den Monat wählen und auf **🖨 Monat als PDF** klicken. Das PDF (A4 quer) zeigt das Monatsraster aller Wohnungen mit Ferien und Saison, darunter alle Buchungen mit Kontaktdaten. Unter jedem Balken, in der Spalte „Ergänzungen“ und im Notizbereich unten ist Platz für Handschriftliches. Direkter Link: `/export/monat.pdf?m=2026-12`.

### Gästedatenbank

In der PC-Ansicht oben auf **👥 Gäste** klicken. Die App führt eine eigene Liste aller Gäste mit ihren Aufenthalten (Wohnung, Zeitraum, Personen, Gesamtpreis, Preis pro Nacht, Kanal). Sie bleibt auf dem Server gespeichert, auch wenn ihr Smoobu später nicht mehr nutzt.

- **Automatisch:** Bei jedem Smoobu-API-Abruf kommen neue Gäste und Buchungen dazu. Ein Gast wird über die Smoobu-Gast-ID, die E-Mail oder die Telefonnummer wiedererkannt. Stornierte Buchungen werden als „storniert“ markiert, nicht gelöscht.
- **Ältere Buchungen:** Unter „Ältere Buchungen aus Smoobu übernehmen“ ein Startjahr wählen. Das geht beliebig oft, ohne Doppelte.
- **Von Hand:** Gäste und Aufenthalte (z. B. Anfragen über die Bodensee-Portale) mit „+ Gast“ bzw. „Neuer Aufenthalt“ anlegen. Ein von Hand geänderter Preis bleibt beim nächsten Abruf erhalten.
- **Stammgäste:** Im Kalender steht vor dem Namen ein ★, in der Buchungskarte „3. Aufenthalt“. Gäste mit gleichem Namen werden als „doppelt?“ markiert und lassen sich zusammenführen (z. B. Booking.com-Weiterleitungsadresse und echte E-Mail).
- **Export:** „Export für Excel (CSV)“ liefert eine Zeile pro Aufenthalt, z. B. für einen Anbieterwechsel.
- **Datenschutz:** Feld „Werbung erlaubt“ je Gast. Gäste, deren letzter Aufenthalt mehr als 3 Jahre zurückliegt, lassen sich gesammelt löschen. Die Gästedatenbank gibt es nur in der PC-Ansicht.

### Rechnungen für Direktgäste

**Testbetrieb:** Mit `INVOICE_TEST_MODE=1` in der `.env` bekommen festgeschriebene Rechnungen TEST-Nummern (eigener Zähler), den Aufdruck „Testrechnung“ und landen in `/data/rechnungen-test/`. Sie zählen ohne Testbetrieb nicht im USt-Bericht und lassen sich unter 🧾 Rechnungen gesammelt löschen. Für den echten Betrieb die Zeile entfernen und `docker compose up -d` ausführen.

**Korrigieren:** Festgeschriebene Rechnungen werden nicht geändert. „Rechnung korrigieren“ erzeugt eine Stornorechnung und einen neuen Entwurf als Kopie; bereits gezahlte Beträge werden verrechnet.

Oben auf **🧾 Rechnungen** klicken.

1. Einmalig **Vermieterdaten und Preise** ausfüllen: Name, Anschrift, Steuernummer, Bank, Rechnungsnummern (Präfix, nächste Nummer), Zahlungsziel, Ist- oder Soll-Versteuerung, Preisbausteine (im Grundpreis enthaltene Personen, Mehrbelegung Erwachsene/Kinder je Nacht, Altersgrenzen, Endreinigung) und Kurtaxe nach Altersgruppen (Satz Hauptsaison und übrige Zeit, Saisons aus ⚙ Einstellungen).
2. Rechnung anlegen: **👥 Gäste → Gast → beim Aufenthalt „+ Rechnung“**. Gast, Zeitraum, Wohnung und Preis sind vorausgefüllt. Alter der Reisenden eintragen, „Positionen neu berechnen“, bei Bedarf Positionen anpassen und Anzahlung eintragen. Alle Preise sind brutto, die Umsatzsteuer (7 %) wird herausgerechnet, die Kurtaxe bleibt ohne Umsatzsteuer.
3. **Festschreiben:** Die Rechnung bekommt die nächste Nummer und wird als PDF im Datenordner unter `rechnungen/` abgelegt. Danach ist sie nicht mehr änderbar (GoBD). Korrekturen über **Stornieren** (Stornorechnung mit eigener Nummer).
4. **E-Rechnung:** Häkchen „Auch als E-Rechnung“. Es entsteht eine XRechnung 3.0 (UN/CEFACT CII) als XML-Datei, zusätzlich in das PDF eingebettet. Die XML-Datei ist die gültige E-Rechnung.
5. **Zahlungsplan:** Unter „Vermieterdaten und Preise → Zahlungsbedingungen“ Anzahlung in %, deren Frist, ab wie vielen Tagen vor Anreise eine Anzahlung verlangt wird und wann die Restzahlung fällig ist. Ist die Anreise näher, ist der ganze Betrag fällig (spätestens am Anreisetag). Je Rechnung lässt sich „ganzer Betrag auf einmal“ wählen.
6. **QR-Code:** Für jede Zahlung (Anzahlung, Rest oder Gesamtbetrag) steht ein GiroCode auf der Rechnung, den der Gast mit der Banking-App scannt. Voraussetzung: IBAN und Name in den Vermieterdaten.
7. **Zahlungseingänge** in der Rechnung erfassen (Datum, Betrag). Bei Ist-Versteuerung zählt der Bericht genau diese Zahlungen, anteilig nach Steuersatz.

**Umsatzsteuer-Bericht:** In der Rechnungsliste Jahr und Quartal wählen, dann Quartals- oder Jahresbericht als PDF oder CSV. Enthält Kennzahl 86/81 mit Steuer, alle Rechnungen des Zeitraums und getrennt zur Information die Aufenthalte über Airbnb/Booking ohne App-Rechnung.

Wichtig: Der Datenordner (Docker-Volume `fewo-data`) enthält jetzt Rechnungen, die 8 Jahre aufbewahrt werden müssen. Bitte regelmäßig außerhalb des Servers sichern.

### Smoobu-API einrichten

1. In Smoobu unter **Einstellungen → Erweitert → API-Schlüssel** einen Schlüssel mit Secret erzeugen.
2. Auf dem Server in `.env` eintragen (niemand sonst braucht die Werte):
   ```
   SMOOBU_API_KEY=...
   SMOOBU_API_SECRET=...
   ```
3. `docker compose up -d` (Container übernimmt die neuen Werte).
4. Am PC unter **⚙ Einstellungen → Wohnungen & Datenquellen** bei Fewo 2–4 die Quelle **Smoobu-API** wählen und die passende Smoobu-Wohnung auswählen. Den iCal-Link als Ersatz drin lassen.

Status „Ersatz aktiv“ heißt: Die API hat nicht geantwortet, der Kalender zeigt den Stand aus dem iCal-Link (ohne Telefon/E-Mail). Beim nächsten erfolgreichen Abruf wird wieder die API genutzt.

### Sicherheit

- Port **8091** (Verwaltung) **nicht ins Internet freigeben**. Setze außerdem in `.env` ein `ADMIN_PASSWORD`.
- Soll das iPad den Kalender auch außerhalb des Heimnetzes erreichen, gib nur Port **8090** frei, zum Beispiel per Cloudflare Tunnel. Setze dann `VIEW_KEY` und `PUBLIC_URL` in `.env` und öffne auf dem iPad einmalig `https://kalender.<domain>/?key=<VIEW_KEY>`.
- Die Smoobu-API-Schlüssel stehen nur in `.env` auf dem Server und werden nie in der Oberfläche angezeigt oder gespeichert.
- Die Smoobu-iCal-Links liegen nur auf dem Server (im Docker-Volume `fewo-data`). Sie werden in der Oberfläche nicht wieder angezeigt.

### Aktualisieren

```bash
git pull
docker compose up -d --build
```

### Daten und Sicherung

Alle Daten liegen in einer Datei im Docker-Volume `fewo-data` unter `/data/fewo-kalender.json`. Pro Tag wird eine Sicherung angelegt, die letzten 14 bleiben erhalten (`/data/backup/`). Eine Kopie auf den Server holst du so:

```bash
docker compose cp fewo-kalender:/data ./sicherung
```

## Ohne Docker (zum Ausprobieren)

Voraussetzung ist Node.js 20 oder neuer. Weitere Pakete sind nicht nötig.

```bash
npm start          # iPad: http://localhost:8080 · PC: http://localhost:8081
npm test
```

## Einstellungen über Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `IPAD_PORT` | 8090 | Port der iPad-Ansicht auf dem Homeserver (Docker) |
| `PC_PORT` | 8091 | Port der PC-Verwaltung auf dem Homeserver (Docker) |
| `VIEW_PORT` | 8080 | Port der iPad-Ansicht im Container bzw. ohne Docker |
| `ADMIN_PORT` | 8081 | Port der PC-Verwaltung im Container bzw. ohne Docker |
| `DATA_DIR` | `./data` (Docker: `/data`) | Ablage der Daten |
| `PUBLIC_URL` | – | Öffentliche Adresse der iPad-Ansicht, wird für den iCal-Link von Fewo 1 genutzt |
| `VIEW_KEY` | – | Zugangsschlüssel für die iPad-Ansicht |
| `ADMIN_PASSWORD` | – | Passwort für die PC-Verwaltung |
| `SMOOBU_API_KEY` / `SMOOBU_API_SECRET` | – | Zugang zur Smoobu-API (HMAC) |
| `SMOOBU_AUTH` | `hmac` | `legacy` nur für den alten Api-Key ohne Secret |
| `HOLIDAY_REGION` | `DE-BW` | Bundesland für Schulferien und Feiertage (Quelle: openholidaysapi.org) |
