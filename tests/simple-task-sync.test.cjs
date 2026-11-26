const test = require('node:test');
const assert = require('node:assert/strict');
const { SimpleTaskSync } = require('../src/main/simple-task-sync.cjs');

const day='2026-11-25';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const add=id=>({kind:'add',day,task:{id,title:id,done:false}});
function harness() {
  let identity={};
  const storage=new Map(), subscriptions=new Map(), writes=[];
  const service=new SimpleTaskSync({
    identity:()=>identity,
    storage:{read:k=>storage.get(k),write:(k,record)=>storage.set(k,structuredClone(record)),remove:k=>storage.delete(k)},
    remote:{
      listen(uid,read,fail) {subscriptions.set(uid,{read,fail});return ()=>subscriptions.delete(uid);},
      write(uid,op,valid) {return new Promise((resolve,reject)=>writes.push({uid,op,valid,resolve,reject}));}
    },publish(){}
  });
  return {storage,subscriptions,writes,service,scope:identityValue=>{identity=identityValue;service.refresh();},
    mutate:op=>service.mutate({scope:service.read().scope,op})};
}
test('guest, connecting and per-account queues remain separate after an account change or late write',async()=>{
  const h=harness();
  const guest=h.mutate(add('guest'));
  h.scope({pending:true});
  assert.deepEqual(h.service.read().days,{});
  assert.throws(()=>h.service.mutate({scope:guest.scope,op:add('late')}),/계정/);
  h.scope({uid:'first'});
  const a=h.mutate(add('first-task'));
  assert.equal(a.pendingCount,1);
  await turn();
  const old=h.writes[0];
  assert.equal(old.uid,'first');assert(old.valid());
  const staleSnap=h.subscriptions.get('first').read;
  h.scope({uid:'second'});
  assert(!old.valid());
  staleSnap(a.days,false);
  old.resolve(old.op);
  await turn();
  assert.deepEqual(h.service.read().days,{});
  assert.throws(()=>h.service.mutate({scope:a.scope,op:add('late')}),/계정/);
  h.scope({});
  assert.equal(h.service.read().days[day][0].id,'guest');
  h.scope({uid:'first'});
  await turn();
  assert.equal(h.writes[1].op.task.createdAt,old.op.task.createdAt);
  h.writes[1].resolve(old.op);
  await turn();
  assert.equal(h.service.read().pendingCount,0);
  assert.equal(h.service.read().days[day][0].id,'first-task');
  h.service.stop();
});
test('offline journal survives service restart, server snapshot overlays pending edits and a missing remote item stays removed',async()=>{
  const h=harness();h.scope({uid:'u'});
  const first=h.mutate(add('a'));
  await turn();h.writes[0].reject(Object.assign(Error(),{code:'unavailable'}));await turn();
  assert.equal(h.service.read().sync,'offline');
  h.service.stop();h.service.refresh();await turn();
  assert.equal(h.writes.length,2);
  h.subscriptions.get('u').read({},true);
  assert.equal(h.service.read().days[day][0].id,'a');
  h.writes[1].resolve(h.writes[1].op);await turn();
  h.mutate({kind:'setDone',day,id:'a',done:true});
  h.subscriptions.get('u').read({},false);
  await turn();h.writes[2].resolve({kind:'remove',id:'a',day});await turn();
  assert.equal(h.service.read().pendingCount,0);
  assert.deepEqual(h.service.read().days,{});
  assert.notEqual(h.service.read().scope,first.scope);
  h.service.stop();
});
test('account deletion blocks new edits, waits for active writes and erases its cache',async()=>{
  const h=harness();h.scope({uid:'u'});const a=h.mutate(add('x'));await turn();
  const blocked=h.service.suspendForDeletion('u');
  assert.deepEqual(h.service.read().days,{});
  assert.throws(()=>h.service.mutate({scope:a.scope,op:add('stale')}));
  h.writes[0].resolve(h.writes[0].op);await blocked;
  h.service.forgetAccount('u');h.scope({});
  assert.equal(h.storage.has('user:u'),false);
  h.service.stop();
});
test('notices and highlights survive sync, restart, undo and scope changes without entering the mobile collection', async () => {
  const h = harness();
  h.scope({uid:'u'});
  const colors = [{start:0,end:2,color:'blue'}];
  const mark = {kind:'highlight',day,id:'t',highlights:colors};
  h.mutate({kind:'add',day,task:{id:'t',title:'견적 확인',done:false,highlights:colors}});
  await turn();
  const upload = h.writes[0].op;
  assert.deepEqual(Object.keys(upload.task).sort(), ['createdAt','done','id','title']);
  const notice = {id:'n',title:'공지 사항',done:false,kind:'notice',highlights:colors};
  h.mutate({kind:'add',day,task:notice});
  h.mutate({kind:'setDone',day,id:'n',done:true});
  const recolor = [{start:3,end:5,color:'mint'}];
  h.mutate({...mark,highlights:recolor});
  h.subscriptions.get('u').read({},false);
  h.writes[0].resolve(upload);
  await turn();
  h.subscriptions.get('u').read({[day]:[{...upload.task,done:true}]},false);
  h.service.stop();
  h.service.refresh();
  let [task, savedNotice] = h.service.read().days[day];
  assert.deepEqual(task.highlights,recolor);
  assert.equal(task.done,true);
  assert.deepEqual(savedNotice.highlights,colors);
  assert.equal(savedNotice.kind,'notice');
  assert.equal(savedNotice.done,true);
  h.mutate({kind:'remove',day,id:'n'});
  h.mutate({kind:'restore',day,task:savedNotice,index:0});
  h.mutate({...mark,id:'n',highlights:[]});
  assert.equal(h.service.read().days[day][1].highlights,undefined);
  assert.equal(h.writes.length,1);
  assert.equal(h.service.read().pendingCount,0);
  h.scope({uid:'other'});
  assert.deepEqual(h.service.read().days,{});
  h.scope({});
  assert.deepEqual(h.service.read().days,{});
  h.scope({uid:'u'});
  assert.equal(h.service.read().days[day].length,2);
  h.service.stop();
});

