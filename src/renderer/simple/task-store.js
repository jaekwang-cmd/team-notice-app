(() => {
  const subscribers = new Set();
  let accepted = {rev:-1, scope:null, days:{},sync:'connecting',pendingCount:0,canEdit:false};
  let days = {};
  const pending = [];
  let tail = Promise.resolve();
  const calls = new Map();
  const bridge = window.simpleWidget;
  function request(action, value) {
    if (bridge) return action === 'read' ? bridge.readSimpleTasks() : bridge.mutateSimpleTask(value);
    const token = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      calls.set(token, {resolve, reject});
      parent.postMessage({type:'diary-task-request', token, action, value}, '*');
    });
  }
  function accept(snapshot) {
    if (!snapshot || snapshot.rev <= accepted.rev) return false;
    accepted = snapshot;
    return true;
  }
  function update(source) {
    days = pending.reduce((all, request) => request.scope === accepted.scope ? window.simpleTaskData.change(all, request.op) : all, accepted.days);
    for (const fn of subscribers) fn(source);
  }
  function external(snapshot) {
    const previous = accepted.scope;
    if (accept(snapshot)) update(previous !== accepted.scope ? 'scope' : 'external');
  }
  if (bridge) bridge.onSimpleTasks(external);
  else window.addEventListener('message', e => {
    if (e.source !== parent || !e.data) return;
    if (e.data.type === 'diary-task-state') external(e.data.value);
    if (e.data.type !== 'diary-task-reply') return;
    const call = calls.get(e.data.token);
    if (!call) return;
    calls.delete(e.data.token);
    if (e.data.error) call.reject(Error(e.data.error)); else call.resolve(e.data.value);
  });
  const ready = request('read').then(snapshot => { external(snapshot); update('ready'); });
  function mutate(op) {
    if (!accepted.canEdit) return Promise.reject(Error('계정 연결을 확인해 주세요.'));
    const entry = {scope:accepted.scope,op};
    pending.push(entry);
    try { update('local'); } catch (err) { pending.pop(); return Promise.reject(err); }
    const send = async () => {
      try {
        await ready;
        if (entry.scope !== accepted.scope) throw Error('계정이 바뀌었어요.');
        const snapshot = await request('change', entry);
        if (entry.scope !== accepted.scope) throw Error('계정이 바뀌었어요.');
        const needsRefresh = snapshot.rev > accepted.rev + 1 || accepted.rev > snapshot.rev;
        accept(snapshot);
        pending.shift();
        update(needsRefresh ? 'external' : 'confirmed');
      } catch (err) {
        pending.shift(); update('external'); throw err;
      }
    };
    const result = tail.then(send);
    tail = result.catch(() => {});
    return result;
  }
  function tasksFor(day, kind = 'task') {
    return (days[day] || []).filter(task => (task.kind || 'task') === kind);
  }
  window.simpleTasks = {
    status:() => ({scope:accepted.scope,sync:accepted.sync,pendingCount:accepted.pendingCount,canEdit:accepted.canEdit}),
    ready, tasksFor, noticesFor:day => tasksFor(day,'notice'),
    add(day, title, {kind = 'task', highlights = []} = {}) {
      const task = {id:crypto.randomUUID(),title:title.trim(),done:false};
      if (kind === 'notice') task.kind = kind;
      if (highlights.length) task.highlights = highlights;
      return mutate({kind:'add',day,task});
    },
    highlight:(day, id, highlights) => mutate({kind:'highlight',day,id,highlights}),
    edit(day, original, title, highlights) {
      const current = tasksFor(day,original.kind || 'task').find(item => item.id === original.id);
      if (!current || current.title !== original.title || JSON.stringify(current.highlights || []) !== JSON.stringify(original.highlights || [])) {
        const error = Error('항목이 바뀌었어요. 닫고 최신 내용을 확인해 주세요.');
        error.code = 'STALE_TASK_EDIT';
        return Promise.reject(error);
      }
      return mutate({kind:'edit',day,id:original.id,title,highlights});
    },
    restore:(day, task, index) => mutate({kind:'restore', day, task, index}),
    remove:(day, id) => mutate({kind:'remove', day, id}),
    setDone:(day, id, done) => mutate({kind:'setDone', day, id, done}),
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
  };
})();
