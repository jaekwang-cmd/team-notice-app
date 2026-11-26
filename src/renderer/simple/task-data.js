// Both the desktop writer and its two views use the same per-task edits.
(() => {
  const isDate = key => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key)
    && !Number.isNaN(Date.parse(key)) && new Date(key).toISOString().slice(0, 10) === key;
  const isId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  const highlightColors = new Set(['yellow','mint','blue','pink','lavender','peach']);
  function validHighlights(ranges, title) {
    if (!Array.isArray(ranges) || ranges.length > title.length) return false;
    let previousEnd = 0;
    for (const range of ranges) {
      if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end)
          || range.start < previousEnd || range.end <= range.start || range.end > title.length
          || !highlightColors.has(range.color)) return false;
      previousEnd = range.end;
    }
    return true;
  }
  const isTask = t => t && isId(t.id) && typeof t.title === 'string' && t.title.length <= 2000 && typeof t.done === 'boolean'
    && (t.kind === undefined || t.kind === 'task' || t.kind === 'notice')
    && (t.highlights === undefined || validHighlights(t.highlights, t.title));
  function assignHighlights(task, ranges) {
    if (ranges?.length) task.highlights = ranges.map(({start,end,color}) => ({start,end,color}));
    else delete task.highlights;
    return task;
  }
  function validDays(days) {
    return days && typeof days === 'object' && !Array.isArray(days) &&
      Object.entries(days).every(([key, list]) => isDate(key) && Array.isArray(list) && list.every(isTask));
  }
  function change(days, op) {
    if (!op || !isDate(op.day) || !['add', 'restore', 'remove', 'setDone', 'highlight', 'edit'].includes(op.kind)) throw Error('잘못된 할 일 변경입니다.');
    const list = days[op.day] || [];
    if (op.kind === 'add' || op.kind === 'restore') {
      if (!isTask(op.task) || !op.task.title.trim()) throw Error('할 일 내용을 확인해 주세요.');
      if (list.some(t => t.id === op.task.id)) return days;
      const next = list.slice();
      const item = {id:op.task.id, title:op.task.title, done:op.task.done};
      if (Number.isSafeInteger(op.task.createdAt)) item.createdAt = op.task.createdAt;
      if (op.task.kind === 'notice') item.kind = 'notice';
      assignHighlights(item, op.task.highlights);
      // Undo positions are relative to the visible task or notice panel.
      const sibling = op.kind === 'restore' && Number.isInteger(op.index)
        ? list.filter(t => (t.kind === 'notice') === (item.kind === 'notice'))[Math.max(0, op.index)] : null;
      next.splice(sibling ? list.indexOf(sibling) : next.length, 0, item);
      return {...days, [op.day]:next};
    }
    if (!isId(op.id) || (op.kind === 'setDone' && typeof op.done !== 'boolean')) throw Error('할 일의 상태를 확인해 주세요.');
    const task = list.find(t => t.id === op.id);
    if (!task || (op.kind === 'setDone' && task.done === op.done)) return days;
    if (op.kind === 'highlight' || op.kind === 'edit') {
      const title = op.kind === 'edit' ? op.title : task.title;
      if (typeof title !== 'string' || !title.trim() || title.length > 2000) throw Error('내용을 1~2,000자로 입력해 주세요.');
      const ranges = op.kind === 'edit' && op.highlights === undefined ? [] : op.highlights;
      if (!validHighlights(ranges, title)) throw Error('강조할 글자 범위를 확인해 주세요.');
      const updated = assignHighlights({...task, title}, ranges);
      return {...days, [op.day]:list.map(t => t === task ? updated : t)};
    }
    const next = op.kind === 'remove' ? list.filter(t => t.id !== op.id)
      : list.map(t => t.id === op.id ? {...t, done:op.done} : t);
    return {...days, [op.day]:next};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {change, validDays, isDate, isTask, validHighlights};
  else window.simpleTaskData = {change, validDays};
})();
