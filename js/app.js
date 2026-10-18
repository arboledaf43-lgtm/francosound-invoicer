import * as db from './db.js';
import {
  computeDay, effectiveRate, eventTotals, sortDays, hcpLines, claudeBlock, breakdownText,
  money, fmtHrs, fmtTime, mmddyy, weekday, addDays, daysBetween, todayISO,
} from './pay.js';
import { buildPdf, buildBackup, readBackup, applyBackup, compressImage } from './exports.js';

const $app = document.getElementById('app');
const S = {
  clients: [], events: [],
  settings: { businessName: 'Francosound', timeFormat: '12h', customPositions: [], lastBackupAt: null },
};
const BASE_POSITIONS = ['A1', 'A2', 'Audio Technician'];
const LUNCH_CHIPS = [0, 0.5, 1, 1.5, 2];
const coarse = matchMedia('(pointer: coarse)').matches;

// ---------- helpers

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = (arr, id) => arr.find(x => x.id === id);
const upsert = (arr, v) => { const i = arr.findIndex(x => x.id === v.id); i < 0 ? arr.push(v) : (arr[i] = v); };
const fmtSize = b => b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const positions = () => [...BASE_POSITIONS, ...S.settings.customPositions];
const slug = s => String(s || '').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

const PATHS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 16l5-5 5 5 2-2 4 4"/><circle cx="15.5" cy="9.5" r="1.3"/>',
  file: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/>',
  clip: '<path d="M16 7l-7.5 7.5a2 2 0 0 0 3 3L19 10a4 4 0 0 0-6-6l-7.5 7.5a6 6 0 0 0 8.5 8.5L20 14"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4h12"/><path d="M14 11v6M11 14h6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${PATHS[n]}</svg>`;

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function copyText(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast(label);
}

function download(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}

// On phones, hand files to the share sheet (Save to Files, AirDrop). On PC, download.
async function deliverFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (coarse && navigator.canShare?.({ files: [file] })) {
    const share = () => navigator.share({ files: [file], title: filename });
    try { await share(); return true; }
    catch (e) {
      if (e.name === 'AbortError') return false;
      // Share needs a fresh tap after slow work; offer a button.
      openSheet({
        title: 'File ready', submit: 'Share or save',
        body: `<p class="muted">${esc(filename)} · ${fmtSize(blob.size)}</p>`,
        onSubmit: async () => { try { await share(); } catch (err) { if (err.name !== 'AbortError') download(blob, filename); } },
      });
      return true;
    }
  }
  download(blob, filename);
  return true;
}

// Object URLs for thumbnails, released on each full render.
let objectUrls = [];
const objUrl = blob => { const u = URL.createObjectURL(blob); objectUrls.push(u); return u; };

async function hydrateImages(root = document) {
  for (const img of root.querySelectorAll('img[data-blob]')) {
    const rec = await db.get('blobs', img.dataset.blob);
    if (rec) img.src = objUrl(rec.data); else img.closest('.thumb')?.classList.add('missing');
  }
}

// ---------- state

async function load() {
  [S.clients, S.events] = await Promise.all([db.getAll('clients'), db.getAll('events')]);
  const s = await db.get('meta', 'settings');
  if (s) Object.assign(S.settings, s.value);
}
const saveSettings = () => db.put('meta', { key: 'settings', value: S.settings });
async function saveClient(c) { c.updatedAt = Date.now(); await db.put('clients', c); upsert(S.clients, c); }
async function saveEvent(e) { e.updatedAt = Date.now(); await db.put('events', e); upsert(S.events, e); }

function ctx(e) {
  const client = byId(S.clients, e.clientId) || {};
  const rate = effectiveRate(client, e);
  return { client, rate, totals: eventTotals(e, rate) };
}

const eventSortKey = e => sortDays(e.days).at(-1)?.date || new Date(e.createdAt || 0).toISOString();

function dateRange(e) {
  const d = sortDays(e.days);
  if (!d.length) return 'No days yet';
  const a = mmddyy(d[0].date), b = mmddyy(d.at(-1).date);
  return a === b ? a : `${a} – ${b}`;
}

function statusPill(e) {
  if (e.status === 'paid') return `<span class="pill paid">${ic('check')} Paid${e.paidDate ? ' ' + mmddyy(e.paidDate) : ''}</span>`;
  if (e.status === 'invoiced') return `<span class="pill inv">Invoiced${e.invoiceNumber ? ' #' + esc(e.invoiceNumber) : ''}${e.invoiceDate ? ' · ' + mmddyy(e.invoiceDate) : ''}</span>`;
  return '<span class="pill">Draft</span>';
}

const rateText = r => `${money(r.dayRate)}/day · ${money(r.otAfter ? r.dayRate / r.otAfter : 0)}/hr · OT after ${fmtHrs(r.otAfter)}h${r.dtAfter ? ` · DT after ${fmtHrs(r.dtAfter)}h` : ''}`;

// ---------- layout

