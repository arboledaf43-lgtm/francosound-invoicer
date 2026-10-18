// Pay calculation and invoice-line formatting. Pure functions, no DOM.

export const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = n => usd.format(r2(n || 0));
export const fmtHrs = h => String(Math.round((Number(h) || 0) * 100) / 100);
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;

// ---------- dates and times (dates are local "YYYY-MM-DD" strings, times "HH:MM")

export function toMinutes(t) {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function fmtTime(t, fmt = '12h') {
  const m = toMinutes(t);
  if (m == null) return '';
  const h = Math.floor(m / 60), mi = String(m % 60).padStart(2, '0');
  if (fmt === '24h') return `${String(h).padStart(2, '0')}:${mi}`;
  return `${h % 12 || 12}:${mi}${h < 12 ? 'AM' : 'PM'}`;
}

const parse = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const toISO = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

export const todayISO = () => toISO(new Date());
export const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return toISO(d); };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
export const weekday = iso => iso ? parse(iso).toLocaleDateString('en-US', { weekday: 'short' }) : '';
export function mmddyy(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}

// ---------- rates

export function effectiveRate(client = {}, event = {}) {
  const base = { dayRate: num(client.dayRate) ?? 0, otAfter: num(client.otAfter) ?? 10, dtAfter: num(client.dtAfter) };
  const o = event.override;
  if (!o || !o.enabled) return { ...base, overridden: false };
  return {
    dayRate: num(o.dayRate) ?? base.dayRate,
    otAfter: num(o.otAfter) ?? base.otAfter,
    dtAfter: num(o.dtAfter) ?? base.dtAfter,
    overridden: true,
  };
}

// Straight time is a flat day rate (also the minimum). OT is 1.5x hourly between
// OT-after and DT-after; DT is 2x hourly past DT-after. Hourly = day rate / OT-after.
export function computeDay(day = {}, rate) {
  const dayRate = +rate.dayRate || 0, otAfter = +rate.otAfter || 0;
  const dtAfter = rate.dtAfter != null && +rate.dtAfter > otAfter ? +rate.dtAfter : null;
  const hourly = otAfter > 0 ? dayRate / otAfter : 0;
  const out = {
    complete: false, overnight: false, span: 0, lunch: 0, worked: 0, ot: 0, dt: 0,
    hourly, otRate: hourly * 1.5, dtRate: hourly * 2, otAfter, dtAfter,
    dayPay: 0, otPay: 0, dtPay: 0, total: 0,
  };
  const a = toMinutes(day.clockIn), b = toMinutes(day.clockOut);
  if (a == null || b == null) return out;
  let span = b - a;
  if (span < 0) { span += 1440; out.overnight = true; }
  const lunchMin = Math.round((+day.lunch || 0) * 60);
  const worked = Math.max(0, span - lunchMin) / 60;
  out.complete = true;
  out.span = span / 60;
  out.lunch = lunchMin / 60;
  out.worked = worked;
  out.ot = Math.max(0, Math.min(worked, dtAfter ?? Infinity) - otAfter);
  out.dt = dtAfter != null ? Math.max(0, worked - dtAfter) : 0;
  out.dayPay = r2(dayRate);
  out.otPay = r2(out.ot * out.otRate);
  out.dtPay = r2(out.dt * out.dtRate);
  out.total = r2(out.dayPay + out.otPay + out.dtPay);
  return out;
}

export const sortDays = (days = []) =>
  [...days].sort((x, y) => (x.date || '').localeCompare(y.date || '') || (x.clockIn || '').localeCompare(y.clockIn || ''));

export function eventTotals(event, rate) {
  const rows = sortDays(event.days).map(day => ({ day, calc: computeDay(day, rate) }));
  const t = { rows, total: 0, worked: 0, ot: 0, dt: 0, incomplete: 0, days: rows.length };
  for (const { calc } of rows) {
    if (!calc.complete) { t.incomplete++; continue; }
    t.total += calc.total; t.worked += calc.worked; t.ot += calc.ot; t.dt += calc.dt;
  }
  t.total = r2(t.total);
  return t;
}

export function breakdownText(c) {
  let s = `Day ${money(c.dayPay)}`;
  if (c.ot > 0) s += ` + OT ${fmtHrs(c.ot)}h × ${money(c.otRate)} = ${money(c.otPay)}`;
  if (c.dt > 0) s += ` + DT ${fmtHrs(c.dt)}h × ${money(c.dtRate)} = ${money(c.dtPay)}`;
  return s;
}

// ---------- Housecall Pro

export function hcpLines(event, rate, timeFmt = '12h') {
  return eventTotals(event, rate).rows.filter(r => r.calc.complete).map(({ day, calc }) => {
    let desc = `Clock-in:${fmtTime(day.clockIn, timeFmt)} / Clock-out:${fmtTime(day.clockOut, timeFmt)} / Lunch:${fmtHrs(day.lunch)}hr / O.T.: ${fmtHrs(calc.ot)}hrs`;
    if (calc.dt > 0) desc += ` / D.T.: ${fmtHrs(calc.dt)}hrs`;
    return { date: day.date, name: `${event.position} - ${event.name} ${mmddyy(day.date)}`, desc, qty: '1.0', price: calc.total };
  });
}

export function claudeBlock({ client, event, lines }) {
  const total = r2(lines.reduce((s, l) => s + l.price, 0));
  const items = lines.map((l, i) =>
    `${i + 1}. Name: ${l.name}\n   Description: ${l.desc}\n   Qty: 1.0\n   Unit price: ${money(l.price)}`).join('\n\n');
  return [
    `Open Housecall Pro, find customer "${client.company}"${client.contactName ? ` (contact: ${client.contactName})` : ''}, and create a new invoice.`,
    event.jobNumber ? `Job number: ${event.jobNumber}. Put it in the invoice's job / PO / reference field if there is one, otherwise in the invoice message.` : '',
    '',
    `Add these ${lines.length} line items exactly, one per day, in this order:`,
    '',
    items,
    '',
    `The invoice total should be ${money(total)}. If it doesn't match, stop and tell me.`,
    '',
    'Do not send the invoice — stop and show me before submitting.',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}
