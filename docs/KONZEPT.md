# Konzept: Fewo-Kalender für das iPad

Stand: 17.11.2026 · Status: Entwurf zur Abstimmung (noch kein Code)

## 1. Ziel in einem Satz

Eine sehr einfache Kalender-App für das iPad, mit der die Belegung aller vier Ferienwohnungen auf einen Blick sichtbar ist und Buchungen so leicht eingetragen werden können wie im Papierkalender. Die Abgleiche mit Smoobu und den Portalen passieren im Hintergrund, und wo ein Portal keinen automatischen Abgleich erlaubt, erinnert die App daran, es dort von Hand nachzutragen.

## 2. Ausgangslage

| Wohnung | Vermarktung | In Smoobu? |
|---|---|---|
| Fewo 1 | eigene Vermarktung, Portale | ja |
| Fewo 2 | eigene Vermarktung, Portale | ja |
| Fewo 3 | eigene Vermarktung, Portale | ja |
| Fewo 4 | Langzeitmiete durch eine Firma | nein |

Externe Kalender:

| Kanal | Zugang | Besonderheit |
|---|---|---|
| **Smoobu** | API, Webhooks, iCal je Wohnung | Masterkalender für Fewo 1–3 |
| **Booking.com, Airbnb** | direkt in Smoobu angebunden | Buchungen erscheinen in der App, nur lesend |
| **ferienwohnungen-bodensee.de** | iCal-Export (`oid=119`) und iCal-Import-Link | **ein** Objekt für alle 3 Wohnungen: „belegt“ nur, wenn alle 3 belegt sind |
| **bodenseeurlaub.de** | iCal-Export (`oid=68`) und iCal-Import-Link | wie oben, gleiche Software (Joomla `com_fewo`) |
| **TouristInfo Immenstaad** | Holidu im Hintergrund, eingeschränkter Zugang | Abgleich vermutlich nur von Hand |

Nutzerin: die Schwiegermutter, iPad, bisher Papierkalender. Daraus folgt für alles Weitere: **große Schrift, wenige Knöpfe, nichts kaputt machen können, immer gleich aussehend.**

## 3. Grundidee der Architektur

```
                ┌──────────────────────────────┐
   iPad  ─────▶ │  Fewo-Kalender (Web-App/PWA) │
 (Schwiegermutter)│  • Kalenderansichten         │
   Handy/PC ──▶ │  • Buchung anlegen/ändern    │
   (matze)      │  • PDF-Export                │
                │  • Nachtrag-Liste            │
                └──────────────┬───────────────┘
                               │
                ┌──────────────▼───────────────┐
                │  Kleiner Server (Backend)    │
                │  • Smoobu-API-Anbindung      │
                │  • eigene DB (Fewo 4, Notizen,│
                │    Nachtrag-Aufgaben, Cache) │
                │  • Sammel-iCal für Portale   │
                │  • Benachrichtigungen        │
                └───┬─────────────┬────────┬───┘
                    │             │        │
             API/Webhooks   iCal (Sammel-  E-Mail/Push
                    │        feed)          │
              ┌─────▼───┐  ┌─────▼──────┐  ┌▼───────────────┐
              │ Smoobu  │  │ FeWo-Boden-│  │ Erinnerung:    │
              │ (Master │  │ see.de,    │  │ „bitte bei     │
              │ Fewo1-3)│  │ Bodensee-  │  │ TouristInfo/   │
              └────┬────┘  │ urlaub.de  │  │ Holidu nach-   │
                   │       └────────────┘  │ tragen“        │
             Kanäle von Smoobu             └────────────────┘
             (Booking.com, Airbnb, …)
```

Kernentscheidungen:

1. **Smoobu bleibt der Master für Fewo 1–3.** Die App speichert Buchungen für diese Wohnungen nicht selbst, sondern schreibt sie über die Smoobu-API dorthin und liest sie von dort. So bleibt Smoobu mit seinen Kanälen konsistent, und nichts wird doppelt gepflegt.
2. **Fewo 4 lebt in der App-eigenen Datenbank.** Sie hat keine Portale, also braucht sie kein Smoobu (spart ggf. Smoobu-Kosten pro Wohnung). Sie wird durchgängig von der Firma genutzt und erscheint als ein durchgehender Balken.
3. **Ein Backend ist Pflicht.** Die Smoobu-API lässt sich laut Doku nicht direkt aus dem Browser aufrufen (CORS), und der API-Schlüssel darf nicht aufs iPad. Außerdem muss irgendwer den Sammel-iCal-Feed ausliefern und Webhooks empfangen.
4. **Die App ist eine Web-App (PWA)**, die auf dem iPad als Symbol auf dem Home-Bildschirm liegt und sich wie eine App öffnet. Kein App Store, keine Updates auf dem iPad nötig.

## 4. Datenflüsse je Kanal

### 4.1 Smoobu (Fewo 1–3)

- **Lesen:** `GET /api/reservations` (gefiltert nach Zeitraum, inkl. Blockierungen) und `GET /api/apartments` für die Wohnungsliste.
- **Aktuell halten:** Smoobu-Webhooks (neue/geänderte/stornierte Buchung) lösen sofort ein Nachladen aus. Zusätzlich holt der Server alle 10 Minuten einen Abgleich (`modifiedFrom=…`), falls ein Webhook verloren geht.
- **Schreiben:**
  - Anlegen: `POST /api/reservations` (Anreise, Abreise, Wohnung, Name, Telefon, Reisende, Preis, Notiz, Kanal „Direktbuchung“).
  - **Gast-Adresse:** In der gelesenen API-Doku ist beim Anlegen kein Adressfeld aufgeführt. In Phase 1 prüfen wir, ob Smoobu die Adresse über die Gästedaten annimmt. Falls nicht, speichert die App die Adresse selbst, verknüpft mit der Smoobu-Buchung.
  - Gast/Notiz/Personen ändern: `PUT /api/reservations/{id}`.
  - Stornieren: `DELETE /api/reservations/{id}` (bleibt in Smoobu als storniert erhalten).
  - **Termin oder Wohnung verschieben:** laut Doku nicht per `PUT` änderbar. Die App macht das intern als „stornieren + neu anlegen“ und zeigt es der Nutzerin als ein einziger Schritt „Verschieben“. (Vor Umsetzung mit Smoobu bestätigen.)
- **Buchungen von Booking.com/Airbnb o.ä.** (falls in Smoobu angebunden) werden in der App angezeigt, aber **nur lesend**. Änderungen daran gehören ins jeweilige Portal.
- **Authentifizierung:** Smoobu hat den alten `Api-Key`-Header laut Doku zum 31.10.2026 abgeschaltet; neu ist ein HMAC-Verfahren (Schlüssel + Signatur je Anfrage). Das macht ausschließlich der Server. Der Schlüssel wird in Smoobu unter *Einstellungen → Erweitert → API-Schlüssel* erzeugt und **nur auf dem Server** hinterlegt, nie im Repository.

**Rückfallvariante ohne API (nur iCal):** Die iCal-Links, die Smoobu pro Wohnung anbietet, sind reine Export-Feeds und nur zum Lesen da. Über diesen Link kann man keine Buchung zu Smoobu schicken. Smoobu kann aber pro Wohnung zusätzlich einen *fremden* iCal-Kalender importieren. Falls die API nicht nutzbar ist, ginge es so:
- Lesen: Die App liest die drei Smoobu-Export-Feeds. Dabei kommen nur Zeiträume und je nach Einstellung ein kurzer Titel an, keine Telefonnummer und keine Personenzahl.
- Schreiben: Die App stellt pro Wohnung einen eigenen Feed mit ihren Buchungen bereit. Smoobu importiert ihn und blockiert die Tage.
- Nachteile: In Smoobu erscheinen die Buchungen nur als „blockiert“ ohne Gastdaten. Der Abgleich ist verzögert, weil Smoobu Fremd-Feeds periodisch abruft. Gastdaten müssten in der App selbst gespeichert werden, und Smoobu ist dann nicht mehr der vollständige Master.
- Fazit: Das taugt für den Anfang oder als Notlösung. Die API-Variante bleibt die Empfehlung.