function header({ title, back, kicker = '', right = '' }) {
  return `<header class="top">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Back">${ic('back')}</a>` : '<span class="logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>'}
    <div class="top-title">${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}<h1>${esc(title)}</h1></div>
    <div class="top-right">${right}</div>
  </header>`;
}

function render(head, main) {
  objectUrls.forEach(u => URL.revokeObjectURL(u));
  objectUrls = [];
  $app.innerHTML = `${head}<main>${main}</main>`;
  hydrateImages($app);
}

const field = (label, input, hint = '') =>
  `<label class="field"><span>${label}</span>${input}${hint ? `<small>${hint}</small>` : ''}</label>`;
const val = v => esc(v ?? '');

// ---------- sheets (modal forms)

function closeSheets() {
  document.querySelectorAll('.sheet-wrap').forEach(w => w.remove());
  document.body.classList.remove('noscroll');
}

function openSheet({ title, body, submit = 'Save', onSubmit, danger, onDanger }) {
  closeSheets();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><form novalidate>
    <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ic('x')}</button></div>
    <div class="sheet-body">${body}</div>
    <p class="err" hidden></p>
    ${onSubmit ? `<button class="btn primary" type="submit">${esc(submit)}</button>` : ''}
    ${onDanger ? `<button class="btn danger" type="button" data-danger>${esc(danger)}</button>` : ''}
  </form></div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('noscroll');
  const form = wrap.querySelector('form'), err = wrap.querySelector('.err');
  const fail = msg => { err.textContent = msg; err.hidden = false; };
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-close]')) closeSheets(); });
  form.addEventListener('input', e => { e.target.classList?.remove('invalid'); err.hidden = true; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!onSubmit) return;
    const bad = [...form.elements].find(el => el.willValidate && !el.checkValidity());
    if (bad) { bad.classList.add('invalid'); bad.focus(); return fail(bad.dataset.msg || 'Check the highlighted field.'); }
    try { if (await onSubmit(Object.fromEntries(new FormData(form)), form) !== false) closeSheets(); }
    catch (x) { console.error(x); fail(x.message); }
  });
  wrap.querySelector('[data-danger]')?.addEventListener('click', async () => {
    try { if (await onDanger() !== false) closeSheets(); } catch (x) { fail(x.message); }
  });
  if (!coarse) setTimeout(() => form.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea')?.focus(), 50);
  return { wrap, form, fail };
}

// ---------- views

function viewHome() {
  const q = '';
  const stale = (S.clients.length || S.events.length) &&
    (!S.settings.lastBackupAt || Date.now() - S.settings.lastBackupAt > 7 * 864e5);
  const clients = [...S.clients].sort((a, b) => (a.company || '').localeCompare(b.company || ''));
  const cards = clients.map(c => {
    const evs = S.events.filter(e => e.clientId === c.id);
    const drafts = evs.filter(e => !e.status || e.status === 'draft');
    const unbilled = drafts.reduce((s, e) => s + ctx(e).totals.total, 0);
    const awaiting = evs.filter(e => e.status === 'invoiced');
    return `<a class="card client-card" href="#/client/${c.id}" data-search="${esc(`${c.company} ${c.contactName || ''}`.toLowerCase())}">
      <div class="row-b"><b>${esc(c.company)}</b><span>${money(c.dayRate)}/day</span></div>
      <div class="muted">OT after ${fmtHrs(c.otAfter)}h${c.dtAfter ? ` · DT after ${fmtHrs(c.dtAfter)}h` : ''} · ${plural(evs.length, 'event')}</div>
      ${drafts.length || awaiting.length ? `<div class="pills">
        ${drafts.length ? `<span class="pill">${drafts.length} unbilled · ${money(unbilled)}</span>` : ''}
        ${awaiting.length ? `<span class="pill inv">${awaiting.length} awaiting payment</span>` : ''}</div>` : ''}
    </a>`;
  }).join('');

  render(
    header({ title: 'Clients', kicker: (S.settings.businessName || 'Francosound').toUpperCase(), right: `<a class="icon-btn" href="#/settings" aria-label="Settings and backup">${ic('settings')}</a>` }),
    `${stale ? `<a class="banner" href="#/settings">${ic('download')}<span>${S.settings.lastBackupAt ? `Last backup ${new Date(S.settings.lastBackupAt).toLocaleDateString()}` : 'No backup yet'}. Back up now</span></a>` : ''}
    ${clients.length > 4 ? `<label class="search">${ic('search')}<input type="search" placeholder="Search clients" data-filter=".client-card" value="${q}" aria-label="Search clients"></label>` : ''}
    ${cards || `<div class="empty"><h2>Add your first client</h2><p class="muted">Each client keeps its own day rate and overtime rules.</p></div>`}
    <button class="btn primary" data-act="new-client">${ic('plus')} New client</button>`,
  );
}

function viewClient(id) {
  const c = byId(S.clients, id);
  if (!c) return go('#/');
  const evs = S.events.filter(e => e.clientId === id).sort((a, b) => eventSortKey(b).localeCompare(eventSortKey(a)));
  const contact = [
    c.contactName && esc(c.contactName),
    c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`,
    c.phone && `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>`,
  ].filter(Boolean).join(' · ');
  render(
    header({ title: c.company, back: '#/', right: `<button class="icon-btn" data-act="edit-client" data-id="${id}" aria-label="Edit client">${ic('edit')}</button>` }),
    `<div class="info">
      ${contact ? `<div>${contact}</div>` : ''}
      <div class="muted">${rateText(effectiveRate(c, {}))}</div>
      ${c.notes ? `<div class="muted notes">${esc(c.notes)}</div>` : ''}
    </div>
    <h2 class="section">Events</h2>
    ${evs.map(e => {
      const { totals } = ctx(e);
      return `<a class="card" href="#/event/${e.id}">
        <div class="row-b"><b>${esc(e.name)}</b><b>${money(totals.total)}</b></div>
        <div class="muted">${e.jobNumber ? `#${esc(e.jobNumber)} · ` : ''}${esc(e.position)} · ${plural(totals.days, 'day')} · ${dateRange(e)}</div>
        <div class="pills">${statusPill(e)}</div>
      </a>`;
    }).join('') || `<div class="empty"><h2>No events yet</h2><p class="muted">Create an event for each show or job number.</p></div>`}
    <button class="btn primary" data-act="new-event" data-id="${id}">${ic('plus')} New event</button>
    ${evs.length ? `<button class="btn" data-act="dup-pick" data-id="${id}">${ic('dup')} Duplicate a past event</button>` : ''}`,
  );
}