test('editing updates the original item and only sends task title changes to the shared account', async () => {
  const h = harness();
  h.scope({uid:'owner'});
  try {
    const task = {id:'existing',title:'안내 전송',done:true,createdAt:1234};
    h.subscriptions.get('owner').read({[day]:[task]}, false);
    const highlights = [{start:0,end:2,color:'mint'}];
    const edit = {kind:'edit',day,id:task.id,title:'견적 전송',highlights};
    const result = h.mutate(edit);
    assert.deepEqual(result.days[day], [{...task,title:edit.title,highlights}]);
    await turn();
    const write = h.writes[0];
    assert.deepEqual(write.op, {kind:'edit',day,id:task.id,title:edit.title});
    write.resolve(write.op);
    await turn();
    const recolored = [{start:3,end:5,color:'blue'}];
    h.mutate({...edit,highlights:recolored});
    assert.equal(h.service.read().pendingCount, 0);
    const notice = {id:'notice',title:'개인 공지',done:true,kind:'notice'};
    h.mutate({kind:'add',day,task:notice});
    h.mutate({...edit,id:notice.id,title:'변경 공지'});
    assert.equal(h.service.read().pendingCount, 0);
    h.service.stop();
    h.service.refresh();
    assert.deepEqual(h.service.read().days[day][0], {...task,title:edit.title,highlights:recolored});
    assert.equal(h.service.read().days[day][1].title,'변경 공지');
    // A title changed on a different device must not reuse offsets for unrelated text.
    h.subscriptions.get('owner').read({[day]:[{...task,title:'다른 내용'}]},false);
    assert.equal(h.service.read().days[day][0].highlights, undefined);
    assert.equal(h.writes.length,1);
  } finally { h.service.stop(); }
});

test('highlight ranges use UTF-16 offsets and reject malformed values without altering saved content', () => {
  const {change} = require('../src/renderer/simple/task-data.js');
  const title = '전화☎️ & 확인';
  const days = change({}, {kind:'add',day,task:{id:'a',title,done:false}});
  const patch = highlights => change(days,{kind:'highlight',day,id:'a',highlights});
  const valid = [{start:2,end:4,color:'peach'}, {start:7,end:9,color:'lavender'}];
  assert.equal(title.slice(valid[0].start,valid[0].end),'☎️');
  assert.deepEqual(patch(valid)[day][0].highlights,valid);
  for (const invalid of [
    [{start:-1,end:1,color:'mint'}], [{start:0,end:0,color:'pink'}],
    [{start:0,end:99,color:'blue'}], [{start:0,end:1,color:'url()'}],
    [{start:0,end:3,color:'pink'},{start:2,end:4,color:'pink'}], 'bad'
  ]) assert.throws(() => patch(invalid));
  assert.equal(days[day][0].highlights,undefined);
});
test('renderer drops stale optimistic edits and late acknowledgments after an account switch',async()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const vm=require('node:vm');
  const taskData=require('../src/renderer/simple/task-data.js');
  const snapshot=(scope,rev,days={})=>({scope,rev,days,canEdit:true,sync:'synced',pendingCount:0});
  let onState;
  const pending=[];
  const window={simpleTaskData:taskData,simpleWidget:{
    onSimpleTasks:fn=>{onState=fn;},
    readSimpleTasks:async()=>snapshot('A',1),
    mutateSimpleTask:req=>new Promise(resolve=>pending.push({req,resolve}))
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/renderer/simple/task-store.js'),'utf8'),
    {window,crypto:require('node:crypto')});
  const store=window.simpleTasks;
  await store.ready;
  const a1=store.add(day,'A1');
  const a2=store.add(day,'A2');
  const reject1=assert.rejects(a1,/계정/), reject2=assert.rejects(a2,/계정/);
  await turn();
  assert.equal(store.tasksFor(day).length,2);
  onState(snapshot('B',4));
  assert.equal(store.tasksFor(day).length,0);
  const b=store.add(day,'B-only');
  pending[0].resolve(snapshot('A',3));
  await Promise.all([reject1,reject2]);
  await turn();
  assert.deepEqual(pending.map(p=>p.req.scope),['A','B']);
  const bDays=taskData.change({},pending[1].req.op);
  pending[1].resolve(snapshot('B',5,bDays));await b;
  assert.deepEqual(Array.from(store.tasksFor(day),t=>t.title),['B-only']);
  const ranges = [{start:0,end:2,color:'yellow'}];
  const notice = store.add(day,'  공지 하나  ',{kind:'notice',highlights:ranges});
  await turn();
  assert.equal(store.tasksFor(day).length,1);
  assert.deepEqual(Array.from(store.noticesFor(day),t=>t.title),['공지 하나']);
  assert.equal(store.tasksFor(day,'notice')[0].highlights[0].color,'yellow');
  const nDays = taskData.change(bDays,pending[2].req.op);
  pending[2].resolve(snapshot('B',6,nDays));
  await notice;
  const cleared = store.highlight(day,store.noticesFor(day)[0].id,[]);
  await turn();
  assert.equal(store.noticesFor(day)[0].highlights,undefined);
  const cDays = taskData.change(nDays,pending[3].req.op);
  pending[3].resolve(snapshot('B',7,cDays));
  await cleared;
});
