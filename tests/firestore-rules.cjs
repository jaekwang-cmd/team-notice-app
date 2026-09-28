// Run only against the disposable demo Firestore emulator.
const fs=require('node:fs');const assert=require('node:assert/strict');
const project='demo-yeobaek-rules';const host=process.env.FIRESTORE_EMULATOR_HOST;
if(!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host))throw Error('Local emulator required');
const base=`http://${host}/v1/projects/${project}/databases/(default)/documents/`;
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function token(uid,email='member@example.test',verified=true){return `${encode({alg:'none',typ:'JWT'})}.${encode({sub:uid,user_id:uid,aud:project,iss:`https://securetoken.google.com/${project}`,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,email,email_verified:verified,firebase:{sign_in_provider:'google.com'}})}.`}
function fields(data){return Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v===null?{nullValue:null}:typeof v==='boolean'?{booleanValue:v}:Array.isArray(v)?{arrayValue:{values:v.map(x=>({stringValue:x}))}}:{stringValue:v}]))}
async function req(path,method='GET',data,auth='owner'){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify({fields:fields(data)})});if(!r.ok&&r.status!==403)throw Error(`${method} ${path}: ${r.status} ${await r.text()}`);return r.status;}
(async()=>{let count=0;async function allow(...args){assert.ok((await req(...args))<300,`allowed ${args[0]}`);count++}async function deny(...args){assert.equal(await req(...args),403,`denied ${args[0]}`);count++}
const member=token('member'),other=token('other'),root=token('root','workt98@gmail.com'),fakeRoot=token('root','workt98@gmail.com',false),admin=token('admin','calendar@example.test'),superAdmin=token('super');
for(const [uid,permission,organization] of [['member','member','A'],['other','member','B'],['super','superAdmin','A']])await req(`orgMembers/${uid}`,'PATCH',{uid,permission,organization,teamId:null,active:true});
await req('settings/admins','PATCH',{emails:['calendar@example.test']});
await deny('settings/admins','PATCH',{emails:['member@example.test']},member);await deny('settings/admins','PATCH',{emails:[]},fakeRoot);await allow('settings/admins','PATCH',{emails:['calendar@example.test']},root);
await deny('settings/appConfig','PATCH',{minVersion:'999'},member);await allow('settings/appConfig','PATCH',{minVersion:'0.39.9'},superAdmin);
await deny('teamEvents/unverified','PATCH',{title:'blocked'},token('admin','calendar@example.test',false));
await deny('teamEvents/blocked','PATCH',{title:'blocked'},member);await allow('teamEvents/admin-event','PATCH',{title:'ok',startDate:'2026-09-28'},admin);await allow('teamEvents/root-event','PATCH',{title:'ok'},root);
for(const collection of ['memos','customerReminders','chulgoEntries']){await allow(`${collection}/mine`,'PATCH',{authorUid:'member',text:'ok'},member);await deny(`${collection}/mine`,'PATCH',{authorUid:'other',text:'transfer'},member);await deny(`${collection}/mine`,'PATCH',{authorUid:'member',text:'tamper'},other);await allow(`${collection}/mine`,'PATCH',{authorUid:'member',text:'updated'},member);}
await deny('orgMembers/member','PATCH',{uid:'member',permission:'superAdmin',organization:'A',teamId:null,active:true},member);
await deny('financeCredentials/forged','PATCH',{authorUid:'member',organization:'B',name:'bad'},member);await allow('financeCredentials/valid','PATCH',{authorUid:'member',organization:'A',name:'ok'},member);await deny('financeCredentials/valid','PATCH',{authorUid:'other',organization:'A',name:'bad'},member);await deny('financeCredentials/valid','PATCH',{authorUid:'member',organization:'B',name:'bad'},member);await deny('financeCredentials/valid','GET',undefined,other);await allow('financeCredentials/valid','GET',undefined,member);await allow('financeCredentials/valid','PATCH',{authorUid:'member',organization:'A',name:'admin edit'},superAdmin);
await allow('orgMembers/new-member','PATCH',{uid:'new-member',permission:'member',organization:null,teamId:null,active:true},token('new-member'));
await deny('orgMembers/fake-admin','PATCH',{uid:'fake-admin',permission:'superAdmin',organization:null,teamId:null,active:true},token('fake-admin'));
await allow('memos/mine','DELETE',undefined,member);
await allow('financeCredentials/valid','DELETE',undefined,superAdmin);
console.log(`PASS ${count} Firestore allow/deny assertions in disposable emulator`);
})().catch(e=>{console.error(e);process.exitCode=1});