async function viewEvent(id) {
  const e = byId(S.events, id);
  if (!e) return go('#/');
  const { client, rate, totals } = ctx(e);
  const files = (await Promise.all((e.fileIds || []).map(f => db.get('blobs', f)))).filter(Boolean);
  if (location.hash !== `#/event/${id}`) return; // navigated away while loading

  const days = totals.rows.map(({ day: d, calc }) => `<a class="card" href="#/event/${e.id}/day/${d.id}">
    <div class="row-b"><b>${weekday(d.date)} ${mmddyy(d.date)}</b><b>${calc.complete ? money(calc.total) : '—'}</b></div>
    ${calc.complete
      ? `<div class="muted">${fmtTime(d.clockIn, S.settings.timeFormat)} → ${fmtTime(d.clockOut, S.settings.timeFormat)}${calc.overnight ? ' (+1)' : ''} · lunch ${fmtHrs(d.lunch)}h · ${fmtHrs(calc.worked)}h${calc.worked < rate.otAfter ? ' (min day)' : ''}</div>
         <div class="muted small">${breakdownText(calc)}</div>`
      : '<div class="muted warn">Times not entered</div>'}
    ${d.photoIds?.length ? `<div class="small meta">${ic('image')} ${plural(d.photoIds.length, 'photo')}</div>` : ''}
  </a>`).join('');

  render(
    header({ title: e.name, kicker: client.company, back: `#/client/${e.clientId}`, right: `<button class="icon-btn" data-act="event-menu" data-id="${id}" aria-label="Event options">${ic('dots')}</button>` }),
    `<div class="total-card">
      <div class="row-b small"><span>${e.jobNumber ? `#${esc(e.jobNumber)} · ` : ''}${esc(e.position)} · ${plural(totals.days, 'day')}</span><button class="status-btn" data-act="event-status" data-id="${id}" aria-label="Invoice status: ${esc(e.status || 'draft')}">${statusPill(e)}</button></div>
      <div class="big">${money(totals.total)}</div>
      <div class="small">${fmtHrs(totals.worked)}h worked · OT ${fmtHrs(totals.ot)}h · DT ${fmtHrs(totals.dt)}h</div>
      <div class="small dim">${rateText(rate)}${rate.overridden ? ' · event rate' : ''}</div>
    </div>
    ${totals.incomplete ? `<p class="warn small">${plural(totals.incomplete, 'day')} without times ${totals.incomplete === 1 ? "isn't" : "aren't"} counted yet.</p>` : ''}
    <h2 class="section">Days</h2>
    ${days || '<p class="muted">Add a day for each date you worked.</p>'}
    <button class="btn" data-act="add-day" data-id="${id}">${ic('plus')} Add day</button>

    <h2 class="section">Files</h2>
    ${files.map(f => `<div class="file-row">
      <button class="file-open" data-act="file-open" data-blob="${f.id}">${ic('file')}<span><b>${esc(f.name)}</b><small class="muted">${fmtSize(f.size || f.data?.size || 0)}</small></span></button>
      <button class="icon-btn" data-act="file-delete" data-blob="${f.id}" data-event="${id}" aria-label="Delete ${esc(f.name)}">${ic('trash')}</button>
    </div>`).join('') || '<p class="muted small">Plots, input lists, advance sheets. Files are kept when you duplicate the event.</p>'}
    <label class="btn">${ic('clip')} Add files<input type="file" multiple hidden data-upload="file" data-event="${id}"></label>
    ${e.notes ? `<h2 class="section">Notes</h2><p class="muted notes">${esc(e.notes)}</p>` : ''}

    <a class="btn primary" href="#/event/${id}/export">${ic('receipt')} Export / invoice</a>`,
  );
}

function calcHtml(calc, rate) {
  if (!calc.complete) return '<p class="muted">Enter clock-in and clock-out to calculate.</p>';
  return `<div class="calc-rows">
    <div class="row-b"><span>Hours worked</span><b>${fmtHrs(calc.worked)}h${calc.overnight ? ' (past midnight)' : ''}</b></div>
    <div class="row-b"><span>Day rate${calc.worked < rate.otAfter ? ' (minimum)' : ` (first ${fmtHrs(rate.otAfter)}h)`}</span><span>${money(calc.dayPay)}</span></div>
    ${calc.ot > 0 ? `<div class="row-b"><span>OT ${fmtHrs(calc.ot)}h × ${money(calc.otRate)}</span><span>${money(calc.otPay)}</span></div>` : ''}
    ${calc.dt > 0 ? `<div class="row-b"><span>DT ${fmtHrs(calc.dt)}h × ${money(calc.dtRate)}</span><span>${money(calc.dtPay)}</span></div>` : ''}
    <div class="row-b total"><span>Day total</span><b>${money(calc.total)}</b></div>
  </div>`;
}

function viewDay(eid, did) {
  const e = byId(S.events, eid);
  const d = e?.days.find(x => x.id === did);
  if (!d) return go(e ? `#/event/${eid}` : '#/');
  const { rate } = ctx(e);
  const lunchIsChip = LUNCH_CHIPS.includes(+d.lunch);
  render(
    header({ title: `${weekday(d.date)} ${mmddyy(d.date)}`, kicker: e.name, back: `#/event/${eid}` }),
    `<div class="day-form" data-event="${eid}" data-day="${did}">
      ${field('Date', `<input type="date" data-day-field="date" value="${val(d.date)}" required>`)}
      <div class="time-row">
        ${field('Clock-in', `<input type="time" data-day-field="clockIn" value="${val(d.clockIn)}">`)}
        <button class="btn now" data-act="now" data-field="clockIn">${ic('clock')} Now</button>
      </div>
      <div class="time-row">
        ${field('Clock-out', `<input type="time" data-day-field="clockOut" value="${val(d.clockOut)}">`)}
        <button class="btn now" data-act="now" data-field="clockOut">${ic('clock')} Now</button>
      </div>
      <div class="field"><span>Lunch</span>
        <div class="chips">
          ${LUNCH_CHIPS.map(h => `<button class="chip ${+d.lunch === h ? 'on' : ''}" data-act="lunch" data-h="${h}">${h ? `${fmtHrs(h)}h` : 'None'}</button>`).join('')}
          <input class="chip-input ${lunchIsChip ? '' : 'on'}" type="number" inputmode="decimal" min="0" step="0.25" data-day-field="lunch" value="${lunchIsChip ? '' : val(d.lunch)}" placeholder="Other" aria-label="Other lunch length in hours">
        </div>
      </div>
    </div>
    <div class="calc" id="calc">${calcHtml(computeDay(d, rate), rate)}</div>

    <h2 class="section">Clock-in photos</h2>
    <div class="thumbs">${(d.photoIds || []).map(p => `<button class="thumb" data-act="photo" data-blob="${p}" data-event="${eid}" data-day="${did}" aria-label="View photo"><img data-blob="${p}" alt=""></button>`).join('')}</div>
    <div class="two">
      <label class="btn">${ic('camera')} Take photo<input type="file" accept="image/*" capture="environment" hidden data-upload="photo" data-event="${eid}" data-day="${did}"></label>
      <label class="btn">${ic('image')} Upload<input type="file" accept="image/*" multiple hidden data-upload="photo" data-event="${eid}" data-day="${did}"></label>
    </div>
    <button class="btn danger" data-act="delete-day" data-event="${eid}" data-day="${did}">${ic('trash')} Delete day</button>`,
  );
}

function viewExport(id) {
  const e = byId(S.events, id);
  if (!e) return go('#/');
  const { client, rate, totals } = ctx(e);
  const lines = hcpLines(e, rate, S.settings.timeFormat);
  const copyBtn = (text, label) => `<button class="copy" data-act="copy" data-text="${esc(text)}" aria-label="Copy ${label}">${ic('copy')}</button>`;
  render(
    header({ title: 'Housecall Pro guide', kicker: e.name, back: `#/event/${id}` }),
    `<div class="info">
      <div class="row-b"><span class="muted">Customer</span><span>${esc(client.company)} ${copyBtn(client.company, 'customer')}</span></div>
      <div class="row-b"><span class="muted">Job #</span><span>${esc(e.jobNumber || '—')} ${e.jobNumber ? copyBtn(e.jobNumber, 'job number') : ''}</span></div>
    </div>
    ${totals.incomplete ? `<p class="warn small">${plural(totals.incomplete, 'day')} without times ${totals.incomplete === 1 ? 'is' : 'are'} left off the invoice.</p>` : ''}
    <h2 class="section">Line items · tick as you enter them</h2>
    ${lines.map((l, i) => `<div class="card line">
      <label class="tick"><input type="checkbox" aria-label="Line ${i + 1} entered"><span></span></label>
      <div class="line-body">
        <div class="kv"><small class="muted">Name</small><div class="row-b"><b>${esc(l.name)}</b>${copyBtn(l.name, 'name')}</div></div>
        <div class="kv"><small class="muted">Description</small><div class="row-b"><span>${esc(l.desc)}</span>${copyBtn(l.desc, 'description')}</div></div>
        <div class="kv"><small class="muted">Qty 1.0 · Unit price</small><div class="row-b"><b>${money(l.price)}</b>${copyBtn(l.price.toFixed(2), 'unit price')}</div></div>
      </div>
    </div>`).join('') || '<p class="muted">Enter clock-in and clock-out on at least one day first.</p>'}
    <div class="row-b grand"><span>Invoice total</span><b>${money(totals.total)}</b></div>

    <button class="btn primary" data-act="copy-claude" data-id="${id}">${ic('spark')} Copy for Claude in Chrome</button>
    <div class="two">
      <button class="btn" data-act="pdf" data-id="${id}">${ic('file')} PDF summary</button>
      <button class="btn" data-act="event-status" data-id="${id}">${ic('receipt')} ${e.status === 'draft' || !e.status ? 'Mark invoiced' : 'Update status'}</button>
    </div>
    <details class="preview"><summary>Preview the Claude in Chrome instructions</summary><pre>${esc(claudeBlock({ client, event: e, lines }))}</pre></details>`,
  );
}

async function viewSettings() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  if (location.hash !== '#/settings') return;
  const s = S.settings;
  render(
    header({ title: 'Settings and backup', back: '#/' }),
    `<h2 class="section">Backup</h2>
    <div class="info">
      <div>${s.lastBackupAt ? `Last backup ${new Date(s.lastBackupAt).toLocaleString()}` : 'No backup yet'}</div>
      <div class="muted small">One zip with all clients, events, photos and files. To move work from your iPhone to your PC, back up on the phone, then restore with Merge on the PC (and the other way round).</div>
    </div>
    <button class="btn primary" data-act="backup">${ic('download')} Back up now</button>
    <label class="btn">${ic('upload')} Restore from backup<input type="file" accept=".zip,application/zip" hidden data-restore></label>

    <h2 class="section">Invoices</h2>
    ${field('Business name', `<input data-setting="businessName" value="${val(s.businessName)}">`, 'Shown at the top of PDF summaries.')}
    <div class="field"><span>Time format on invoices</span><div class="chips">
      <button class="chip ${s.timeFormat === '12h' ? 'on' : ''}" data-act="time-format" data-v="12h">8:00AM</button>
      <button class="chip ${s.timeFormat === '24h' ? 'on' : ''}" data-act="time-format" data-v="24h">08:00</button>
    </div></div>
    <div class="field"><span>Custom positions</span>
      ${s.customPositions.length ? `<div class="chips">${s.customPositions.map(p => `<button class="chip on" data-act="remove-position" data-v="${esc(p)}" aria-label="Remove ${esc(p)}">${esc(p)} ${ic('x')}</button>`).join('')}</div>` : '<small>Add one by choosing "Custom" when you create an event.</small>'}
    </div>

    <h2 class="section">This device</h2>
    <div class="info small">
      <div>${est ? `Using ${fmtSize(est.usage || 0)} of storage.` : ''} ${persisted ? 'Storage is protected from automatic clearing.' : 'Install the app to your home screen so the browser keeps your data.'}</div>
      <div class="muted">iPhone: open in Safari, tap Share, then Add to Home Screen. PC: in Chrome, use the install icon in the address bar.</div>
    </div>`,
  );
}

