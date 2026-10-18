import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDay, effectiveRate, eventTotals, hcpLines, claudeBlock, fmtTime, mmddyy, addDays, daysBetween } from '../js/pay.js';

const rate = { dayRate: 500, otAfter: 10, dtAfter: 12 };
const day = (clockIn, clockOut, lunch = 1) => ({ date: '2026-10-14', clockIn, clockOut, lunch });

test('short day still bills the full day rate', () => {
  const c = computeDay(day('09:00', '17:00', 0.5), rate);
  assert.equal(c.worked, 7.5);
  assert.equal(c.total, 500);
  assert.equal(c.ot, 0);
});

test('OT between OT-after and DT-after at 1.5x', () => {
  const c = computeDay(day('08:00', '21:00'), rate); // 12h worked
  assert.equal(c.hourly, 50);
  assert.equal(c.ot, 2);
  assert.equal(c.otPay, 150);
  assert.equal(c.total, 650);
});

test('DT past DT-after at 2x', () => {
  const c = computeDay(day('07:00', '22:00'), rate); // 14h worked
  assert.equal(c.ot, 2);
  assert.equal(c.dt, 2);
  assert.equal(c.dtPay, 200);
  assert.equal(c.total, 850);
});

test('no DT-after means all extra hours are OT', () => {
  const c = computeDay(day('07:00', '22:00'), { dayRate: 500, otAfter: 10, dtAfter: null });
  assert.equal(c.ot, 4);
  assert.equal(c.dt, 0);
  assert.equal(c.total, 800);
});

test('shift past midnight', () => {
  const c = computeDay(day('18:00', '05:30', 0.5), rate); // 11h worked
  assert.ok(c.overnight);
  assert.equal(c.worked, 11);
  assert.equal(c.total, 575);
});

test('rounds to the cent with uneven hourly', () => {
  const c = computeDay(day('08:00', '20:20', 0), { dayRate: 550, otAfter: 12, dtAfter: null }); // 12h20m
  assert.equal(c.otPay, 22.92); // 0.3333h * 68.75
  assert.equal(c.total, 572.92);
});

test('incomplete day is not counted', () => {
  const t = eventTotals({ days: [day('08:00', ''), day('08:00', '21:00')] }, rate);
  assert.equal(t.incomplete, 1);
  assert.equal(t.total, 650);
});

test('event override replaces only filled fields', () => {
  const r = effectiveRate({ dayRate: 500, otAfter: 10, dtAfter: 12 }, { override: { enabled: true, dayRate: '600', otAfter: '', dtAfter: '' } });
  assert.deepEqual([r.dayRate, r.otAfter, r.dtAfter], [600, 10, 12]);
  assert.equal(effectiveRate({ dayRate: 500, otAfter: 10 }, { override: { enabled: false, dayRate: 600 } }).dayRate, 500);
});

test('formatting helpers', () => {
  assert.equal(fmtTime('08:00'), '8:00AM');
  assert.equal(fmtTime('21:05'), '9:05PM');
  assert.equal(fmtTime('00:30'), '12:30AM');
  assert.equal(fmtTime('07:15', '24h'), '07:15');
  assert.equal(mmddyy('2026-10-14'), '10/14/26');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-10-14', '2027-10-13'), 364);
});

test('Housecall Pro lines match invoice format', () => {
  const ev = { name: 'Fall Tour', position: 'A2', jobNumber: '24817', days: [day('07:00', '22:00'), { ...day('08:00', '21:00'), date: '2026-10-13' }] };
  const lines = hcpLines(ev, rate);
  assert.equal(lines[0].name, 'A2 - Fall Tour 10/13/26');
  assert.equal(lines[0].desc, 'Clock-in:8:00AM / Clock-out:9:00PM / Lunch:1hr / O.T.: 2hrs');
  assert.equal(lines[1].desc, 'Clock-in:7:00AM / Clock-out:10:00PM / Lunch:1hr / O.T.: 2hrs / D.T.: 2hrs');
  assert.equal(lines[1].price, 850);
  const block = claudeBlock({ client: { company: 'Clair Global' }, event: ev, lines });
  assert.match(block, /find customer "Clair Global"/);
  assert.match(block, /invoice total should be \$1,500\.00/);
  assert.match(block, /Do not send the invoice — stop and show me before submitting\.$/);
});

test('lunch is only subtracted when entered', () => {
  const noLunch = computeDay(day('12:00', '23:00', 0), { dayRate: 600, otAfter: 10, dtAfter: 12 });
  assert.equal(noLunch.worked, 11);
  assert.equal(noLunch.ot, 1);
  assert.equal(noLunch.total, 690);
  const withLunch = computeDay(day('12:00', '23:00', 1), { dayRate: 600, otAfter: 10, dtAfter: 12 });
  assert.deepEqual([withLunch.span, withLunch.lunch, withLunch.worked, withLunch.total], [11, 1, 10, 600]);
});
