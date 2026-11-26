(() => {
  const fontStacks = new Map([
    ['story', '"Yeobaek Story", Batang, serif'],
    ['malgun', '"Malgun Gothic", sans-serif'],
    ['dotum', 'Dotum, sans-serif'],
    ['batang', 'Batang, serif'],
    ...window.appFonts.choices.map(font => [font.family, font.stack])
  ]);
  const weights = ['400', '500', '600', '700', '800'];
  const scales = ['90', '100', '110', '125', '140', '160', '180', '200'];
  const normalize = (value = {}) => ({
    family: fontStacks.has(value?.family) ? value.family : '',
    weight: weights.includes(value?.weight) ? value.weight : '',
    scale: scales.includes(value?.scale) ? value.scale : '100'
  });
  function apply(target, settings) {
    const stack = fontStacks.get(settings.family);
    target.toggleAttribute('data-type-family', Boolean(stack));
    target.toggleAttribute('data-type-weight', Boolean(settings.weight));
    target.style.setProperty('--simple-font', stack || '');
    target.style.setProperty('--simple-weight', settings.weight);
    target.style.setProperty('--simple-scale', Number(settings.scale) / 100);
    if (stack) window.appFonts.ensureLoaded(stack);
  }
  if (window.parent !== window) {
    window.addEventListener('message', event => {
      if (event.source === parent && event.data?.type === 'simple-typography') {
        apply(document.documentElement, normalize(event.data.value));
      }
    });
    parent.postMessage({type: 'simple-typography-ready'}, '*');
    return;
  }

  const frame = document.querySelector('#simple-pane');
  const trigger = document.querySelector('#simple-type-button');
  const panel = document.querySelector('#simple-type-panel');
  const family = document.querySelector('#simple-type-family');
  const weight = document.querySelector('#simple-type-weight');
  const scale = document.querySelector('#simple-type-scale');
  const groups = new Map();
  for (const font of window.appFonts.choices) {
    if (font.family === 'Gowun Batang') continue; // The bundled copy is available offline.
    if (!groups.has(font.group)) {
      const group = document.createElement('optgroup');
      group.label = font.group;
      groups.set(font.group, group);
      family.append(group);
    }
    groups.get(font.group).append(new Option(font.label.split(' · ')[0], font.family));
  }
  const key = 'yeobaek.desktop.simpleTypography.v1';
  let settings = normalize();
  try { settings = normalize(JSON.parse(localStorage.getItem(key))); } catch {}
  family.value = settings.family;
  weight.value = settings.weight;
  scale.value = settings.scale;
  window.fontPicker?.install(family, value => value
    ? window.appFonts.previewStack(fontStacks.get(value))
    : `Inter, ${window.appFonts.previewStack('Pretendard, "Malgun Gothic", sans-serif')}`);
  function send() {
    frame.contentWindow?.postMessage({type:'simple-typography', value:settings}, '*');
  }
  function positionPanel() {
    const rect = trigger.getBoundingClientRect();
    panel.style.top = (rect.bottom + 4) + 'px';
    const width = Math.min(340, window.innerWidth * 0.92);
    panel.style.right = Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - width - 8)) + 'px';
  }
  panel.addEventListener('beforetoggle', event => {
    if (event.newState === 'open') positionPanel();
  });
  window.addEventListener('resize', () => { if (panel.matches(':popover-open')) positionPanel(); });
  window.addEventListener('message', event => {
    if (event.source === frame.contentWindow && event.data?.type === 'simple-typography-ready') send();
  });
  panel.addEventListener('change', () => {
    settings = normalize({family:family.value, weight:weight.value, scale:scale.value});
    try { localStorage.setItem(key, JSON.stringify(settings)); } catch {}
    apply(document.body, settings);
    positionPanel();
    send();
  });
  apply(document.body, settings);
  send();
})();