// ---------- routing

const go = h => { if (location.hash !== h) location.hash = h; else route(); };

function route() {
  closeSheets();
  const [a, b, c, d] = (location.hash.slice(2) || '').split('/');
  window.scrollTo(0, 0);
  if (a === 'client') return viewClient(b);
  if (a === 'event' && c === 'day') return viewDay(b, d);
  if (a === 'event' && c === 'export') return viewExport(b);
  if (a === 'event') return viewEvent(b);
  if (a === 'settings') return viewSettings();
  return viewHome();
}

async function rerender() {
  const y = window.scrollY;
  const [a, b, c, d] = (location.hash.slice(2) || '').split('/');
  if (a === 'event' && c === 'day') viewDay(b, d);
  else if (a === 'event' && !c) await viewEvent(b);
  else if (a === 'settings') await viewSettings();
  else route();
  window.scrollTo(0, y);
}

// ---------- forms

function clientForm(c = {}) {
  const isNew = !c.id;
  openSheet({
    title: isNew ? 'New client' : 'Edit client',
    submit: isNew ? 'Create client' : 'Save',
    body: `
      ${field('Company name', `<input name="company" required data-msg="Enter a company name." value="${val(c.company)}" autocomplete="organization" placeholder="Clair Global">`)}
      ${field('Contact name', `<input name="contactName" value="${val(c.contactName)}" autocomplete="name">`)}
      <div class="two">
        ${field('Email', `<input name="email" type="email" inputmode="email" value="${val(c.email)}" data-msg="Enter a valid email.">`)}
        ${field('Phone', `<input name="phone" type="tel" value="${val(c.phone)}">`)}
      </div>
      ${field('Billing address', `<textarea name="address" rows="2">${val(c.address)}</textarea>`)}
      <div class="three">
        ${field('Day rate ($)', `<input name="dayRate" type="number" inputmode="decimal" min="0" step="0.01" required data-msg="Enter a day rate." value="${val(c.dayRate)}" placeholder="500">`)}
        ${field('OT after (h)', `<input name="otAfter" type="number" inputmode="decimal" min="1" step="0.25" required data-msg="Enter the hours before OT starts." value="${val(c.otAfter ?? 10)}">`)}
        ${field('DT after (h)', `<input name="dtAfter" type="number" inputmode="decimal" min="1" step="0.25" value="${val(c.dtAfter)}" placeholder="None">`)}
      </div>
      ${field('Notes', `<textarea name="notes" rows="2">${val(c.notes)}</textarea>`)}`,
    onSubmit: async d => {
      if (d.dtAfter && +d.dtAfter <= +d.otAfter) throw new Error('DT after must be more hours than OT after.');
      const rec = {
        ...c, id: c.id || db.uid(), createdAt: c.createdAt || Date.now(),
        company: d.company.trim(), contactName: d.contactName.trim(), email: d.email.trim(), phone: d.phone.trim(),
        address: d.address.trim(), dayRate: +d.dayRate, otAfter: +d.otAfter, dtAfter: d.dtAfter ? +d.dtAfter : null, notes: d.notes.trim(),
      };
      await saveClient(rec);
      isNew ? go(`#/client/${rec.id}`) : rerender();
    },
    danger: 'Delete client',
    onDanger: isNew ? null : async () => {
      const evs = S.events.filter(e => e.clientId === c.id);
      if (!confirm(`Delete ${c.company}${evs.length ? ` and its ${plural(evs.length, 'event')}, photos and files` : ''}? This can't be undone.`)) return false;
      for (const e of evs) await deleteEvent(e);
      await db.del('clients', c.id);
      S.clients = S.clients.filter(x => x.id !== c.id);
      go('#/');
    },
  });
}

