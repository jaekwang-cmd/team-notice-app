const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function themeHarness() {
  const css = new Map(), requestedFonts = [];
  const body = { dataset: {}, setAttribute(key, value) { this[key] = value; } };
  const preview = { style: {} };
  const themeSelect = {}, themeName = {};
  const elements = { 'theme-font-preview': preview, 'journal-theme-select': themeSelect, 'journal-theme-name': themeName };
  const context = {
    window: { appFonts: { ensureLoaded(font) { requestedFonts.push(font); } } },
    document: {
      body,
      documentElement: { style: { setProperty: (key, value) => css.set(key, value), removeProperty: key => css.delete(key) } },
      getElementById: id => elements[id],
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/theme.js'), 'utf8')
    + '\nthis.presets = THEME_PRESETS; this.meta = THEME_PRESET_META;', context);
  return { css, body, preview, themeSelect, themeName, requestedFonts, context, apply: (mode, overrides = {}) => context.applyTheme({ ...context.presets[mode], mode, ...overrides }) };
}

test('night study is selectable alongside every existing preset and uses a readable paper calendar', () => {
  const h = themeHarness();
  const ids = Array.from(h.context.meta, item => item.id);
  assert.deepEqual(ids, ['wood', 'nightStudy', 'secretForest', 'starObservatory', 'sunsetLetter', 'winterCabin', 'dark', 'light', 'softDark', 'midnight', 'forest', 'ocean', 'lavender']);
  assert.equal(h.context.meta.find(item => item.id === 'nightStudy').label, '밤의 서재');
  h.apply('nightStudy');
  assert.equal(h.body.dataset.journalTheme, 'nightStudy');
  assert.equal(h.themeSelect.value, 'nightStudy');
  assert.equal(h.themeName.textContent, '밤의 서재');
  assert.equal(h.css.get('--color-calendar-bg'), '#f5f0e6');
  assert.equal(h.css.get('--color-text-primary'), '#3d382f');
  assert.equal(h.css.get('--color-button-text'), '#fcf8ee');
  assert.equal(h.css.get('--calendar-event-font-size'), '11px');
});

test('theme switching removes default night study typefaces without writing stored preferences', () => {
  const h = themeHarness();
  h.apply('nightStudy');
  assert.match(h.css.get('--journal-serif'), /Gowun Batang/);
  assert.match(h.css.get('--journal-note-font'), /Nanum Pen Script/);
  assert.equal(h.requestedFonts.length, 2);
  assert.equal(h.css.has('--font-family'), false);
  h.apply('wood');
  assert.equal(h.body.dataset.journalTheme, 'wood');
  assert.equal(h.themeSelect.value, 'wood');
  assert.equal(h.themeName.textContent, '나의 다이어리');
  assert.equal(h.css.has('--journal-serif'), false);
  assert.equal(h.css.has('--journal-note-font'), false);
  assert.equal(h.css.get('--color-calendar-bg'), '#fcfaf6');
  h.apply('dark');
  assert.equal(h.body.dataset.journalTheme, 'other');
  assert.equal(h.requestedFonts.length, 2);
  h.apply('custom');
  assert.equal(h.themeSelect.value, 'custom');
  h.apply('unrecognized-mode');
  assert.equal(h.themeSelect.value, 'custom');
  h.context.applyTheme({});
  assert.equal(h.themeSelect.value, 'dark');
});

test('chosen typography and calendar preferences take precedence over night study defaults', () => {
  const h = themeHarness();
  const font = "'Nanum Gothic', 'Malgun Gothic', sans-serif";
  h.apply('nightStudy', { font, bold: true, cardStyle: 'flat', dateFontSize: '17', eventFontSize: '14' });
  for (const key of ['--font-family', '--journal-serif', '--journal-note-font']) assert.equal(h.css.get(key), font);
  assert.deepEqual(h.requestedFonts, [font]);
  assert.equal(h.preview.style.fontFamily, font);
  assert.equal(h.css.get('--calendar-date-font-size'), '17px');
  assert.equal(h.css.get('--calendar-event-font-size'), '14px');
  assert.equal(h.body['data-bold'], 'true');
  assert.equal(h.body['data-card-style'], 'flat');
  h.apply('wood', { font });
  assert.equal(h.css.get('--journal-note-font'), font);
  h.apply('wood');
  assert.equal(h.css.has('--font-family'), false);
  assert.equal(h.css.has('--journal-note-font'), false);
});