### 4.2 ferienwohnungen-bodensee.de und bodenseeurlaub.de

Das Problem: Beide Portale führen die drei Wohnungen als **ein** Objekt. Ein Smoobu-Export pro Wohnung passt deshalb nicht: Würde man den Feed von Fewo 1 importieren, wäre das ganze Objekt belegt, obwohl Fewo 2 und 3 noch frei sind.

Die Lösung: **ein Sammel-Feed, den die App selbst erzeugt.**

- Da beide Portale nur Anfragen annehmen, kann dort keine echte Doppelbuchung entstehen. Der Feed sorgt dafür, dass Gäste belegte Zeiträume gar nicht erst anfragen.
- Der Server berechnet täglich bzw. nach jeder Änderung die Tage, an denen **alle drei** Wohnungen belegt oder blockiert sind (Schnittmenge), und liefert sie als iCal-Datei aus, z.B. `https://<app>/ical/objekt-bodensee-<geheimer-token>.ics`.
- Diesen Link trägt matze **einmalig** bei beiden Portalen im Feld „externen iCal-Kalender importieren“ ein.
- Optional ein eigener Schalter je Portal, falls z.B. bei einem Portal nur 2 Wohnungen angeboten werden sollen (dann wäre „belegt“ = beide belegt).

Richtung Portal → App:

- Der Export-Feed der Portale sagt ebenfalls nur „alles belegt“ und nicht, **welche** Wohnung gebucht wurde. Daraus kann man keine Buchung ableiten.
- Anfragen kommen dort **nur per E-Mail** herein, eine Direktbuchung gibt es nicht (bestätigt). Nach der Zusage wird die Buchung **in der App eingetragen**, mit Herkunft „FeWo-Bodensee“ bzw. „Bodenseeurlaub“. Damit landen sie in Smoobu und im Sammel-Feed.
- Der Portal-Feed wird trotzdem eingelesen, aber nur als **Kontrolle**: Meldet ein Portal „belegt“, obwohl in der App noch eine Wohnung frei ist, erscheint ein Hinweis „Bitte prüfen: bodenseeurlaub.de meldet 12.–15.7. als belegt“. (Hinweis: Die beiden Feeds konnten bei der Recherche aus der Cloud nicht abgerufen werden; Format und Inhalt prüfen wir in Phase 1.)

### 4.3 TouristInfo Immenstaad (Holidu)

Holidu unterstützt für Gastgeber grundsätzlich iCal-Import und -Export pro Inserat, auch mit Smoobu (Abgleich nicht in Echtzeit, laut Holidu „einige Stunden“). Die TouristInfo nutzt aber vermutlich das Holidu-Produkt für Tourismusorganisationen („Holidu Smart Destination“), bei dem der Gastgeber-Zugang eingeschränkt ist. Ob dort iCal möglich ist, ist offen.

**Stand 17.11.2026:** Im heutigen Zugang gibt es kein iCal, deshalb wird zunächst Weg B geplant. Laut matze kommt in etwa 3 Wochen (Anfang Dezember 2026) ein neues System. Dann prüfen wir, ob Weg A möglich wird. Die App ist so gebaut, dass der Wechsel nur eine Einstellung ist.

Zwei Wege:

- **Weg A (wenn iCal geht):** pro Wohnung den Smoobu-iCal-Export bei Holidu importieren und den Holidu-Export in Smoobu importieren. Dann ist das automatisch.
- **Weg B (Standard, falls nicht):** **Nachtrag-Liste mit Erinnerung.**
  - Jede neue, verschobene oder stornierte Buchung erzeugt automatisch eine Aufgabe „Bei TouristInfo Immenstaad nachtragen: Fewo 2, 12.–19.7. blockieren“.
  - Sofort geht eine **Push-Nachricht über ntfy an matze und die Schwiegermutter** (je ein eigenes, nicht erratbares Thema), mit direktem Link ins Holidu-/TouristInfo-Portal. E-Mail dient als Rückfall.
  - In der App gibt es oben ein kleines Feld „2 Nachträge offen“. Ein Tipp auf „Erledigt“ hakt es ab.
  - Bleibt eine Aufgabe 24 Stunden offen, kommt eine zweite Erinnerung.
  - Da über die TouristInfo nur **Anfragen** kommen (bestätigt), entsteht auch dort keine echte Doppelbuchung. Der Nachtrag sorgt dafür, dass Gäste dort keine belegten Zeiträume anfragen.
  - Umgekehrt: Buchungen, die nach einer Anfrage über die TouristInfo zustande kommen, trägt man in der App mit Herkunft „TouristInfo“ ein. Dann entsteht natürlich keine Nachtrag-Aufgabe für Holidu.

Dasselbe Nachtrag-Prinzip lässt sich für jeden weiteren Kanal ohne Schnittstelle einschalten (pro Kanal ein Schalter „Nachtrag nötig: ja/nein“).

### 4.4 Fewo 4 (Firma)

- Wird laut matze **durchgängig** von der Firma genutzt (bestätigt 17.11.2026). Sie bleibt deshalb außerhalb von Smoobu.
- In der App ist sie eine eigene Zeile mit einem durchgehenden Balken „Dauermiete Firma XY“, eingetragen in der App-eigenen Datenbank. Im Alltag gibt es dort nichts zu pflegen.
- Wird die Wohnung irgendwann doch frei vermietet, kann sie in Smoobu aufgenommen werden, und die App behandelt sie dann wie Fewo 1–3.

## 5. Bedienkonzept für das iPad

### 5.1 Gestaltungsregeln

- iPad im **Querformat**, Schrift mindestens 20 pt, Tipp-Flächen mindestens 48 × 48 pt.
- **Jede Wohnung hat eine feste Farbe und einen festen Namen**, so wie sie in der Familie genannt wird (z.B. „Seeblick“, „Garten“). Nie Smoobu-IDs. Name, Farbe und Reihenfolge sind in den Einstellungen **konfigurierbar** (Auswahl aus einer Palette gut unterscheidbarer, kontraststarker Farben).
- Unten immer dieselbe Leiste: **Heute · 4 Wochen · 3 Monate · Jahr · Neue Buchung**.
- Keine Wisch-Gesten als einzige Möglichkeit, immer auch große Pfeil-Knöpfe „◀ früher“ / „später ▶“.
- Kein Löschen ohne Rückfrage in Klartext („Buchung Familie Maier vom 12. bis 19. Juli wirklich stornieren?“), und danach 10 Sekunden „Rückgängig“.
- Hoher Kontrast, keine Graustufen-Texte, keine Fachbegriffe („Anreise/Abreise“, nicht „Check-in/Check-out“; „frei/belegt“, nicht „Availability“).
- Bleibt angemeldet (kein Passwort-Eingeben im Alltag). Anmeldung einmalig über einen Einrichtungs-Link oder eine 4-stellige PIN.
- Wenn das Internet weg ist: letzter Stand bleibt sichtbar mit Hinweis „Stand: heute 9:14 Uhr“. Eintragen ist dann gesperrt, damit nichts verloren geht.

### 5.2 Ansicht „4 Wochen“ (Startansicht)

Wie ein Belegungsplan: Zeilen = Wohnungen, Spalten = Tage, Buchungen als farbige Balken mit Gastnamen.

```
            Mo 17  Di 18  Mi 19  Do 20  Fr 21  Sa 22  So 23  Mo 24 …
Seeblick    [ Maier ──────────────────]      [ Huber ─────────
Garten            [ Schmidt ──────────────────────────]
Wiese       ·  frei  ·  frei  ·  frei  · [ Weber ───────]
Firma       [ Dauermiete Firma XY ─────────────────────────────
```