function positionField(current) {
  const opts = positions();
  const custom = current && !opts.includes(current);
  return `<label class="field"><span>Position</span>
    <select name="position" data-position>
      ${opts.map(p => `<option ${p === current ? 'selected' : ''}>${esc(p)}</option>`).join('')}
      <option value="__custom" ${custom ? 'selected' : ''}>Custom…</option>
    </select></label>
    <label class="field" data-custom ${custom ? '' : 'hidden'}><span>Custom position</span><input name="customPosition" value="${custom ? val(current) : ''}" placeholder="Monitor engineer"></label>`;
}

function wirePosition(form) {
  const sel = form.querySelector('[data-position]'), box = form.querySelector('[data-custom]');
  sel.addEventListener('change', () => { box.hidden = sel.value !== '__custom'; if (!box.hidden) box.querySelector('input').focus(); });
}

async function resolvePosition(d) {
  if (d.position !== '__custom') return d.position;
  const p = (d.customPosition || '').trim();
  if (!p) throw new Error('Enter the custom position.');
  if (!positions().includes(p)) { S.settings.customPositions.push(p); await saveSettings(); }
  return p;
}

function eventForm(clientId, e = {}) {
  const isNew = !e.id;
  const client = byId(S.clients, clientId);
  const o = e.override || {};
  const { form } = openSheet({
    title: isNew ? 'New event' : 'Edit event',
    submit: isNew ? 'Create event' : 'Save',
    body: `
      ${field('Event name', `<input name="name" required data-msg="Enter an event name." value="${val(e.name)}" placeholder="Fall Tour – Chicago">`)}
      <div class="two">
        ${field('Job number', `<input name="jobNumber" value="${val(e.jobNumber)}" inputmode="numeric" placeholder="24817">`)}
        <div>${positionField(e.position || 'A1')}</div>
      </div>
      <label class="check"><input type="checkbox" name="ovEnabled" ${o.enabled ? 'checked' : ''}> This job pays a different rate</label>
      <div class="three" data-ov ${o.enabled ? '' : 'hidden'}>
        ${field('Day rate ($)', `<input name="ovDayRate" type="number" inputmode="decimal" min="0" step="0.01" value="${val(o.dayRate)}" placeholder="${val(client.dayRate)}">`)}
        ${field('OT after (h)', `<input name="ovOtAfter" type="number" inputmode="decimal" min="1" step="0.25" value="${val(o.otAfter)}" placeholder="${val(client.otAfter)}">`)}
        ${field('DT after (h)', `<input name="ovDtAfter" type="number" inputmode="decimal" min="1" step="0.25" value="${val(o.dtAfter)}" placeholder="${val(client.dtAfter ?? 'None')}">`)}
      </div>
      ${field('Notes', `<textarea name="notes" rows="2">${val(e.notes)}</textarea>`)}`,
    onSubmit: async d => {
      const rec = {
        days: [], fileIds: [], status: 'draft', ...e,
        id: e.id || db.uid(), clientId, createdAt: e.createdAt || Date.now(),
        name: d.name.trim(), jobNumber: d.jobNumber.trim(), position: await resolvePosition(d), notes: d.notes.trim(),
        override: { enabled: !!d.ovEnabled, dayRate: d.ovDayRate, otAfter: d.ovOtAfter, dtAfter: d.ovDtAfter },
      };
      await saveEvent(rec);
      isNew ? go(`#/event/${rec.id}`) : rerender();
    },
  });
  wirePosition(form);
  const ov = form.querySelector('[data-ov]');
  form.ovEnabled.addEventListener('change', () => { ov.hidden = !form.ovEnabled.checked; });
}

