/* Fewo-Kalender – Oberfläche (iPad: data-mode="view", PC: data-mode="admin") */
(() => {
  'use strict';

  const MODE = document.body.dataset.mode === 'admin' ? 'admin' : 'view';
  if (MODE === 'admin') document.body.classList.add('pc');

  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const add = (dt, n) => { const r = new Date(dt); r.setDate(r.getDate() + n); return r; };
  const diff = (a, b) => Math.round((b - a) / 86400000);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const f = dt => `${dt.getDate()}.${dt.getMonth() + 1}.`;
  const fy = dt => `${f(dt)}${dt.getFullYear()}`;
  const fl = dt => `${WDL[dt.getDay()]}, ${dt.getDate()}. ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
  const startOfWeek = dt => add(dt, -((dt.getDay() + 6) % 7));
  const midnight = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const color = c => `var(--${/^p[1-8]$/.test(c) ? c : 'p1'})`;

  let TODAY = midnight();
  const state = { view: 'w4', start: startOfWeek(TODAY), m3: new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), year: TODAY.getFullYear() };
  let data = { apartments: [], events: [], holidays: [], seasons: [] };
  let lastOk = null;
  let loadError = null;

  /* ---------- Laden ---------- */

  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Fehler ${res.status}`);
    return j;
  }

  async function load() {
    try {
      const j = await api('/api/calendar');
      data = {
        apartments: j.apartments,
        events: j.events.map(e => ({ ...e, arr: D(e.start), dep: D(e.end) })),
        holidays: (j.holidays || []).map(h => ({ ...h, arr: D(h.start), dep: D(h.end) })),
        seasons: (j.seasons || []).map(s => ({ ...s, arr: D(s.start), dep: D(s.end) })),
      };
      lastOk = new Date(); loadError = null;
    } catch (e) {
      loadError = e.message;
    }
    const now = midnight();
    if (!same(now, TODAY)) { TODAY = now; }
    if (state.view !== 'settings') render(); else renderTop();
  }

  /* ---------- Kopf ---------- */

  function renderTop() {
    const ical = data.apartments.filter(a => a.source === 'ical' && a.configured);
    const times = ical.map(a => a.fetchedAt).filter(Boolean).map(t => new Date(t));
    const oldest = times.length ? new Date(Math.min(...times)) : null;
    const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} Uhr`;
    const when = d => same(d, new Date()) ? `heute ${hm(d)}` : `${f(d)} ${hm(d)}`;
    const line = $('#standLine');
    let txt = `Heute: ${fl(TODAY)}`;
    if (oldest) txt += ` · Stand ${when(oldest)}`;
    line.classList.toggle('stale', !!loadError || (oldest && Date.now() - oldest > 3 * 3600000));
    if (loadError) txt += ` · Keine Verbindung, zeige letzten Stand${lastOk ? ' von ' + when(lastOk) : ''}`;
    line.textContent = txt;

    const banner = $('#banner');
    const missing = data.apartments.filter(a => !a.configured);
    const errors = data.apartments.filter(a => a.error);
    let msg = '';
    if (missing.length) msg = `Für ${missing.map(a => a.name).join(', ')} ist noch kein Kalender hinterlegt. ${MODE === 'admin' ? 'Bitte unter ⚙ Einstellungen eintragen.' : 'Das wird am PC eingerichtet.'}`;
    else if (errors.length && MODE === 'admin') msg = `Abruf fehlgeschlagen: ${errors.map(a => `${a.name} (${a.error})`).join(', ')}. Angezeigt wird der letzte Stand.`;
    banner.hidden = !msg; banner.textContent = msg;

    $$('nav.dock [data-nav]').forEach(b => b.setAttribute('aria-current', b.dataset.nav === state.view ? 'true' : 'false'));
    $('#legend').innerHTML = data.apartments.map(a => `<span><i style="background:${color(a.color)}"></i>${esc(a.name)}${a.nick && a.nick !== a.name ? ` „${esc(a.nick)}“` : ''}</span>`).join('')
      + `<span><i style="background:var(--holiday)"></i>Schulferien BW</span><span><i style="background:var(--s-haupt)"></i>Hauptsaison</span><span><i style="background:var(--s-neben)"></i>Nebensaison</span>`;
  }

  /* ---------- Raster (4 Wochen / 3 Monate) ---------- */

  function spanCols(item, start, n) {
    const si = diff(start, item.arr), ei = diff(start, item.dep);
    return [si < 0 ? 2 : 2 + 2 * si, ei >= n ? 2 + 2 * n : 2 + 2 * ei];
  }

  function renderGrid(start, n, compact) {
    const end = add(start, n);
    const rowH = compact ? 'var(--row-h-c)' : 'var(--row-h)';
    const pubDays = new Map();
    data.holidays.filter(h => h.kind === 'public').forEach(h => pubDays.set(h.start, h.name));
    let h = `<div class="grid ${compact ? 'compact' : ''}" style="grid-template-columns:var(--label-w) repeat(${2 * n}, minmax(0, 1fr));grid-template-rows:auto ${compact ? '22px 14px' : '30px 18px'} repeat(${data.apartments.length}, ${rowH})">`;
    h += `<div class="hd" style="grid-column:1;grid-row:1"></div>`;
    for (let i = 0; i < n; i++) {
      const dt = add(start, i), we = dt.getDay() === 0 || dt.getDay() === 6, pub = pubDays.get(iso(dt));
      const top = compact ? (dt.getDate() === 1 ? `<span class="monthmark">${MONTHS[dt.getMonth()].slice(0, 3)}</span>` : WD[dt.getDay()][0]) : WD[dt.getDay()];
      h += `<div class="hd ${we ? 'we' : ''} ${pub ? 'pub' : ''} ${same(dt, TODAY) ? 'today' : ''}" style="grid-column:${2 + 2 * i} / span 2;grid-row:1" ${pub ? `title="${esc(pub)}"` : ''}>${top}<b>${dt.getDate()}</b></div>`;
    }
    // Ferien- und Saisonband
    h += `<div class="rowlbl" style="grid-column:1;grid-row:2">Ferien BW</div><div class="rowlbl" style="grid-column:1;grid-row:3">Saison</div>`;
    data.holidays.filter(x => x.arr < end && x.dep > start).forEach(x => {
      const [c0, c1] = spanCols(x, start, n);
      h += `<div class="band ${x.kind === 'public' ? 'public' : 'school'}" style="grid-column:${c0} / ${c1};grid-row:2" title="${esc(x.name)}">${x.kind === 'public' ? '●' : esc(x.name)}</div>`;
    });
    data.seasons.filter(x => x.arr < end && x.dep > start).forEach(x => {
      const [c0, c1] = spanCols(x, start, n);
      h += `<div class="band ${x.kind}" style="grid-column:${c0} / ${c1};grid-row:3" title="${esc(x.name)}">${compact ? '' : esc(x.name)}</div>`;
    });
    data.apartments.forEach((a, r) => {
      const row = r + 4;
      h += `<div class="lbl" style="grid-column:1;grid-row:${row}"><span class="dot" style="background:${color(a.color)}"></span><span>${esc(a.name)}${a.nick && a.nick !== a.name ? `<small>${esc(a.nick)}</small>` : ''}</span></div>`;
      for (let i = 0; i < n; i++) {
        const dt = add(start, i), we = dt.getDay() === 0 || dt.getDay() === 6;
        h += `<div class="cell ${we ? 'we' : ''} ${same(dt, TODAY) ? 'today' : ''}" style="grid-column:${2 + 2 * i} / span 2;grid-row:${row}"></div>`;
      }
      data.events.filter(e => e.apt === a.id && e.arr < end && e.dep > start).forEach(e => {
        const si = diff(start, e.arr), ei = diff(start, e.dep);
        const c0 = si < 0 ? 2 : 3 + 2 * si, c1 = ei >= n ? 2 + 2 * n : 3 + 2 * ei;
        h += `<button type="button" class="bar" style="grid-column:${c0} / ${c1};grid-row:${row};background:${color(a.color)}" data-event="${esc(e.id)}">${esc(e.title || 'Belegt')}</button>`;
      });
    });
    return h + '</div>';
  }

  function summary(start, n) {
    const end = add(start, n);
    const ev = data.events.filter(e => e.source !== 'Belegungsplan');
    const arr = ev.filter(e => e.arr >= start && e.arr < end).length;
    const dep = ev.filter(e => e.dep >= start && e.dep < end).length;
    const wkEnd = add(startOfWeek(TODAY), 7);
    const aw = ev.filter(e => e.arr >= TODAY && e.arr < wkEnd).sort((a, b) => a.arr - b.arr);
    const who = aw.map(e => `${esc(e.title || 'Belegt')}, ${WD[e.arr.getDay()]} ${f(e.arr)}`).join('; ');
    return `Diese Woche noch: <b>${aw.length} Anreise${aw.length === 1 ? '' : 'n'}</b>${aw.length ? ` (${who})` : ''} · Im Zeitraum: ${arr} Anreisen, ${dep} Abreisen`;
  }

  /* ---------- Jahr ---------- */

  function renderYear() {
    const y = state.year;
    const rented = data.apartments.filter(a => a.source === 'ical');
    let h = '<div class="year">';
    for (let m = 0; m < 12; m++) {
      const days = new Date(y, m + 1, 0).getDate();
      let nights = 0, rows = '';
      const band = (list, cls) => {
        let cells = '';
        for (let d = 1; d <= days; d++) {
          const dt = new Date(y, m, d);
          const x = list.find(x => x.arr <= dt && x.dep > dt);
          cells += `<i style="${x ? `background:var(${cls(x)})` : ''}" ${x ? `title="${esc(x.name)}"` : ''}></i>`;
        }
        return `<div class="mrow thin" style="grid-template-columns:repeat(${days},1fr)">${cells}</div>`;
      };
      rows += band(data.holidays.filter(x => x.kind === 'school'), () => '--holiday');
      rows += band(data.seasons, x => x.kind === 'haupt' ? '--s-haupt' : '--s-neben');
      data.apartments.forEach(a => {
        let cells = '';
        for (let d = 1; d <= days; d++) {
          const dt = new Date(y, m, d);
          const b = data.events.some(e => e.apt === a.id && e.arr <= dt && e.dep > dt);
          if (b && a.source === 'ical') nights++;
          cells += `<i style="${b ? `background:${color(a.color)}` : ''}"></i>`;
        }
        rows += `<div class="mrow" style="grid-template-columns:repeat(${days},1fr)" title="${esc(a.name)}">${cells}</div>`;
      });
      const pct = rented.length ? Math.round(100 * nights / (days * rented.length)) : 0;
      h += `<button type="button" class="month" data-month="${m}"><h3>${MONTHS[m]} <span>${rented.length ? `${pct} % belegt` : ''}</span></h3>${rows}</button>`;
    }
    return h + '</div>';
  }

  /* ---------- Rendern ---------- */

  function render() {
    renderTop();
    const set = state.view === 'settings';
    ['#toolbar', '#summary', '#legend', '#dock'].forEach(s => { $(s).hidden = set; });
    $('#setBtn').textContent = set ? '◀ Zurück zum Kalender' : '⚙ Einstellungen';
    const v = $('#view');
    if (set) return renderSettings();
    if (!data.apartments.length) { v.innerHTML = `<div class="empty">${loadError ? 'Keine Verbindung zum Server.' : 'Lade …'}</div>`; return; }
    if (state.view === 'w4') {
      $('#rangeTitle').textContent = `4 Wochen: ${fy(state.start)} bis ${fy(add(state.start, 27))}`;
      $('#summary').innerHTML = summary(state.start, 28);
      v.innerHTML = `<div class="board">${renderGrid(state.start, 28, false)}</div>`;
    } else if (state.view === 'm3') {
      const s = state.m3, e = new Date(s.getFullYear(), s.getMonth() + 3, 1);
      $('#rangeTitle').textContent = `3 Monate: ${MONTHS[s.getMonth()]} bis ${MONTHS[add(e, -1).getMonth()]} ${add(e, -1).getFullYear()}`;
      $('#summary').innerHTML = summary(s, diff(s, e));
      v.innerHTML = `<div class="board">${renderGrid(s, diff(s, e), true)}</div>`;
    } else {
      $('#rangeTitle').textContent = `Jahr ${state.year}`;
      $('#summary').textContent = 'Auf einen Monat tippen, um ihn im Detail zu sehen.';
      v.innerHTML = renderYear();
    }
  }

  function step(dir) {
    if (state.view === 'w4') state.start = add(state.start, 7 * dir);
    else if (state.view === 'm3') state.m3 = new Date(state.m3.getFullYear(), state.m3.getMonth() + dir, 1);
    else state.year += dir;
    render();
  }

  /* ---------- Karte, Toast ---------- */

  function toast(text) {
    const root = $('#toastRoot');
    root.innerHTML = `<div class="toast" role="status">${esc(text)}</div>`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { root.innerHTML = ''; }, 4000);
  }

  function overlay(html) {
    $('#overlayRoot').innerHTML = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
    $('#ov').addEventListener('click', e => { if (e.target.id === 'ov') closeOverlay(); });
  }
  function closeOverlay() { $('#overlayRoot').innerHTML = ''; }

  function openEvent(id) {
    const e = data.events.find(x => String(x.id) === id);
    if (!e) return;
    const a = data.apartments.find(x => x.id === e.apt);
    const own = e.source === 'Belegungsplan';
    overlay(`<h2>${esc(e.title || 'Belegt')}</h2>
      <dl class="facts">
        <dt>Wohnung</dt><dd>${esc(a.name)}${a.nick && a.nick !== a.name ? ` „${esc(a.nick)}“` : ''}</dd>
        <dt>${own ? 'Von' : 'Anreise'}</dt><dd>${fl(e.arr)}</dd>
        <dt>${own ? 'Bis' : 'Abreise'}</dt><dd>${fl(e.dep)}</dd>
        <dt>Nächte</dt><dd>${diff(e.arr, e.dep)}</dd>
        ${e.note ? `<dt>Notiz</dt><dd>${esc(e.note)}</dd>` : ''}
        ${e.phone ? `<dt>Telefon</dt><dd><a href="tel:${esc(e.phone)}">${esc(e.phone)}</a></dd>` : ''}
        ${e.mobile ? `<dt>Handy</dt><dd><a href="tel:${esc(e.mobile)}">${esc(e.mobile)}</a></dd>` : ''}
        ${e.email ? `<dt>E-Mail</dt><dd>${e.email.split(', ').map(m => `<a href="mailto:${esc(m)}">${esc(m)}</a>`).join('<br>')}</dd>` : ''}
        <dt>Quelle</dt><dd>${own ? 'Belegungsplan der Firma' : 'Smoobu'}</dd>
      </dl>
      <div class="notice">${own ? 'Wird am PC in den Einstellungen gepflegt.' : 'Änderungen bitte vorerst in Smoobu vornehmen.'}</div>
      <div class="row end"><button class="btn primary" type="button" id="closeB">Schließen</button></div>`);
    $('#closeB').onclick = closeOverlay;
  }

  /* ---------- Einstellungen (nur PC) ---------- */

  let cfg = null;
  const firmSel = new Set();
  let pasteOpen = false;
  let preview = null; // { rows, skipped, source }

  async function loadCfg() { cfg = await api('/api/admin/config'); }

  async function renderSettings() {
    const v = $('#view');
    if (MODE !== 'admin') { state.view = 'w4'; return render(); }
    try { await loadCfg(); } catch (e) { v.innerHTML = `<div class="notice warn">${esc(e.message)}</div>`; return; }
    const sec = (id, title, desc, inner) => `<section class="sec" id="s-${id}"><h3>${title}</h3>${desc ? `<p class="d">${desc}</p>` : ''}${inner}</section>`;
    const when = t => t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';
    const n = cfg.apartments.length;

    const aptRows = cfg.apartments.map((a, i) => {
      const st = cfg.status.find(s => s.id === a.id) || {};
      const status = a.source === 'own' ? `<span class="badge ok">aktiv</span> <span class="small">${cfg.firm.length} Einträge</span>`
        : !a.hasUrl ? '<span class="badge off">kein Link</span>'
        : st.error ? `<span class="badge err" title="${esc(st.error)}">Fehler</span> <span class="small">${esc(st.error)}</span>`
        : `<span class="badge ok">ok</span> <span class="small">${when(st.fetchedAt)} · ${st.count ?? 0} Einträge</span>`;
      const link = a.source === 'own'
        ? `<span class="small">Eigener Kalender der App</span> <a class="mini" href="#s-firm" style="display:inline-flex;align-items:center;text-decoration:none;color:var(--fg)">Tabelle</a>`
        : `<div class="row"><input class="in" data-url="${a.id}" placeholder="${a.hasUrl ? `hinterlegt (${esc(a.urlHost)}) – zum Ändern neuen Link einfügen` : 'iCal-Link aus Smoobu einfügen'}" autocomplete="off"><button class="mini" type="button" data-saveurl="${a.id}">Speichern</button></div>`;
      return `<tr>
        <td><b>${esc(a.name)}</b></td>
        <td><input class="in" data-nick="${a.id}" value="${esc(a.nick)}" aria-label="Name ${esc(a.name)}"></td>
        <td><div class="swatches">${cfg.colors.map(c => `<button type="button" class="sw" style="background:var(--${c})" data-color="${a.id}|${c}" aria-pressed="${a.color === c}" aria-label="Farbe ${c}"></button>`).join('')}</div></td>
        <td><select class="in" data-source="${a.id}"><option value="ical" ${a.source === 'ical' ? 'selected' : ''}>iCal-Link (Smoobu)</option><option value="own" ${a.source === 'own' ? 'selected' : ''}>Eigener Kalender</option></select></td>
        <td style="min-width:280px">${link}</td>
        <td>${status}</td>
        <td style="white-space:nowrap"><button class="mini" type="button" data-move="${i}|-1" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">▲</button> <button class="mini" type="button" data-move="${i}|1" ${i === n - 1 ? 'disabled' : ''} aria-label="nach unten">▼</button></td>
      </tr>`;
    }).join('');

    const feedUrl = cfg.feedUrl;

    const md = s => { const [m, d] = s.split('-'); return `${d}.${m}.`; };
    const seasonRows = cfg.seasons.map(s => `<tr>
      <td><select class="in" data-sea="${s.id}|kind"><option value="haupt" ${s.kind === 'haupt' ? 'selected' : ''}>Hauptsaison</option><option value="neben" ${s.kind === 'neben' ? 'selected' : ''}>Nebensaison</option></select></td>
      <td><input class="in short" data-sea="${s.id}|from" value="${md(s.from)}" placeholder="TT.MM."></td>
      <td><input class="in short" data-sea="${s.id}|to" value="${md(s.to)}" placeholder="TT.MM."></td>
      <td><input class="in" data-sea="${s.id}|label" value="${esc(s.label)}"></td>
      <td><button class="mini" type="button" data-seadel="${s.id}" aria-label="Saison löschen">✕</button></td></tr>`).join('');

    const hs = cfg.holidayStatus;
    const manualRows = cfg.manualHolidays.map(h => `<tr><td>${fy(D(h.start))}</td><td>${fy(add(D(h.end), -1))}</td><td>${esc(h.name)}</td><td><button class="mini" type="button" data-holdel="${h.id}" aria-label="löschen">✕</button></td></tr>`).join('');

    v.innerHTML = `<div class="settings">
      <nav class="snav" aria-label="Bereiche">
        <a href="#s-quellen">Wohnungen &amp; Datenquellen</a><a href="#s-firm">Belegungsplan ${esc(ownName())}</a><a href="#s-saison">Haupt- und Nebensaison</a><a href="#s-ferien">Ferien BW</a>
      </nav>
      <div class="sbody">
        ${sec('quellen', 'Wohnungen & Datenquellen', 'Name, Farbe, Reihenfolge und woher die Belegung jeder Wohnung kommt. Die iCal-Links findest du in Smoobu je Wohnung unter Kalender-Export. Ein gespeicherter Link wird aus Sicherheitsgründen nicht mehr angezeigt.', `
          <div class="tbl"><table><thead><tr><th>Nr.</th><th>Name</th><th>Farbe</th><th>Quelle</th><th>Link</th><th>Status</th><th>Reihenfolge</th></tr></thead><tbody>${aptRows}</tbody></table></div>
          <div class="row">Abruf alle <select class="in" id="interval" style="width:auto">${[5, 10, 15, 30, 60].map(m => `<option value="${m}" ${cfg.settings.intervalMinutes === m ? 'selected' : ''}>${m}</option>`).join('')}</select> Minuten
            <button class="mini" type="button" id="refreshNow">Jetzt abrufen</button></div>
          ${feedUrl ? `<div class="row"><span>iCal-Link des eigenen Kalenders (${esc(ownName())}):</span><span class="mono" id="feedUrl">${esc(feedUrl)}</span>
            <button class="mini" type="button" id="copyFeed">Kopieren</button><button class="mini" type="button" id="newFeed">Neuen Link erzeugen</button></div>
            <p class="small">Den Link nur weitergeben, wenn der Kalender anderswo abonniert werden soll (z. B. in Smoobu). „Neuen Link erzeugen“ macht den alten ungültig.</p>` : ''}`)}
        ${sec('firm', `Belegungsplan ${esc(ownName())}`, 'Die Firma schickt ihren Plan als PDF. Hier wird er als Tabelle gepflegt. Änderungen erscheinen sofort im Kalender.', firmTable())}
        ${sec('saison', 'Haupt- und Nebensaison', 'Gilt jedes Jahr wieder. Über den Jahreswechsel ist möglich (z. B. 20.12. bis 06.01.). Zeiten ohne Eintrag gelten als „keine Saison“.', `
          <div class="tbl"><table><thead><tr><th>Art</th><th>Von (TT.MM.)</th><th>Bis (TT.MM.)</th><th>Bezeichnung</th><th></th></tr></thead><tbody>${seasonRows}</tbody></table></div>
          <div class="row"><button class="mini" type="button" id="seaAdd">+ Saison</button></div>`)}
        ${sec('ferien', 'Schulferien und Feiertage Baden-Württemberg', 'Werden automatisch einmal täglich von openholidaysapi.org geladen. Fehlt etwas, kannst du Zeiträume von Hand ergänzen.', `
          <div class="row">${hs.error && !hs.count ? `<span class="badge err">Fehler</span> <span class="small">${esc(hs.error)}</span>` : hs.count ? `<span class="badge ok">ok</span> <span class="small">${hs.count} Einträge, Stand ${when(hs.fetchedAt)}${hs.error ? ` (letzter Abruf fehlgeschlagen: ${esc(hs.error)})` : ''}</span>` : '<span class="badge off">noch nicht geladen</span>'}</div>
          <div class="tbl"><table><thead><tr><th>Von</th><th>Bis</th><th>Bezeichnung</th><th></th></tr></thead><tbody>${manualRows || '<tr><td colspan="4" class="small">Keine eigenen Einträge.</td></tr>'}</tbody></table></div>
          <div class="row"><input class="in" type="date" id="holFrom" style="width:auto"> bis <input class="in" type="date" id="holTo" style="width:auto"><input class="in" id="holName" placeholder="z. B. Pfingstferien" style="width:220px"><button class="mini" type="button" id="holAdd">Hinzufügen</button></div>`)}
      </div></div>`;
    bindSettings();
  }

  function ownName() { const a = cfg?.apartments.find(x => x.source === 'own'); return a ? a.name : 'Fewo 1'; }

  function firmTable() {
    const rows = cfg.firm;
    const clash = b => rows.some(o => o !== b && o.from < b.to && o.to > b.from);
    const body = rows.map(b => `<tr class="${clash(b) ? 'bad' : ''}">
      <td><input type="checkbox" data-fsel="${b.id}" ${firmSel.has(b.id) ? 'checked' : ''} aria-label="markieren"></td>
      <td><input class="in" type="date" data-fset="${b.id}|from" value="${b.from}"></td>
      <td><input class="in" type="date" data-fset="${b.id}|to" value="${b.to}"></td>
      <td>${diff(D(b.from), D(b.to))}</td>
      <td><input class="in" data-fset="${b.id}|name" value="${esc(b.name)}"></td>
      <td><input class="in" data-fset="${b.id}|note" value="${esc(b.note)}"></td>
      <td><input class="in" data-fset="${b.id}|phone" value="${esc(b.phone)}" placeholder="Telefon"><input class="in" data-fset="${b.id}|mobile" value="${esc(b.mobile)}" placeholder="Handy" style="margin-top:4px"></td>
      <td><input class="in" data-fset="${b.id}|email" value="${esc(b.email)}" placeholder="E-Mail"></td>
      <td><button class="mini" type="button" data-fdel="${b.id}" aria-label="Zeile löschen">✕</button></td></tr>`).join('');
    const warn = rows.some(clash) ? '<div class="notice warn">Rot markierte Zeilen überschneiden sich.</div>' : '';
    return `<div class="tbl"><table><thead><tr><th></th><th>Von</th><th>Bis</th><th>Nächte</th><th>Bewohner / Bezeichnung</th><th>Notiz</th><th>Telefon / Handy</th><th>E-Mail</th><th></th></tr></thead>
      <tbody>${body || '<tr><td colspan="9" class="small">Noch keine Einträge. Mit „PDF-Belegungsplan hochladen“, „+ Zeile“ oder „Aus Text einfügen“ anlegen.</td></tr>'}</tbody></table></div>${warn}
      <div class="row"><button class="mini" type="button" id="fAdd">+ Zeile</button>
        <label class="mini" style="display:inline-flex;align-items:center;cursor:pointer">PDF-Belegungsplan hochladen …<input type="file" id="fPdf" accept="application/pdf,.pdf" hidden></label>
        <button class="mini" type="button" id="fPaste">Aus Text einfügen</button></div>
      ${preview ? previewBox() : ''}
      <div class="row"><b>Markierte (${firmSel.size}):</b> verschieben um <input class="in short" id="fShift" type="number" value="7"> Tage
        <button class="mini" type="button" id="fShiftGo" ${firmSel.size ? '' : 'disabled'}>Verschieben</button>
        <button class="mini" type="button" id="fDelSel" ${firmSel.size ? '' : 'disabled'}>Löschen</button>
        <button class="mini" type="button" id="fAll" ${rows.length ? '' : 'disabled'}>Alle markieren</button>
        <button class="mini" type="button" id="fNone" ${firmSel.size ? '' : 'disabled'}>Keine</button></div>
      ${pasteOpen ? `<label class="row" style="flex-direction:column;align-items:stretch">Zeilen hier einfügen, eine pro Zeitraum, z. B. „04.05.2027 – 29.05.2027 Hr. Novak“<textarea id="fPasteText" class="in" rows="5"></textarea></label>
        <div class="row"><button class="btn primary" type="button" id="fPasteGo">Vorschau</button><button class="btn" type="button" id="fPasteNo">Abbrechen</button></div>` : ''}`;
  }

  function previewBox() {
    const r = preview.rows;
    const body = r.map(x => `<tr><td>${fy(D(x.from))}</td><td>${fy(D(x.to))}</td><td>${diff(D(x.from), D(x.to))}</td><td>${esc(x.name)}</td><td>${esc(x.note)}</td><td>${esc([x.phone, x.mobile].filter(Boolean).join(' / '))}</td><td>${esc(x.email)}</td></tr>`).join('');
    const min = r.length ? r.reduce((a, x) => (x.from < a ? x.from : a), r[0].from) : null;
    const max = r.length ? r.reduce((a, x) => (x.to > a ? x.to : a), r[0].to) : null;
    return `<div class="sec" style="border-color:var(--accent)">
      <h3>Vorschau${preview.source ? `: ${esc(preview.source)}` : ''}</h3>
      <p class="d">${r.length} Belegungen erkannt${preview.skipped ? `, ${preview.skipped} Wochen ohne Belegung übersprungen` : ''}. Bitte kurz prüfen.</p>
      ${r.length ? `<div class="tbl"><table><thead><tr><th>Von</th><th>Bis</th><th>Nächte</th><th>Bewohner / Bezeichnung</th><th>Notiz</th><th>Telefon / Handy</th><th>E-Mail</th></tr></thead><tbody>${body}</tbody></table></div>
      <label class="row"><input type="checkbox" id="pvReplace" checked> Bestehende Einträge zwischen ${fy(D(min))} und ${fy(D(max))} durch den neuen Plan ersetzen</label>
      <div class="row"><button class="btn primary" type="button" id="pvGo">Übernehmen</button><button class="btn" type="button" id="pvNo">Abbrechen</button></div>`
      : `<div class="row"><button class="btn" type="button" id="pvNo">Schließen</button></div>`}
    </div>`;
  }

  async function act(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); }
    catch (e) { toast(e.message); }
    const y = window.scrollY;
    await renderSettings();
    window.scrollTo(0, y);
    load();
  }

  function bindSettings() {
    const put = (p, body) => api(p, { method: 'PUT', body });
    const post = (p, body) => api(p, { method: 'POST', body });
    $$('[data-nick]').forEach(i => i.onchange = () => act(() => put(`/api/admin/apartments/${i.dataset.nick}`, { nick: i.value }), 'Gespeichert.'));
    $$('[data-color]').forEach(b => b.onclick = () => { const [id, c] = b.dataset.color.split('|'); act(() => put(`/api/admin/apartments/${id}`, { color: c })); });
    $$('[data-source]').forEach(s => s.onchange = () => act(() => put(`/api/admin/apartments/${s.dataset.source}`, { source: s.value }), 'Quelle geändert.'));
    $$('[data-saveurl]').forEach(b => b.onclick = () => {
      const inp = $(`[data-url="${b.dataset.saveurl}"]`);
      if (!inp.value.trim()) return toast('Bitte zuerst einen Link einfügen.');
      act(() => put(`/api/admin/apartments/${b.dataset.saveurl}`, { icalUrl: inp.value.trim() }), 'Link gespeichert und abgerufen.');
    });
    $$('[data-move]').forEach(b => b.onclick = () => {
      const [i, d] = b.dataset.move.split('|').map(Number);
      const ids = cfg.apartments.map(a => a.id);
      [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
      act(() => put('/api/admin/apartments/order', { ids }));
    });
    $('#interval').onchange = e => act(() => put('/api/admin/settings', { intervalMinutes: +e.target.value }), 'Gespeichert.');
    $('#refreshNow').onclick = () => act(() => post('/api/admin/refresh'), 'Abgerufen.');
    if ($('#copyFeed')) {
      $('#copyFeed').onclick = async () => {
        const t = $('#feedUrl').textContent;
        try { await navigator.clipboard.writeText(t); toast('Link kopiert.'); }
        catch { const r = document.createRange(); r.selectNodeContents($('#feedUrl')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Link markiert, bitte mit Strg+C kopieren.'); }
      };
      $('#newFeed').onclick = () => act(() => post('/api/admin/feed-token'), 'Neuer Link erzeugt. Der alte gilt nicht mehr.');
    }

    // Belegungsplan
    $$('[data-fsel]').forEach(c => c.onchange = () => { c.checked ? firmSel.add(+c.dataset.fsel) : firmSel.delete(+c.dataset.fsel); act(async () => {}); });
    $$('[data-fset]').forEach(i => i.onchange = () => { const [id, k] = i.dataset.fset.split('|'); act(() => put(`/api/admin/firm/${id}`, { [k]: i.value })); });
    $$('[data-fdel]').forEach(b => b.onclick = () => { firmSel.delete(+b.dataset.fdel); act(() => api(`/api/admin/firm/${b.dataset.fdel}`, { method: 'DELETE' }), 'Zeile gelöscht.'); });
    $('#fAdd').onclick = () => {
      const last = cfg.firm[cfg.firm.length - 1];
      const from = last ? last.to : iso(TODAY);
      act(() => post('/api/admin/firm', { from, to: iso(add(D(from), 28)), name: 'Neuer Eintrag' }));
    };
    $('#fPaste').onclick = () => { pasteOpen = true; act(async () => {}); };
    $('#fAll').onclick = () => { cfg.firm.forEach(b => firmSel.add(b.id)); act(async () => {}); };
    $('#fNone').onclick = () => { firmSel.clear(); act(async () => {}); };
    $('#fShiftGo').onclick = () => { const days = +$('#fShift').value || 0; const ids = [...firmSel]; act(() => post('/api/admin/firm/bulk', { ids, action: 'shift', days }), `${ids.length} Einträge um ${days} Tage verschoben.`); };
    $('#fDelSel').onclick = () => {
      const ids = [...firmSel];
      const btn = $('#fDelSel');
      if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = `Wirklich ${ids.length} löschen?`; btn.classList.add('danger'); return; }
      firmSel.clear();
      act(() => post('/api/admin/firm/bulk', { ids, action: 'delete' }), `${ids.length} Einträge gelöscht.`);
    };
    if (pasteOpen) {
      $('#fPasteNo').onclick = () => { pasteOpen = false; act(async () => {}); };
      $('#fPasteGo').onclick = () => {
        const text = $('#fPasteText').value;
        pasteOpen = false;
        act(async () => { preview = { ...(await post('/api/admin/firm/parse', { text })), source: 'eingefügter Text' }; });
      };
    }
    $('#fPdf').onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      act(async () => {
        const res = await fetch('/api/admin/firm/pdf', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `Fehler ${res.status}`);
        preview = { ...j, source: file.name };
      });
    };
    if (preview) {
      $('#pvNo').onclick = () => { preview = null; act(async () => {}); };
      if ($('#pvGo')) $('#pvGo').onclick = () => {
        const body = { rows: preview.rows, replace: $('#pvReplace').checked };
        preview = null;
        let r = null;
        act(async () => { r = await post('/api/admin/firm/import', body); })
          .then(() => r && toast(`${r.added} Belegungen übernommen${r.removed ? `, ${r.removed} alte ersetzt` : ''}.`));
      };
    }

    // Saisons
    const toMd = v => { const m = String(v).trim().match(/^(\d{1,2})\.(\d{1,2})\.?$/); return m ? `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
    $$('[data-sea]').forEach(i => i.onchange = () => {
      const [id, k] = i.dataset.sea.split('|');
      let val = i.value;
      if (k === 'from' || k === 'to') { val = toMd(val); if (!val) return toast('Bitte als TT.MM. eingeben, z. B. 01.07.'); }
      act(() => put(`/api/admin/seasons/${id}`, { [k]: val }), 'Gespeichert.');
    });
    $$('[data-seadel]').forEach(b => b.onclick = () => act(() => api(`/api/admin/seasons/${b.dataset.seadel}`, { method: 'DELETE' }), 'Saison gelöscht.'));
    $('#seaAdd').onclick = () => act(() => post('/api/admin/seasons', { kind: 'neben', from: '11-01', to: '11-30' }), 'Saison angelegt, bitte Daten anpassen.');

    // Ferien
    $$('[data-holdel]').forEach(b => b.onclick = () => act(() => api(`/api/admin/holidays/${b.dataset.holdel}`, { method: 'DELETE' }), 'Gelöscht.'));
    $('#holAdd').onclick = () => {
      const start = $('#holFrom').value, end = $('#holTo').value, name = $('#holName').value.trim();
      if (!start || !end) return toast('Bitte Von und Bis wählen.');
      act(() => post('/api/admin/holidays', { start, end, name: name || 'Ferien' }), 'Hinzugefügt.');
    };
  }

  /* ---------- Ereignisse ---------- */

  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const k = nav.dataset.nav;
      if (k === 'today') { state.view = 'w4'; state.start = startOfWeek(TODAY); }
      else state.view = k;
      return render();
    }
    const bar = e.target.closest('[data-event]');
    if (bar) return openEvent(bar.dataset.event);
    const mon = e.target.closest('[data-month]');
    if (mon) { state.view = 'w4'; state.start = startOfWeek(new Date(state.year, +mon.dataset.month, 1)); return render(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(); });
  $('#prevBtn').onclick = () => step(-1);
  $('#nextBtn').onclick = () => step(1);
  $('#setBtn').onclick = () => { state.view = state.view === 'settings' ? 'w4' : 'settings'; render(); window.scrollTo(0, 0); };

  load();
  setInterval(load, 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
