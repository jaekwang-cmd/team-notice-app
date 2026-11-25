const { randomUUID } = require('node:crypto');
const { change, validDays } = require('../renderer/simple/task-data');

// The journal is committed locally before the renderer receives its receipt.
// A new account gets its own cache, queue, listener and opaque editing scope.
class SimpleTaskSync {
  constructor({ identity, storage, remote, publish }) {
    Object.assign(this, { identity, storage, remote, publish });
    this.revision = 0;
    this.active = null;
    this.blockedUid = null;
  }
  refresh() {
    const identity = this.identity();
    const key = this.blockedUid && identity.uid === this.blockedUid ? 'connecting' : identity.uid ? 'user:'+identity.uid : identity.pending ? 'connecting' : 'device';
    if (key === this.active?.key) return;
    this.stop();
    const record = key === 'connecting' ? null : this.storage.read(key);
    if (record && (!validDays(record.base) || !Array.isArray(record.queue))) throw Error('저장된 할 일을 읽을 수 없어요.');
    const state = this.active = {
      key, uid:key.startsWith('user:') ? identity.uid : null, scope:randomUUID(), record:record || {base:{},queue:[]},
      sync:key === 'device' ? 'device' : key === 'connecting' ? 'connecting' : 'offline',
      unsubscribe:null, timer:null, writing:null, delay:1000
    };
    this.emit();
    if (state.uid) this.listen(state);
  }
  current(state) {
    return state === this.active && !!state.uid && state.uid === this.identity().uid && this.blockedUid !== state.uid;
  }
  stop() {
    const state = this.active;
    this.active = null;
    if (state) { state.unsubscribe?.(); clearTimeout(state.timer); }
  }
  snapshot() {
    const {scope,key,record,sync} = this.active;
    return {scope,rev:this.revision,sync,pendingCount:record.queue.length,canEdit:key !== 'connecting',
      days:record.queue.reduce(change,record.base)};
  }
  emit() {
    this.revision++;
    this.publish(this.snapshot());
  }
  save(state, record) {
    this.storage.write(state.key,record);
    state.record = record;
  }
  read() { this.refresh(); return this.snapshot(); }
  mutate({scope,op} = {}) {
    this.refresh();
    const state=this.active;
    if (scope !== state.scope || state.key === 'connecting') throw Error('계정이 바뀌었어요. 목록을 확인한 뒤 다시 시도해 주세요.');
    if ((op?.kind === 'add' || op?.kind === 'restore') && op.task) {
      op = {...op, task:{...op.task, createdAt:op.kind === 'restore' && Number.isSafeInteger(op.task.createdAt) ? op.task.createdAt : Date.now()}};
    }
    const days = this.snapshot().days;
    const next = change(days, op);
    if (next !== days) {
      const record = state.uid ? {...state.record, queue:[...state.record.queue,op]} : {base:next,queue:[]};
      this.save(state,record);
      if (state.uid) {
        if (state.sync === 'synced') state.sync = 'pending';
        this.pump(state);
      }
      this.emit();
    }
    return this.snapshot();
  }
  listen(state) {
    if (!this.current(state)) return;
    state.unsubscribe?.();
    state.unsubscribe = this.remote.listen(state.uid, (days, cache) => {
      if (!this.current(state)) return;
      if (cache) {
        if (state.sync !== 'offline') { state.sync='offline'; this.emit(); }
        return;
      }
      this.save(state,{...state.record,base:days});
      state.sync = state.record.queue.length ? 'pending' : 'synced';
      if (!state.record.queue.length) state.delay=1000;
      this.emit();
      this.pump(state);
    }, error => {
      if (!this.current(state)) return;
      this.retry(state,error);
    });
    this.pump(state);
  }
  retry(state,error) {
    state.sync = ['permission-denied','unauthenticated'].includes(error?.code) ? 'error' : 'offline';
    this.emit();
    if (state.timer) return;
    state.timer=setTimeout(()=>{
      state.timer=null;
      if (this.current(state)) this.listen(state);
    },state.delay);
    state.delay=Math.min(60000,state.delay*2);
  }
  pump(state) {
    if (!this.current(state) || state.writing || state.timer || !state.record.queue.length) return;
    const op=state.record.queue[0];
    const operation = Promise.resolve().then(async ()=>{
      if (!this.current(state)) return;
      const confirmed=await this.remote.write(state.uid,op,()=>this.current(state));
      if (!this.current(state)) return;
      const base=change(state.record.base,confirmed);
      this.save(state,{base,queue:state.record.queue.slice(1)});
      state.sync=state.record.queue.length?'pending':'synced';
      state.delay=1000;
      this.emit();
    }).catch(error=>{
      if (this.current(state)) this.retry(state,error);
    }).finally(()=>{
      state.writing=null;
      if (this.current(state) && !state.timer) this.pump(state);
    });
    state.writing=operation;
  }
  async suspendForDeletion(uid) {
    this.refresh();
    if (this.active.uid !== uid) throw Error('계정 연결을 확인해 주세요.');
    const writing=this.active.writing;
    this.blockedUid=uid;
    this.refresh();
    if (!writing) return;
    let timeout;
    try {
      await Promise.race([writing,new Promise((_,reject)=>{
        timeout=setTimeout(()=>reject(Error('할 일 동기화가 끝나면 다시 시도해 주세요.')),15000);
      })]);
    } finally { clearTimeout(timeout); }
  }
  resumeAfterDeletion(uid) { if (this.blockedUid===uid) {this.blockedUid=null;this.refresh();} }
  forgetAccount(uid) { this.storage.remove('user:'+uid); }
}
module.exports = { SimpleTaskSync };
