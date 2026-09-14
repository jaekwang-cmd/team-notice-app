const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
const start = renderer.indexOf('async function refreshEventsAndDayPanel()');
const end = renderer.indexOf('\nfunction openDayPanel(', start);
assert.ok(start >= 0 && end > start, 'actual calendar refresh function found');

function harness(selectedDateStr = '2026-09-10') {
  const calls = [];
  let complete, reject;
  const rendering = new Promise((resolve, rejectRender) => { complete = resolve; reject = rejectRender; });
  const context = {
    selectedDateStr, viewYear: 2026, viewMonth: 8,
    startOfGrid: () => new Date('2026-08-30T00:00:00Z'),
    async loadGoogleEventsForGrid() { calls.push('fetch'); },
    async renderCalendar() { await context.loadGoogleEventsForGrid(); await rendering; calls.push('rendered'); },
    renderDayEventList() { calls.push(`day:${context.selectedDateStr}`); },
  };
  vm.runInNewContext(renderer.slice(start, end), context);
  return { calls, context, complete, reject, refresh: () => context.refreshEventsAndDayPanel() };
}

test('calendar refresh fetches once and rebuilds the selected day only after rendering finishes', async () => {
  const h = harness();
  const pending = h.refresh();
  assert.deepEqual(h.calls, ['fetch']);
  h.complete();
  await pending;
  assert.deepEqual(h.calls, ['fetch', 'rendered', 'day:2026-09-10']);
});

test('a failed calendar render leaves the selected day list untouched', async () => {
  const h = harness();
  const pending = h.refresh();
  h.reject(new Error('calendar unavailable'));
  await assert.rejects(pending, /calendar unavailable/);
  assert.deepEqual(h.calls, ['fetch']);
});

test('refresh with no selected day fetches once without opening a day list', async () => {
  const h = harness(null);
  const pending = h.refresh();
  h.complete();
  await pending;
  assert.deepEqual(h.calls, ['fetch', 'rendered']);
});
