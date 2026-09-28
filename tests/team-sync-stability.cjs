const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('main.js','utf8');
const range = (a,b) => source.slice(source.indexOf(a), source.indexOf(b,source.indexOf(a)));
const deferred = () => { let resolve,reject;const promise = new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup() {
 const data={}; let account='alice', session=1, signed=true; const calls=[];
 const store={get(k,d){return k.split('.').reduce((v,p)=>v?.[p],data)??d},set(k,v){const parts=k.split('.');let o=data;for(const p of parts.slice(0,-1))o=o[p]??={};o[parts.at(-1)]=v},get store(){return data}};
 const googleAuth={getAccountId:()=>account,getSessionGeneration:()=>session,isSignedIn:()=>signed,createEvent:async(c,p)=>{calls.push(['create',account,p]);return{id:account+'-event'}},updateEvent:async(c,p)=>{calls.push(['update',account,p])},deleteEvent:async(c,p)=>{calls.push(['delete',account,p])}};
 const ctx=vm.createContext({Buffer,console,Map,Set,Date,Notification:class {show(){}},config:{google:{}},teamEventMapStore:store,googleAuth,firebaseClient:{teamEventExists:async()=>false},firebaseHandle:{db:{}},TEAM_EVENT_COLOR_ID:'11',teamEventSyncInFlight:new Map(),teamEventsCache:[],isFirstTeamEventsSnapshot:true});
 vm.runInContext(range('let teamEventReverseMapCache','const TEAM_EVENT_COLOR_ID')+range('function teamEventSignature','function runTeamEventStartDateBackfill'),ctx);
 return {ctx,googleAuth,calls,data,store,switchAccount(name){account=name;session++},logout(){signed=false;session++}};
}
const event=(title='old')=>({id:'team1',title,start:{date:'2026-09-28'},end:{date:'2026-09-29'}});
(async()=>{
 const t=setup(); await t.ctx.syncTeamEventToCalendar(event(),{notify:false});t.switchAccount('bob');await t.ctx.syncTeamEventToCalendar(event(),{notify:false});assert.equal(t.calls.filter(c=>c[0]==='create').length,2);
 const q=setup(), gate=deferred(); q.googleAuth.createEvent=async(c,p)=>{q.calls.push(['create',p]);await gate.promise;return{id:'g'}};const old=q.ctx.syncTeamEventToCalendar(event(),{notify:false});const latest=q.ctx.syncTeamEventToCalendar(event('latest'),{notify:false});gate.resolve();await Promise.all([old,latest]);assert.equal(q.calls.at(-1)[2].summary,'👥 latest');
 q.googleAuth.deleteEvent=async()=>{throw Error('offline')};await q.ctx.handleTeamEventsUpdate([]);assert.equal(q.ctx.teamMappings().team1.pendingDelete,true);q.googleAuth.deleteEvent=async()=>{};await q.ctx.handleTeamEventsUpdate([]);assert.equal(q.ctx.teamMappings().team1,undefined);
 const stale=setup(), pending=deferred();stale.googleAuth.createEvent=async()=>{await pending.promise;return{id:'old'}};const job=stale.ctx.syncTeamEventToCalendar(event(),{notify:false});stale.switchAccount('bob');pending.resolve();await job;assert.deepEqual(stale.data,{});
 const legacy=setup();legacy.store.set('team1',{googleEventId:'legacy',signature:'old'});legacy.ctx.migrateLegacyTeamMappings();assert.equal(legacy.ctx.teamMappings().team1.googleEventId,'legacy');legacy.switchAccount('bob');legacy.ctx.migrateLegacyTeamMappings();assert.equal(legacy.ctx.teamMappings().team1,undefined);
 const memo=setup(), m=deferred(), updates=[];memo.googleAuth.listTasks=()=>m.promise;Object.assign(memo.ctx,{memosGeneration:0,handleMemosUpdate:x=>updates.push(x)});vm.runInContext(range('async function refreshMemosFromGoogleTasks','function startMemosSubscription'),memo.ctx);const refresh=memo.ctx.refreshMemosFromGoogleTasks();memo.logout();m.resolve([{text:'private'}]);await refresh;assert.equal(updates.length,0);
 const auth=setup(), token=deferred(), signedIn=[];auth.ctx.firebaseHandle.auth={};auth.ctx.firebaseClient.signInWithGoogleIdToken=async(a,t)=>{signedIn.push(t);await token.promise};auth.ctx.firebaseClient.signOutFirebase=async()=>signedIn.push('out');vm.runInContext(range('let firebaseAuthTransition','async function trySignInFirebaseFromStoredGoogleSession'),auth.ctx);const restoring=auth.ctx.signInFirebaseForSession('old-token',1);await Promise.resolve();await Promise.resolve();auth.logout();token.resolve();await restoring;assert.deepEqual(signedIn,['old-token','out']);await auth.ctx.signInFirebaseForSession('stale-token',1);assert.equal(signedIn.length,2);
 console.log('PASS account isolation, latest update queue, failed delete retry, stale session, legacy migration, memo late response');
})().catch(e=>{console.error(e);process.exitCode=1});
