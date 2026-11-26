const { ipcMain } = require('electron');
const { createHash } = require('node:crypto');
const Store = require('electron-store');
const { collection, doc, onSnapshot, runTransaction, deleteDoc } = require('firebase/firestore');
const { SimpleTaskSync } = require('./simple-task-sync.cjs');
const { isDate, isTask } = require('../renderer/simple/task-data');

function readTask(snapshot) {
  const {day,title,done,createdAt} = snapshot.data();
  const task = {id:snapshot.id,title,done,createdAt};
  return isDate(day) && isTask(task) && Number.isSafeInteger(createdAt) ? {day,task} : null;
}
module.exports = function registerTasks(getWindows, identity, getDb) {
  const store = new Store({name:'simple-diary-tasks'});
  const keyOf = key => 'list-'+createHash('sha256').update(key).digest('hex');
  const sync = new SimpleTaskSync({
    identity,
    storage:{
      read:key=>store.get(keyOf(key)),
      write:(key,record)=>store.set(keyOf(key),record),
      remove:key=>store.delete(keyOf(key)),
    },
    publish(state) {
      for (const win of getWindows()) win.webContents.send('simple-tasks:state', state);
    },
    remote:{
      listen(uid, receive, fail) {
        const list = collection(getDb(),'users',uid,'simpleTasks');
        return onSnapshot(list,{includeMetadataChanges:true},snapshot=>{
          if (snapshot.metadata.hasPendingWrites) return;
          const days={};
          for (const item of snapshot.docs) {
            const value=readTask(item);
            if (value) (days[value.day] ??= []).push(value.task);
          }
          for (const tasks of Object.values(days)) tasks.sort((a,b)=>a.createdAt-b.createdAt || a.id.localeCompare(b.id));
          receive(days,snapshot.metadata.fromCache);
        },fail);
      },
      async write(uid,op,isCurrent) {
        const db=getDb();
        const ref=doc(db,'users',uid,'simpleTasks',op.task?.id || op.id);
        if (op.kind === 'remove') { await deleteDoc(ref); return op; }
        return runTransaction(db,async transaction=>{
          const existing=await transaction.get(ref);
          if (!isCurrent()) throw Error('계정이 바뀌었어요.');
          if (op.kind === 'setDone' || op.kind === 'edit') {
            if (!existing.exists()) return {kind:'remove',id:op.id,day:op.day};
            transaction.update(ref,op.kind === 'edit' ? {title:op.title} : {done:op.done});
            return op;
          }
          if (existing.exists()) {
            const value=readTask(existing);
            if (!value) throw Error('저장된 할 일 형식을 확인해 주세요.');
            return {...op,...value};
          }
          const {title,done,createdAt}=op.task;
          transaction.set(ref,{day:op.day,title,done,createdAt});
          return op;
        });
      }
    }
  });
  function authorize(event) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !getWindows().some(win=>win.webContents === event.sender)) {
      throw Error('간편모드와 할 일 위젯에서만 사용할 수 있어요.');
    }
  }
  ipcMain.handle('simple-tasks:read', event=>{ authorize(event); return sync.read(); });
  ipcMain.handle('simple-tasks:change', (event,operation)=>{ authorize(event); return sync.mutate(operation); });
  return sync;
};
