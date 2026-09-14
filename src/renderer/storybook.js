// Small presentation hooks only. Calendar and ledger actions stay in renderer.js.
(() => {
  let started = false;
  let queued = false;
  function queueSize() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; sizeCalendar(); });
  }
  function sizeCalendar() {
    const grid = document.getElementById('calendar-grid');
    if (!grid?.getClientRects().length || grid.children.length !== 42) return;
    const cells = [...grid.children];
    const fontStyle = getComputedStyle(document.documentElement);
    const dateSize = parseFloat(fontStyle.getPropertyValue('--calendar-date-font-size')) || 11;
    const header = Math.max(24, Math.ceil(dateSize * 1.8) + 4);
    const heights = [];
    for (let week = 0; week < 6; week++) {
      const days = cells.slice(week * 7, week * 7 + 7);
      let tracks = 0;
      days.forEach(cell => cell.querySelectorAll('.event-banner-segment').forEach(bar => {
        if (!bar.dataset.storyTrack) bar.dataset.storyTrack = String(Math.round((parseFloat(bar.style.top) - EVENT_BANNER_TOP_OFFSET) / (EVENT_BANNER_HEIGHT + EVENT_BANNER_GAP)));
        tracks = Math.max(tracks, Number(bar.dataset.storyTrack) + 1);
      }));
      let maxContents = 0;
      days.forEach(cell => {
        const dateRow = cell.querySelector('.day-cell-top-row');
        if (dateRow) Object.assign(dateRow.style, { position: 'absolute', top: '8px', left: '8px', right: '8px', width: 'auto' });
        const top = 8 + header + tracks * (EVENT_BANNER_HEIGHT + EVENT_BANNER_GAP);
        cell.style.paddingTop = `${top}px`;
        cell.querySelectorAll('.event-banner-segment').forEach(bar => {
          bar.style.top = `${8 + header + Number(bar.dataset.storyTrack) * (EVENT_BANNER_HEIGHT + EVENT_BANNER_GAP)}px`;
        });
        let contentHeight = top + 8;
        cell.querySelectorAll('.event-line,.event-more').forEach(line => {
          const style = getComputedStyle(line);
          contentHeight += line.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
        });
        maxContents = Math.max(maxContents, contentHeight);
      });
      heights.push(Math.max(92, Math.ceil(maxContents)));
    }
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    grid.style.gridTemplateRows = heights.map(height => `minmax(${height}px, 1fr)`).join(' ');
    grid.style.minHeight = `${heights.reduce((a, b) => a + b, 0) + gap * 5}px`;
  }
  function apply(theme) {
    document.body.dataset.storyTheme = theme.mode || 'wood';
    const current = window.storybookThemes.find(item => item.id === theme.mode);
    document.body.toggleAttribute('data-storybook', Boolean(current));
    const name = document.getElementById('journal-theme-name');
    if (name && current) name.textContent = current.label;
    // Keep the user's font choices. Only the default titles use the local story typeface.
    if (!theme.font) {
      document.body.style.setProperty('--world-serif', "'Yeobaek Story', 'Gowun Batang', 'Batang', serif");
      document.body.style.setProperty('--journal-serif', "'Yeobaek Story', 'Gowun Batang', 'Batang', serif");
    } else {
      document.body.style.setProperty('--world-serif', theme.font);
      document.body.style.setProperty('--journal-serif', theme.font);
    }
    if (started) queueSize();
  }
  function start() {
    if (started) return; started = true;
    apply(lastSavedTheme || {});
    const railToggle = document.getElementById('journal-rail-toggle');
    const railKey = 'yeobaek_desktop_rail_v1';
    function setRail(collapsed) {
      document.body.toggleAttribute('data-rail-collapsed', collapsed);
      railToggle?.setAttribute('aria-expanded', String(!collapsed));
      railToggle?.setAttribute('aria-label', collapsed ? '메뉴 펼치기' : '메뉴 접기');
      if (railToggle) railToggle.title = collapsed ? '메뉴 펼치기' : '메뉴 접기';
      queueSize();
    }
    try { setRail(localStorage.getItem(railKey) === 'collapsed'); } catch (_) { setRail(false); }
    railToggle?.addEventListener('click', () => {
      const collapsed = !document.body.hasAttribute('data-rail-collapsed');
      setRail(collapsed);
      try { localStorage.setItem(railKey, collapsed ? 'collapsed' : 'expanded'); } catch (_) {}
    });
    document.getElementById('journal-theme-select')?.setAttribute('aria-label', '아홉 가지 다이어리 분위기');
    const observer = new MutationObserver(queueSize);
    observer.observe(document.getElementById('calendar-grid'), { childList: true });
    observer.observe(document.querySelector('[data-view-pane="calendar"]'), { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', queueSize);
    document.fonts.ready.then(queueSize);
    queueSize();
  }
  window.storybookUI = { start, applyTheme: apply };
  window.addEventListener('yeobaek-ready', start, { once: true });
  if (window.yeobaekReady) start();
})();
