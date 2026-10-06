const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const fn = source.slice(source.indexOf('function getOpenAIApiKey()'), source.indexOf('const rootAdminEmails'));
let contents = null;
const box = { path, legacyProfileName: 'legacy', config: {openai: {apiKey: ''}}, app: {isPackaged: true, getPath: () => '/profile'}, fs: {
  existsSync: () => contents !== null,
  readFileSync: () => { if(contents instanceof Error) throw contents; return contents; },
}};
vm.createContext(box); vm.runInContext(fn, box);
assert.throws(() => box.getOpenAIApiKey(), /OPENAI_NOT_CONFIGURED/);
contents = '\uFEFF' + JSON.stringify({openai: {apiKey: ' test-key-one '}});
assert.equal(box.getOpenAIApiKey(), 'test-key-one');
contents = JSON.stringify({openai: {apiKey: 'test-key-two'}});
assert.equal(box.getOpenAIApiKey(), 'test-key-two');
contents = new Error('read denied');
assert.throws(() => box.getOpenAIApiKey(), /OPENAI_PRIVATE_CONFIG_UNREADABLE/);
contents = '{broken';
assert.throws(() => box.getOpenAIApiKey(), /OPENAI_PRIVATE_CONFIG_UNREADABLE/);
contents = JSON.stringify({openai: {apiKey: 'YOUR_KEY'}});
assert.throws(() => box.getOpenAIApiKey(), /OPENAI_NOT_CONFIGURED/);
box.app.isPackaged = false; box.config.openai.apiKey = 'dev-key';
assert.equal(box.getOpenAIApiKey(), 'dev-key');
for (const channel of ['chulgo:ai-fill', 'ai:chat']) {
  assert.match(source.slice(source.indexOf(`ipcMain.handle('${channel}'`), source.indexOf(`ipcMain.handle('${channel}'`) + 180), /getOpenAIApiKey\(\)/);
}
console.log('PASS: private key reload, BOM, replacement, read errors, missing keys, both AI handlers');