- Heute ist deutlich markiert.
- Anreise-/Abreisetag als halbe Zelle (wie im Papierkalender mit Schrägstrich), damit Wechseltage sofort erkennbar sind.
- Oben eine Zeile „Diese Woche: 2 Anreisen, 1 Abreise“.
- Tipp auf einen Balken → Buchungskarte. Tipp auf freien Tag → „Neue Buchung hier?“.

### 5.3 Ansicht „3 Monate“

Gleiches Raster, schmalere Tage, Namen gekürzt. Ziel: freie Lücken für Anfragen schnell finden. Freie Zeiträume ab 3 Nächten werden dezent grün hervorgehoben.

### 5.4 Ansicht „Jahr“

12 Monatsblöcke, je Wohnung eine schmale Zeile, nur Farbe belegt/frei (keine Namen). Dazu je Monat die Auslastung in Prozent. Tipp auf einen Monat springt in die 4-Wochen-Ansicht.

### 5.5 Buchungskarte (Ansehen)

Groß und vollständig: Gastname, Adresse, Telefon (antippbar), Anreise, Abreise, Nächte, Anzahl Reisende, Preis, Herkunft (Telefon, FeWo-Bodensee, Bodenseeurlaub, TouristInfo, Booking.com …), Notiz. Knöpfe: **Ändern**, **Verschieben**, **Stornieren**. Bei Portal-Buchungen, die nur lesend sind, steht stattdessen „Diese Buchung bitte bei Booking.com ändern“.

### 5.6 Neue Buchung (Schritt für Schritt)

Ein Schritt pro Bildschirm, mit großem „Weiter“:

1. **Welche Wohnung?** (4 große farbige Knöpfe; belegte sind ausgegraut mit Grund)
2. **Wann?** Anreise und Abreise im großen Monatskalender antippen. Die App zeigt sofort „7 Nächte“ und warnt rot, wenn sich etwas überschneidet.
3. **Wer?** Name (Pflicht), Adresse, Telefon, Anzahl Reisende.
4. **Preis** (Gesamtpreis in Euro, eine große Zahl).
5. **Woher kam die Buchung?** Große Knöpfe mit den Kanälen.
6. **Notiz** (optional, z.B. „Hund“, „kommt spät“).
7. **Zusammenfassung** in einem Satz + „Eintragen“.

Danach: grüner Haken „Eingetragen“, und falls nötig der Hinweis „Bitte noch bei TouristInfo nachtragen. matze wurde benachrichtigt.“

### 5.7 Rollen

- **Schwiegermutter:** sieht und bearbeitet alles oben Beschriebene, auch Stornieren und Verschieben (bestätigt). Verschieben läuft als Schritt-für-Schritt-Ablauf wie „Neue Buchung“, mit vorausgefüllten Daten. Bei jeder Stornierung oder Verschiebung bekommt matze eine kurze ntfy-Info, damit er im Bild ist. Alles andere sieht sie nicht.
- **matze (Verwaltung):** zusätzlich Einstellungen (Wohnungsnamen/Farben, Kanäle, wer welche Benachrichtigung bekommt, Smoobu-Verbindung, iCal-Links), Protokoll aller Änderungen.

## 6. PDF-Export pro Monat

- Knopf „Monat drucken / als PDF“ in jeder Ansicht.
- A4 quer, eine Seite pro Monat: oben Monatsname, darunter das Raster Wohnungen × Tage mit Gastnamen, unten eine Liste aller Buchungen des Monats (Wohnung, Name, Adresse, Telefon, Anreise, Abreise, Reisende, Preis, Notiz).
- Optional zweite Variante „zum Aushängen“ ohne Adresse, Telefon, Preis und Notizen.
- Erzeugt auf dem Server, damit das Ergebnis immer gleich aussieht.
- **Gedruckt wird vom PC aus** (bestätigt): Die App läuft auch im PC-Browser, dort gibt es den Knopf „Monat als PDF“. Auf dem iPad kann das PDF zusätzlich angesehen oder geteilt werden, ein AirPrint-Drucker ist nicht nötig.

## 7. Technik-Vorschlag

