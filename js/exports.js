// PDF summary and backup/restore. Uses window.jspdf and window.JSZip (loaded in index.html).
import * as db from './db.js';
import { money, fmtHrs, fmtTime, mmddyy, weekday, breakdownText, sortDays } from './pay.js';

// ---------- images

function loadImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Unsupported image')); };
    img.src = url;
  });
}

function drawToCanvas(img, max) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Shrinks a phone photo to a ~300 KB JPEG. Falls back to the original if the browser can't decode it.
export async function compressImage(file, max = 1600, quality = 0.82) {
  try {
    const c = drawToCanvas(await loadImage(file), max);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', quality));
  } catch { return file; }
}

async function jpegDataUrl(blob, max = 1400) {
  try {
    const c = drawToCanvas(await loadImage(blob), max);
    return { url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height };
  } catch { return null; }
}

// ---------- PDF summary

export async function buildPdf({ event, client, rate, totals, settings }) {
  if (!window.jspdf) throw new Error("The PDF library hasn't loaded. Connect to the internet once and try again.");
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
  const W = 612, H = 792, M = 44, fmt = settings.timeFormat;
  let y = M;
  const ensure = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (s, x, yy, o) => doc.text(String(s ?? ''), x, yy, o);
  const font = (size, style = 'normal', gray = 0) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(gray); };

  // Header
  doc.setFillColor(10, 10, 10); doc.rect(0, 0, W, 64, 'F');
  font(18, 'bold', 255); text((settings.businessName || 'Francosound').toUpperCase(), M, 40);
  font(10, 'normal', 200); text('Event summary', W - M, 40, { align: 'right' });
  y = 96;

  // Client and event blocks
  const left = [client.company, client.contactName].filter(Boolean);
  const rateLine = `${money(rate.dayRate)}/day (${money(rate.dayRate / rate.otAfter)}/hr) · OT after ${fmtHrs(rate.otAfter)}h${rate.dtAfter ? ` · DT after ${fmtHrs(rate.dtAfter)}h` : ''}`;
  const right = [
    ...(event.jobNumber ? [['Job #', event.jobNumber]] : []),
    ['Event', event.name], ['Position', event.position], ['Rate', rateLine + (rate.overridden ? ' (event rate)' : '')],
  ];
  font(8, 'bold', 120); text('BILL TO', M, y); text('EVENT', 300, y);
  y += 14;
  const startY = y;
  left.forEach((l, i) => { font(10, i ? 'normal' : 'bold', 20); text(l, M, y + i * 14); });
  let ry = startY;
  for (const [k, v] of right) {
    font(9, 'normal', 120); text(k, 300, ry);
    font(10, 'normal', 20);
    for (const l of doc.splitTextToSize(String(v), W - M - 350)) { text(l, 350, ry); ry += 13; }
    ry += 1;
  }
  y = Math.max(startY + left.length * 14, ry) + 18;

  // Day table
  const cols = [['Date', M], ['In', 140], ['Out', 196], ['Lunch', 252], ['Hours', 300], ['OT', 350], ['DT', 395], ['Total', W - M]];
  doc.setFillColor(235, 235, 235); doc.rect(M - 6, y - 12, W - 2 * M + 12, 20, 'F');
  font(9, 'bold', 40);
  cols.forEach(([h, x], i) => text(h, x, y + 2, i === cols.length - 1 ? { align: 'right' } : undefined));
  y += 24;
  for (const { day, calc } of totals.rows) {
    ensure(34);
    font(10, 'normal', 20);
    text(`${weekday(day.date)} ${mmddyy(day.date)}`, M, y);
    if (calc.complete) {
      text(fmtTime(day.clockIn, fmt), 140, y);
      text(fmtTime(day.clockOut, fmt) + (calc.overnight ? ' +1' : ''), 196, y);
      text(`${fmtHrs(day.lunch)}h`, 252, y);
      text(fmtHrs(calc.worked), 300, y);
      text(calc.ot ? fmtHrs(calc.ot) : '–', 350, y);
      text(calc.dt ? fmtHrs(calc.dt) : '–', 395, y);
      font(10, 'bold', 20); text(money(calc.total), W - M, y, { align: 'right' });
      font(8, 'normal', 120); text(breakdownText(calc), 140, y + 12);
    } else {
      font(9, 'italic', 120); text('Times not entered — not included in total', 140, y);
    }
    y += 26;
    doc.setDrawColor(225); doc.line(M - 6, y - 10, W - M + 6, y - 10);
  }

  // Totals
  ensure(80);
  y += 6;
  font(10, 'normal', 80);
  text(`Hours worked ${fmtHrs(totals.worked)}h   ·   OT ${fmtHrs(totals.ot)}h   ·   DT ${fmtHrs(totals.dt)}h`, M, y);
  font(9, 'normal', 120); text('Total', W - M - 120, y, { align: 'right' });
  font(18, 'bold', 10); text(money(totals.total), W - M, y + 4, { align: 'right' });
  y += 34;
  if (event.notes) {
    ensure(40);
    font(8, 'bold', 120); text('NOTES', M, y); y += 14;
    font(10, 'normal', 40);
    for (const l of doc.splitTextToSize(event.notes, W - 2 * M)) { ensure(14); text(l, M, y); y += 14; }
  }

  // Photo appendix, two per page
  const photos = [];
  for (const day of sortDays(event.days)) (day.photoIds || []).forEach((id, i) => photos.push({ id, day, i }));
  let slot = 0;
  for (const p of photos) {
    if (slot % 2 === 0) {
      doc.addPage(); y = M;
      font(12, 'bold', 20); text('Appendix — clock-in photos', M, y); y += 20;
    }
    const rec = await db.get('blobs', p.id);
    const img = rec && await jpegDataUrl(rec.data);
    font(9, 'normal', 80);
    text(`${weekday(p.day.date)} ${mmddyy(p.day.date)} · photo ${p.i + 1}`, M, y); y += 8;
    const boxW = W - 2 * M, boxH = (H - 2 * M - 20) / 2 - 30;
    if (img) {
      const s = Math.min(boxW / img.w, boxH / img.h);
      doc.addImage(img.url, 'JPEG', M, y, img.w * s, img.h * s);
    } else {
      font(9, 'italic', 120); text('This photo format could not be embedded.', M, y + 14);
    }
    y += boxH + 22;
    slot++;
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); font(8, 'normal', 150);
    text(`${event.name} · ${client.company} · page ${i} of ${pages}`, W / 2, H - 20, { align: 'center' });
  }
  return doc.output('blob');
}

