(() => {
  'use strict';
  const native = window.simpleWidget;
  const colors = [
    ['auto','시스템 기본색'], ['#ffffff','흰색'], ['#272a2f','차콜'],
    ['#fff1ad','노랑'], ['#f7d5df','분홍'], ['#d3e6ff','하늘'],
    ['#ceecd9','민트'], ['#e3dafa','라벤더'], ['#e3e7ec','회색']
  ];
  const textColors = [
    ['auto','자동'], ['#202426','먹색'], ['#ffffff','흰색'], ['#214e74','남색'],
    ['#126953','초록색'], ['#943d50','버건디']
  ];
  const el = id => document.getElementById(id);
  function addSwatches(container, group, options) {
    for (const [value, name] of options) {
      const label = document.createElement('label');
      label.title = name;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = group;
      input.value = value;
      input.setAttribute('aria-label', name);
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      if (value === 'auto') swatch.textContent = '◐';
      else swatch.style.backgroundColor = value;
      label.append(input, swatch);
      container.append(label);
    }
  }
  addSwatches(el('colors'), 'color', colors);
  addSwatches(el('text-colors'), 'textColor', textColors);
  const hints = {
    top: '',
    through: '위젯에 마우스를 2초간 두면 게이지가 차기 시작해요. 다 차면 위젯을 누를 수 있어요. 트레이 메뉴에서도 클릭 통과를 끌 수 있어요.',
    desktop: '바탕화면에서 위젯을 볼 수 있어요.'
  };
  const custom = el('text-color-custom');
  const sliders = [
    { input:el('opacity'), output:el('opacity-output'), unit:'%', label:'투명도', key:'opacity', convert:n => 100 - n },
    { input:el('font-size'), output:el('font-size-output'), unit:'px', label:'글자 크기', key:'fontSize', convert:n => n }
  ];
  const dragging = new Set();
  let timer;
  let pending = {};
  const error = el('error');
  function updateOutput(control) {
    const text = control.input.value + control.unit;
    control.output.value = text;
    control.input.setAttribute('aria-valuetext', control.label + ' ' + text);
  }
  function apply(prefs) {
    if (!prefs) return;
    const current = {fontWeight:500, fontSize:16, textColor:'auto', ...prefs};
    for (const choice of document.querySelectorAll('input[type=radio]')) choice.checked = String(current[choice.name]) === choice.value;
    el('mode-hint').textContent = hints[prefs.mode] || '';
    if (!Object.hasOwn(pending, 'textColor')) {
      if (current.textColor !== 'auto') custom.value = current.textColor;
      custom.parentElement.toggleAttribute('data-selected', !textColors.some(([value]) => value === current.textColor));
    }
    for (const control of sliders) {
      if (!dragging.has(control.key) && !Object.hasOwn(pending, control.key)) control.input.value = control.convert(current[control.key]);
      updateOutput(control);
    }
  }
  async function write(patch) {
    error.hidden = true;
    try { await native.setSettings(patch); }
    catch {
      error.textContent = '설정을 적용하지 못했어요.';
      error.hidden = false;
      try { apply(await native.getSettings()); } catch { /* The error remains visible. */ }
    }
  }
  function queueSetting(key, value) {
    pending[key] = value;
    if (!timer) timer = setTimeout(flush, 30);
  }
  async function flush() {
    clearTimeout(timer);
    timer = undefined;
    const patch = pending;
    pending = {};
    if (Object.keys(patch).length) await write(patch);
  }
  for (const control of document.querySelectorAll('input[type=radio]')) {
    control.onchange = () => {
      if (control.name === 'mode') el('mode-hint').textContent = hints[control.value];
      queueSetting(control.name, control.name === 'fontWeight' ? Number(control.value) : control.value);
      flush();
    };
  }
  for (const control of sliders) {
    control.input.addEventListener('pointerdown', () => { dragging.add(control.key); });
    const stop = () => dragging.delete(control.key);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    control.input.oninput = () => {
      updateOutput(control);
      queueSetting(control.key, control.convert(Number(control.input.value)));
    };
    control.input.onchange = flush;
  }
  custom.oninput = () => queueSetting('textColor', custom.value);
  custom.onchange = () => { queueSetting('textColor', custom.value); flush(); };
  async function close() {
    await flush();
    await native.close();
  }
  el('close').onclick = close;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  let seen = false;
  native.onSettings(prefs => { seen = true; apply(prefs); });
  native.getSettings().then(prefs => { if (!seen) apply(prefs); }).catch(() => {
    error.textContent = '위젯 설정을 불러오지 못했어요.';
    error.hidden = false;
  });
})();