| Baustein | Vorschlag | Warum |
|---|---|---|
| Oberfläche | PWA mit **SvelteKit** (oder Next.js), TypeScript | eine Codebasis für iPad, Handy, PC; als App-Symbol installierbar |
| Server | im selben SvelteKit-Projekt (Node) | ein Projekt, ein Deployment |
| Datenbank | **SQLite** | reicht für 4 Wohnungen dauerhaft, eine Datei, leicht zu sichern |
| PDF | serverseitig HTML → PDF (Playwright/Chromium) | exakt gleiches Layout wie die Ansicht |
| Benachrichtigung | **ntfy** (Push aufs Handy/iPad über die ntfy-App, Dienst ntfy.sh oder selbst betrieben) + E-Mail als Rückfall | gewünscht von matze; der Server schickt nur eine einfache HTTP-Nachricht, ohne eigenes App-Store-Konto |
| Hosting | **Start auf matzes Homeserver („homesrv“)** als Docker-Container; Debian + Docker vorhanden; von außen erreichbar unter einer Subdomain von matzes eigener Domain (z.B. `kalender.<domain>`) über einen **Cloudflare Tunnel** (kostenlos, HTTPS, keine Portfreigabe am Router). Später bei Bedarf Umzug auf einen kleinen VPS in Deutschland (ca. 4–5 €/Monat), ohne Code-Änderung | Smoobu-Webhooks, die Portale (Sammel-iCal) und das iPad bei der Schwiegermutter müssen den Server aus dem Internet erreichen |
| Backup | tägliche Kopie der SQLite-Datei | Smoobu hält ohnehin die Hauptdaten |

Hinweise zum Homeserver: Fällt der Strom oder das Internet zu Hause aus, sieht das iPad den letzten Stand und Eintragen ist kurz gesperrt. Smoobu-Daten gehen dabei nicht verloren, weil der Server nach dem Neustart per Abgleich nachholt. Die Portale behalten den zuletzt abgerufenen Sammel-Feed.

Weitere Alternativen: Serverless (Cloudflare Workers + D1) ist günstiger, macht aber die PDF-Erzeugung umständlicher. Ein Raspberry Pi zu Hause ginge auch, braucht aber eine von außen erreichbare Adresse.

Datenschutz: Gastdaten liegen in Smoobu; die App speichert nur einen Zwischenspeicher, Fewo-4-Einträge, Notizen und das Änderungsprotokoll. Zugriff nur mit Anmeldung, iCal-Feed nur mit geheimem Token und **ohne** Gastnamen (nur „belegt“).

## 8. Offene Fragen an matze

1. **Smoobu-Tarif:** Ist die API im gebuchten Tarif enthalten, und sind Webhooks verfügbar? Gibt es einen API-Schlüssel nach dem neuen HMAC-Verfahren? → **matze prüft das.** (Schlüssel nie hier eintragen.) Ohne API greift die Rückfallvariante aus 4.1.
2. ~~**Kanäle in Smoobu**~~ – beantwortet: Booking.com und Airbnb sind angebunden. Die Bodensee-Portale sind nicht mit Smoobu verbunden.
3. ~~**Portale**~~ – beantwortet: Buchungen kommen nur als Anfrage per E-Mail. Beide Portale bieten immer alle 3 Wohnungen als einen Eintrag an; „frei“, solange mindestens eine Wohnung frei ist.
4. ~~**TouristInfo Immenstaad**~~ – beantwortet: kein iCal (neues System ca. Anfang Dezember 2026, dann neu prüfen). Über die TouristInfo kommen nur Anfragen, keine Direktbuchungen.
5. ~~**Fewo 4**~~ – beantwortet: Die Firma nutzt die Wohnung durchgängig. Sie bleibt außerhalb von Smoobu.
6. ~~**Wer bekommt Nachtrag-Erinnerungen?**~~ – beantwortet: beide, matze und die Schwiegermutter, per Push über ntfy.
7. ~~**Darf die Schwiegermutter selbst stornieren und verschieben?**~~ – beantwortet: ja, sofern es einfach bedienbar ist. matze bekommt bei jeder Stornierung/Verschiebung eine ntfy-Info.
8. ~~**Welche Infos stehen im Papierkalender?**~~ – beantwortet: Name, Adresse, Telefonnummer, Preis, Anzahl Reisende.
9. ~~**Namen und Farben der Wohnungen**~~ – beantwortet: konfigurierbar in den Einstellungen (Verwaltung).
10. ~~**iPad / Drucker**~~ – beantwortet: normales iPad, ca. 3 Jahre alt (aktuelles iPadOS, PWA-tauglich). Gedruckt wird vom PC aus.
11. ~~**Hosting**~~ – beantwortet: matzes Homeserver („homesrv“) mit Debian und Docker; eine eigene Domain ist vorhanden.
12. ~~**Altdaten**~~ – beantwortet: Alle bestehenden Buchungen sind bereits in Smoobu und erscheinen ab Phase 1 automatisch in der App. Ein Import ist nicht nötig.

