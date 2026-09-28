const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/main/googleAuth.js'), 'utf8');
const jwt = sub => `x.${Buffer.from(JSON.stringify({sub})).toString('base64url')}.x`;
function setup() {
  const data = new Map([['tokens', {id_token:jwt('A'),refresh_token:'synthetic'}]]);
  const state = {clients:[], inserts:[], responses:[]};
  class Client {
    constructor() { this.handlers={};state.clients.push(this); }
    on(name, fn) { this.handlers[name]=fn; }
    setCredentials() {}
    generateAuthUrl(opts) { state.auth=opts;return 'https://accounts.example/'; }
    async getToken(opts) { state.exchange=opts;return {tokens:{id_token:jwt('B'),refresh_token:'new-synthetic'}}; }
    async getAccessToken() { if(state.refresh) await state.refresh;this.handlers.tokens({access_token:'late-synthetic'}); }
  }
  const events={patch:async({eventId,requestBody})=>({data:{...requestBody,id:eventId}}),insert:async({requestBody})=>{state.inserts.push(requestBody);if(state.insert)return state.insert(requestBody);return {data:{...requestBody,id:requestBody.id}};},get:async({eventId})=>({data:{id:eventId,summary:'restored',start:{date:'2026-10-01'},end:{date:'2026-10-02'}}})};
  const requireMock=name=>({http:{createServer:handler=>{
    state.callback=handler;const server={listening:false,on(){},listen(port,host){state.host=host;server.listening=true;},close(){server.listening=false;}};return server;
  }},crypto,'google-auth-library':{OAuth2Client:Client},'@googleapis/calendar':{calendar:()=>({events})},'@googleapis/tasks':{tasks:()=>({})},electron:{shell:{openExternal:async()=>{state.opened=true;}}},'electron-store':class {get(k){return data.get(k);}set(k,v){data.set(k,v);}delete(k){data.delete(k);}}})[name];
  const context={require:requireMock,module:{exports:{}},Buffer,URL,setTimeout,clearTimeout,console};vm.createContext(context);vm.runInContext(source,context);
  const callback=(query,path='/oauth2callback',method='GET')=>{const response={status:200,setHeader(){},writeHead(s){this.status=s;},end(){}};state.callback({url:path+'?'+new URLSearchParams(query),method},response);return response.status;};
  return {api:context.module.exports,context,state,data,callback};
}
const cfg={clientId:'synthetic',clientSecret:'synthetic',redirectPort:43117};
test('OAuth rejects unrelated callbacks, validates state, binds loopback and exchanges PKCE',async()=>{
  const {api,state,callback,data}=setup();const login=api.signIn(cfg);await Promise.resolve();
  assert.equal(state.host,'127.0.0.1');assert.equal(callback({code:'x',state:'wrong'}),400);
  assert.equal(callback({state:state.auth.state}),400);
  assert.equal(callback({code:'x',state:state.auth.state},'/wrong'),400);
  assert.equal(callback({code:'x',state:state.auth.state},'/oauth2callback','POST'),400);
  callback({code:'valid',state:state.auth.state});await login;
  assert.equal(state.exchange.code,'valid');assert.equal(crypto.createHash('sha256').update(state.exchange.codeVerifier).digest('base64url'),state.auth.code_challenge);
  assert.equal(api.getAccountId(),'B');assert.ok(data.get('tokens'));
});
test('logout invalidates pending token refresh and login',async()=>{
  let s=setup();let done;s.state.refresh=new Promise(r=>done=r);const refresh=s.api.getFreshIdToken(cfg);s.api.signOut();done();await assert.rejects(refresh,/SESSION_CHANGED/);assert.equal(s.data.has('tokens'),false);
  s=setup();const login=s.api.signIn(cfg);await Promise.resolve();s.api.signOut();await assert.rejects(login,/LOGIN_CANCELLED/);assert.equal(s.data.has('tokens'),false);
});
test('ambiguous calendar retry uses same event ID and 409 retrieves existing event',async()=>{
  const {api,state,data}=setup();const payload={summary:'normal',start:{date:'2026-10-01'},end:{date:'2026-10-02'}};
  state.insert=async()=>{throw Object.assign(Error('network'),{code:'ETIMEDOUT'});};await assert.rejects(api.createEvent(cfg,payload));
  state.insert=async()=>{throw Object.assign(Error('exists'),{code:409});};const result=await api.createEvent(cfg,payload);
  assert.equal(state.inserts[0].id,state.inserts[1].id);assert.equal(result.id,state.inserts[0].id);assert.equal(Object.keys(data.get('pendingEventCreates')).length,0);
  state.insert=null;await api.createEvent(cfg,payload);assert.notEqual(state.inserts[2].id,state.inserts[1].id);
});
test('team operation 409 recovery applies latest requested revision',async()=>{
  const {api,state}=setup();
  state.insert=async()=>{throw Object.assign(Error('lost response'),{code:'ETIMEDOUT'});};
  const payload={operationId:'team:one',summary:'old',start:{date:'2026-10-01'},end:{date:'2026-10-02'}};
  await assert.rejects(api.createEvent(cfg,payload));
  state.insert=async()=>{throw Object.assign(Error('already exists'),{code:409});};
  state.patchResult='latest';
  const result=await api.createEvent(cfg,{...payload,summary:'latest'});
  assert.equal(result.title,'latest');assert.equal(state.inserts[0].id,state.inserts[1].id);
});
