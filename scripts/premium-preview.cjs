// Local, memory-only UI fixture. Does not load Electron, preload, Firebase or account files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const rendererRoot = path.resolve(__dirname, '../src/renderer');

function previewBootstrap(appVersion) {
  const copy = value => JSON.parse(JSON.stringify(value));
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const day = offset => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const month = day(0).slice(0, 7);
  const user = { signedIn: true, uid: 'preview-user', displayName: '미리보기 사용자', email: 'preview@example.invalid', isAdmin: false };
  const store = {
    signedIn: true, theme: { mode: 'wood', font: null, dateFontSize: '13', eventFontSize: '12', bold: false, cardStyle: 'matte' },
    calls: [], unhandled: [], events: [],
    memos: [
      { id: 'memo-1', text: '계약 서류 마지막으로 확인하기', done: false, due: `${day(0)}T00:00:00.000Z`, createdAt: '2026-01-01T10:00:00Z' },
      { id: 'memo-2', text: '오후 상담을 위한 제안서 준비', done: false, due: `${day(1)}T00:00:00.000Z`, createdAt: '2026-01-02T10:00:00Z' },
      { id: 'memo-3', text: '오늘의 작은 성취 기록하기', done: true, due: null, createdAt: '2026-01-03T10:00:00Z' },
    ],
    ledger: [
      { id: 'ledger-1', authorUid: 'preview-user', month, name: '김하늘 · 예시', car: '그랜저', company: 'BNK캐피탈', finType: '리스', vehiclePrice: 48600000, fee: 1800000, promo: 100000, agencyFee: 0, supplies: 30000, contractPeriod: '48개월', mileage: '20,000KM', initialFunds: '보증 20%', status: '예정', deployDate: day(1), order: 0, recognizedUnits: 1, countsQuota: true, retention: true, nonPartner: false, paybacks: [{ name: '샘플 페이백', amount: 100000 }], extraFees: [{ name: '샘플 추가수수료', type: 'amount', value: 50000 }], memo: '실제 고객 정보가 아닌 예시 데이터' },
      { id: 'ledger-2', authorUid: 'preview-user', month, name: '박이안 · 예시', car: '쏘렌토', company: 'JB우리캐피탈', finType: '렌트', vehiclePrice: 42700000, fee: 2200000, promo: 0, agencyFee: 60000, supplies: 0, contractPeriod: '60개월', mileage: '15,000KM', initialFunds: '선납 10%', status: '완료', deployDate: day(-1), order: 1, recognizedUnits: 1, countsQuota: true, retention: true, nonPartner: false },
      { id: 'ledger-3', authorUid: 'preview-user', month, name: '윤서우 · 예시', car: 'EV5', company: '현대캐피탈', finType: '리스', vehiclePrice: 51900000, fee: 1450000, promo: 200000, agencyFee: 0, supplies: 0, contractPeriod: '36개월', mileage: '20,000KM', initialFunds: '무보증', status: '예정', deployDate: day(3), order: 2, recognizedUnits: 1, countsQuota: true, retention: false, nonPartner: false },
    ],
    reminders: [
      { id: 'reminder-1', name: '김하늘 · 예시', phone: '', car: '그랜저', remindDate: day(0), note: '상담 후 안내사항 전달', done: false },
      { id: 'reminder-2', name: '윤서우 · 예시', phone: '', car: 'EV5', remindDate: day(2), note: '계약 일정 확인', done: false },
    ],
  };
  try { const saved = JSON.parse(sessionStorage.getItem('storybook_fixture_theme') || 'null'); if (saved && typeof saved === 'object') store.theme = saved; } catch (_) {}
  const titles = ['새로운 한 주 계획하기', '고객 상담 · 제안서 리뷰', '계약 서류 확인', '브랜드 미팅', '출고 전 최종 점검', '나를 위한 작은 산책', '고객 연락 · 진행 상황 안내'];
  let serial = 30;
  for (let i = -10; i < 19; i++) {
    if (i % 3 === 0 || i >= 0 && i <= 3) store.events.push({ id: `event-${i + 11}`, title: titles[(i + 14) % titles.length], start: `${day(i)}T${i % 2 ? '14' : '10'}:00:00+09:00`, end: `${day(i)}T${i % 2 ? '15' : '11'}:00:00+09:00`, allDay: false, colorId: String((i + 22) % 11 + 1) });
  }
  for (let i = 0; i < 5; i++) store.events.push({ id: `busy-${i}`, title: ['오전 고객 상담', '계약 초안 검토', '점심 산책', '새로운 프로젝트 메모', '오늘의 회고'][i], start: `${day(0)}T${pad(9 + i * 2)}:30:00+09:00`, end: `${day(0)}T${pad(10 + i * 2)}:00:00+09:00`, allDay: false, colorId: String(i + 2) });
  store.events.push({ id: 'span-1', title: '브랜드 리서치 · 집중 주간', start: day(2), end: day(5), allDay: true, colorId: '3' });
  const listeners = new Map();
  const failures = new Set();
  const sourceFor = { onMemosUpdate: 'memos', onChulgoUpdate: 'ledger', onReminderUpdate: 'reminders' };
  function emit(channel, value) { for (const cb of listeners.get(channel) || []) cb(copy(value)); }
  const eventShape = data => ({ title: data.summary ?? data.title, start: data.start?.dateTime || data.start?.date || data.start, end: data.end?.dateTime || data.end?.date || data.end, allDay: Boolean(data.start?.date) || data.allDay === true, colorId: data.colorId || null });
  async function editCollection(key, channel, data, create = false) {
    const id = data.id || `${key}-${++serial}`;
    if (create) store[key].push({ ...copy(data), id });
    else { const item = store[key].find(item => item.id === id); if (!item) throw Error('미리보기 항목을 찾을 수 없습니다.'); Object.assign(item, copy(data)); }
    await new Promise(resolve => setTimeout(resolve, 45)); emit(channel, store[key]); return { id };
  }
  const api = {
    getIsDev: async () => false, getAppVersion: async () => `${appVersion} · 미리보기`, getConfigStatus: async () => ({ configured: true }),
    getWhatsNew: async () => null, getUpdateStatus: async () => ({ state: 'idle' }), checkForUpdates: async () => ({ reason: 'dev' }),
    getTheme: async () => copy({ ...THEME_PRESETS[store.theme.mode], ...store.theme }), setTheme: async theme => { store.theme = copy(theme); sessionStorage.setItem('storybook_fixture_theme', JSON.stringify(store.theme)); },
    googleIsSignedIn: async () => store.signedIn, getCurrentUser: async () => store.signedIn ? copy(user) : { signedIn: false, uid: null, isAdmin: false },
    googleSignIn: async () => { store.signedIn = true; emit('onAuthUpdated', user); return copy(user); },
    googleSignOut: async () => { store.signedIn = false; emit('onAuthUpdated', { signedIn: false, uid: null, isAdmin: false }); },
    getHolidays: async () => [], getShortcutLinks: async () => [], getAutostart: async () => false, getPreferredBrowser: async () => 'default',
    getWindowSize: async () => ({ width: innerWidth, height: innerHeight }), setWindowSize: async size => size,
    getChulgoPosition: async () => '팀장', getChulgoPhone: async () => '', getRetentionCount: async () => 0,
    getAdminList: async () => ({ rootAdmins: [], dynamicAdmins: [] }), getBranchLinks: async () => ({}), getMinVersionConfig: async () => ({ minVersion: '0.0.0' }),
    getMyOrgInfo: async () => null, getOrgConstants: async () => ({ organizations: [], positionsByType: {}, permissions: [] }), getOrgTeams: async () => [], getOrgMembers: async () => [], getOrgHistory: async () => [], getOrgLedgerForScope: async () => [],
    googleGetEvents: async (start, end) => copy(store.events.filter(event => event.start < end && event.end > start.slice(0, 10))),
    googleCreateEvent: async data => { const result = { id: `created-event-${++serial}`, ...eventShape(data) }; store.events.push(result); return copy(result); },
    googleUpdateEvent: async data => { const event = store.events.find(event => event.id === data.eventId); if (!event) throw Error('미리보기 일정이 없습니다.'); Object.assign(event, eventShape(data)); return copy(event); },
    googleDeleteEvent: async data => { store.events = store.events.filter(event => event.id !== data.eventId); },
    createTeamEvent: async data => { const id = `team-${++serial}`; const event = { id, teamEventId: id, ...eventShape(data) }; store.events.push(event); return copy(event); },
    updateTeamEvent: async data => { const event = store.events.find(event => event.teamEventId === data.id); if (event) Object.assign(event, eventShape(data)); },
    deleteTeamEvent: async id => { store.events = store.events.filter(event => event.teamEventId !== id); },
    createMemo: data => editCollection('memos', 'onMemosUpdate', { ...data, done: false, due: data.dueDate ? `${data.dueDate}T00:00:00.000Z` : null }, true),
    updateMemo: data => editCollection('memos', 'onMemosUpdate', data),
    deleteMemo: async id => { store.memos = store.memos.filter(item => item.id !== id); emit('onMemosUpdate', store.memos); },
    createChulgoEntry: data => editCollection('ledger', 'onChulgoUpdate', data, true), updateChulgoEntry: data => editCollection('ledger', 'onChulgoUpdate', data),
    deleteChulgoEntry: async id => { store.ledger = store.ledger.filter(item => item.id !== id); emit('onChulgoUpdate', store.ledger); },
    createReminder: data => editCollection('reminders', 'onReminderUpdate', data, true), updateReminder: data => editCollection('reminders', 'onReminderUpdate', data),
    deleteReminder: async id => { store.reminders = store.reminders.filter(item => item.id !== id); emit('onReminderUpdate', store.reminders); },
    refreshAuth: async () => { emit('onChulgoUpdate', store.ledger); emit('onMemosUpdate', store.memos); emit('onReminderUpdate', store.reminders); },
    searchFiles: async () => ({ results: [], total: 0 }), aiChat: async () => ({ text: '미리보기에서는 AI 요청을 전송하지 않습니다.' }),
  };
  window.api = new Proxy(api, { get(target, name) {
    if (name === 'then' || typeof name !== 'string') return undefined;
    if (name.startsWith('on')) return cb => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(cb); const key = sourceFor[name]; if (key) setTimeout(() => cb(copy(store[key])), 120); else if (name === 'onFinanceUpdate') setTimeout(() => cb([]), 120); return () => listeners.set(name, listeners.get(name).filter(item => item !== cb)); };
    if (typeof target[name] === 'function') return async (...args) => { store.calls.push({ method: name, args: copy(args), at: Date.now() }); if (failures.delete(name)) { await new Promise(resolve => setTimeout(resolve, 180)); throw Error('미리보기에서 의도한 요청 실패'); } return target[name](...args); };
    return async (...args) => { store.calls.push({ method: name, args: copy(args), at: Date.now(), unsupported: true }); if (!store.unhandled.includes(name)) store.unhandled.push(name); return null; };
  } });
  window.__preview = { day, snapshot: () => copy(store), emit: (channel, data) => emit(channel, data), failNext: method => failures.add(method), resetCalls: () => { store.calls.length = 0; } };
  document.addEventListener('DOMContentLoaded', () => {
    const badge = document.createElement('div'); badge.id = 'premium-preview-badge'; badge.textContent = '디자인 미리보기 · 예시 데이터 · 저장은 이 화면에서만';
    badge.style.cssText = 'position:fixed;bottom:8px;left:12px;z-index:999999;font:10px/1.4 sans-serif;letter-spacing:.01em;color:#d1e5e9;background:#101720e8;border:1px solid #6a93a455;border-radius:7px;padding:5px 9px;pointer-events:none;max-width:300px';
    document.body.append(badge);
    const requested = new URLSearchParams(location.search).get('view') || 'calendar';
    const timer = setInterval(() => { if (typeof currentView === 'undefined' || !window.journalUI || !document.querySelector('#journal-week button')) return; clearInterval(timer); if (typeof switchView === 'function') switchView(requested); }, 35);
    setTimeout(() => clearInterval(timer), 10000);
  });
}

function createPreviewServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
    if (url.pathname === '/__fixture/health') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ fixture: 'premium-calendar', memoryOnly: true })); }
    if (url.pathname === '/__fixture/bootstrap.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); const version = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version; return res.end(`(${previewBootstrap.toString()})(${JSON.stringify(version)});`); }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      let html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
      html = html.replace(/<link\b[^>]*href="https?:[^>]+>/g, '').replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>').replace('<title>여백</title>', '<title>여백 · 아홉 가지 풍경 미리보기</title>');
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html);
    }
    const name = decodeURIComponent(url.pathname.slice(1));
    const staticFile = /^[a-zA-Z0-9_-]+\.(?:css|js|svg|png|woff2?)$/.test(name);
    const premiumFont = /^(?:premium-fonts|story-fonts)\/[a-z0-9-]+\.woff2$/.test(name);
    if (!staticFile && !premiumFont) { res.statusCode = 404; return res.end(); }
    const target = path.resolve(rendererRoot, name);
    if (!target.startsWith(rendererRoot + path.sep) || !fs.existsSync(target)) { res.statusCode = 404; return res.end(); }
    const type = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' }[path.extname(name)];
    res.setHeader('Content-Type', `${type}; charset=utf-8`); fs.createReadStream(target).pipe(res);
  });
}

if (require.main === module) {
  const port = Number(process.env.PREMIUM_PREVIEW_PORT || 5194);
  createPreviewServer().listen(port, '127.0.0.1', () => console.log(`Memory-only premium preview: http://127.0.0.1:${port}`));
}
module.exports = { createPreviewServer };