function statusForm(e) {
  const { form } = openSheet({
    title: 'Invoice status',
    body: `
      <div class="chips seg">${['draft', 'invoiced', 'paid'].map(s => `<label class="chip ${(e.status || 'draft') === s ? 'on' : ''}"><input type="radio" name="status" value="${s}" ${(e.status || 'draft') === s ? 'checked' : ''}>${s[0].toUpperCase() + s.slice(1)}</label>`).join('')}</div>
      <div class="two">
        ${field('Invoice #', `<input name="invoiceNumber" value="${val(e.invoiceNumber)}" inputmode="numeric">`)}
        ${field('Invoice date', `<input name="invoiceDate" type="date" value="${val(e.invoiceDate)}">`)}
      </div>
      ${field('Paid date', `<input name="paidDate" type="date" value="${val(e.paidDate)}">`)}`,
    onSubmit: async d => {
      Object.assign(e, { status: d.status, invoiceNumber: d.invoiceNumber.trim(), invoiceDate: d.invoiceDate, paidDate: d.paidDate });
      if (d.status !== 'draft' && !e.invoiceDate) e.invoiceDate = todayISO();
      if (d.status === 'paid' && !e.paidDate) e.paidDate = todayISO();
      await saveEvent(e);
      toast('Status saved');
      rerender();
    },
  });
  form.addEventListener('change', ev => {
    if (ev.target.name !== 'status') return;
    form.querySelectorAll('.seg .chip').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
    if (ev.target.value !== 'draft' && !form.invoiceDate.value) form.invoiceDate.value = todayISO();
    if (ev.target.value === 'paid' && !form.paidDate.value) form.paidDate.value = todayISO();
  });
}

function duplicateForm(src) {
  const first = sortDays(src.days)[0]?.date;
  openSheet({
    title: 'Duplicate event',
    submit: 'Duplicate',
    body: `<p class="muted small">Copies the position, rate, notes and ${plural((src.fileIds || []).length, 'file')}. Creates ${plural(src.days.length || 1, 'day')} starting on the new date. Photos and invoice status start fresh.</p>
      ${field('Event name', `<input name="name" required data-msg="Enter an event name." value="${val(src.name)}">`)}
      ${field('Job number', `<input name="jobNumber" value="${val(src.jobNumber)}" inputmode="numeric">`, 'Change it if the new show has a new job number.')}
      ${field('First day', `<input name="firstDate" type="date" required data-msg="Pick the first day." value="${first ? addDays(first, 364) : todayISO()}">`, first ? `Last time started ${mmddyy(first)}.` : '')}
      <label class="check"><input type="checkbox" name="copyTimes"> Prefill clock times from last time</label>`,
    onSubmit: async d => {
      const fileIds = [];
      for (const fid of src.fileIds || []) {
        const b = await db.get('blobs', fid);
        if (b) { const nb = { ...b, id: db.uid(), created: Date.now() }; await db.put('blobs', nb); fileIds.push(nb.id); }
      }
      const srcDays = sortDays(src.days);
      const off = first ? daysBetween(first, d.firstDate) : 0;
      const days = (srcDays.length ? srcDays : [{}]).map(x => ({
        id: db.uid(), date: x.date ? addDays(x.date, off) : d.firstDate,
        clockIn: d.copyTimes ? x.clockIn || '' : '', clockOut: d.copyTimes ? x.clockOut || '' : '',
        lunch: x.lunch ?? 1, photoIds: [], updatedAt: Date.now(),
      }));
      const rec = {
        id: db.uid(), clientId: src.clientId, createdAt: Date.now(), name: d.name.trim(), jobNumber: d.jobNumber.trim(),
        position: src.position, override: { ...(src.override || {}) }, notes: src.notes || '', status: 'draft', days, fileIds,
      };
      await saveEvent(rec);
      toast('Event duplicated');
      go(`#/event/${rec.id}`);
    },
  });
}

