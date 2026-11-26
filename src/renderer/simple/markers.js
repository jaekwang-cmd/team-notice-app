(() => {
  'use strict';
  const colors = {yellow:'노랑', mint:'민트', blue:'하늘', pink:'분홍', lavender:'연보라', peach:'살구'};
  function compact(ranges) {
    const result = [];
    for (const range of [...ranges].sort((a,b) => a.start - b.start)) {
      if (range.end <= range.start) continue;
      const prev = result.at(-1);
      if (prev && prev.end === range.start && prev.color === range.color) prev.end = range.end;
      else result.push({...range});
    }
    return result;
  }
  function paint(ranges,start,end,color) {
    const next = [];
    for (const part of ranges) {
      if (part.end <= start || part.start >= end) next.push(part);
      else {
        if (part.start < start) next.push({...part,end:start});
        if (part.end > end) next.push({...part,start:end});
      }
    }
    if (color) next.push({start,end,color});
    return compact(next);
  }
  function render(container,text,ranges = []) {
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const part of ranges) {
      if (!Object.hasOwn(colors,part.color) || part.start < offset || part.end > text.length || part.end <= part.start) continue;
      fragment.append(text.slice(offset,part.start));
      const mark = document.createElement('mark');
      mark.className = 'diary-marker';
      mark.dataset.color = part.color;
      mark.textContent = text.slice(part.start,part.end);
      fragment.append(mark);
      offset = part.end;
    }
    fragment.append(text.slice(offset));
    container.replaceChildren(fragment);
  }
  function button(text,label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (label) b.setAttribute('aria-label',label);
    return b;
  }
  function attach(input,host,options = {}) {
    let ranges = compact(options.initial || []);
    let previous = input.value;
    let before = null;
    let wholeColor = colors[options.pendingColor] ? options.pendingColor : '';
    const trigger = button('형광펜','형광펜 색 선택');
    trigger.className = 'marker-trigger';
    trigger.setAttribute('aria-expanded','false');
    const menu = document.createElement('div');
    menu.className = 'marker-menu';
    menu.popover = 'auto';
    trigger.popoverTargetElement = menu;
    menu.setAttribute('role','group');
    menu.setAttribute('aria-label','형광펜 색');
    const help = document.createElement('p');
    help.textContent = '강조할 글자를 선택하세요. 선택하지 않으면 전체에 적용해요.';
    const palette = document.createElement('div');
    palette.className = 'marker-swatches';
    const preview = document.createElement('div');
    preview.className = 'marker-preview';
    host.append(trigger,menu);
    menu.append(help,palette,preview);
    function feedback() {
      const last = wholeColor || ranges.at(-1)?.color || '';
      trigger.dataset.color = last;
      trigger.title = last ? '형광펜 · ' + colors[last] : '형광펜 색 선택';
      preview.hidden = !input.value;
      if (menu.matches(':popover-open')) render(preview,input.value,ranges);
    }
    for (const [color,name] of [...Object.entries(colors),['','지우기']]) {
      const swatch = button(color ? '' : '지우기',color ? name + ' 형광펜' : '형광펜 지우기');
      swatch.dataset.color = color;
      swatch.title = name;
      swatch.addEventListener('click',() => {
        const start = input.selectionStart, end = input.selectionEnd;
        wholeColor = start === end ? color : '';
        ranges = start === end ? paint([],0,input.value.length,color) : paint(ranges,start,end,color);
        feedback();
        options.onChange?.(read());
        menu.hidePopover();
        input.focus({preventScroll:true});
        input.setSelectionRange(start,end);
      });
      palette.append(swatch);
    }
    function position() {
      const r = trigger.getBoundingClientRect();
      const maxLeft = innerWidth - menu.offsetWidth - 4;
      menu.style.left = Math.max(4,Math.min(r.right-menu.offsetWidth,maxLeft))+'px';
      const top = r.bottom + menu.offsetHeight + 4 <= innerHeight ? r.bottom+4 : r.top-menu.offsetHeight-4;
      menu.style.top = Math.max(4,top)+'px';
    }
    menu.addEventListener('toggle',() => {
      const open = menu.matches(':popover-open');
      trigger.setAttribute('aria-expanded',String(open));
      if (open) {
        feedback();
        position();
        palette.firstElementChild.focus({preventScroll:true});
      }
    });
    input.addEventListener('beforeinput',() => { before = [input.selectionStart,input.selectionEnd]; });
    input.addEventListener('input',() => {
      const value = input.value;
      if (wholeColor) ranges = paint([],0,value.length,wholeColor);
      else if (ranges.length && value !== previous) {
        // Use the actual caret as a boundary so editing repeated letters moves the correct marks.
        let start = 0, oldEnd = previous.length, newEnd = value.length;
        const maxPrefix = Math.min(before?.[0] ?? oldEnd,oldEnd,newEnd);
        while (start < maxPrefix && previous[start] === value[start]) start++;
        const minSuffix = Math.max(start,before?.[1] ?? start);
        while (oldEnd > minSuffix && newEnd > start && previous[oldEnd-1] === value[newEnd-1]) { oldEnd--; newEnd--; }
        const delta = newEnd-oldEnd, next = [];
        for (const r of ranges) {
          if (r.start < start) next.push({...r,end:Math.min(r.end,start)});
          if (r.start <= start && r.end >= oldEnd && (oldEnd > start || (r.start < start && r.end > start))) next.push({start,end:newEnd,color:r.color});
          if (r.end > oldEnd) next.push({...r,start:Math.max(r.start,oldEnd)+delta,end:r.end+delta});
        }
        ranges = compact(next);
      }
      previous = value;
      before = null;
      feedback();
      options.onChange?.(read());
    });
    function read() { return ranges.map(r => ({...r})); }
    function readTrimmed() {
      const begin = input.value.length - input.value.trimStart().length;
      const end = begin + input.value.trim().length;
      return compact(ranges.map(r => ({...r,start:Math.max(r.start,begin)-begin,end:Math.min(r.end,end)-begin})));
    }
    feedback();
    return {read,readTrimmed,pendingColor:() => wholeColor,reset(value = [],pendingColor = '') {
      ranges = compact(value);
      previous = input.value; before = null; wholeColor = pendingColor;
      if (menu.matches(':popover-open')) menu.hidePopover();
      feedback();
    }};
  }
  let editor;
  function closeEditor() { if (editor?.open) editor.close(); }
  function edit(anchor,task,onSave) {
    closeEditor();
    const dialog = document.createElement('dialog');
    editor = dialog;
    dialog.className = 'marker-editor';
    const label = task.kind === 'notice' ? '공지 수정' : '할 일 수정';
    dialog.setAttribute('aria-label',label);
    const heading = document.createElement('strong');
    heading.textContent = label;
    const input = document.createElement('input');
    input.type = 'text'; input.value = task.title; input.maxLength = 2000;
    input.setAttribute('aria-label','내용');
    const tools = document.createElement('div');
    const sample = document.createElement('div');
    sample.className = 'marker-sample';
    const initial = task.highlights || [];
    const marker = attach(input,tools,{initial,onChange:ranges=>render(sample,input.value,ranges)});
    render(sample,input.value,initial);
    const actions = document.createElement('div');
    actions.className = 'marker-actions';
    const cancel = button('취소');
    const save = button('저장');
    const error = document.createElement('small');
    error.setAttribute('role','alert');
    cancel.onclick = closeEditor;
    save.onclick = async () => {
      if (save.disabled) return;
      const title = input.value.trim();
      if (!title) {
        error.textContent = '내용을 입력해 주세요.';
        input.focus();
        return;
      }
      const ranges = marker.readTrimmed();
      if (title === task.title && JSON.stringify(ranges) === JSON.stringify(initial)) { dialog.close(); return; }
      error.textContent = '';
      save.disabled = cancel.disabled = input.disabled = true;
      try { await onSave(title,ranges); dialog.close(); }
      catch (reason) {
        error.textContent = reason?.code === 'STALE_TASK_EDIT'
          ? reason.message : '수정 내용을 저장하지 못했어요. 다시 시도해 주세요.';
        save.disabled = cancel.disabled = input.disabled = false;
      }
    };
    let composing = false;
    input.addEventListener('compositionstart',() => { composing = true; });
    input.addEventListener('compositionend',() => { composing = false; });
    input.addEventListener('keydown',event => {
      if (event.key === 'Enter' && !composing && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        save.click();
      }
    });
    dialog.addEventListener('cancel',event => { if (composing || save.disabled) event.preventDefault(); });
    actions.append(cancel,save);
    dialog.append(heading,input,tools,sample,error,actions);
    document.body.append(dialog);
    dialog.addEventListener('close',() => {
      if (editor === dialog) editor = null;
      dialog.remove();
      const target = anchor.isConnected ? anchor : document.getElementById(anchor.id);
      target?.focus({preventScroll:true});
    },{once:true});
    dialog.showModal();
    input.focus();
  }
  window.simpleMarkers = {attach,render,edit,closeEditor};
})();
