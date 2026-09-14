const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/journal.js'), 'utf8');
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function harness() {
  let created = 0;
  function node() {
    const tokens = new Set();
    return {
      children: [], dataset: {}, attrs: {}, textContent: '', value: '',
      classList: { contains: value => tokens.has(value), add: value => tokens.add(value), remove: value => tokens.delete(value) },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      setAttribute(key, value) { this.attrs[key] = value; },
      get lastElementChild() { return this.children.at(-1); },
    };
  }
  const ids = new Map();
  const el = id => { if (!ids.has(id)) ids.set(id, node()); return ids.get(id); };
  const today = new Date(), key = dateKey(today);
  const event = { id: 'event', title: 'Customer meeting', start: `${key}T14:00:00`, end: `${key}T15:00:00`, allDay: false };
  const context = {
    document: { getElementById: el, createElement() { created++; return node(); } },
    window: {}, currentUser: { uid: 'user', displayName: 'Journal owner' }, isGoogleSignedIn: true,
    eventsByDate: new Map([[key, [event]]]), multiDayEvents: [],
    memos: [{ id: 'memo', text: 'Prepare quotation', done: false, due: key }],
    toDateStr: dateKey, formatEventTime: ev => `${ev.start} - ${ev.end}`,
    memoBuildRow(memo) { const row = node(); row.textContent = memo.text; row.dataset.id = memo.id; return row; },
    viewYear: today.getFullYear(), viewMonth: today.getMonth(), renderCalendar: async () => {}, showToast() {},
  };
  vm.runInNewContext(source, context);
  return { context, el, today, key, event, render: () => context.window.journalUI.render(), created: () => created };
}

test('hidden journal does no list rendering and catches up on return', () => {
  const h = harness();
  h.el('journal-panel').classList.add('hidden');
  h.render();
  assert.equal(h.created(), 0);
  assert.equal(h.el('journal-user-name').textContent, 'Journal owner');
  h.event.title = 'Changed while hidden';
  h.el('journal-panel').classList.remove('hidden');
  h.render();
  assert.equal(h.el('journal-week').children.length, 7);
  assert.equal(h.el('journal-timeline').children[0].children[1].children[0].textContent, 'Changed while hidden');
});

test('unchanged updates preserve week, event and memo nodes including an in-progress edit', () => {
  const h = harness(); h.render();
  const week = [...h.el('journal-week').children];
  const event = h.el('journal-timeline').children[0];
  const memo = h.el('journal-task-list').children[0];
  memo.draft = 'Unsaved inline edit';
  const count = h.created();
  for (let i = 0; i < 30; i++) h.render();
  assert.equal(h.created(), count, 'no new UI nodes for repeated identical updates');
  assert.deepEqual(h.el('journal-week').children, week);
  assert.equal(h.el('journal-timeline').children[0], event);
  assert.equal(h.el('journal-task-list').children[0], memo);
  assert.equal(memo.draft, 'Unsaved inline edit');
  h.event.title = 'Updated meeting'; h.render();
  assert.notEqual(h.el('journal-timeline').children[0], event);
  assert.equal(h.el('journal-task-list').children[0], memo, 'calendar update preserves memo edit');
  h.context.memos[0].text = 'Updated memo'; h.render();
  assert.equal(h.el('journal-task-list').children[0].textContent, 'Updated memo');
});

test('same-week selection retains date buttons and updates the selected day', async () => {
  const h = harness(); h.render();
  const original = h.el('journal-week').children[1];
  await original.onclick();
  assert.equal(h.el('journal-week').children[1], original);
  assert.equal(original.attrs['aria-pressed'], 'true');
  assert.equal(h.el('journal-week').children.filter(b => b.attrs['aria-pressed'] === 'true').length, 1);
});

test('week indicators and all-day spanning events include start but exclude end', () => {
  const h = harness();
  h.context.eventsByDate.clear();
  const monday = new Date(h.today); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const tuesday = new Date(monday); tuesday.setDate(tuesday.getDate() + 1);
  h.context.multiDayEvents = [{ id: 'span', title: 'Shared event', start: dateKey(monday), end: dateKey(tuesday), allDay: true }];
  h.render();
  const week = h.el('journal-week').children;
  assert.equal(week[0].lastElementChild.className, 'has-events');
  assert.equal(week[1].lastElementChild.className, '');
  h.context.multiDayEvents = []; h.render();
  assert.equal(week[0].lastElementChild.className, '');
});