// ---------- backup / restore

export async function buildBackup() {
  if (!window.JSZip) throw new Error("The zip library hasn't loaded. Connect to the internet once and try again.");
  const zip = new window.JSZip();
  const [clients, events, tombstones, meta, blobs] = await Promise.all(['clients', 'events', 'tombstones', 'meta', 'blobs'].map(db.getAll));
  const blobMeta = blobs.map(({ data, ...m }) => { zip.file(`files/${m.id}`, data); return m; });
  zip.file('data.json', JSON.stringify({
    app: 'francosound-invoicer', version: 1, exportedAt: new Date().toISOString(),
    clients, events, tombstones, settings: meta.find(m => m.key === 'settings')?.value ?? null, blobs: blobMeta,
  }, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export async function readBackup(file) {
  if (!window.JSZip) throw new Error("The zip library hasn't loaded. Connect to the internet once and try again.");
  let zip;
  try { zip = await window.JSZip.loadAsync(file); } catch { throw new Error("That file isn't a backup zip."); }
  const f = zip.file('data.json');
  if (!f) throw new Error("That zip doesn't contain a Francosound backup.");
  const data = JSON.parse(await f.async('string'));
  if (data.app !== 'francosound-invoicer') throw new Error("That zip doesn't contain a Francosound backup.");
  return { data, zip };
}

const union = (a = [], b = []) => [...new Set([...a, ...b])];

async function blobFromZip(zip, m) {
  const f = zip.file(`files/${m.id}`);
  if (!f) return null;
  return { ...m, data: new Blob([await f.async('arraybuffer')], { type: m.type || '' }) };
}

// "replace" wipes this device first. "merge" keeps the newest version of each record,
// merges days/photos/files inside events, and applies deletions from both sides.
export async function applyBackup({ data, zip }, mode) {
  if (mode === 'replace') {
    for (const s of ['clients', 'events', 'blobs', 'tombstones']) await db.clear(s);
    for (const c of data.clients || []) await db.put('clients', c);
    for (const e of data.events || []) await db.put('events', e);
    for (const t of data.tombstones || []) await db.put('tombstones', t);
    for (const m of data.blobs || []) { const b = await blobFromZip(zip, m); if (b) await db.put('blobs', b); }
    return data.settings;
  }

  const tombs = new Map((await db.getAll('tombstones')).map(t => [t.id, t]));
  for (const t of data.tombstones || []) if (!tombs.has(t.id)) { tombs.set(t.id, t); await db.put('tombstones', t); }
  const dead = id => tombs.has(id);

  const localClients = new Map((await db.getAll('clients')).map(c => [c.id, c]));
  for (const c of data.clients || []) {
    const l = localClients.get(c.id);
    if (!dead(c.id) && (!l || (c.updatedAt || 0) > (l.updatedAt || 0))) await db.put('clients', c);
  }

  const localEvents = new Map((await db.getAll('events')).map(e => [e.id, e]));
  for (const e of data.events || []) {
    if (dead(e.id)) continue;
    const l = localEvents.get(e.id);
    await db.put('events', l ? mergeEvent(l, e, dead) : e);
  }

  const localBlobIds = new Set((await db.getAll('blobs')).map(b => b.id));
  for (const m of data.blobs || []) {
    if (dead(m.id) || localBlobIds.has(m.id)) continue;
    const b = await blobFromZip(zip, m);
    if (b) await db.put('blobs', b);
  }

  // Deletions made on the other device.
  for (const t of tombs.values()) {
    if (['clients', 'events', 'blobs'].includes(t.store)) await db.rawDel(t.store, t.id);
    if (t.store === 'days') {
      for (const e of await db.getAll('events')) {
        if (e.days?.some(d => d.id === t.id)) await db.put('events', { ...e, days: e.days.filter(d => d.id !== t.id) });
      }
    }
  }
  return null;
}

function mergeEvent(a, b, dead) {
  const newer = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  const days = new Map();
  for (const d of [...(a.days || []), ...(b.days || [])]) {
    if (dead(d.id)) continue;
    const ex = days.get(d.id);
    if (!ex) { days.set(d.id, { ...d }); continue; }
    const n = (d.updatedAt || 0) > (ex.updatedAt || 0) ? d : ex;
    days.set(d.id, { ...n, photoIds: union(ex.photoIds, d.photoIds) });
  }
  const out = { ...newer, updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0) };
  out.days = [...days.values()].map(d => ({ ...d, photoIds: (d.photoIds || []).filter(id => !dead(id)) }));
  out.fileIds = union(a.fileIds, b.fileIds).filter(id => !dead(id));
  return out;
}
