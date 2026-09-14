const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
const start = renderer.indexOf('const MAX_EVENT_LINES = 4;');
const end = renderer.indexOf('\n// 날짜를 클릭할 때마다', start);
assert.ok(start >= 0 && end > start, 'scrollable calendar row calculation found');

const context = { Number, Math, EVENT_BANNER_HEIGHT: 14, EVENT_BANNER_GAP: 2 };
vm.runInNewContext(renderer.slice(start, end), context);

test('busy calendar weeks grow enough to show their event rows', () => {
  assert.equal(context.calendarWeekMinHeight(0, 0), 92);
  assert.equal(context.calendarWeekMinHeight(0, 3), 114);
  assert.equal(context.calendarWeekMinHeight(0, 4), 138);
  assert.equal(context.calendarWeekMinHeight(0, 6), 154);
});

test('multi-day banner tracks also reserve vertical space', () => {
  assert.equal(context.calendarWeekMinHeight(2, 3), 146);
});
