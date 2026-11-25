// Both the desktop writer and its two views use the same per-task edits.
(() => {
  const isDate = key => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key)
    && !Number.isNaN(Date.parse(key)) && new Date(key).toISOString().slice(0, 10) === key;
  const isId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  const isTask = t => t && isId(t.id) && typeof t.title === 'string' && t.title.length <= 2000 && typeof t.done === 'boolean';
  function validDays(days) {
    return days && typeof days === 'object' && !Array.isArray(days) &&
      Object.entries(days).every(([key, list]) => isDate(key) && Array.isArray(list) && list.every(isTask));
  }
  function change(days, op) {
    if (!op || !isDate(op.day) || !['add', 'restore', 'remove', 'setDone'].includes(op.kind)) throw Error('잘못된 할 일 변경입니다.');
    const list = days[op.day] || [];
    if (op.kind === 'add' || op.kind === 'restore') {
      if (!isTask(op.task) || !op.task.title.trim()) throw Error('할 일 내용을 확인해 주세요.');
      if (list.some(t => t.id === op.task.id)) return days;
      const next = list.slice();
      const index = op.kind === 'restore' && Number.isInteger(op.index) ? Math.max(0, op.index) : next.length;
      const item = {id:op.task.id, title:op.task.title, done:op.task.done};
      if (Number.isSafeInteger(op.task.createdAt)) item.createdAt = op.task.createdAt;
      next.splice(index, 0, item);
      return {...days, [op.day]:next};
    }
    if (!isId(op.id) || (op.kind === 'setDone' && typeof op.done !== 'boolean')) throw Error('할 일의 상태를 확인해 주세요.');
    const task = list.find(t => t.id === op.id);
    if (!task || (op.kind === 'setDone' && task.done === op.done)) return days;
    const next = op.kind === 'remove' ? list.filter(t => t.id !== op.id)
      : list.map(t => t.id === op.id ? {...t, done:op.done} : t);
    return {...days, [op.day]:next};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {change, validDays, isDate, isTask};
  else window.simpleTaskData = {change, validDays};
})();