async function deleteEvent(e) {
  for (const id of [...(e.fileIds || []), ...e.days.flatMap(d => d.photoIds || [])]) await db.del('blobs', id);
  await db.del('events', e.id);
  S.events = S.events.filter(x => x.id !== e.id);
}

// ---------- day editing

function dayRef(el) {
  const box = el.closest('[data-event][data-day]') || document.querySelector('.day-form');
  const e = byId(S.events, box.dataset.event);
  return { e, d: e.days.find(x => x.id === box.dataset.day) };
}

async function updateDay(el, patch) {
  const { e, d } = dayRef(el);
  Object.assign(d, patch, { updatedAt: Date.now() });
  await saveEvent(e);
  const { rate } = ctx(e);
  document.getElementById('calc').innerHTML = calcHtml(computeDay(d, rate), rate);
  document.querySelector('.top h1').textContent = `${weekday(d.date)} ${mmddyy(d.date)}`;
  document.querySelectorAll('[data-act=lunch]').forEach(b => b.classList.toggle('on', +b.dataset.h === +d.lunch));
  document.querySelector('.chip-input').classList.toggle('on', !LUNCH_CHIPS.includes(+d.lunch));
}

function onDayField(input) {
  const f = input.dataset.dayField;
  if ((f === 'date' || f === 'lunch') && input.value === '') return;
  updateDay(input, { [f]: f === 'lunch' ? Math.max(0, +input.value || 0) : input.value });
}

// ---------- uploads

async function handleUpload(ds, files) {
  const e = byId(S.events, ds.event);
  if (!e) return;
  if (ds.upload === 'photo') {
    const d = e.days.find(x => x.id === ds.day);
    toast(`Adding ${plural(files.length, 'photo')}…`);
    for (const f of files) {
      const data = await compressImage(f);
      const id = db.uid();
      await db.put('blobs', { id, kind: 'photo', name: `photo-${d.date}-${(d.photoIds || []).length + 1}.jpg`, type: data.type, size: data.size, created: Date.now(), data });
      (d.photoIds ||= []).push(id);
    }
    d.updatedAt = Date.now();
  } else {
    for (const f of files) {
      const id = db.uid();
      await db.put('blobs', { id, kind: 'file', name: f.name, type: f.type, size: f.size, created: Date.now(), data: f });
      (e.fileIds ||= []).push(id);
    }
  }
  await saveEvent(e);
  toast(`Added ${plural(files.length, ds.upload === 'photo' ? 'photo' : 'file')}`);
  rerender();
}

async function showPhoto(el) {
  const rec = await db.get('blobs', el.dataset.blob);
  if (!rec) return;
  const url = objUrl(rec.data);
  openSheet({
    title: rec.name,
    body: `<img class="photo-full" src="${url}" alt="Clock-in photo">
      <button type="button" class="btn" data-act="save-blob" data-blob="${rec.id}">${ic('download')} Save photo</button>`,
    danger: 'Delete photo',
    onDanger: async () => {
      if (!confirm('Delete this photo?')) return false;
      const e = byId(S.events, el.dataset.event), d = e.days.find(x => x.id === el.dataset.day);
      d.photoIds = d.photoIds.filter(p => p !== rec.id);
      d.updatedAt = Date.now();
      await db.del('blobs', rec.id);
      await saveEvent(e);
      rerender();
    },
  });
}

// ---------- actions