## 9. Phasenplan

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **0 – Klären** | offene Fragen beantworten, TouristInfo nach iCal fragen, Smoobu-API-Zugang prüfen | Entscheidungen fix |
| **1 – Lesen** | Server + Smoobu-Anbindung (nur lesen), Fewo 4 in eigener DB, 4-Wochen-Ansicht, Installation aufs iPad | Schwiegermutter kann die Belegung sehen, parallel zum Papierkalender |
| **2 – Eintragen** | Neue Buchung, Ändern, Verschieben, Stornieren über Smoobu; Änderungsprotokoll | Papierkalender wird überflüssig |
| **3 – Portale** | Sammel-iCal-Feed für beide Bodensee-Portale, Kontrolle der Portal-Feeds, Nachtrag-Liste + E-Mail für TouristInfo | Doppelbuchungen werden praktisch ausgeschlossen |
| **4 – Planung & Druck** | 3-Monats- und Jahresansicht, PDF-Monatsexport | vollständiger Funktionsumfang |
| **5 – Feinschliff** | Rückmeldungen der Schwiegermutter einarbeiten, Schriftgröße, Farben, Push-Nachrichten | Alltagstauglich |

Empfehlung: nach Phase 1 und nach Phase 2 je eine Woche mit der Schwiegermutter testen, bevor es weitergeht. Der Papierkalender bleibt bis Ende Phase 2 parallel in Gebrauch.

## 10. Risiken

- **Smoobu-API-Änderungen** (z.B. die Umstellung auf HMAC 2026). Gegenmaßnahme: Anbindung in einem einzigen Modul kapseln.
- **iCal ist langsam** (Portale holen Feeds teils nur alle paar Stunden). Zwischen zwei Abrufen ist eine Doppelbuchung möglich. Gegenmaßnahme: Kontrollhinweise und kurze Abrufintervalle, wo einstellbar.
- **Nachträge werden vergessen.** Gegenmaßnahme: zweite Erinnerung und sichtbarer Zähler in der App.
- **Verschieben = stornieren + neu anlegen** in Smoobu kann bei Kanal-Buchungen nicht funktionieren. Gegenmaßnahme: Verschieben nur für eigene Buchungen anbieten.

## Quellen

- Smoobu API-Dokumentation: https://docs.smoobu.com/
- Smoobu Hilfe – API: https://support.smoobu.com/hc/en-us/articles/360003170740-Smoobu-API-Documentation
- Holidu Hilfe – iCal-Synchronisation einrichten: https://www.holidu.de/help/host/verwaltung-ihrer-inserate/5289-wie-konfiguriere-ich-ein-icalsynchronisierung-um-meinen-kalender-mit-anderen-plattformen-zu-verbinden
- Holidu Hilfe – Was ist eine iCal-Synchronisation: https://www.holidu.de/help/host/verwaltung-ihrer-inserate/5434-was-ist-eine-ical-synchronisation
- Holidu Smart Destination (Angebot für Tourismusorganisationen): https://www.holidu.de/hsd
