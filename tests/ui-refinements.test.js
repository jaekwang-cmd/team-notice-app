const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');

function swatchHarness() {
  const container = { children: [], appendChild(node) { node.parent = this; this.children.push(node); }, querySelectorAll() { return this.children; } };
  Object.defineProperty(container, 'innerHTML', { set() { container.children.forEach(node => node.parent = null); container.children = []; } });
  const panel = { classList: { contains: () => true }, contains: node => node?.parent === container };
  let closed = 0, outsideClick;
  const context = {
    selectedEventColorId: null,
    EVENT_COLORS: [{ id: '1', name: '라벤더', hex: '#ccc' }, { id: '2', name: '세이지', hex: '#ada' }],
    eventColorSwatchesEl: container,
    calendarRow: { classList: { contains: () => true } }, dayPanel: panel,
    document: {
      createElement() { const node = { dataset: {}, style: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } }; node.classList = { toggle(name, value) { const tokens = new Set(node.className.split(' ')); value ? tokens.add(name) : tokens.delete(name); node.className = [...tokens].join(' '); } }; return node; },
      addEventListener(_type, callback) { outsideClick = callback; },
      getElementById() { return { click() { closed++; } }; },
    },
  };
  const start = renderer.indexOf('function renderEventColorSwatches()');
  const end = renderer.indexOf('\nrenderEventColorSwatches();', start);
  vm.runInNewContext(renderer.slice(start, end) + '\nrenderEventColorSwatches();', context);
  const clickStart = renderer.indexOf("document.addEventListener('click', (e) => {", renderer.indexOf('const CALENDAR_ONLY_KEY'));
  vm.runInNewContext(renderer.slice(clickStart, renderer.indexOf('\n});', clickStart) + 4), context);
  return { container, context, panel, outsideClick: e => outsideClick(e), closed: () => closed };
}
test('color selection keeps its DOM node, keyboard focus target and popup alive', () => {
  const h = swatchHarness(), original = h.container.children[0];
  original.onclick();
  assert.equal(h.container.children[0], original);
  assert.equal(h.context.selectedEventColorId, '1');
  assert.equal(original.attributes['aria-pressed'], 'true');
  h.outsideClick({ target: original, composedPath: () => [original, h.container, h.panel] });
  assert.equal(h.closed(), 0);
  original.onclick();
  assert.equal(h.context.selectedEventColorId, null);
  assert.equal(original.attributes['aria-pressed'], 'false');
});
test('outside-click handling uses the original event path even if a child was detached', () => {
  const h = swatchHarness(), detached = { parent: null };
  h.outsideClick({ target: detached, composedPath: () => [detached, h.container, h.panel] });
  assert.equal(h.closed(), 0);
});
test('actual outside clicks still close, while calendar cell clicks do not', () => {
  const h = swatchHarness();
  h.outsideClick({ target: { closest: () => ({}) }, composedPath: () => [] });
  assert.equal(h.closed(), 0);
  h.outsideClick({ target: { closest: () => null }, composedPath: () => [] });
  assert.equal(h.closed(), 1);
});
test('font choices do not load all fonts; chosen fonts are loaded once and retry on failure', () => {
  const children = [], requests = [];
  const element = () => ({ children: [], appendChild(node) { this.children.push(node); }, remove() {} });
  const picker = { appendChild(node) { children.push(node); } };
  const context = { window: {}, URLSearchParams, document: { getElementById: () => picker, createElement: element, head: { appendChild(node) { requests.push(node); } } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/fonts.js'), 'utf8'), context);
  assert.equal(children.flatMap(group => group.children).length, 16);
  assert.equal(requests.length, 0);
  const stack = "'Gowun Dodum', 'Malgun Gothic', sans-serif";
  context.window.appFonts.ensureLoaded(stack); context.window.appFonts.ensureLoaded(stack);
  assert.equal(requests.length, 1);
  assert.match(requests[0].href, /^https:\/\/fonts.googleapis.com\/css2\?/);
  requests[0].onerror(); context.window.appFonts.ensureLoaded(stack);
  assert.equal(requests.length, 2);
  context.window.appFonts.ensureLoaded("'Consolas', monospace");
  assert.equal(requests.length, 2);
});

test('settlement edits on one row are serialized and the latest optimistic values stay visible', async () => {
  const calls = [], releases = [];
  const context = {
    Map, Object, Promise, console,
    window: { api: { updateChulgoEntry(payload) { calls.push(payload); return new Promise(resolve => releases.push(resolve)); } } },
    chulgoFriendlyError: () => 'error', showToast() {},
  };
  const start = renderer.indexOf('const chulgoWriteTails = new Map();');
  const end = renderer.indexOf('\nfunction renderChulgo()', start);
  vm.runInNewContext(`${renderer.slice(start, end)}\nglobalThis.pending = chulgoPendingPatches;`, context);
  const first = context.chulgoUpdateField('row-1', 'initialFund', 1000000);
  const second = context.chulgoUpdateField('row-1', 'company', 'BNK캐피탈');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(context.pending.get('row-1').company, 'BNK캐피탈');
  releases.shift()(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].company, 'BNK캐피탈');
  releases.shift()(); await Promise.all([first, second]);
  assert.equal(context.pending.has('row-1'), false);
});

test('many row edits keep Firestore writes bounded without losing queued values', async () => {
  const calls = [], releases = [];
  const context = {
    Map, Object, Promise, console,
    window: { api: { updateChulgoEntry(payload) { calls.push(payload); return new Promise(resolve => releases.push(resolve)); } } },
    chulgoFriendlyError: () => 'error', showToast() {},
  };
  const start = renderer.indexOf('const chulgoWriteTails = new Map();');
  const end = renderer.indexOf('\nfunction renderChulgo()', start);
  vm.runInNewContext(`${renderer.slice(start, end)}\nglobalThis.pending = chulgoPendingPatches;`, context);
  const writes = Array.from({ length: 9 }, (_, index) => context.chulgoUpdateField(`row-${index}`, 'name', `고객 ${index}`));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3);
  assert.equal(context.pending.size, 9);
  while (releases.length || calls.length < 9) {
    const release = releases.shift();
    if (release) release();
    await new Promise(resolve => setImmediate(resolve));
  }
  await Promise.all(writes);
  assert.equal(calls.length, 9);
  assert.equal(context.pending.size, 0);
});

test('settlement pill styling keeps its pill class after a value change', () => {
  assert.match(renderer, /classList\.toggle\('chulgo-status-완료'/);
  assert.doesNotMatch(renderer, /el\.className = value === '완료'/);
  assert.match(renderer, /chulgoUpdateFields\(id, \{ recognizedUnits: n, countsQuota: true \}\)/);
});