const actions = {
  'new-client': () => clientForm(),
  'edit-client': el => clientForm(byId(S.clients, el.dataset.id)),
  'new-event': el => eventForm(el.dataset.id),
  'event-status': el => statusForm(byId(S.events, el.dataset.id)),
  'event-menu': el => {
    const e = byId(S.events, el.dataset.id);
    openSheet({
      title: e.name,
      body: `<div class="menu">
        <button type="button" class="btn" data-act="edit-event" data-id="${e.id}">${ic('edit')} Edit event</button>
        <button type="button" class="btn" data-act="event-status" data-id="${e.id}">${ic('receipt')} Invoice status</button>
        <button type="button" class="btn" data-act="dup-event" data-id="${e.id}">${ic('dup')} Duplicate for a new date</button>
        <button type="button" class="btn danger" data-act="delete-event" data-id="${e.id}">${ic('trash')} Delete event</button>
      </div>`,
    });
  },
  'edit-event': el => { const e = byId(S.events, el.dataset.id); eventForm(e.clientId, e); },
  'dup-event': el => duplicateForm(byId(S.events, el.dataset.id)),
  'dup-pick': el => {
    const evs = S.events.filter(e => e.clientId === el.dataset.id).sort((a, b) => eventSortKey(b).localeCompare(eventSortKey(a)));
    openSheet({
      title: 'Duplicate which event?',
      body: `<div class="menu">${evs.map(e => `<button type="button" class="btn left" data-act="dup-event" data-id="${e.id}"><span><b>${esc(e.name)}</b><small class="muted">${e.jobNumber ? `#${esc(e.jobNumber)} · ` : ''}${esc(e.position)} · ${dateRange(e)}</small></span></button>`).join('')}</div>`,
    });
  },
  'delete-event': async el => {
    const e = byId(S.events, el.dataset.id);
    if (!confirm(`Delete "${e.name}" with its days, photos and files? This can't be undone.`)) return;
    closeSheets();
    await deleteEvent(e);
    go(`#/client/${e.clientId}`);
  },
  'add-day': async el => {
    const e = byId(S.events, el.dataset.id);
    const last = sortDays(e.days).at(-1);
    const d = { id: db.uid(), date: last ? addDays(last.date, 1) : todayISO(), clockIn: '', clockOut: '', lunch: last?.lunch ?? 1, photoIds: [], updatedAt: Date.now() };
    e.days.push(d);
    await saveEvent(e);
    go(`#/event/${e.id}/day/${d.id}`);
  },
  'delete-day': async el => {
    const { e, d } = dayRef(el);
    if (!confirm(`Delete ${mmddyy(d.date)}${d.photoIds?.length ? ` and its ${plural(d.photoIds.length, 'photo')}` : ''}?`)) return;
    for (const p of d.photoIds || []) await db.del('blobs', p);
    e.days = e.days.filter(x => x.id !== d.id);
    await db.tombstone(d.id, 'days');
    await saveEvent(e);
    go(`#/event/${e.id}`);
  },
  now: el => {
    const input = document.querySelector(`[data-day-field="${el.dataset.field}"]`);
    const n = new Date();
    input.value = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    onDayField(input);
  },
  lunch: el => {
    document.querySelector('[data-day-field="lunch"]').value = '';
    updateDay(el, { lunch: +el.dataset.h });
  },
  photo: el => showPhoto(el),
  'save-blob': async el => { const r = await db.get('blobs', el.dataset.blob); if (r) deliverFile(r.data, r.name); },
  'file-open': async el => {
    const r = await db.get('blobs', el.dataset.blob);
    if (!r) return;
    const url = URL.createObjectURL(r.data);
    if (!window.open(url, '_blank')) download(r.data, r.name);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  'file-delete': async el => {
    const e = byId(S.events, el.dataset.event);
    const r = await db.get('blobs', el.dataset.blob);
    if (!confirm(`Delete ${r?.name || 'this file'}?`)) return;
    e.fileIds = e.fileIds.filter(f => f !== el.dataset.blob);
    await db.del('blobs', el.dataset.blob);
    await saveEvent(e);
    rerender();
  },
  copy: el => copyText(el.dataset.text),
  'copy-claude': el => {
    const e = byId(S.events, el.dataset.id);
    const { client, rate } = ctx(e);
    const lines = hcpLines(e, rate, S.settings.timeFormat);
    if (!lines.length) return toast('Add times to at least one day first');
    copyText(claudeBlock({ client, event: e, lines }), 'Copied. Paste it into Claude in Chrome');
  },
  pdf: async el => {
    const e = byId(S.events, el.dataset.id);
    const c = ctx(e);
    toast('Building PDF…');
    try {
      const blob = await buildPdf({ event: e, ...c, settings: S.settings });
      await deliverFile(blob, `${slug(e.jobNumber ? `${e.jobNumber}-${e.name}` : e.name)}-summary.pdf`);
    } catch (x) { console.error(x); toast(x.message); }
  },
  backup: async () => {
    toast('Building backup…');
    try {
      const blob = await buildBackup();
      if (await deliverFile(blob, `francosound-backup-${todayISO()}.zip`)) {
        S.settings.lastBackupAt = Date.now();
        await saveSettings();
        rerender();
      }
    } catch (x) { console.error(x); toast(x.message); }
  },
  'time-format': async el => { S.settings.timeFormat = el.dataset.v; await saveSettings(); rerender(); },
  'remove-position': async el => {
    S.settings.customPositions = S.settings.customPositions.filter(p => p !== el.dataset.v);
    await saveSettings(); rerender();
  },
};

async function startRestore(file) {
  let backup;
  try { backup = await readBackup(file); } catch (x) { return toast(x.message); }
  const { data } = backup;
  const run = async mode => {
    const settings = await applyBackup(backup, mode);
    if (settings) S.settings = { ...S.settings, ...settings };
    else if (data.settings?.customPositions) S.settings.customPositions = [...new Set([...S.settings.customPositions, ...data.settings.customPositions])];
    await saveSettings();
    await load();
    toast(mode === 'merge' ? 'Backup merged' : 'Backup restored');
    go('#/');
  };
  openSheet({
    title: 'Restore backup',
    body: `<p>Backup from ${new Date(data.exportedAt).toLocaleString()}: ${plural(data.clients?.length || 0, 'client')}, ${plural(data.events?.length || 0, 'event')}, ${(n => `${n} ${n === 1 ? 'photo or file' : 'photos and files'}`)(data.blobs?.length || 0)}.</p>
      <p class="muted small">Merge keeps everything on this device and adds or updates from the backup. Replace erases this device first.</p>`,
    submit: 'Merge into this device',
    onSubmit: () => run('merge'),
    danger: 'Replace everything on this device',
    onDanger: async () => { if (!confirm('Erase all data on this device and replace it with the backup?')) return false; await run('replace'); },
  });
}

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  ev.preventDefault();
  Promise.resolve(actions[el.dataset.act](el, ev)).catch(x => { console.error(x); toast(x.message); });
});

document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.matches('[data-upload]')) {
    const files = [...t.files]; const ds = { ...t.dataset }; t.value = '';
    if (files.length) handleUpload(ds, files).catch(x => { console.error(x); toast(x.message); });
  } else if (t.matches('[data-restore]')) {
    const f = t.files[0]; t.value = '';
    if (f) startRestore(f);
  } else if (t.matches('[data-setting]')) {
    S.settings[t.dataset.setting] = t.value.trim();
    saveSettings().then(() => toast('Saved'));
  } else if (t.matches('[data-day-field]')) {
    onDayField(t);
  }
});

document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.matches('[data-day-field="lunch"]')) onDayField(t);
  if (t.matches('[data-filter]')) {
    const q = t.value.trim().toLowerCase();
    document.querySelectorAll(t.dataset.filter).forEach(c => { c.hidden = q && !c.dataset.search.includes(q); });
  }
});

// ---------- start

(async () => {
  await load();
  navigator.storage?.persist?.().catch(() => {});
  addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
