// Native Windows select menus do not reliably draw each option in its own typeface.
(() => {
  const pickers = new WeakMap();

  function install(select, resolveStack) {
    if (pickers.has(select)) return;
    const fieldLabel = select.labels[0];
    const button = document.createElement('button');
    button.type = 'button';
    button.id = select.id + '-trigger';
    button.className = 'font-picker-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-haspopup', 'listbox');
    const value = document.createElement('span');
    value.id = select.id + '-value';
    value.className = 'font-picker-value';
    button.append(value);

    const list = document.createElement('div');
    list.id = select.id + '-listbox';
    list.className = 'font-picker-list';
    list.setAttribute('role', 'listbox');
    list.popover = 'auto';
    button.popoverTargetElement = list;
    button.setAttribute('aria-controls', list.id);
    fieldLabel.id ||= select.id + '-label';
    button.setAttribute('aria-labelledby', fieldLabel.id);
    list.setAttribute('aria-labelledby', fieldLabel.id);
    fieldLabel.htmlFor = button.id;

    const rows = [];
    const groups = new Map();
    for (const option of select.options) {
      const group = option.parentElement;
      if (group.tagName === 'OPTGROUP' && !groups.has(group)) {
        const section = document.createElement('div');
        section.setAttribute('role', 'group');
        section.setAttribute('aria-label', group.label);
        const heading = document.createElement('div');
        heading.className = 'font-picker-group';
        heading.setAttribute('aria-hidden', 'true');
        heading.textContent = group.label;
        section.append(heading);
        list.append(section);
        groups.set(group, section);
      }
      const row = document.createElement('div');
      row.id = select.id + '-option-' + option.index;
      row.setAttribute('role', 'option');
      row.dataset.value = option.value;
      row.textContent = option.label;
      row.style.fontFamily = resolveStack(option.value);
      rows.push(row);
      (groups.get(group) || list).append(row);
    }
    select.hidden = true;
    select.after(button, list);

    let active = 0;
    const isOpen = () => list.matches(':popover-open');
    function sync() {
      const selected = rows[select.selectedIndex] || rows[0];
      value.textContent = selected.textContent;
      value.style.fontFamily = selected.style.fontFamily;
      button.disabled = select.disabled;
      for (const row of rows) row.setAttribute('aria-selected', String(row === selected));
    }
    function revealActive() {
      const rowRect = rows[active].getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      if (rowRect.top < listRect.top) list.scrollTop += rowRect.top - listRect.top - 4;
      else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom + 4;
    }
    function setActive(index) {
      rows[active].removeAttribute('data-active');
      active = Math.max(0, Math.min(index, rows.length - 1));
      rows[active].setAttribute('data-active', '');
      button.setAttribute('aria-activedescendant', rows[active].id);
      if (isOpen()) revealActive();
    }
    function position() {
      const rect = button.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const above = spaceBelow < Math.min(spaceAbove, 280);
      const width = Math.min(window.innerWidth - 16, Math.max(rect.width, 280));
      list.style.width = width + 'px';
      list.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
      list.style.top = above ? 'auto' : (rect.bottom + 4) + 'px';
      list.style.bottom = above ? (window.innerHeight - rect.top + 4) + 'px' : 'auto';
      list.style.maxHeight = Math.min(360, Math.max(0, above ? spaceAbove : spaceBelow)) + 'px';
    }
    function commit(index) {
      if (select.selectedIndex !== index) {
        select.selectedIndex = index;
        select.dispatchEvent(new Event('change', {bubbles: true}));
      }
      list.hidePopover();
      button.focus({preventScroll: true});
    }
    list.addEventListener('beforetoggle', event => {
      const opening = event.newState === 'open';
      button.setAttribute('aria-expanded', String(opening));
      if (opening) {
        sync();
        position();
        setActive(select.selectedIndex);
      } else button.removeAttribute('aria-activedescendant');
    });
    list.addEventListener('toggle', () => { if (isOpen()) revealActive(); });
    list.addEventListener('click', event => {
      const row = event.target.closest('[role="option"]');
      if (row) commit(rows.indexOf(row));
    });

    let prefix = '', lastKeyTime = 0;
    button.addEventListener('keydown', event => {
      if (event.isComposing || event.ctrlKey || event.metaKey) return;
      const key = event.key;
      if (key === 'Tab') {
        if (isOpen()) list.hidePopover();
        return;
      }
      if (key === 'Escape') {
        if (!isOpen()) return;
        list.hidePopover();
      } else if (key === 'Enter' || key === ' ') {
        if (isOpen()) commit(active);
        else list.showPopover();
      } else if (['Home', 'End', 'ArrowDown', 'ArrowUp'].includes(key)) {
        const wasOpen = isOpen();
        if (!wasOpen) list.showPopover();
        if (key === 'Home') setActive(0);
        else if (key === 'End') setActive(rows.length - 1);
        else if (wasOpen) setActive(active + (key === 'ArrowDown' ? 1 : -1));
      } else if (key.length === 1 && !event.altKey) {
        if (!isOpen()) list.showPopover();
        prefix = (event.timeStamp - lastKeyTime < 650 ? prefix : '') + key.toLocaleLowerCase();
        lastKeyTime = event.timeStamp;
        const index = rows.findIndex(row => row.textContent.toLocaleLowerCase().startsWith(prefix));
        if (index >= 0) setActive(index);
      } else return;
      event.preventDefault();
      event.stopPropagation();
    });
    window.addEventListener('resize', () => { if (isOpen()) position(); });
    document.addEventListener('scroll', event => {
      if (isOpen() && !list.contains(event.target)) position();
    }, true);
    select.addEventListener('change', sync);
    pickers.set(select, sync);
    sync();
  }
  window.fontPicker = {install, sync: select => pickers.get(select)?.()};
})();
