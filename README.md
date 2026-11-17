# Fewo-Kalender

Einfacher Belegungskalender für vier Ferienwohnungen, gedacht für ein iPad.
Konzept: [docs/KONZEPT.md](docs/KONZEPT.md) · Klickbarer Entwurf: [mockup/index.html](mockup/index.html)

**Stand: Phase 1 (nur Anzeige).**

- **Fewo 2–4** kommen über die iCal-Links aus Smoobu (Abruf alle 15 Minuten, einstellbar).
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

### Sicherheit

- Port **8091** (Verwaltung) **nicht ins Internet freigeben**. Setze außerdem in `.env` ein `ADMIN_PASSWORD`.
- Soll das iPad den Kalender auch außerhalb des Heimnetzes erreichen, gib nur Port **8090** frei, zum Beispiel per Cloudflare Tunnel. Setze dann `VIEW_KEY` und `PUBLIC_URL` in `.env` und öffne auf dem iPad einmalig `https://kalender.<domain>/?key=<VIEW_KEY>`.
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
| `HOLIDAY_REGION` | `DE-BW` | Bundesland für Schulferien und Feiertage (Quelle: openholidaysapi.org) |
