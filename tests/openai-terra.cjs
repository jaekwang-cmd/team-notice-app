// Exercises the actual request/response functions without starting Electron or executing tools.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const jsonFn=source.slice(source.indexOf('async function callOpenAIJson('),source.indexOf("ipcMain.handle('chulgo:ai-fill'"));
const chatFn=source.slice(source.indexOf('async function callOpenAIChat('),source.indexOf('// --- 내 PC 파일 찾기 / 열기 ---'));
const requests=[];
const live=process.argv.includes('--live');
const sandbox={AbortSignal,openAiTimeoutSignal:()=>AbortSignal.timeout(45000),CALENDAR_CHAT_TOOLS:[{type:'function',function:{name:'preview_event',description:'Return a proposed test event; never executes a calendar write.',parameters:{type:'object',properties:{title:{type:'string'}},required:['title']}}}],fetch:async(url,options)=>{
 const body=JSON.parse(options.body);requests.push(body);assert.equal(body.model,'gpt-5.6-terra');assert.equal(body.reasoning_effort,'none');assert.equal('temperature' in body,false);
 if(live)return fetch(url,options);
 return {ok:true,json:async()=>({choices:[{message:body.response_format?{content:'{"ok":true}'}:{content:null,tool_calls:[{id:'test-call',function:{name:'preview_event',arguments:'{"title":"검증"}'}}]}}]})};
}};
vm.createContext(sandbox);vm.runInContext(jsonFn+'\n'+chatFn,sandbox);
(async()=>{
 const key=live?JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'스케줄 캘린더/private-config.json'),'utf8')).openai.apiKey:'mock-key';
 const parsed=await sandbox.callOpenAIJson(key,'Reply with JSON only.','Return {"ok":true}.');assert.equal(parsed.ok,true);
 const response=await sandbox.callOpenAIChat(key,'This is a synthetic API compatibility test. Call preview_event exactly once with title 검증. Do not perform real actions.',[{role:'user',content:'Propose the test event using preview_event.'}]);
 assert.equal(response.toolCalls.length,1);assert.equal(response.toolCalls[0].name,'preview_event');assert.equal(JSON.parse(response.toolCalls[0].arguments).title,'검증');
 console.log((live?'LIVE':'MOCK')+' PASS: gpt-5.6-terra JSON parsing and tool-call response; no calendar writes.');
})().catch(error=>{console.error('Terra compatibility failed: '+error.message.replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]'));process.exitCode=1});
