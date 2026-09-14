const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const entry = require('../src/renderer/journal-entry');

test('all-day entry uses selected date and exclusive next day, memo shares date', () => {
  const result = entry.buildPayload({ title: '  고객 상담  ', date: '2026-12-31' });
  assert.deepEqual(result.event, { summary: '고객 상담', start: { date: '2026-12-31' }, end: { date: '2027-01-01' } });
  assert.deepEqual(result.memo, { text: '고객 상담', dueDate: '2026-12-31' });
});
test('timed entry is an hour long and correctly crosses midnight', () => {
  const result = entry.buildPayload({ title: '서류 확인', date: '2026-09-10', time: '23:30' });
  const start = new Date(result.event.start.dateTime), end = new Date(result.event.end.dateTime);
  assert.equal(end - start, 3600000);
  assert.equal(start.getDate(), 10); assert.equal(end.getDate(), 11);
  assert.equal(start.getHours(), 23); assert.equal(end.getHours(), 0);
  assert.equal(result.memo.text, '23:30 · 서류 확인');
  assert.equal(result.memo.dueDate, '2026-09-10');
});
test('invalid dates, times and empty titles are rejected before saving', () => {
  for (const override of [{ title: ' ' }, { title: 'x'.repeat(201) }, { date: '2026-02-30' }, { date: '2026-13-01' }, { time: '25:00' }, { time: '12:99' }]) {
    assert.throws(() => entry.buildPayload({ title: '상담', date: '2026-09-10', ...override }));
  }
  assert.doesNotThrow(() => entry.buildPayload({ title: '상담', date: '2028-02-29' }));
});
test('successful entry creates exactly one event followed by one memo', async () => {
  const calls = [];
  const result = await entry.create({ googleCreateEvent: async p => { calls.push(['event', p]); return { id: 'e1' }; }, createMemo: async p => { calls.push(['memo', p]); return { id: 'm1' }; } }, entry.buildPayload({ title: '상담', date: '2026-09-11' }));
  assert.equal(result.status, 'complete'); assert.deepEqual(calls.map(c => c[0]), ['event', 'memo']);
  assert.equal(calls[1][1].dueDate, '2026-09-11');
});
test('calendar failure does not create an orphan memo', async () => {
  let memoCalls = 0;
  const result = await entry.create({ googleCreateEvent: async () => { throw Error('offline'); }, createMemo: async () => { memoCalls++; } }, {});
  assert.equal(result.status, 'event-error'); assert.equal(memoCalls, 0);
});
test('memo failure reports partial success and never retries or deletes the event', async () => {
  let events = 0, memos = 0;
  const result = await entry.create({ googleCreateEvent: async () => { events++; return { id: 'saved-event' }; }, createMemo: async () => { memos++; throw Error('task scope unavailable'); } }, {});
  assert.equal(result.status, 'memo-error'); assert.equal(result.event.id, 'saved-event');
  assert.equal(events, 1); assert.equal(memos, 1);
});

// Exercise the real IPC callback with isolated services; no real account or data is accessed.
function memoHandler(signedIn = true) {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const start = source.indexOf("ipcMain.handle('memos:create'");
  const end = source.indexOf('\n});', start) + 4;
  let handler, saved;
  const context = { ipcMain: { handle: (_name, fn) => { handler = fn; } }, googleAuth: { isSignedIn: () => signedIn, createTask: async (_config, payload) => { saved = payload; return { id: 'memo' }; } }, config: { google: {} }, dateKeyOf: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, refreshMemosFromGoogleTasks() {} };
  vm.runInNewContext(source.slice(start, end), context);
  return { call: payload => handler(null, payload), saved: () => saved };
}
test('memo handler preserves explicit selected date without creating an alarm', async () => {
  const handler = memoHandler(); await handler.call({ text: '연락하기', dueDate: '2026-10-02' });
  assert.equal(handler.saved().due, '2026-10-02'); assert.equal(handler.saved().alarmTime, null);
});
test('existing memo alarm behavior still takes precedence and is unchanged', async () => {
  const handler = memoHandler(); const remindAt = new Date(2026, 9, 3, 14, 20).getTime();
  await handler.call({ text: '기존 메모', remindAt });
  assert.equal(handler.saved().due, '2026-10-03'); assert.equal(handler.saved().alarmTime, '14:20');
});
test('memo handler rejects invalid dates and unsigned users without writes', async () => {
  const handler = memoHandler(); await assert.rejects(handler.call({ text: 'test', dueDate: '2026-02-30' })); assert.equal(handler.saved(), undefined);
  const loggedOut = memoHandler(false); await assert.rejects(loggedOut.call({ text: 'test', dueDate: '2026-09-10' })); assert.equal(loggedOut.saved(), undefined);
});
