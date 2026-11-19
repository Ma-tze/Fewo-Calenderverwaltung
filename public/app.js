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
  // Wechseltag ist Samstag: die 4-Wochen-Ansicht beginnt immer an einem Samstag
  const startOfSat = dt => add(dt, -((dt.getDay() + 1) % 7));
  const midnight = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const color = c => `var(--${/^p[1-8]$/.test(c) ? c : 'p1'})`;

  let TODAY = midnight();
  const state = { view: 'w4', start: startOfSat(TODAY), m3: new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), year: TODAY.getFullYear() };
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
    if (!['settings', 'guests', 'invoices', 'portals'].includes(state.view)) render(); else renderTop();
    if (MODE === 'admin') checkPortals();
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
    if (missing.length) msg = `Für ${missing.map(a => a.name).join(', ')} ist noch kein Kalender hinterlegt. ${MODE === 'admin' ? 'Bitte unter „Wohnungen & Abruf“ eintragen.' : 'Das wird am PC eingerichtet.'}`;
    else if (errors.length && MODE === 'admin') msg = `Abruf fehlgeschlagen: ${errors.map(a => `${a.name} (${a.error})`).join(', ')}. Angezeigt wird der letzte Stand.`;
    banner.hidden = !msg; banner.textContent = msg;

    $$('nav.dock [data-nav]').forEach(b => b.setAttribute('aria-current', b.dataset.nav === state.view ? 'true' : 'false'));
    $('#legend').innerHTML = data.apartments.map(a => `<span><i style="background:${color(a.color)}"></i>${esc(a.name)}${a.nick && a.nick !== a.name ? ` „${esc(a.nick)}“` : ''}</span>`).join('')
      + `<span><i style="background:var(--saturday);box-shadow:inset 3px 0 0 var(--sat-line)"></i>Samstag = Wechseltag</span><span><i style="background:var(--holiday)"></i>Schulferien BW</span><span><i style="background:var(--s-haupt)"></i>Hauptsaison</span><span><i style="background:var(--s-neben)"></i>Nebensaison</span>`;
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
    let h = `<div class="grid ${compact ? 'compact' : ''}" style="grid-template-columns:var(--label-w) repeat(${2 * n}, minmax(0, 1fr));grid-template-rows:auto auto ${compact ? '22px 14px' : '30px 18px'} repeat(${data.apartments.length}, ${rowH})">`;
    // Monatsleiste
    h += `<div class="mhd" style="grid-column:1;grid-row:1"></div><div class="hd" style="grid-column:1;grid-row:2"></div>`;
    for (let i = 0; i < n;) {
      const dt = add(start, i);
      const left = new Date(dt.getFullYear(), dt.getMonth() + 1, 1);
      const len = Math.min(n - i, diff(dt, left));
      h += `<div class="mhd ${dt.getMonth() % 2 ? 'odd' : ''} ${i > 0 ? 'mstart' : ''}" style="grid-column:${2 + 2 * i} / span ${2 * len};grid-row:1">${len >= (compact ? 4 : 2) ? `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}` : ''}</div>`;
      i += len;
    }
    for (let i = 0; i < n; i++) {
      const dt = add(start, i), we = dt.getDay() === 0 || dt.getDay() === 6, sa = dt.getDay() === 6, pub = pubDays.get(iso(dt));
      // 3-Monats-Ansicht: nur Montage beschriften (Monat steht in der Leiste darüber), sonst wird es zu eng
      const label = !compact || dt.getDay() === 6;
      const top = compact ? (label ? WD[dt.getDay()] : '&nbsp;') : WD[dt.getDay()];
      const ms = dt.getDate() === 1 && i > 0 ? 'mstart' : '';
      h += `<div class="hd ${we ? 'we' : ''} ${sa ? 'sa' : ''} ${pub ? 'pub' : ''} ${ms} ${same(dt, TODAY) ? 'today' : ''}" style="grid-column:${2 + 2 * i} / span 2;grid-row:2" ${pub ? `title="${esc(pub)}"` : ''}>${top}<b>${label ? dt.getDate() : '&nbsp;'}</b></div>`;
    }
    // Ferien- und Saisonband
    h += `<div class="rowlbl" style="grid-column:1;grid-row:3">Ferien BW</div><div class="rowlbl" style="grid-column:1;grid-row:4">Saison</div>`;
    for (let i = 1; i < n; i++) if (add(start, i).getDate() === 1) h += `<div class="mline" style="grid-column:${2 + 2 * i} / span 2;grid-row:3 / ${5 + data.apartments.length}"></div>`;
    data.holidays.filter(x => x.arr < end && x.dep > start).forEach(x => {
      const [c0, c1] = spanCols(x, start, n);
      h += `<div class="band ${x.kind === 'public' ? 'public' : 'school'}" style="grid-column:${c0} / ${c1};grid-row:3" title="${esc(x.name)}">${x.kind === 'public' ? '●' : esc(x.name)}</div>`;
    });
    data.seasons.filter(x => x.arr < end && x.dep > start).forEach(x => {
      const [c0, c1] = spanCols(x, start, n);
      h += `<div class="band ${x.kind}" style="grid-column:${c0} / ${c1};grid-row:4" title="${esc(x.name)}">${compact ? '' : esc(x.name)}</div>`;
    });
    data.apartments.forEach((a, r) => {
      const row = r + 5;
      h += `<div class="lbl" style="grid-column:1;grid-row:${row}"><span class="dot" style="background:${color(a.color)}"></span><span>${esc(a.name)}${a.nick && a.nick !== a.name ? `<small>${esc(a.nick)}</small>` : ''}</span></div>`;
      for (let i = 0; i < n; i++) {
        const dt = add(start, i), we = dt.getDay() === 0 || dt.getDay() === 6;
        h += `<div class="cell ${we ? 'we' : ''} ${dt.getDay() === 6 ? 'sa' : ''} ${same(dt, TODAY) ? 'today' : ''}" style="grid-column:${2 + 2 * i} / span 2;grid-row:${row}"></div>`;
      }
      data.events.filter(e => e.apt === a.id && e.arr < end && e.dep > start).forEach(e => {
        const si = diff(start, e.arr), ei = diff(start, e.dep);
        const c0 = si < 0 ? 2 : 3 + 2 * si, c1 = ei >= n ? 2 + 2 * n : 3 + 2 * ei;
        h += `<button type="button" class="bar" style="grid-column:${c0} / ${c1};grid-row:${row};background:${color(a.color)}" data-event="${esc(e.id)}">${e.visit > 1 ? '★ ' : ''}${esc(e.title || 'Belegt')}</button>`;
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
    const set = state.view === 'settings', gv = state.view === 'guests', iv = state.view === 'invoices', pv = state.view === 'portals';
    ['#toolbar', '#summary', '#legend', '#dock', '#arrows'].forEach(s => { $(s).hidden = set || gv || iv || pv; });
    if ($('#portBtn')) $('#portBtn').textContent = pv ? '◀ Zurück zum Kalender' : '🔎 Portal-Abgleich';
    if ($('#portalHint')) $('#portalHint').hidden = pv || !portalHintText;
    if ($('#invBtn')) $('#invBtn').textContent = iv ? '◀ Zurück zum Kalender' : '🧾 Rechnungen';
    $('#setBtn').textContent = set ? '◀ Zurück zum Kalender' : '⚙ Einstellungen';
    if ($('#guestBtn')) $('#guestBtn').textContent = gv ? '◀ Zurück zum Kalender' : '👥 Gäste';
    const v = $('#view');
    if (set) return renderSettings();
    if (gv) return renderGuests();
    if (iv) return renderInvoices();
    if (pv) return renderPortals();
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
        ${e.visit > 1 ? `<dt>Stammgast</dt><dd>★ ${e.visit}. Aufenthalt</dd>` : ''}
        ${e.note ? `<dt>Notiz</dt><dd>${esc(e.note)}</dd>` : ''}
        ${e.phone ? `<dt>Telefon</dt><dd><a href="tel:${esc(e.phone)}">${esc(e.phone)}</a></dd>` : ''}
        ${e.mobile ? `<dt>Handy</dt><dd><a href="tel:${esc(e.mobile)}">${esc(e.mobile)}</a></dd>` : ''}
        ${e.email ? `<dt>E-Mail</dt><dd>${e.email.split(', ').map(m => `<a href="mailto:${esc(m)}">${esc(m)}</a>`).join('<br>')}</dd>` : ''}
        <dt>Quelle</dt><dd>${own ? 'Belegungsplan der Firma' : `Smoobu${e.channel ? ` · ${esc(e.channel)}` : ''}`}</dd>
      </dl>
      <div class="notice">${own ? 'Wird am PC in den Einstellungen gepflegt.' : 'Änderungen bitte vorerst in Smoobu vornehmen.'}</div>
      <div class="row end">${MODE === 'admin' && e.guestId ? '<button class="btn" type="button" id="toGuest">Gast öffnen</button>' : ''}<button class="btn primary" type="button" id="closeB">Schließen</button></div>`);
    $('#closeB').onclick = closeOverlay;
    if ($('#toGuest')) $('#toGuest').onclick = () => { closeOverlay(); gst.id = e.guestId; state.view = 'guests'; render(); window.scrollTo(0, 0); };
  }

  /* ---------- Einstellungen (nur PC) ---------- */

  let cfg = null;
  const firmSel = new Set();
  let pasteOpen = false;
  let preview = null; // { rows, skipped, source }
  let smoobuApts = null, smoobuErr = '', seaYearSel = null;

  async function loadCfg() { cfg = await api('/api/admin/config'); }

  async function renderSettings() {
    const v = $('#view');
    if (MODE !== 'admin') { state.view = 'w4'; return render(); }
    try { await loadCfg(); } catch (e) { v.innerHTML = `<div class="notice warn">${esc(e.message)}</div>`; return; }
    smoobuErr = '';
    if (cfg.smoobu.configured && cfg.apartments.some(a => a.source === 'smoobu') && !smoobuApts) {
      try { smoobuApts = (await api('/api/admin/smoobu/apartments')).apartments; } catch (e) { smoobuErr = e.message; }
    }
    const sec = (id, title, desc, inner) => `<section class="sec" id="s-${id}"><h3>${title}</h3>${desc ? `<p class="d">${desc}</p>` : ''}${inner}</section>`;
    const when = t => t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';
    const n = cfg.apartments.length;

    const urlRow = (a, ph) => `<div class="row"><input class="in" data-url="${a.id}" placeholder="${a.hasUrl ? `hinterlegt (${esc(a.urlHost)}) – zum Ändern neuen Link einfügen` : ph}" autocomplete="off"><button class="mini" type="button" data-saveurl="${a.id}">Speichern</button></div>`;
    const aptRows = cfg.apartments.map((a, i) => {
      const st = cfg.status.find(s => s.id === a.id) || {};
      const bk = st.backup ? (st.backup.error ? `<br><span class="small">Ersatz iCal: Fehler (${esc(st.backup.error)})</span>` : `<br><span class="small">Ersatz iCal: ok, ${when(st.backup.fetchedAt)} · ${st.backup.count} Einträge</span>`) : (a.source === 'smoobu' && !a.hasUrl ? '<br><span class="small">kein Ersatz-iCal hinterlegt</span>' : '');
      const fb = st.fallback ? ` <span class="small">Kalender zeigt solange den iCal-Stand.</span>` : '';
      const status = a.source === 'smoobu' && !cfg.smoobu.configured ? `<span class="badge err">kein API-Zugang</span> <span class="small">SMOOBU_API_KEY/SECRET in .env eintragen</span>${fb}${bk}`
        : a.source === 'smoobu' && !a.smoobuId ? `<span class="badge err">Smoobu-Wohnung wählen</span>${fb}${bk}`
        : a.source === 'smoobu' && st.fallback ? `<span class="badge warn">Ersatz aktiv</span> <span class="small">API-Fehler: ${esc(st.error || 'noch kein Abruf')}, zeigt iCal-Stand ${when(st.fallbackAt)}</span>${bk}`
        : a.source === 'smoobu' ? (st.error ? `<span class="badge err">Fehler</span> <span class="small">${esc(st.error)}</span>` : `<span class="badge ok">ok</span> <span class="small">${when(st.fetchedAt)} · ${st.count ?? 0} Einträge</span>`) + bk
        : a.source === 'own' ? `<span class="badge ok">aktiv</span> <span class="small">${cfg.firm.length} Einträge</span>`
        : !a.hasUrl ? '<span class="badge off">kein Link</span>'
        : st.error ? `<span class="badge err" title="${esc(st.error)}">Fehler</span> <span class="small">${esc(st.error)}</span>`
        : `<span class="badge ok">ok</span> <span class="small">${when(st.fetchedAt)} · ${st.count ?? 0} Einträge</span>`;
      const link = a.source === 'smoobu'
        ? (cfg.smoobu.configured ? `<div class="row"><select class="in" data-smoobu="${a.id}" style="width:auto"><option value="">– Smoobu-Wohnung –</option>${(smoobuApts || []).map(x => `<option value="${x.id}" ${String(x.id) === String(a.smoobuId) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}${a.smoobuId && !(smoobuApts || []).some(x => String(x.id) === String(a.smoobuId)) ? `<option value="${esc(a.smoobuId)}" selected>ID ${esc(a.smoobuId)}</option>` : ''}</select>${smoobuErr ? `<span class="small">${esc(smoobuErr)}</span>` : ''}</div>` : '<span class="small">API-Zugang fehlt</span>') + urlRow(a, 'Ersatz: iCal-Link aus Smoobu einfügen')
        : a.source === 'own'
        ? `<span class="small">Eigener Kalender der App</span> <a class="mini" href="#s-firm" style="display:inline-flex;align-items:center;text-decoration:none;color:var(--fg)">Tabelle</a>`
        : urlRow(a, 'iCal-Link aus Smoobu einfügen');
      return `<tr>
        <td><b>${esc(a.name)}</b></td>
        <td><input class="in" data-nick="${a.id}" value="${esc(a.nick)}" aria-label="Name ${esc(a.name)}"></td>
        <td><div class="swatches">${cfg.colors.map(c => `<button type="button" class="sw" style="background:var(--${c})" data-color="${a.id}|${c}" aria-pressed="${a.color === c}" aria-label="Farbe ${c}"></button>`).join('')}</div></td>
        <td><select class="in" data-source="${a.id}"><option value="smoobu" ${a.source === 'smoobu' ? 'selected' : ''}>Smoobu-API</option><option value="ical" ${a.source === 'ical' ? 'selected' : ''}>iCal-Link (Smoobu)</option><option value="own" ${a.source === 'own' ? 'selected' : ''}>Eigener Kalender</option></select></td>
        <td style="min-width:280px">${link}</td>
        <td>${status}</td>
        <td style="white-space:nowrap"><button class="mini" type="button" data-move="${i}|-1" ${i === 0 ? 'disabled' : ''} aria-label="nach oben">▲</button> <button class="mini" type="button" data-move="${i}|1" ${i === n - 1 ? 'disabled' : ''} aria-label="nach unten">▼</button></td>
      </tr>`;
    }).join('');

    const feedUrl = cfg.feedUrl;

    const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const wd = s => (isDay(s) ? WD[D(s).getDay()] : '');
    const thisYear = new Date().getFullYear();
    const seaYears = new Set(cfg.seasons.map(s => +String(s.from).slice(0, 4)));
    if (!seaYearSel) seaYearSel = seaYears.has(thisYear + 1) ? thisYear + 2 : thisYear + 1;
    let lastYear = null;
    const seasonRows = cfg.seasons.map(s => {
      const yr = String(s.from).slice(0, 4);
      const head = yr !== lastYear ? `<tr class="grp"><td colspan="5"><b>${esc(yr)}</b></td></tr>` : '';
      lastYear = yr;
      const days = isDay(s.from) && isDay(s.to) ? Math.round((D(s.to) - D(s.from)) / 864e5) + 1 : '';
      return `${head}<tr>
      <td><select class="in" data-sea="${s.id}|kind"><option value="haupt" ${s.kind === 'haupt' ? 'selected' : ''}>Hauptsaison</option><option value="neben" ${s.kind === 'neben' ? 'selected' : ''}>Nebensaison</option></select></td>
      <td><input class="in" type="date" style="width:auto" data-sea="${s.id}|from" value="${esc(s.from)}"> <span class="small">${wd(s.from)}</span></td>
      <td><input class="in" type="date" style="width:auto" data-sea="${s.id}|to" value="${esc(s.to)}"> <span class="small">${wd(s.to)} · ${days} Tage</span></td>
      <td><input class="in" data-sea="${s.id}|label" value="${esc(s.label)}"></td>
      <td><button class="mini" type="button" data-seadel="${s.id}" aria-label="Saison löschen">✕</button></td></tr>`;
    }).join('');
    const yearOpts = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2, thisYear + 3].map(y => `<option value="${y}" ${y === seaYearSel ? 'selected' : ''}>${y}</option>`).join('');

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
        ${sec('saison', 'Haupt- und Nebensaison', 'Jedes Jahr mit eigenen Daten, weil die Wochentage jedes Jahr anders fallen. „Aus dem Vorjahr übernehmen“ kopiert die Saisons um 52 Wochen verschoben, also auf dieselben Wochentage. Danach bei Bedarf einzeln anpassen. Zeiten ohne Eintrag gelten als „keine Saison“.', `
          <div class="tbl"><table><thead><tr><th>Art</th><th>Von</th><th>Bis</th><th>Bezeichnung</th><th></th></tr></thead><tbody>${seasonRows || '<tr><td colspan="5" class="small">Noch keine Saisons eingetragen.</td></tr>'}</tbody></table></div>
          <div class="row">Jahr <select class="in" id="seaYear" style="width:auto">${yearOpts}</select>
            <button class="mini" type="button" id="seaAdd">+ Saison</button>
            <button class="mini" type="button" id="seaCopy">Aus dem Vorjahr übernehmen</button></div>`)}
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
    $$('[data-smoobu]').forEach(s => s.onchange = () => act(() => put(`/api/admin/apartments/${s.dataset.smoobu}`, { smoobuId: s.value }), 'Zugeordnet und abgerufen.'));
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
    $$('[data-sea]').forEach(i => i.onchange = () => {
      const [id, k] = i.dataset.sea.split('|');
      const val = i.value;
      if ((k === 'from' || k === 'to') && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return toast('Bitte ein vollständiges Datum eingeben.');
      act(() => put(`/api/admin/seasons/${id}`, { [k]: val }), 'Gespeichert.');
    });
    $('#seaYear').onchange = e => { seaYearSel = +e.target.value; };
    $('#seaCopy').onclick = () => act(() => post('/api/admin/seasons/copy', { fromYear: seaYearSel - 1, toYear: seaYearSel }), `Saisons aus ${seaYearSel - 1} für ${seaYearSel} übernommen. Bitte prüfen.`);
    $$('[data-seadel]').forEach(b => b.onclick = () => act(() => api(`/api/admin/seasons/${b.dataset.seadel}`, { method: 'DELETE' }), 'Saison gelöscht.'));
    $('#seaAdd').onclick = () => act(() => post('/api/admin/seasons', { kind: 'neben', from: `${seaYearSel}-04-01`, to: `${seaYearSel}-04-30` }), `Saison für ${seaYearSel} angelegt, bitte Daten anpassen.`);

    // Ferien
    $$('[data-holdel]').forEach(b => b.onclick = () => act(() => api(`/api/admin/holidays/${b.dataset.holdel}`, { method: 'DELETE' }), 'Gelöscht.'));
    $('#holAdd').onclick = () => {
      const start = $('#holFrom').value, end = $('#holTo').value, name = $('#holName').value.trim();
      if (!start || !end) return toast('Bitte Von und Bis wählen.');
      act(() => post('/api/admin/holidays', { start, end, name: name || 'Ferien' }), 'Hinzugefügt.');
    };
  }

  /* ---------- Gästedatenbank (nur PC) ---------- */

  const gst = { q: '', filter: 'alle', id: null, list: null, detail: null, importYear: new Date().getFullYear() - 3 };
  const euro = n => (n == null || n === '' ? '–' : `${Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  const dmy = s => (s ? fy(D(s)) : '–');

  async function renderGuests(refetch = true) {
    const v = $('#view');
    if (MODE !== 'admin') { state.view = 'w4'; return render(); }
    if (refetch || !gst.list) try {
      gst.list = await api('/api/admin/guests');
      gst.detail = gst.id ? await api(`/api/admin/guests/${gst.id}`) : null;
    } catch (e) { gst.id = null; v.innerHTML = `<div class="notice warn">${esc(e.message)}</div>`; return; }
    v.innerHTML = gst.detail ? guestDetail() : guestOverview();
    bindGuests();
  }

  const aptLabel = id => { const a = gst.list.apartments.find(x => x.id === id); return a ? esc(a.name) : '–'; };

  function guestOverview() {
    const L = gst.list;
    const q = gst.q.trim().toLowerCase();
    let rows = L.guests.filter(g => !q || [g.name, g.email, g.phone, g.notes, ...(g.emails || [])].join(' ').toLowerCase().includes(q));
    if (gst.filter === 'stamm') rows = rows.filter(g => g.visits >= 2);
    if (gst.filter === 'kommend') rows = rows.filter(g => g.nextStay).sort((a, b) => (a.nextStay.start < b.nextStay.start ? -1 : 1));
    if (gst.filter === 'doppelt') rows = rows.filter(g => g.possibleDuplicate).sort((a, b) => a.name.localeCompare(b.name));
    const stamm = L.guests.filter(g => g.visits >= 2).length;
    const body = rows.map(g => `<tr class="click" data-guest="${g.id}">
      <td><b>${esc(g.name)}</b>${g.visits >= 2 ? ` <span class="badge ok" title="Stammgast">★ ${g.visits}×</span>` : ''}${g.possibleDuplicate ? ' <span class="badge warn" title="Gleicher Name wie ein anderer Gast">doppelt?</span>' : ''}</td>
      <td class="small">${esc([g.email, g.phone].filter(Boolean).join(' · '))}</td>
      <td>${g.visits}</td><td>${g.nights}</td>
      <td>${g.lastStay ? `${dmy(g.lastStay.start)} <span class="small">${aptLabel(g.lastStay.aptId)} · ${euro(g.lastStay.price)}</span>` : '–'}</td>
      <td>${g.nextStay ? `${dmy(g.nextStay.start)} <span class="small">${aptLabel(g.nextStay.aptId)}</span>` : '–'}</td>
      <td style="text-align:right">${g.revenue ? euro(g.revenue) : '–'}</td>
      <td>${g.ads === 'ja' ? 'ja' : g.ads === 'nein' ? 'nein' : '<span class="small">?</span>'}</td></tr>`).join('');
    const years = []; for (let y = new Date().getFullYear(); y >= 2015; y--) years.push(y);
    return `<div class="sbody">
      <section class="sec"><h3>Gäste</h3>
        <p class="d">${L.guests.length} Gäste, davon ${stamm} Stammgäste. Gäste aus Smoobu kommen bei jedem Abruf automatisch dazu und bleiben hier gespeichert, auch wenn ihr den Anbieter wechselt.</p>
        <div class="row"><input class="in" id="gQ" placeholder="Suchen: Name, E-Mail, Telefon, Notiz" value="${esc(gst.q)}" style="max-width:340px">
          <select class="in" id="gFilter" style="width:auto">${[['alle', 'Alle'], ['stamm', 'Stammgäste (2× und öfter)'], ['kommend', 'Mit kommender Buchung'], ['doppelt', 'Mögliche Doppelte']].map(([k, t]) => `<option value="${k}" ${gst.filter === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <button class="mini" type="button" id="gNew">+ Gast</button>
          <a class="mini" href="/export/gaeste.csv" style="display:inline-flex;align-items:center;text-decoration:none;color:var(--fg)">Export für Excel (CSV)</a></div>
        <div class="tbl"><table><thead><tr><th>Name</th><th>Kontakt</th><th>Besuche</th><th>Nächte</th><th>Letzter Aufenthalt</th><th>Nächster</th><th style="text-align:right">Umsatz</th><th>Werbung</th></tr></thead>
        <tbody>${body || `<tr><td colspan="8" class="small">${L.guests.length ? 'Keine Treffer.' : 'Noch keine Gäste. Sobald die Smoobu-API eingerichtet ist, kommen sie automatisch. Ältere Buchungen unten übernehmen, oder mit „+ Gast“ von Hand anlegen.'}</td></tr>`}</tbody></table></div>
      </section>
      <section class="sec"><h3>Ältere Buchungen aus Smoobu übernehmen</h3>
        <p class="d">Der laufende Abruf holt nur das letzte und die kommenden Jahre. Hier kannst du einmalig alle älteren Buchungen mit Preisen in die Gästedatenbank holen. Doppelte entstehen dabei nicht.</p>
        <div class="row">${L.smoobu ? `Ab <select class="in" id="gImpYear" style="width:auto">${years.map(y => `<option ${y === gst.importYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
          <button class="mini" type="button" id="gImport">Aus Smoobu übernehmen</button>` : '<span class="badge off">kein Smoobu-API-Zugang</span> <span class="small">Erst SMOOBU_API_KEY und SMOOBU_API_SECRET in .env eintragen.</span>'}</div>
      </section>
      <section class="sec"><h3>Datenschutz</h3>
        <p class="d">Vorschlag: Gäste löschen, deren letzter Aufenthalt mehr als ${L.retentionYears} Jahre zurückliegt (Löschfrist laut Verarbeitungsverzeichnis). Rechnungen bewahrst du davon unabhängig 8 Jahre in der Buchhaltung auf. Werbe-E-Mails nur an Gäste mit „Werbung: ja“.</p>
        <div class="row">${L.expired ? `<button class="mini" type="button" id="gCleanup">${L.expired} Gäste mit Aufenthalt vor mehr als ${L.retentionYears} Jahren löschen</button>` : '<span class="small">Derzeit keine Gäste über der Löschfrist.</span>'}</div>
      </section></div>`;
  }

  function invCell(st) {
    const list = (gst.detail.invoices || []).filter(i => i.stayId === st.id);
    const links = list.map(i => `<button class="mini" type="button" data-openinv="${i.id}">${esc(i.number || 'Entwurf')}${i.kind === 'storno' ? ' Storno' : ''}</button>`).join(' ');
    const active = list.some(i => i.kind === 'rechnung' && !i.cancelledBy);
    return `${links}${active ? '' : ` <button class="mini" type="button" data-newinv="${st.id}">+ Rechnung</button>`}`;
  }

  function guestDetail() {
    const { guest: g, stays } = gst.detail;
    const apts = gst.list.apartments.filter(a => a.source !== 'own');
    const aptSel = (st, sel) => `<select class="in" ${st} style="width:auto"><option value="">–</option>${gst.list.apartments.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
    const ok = stays.filter(s => s.status !== 'storniert');
    const sum = ok.reduce((n, s) => n + (s.price || 0), 0);
    const nightsAll = ok.reduce((n, s) => n + diff(D(s.start), D(s.end)), 0);
    const body = stays.map(s => {
      const n = diff(D(s.start), D(s.end));
      return `<tr class="${s.status === 'storniert' ? 'muted' : ''}">
        <td><input class="in" type="date" data-st="${s.id}|start" value="${s.start}" style="width:auto"></td>
        <td><input class="in" type="date" data-st="${s.id}|end" value="${s.end}" style="width:auto"></td>
        <td>${n}</td>
        <td>${aptSel(`data-st="${s.id}|aptId"`, s.aptId)}</td>
        <td style="white-space:nowrap"><input class="in short" data-st="${s.id}|adults" type="number" min="0" value="${s.adults}" title="Erwachsene" style="width:56px"> + <input class="in short" data-st="${s.id}|children" type="number" min="0" value="${s.children}" title="Kinder" style="width:56px"></td>
        <td><input class="in short" data-st="${s.id}|price" value="${s.price == null ? '' : String(s.price).replace('.', ',')}" placeholder="€" style="width:100px"></td>
        <td class="small">${s.price != null && n ? euro(s.price / n) : '–'}</td>
        <td><input class="in" data-st="${s.id}|channel" value="${esc(s.channel)}" style="width:150px"></td>
        <td><select class="in" data-st="${s.id}|status" style="width:auto"><option value="ok">gebucht</option><option value="storniert" ${s.status === 'storniert' ? 'selected' : ''}>storniert</option></select></td>
        <td><input class="in" data-st="${s.id}|note" value="${esc(s.note || '')}"></td>
        <td class="small">${s.source === 'smoobu' ? `Smoobu${s.priceManual ? ', Preis geändert' : ''}` : 'von Hand'}</td>
        <td style="white-space:nowrap">${invCell(s)}</td>
        <td><button class="mini" type="button" data-stdel="${s.id}" aria-label="Aufenthalt löschen">✕</button></td></tr>`;
    }).join('');
    const others = gst.list.guests.filter(x => x.id !== g.id).sort((a, b) => a.name.localeCompare(b.name));
    const sameName = others.filter(x => x.possibleDuplicate && x.name.toLowerCase().split(/\s+/).some(w => w.length > 2 && g.name.toLowerCase().includes(w)));
    return `<div class="sbody">
      <div class="row"><button class="btn" type="button" id="gBack">◀ Alle Gäste</button></div>
      <section class="sec"><h3>${esc(g.name)} ${ok.length >= 2 ? `<span class="badge ok">★ Stammgast, ${ok.length} Aufenthalte</span>` : ''}</h3>
        <p class="d">${ok.length} Aufenthalt${ok.length === 1 ? '' : 'e'}, ${nightsAll} Nächte, zusammen ${euro(sum)}. Angelegt am ${new Date(g.createdAt).toLocaleDateString('de-DE')}.</p>
        <div class="gform">
          <label>Name<input class="in" data-g="name" value="${esc(g.name)}"></label>
          <label>E-Mail<input class="in" data-g="email" value="${esc(g.email)}"></label>
          <label>Telefon<input class="in" data-g="phone" value="${esc(g.phone)}"></label>
          <label>Werbung erlaubt<select class="in" data-g="ads"><option value="">nicht gefragt</option><option value="ja" ${g.ads === 'ja' ? 'selected' : ''}>ja</option><option value="nein" ${g.ads === 'nein' ? 'selected' : ''}>nein (widersprochen)</option></select></label>
          <label class="wide">Adresse<input class="in" data-g="address" value="${esc(g.address)}"></label>
          <label class="wide">Notizen (z. B. „kommt mit Hund“, „mag Fewo 3“)<textarea class="in" data-g="notes" rows="3">${esc(g.notes)}</textarea></label>
        </div>
        ${(g.emails || []).length ? `<p class="small">Weitere E-Mail-Adressen: ${(g.emails || []).map(esc).join(', ')}</p>` : ''}
      </section>
      <section class="sec"><h3>Aufenthalte und Preise</h3>
        <p class="d">Preise sind Gesamtpreise der Buchung. Änderst du einen Preis aus Smoobu von Hand, bleibt deine Angabe beim nächsten Abruf erhalten.</p>
        <div class="tbl"><table><thead><tr><th>Anreise</th><th>Abreise</th><th>Nächte</th><th>Wohnung</th><th>Erw. + Kinder</th><th>Preis gesamt</th><th>pro Nacht</th><th>Kanal</th><th>Status</th><th>Notiz</th><th>Quelle</th><th>Rechnung</th><th></th></tr></thead>
        <tbody>${body || '<tr><td colspan="13" class="small">Noch keine Aufenthalte.</td></tr>'}</tbody></table></div>
        <div class="row"><b>Neuer Aufenthalt:</b> <input class="in" type="date" id="nsStart" style="width:auto"> bis <input class="in" type="date" id="nsEnd" style="width:auto">
          ${aptSel('id="nsApt"', apts[0]?.id)} <input class="in" id="nsPrice" placeholder="Preis €" style="width:100px"> <input class="in" id="nsChannel" placeholder="Kanal, z. B. Direkt" style="width:170px">
          <button class="mini" type="button" id="nsAdd">Hinzufügen</button></div>
      </section>
      <section class="sec"><h3>Doppelten Eintrag zusammenführen</h3>
        <p class="d">Ist derselbe Gast zweimal angelegt (z. B. andere E-Mail bei Booking.com), hier den anderen Eintrag wählen. Seine Aufenthalte und fehlenden Angaben kommen zu diesem Gast, der andere Eintrag verschwindet.</p>
        <div class="row"><select class="in" id="gMergeSel" style="width:auto;max-width:420px"><option value="">– anderen Gast wählen –</option>
          ${sameName.length ? `<optgroup label="Ähnlicher Name">${sameName.map(x => `<option value="${x.id}">${esc(x.name)} (${x.visits}×, ${esc(x.email || x.phone || 'ohne Kontakt')})</option>`).join('')}</optgroup>` : ''}
          <optgroup label="Alle">${others.map(x => `<option value="${x.id}">${esc(x.name)} (${x.visits}×${x.lastStay ? `, zuletzt ${dmy(x.lastStay.start)}` : ''})</option>`).join('')}</optgroup></select>
          <button class="mini" type="button" id="gMerge">Zusammenführen</button></div>
      </section>
      <section class="sec"><h3>Gast löschen</h3>
        <p class="d">Löscht den Gast mit allen Aufenthalten aus dieser Datenbank, z. B. auf Wunsch des Gastes (DSGVO). In Smoobu bleibt die Buchung bestehen und käme beim nächsten Abruf wieder, solange sie im Abrufzeitraum liegt.</p>
        <div class="row"><button class="mini" type="button" id="gDel">Gast löschen</button></div>
      </section></div>`;
  }

  async function gAct(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); }
    catch (e) { toast(e.message); }
    const y = window.scrollY;
    await renderGuests();
    window.scrollTo(0, y);
  }

  function bindGuests() {
    const put = (p, body) => api(p, { method: 'PUT', body });
    const post = (p, body) => api(p, { method: 'POST', body });
    $$('[data-guest]').forEach(r => r.onclick = () => { gst.id = +r.dataset.guest; window.scrollTo(0, 0); renderGuests(); });
    if (!gst.detail) {
      const q = $('#gQ');
      q.oninput = () => { gst.q = q.value; const pos = q.selectionStart; renderGuests(false).then(() => { const n = $('#gQ'); n.focus(); n.setSelectionRange(pos, pos); }); };
      $('#gFilter').onchange = e => { gst.filter = e.target.value; renderGuests(false); };
      $('#gNew').onclick = () => gAct(async () => { const g = await post('/api/admin/guests', { name: 'Neuer Gast' }); gst.id = g.id; }, 'Gast angelegt. Bitte Namen eintragen.');
      if ($('#gImport')) {
        $('#gImpYear').onchange = e => { gst.importYear = +e.target.value; };
        $('#gImport').onclick = () => { const b = $('#gImport'); b.disabled = true; b.textContent = 'Wird übernommen …';
          let r = null; gAct(async () => { r = await post('/api/admin/guests/import', { fromYear: gst.importYear }); })
            .then(() => r && toast(`${r.bookings} Buchungen gelesen: ${r.newGuests} neue Gäste, ${r.newStays} neue Aufenthalte.`)); };
      }
      if ($('#gCleanup')) $('#gCleanup').onclick = () => {
        const b = $('#gCleanup');
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Wirklich endgültig löschen?'; b.classList.add('danger'); return; }
        let r = null; gAct(async () => { r = await post('/api/admin/guests/cleanup'); }).then(() => r && toast(`${r.deleted} Gäste gelöscht.`));
      };
      return;
    }
    const gid = gst.detail.guest.id;
    $('#gBack').onclick = () => { gst.id = null; renderGuests(); };
    $$('[data-g]').forEach(i => i.onchange = () => gAct(() => put(`/api/admin/guests/${gid}`, { [i.dataset.g]: i.value }), 'Gespeichert.'));
    $$('[data-st]').forEach(i => i.onchange = () => { const [id, k] = i.dataset.st.split('|'); gAct(() => put(`/api/admin/stays/${id}`, { [k]: i.value }), 'Gespeichert.'); });
    $$('[data-stdel]').forEach(b => b.onclick = () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Löschen?'; b.classList.add('danger'); return; }
      gAct(() => api(`/api/admin/stays/${b.dataset.stdel}`, { method: 'DELETE' }), 'Aufenthalt gelöscht.');
    });
    $$('[data-openinv]').forEach(b => b.onclick = () => openInvoice(+b.dataset.openinv));
    $$('[data-newinv]').forEach(b => b.onclick = async () => {
      try { const r = await post('/api/admin/invoices', { stayId: +b.dataset.newinv }); openInvoice(r.id); } catch (e) { toast(e.message); }
    });
    $('#nsAdd').onclick = () => {
      const body = { start: $('#nsStart').value, end: $('#nsEnd').value, aptId: $('#nsApt').value, price: $('#nsPrice').value, channel: $('#nsChannel').value.trim() || 'Direkt' };
      if (!body.start || !body.end) return toast('Bitte Anreise und Abreise wählen.');
      gAct(() => post(`/api/admin/guests/${gid}/stays`, body), 'Aufenthalt hinzugefügt.');
    };
    $('#gMerge').onclick = () => {
      const other = +$('#gMergeSel').value;
      if (!other) return toast('Bitte den anderen Gast wählen.');
      const b = $('#gMerge');
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Wirklich zusammenführen?'; b.classList.add('danger'); return; }
      gAct(() => post('/api/admin/guests/merge', { keepId: gid, dropId: other }), 'Zusammengeführt.');
    };
    $('#gDel').onclick = () => {
      const b = $('#gDel');
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Wirklich mit allen Aufenthalten löschen?'; b.classList.add('danger'); return; }
      gAct(async () => { await api(`/api/admin/guests/${gid}`, { method: 'DELETE' }); gst.id = null; }, 'Gast gelöscht.');
    };
  }

  /* ---------- Rechnungen (nur PC) ---------- */

  const ivs = { page: 'list', id: null, year: new Date().getFullYear(), q: Math.floor(new Date().getMonth() / 3) + 1, list: null, cur: null, set: null };
  const num2 = v => (v == null || v === '' ? '' : String(v).replace('.', ','));
  const vatSel = (attr, v) => `<select class="in" ${attr} style="width:auto">${[[7, '7 %'], [19, '19 %'], [0, '0 % (Kurtaxe)']].map(([k, t]) => `<option value="${k}" ${+v === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;

  async function renderInvoices() {
    const v = $('#view');
    if (MODE !== 'admin') { state.view = 'w4'; return render(); }
    try {
      if (ivs.page === 'list') ivs.list = await api('/api/admin/invoices');
      if (ivs.page === 'edit') ivs.cur = await api(`/api/admin/invoices/${ivs.id}`);
      if (ivs.page === 'settings') { const j = await api('/api/admin/invoice-settings'); ivs.set = j.settings; ivs.ph = j.placeholders || {}; }
    } catch (e) { ivs.page = 'list'; v.innerHTML = `<div class="notice warn">${esc(e.message)}</div>`; return; }
    v.innerHTML = ivs.page === 'edit' ? invEditor() : ivs.page === 'settings' ? invSettings() : invList();
    bindInvoices();
  }

  function invList() {
    const L = ivs.list;
    const yrs = []; for (let y = new Date().getFullYear() + 1; y >= new Date().getFullYear() - 6; y--) yrs.push(y);
    const rows = L.invoices.map(i => `<tr class="click" data-inv="${i.id}">
      <td><b>${esc(i.number || 'Entwurf')}</b>${i.kind === 'storno' ? ' <span class="badge warn">Storno</span>' : ''}${i.cancelledBy ? ' <span class="badge off">storniert</span>' : ''}${i.eInvoice ? ' <span class="badge ok" title="E-Rechnung">E</span>' : ''}${i.test ? ' <span class="badge warn">Test</span>' : ''}</td>
      <td>${i.date ? dmy(i.date) : '<span class="small">noch nicht festgeschrieben</span>'}</td>
      <td>${esc(i.buyer)}</td><td class="small">${dmy(i.from)} – ${dmy(i.to)}${i.aptName ? ` · ${esc(i.aptName)}` : ''}</td>
      <td style="text-align:right">${euro(i.gross)}</td>
      <td>${i.status === 'entwurf' ? '<span class="badge off">Entwurf</span>' : i.cancelledBy ? '<span class="badge off">storniert</span>' : i.paidAt ? `<span class="badge ok">${i.kind === 'storno' ? 'erstattet' : 'bezahlt'} ${dmy(i.paidAt)}</span>` : `<span class="badge err">offen ${euro(i.open)}</span>`}</td></tr>`).join('');
    return `<div class="sbody">
      ${L.testMode ? `<div class="notice warn"><b>Testbetrieb:</b> Festgeschriebene Rechnungen bekommen TEST-Nummern und den Aufdruck „Testrechnung“. Der echte Nummernkreis bleibt unberührt, nichts wird verschickt.${L.testCount ? ` <button class="mini" type="button" id="ivTestDel">${L.testCount} Testrechnung${L.testCount > 1 ? 'en' : ''} löschen</button>` : ''}</div>`
        : L.testCount ? `<div class="notice">Aus dem Testbetrieb sind noch ${L.testCount} Testrechnung${L.testCount > 1 ? 'en' : ''} vorhanden. Sie zählen nicht im USt-Bericht. <button class="mini" type="button" id="ivTestDel">Testrechnungen löschen</button></div>` : ''}
      ${L.sellerReady ? '' : '<div class="notice warn">Bitte zuerst unter „Vermieterdaten und Preise“ Name, Anschrift und Steuernummer eintragen.</div>'}
      <section class="sec"><h3>Rechnungen</h3>
        <p class="d">Eine neue Rechnung legst du beim Gast an: Gäste → Gast öffnen → beim Aufenthalt „Rechnung“. Festgeschriebene Rechnungen sind nicht mehr änderbar, Korrekturen laufen über „Rechnung korrigieren“.</p>
        <div class="row"><button class="mini" type="button" id="ivSet">Vermieterdaten und Preise</button><button class="mini" type="button" id="ivToGuests">Zu den Gästen</button></div>
        <div class="tbl"><table><thead><tr><th>Nummer</th><th>Datum</th><th>Gast</th><th>Zeitraum</th><th style="text-align:right">Betrag</th><th>Status</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="small">Noch keine Rechnungen.</td></tr>'}</tbody></table></div>
      </section>
      <section class="sec"><h3>Umsatzsteuer-Bericht</h3>
        <p class="d">${L.taxation === 'ist' ? 'Ist-Versteuerung: gezählt wird, was im Zeitraum bezahlt wurde. Bitte Zahlungseingänge in den Rechnungen eintragen.' : 'Soll-Versteuerung: gezählt wird nach Abreisedatum.'} Enthält die Kennzahlen 86 und 81 für die Voranmeldung, alle Rechnungen und zur Information die Aufenthalte über Airbnb/Booking ohne App-Rechnung.</p>
        <div class="row">Jahr <select class="in" id="ivY" style="width:auto">${yrs.map(y => `<option ${y === ivs.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
          Quartal <select class="in" id="ivQ" style="width:auto">${[1, 2, 3, 4].map(q => `<option value="${q}" ${q === ivs.q ? 'selected' : ''}>${q}. Quartal</option>`).join('')}</select>
          <button class="mini" type="button" data-rep="quartal|pdf">Quartalsbericht (PDF)</button><button class="mini" type="button" data-rep="quartal|csv">Quartal als Excel (CSV)</button>
          <button class="mini" type="button" data-rep="jahr|pdf">Jahresbericht (PDF)</button><button class="mini" type="button" data-rep="jahr|csv">Jahr als Excel (CSV)</button></div>
      </section></div>`;
  }

  function invSettings() {
    const S = ivs.set, sl = S.seller, P = S.pricing;
    const f = (k, label, attr = 'data-sl', val = sl[k], wide = false, ph = '') => `<label${wide ? ' class="wide"' : ''}>${label}<input class="in" ${attr}="${k}" value="${esc(val ?? '')}" placeholder="${esc(ph)}"></label>`;
    const yr = new Date().getFullYear();
    const kt = S.kurtaxe.groups.map((g, i) => `<tr>
      <td><input class="in" data-kt="${i}|label" value="${esc(g.label)}"></td>
      <td><input class="in short" data-kt="${i}|ageFrom" value="${g.ageFrom}" style="width:64px"> bis <input class="in short" data-kt="${i}|ageTo" value="${g.ageTo}" style="width:64px"></td>
      <td><input class="in short" data-kt="${i}|rate" value="${num2(g.rate)}"></td>
      <td><input class="in short" data-kt="${i}|rateNeben" value="${num2(g.rateNeben)}" placeholder="wie Haupts."></td>
      <td><button class="mini" type="button" data-ktdel="${i}" aria-label="Zeile löschen">✕</button></td></tr>`).join('');
    return `<div class="sbody">
      <div class="row"><button class="btn" type="button" id="ivBack">◀ Rechnungen</button></div>
      <section class="sec"><h3>Vermieterin (steht auf jeder Rechnung)</h3>
        <p class="d">Änderungen gelten für neue Rechnungen. Festgeschriebene Rechnungen behalten die Angaben von damals.</p>
        <div class="gform">${f('name', 'Name')}${f('street', 'Straße und Hausnummer')}${f('zip', 'PLZ')}${f('city', 'Ort')}
          ${f('phone', 'Telefon')}${f('mobile', 'Mobil (für den Mietvertrag)')}${f('email', 'E-Mail')}${f('taxNumber', 'Steuernummer', 'data-sl', sl.taxNumber, false, 'z. B. 61/123/45678')}${f('vatId', 'USt-IdNr. (falls vorhanden)', 'data-sl', sl.vatId, false, 'DE…')}
          ${f('bank', 'Bank')}${f('iban', 'IBAN')}${f('bic', 'BIC')}${f('accountHolder', 'Kontoinhaber')}</div>
      </section>
      <section class="sec"><h3>Logo auf der Rechnung</h3>
        <div class="row" style="align-items:center;gap:20px">
          ${S.logo.file ? `<img src="/api/admin/invoice-logo?v=${encodeURIComponent(S.logo.file)}" alt="Logo" style="max-width:220px;max-height:130px;border:1px solid #ccd3cf;border-radius:8px;padding:6px;background:#fff">` : '<span class="small">Noch kein Logo hinterlegt.</span>'}
          <div style="display:flex;flex-direction:column;gap:10px">
            ${S.logo.file ? `<label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="logoOn" ${S.logo.enabled ? 'checked' : ''}> Logo auf Rechnungen anzeigen</label>` : ''}
            <label class="mini" style="cursor:pointer;align-self:flex-start">${S.logo.file ? 'Andere Datei wählen …' : 'Logo-Datei wählen …'}<input type="file" id="logoFile" accept="image/png,image/jpeg" style="display:none"></label>
            <span class="small">PNG oder JPG, bis 4 MB. Steht oben links auf jeder neuen Rechnung. Festgeschriebene Rechnungen behalten ihr damaliges Aussehen.</span>
          </div></div>
      </section>
      <section class="sec"><h3>Rechnungsnummern und Steuer</h3>
        <div class="gform">
          <label>Präfix<input class="in" data-iv="numberPrefix" value="${esc(S.numberPrefix)}"></label>
          <label>Nächste Nummer ${yr}<input class="in" id="ivNext" value="${(S.counters[yr] || 0) + 1}"></label>
          <label>Zahlungsziel (Tage)<input class="in" data-iv="paymentDays" value="${S.paymentDays}"></label>
          <label>Umsatzsteuer auf Übernachtung<select class="in" data-iv="vatRate">${[7, 19, 0].map(r => `<option value="${r}" ${S.vatRate === r ? 'selected' : ''}>${r} %</option>`).join('')}</select></label>
          <label>Versteuerung<select class="in" data-iv="taxation"><option value="ist" ${S.taxation === 'ist' ? 'selected' : ''}>Ist (nach Zahlungseingang)</option><option value="soll" ${S.taxation === 'soll' ? 'selected' : ''}>Soll (nach Leistung)</option></select></label>
          <label class="wide">Fußzeile (optional)<input class="in" data-iv="footer" value="${esc(S.footer)}"></label></div>
        <p class="small">Beispiel: ${esc(S.numberPrefix ? S.numberPrefix + '-' : '')}${yr}-${String((S.counters[yr] || 0) + 1).padStart(3, '0')}. Hast du dieses Jahr schon Rechnungen auf Papier geschrieben, trag bei „Nächste Nummer“ die folgende Nummer ein. Ist-/Soll-Versteuerung bitte wie beim Finanzamt angemeldet wählen.</p>
      </section>
      <section class="sec"><h3>Zahlungsbedingungen</h3>
        <div class="gform">
          <label>Anzahlung in % (0 = keine Anzahlung)<input class="in" data-pay="depositPercent" value="${S.payment.depositPercent}"></label>
          <label>Anzahlung fällig innerhalb von (Tagen nach Rechnung)<input class="in" data-pay="depositDays" value="${S.payment.depositDays}"></label>
          <label>Anzahlung nur, wenn die Anreise mehr als … Tage entfernt ist<input class="in" data-pay="depositIfDaysAhead" value="${S.payment.depositIfDaysAhead}"></label>
          <label>Restzahlung fällig … Tage vor Anreise<input class="in" data-pay="restDaysBeforeArrival" value="${S.payment.restDaysBeforeArrival}"></label></div>
        <p class="small">${S.payment.depositPercent > 0 ? `Beispiel: Rechnung heute, Anreise in ${S.payment.depositIfDaysAhead + 30} Tagen: ${S.payment.depositPercent} % Anzahlung in ${S.payment.depositDays} Tagen, Rest ${S.payment.restDaysBeforeArrival} Tage vor Anreise. Bei Anreise in ${S.payment.depositIfDaysAhead} Tagen oder weniger ist der ganze Betrag innerhalb des Zahlungsziels fällig, spätestens am Anreisetag.` : 'Ohne Anzahlung ist der ganze Betrag innerhalb des Zahlungsziels fällig, spätestens am Anreisetag.'} Auf der Rechnung steht für jede Zahlung ein QR-Code (GiroCode) für die Banking-App.</p>
      </section>
      <section class="sec"><h3>Preisbausteine (Bruttopreise)</h3>
        <div class="gform">
          <label>Im Grundpreis enthaltene Personen<input class="in" data-pr="includedPersons" value="${P.includedPersons}"></label>
          <label>Mehrbelegung Erwachsene je Person und Nacht (€)<input class="in" data-pr="extraAdult" value="${num2(P.extraAdult)}"></label>
          <label>Mehrbelegung Kinder je Kind und Nacht (€)<input class="in" data-pr="extraChild" value="${num2(P.extraChild)}"></label>
          <label>Kinderpreis gilt bis einschließlich (Jahre)<input class="in" data-pr="childMaxAge" value="${P.childMaxAge}"></label>
          <label>Kleinkinder frei bis einschließlich (Jahre)<input class="in" data-pr="infantMaxAge" value="${P.infantMaxAge}"></label>
          <label>Endreinigung (€, 0 = keine)<input class="in" data-pr="cleaning" value="${num2(P.cleaning)}"></label></div>
        <p class="small">Die im Grundpreis enthaltenen Plätze werden zuerst mit Erwachsenen belegt. Alle weiteren Personen kosten den Mehrbelegungspreis.</p>
      </section>
      <section class="sec"><h3>Kurtaxe (ohne Umsatzsteuer)</h3>
        <p class="d">Sätze je Person und Aufenthaltstag nach Alter (gezählt wird je Nacht, An- und Abreisetag zusammen als ein Tag). Vorbelegt nach der Kurtaxesatzung Immenstaad ab 01.01.2026: ab 15 Jahre 3,50 € (01.04. bis 31.10.) und 2,20 € (übrige Zeit), Kinder bis 14 Jahre frei. Geschäftsreisende befreist du mit dem Haken „Geschäftsreise“ in der Rechnung.</p>
        <div class="row"><label>Bezeichnung auf der Rechnung <input class="in" id="ktLabel" value="${esc(S.kurtaxe.label)}" style="width:200px"></label>
          <label>Hauptsaison vom <input class="in short" data-ktm="mainFrom" value="${mdDe(S.kurtaxe.mainFrom)}" placeholder="TT.MM." style="width:80px"></label>
          <label>bis <input class="in short" data-ktm="mainTo" value="${mdDe(S.kurtaxe.mainTo)}" placeholder="TT.MM." style="width:80px"></label>
          <span class="small">leer = Hauptsaisons aus „Saisons & Ferien“</span></div>
        <div class="tbl"><table><thead><tr><th>Gruppe</th><th>Alter</th><th>€ Hauptsaison</th><th>€ übrige Zeit</th><th></th></tr></thead><tbody>${kt}</tbody></table></div>
        <div class="row"><button class="mini" type="button" id="ktAdd">+ Altersgruppe</button></div>
      </section>
      ${contractSettings(S)}</div>`;
  }

  // Mietbedingungen (Anhang der Rechnung) und Mietvertrag (Papier): Vorlagen als Abschnittslisten mit Platzhaltern
  function contractSettings(S) {
    const C = S.contract;
    const apts = (data?.apartments || []).filter(a => a.source !== 'own').map(a => a.name);
    const ta = (attr, val, rows = 3) => `<textarea class="in" ${attr} rows="${rows}" style="width:100%">${esc(val || '')}</textarea>`;
    const tab = ivs.termsTab || 'termsInvoice';
    const list = C[tab] || [];
    const other = tab === 'termsInvoice' ? 'Mietvertrag' : 'Rechnung';
    return `<section class="sec"><h3>Mietbedingungen und Mietvertrag</h3>
        <p class="d">Normalfall: Die Rechnung geht per E-Mail an den Gast, mit dem Hinweis unten und den Mietbedingungen als zweite Seite. Mit der Anzahlung ist die Buchung bestätigt. Für Gäste, die Papier wollen, gibt es in jeder Rechnung „📄 Mietvertrag (PDF)“ mit Unterschriftenfeldern. Beide Vorlagen sind hier frei änderbar. Änderungen gelten für neue Rechnungen; festgeschriebene behalten die Bedingungen von damals.</p>
        <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="ctTerms" ${C.attachTerms ? 'checked' : ''}> Mietbedingungen an jede Rechnung anhängen und Bestätigungshinweis drucken</label>
        <label class="row" style="flex-direction:column;align-items:stretch">Bestätigungshinweis auf der ersten Rechnungsseite${ta('data-ct="confirmText"', C.confirmText, 2)}</label>
        <div class="gform">
          <label>Ort für die Unterschrift (Vertrag)<input class="in" data-ct="place" value="${esc(C.place)}"></label>
          <label>Anreise ab (Uhrzeit)<input class="in" data-ct="checkIn" value="${esc(C.checkIn)}"></label>
          <label>Abreise bis (Uhrzeit)<input class="in" data-ct="checkOut" value="${esc(C.checkOut)}"></label></div>
        <h3 style="font-size:1.05em">Wohnungen (Platzhalter [Wohnung])</h3>
        <label class="row" style="flex-direction:column;align-items:stretch">Standardbeschreibung${ta('data-ct="defaultDescription"', C.defaultDescription)}</label>
        ${apts.map(n => { const a = C.apartments[n] || {}; return `<div class="gform" style="align-items:start"><label>${esc(n)}: Bezeichnung<input class="in" data-cta="${esc(n)}|label" value="${esc(a.label || '')}" placeholder="z. B. OG 4"></label>
          <label class="wide">Beschreibung (leer = Standard)${ta(`data-cta="${esc(n)}|description"`, a.description, 2)}</label></div>`; }).join('')}
        <h3 style="font-size:1.05em">Vorlage bearbeiten</h3>
        <div class="row"><button class="${tab === 'termsInvoice' ? 'btn primary' : 'btn'}" type="button" data-ttab="termsInvoice">Mietbedingungen (Anhang der Rechnung)</button>
          <button class="${tab === 'termsContract' ? 'btn primary' : 'btn'}" type="button" data-ttab="termsContract">Mietvertrag (Papier)</button>
          <a class="mini" href="#" id="ctPh">Platzhalter anzeigen</a></div>
        <div id="ctPhBox" class="notice" style="display:${ivs.phOpen ? 'block' : 'none'}"><b>Platzhalter</b> (werden beim Erzeugen ersetzt; Blöcke allein in eine Zeile schreiben):<br>${Object.entries(ivs.ph || {}).map(([k, v]) => `<code>${esc(k)}</code> ${esc(v)}`).join('<br>')}</div>
        ${list.map((c, i) => `<div class="row" style="flex-direction:column;align-items:stretch;gap:4px">
          <div class="row" style="margin:0"><b>${i + 1}.</b><input class="in" data-cl="${i}|title" value="${esc(c.title)}" style="max-width:340px" placeholder="Überschrift">
            <button class="mini" type="button" data-clup="${i}" ${i ? '' : 'disabled'} aria-label="nach oben">▲</button><button class="mini" type="button" data-cldown="${i}" ${i < list.length - 1 ? '' : 'disabled'} aria-label="nach unten">▼</button><button class="mini" type="button" data-cldel="${i}" aria-label="Abschnitt löschen">✕</button></div>
          ${ta(`data-cl="${i}|text"`, c.text, Math.min(8, Math.max(2, Math.ceil((c.text || '').length / 130) + (c.text || '').split('\n').length - 1)))}</div>`).join('')}
        <div class="row"><button class="mini" type="button" id="clAdd">+ Abschnitt</button>
          <button class="mini" type="button" id="ctCopy">Abschnitte aus der Vorlage „${other}“ übernehmen</button>
          <button class="mini" type="button" id="ctReset">Diese Vorlage auf Ausgangstext zurücksetzen</button></div>
        <p class="small">Abschnitte ohne Inhalt (z. B. „Besondere Vereinbarungen“, wenn in der Rechnung nichts eingetragen ist) werden weggelassen, die Nummerierung passt sich an.</p>
      </section>`;
  }

  // E-Mail-Entwurf im Mailprogramm öffnen; die Rechnung (PDF) hängt man dort selbst an
  function mailLink(I, schedule) {
    const sl = I.seller || {};
    const pay = (schedule || []).map(p => `- ${p.label}: ${euro(p.amount)} bis ${dmy(p.dueDate)}`).join('\n');
    const body = `Guten Tag ${I.buyer.name},\n\nvielen Dank für Ihre Buchung${I.aptName ? ` (${I.aptName})` : ''} vom ${dmy(I.from)} bis ${dmy(I.to)}. Anbei erhalten Sie die Rechnung ${I.number} mit unseren Mietbedingungen.\n\n${pay ? `Bitte überweisen Sie:\n${pay}\n\nAuf der Rechnung finden Sie für jede Zahlung einen QR-Code für Ihre Banking-App.\n\n` : ''}Mit Ihrer Anzahlung bzw. Zahlung ist die Buchung verbindlich bestätigt und die Mietbedingungen sind anerkannt. Einen unterschriebenen Mietvertrag brauchen wir nicht; gern schicken wir Ihnen aber einen zu.\n\nWir freuen uns auf Ihren Besuch!\n\nViele Grüße\n${sl.name || ''}${sl.phone ? `\nTel. ${sl.phone}` : ''}`;
    return `mailto:${encodeURIComponent(I.buyer.email)}?subject=${encodeURIComponent(`Ihre Buchung ${dmy(I.from)} bis ${dmy(I.to)}, Rechnung ${I.number}`)}&body=${encodeURIComponent(body)}`;
  }

  const mdDe = md => (md ? `${md.slice(3)}.${md.slice(0, 2)}.` : '');

  function invEditor() {
    const { invoice: I, totals: T, missing, schedule, payments, open } = ivs.cur;
    const schedTbl = schedule.length ? `<div class="tbl"><table style="min-width:0"><thead><tr><th>Zahlung</th><th style="text-align:right">Betrag</th><th>fällig bis</th></tr></thead><tbody>${schedule.map(p => `<tr><td>${esc(p.label)}</td><td style="text-align:right">${euro(p.amount)}</td><td>${dmy(p.dueDate)}</td></tr>`).join('')}</tbody></table></div>` : '';
    const draft = I.status === 'entwurf';
    const trv = I.input.adults != null ? { adults: I.input.adults, childAges: I.input.childAges || [] }
      : { adults: (I.input.ages || []).filter(x => x > 17).length, childAges: (I.input.ages || []).filter(x => x <= 17) };
    const b = I.buyer;
    const head = `<div class="row"><button class="btn" type="button" id="ivBack">◀ Rechnungen</button>${I.guestId ? '<button class="btn" type="button" id="ivGuest">Zum Gast</button>' : ''}
      <a class="btn" href="/export/rechnung/${I.id}.pdf" target="_blank" style="text-decoration:none;color:var(--fg)">${draft ? 'Vorschau PDF' : 'PDF öffnen'}</a>
      ${I.kind === 'rechnung' ? `<a class="btn" href="/export/mietvertrag/${I.id}.pdf" target="_blank" style="text-decoration:none;color:var(--fg)">📄 Mietvertrag (PDF)</a>` : ''}
      ${!draft && I.kind === 'rechnung' && b.email ? `<a class="btn" href="${mailLink(I, schedule)}" style="text-decoration:none;color:var(--fg)">✉ E-Mail an Gast</a>` : ''}
      ${!draft && I.files?.xml ? `<a class="btn" href="/export/rechnung/${I.id}.xml" style="text-decoration:none;color:var(--fg)">E-Rechnung (XML)</a>` : ''}</div>`;
    const sums = `<dl class="facts" style="max-width:520px">
      <dt>Gesamt brutto</dt><dd>${euro(T.gross)}</dd>
      ${T.vat.map(v => v.rate ? `<dt>darin ${v.rate} % USt</dt><dd>${euro(v.tax)} (netto ${euro(v.net)})</dd>` : `<dt>Kurtaxe</dt><dd>${euro(v.gross)}</dd>`).join('')}
      ${T.deposit ? `<dt>Anzahlung</dt><dd>${euro(-T.deposit)}</dd>` : ''}
      <dt>${I.kind === 'storno' ? 'Gutschrift' : 'Zu zahlen'}</dt><dd>${euro(T.due)}</dd></dl>`;
    if (!draft) {
      return `<div class="sbody">${head}
        <section class="sec"><h3>${I.kind === 'storno' ? 'Stornorechnung' : 'Rechnung'} ${esc(I.number)} ${I.cancelledBy ? '<span class="badge off">storniert</span>' : ''}</h3>
          <p class="d">Festgeschrieben am ${dmy(I.date)} für ${esc(b.name)}, ${dmy(I.from)} bis ${dmy(I.to)}${I.aptName ? `, ${esc(I.aptName)}` : ''}.${I.kind === 'storno' ? ` Storniert Rechnung ${esc(I.refNumber)}.` : ''}${I.eInvoice ? ' Mit E-Rechnung (XRechnung).' : ''}</p>
          ${sums}
          ${schedTbl}
          <h3 style="font-size:1.05em">${I.kind === 'storno' ? 'Erstattungen' : 'Zahlungseingänge'}</h3>
          <div class="tbl"><table style="min-width:0"><thead><tr><th>Datum</th><th style="text-align:right">Betrag</th><th>Notiz</th><th></th></tr></thead><tbody>
            ${payments.map(p => `<tr><td>${dmy(p.date)}</td><td style="text-align:right">${euro(p.amount)}</td><td class="small">${esc(p.note || '')}</td><td>${p.implicit ? '' : `<button class="mini" type="button" data-paydel="${p.id}" aria-label="Zahlung löschen">✕</button>`}</td></tr>`).join('') || '<tr><td colspan="4" class="small">Noch keine Zahlung erfasst.</td></tr>'}</tbody></table></div>
          ${open > 0.005 ? `<div class="row"><b>Offen: ${euro(open)}</b> · ${I.kind === 'storno' ? 'Erstattet' : 'Eingang'} am <input class="in" type="date" id="payDate" value="${iso(new Date())}" style="width:auto">
            Betrag <input class="in short" id="payAmt" value="${num2(nextInstallment(schedule, payments, open))}" style="width:100px"> <input class="in" id="payNote" placeholder="Notiz, z. B. Anzahlung" style="width:180px">
            <button class="mini" type="button" id="payAdd">Zahlung erfassen</button></div>` : `<div class="row"><span class="badge ok">${I.kind === 'storno' ? 'vollständig erstattet' : 'vollständig bezahlt'}${I.paidAt ? ` am ${dmy(I.paidAt)}` : ''}</span></div>`}
          ${I.kind === 'rechnung' && !I.cancelledBy ? `<h3 style="font-size:1.05em">Ändern</h3>
          <div class="row"><button class="btn primary" type="button" id="ivCorrect">Rechnung korrigieren</button><span class="small">Storniert diese Rechnung (Stornorechnung mit neuer Nummer) und legt eine Kopie als Entwurf an, den du ändern und neu festschreiben kannst.${payments.some(p => !p.implicit) ? ' Bereits gezahlte Beträge werden mit der neuen Rechnung verrechnet.' : ''}</span></div>
          <div class="row"><button class="mini" type="button" id="ivCancel">Nur stornieren</button><span class="small">Zum Beispiel wenn der Gast ganz absagt. Gezahlte Beträge erfasst du dann bei der Stornorechnung als Erstattung.</span></div>` : ''}
        </section></div>`;
    }
    const items = I.items.map((it, i) => `<tr>
      <td><input class="in" data-it="${i}|text" value="${esc(it.text)}" style="min-width:280px"></td>
      <td><input class="in short" data-it="${i}|qty" value="${num2(it.qty)}" style="width:70px"></td>
      <td><input class="in" data-it="${i}|unit" value="${esc(it.unit)}" style="width:100px"></td>
      <td><input class="in short" data-it="${i}|price" value="${num2(it.price)}" style="width:90px"></td>
      <td>${vatSel(`data-it="${i}|vat"`, it.vat)}</td>
      <td style="text-align:right;white-space:nowrap">${euro(Math.round(it.qty * it.price * 100) / 100)}</td>
      <td><button class="mini" type="button" data-itdel="${i}" aria-label="Position löschen">✕</button></td></tr>`).join('');
    return `<div class="sbody">${head}
      <section class="sec"><h3>Rechnungsentwurf für ${esc(b.name)}</h3>
        ${I.replacesNumber ? `<div class="notice">Korrektur zu Rechnung ${esc(I.replacesNumber)} (storniert). ${I.deposit ? `Bereits gezahlte ${euro(I.deposit)} sind unten als „Anzahlung erhalten“ eingetragen und werden abgezogen.` : ''}</div>` : ''}
        <div class="gform">
          <label>Name / Firma<input class="in" data-b="name" value="${esc(b.name)}"></label>
          <label>Straße<input class="in" data-b="street" value="${esc(b.street)}"></label>
          <label>PLZ<input class="in" data-b="zip" value="${esc(b.zip)}"></label>
          <label>Ort<input class="in" data-b="city" value="${esc(b.city)}"></label>
          <label>Land (2 Buchstaben)<input class="in" data-b="country" value="${esc(b.country)}"></label>
          <label>E-Mail<input class="in" data-b="email" value="${esc(b.email)}"></label>
          <label>USt-IdNr. des Gastes (nur Firmen)<input class="in" data-b="vatId" value="${esc(b.vatId)}"></label>
          <label>Telefon (für den Mietvertrag)<input class="in" data-b="phone" value="${esc(b.phone || '')}"></label>
          <label>Referenz / Bestellnummer des Gastes<input class="in" data-b="reference" value="${esc(b.reference)}"></label>
        </div>
      </section>
      <section class="sec"><h3>Aufenthalt und Berechnung</h3>
        <div class="gform">
          <label>Anreise<input class="in" type="date" data-p="from" value="${I.from}"></label>
          <label>Abreise<input class="in" type="date" data-p="to" value="${I.to}"></label>
          <label>Wohnung<input class="in" data-p="aptName" value="${esc(I.aptName)}"></label>
          <label>Grundpreis je Nacht (€, brutto)<input class="in" data-in="perNight" value="${num2(I.input.perNight)}"></label>
          <label>Erwachsene (Anzahl)<input class="in" data-in="adults" value="${trv.adults}" inputmode="numeric"></label>
          <label>Alter der Kinder, mit Komma getrennt (aus Smoobu vorläufig 10, bitte prüfen)<input class="in" data-in="childAges" value="${esc(trv.childAges.join(', '))}" placeholder="z. B. 12, 4"></label>
          <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-in="cleaning" ${I.input.cleaning ? 'checked' : ''}> Endreinigung berechnen</label>
          <label class="wide">Besondere Vereinbarungen für diese Buchung (erscheinen in Mietbedingungen und Mietvertrag)<textarea class="in" data-in="special" rows="2" placeholder="z. B. Hund erlaubt, späte Anreise 20 Uhr vereinbart">${esc(I.input.special || '')}</textarea></label>
          <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-in="ktExempt" ${I.input.ktExempt ? 'checked' : ''}> Geschäftsreise (keine Kurtaxe)</label>
        </div>
        <div class="row"><button class="btn primary" type="button" id="ivRecalc">Positionen neu berechnen</button><span class="small">Überschreibt die Positionen unten mit den Preisbausteinen.</span></div>
      </section>
      <section class="sec"><h3>Positionen</h3>
        <div class="tbl"><table><thead><tr><th>Leistung</th><th>Menge</th><th>Einheit</th><th>Einzelpreis brutto</th><th>USt</th><th style="text-align:right">Gesamt</th><th></th></tr></thead><tbody>${items || '<tr><td colspan="7" class="small">Keine Positionen.</td></tr>'}</tbody></table></div>
        <div class="row"><button class="mini" type="button" id="itAdd">+ Position</button>
          Anzahlung erhalten (€) <input class="in short" id="ivDep" value="${num2(I.deposit)}"></div>
        <label class="row" style="flex-direction:column;align-items:stretch">Hinweis auf der Rechnung (optional)<input class="in" id="ivNote" value="${esc(I.note)}"></label>
        ${sums}
      </section>
      <section class="sec"><h3>Festschreiben</h3>
        <label class="row">Zahlungsplan <select class="in" data-in="plan" style="width:auto"><option value="auto">nach Zahlungsbedingungen</option><option value="full" ${I.input.plan === 'full' ? 'selected' : ''}>ganzer Betrag auf einmal</option></select></label>
        ${I.input.plan === 'full' ? '' : `<div class="row">Abweichende Anzahlung (optional): Betrag (€) <input class="in short" data-in="depositAmount" value="${I.input.depositAmount ? num2(I.input.depositAmount) : ''}" placeholder="z. B. 408" style="width:100px">
          fällig am <input class="in" type="date" data-in="depositDue" value="${I.input.depositDue || ''}" style="width:auto"><span class="small">z. B. „erst am 20.01. anweisen“. Leer = nach Zahlungsbedingungen.</span></div>`}
        ${schedTbl}${schedule.length ? (ivs.cur.settings.seller.iban && ivs.cur.settings.seller.name ? '<p class="small">Fälligkeiten gerechnet ab heute. Auf der Rechnung steht je Zahlung ein QR-Code (GiroCode) für die Überweisung.</p>' : '<div class="notice warn">Der GiroCode fehlt noch: Bitte unter „Vermieterdaten und Preise“ Name und IBAN eintragen.</div>') : ''}
        <label class="row"><input type="checkbox" id="ivE" ${I.eInvoice ? 'checked' : ''}> Auch als E-Rechnung (XRechnung) ausstellen, z. B. wenn eine Firma das verlangt</label>
        ${missing.length ? `<div class="notice warn">Bitte noch ergänzen: ${missing.map(esc).join(', ')}.</div>` : ''}
        <div class="row"><button class="btn primary" type="button" id="ivIssue" ${missing.length ? 'disabled' : ''}>Rechnung festschreiben</button>
          <button class="mini" type="button" id="ivDel">Entwurf löschen</button></div>
        <p class="small">Beim Festschreiben bekommt die Rechnung ihre Nummer und wird als PDF abgelegt. Danach ist sie nicht mehr änderbar.</p>
      </section></div>`;
  }

  async function iAct(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); }
    catch (e) { toast(e.message); }
    const y = window.scrollY;
    await renderInvoices();
    window.scrollTo(0, y);
  }

  // Vorschlag für den nächsten Zahlungsbetrag: nächste offene Rate laut Zahlungsplan
  function nextInstallment(schedule, payments, open) {
    const paid = (payments || []).filter(p => !p.implicit).reduce((a, p) => a + p.amount, 0);
    let acc = 0;
    for (const s of schedule || []) { acc += s.amount; if (paid < acc - 0.005) return Math.min(open, Math.round((acc - paid) * 100) / 100); }
    return open;
  }

  function openInvoice(id) { state.view = 'invoices'; ivs.page = 'edit'; ivs.id = id; render(); window.scrollTo(0, 0); }

  function bindInvoices() {
    const put = (p, body) => api(p, { method: 'PUT', body });
    const post = (p, body) => api(p, { method: 'POST', body });
    if (ivs.page === 'list') {
      $$('[data-inv]').forEach(r => r.onclick = () => openInvoice(+r.dataset.inv));
      $('#ivSet').onclick = () => { ivs.page = 'settings'; renderInvoices(); };
      if ($('#ivTestDel')) $('#ivTestDel').onclick = () => {
        const b = $('#ivTestDel');
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Wirklich alle Testrechnungen löschen?'; b.classList.add('danger'); return; }
        iAct(() => post('/api/admin/invoices/test-cleanup'), 'Testrechnungen gelöscht.');
      };
      $('#ivToGuests').onclick = () => { state.view = 'guests'; gst.id = null; render(); };
      $('#ivY').onchange = e => { ivs.year = +e.target.value; };
      $('#ivQ').onchange = e => { ivs.q = +e.target.value; };
      $$('[data-rep]').forEach(b => b.onclick = () => { const [art, fmt] = b.dataset.rep.split('|'); window.open(`/export/ust-bericht.${fmt}?art=${art}&jahr=${ivs.year}&q=${ivs.q}`, '_blank'); });
      return;
    }
    $('#ivBack').onclick = () => { ivs.page = 'list'; renderInvoices(); };
    if (ivs.page === 'settings') {
      const S = ivs.set;
      const save = body => iAct(() => put('/api/admin/invoice-settings', body), 'Gespeichert.');
      $$('[data-sl]').forEach(i => i.onchange = () => save({ seller: { [i.dataset.sl]: i.value } }));
      $$('[data-iv]').forEach(i => i.onchange = () => save({ [i.dataset.iv]: i.value }));
      $$('[data-pr]').forEach(i => i.onchange = () => save({ pricing: { [i.dataset.pr]: i.value } }));
      $$('[data-pay]').forEach(i => i.onchange = () => save({ payment: { [i.dataset.pay]: i.value } }));
      if ($('#logoOn')) $('#logoOn').onchange = e => save({ logo: { enabled: e.target.checked } });
      $('#logoFile').onchange = e => {
        const f = e.target.files[0]; if (!f) return;
        if (f.size > 4e6) { toast('Die Datei ist größer als 4 MB.'); return; }
        const r = new FileReader();
        r.onload = () => iAct(() => post('/api/admin/invoice-logo', { name: f.name, data: r.result }), 'Logo gespeichert.');
        r.readAsDataURL(f);
      };
      $('#ivNext').onchange = e => save({ nextNumber: { year: new Date().getFullYear(), value: e.target.value } });
      $('#ktLabel').onchange = e => save({ kurtaxe: { label: e.target.value } });
      $$('[data-ktm]').forEach(i => i.onchange = () => save({ kurtaxe: { [i.dataset.ktm]: i.value } }));
      const groups = () => S.kurtaxe.groups.map(g => ({ ...g }));
      $$('[data-kt]').forEach(i => i.onchange = () => { const [n, k] = i.dataset.kt.split('|'); const g = groups(); g[+n][k] = i.value; save({ kurtaxe: { groups: g } }); });
      $$('[data-ktdel]').forEach(b => b.onclick = () => { const g = groups(); g.splice(+b.dataset.ktdel, 1); save({ kurtaxe: { groups: g } }); });
      const csave = body => iAct(() => put('/api/admin/contract-settings', body), 'Gespeichert.');
      const tab = ivs.termsTab || 'termsInvoice';
      const cls = () => (S.contract[tab] || []).map(c => ({ ...c }));
      const lsave = c => csave({ [tab]: c });
      const arm = (b, label, fn) => { if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = label; b.classList.add('danger'); return; } fn(); };
      $$('[data-ct]').forEach(i => i.onchange = () => csave({ [i.dataset.ct]: i.value }));
      $('#ctTerms').onchange = e => csave({ attachTerms: e.target.checked });
      $$('[data-cta]').forEach(i => i.onchange = () => { const [n, k] = i.dataset.cta.split('|'); csave({ apartments: { [n]: { [k]: i.value } } }); });
      $$('[data-ttab]').forEach(b => b.onclick = () => { ivs.termsTab = b.dataset.ttab; renderInvoices(); });
      $('#ctPh').onclick = e => { e.preventDefault(); ivs.phOpen = !ivs.phOpen; $('#ctPhBox').style.display = ivs.phOpen ? 'block' : 'none'; };
      $$('[data-cl]').forEach(i => i.onchange = () => { const [n, k] = i.dataset.cl.split('|'); const c = cls(); c[+n][k] = i.value; lsave(c); });
      $$('[data-cldel]').forEach(b => b.onclick = () => arm(b, 'Löschen?', () => { const c = cls(); c.splice(+b.dataset.cldel, 1); lsave(c); }));
      $$('[data-clup]').forEach(b => b.onclick = () => { const c = cls(), k = +b.dataset.clup; [c[k - 1], c[k]] = [c[k], c[k - 1]]; lsave(c); });
      $$('[data-cldown]').forEach(b => b.onclick = () => { const c = cls(), k = +b.dataset.cldown; [c[k + 1], c[k]] = [c[k], c[k + 1]]; lsave(c); });
      $('#clAdd').onclick = () => { const c = cls(); c.push({ title: 'Neuer Abschnitt', text: 'Text' }); lsave(c); };
      $('#ctCopy').onclick = () => arm($('#ctCopy'), 'Wirklich diese Vorlage durch die andere ersetzen?', () => iAct(() => post('/api/admin/contract-settings/reset', { which: tab, from: 'other' }), 'Übernommen.'));
      $('#ctReset').onclick = () => arm($('#ctReset'), 'Wirklich auf den Ausgangstext zurücksetzen?', () => iAct(() => post('/api/admin/contract-settings/reset', { which: tab }), 'Zurückgesetzt.'));
      $('#ktAdd').onclick = () => { const g = groups(); const last = g[g.length - 1]; g.push({ label: 'Neue Gruppe', ageFrom: last ? Math.min(120, last.ageTo + 1) : 0, ageTo: 120, rate: 0, rateNeben: null }); save({ kurtaxe: { groups: g } }); };
      return;
    }
    const I = ivs.cur.invoice;
    const url = `/api/admin/invoices/${I.id}`;
    if ($('#ivGuest')) $('#ivGuest').onclick = () => { state.view = 'guests'; gst.id = I.guestId; render(); window.scrollTo(0, 0); };
    if (I.status !== 'entwurf') {
      if ($('#payAdd')) $('#payAdd').onclick = () => iAct(() => post(`${url}/payments`, { date: $('#payDate').value, amount: $('#payAmt').value, note: $('#payNote').value }), 'Zahlung erfasst.');
      $$('[data-paydel]').forEach(b => b.onclick = () => {
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Löschen?'; b.classList.add('danger'); return; }
        iAct(() => api(`${url}/payments/${b.dataset.paydel}`, { method: 'DELETE' }), 'Zahlung gelöscht.');
      });
      if ($('#ivCorrect')) $('#ivCorrect').onclick = () => {
        const b = $('#ivCorrect');
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Wirklich stornieren und neu schreiben?'; b.classList.add('danger'); return; }
        let r = null; iAct(async () => { r = await post(`${url}/correct`); ivs.id = r.id; }).then(() => r && toast(`Storniert mit ${r.number}. Neuer Entwurf ist offen.`));
      };
      if ($('#ivCancel')) $('#ivCancel').onclick = () => {
        const b = $('#ivCancel');
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Wirklich stornieren?'; b.classList.add('danger'); return; }
        let r = null; iAct(async () => { r = await post(`${url}/cancel`); ivs.id = r.id; }).then(() => r && toast(`Stornorechnung ${r.number} erstellt.`));
      };
      return;
    }
    $$('[data-b]').forEach(i => i.onchange = () => iAct(() => put(url, { buyer: { [i.dataset.b]: i.value } })));
    $$('[data-p]').forEach(i => i.onchange = () => iAct(() => put(url, { [i.dataset.p]: i.value })));
    $$('[data-in]').forEach(i => i.onchange = () => iAct(() => put(url, { input: { [i.dataset.in]: i.type === 'checkbox' ? i.checked : i.value } })));
    const items = () => I.items.map(it => ({ ...it }));
    $$('[data-it]').forEach(i => i.onchange = () => { const [n, k] = i.dataset.it.split('|'); const it = items(); it[+n][k] = i.value; iAct(() => put(url, { items: it })); });
    $$('[data-itdel]').forEach(b => b.onclick = () => { const it = items(); it.splice(+b.dataset.itdel, 1); iAct(() => put(url, { items: it })); });
    $('#itAdd').onclick = () => iAct(() => put(url, { items: [...items(), { text: 'Weitere Leistung', qty: 1, unit: 'Stück', price: 0, vat: ivs.cur.settings.vatRate }] }));
    $('#ivRecalc').onclick = () => iAct(() => post(`${url}/recompute`), 'Neu berechnet.');
    $('#ivDep').onchange = e => iAct(() => put(url, { deposit: e.target.value }));
    $('#ivNote').onchange = e => iAct(() => put(url, { note: e.target.value }));
    $('#ivE').onchange = e => iAct(() => put(url, { eInvoice: e.target.checked }));
    $('#ivIssue').onclick = () => {
      const b = $('#ivIssue');
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Jetzt endgültig festschreiben?'; b.classList.add('danger'); return; }
      let r = null; iAct(async () => { r = await post(`${url}/issue`); }).then(() => r && toast(`Rechnung ${r.number} festgeschrieben.`));
    };
    $('#ivDel').onclick = () => {
      const b = $('#ivDel');
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Entwurf wirklich löschen?'; b.classList.add('danger'); return; }
      iAct(async () => { await api(url, { method: 'DELETE' }); ivs.page = 'list'; }, 'Entwurf gelöscht.');
    };
  }

  /* ---------- Portal-Abgleich (nur PC) ---------- */

  const pst = { months: 6, res: null };
  let portalHintText = '';

  async function checkPortals() {
    try {
      const r = await api('/api/admin/portals?months=6');
      const bad = r.portals.filter(p => p.counts && (p.counts.portalZu || p.counts.portalOffen));
      portalHintText = bad.length ? `Portal-Abgleich: ${bad.map(p => `${p.name} weicht an ${p.counts.portalZu + p.counts.portalOffen} Nächten ab`).join(', ')}.` : '';
    } catch { portalHintText = ''; }
    const h = $('#portalHint');
    if (!h) return;
    h.innerHTML = portalHintText ? `${esc(portalHintText)} <button class="mini" type="button" id="portHintBtn">Ansehen</button>` : '';
    h.hidden = !portalHintText || state.view === 'portals';
    if ($('#portHintBtn')) $('#portHintBtn').onclick = () => { state.view = 'portals'; render(); window.scrollTo(0, 0); };
    if (MODE === 'admin') pcApply();
  }

  const STATE_TXT = {
    'portal-zu': 'Portal zeigt belegt, aber in Smoobu ist noch frei',
    'portal-offen': 'Alle Wohnungen belegt, Portal zeigt aber frei',
  };

  async function renderPortals() {
    const v = $('#view');
    if (MODE !== 'admin') { state.view = 'w4'; return render(); }
    try { pst.res = await api(`/api/admin/portals?months=${pst.months}`); } catch (e) { v.innerHTML = `<div class="notice warn">${esc(e.message)}</div>`; return; }
    const R = pst.res;
    const A = id => R.apartments.find(a => a.id === id);
    const when = t => t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';
    const dd = s => fy(D(s));
    const lastNight = s => fy(add(D(s), -1));
    const cand = R.apartments.filter(a => a.source !== 'own');

    const cfgRows = R.portals.map(p => {
      const st = !p.hasUrl ? '<span class="badge off">kein Link</span>'
        : p.error ? `<span class="badge err">Fehler</span> <span class="small">${esc(p.error)}${p.fetchedAt ? `, zeige Stand ${when(p.fetchedAt)}` : ''}</span>`
        : p.fetchedAt ? `<span class="badge ok">ok</span> <span class="small">${when(p.fetchedAt)} · ${p.count} Einträge</span>` : '<span class="badge off">noch nicht abgerufen</span>';
      return `<tr>
        <td><input class="in" data-pname="${p.id}" value="${esc(p.name)}" style="min-width:200px"></td>
        <td style="min-width:300px"><div class="row"><input class="in" data-purl="${p.id}" placeholder="${p.hasUrl ? `hinterlegt (${esc(p.urlHost)}) – zum Ändern neuen Link einfügen` : 'iCal-Export-Link des Portals einfügen'}" autocomplete="off"><button class="mini" type="button" data-psave="${p.id}">Speichern</button></div></td>
        <td style="white-space:nowrap">${cand.map(a => `<label class="small" style="margin-right:8px"><input type="checkbox" data-papt="${p.id}|${a.id}" ${p.apts.includes(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</td>
        <td>${st}</td>
        <td><button class="mini" type="button" data-pdel="${p.id}" aria-label="Portal entfernen">✕</button></td></tr>`;
    }).join('');

    const active = R.portals.filter(p => p.days);
    const summary = active.map(p => {
      const c = p.counts;
      const okAll = !c.portalZu && !c.portalOffen;
      const rows = p.ranges.map(r => `<tr class="${r.state === 'portal-zu' ? 'bad' : ''}">
        <td>${dd(r.from)} – ${lastNight(r.to)}</td><td>Abreise ${dd(r.to)}</td><td style="text-align:right">${r.nights}</td>
        <td>${r.state === 'portal-zu' ? '<span class="badge err">zu</span>' : '<span class="badge warn">offen</span>'} ${STATE_TXT[r.state]}</td>
        <td>${r.state === 'portal-zu' ? `frei: ${r.free.map(id => esc(A(id)?.name || id)).join(', ')}` : ''}</td></tr>`).join('');
      return `<section class="sec"><h3>${esc(p.name)} ${okAll ? '<span class="badge ok">✓ stimmt</span>' : `<span class="badge err">${c.portalZu + c.portalOffen} Nächte weichen ab</span>`}</h3>
        <p class="d">Geprüft: ${dd(R.from)} bis ${lastNight(R.to)}, ${c.nights} Nächte. Stimmt an ${c.ok} Nächten. Portal meldet ${c.portalNights} Nächte als belegt. Stand Portal: ${when(p.fetchedAt)}.</p>
        ${rows ? `<div class="tbl"><table><thead><tr><th>Nächte</th><th></th><th style="text-align:right">Anzahl</th><th>Abweichung</th><th>Wohnungen</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="small">Keine Abweichungen.</p>'}
      </section>`;
    }).join('');

    // Monatsraster: je Wohnung eine Zeile, je Portal eine Zeile Portal + eine Zeile Abgleich
    let grids = '';
    if (active.length) {
      const allApts = [...new Set(active.flatMap(p => p.apts))].sort((a, b) => R.apartments.findIndex(x => x.id === a) - R.apartments.findIndex(x => x.id === b));
      const byMonth = new Map();
      active[0].days.forEach((x, i) => { const k = x.d.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(i); });
      for (const [k, idx] of byMonth) {
        const first = D(active[0].days[idx[0]].d);
        const head = idx.map(i => { const dt = D(active[0].days[i].d); return `<th class="${dt.getDay() === 6 ? 'sa' : ''}">${dt.getDate()}<br><span>${WD[dt.getDay()]}</span></th>`; }).join('');
        const aptRows = allApts.map(id => { const a = A(id); return `<tr><td class="pl"><i style="background:${color(a?.color)}"></i>${esc(a?.name || id)}</td>${idx.map(i => {
          const busy = active.some(p => p.days[i].busy.includes(id));
          return `<td class="${busy ? 'on' : ''}" style="${busy ? `background:${color(a?.color)}` : ''}" title="${busy ? 'belegt' : 'frei'}"></td>`; }).join('')}</tr>`; }).join('');
        const pRows = active.map(p => `<tr class="pp"><td class="pl">${esc(p.name)}</td>${idx.map(i => `<td class="${p.days[i].portal ? 'pon' : ''}" title="${p.days[i].portal ? 'Portal: belegt' : 'Portal: frei'}"></td>`).join('')}</tr>
          <tr class="pc"><td class="pl small">Abgleich</td>${idx.map(i => { const s = p.days[i].state; return `<td class="${s}" title="${s.startsWith('ok') ? 'stimmt' : STATE_TXT[s]}">${s === 'portal-zu' ? '✕' : s === 'portal-offen' ? '!' : ''}</td>`; }).join('')}</tr>`).join('');
        grids += `<div class="pgrid tbl"><table><caption>${MONTHS[first.getMonth()]} ${first.getFullYear()}</caption><thead><tr><th></th>${head}</tr></thead><tbody>${aptRows}${pRows}</tbody></table></div>`;
      }
    }

    v.innerHTML = `<div class="settings" style="grid-template-columns:minmax(0,1fr)"><div class="sbody">
      <section class="sec"><h3>Portal-Abgleich</h3>
        <p class="d">Die Bodensee-Portale führen alle Wohnungen als <b>ein</b> Objekt. Richtig ist: Das Portal zeigt eine Nacht als belegt, wenn <b>alle</b> angehakten Wohnungen laut Smoobu belegt sind, sonst frei. Gezählt werden Nächte (Abreisetag zählt nicht).</p>
        <div class="row">Zeitraum <select class="in" id="pMonths" style="width:auto">${[3, 6, 12, 18].map(n => `<option value="${n}" ${n === pst.months ? 'selected' : ''}>${n} Monate</option>`).join('')}</select>
          <button class="mini" type="button" id="pRefresh">Jetzt abrufen</button>
          <span class="small">Legende: <b>✕</b> Portal zu, obwohl noch frei · <b>!</b> alles belegt, Portal offen</span></div>
      </section>
      ${summary || '<div class="notice">Noch kein Portal-Kalender abgerufen. Unten den iCal-Export-Link des Portals eintragen (im Vermieter-Bereich des Portals beim Belegungskalender, „iCal-Export“).</div>'}
      ${grids ? `<section class="sec"><h3>Tag für Tag</h3>${grids}</section>` : ''}
      <section class="sec"><h3>Portal-Kalender</h3>
        <p class="d">Der Link wird nur gelesen und dient nur der Kontrolle. Ein gespeicherter Link wird aus Sicherheitsgründen nicht mehr angezeigt.</p>
        <div class="tbl"><table><thead><tr><th>Portal</th><th>iCal-Export-Link</th><th>Zählt mit</th><th>Status</th><th></th></tr></thead><tbody>${cfgRows || '<tr><td colspan="5" class="small">Kein Portal eingetragen.</td></tr>'}</tbody></table></div>
        <div class="row"><input class="in" id="pNew" placeholder="weiteres Portal, Name" style="width:240px"><button class="mini" type="button" id="pAdd">+ Portal</button></div>
      </section></div></div>`;
    bindPortals();
  }

  async function pAct(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message); }
    const y = window.scrollY; await renderPortals(); window.scrollTo(0, y); checkPortals();
  }

  function bindPortals() {
    const put = (p, body) => api(p, { method: 'PUT', body });
    $('#pMonths').onchange = e => { pst.months = +e.target.value; pAct(async () => {}); };
    $('#pRefresh').onclick = () => pAct(() => api('/api/admin/refresh', { method: 'POST' }), 'Abgerufen.');
    $$('[data-pname]').forEach(i => i.onchange = () => pAct(() => put(`/api/admin/portals/${i.dataset.pname}`, { name: i.value }), 'Gespeichert.'));
    $$('[data-psave]').forEach(b => b.onclick = () => {
      const inp = $(`[data-purl="${b.dataset.psave}"]`);
      if (!inp.value.trim()) return toast('Bitte zuerst einen Link einfügen.');
      pAct(() => put(`/api/admin/portals/${b.dataset.psave}`, { icalUrl: inp.value.trim() }), 'Link gespeichert und abgerufen.');
    });
    $$('[data-papt]').forEach(c => c.onchange = () => {
      const pid = c.dataset.papt.split('|')[0];
      const apts = $$(`[data-papt^="${pid}|"]`).filter(x => x.checked).map(x => +x.dataset.papt.split('|')[1]);
      pAct(() => put(`/api/admin/portals/${pid}`, { apts }), 'Gespeichert.');
    });
    $$('[data-pdel]').forEach(b => b.onclick = () => {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Wirklich entfernen?'; b.classList.add('danger'); return; }
      pAct(() => api(`/api/admin/portals/${b.dataset.pdel}`, { method: 'DELETE' }), 'Entfernt.');
    });
    $('#pAdd').onclick = () => { const n = $('#pNew').value.trim(); if (!n) return toast('Bitte einen Namen angeben.'); pAct(() => api('/api/admin/portals', { method: 'POST', body: { name: n } }), 'Portal hinzugefügt.'); };
  }

  /* ---------- Ereignisse ---------- */

  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const k = nav.dataset.nav;
      if (k === 'today') { state.view = 'w4'; state.start = startOfSat(TODAY); }
      else state.view = k;
      return render();
    }
    const bar = e.target.closest('[data-event]');
    if (bar) return openEvent(bar.dataset.event);
    const mon = e.target.closest('[data-month]');
    if (mon) { state.view = 'w4'; state.start = startOfSat(new Date(state.year, +mon.dataset.month, 1)); return render(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(); });
  $('#prevBtn').onclick = () => step(-1);
  $('#nextBtn').onclick = () => step(1);
  const pm = $('#pdfMonth');
  if (pm) {
    const t = new Date(); pm.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
    const open = k => { if (!/^\d{4}-\d{2}$/.test(pm.value)) return toast('Bitte einen Monat wählen.'); window.open(`/export/monat.pdf?m=${pm.value}${k ? '' : '&kontakt=0'}`, '_blank'); };
    $('#pdfBtn').onclick = () => open(true);
  }
  $('#setBtn').onclick = () => { state.view = state.view === 'settings' ? 'w4' : 'settings'; render(); window.scrollTo(0, 0); };
  if ($('#invBtn')) $('#invBtn').onclick = () => { if (state.view === 'invoices') state.view = 'w4'; else { state.view = 'invoices'; ivs.page = 'list'; } render(); window.scrollTo(0, 0); };
  if ($('#portBtn')) $('#portBtn').onclick = () => { state.view = state.view === 'portals' ? 'w4' : 'portals'; render(); window.scrollTo(0, 0); };
  if ($('#guestBtn')) $('#guestBtn').onclick = () => { if (state.view === 'guests') state.view = 'w4'; else { state.view = 'guests'; gst.id = null; } render(); window.scrollTo(0, 0); };

  /* ---------- PC-Ansicht: Seitenleiste, Kopfzeile, Kennzahlen (nur body.pc) ---------- */

  const PCI = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
    receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    compare: '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15v2M12 10v7M17 6v11"/>',
    home: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    euro: '<path d="M18 7a7 7 0 1 0 0 10M4 10h10M4 14h10"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    bed: '<path d="M3 18V6M3 13h18v5M21 13a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="10" r="2"/>',
    arrowin: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
    arrowout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  };
  const pcIcon = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${PCI[n] || ''}</svg>`;
  const PC = {
    kalender: { t: 'Belegung', sub: '', icon: 'calendar', nav: 'Kalender' },
    gaeste: { t: 'Gäste', sub: 'Gästedatenbank mit Stammgästen und Aufenthalten', icon: 'users' },
    rechnungen: { t: 'Rechnungen', sub: 'Entwürfe, festgeschriebene Rechnungen und Zahlungseingänge', icon: 'receipt' },
    portale: { t: 'Portal-Abgleich', sub: 'Bodensee-Portale gegen die Smoobu-Belegung', icon: 'compare' },
    firma: { t: 'Belegungsplan Firma', sub: 'Eigener Kalender, nicht in Smoobu', icon: 'building', nav: 'Fewo 1 · Firma' },
    ust: { t: 'Umsatzsteuer', sub: 'Bericht für die Voranmeldung', icon: 'chart' },
    wohnungen: { t: 'Wohnungen & Abruf', sub: 'Name, Farbe, Reihenfolge und Datenquelle jeder Wohnung', icon: 'home' },
    saisons: { t: 'Saisons & Ferien', sub: 'Haupt- und Nebensaison je Jahr, Ferien Baden-Württemberg', icon: 'sun' },
    preise: { t: 'Rechnung & Preise', sub: 'Vermieterin, Logo, Nummern, Zahlungsbedingungen, Preisbausteine, Kurtaxe', icon: 'euro' },
    vertrag: { t: 'Mietbedingungen & Vertrag', sub: 'Vorlagen mit Platzhaltern, werden aus der Rechnung gefüllt', icon: 'pen' },
  };
  const pc = { sub: null };
  function pcKey() {
    const v = state.view;
    if (v === 'guests') return 'gaeste';
    if (v === 'portals') return 'portale';
    if (v === 'settings') return ['firma', 'saisons'].includes(pc.sub) ? pc.sub : 'wohnungen';
    if (v === 'invoices') {
      if (ivs.page === 'settings') return pc.sub === 'vertrag' ? 'vertrag' : 'preise';
      if (ivs.page === 'list' && pc.sub === 'ust') return 'ust';
      return 'rechnungen';
    }
    return 'kalender';
  }
  function pcGo(k) {
    pc.sub = k;
    if (k === 'kalender') { if (!['w4', 'm3', 'year', 'today'].includes(state.view)) state.view = 'w4'; }
    else if (k === 'gaeste') { state.view = 'guests'; gst.id = null; }
    else if (k === 'portale') state.view = 'portals';
    else if (['wohnungen', 'firma', 'saisons'].includes(k)) state.view = 'settings';
    else { state.view = 'invoices'; ivs.page = k === 'preise' || k === 'vertrag' ? 'settings' : 'list'; }
    $('.pc-side').classList.remove('open');
    closeOverlay();
    render();
    window.scrollTo(0, 0);
  }
  const PC_SHOW = {
    wohnungen: s => s.id === 's-quellen',
    firma: s => s.id === 's-firm',
    saisons: s => s.id === 's-saison' || s.id === 's-ferien',
    rechnungen: s => !/^Umsatzsteuer-Bericht/.test(s.h),
    ust: s => /^Umsatzsteuer-Bericht/.test(s.h),
    preise: s => !/^Mietbedingungen und Mietvertrag/.test(s.h),
    vertrag: s => /^Mietbedingungen und Mietvertrag/.test(s.h),
  };
  function pcApply() {
    const k = pcKey();
    if (['wohnungen', 'firma', 'saisons', 'preise', 'vertrag', 'rechnungen', 'ust'].includes(k)) pc.sub = k;
    const show = PC_SHOW[k];
    $$('#view .sbody > .sec').forEach(s => { s.hidden = show ? !show({ id: s.id, h: (s.querySelector('h3')?.textContent || '').trim() }) : false; });
    // Zurück-Knöpfe, die nur innerhalb eines Menüpunkts wechseln, bleiben; „Zu den Gästen“ und „Vermieterdaten“ übernimmt die Seitenleiste
    ['#ivToGuests'].forEach(s => { const b = $(s); if (b) b.hidden = true; });
    if ($('#ivSet')) $('#ivSet').hidden = true;
    if (k === 'preise' || k === 'vertrag') { const b = $('#ivBack'); if (b) b.closest('.row').hidden = true; }
    $$('.pc-nav a').forEach(a => a.classList.toggle('active', a.dataset.k === k));
    const P = PC[k];
    $('#title').textContent = k === 'kalender' ? 'Belegung Ferienwohnungen' : P.t;
    $('#pcSub').textContent = P.sub;
    $('#pcSub').hidden = k === 'kalender';
    $('#standLine').hidden = k !== 'kalender';
    pcKpis(k === 'kalender');
    pcBadges();
  }
  function pcKpis(on) {
    const box = $('#pcKpi');
    box.hidden = !on || !data.apartments.length;
    if (box.hidden) return;
    const real = data.events.filter(e => e.source !== 'Belegungsplan');
    const busy = data.apartments.filter(a => data.events.some(e => e.apt === a.id && e.arr <= TODAY && e.dep > TODAY));
    const wkEnd = add(startOfWeek(TODAY), 7);
    const arr = real.filter(e => e.arr >= TODAY && e.arr < wkEnd).sort((a, b) => a.arr - b.arr);
    const dep = real.filter(e => e.dep >= TODAY && e.dep < wkEnd).sort((a, b) => a.dep - b.dep);
    const who = (l, k) => l.map(e => `${e.title || 'Belegt'}, ${WD[e[k].getDay()]} ${f(e[k])}`).join(' · ') || 'keine';
    const card = (ic, tone, t, v, foot, go) => `<${go ? `button type="button" data-pcgo="${go}"` : 'div'} class="pc-kpi"><div class="t"><span class="ic ${tone}">${pcIcon(ic)}</span>${t}<span class="v">${esc(v)}</span></div><div class="f" title="${esc(foot)}">${esc(foot)}</div></${go ? 'button' : 'div'}>`;
    box.innerHTML = card('bed', 'tone-p', 'Heute belegt', `${busy.length} von ${data.apartments.length}`, busy.map(a => a.name).join(', ') || 'alles frei')
      + card('arrowin', 'tone-ok', 'Anreisen diese Woche', String(arr.length), who(arr, 'arr'))
      + card('arrowout', 'tone-n', 'Abreisen diese Woche', String(dep.length), who(dep, 'dep'))
      + card('compare', portalHintText ? 'tone-e' : 'tone-ok', 'Portal-Abgleich', portalHintText ? 'weicht ab' : 'stimmt', portalHintText.replace(/^Portal-Abgleich: /, '') || 'Bodensee-Portale passen zur Belegung', 'portale');
    $$('#pcKpi [data-pcgo]').forEach(b => b.onclick = () => pcGo(b.dataset.pcgo));
  }
  function pcBadges() {
    const b = $('.pc-nav a[data-k="portale"] .nb');
    if (b) { b.hidden = !portalHintText; b.textContent = '!'; }
  }
  function pcTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    try { t ? localStorage.setItem('fewo.theme', t) : localStorage.removeItem('fewo.theme'); } catch { /* egal */ }
    const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
    $('.pc-theme').innerHTML = `${pcIcon(dark ? 'sun' : 'moon')}<span>${dark ? 'Helles Design' : 'Dunkles Design'}</span>`;
  }
  function initPc() {
    const font = document.createElement('link');
    font.rel = 'stylesheet'; font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(font);
    const shell = document.createElement('div');
    shell.className = 'pc-shell';
    const a = k => `<a data-k="${k}">${pcIcon(PC[k].icon)}<span>${PC[k].nav || PC[k].t}</span>${k === 'portale' ? '<span class="nb" hidden></span>' : ''}</a>`;
    shell.innerHTML = `<aside class="pc-side">
        <div class="pc-brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="url(#pclg)"/><rect x="8" y="10" width="16" height="13" rx="2" fill="none" stroke="#fff" stroke-width="2.3"/><path d="M8 14.5h16M12.5 8v4M19.5 8v4" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/><defs><linearGradient id="pclg" x1="0" y1="0" x2="32" y2="32"><stop stop-color="#818cf8"/><stop offset="1" stop-color="#4f46e5"/></linearGradient></defs></svg>
          <div><b>Fewo-Kalender</b><span>Verwaltung am PC</span></div></div>
        <nav class="pc-nav" aria-label="Menü">
          <div class="lab">Belegung</div>${a('kalender')}${a('gaeste')}${a('rechnungen')}
          <div class="lab">Abgleich</div>${a('portale')}${a('firma')}
          <div class="lab">Auswertung</div>${a('ust')}
          <div class="lab">Ausdrucken</div><div class="pc-print" id="pcPrint"></div>
          <div class="lab">Einstellungen</div>${a('wohnungen')}${a('saisons')}${a('preise')}${a('vertrag')}
        </nav>
        <div class="pc-foot"><button class="pc-theme" type="button"></button></div>
      </aside><div class="pc-main"></div>`;
    const app = $('.app');
    app.parentNode.insertBefore(shell, app);
    $('.pc-main').appendChild(app);
    $$('.pc-nav a').forEach(x => { x.href = '#'; x.onclick = e => { e.preventDefault(); pcGo(x.dataset.k); }; });
    // Kopfzeile: Menü-Knopf für schmale Fenster, Untertitel, PDF-Knopf mit Symbol
    const top = $('header.top');
    top.insertAdjacentHTML('afterbegin', `<button class="pc-menu" type="button" aria-label="Menü">${pcIcon('menu')}</button>`);
    $('.pc-menu').onclick = () => $('.pc-side').classList.toggle('open');
    $('#standLine').insertAdjacentHTML('afterend', '<div class="sub" id="pcSub" hidden></div>');
    $('#title').parentElement.style.flex = '1';
    // Monatsübersicht drucken: Monatsfeld und Knopf in die Seitenleiste
    $('#pdfBtn').innerHTML = `${pcIcon('printer')}<span>Monat drucken (PDF)</span>`;
    $('#pcPrint').appendChild($('.pdfbox'));
    // Kalender-Umschalter und Blättern in die Werkzeugleiste über der Tabelle
    const tb = $('#toolbar');
    tb.prepend($('#dock'));
    tb.insertBefore($('#arrows'), $('#summary'));
    $('#prevBtn').textContent = '‹ früher'; $('#nextBtn').textContent = 'später ›';
    tb.insertAdjacentHTML('beforebegin', '<div class="pc-kpis" id="pcKpi" hidden></div>');
    // Sprungmarken der alten Einstellungsseite auf die neuen Menüpunkte umlenken
    document.addEventListener('click', e => {
      const l = e.target.closest('a[href^="#s-"]');
      if (!l) return;
      e.preventDefault();
      const m = { '#s-firm': 'firma', '#s-saison': 'saisons', '#s-ferien': 'saisons' }[l.getAttribute('href')] || 'wohnungen';
      pcGo(m);
    });
    $('.pc-theme').onclick = () => { const d = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); pcTheme(d ? 'light' : 'dark'); };
    let saved = null; try { saved = localStorage.getItem('fewo.theme'); } catch { /* egal */ }
    pcTheme(saved);
    new MutationObserver(pcApply).observe($('#view'), { childList: true });
    pcApply();
  }
  if (MODE === 'admin') initPc();

  load();
  setInterval(load, 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
