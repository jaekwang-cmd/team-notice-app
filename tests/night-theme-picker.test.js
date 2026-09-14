const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const renderer = fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8');
const themeSource = fs.readFileSync(path.join(__dirname, '../src/renderer/theme.js'), 'utf8');

function pickerHarness(options = {}) {
  const css = new Map(), writes = [], notices = [];
  let change, settingsOpened = 0, form;
  const picker = { value: '', disabled: false, children: [], appendChild(node) { this.children.push(node); }, addEventListener(_name, handler) { change = handler; } };
  const closeButton = {};
  const body = { dataset: {}, setAttribute() {} };
  const settingsPanel = { hidden: false, classList: { add() { settingsPanel.hidden = true; } } };
  const context = {
    document: {
      body,
      documentElement: { style: { setProperty: (key, value) => css.set(key, value), removeProperty: key => css.delete(key) } },
      createElement: () => ({}),
      getElementById(id) {
        if (id === 'journal-theme-select') return picker;
        if (id === 'settings-close') return closeButton;
        if (id === 'btn-settings') return { async onclick() { settingsOpened++; if (options.openError) throw Error('open failed'); } };
        return null;
      },
    },
    window: { api: {
      async getTheme() { if (options.readError) throw Error('read failed'); return { ...context.lastSavedTheme }; },
      async setTheme(value) { if (options.save) await options.save(); if (options.saveError) throw Error('save failed'); writes.push(value); },
    } },
    fillThemeInputs(value) { form = value; },
    currentThemeFromForm: () => ({ ...form }),
    showToast: text => notices.push(text),
    settingsPanel,
  };
  vm.runInNewContext(themeSource + '\nthis.presets = THEME_PRESETS;', context);
  context.lastSavedTheme = { ...context.presets.wood, mode: 'wood', font: "'Batang', serif", bold: true, cardStyle: 'flat', dateFontSize: '17', eventFontSize: '14' };
  form = { ...context.lastSavedTheme };
  const start = renderer.indexOf('const journalThemeSelect =');
  const end = renderer.indexOf('\ndocument.querySelectorAll(\'input[name="card-style"]\')', start);
  assert.ok(start > 0 && end > start, 'actual quick-picker handler found');
  vm.runInNewContext(renderer.slice(start, end), context);
  const closeStart = renderer.indexOf("document.getElementById('settings-close').onclick =");
  const closeEnd = renderer.indexOf('\n};', closeStart) + 3;
  vm.runInNewContext(renderer.slice(closeStart, closeEnd), context);
  context.applyTheme(context.lastSavedTheme);
  return { css, context, picker, notices, writes, settingsPanel, settingsOpened: () => settingsOpened, close: () => closeButton.onclick(), async select(mode) { picker.value = mode; return change(); } };
}

test('quick theme selection saves only theme and preserves custom font, boldness and calendar sizing', async () => {
  const h = pickerHarness();
  const original = { ...h.context.lastSavedTheme };
  await h.select('nightStudy');
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].mode, 'nightStudy');
  for (const key of ['font', 'bold', 'cardStyle', 'dateFontSize', 'eventFontSize']) assert.equal(h.writes[0][key], original[key]);
  assert.equal(h.writes[0].calendarBg, '#f5f0e6');
  assert.equal(h.picker.value, 'nightStudy');
  assert.equal(h.picker.disabled, false);
});

test('quick picker remains disabled until save settles and restores old theme when save rejects', async () => {
  let settle, markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const h = pickerHarness({ save: () => new Promise(resolve => { settle = resolve; markStarted(); }), saveError: true });
  const pending = h.select('nightStudy');
  await started;
  assert.equal(h.picker.disabled, true);
  assert.equal(h.context.document.body.dataset.journalTheme, 'wood');
  settle();
  await pending;
  assert.equal(h.writes.length, 0);
  assert.equal(h.picker.value, 'wood');
  assert.equal(h.picker.disabled, false);
  assert.equal(h.notices.length, 1);
});

test('a failed theme read restores the selected option without writes', async () => {
  const h = pickerHarness({ readError: true });
  await h.select('nightStudy');
  assert.equal(h.writes.length, 0);
  assert.equal(h.picker.value, 'wood');
  assert.equal(h.picker.disabled, false);
  assert.equal(h.context.document.body.dataset.journalTheme, 'wood');
});

test('custom opens settings without saving and a failed open restores the selected option', async () => {
  const h = pickerHarness();
  await h.select('custom');
  assert.equal(h.settingsOpened(), 1);
  assert.equal(h.writes.length, 0);
  const failed = pickerHarness({ openError: true });
  await failed.select('custom');
  assert.equal(failed.picker.value, 'wood');
  assert.equal(failed.writes.length, 0);
  assert.equal(failed.notices.length, 1);
});

test('settings cancel returns to the newly saved quick theme after an unsaved preview', async () => {
  const h = pickerHarness();
  await h.select('nightStudy');
  h.context.applyTheme({ ...h.context.presets.dark, mode: 'dark' });
  assert.equal(h.picker.value, 'dark');
  h.close();
  assert.equal(h.picker.value, 'nightStudy');
  assert.equal(h.context.document.body.dataset.journalTheme, 'nightStudy');
  assert.equal(h.settingsPanel.hidden, true);
  assert.equal(h.writes.length, 1);
});
