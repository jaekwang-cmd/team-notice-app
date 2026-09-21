const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer/journal-worlds.js'), 'utf8');

function harness(saved = '{}') {
  const nodes = new Map(), frames = new Map(), events = {}, writes = [];
  let nextFrame = 0, observer, resizer;
  const paint = new Proxy({}, { get(_target, name) { if (name === 'createLinearGradient' || name === 'createRadialGradient') return () => ({ addColorStop() {} }); return () => {}; } });
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, {
      dataset: {}, hidden: true, textContent: '', style: {}, attrs: {}, checked: false,
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(name, callback) { this[name] = callback; },
      getContext: () => paint, getBoundingClientRect: () => ({ width: 1000, height: 340 }), animate() {},
    });
    return nodes.get(key);
  }
  const root = node('root'), scenes = [0, 1, 2].map(i => node('scene' + i));
  scenes.forEach((button, i) => { button.dataset.worldScene = String(i); });
  root.querySelector = node; root.querySelectorAll = () => scenes;
  const body = { dataset: {}, style: { setProperty() {}, removeProperty() {} } };
  const media = { matches: false, addEventListener(name, fn) { this[name] = fn; } };
  const document = { hidden: false, body, getElementById: () => root, querySelector: node, createElement: () => node('offscreen'), addEventListener(name, fn) { events[name] = fn; } };
  const context = { document, window: { addEventListener() {}, appFonts: { ensureLoaded() {} } },
    localStorage: { getItem: () => saved, setItem(key, value) { writes.push({ key, value }); } },
    matchMedia: () => media, devicePixelRatio: 1,
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class { constructor(callback) { resizer = callback; } observe() {} disconnect() {} },
    IntersectionObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() {} },
  };
  vm.runInNewContext(source, context);
  return { root, scenes, node, context, body, frames, events, media, writes,
    show: () => observer([{ isIntersecting: true }]), resize: () => resizer(),
    set: mode => context.window.journalWorlds.setTheme({ mode }), view: name => context.window.journalWorlds.setView(name) };
}

test('all 27 scenes render and changing theme/view never writes account settings', () => {
  const h = harness();
  for (const mode of ['wood', 'nightStudy', 'secretForest', 'starObservatory', 'sunsetLetter', 'winterCabin', 'cherryGarden', 'lavenderField', 'rainyCafe']) {
    h.set(mode);
    for (const [view, scene] of [['journal', '0'], ['calendar', '1'], ['memo', '2']]) {
      h.view(view); h.resize();
      assert.equal(h.root.dataset.scene, scene);
      assert.equal(h.root.hidden, false);
      assert.ok(h.node('.world-title').textContent.length > 0);
    }
  }
  assert.equal(h.writes.length, 0);
  h.set('custom'); assert.equal(h.root.hidden, true); assert.equal(h.body.dataset.worldTheme, undefined);
});

test('new garden scenes draw and restore automatic page selection without account writes', () => {
  const h = harness();
  h.node('.world-follow').change({ target: { checked: false } });
  for (const [mode, scene, world] of [['cherryGarden', 2, 'blossom'], ['lavenderField', 1, 'lavender'], ['rainyCafe', 0, 'cafe']]) {
    h.set(mode); h.scenes[scene].click();
    assert.equal(h.body.dataset.worldTheme, world);
    h.show();
    for (const button of h.scenes) {
      button.click();
      const callback = h.frames.values().next().value;
      h.frames.clear(); callback(1000);
      assert.equal(h.frames.size, 1);
    }
    h.scenes[scene].click();
  }
  const last = h.writes.at(-1);
  const restored = harness(last.value);
  for (const [mode, scene] of [['cherryGarden', '2'], ['lavenderField', '1'], ['rainyCafe', '0']]) {
    restored.set(mode); assert.equal(restored.root.dataset.scene, '1');
    assert.equal(restored.writes.length, 0);
  }
  assert.ok(h.writes.every(write => write.key === 'journal_world_preferences_v1'));
});

test('animation stops while hidden, collapsed, disabled or reduced-motion and only one loop resumes', () => {
  const h = harness(); h.set('secretForest'); h.show();
  assert.equal(h.frames.size, 1);
  h.view('memo'); h.resize(); assert.equal(h.frames.size, 1);
  h.context.document.hidden = true; h.events.visibilitychange(); assert.equal(h.frames.size, 0);
  h.context.document.hidden = false; h.events.visibilitychange(); assert.equal(h.frames.size, 1);
  h.node('.world-collapse').click(); assert.equal(h.frames.size, 0);
  h.node('.world-collapse').click(); assert.equal(h.frames.size, 1);
  h.node('.world-motion').click(); assert.equal(h.frames.size, 0);
  h.node('.world-motion').click(); assert.equal(h.frames.size, 1);
  h.media.change({ matches: true }); assert.equal(h.frames.size, 0);
  h.set('dark'); assert.equal(h.frames.size, 0);
});

test('old manual pause preferences no longer suppress automatic scenery after reload', () => {
  const h = harness('{invalid'); h.set('wood');
  h.node('.world-follow').change({ target: { checked: false } });
  h.scenes[2].click(); h.view('calendar'); assert.equal(h.root.dataset.scene, '2');
  h.node('.world-motion').click();
  const last = h.writes.at(-1); assert.equal(last.key, 'journal_world_preferences_v1');
  const restored = harness(last.value); restored.set('wood'); restored.show();
  assert.equal(restored.root.dataset.scene, '1'); assert.equal(restored.frames.size, 1);
  restored.node('.world-follow').change({ target: { checked: true } }); assert.equal(restored.root.dataset.scene, '1');
});

test('panoramic animals and sidebar garden share the clock and stop with the existing controls', () => {
  const h = harness(), heroTimes = [], sideTimes = [];
  h.context.window.storybookPanorama = { draw(_c, _w, _h, _theme, _scene, time) { heroTimes.push(time); } };
  h.context.window.storybookSidebar = { draw(_c, _w, _h, _theme, _scene, time) { sideTimes.push(time); } };
  h.set('wood'); h.show();
  assert.equal(h.node('.journal-side-life').hidden, false);
  for (const now of [1000, 1100, 1200]) {
    const callback = h.frames.values().next().value; h.frames.clear(); callback(now);
    assert.equal(h.frames.size, 1);
  }
  assert.deepEqual(heroTimes, sideTimes);
  assert.ok(heroTimes.at(-1) > heroTimes[0]);
  h.node('.world-motion').click(); assert.equal(h.frames.size, 0);
  const frozen = heroTimes.length;
  h.context.document.hidden = true; h.events.visibilitychange();
  h.context.document.hidden = false; h.events.visibilitychange();
  assert.equal(heroTimes.length, frozen); assert.equal(h.frames.size, 0);
  h.node('.world-motion').click(); assert.equal(h.frames.size, 1);
  h.node('.world-collapse').click();
  assert.equal(h.node('.journal-side-life').hidden, true); assert.equal(h.frames.size, 0);
  h.node('.world-collapse').click();
  assert.equal(h.node('.journal-side-life').hidden, false); assert.equal(h.frames.size, 1);
  h.media.change({ matches: true }); assert.equal(h.frames.size, 0);
  h.set('custom'); assert.equal(h.node('.journal-side-life').hidden, true);
});
