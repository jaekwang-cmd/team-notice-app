const http = require('http');
// 캘린더 API 딱 하나만 쓰는데 예전 googleapis 패키지는 구글의 모든 API(Gmail/드라이브/
// 시트 등)를 다 묶어서 115MB 였다. 캘린더만 딱 떼어낸 공식 경량 패키지로 바꿔서
// 설치파일이 그만큼 가벼워진다 — 실제 API 응답이 완전히 동일함을 확인하고 교체했다.
const { OAuth2Client } = require('google-auth-library');
const { calendar: calendarClient } = require('@googleapis/calendar');
const { tasks: tasksClient } = require('@googleapis/tasks');
const { shell } = require('electron');
const Store = require('electron-store');

const store = new Store({ name: 'google-tokens' });

// calendar.events grants read+write on events (not full calendar admin); tasks grants
// read+write on Google Tasks(할 일) — 왼쪽 메모장이 이제 이걸로 동작해서, 폰 Gmail/캘린더
// 앱에 있는 "내 할 일 목록" 위젯에도 그대로 뜬다. 새 스코프라, 이전에 로그인해둔
// 사람들은 한 번 로그아웃 후 재로그인해야 이 권한이 추가로 붙는다.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
  'openid', 'email', 'profile',
];

function createOAuthClient(googleConfig) {
  const client = new OAuth2Client(
    googleConfig.clientId,
    googleConfig.clientSecret,
    `http://localhost:${googleConfig.redirectPort}/oauth2callback`
  );

  // Google refreshes id_token/access_token transparently on API calls;
  // persist whatever comes back so future launches stay signed in.
  client.on('tokens', (tokens) => {
    const existing = store.get('tokens') || {};
    store.set('tokens', { ...existing, ...tokens });
  });

  const stored = store.get('tokens');
  if (stored) client.setCredentials(stored);
  return client;
}

function isSignedIn() {
  return Boolean(store.get('tokens'));
}

// 0.29.0 에서 tasks 스코프가 새로 추가됐다 — 그 전에 로그인해둔 사람은 저장된 토큰에
// 이 권한이 없다. 구글이 토큰 발급 시 실제로 허용된 스코프 목록을 함께 내려주므로,
// 그 문자열에 tasks 가 들어있는지로 판단한다(마이그레이션 1회 판단용, 상시 검사 아님).
function hasTasksScope() {
  const tokens = store.get('tokens');
  const scope = (tokens && tokens.scope) || '';
  return scope.includes('/auth/tasks');
}

// 로그인 창을 그냥 닫아버리거나 리다이렉트가 영영 안 오면(네트워크 문제 등) 이 Promise가
// 끝까지 안 풀려서 서버가 포트를 계속 붙잡고 있었다 — close()를 호출부에서 부를 수 있게
// 밖으로 내보낸다.
function waitForAuthCode(port) {
  let server;
  const promise = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (error) {
        res.end('<h2>로그인이 취소되었습니다. 이 창을 닫아주세요.</h2>');
        server.close();
        reject(new Error(error));
        return;
      }

      res.end('<h2>구글 로그인이 완료되었습니다. 이 창을 닫고 앱으로 돌아가세요.</h2>');
      server.close();
      resolve(code);
    });

    // listen()이 실패하면(포트 충돌 등) 리스너 없는 EventEmitter 'error'는 uncaught
    // exception이 되어 메인 프로세스 전체가 죽는다 — 반드시 여기서 받아서 reject로 돌린다.
    server.on('error', reject);
    server.listen(port);
  });
  return { promise, close: () => server.close() };
}

// 로그인은 사람이 브라우저에서 계정 선택/2단계 인증 등을 거치는 과정이라 API 호출용
// 20초 타임아웃(GOOGLE_CALL_TIMEOUT_MS)은 너무 짧다 — 넉넉히 5분을 준다.
const LOGIN_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

async function signIn(googleConfig) {
  const client = createOAuthClient(googleConfig);
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  const { promise: codePromise, close: closeAuthServer } = waitForAuthCode(googleConfig.redirectPort);
  let code;
  try {
    await shell.openExternal(authUrl);
    code = await withTimeout(codePromise, '구글 로그인', LOGIN_WAIT_TIMEOUT_MS);
  } catch (err) {
    closeAuthServer();
    throw err;
  }

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  store.set('tokens', tokens);
  return { idToken: tokens.id_token };
}

function signOut() {
  store.delete('tokens');
}

async function getFreshIdToken(googleConfig) {
  if (!isSignedIn()) throw new Error('NOT_SIGNED_IN');
  const client = createOAuthClient(googleConfig);
  await withTimeout(client.getAccessToken(), '로그인 갱신'); // refreshes + persists a new id_token if the old one expired
  const tokens = store.get('tokens');
  return tokens.id_token;
}

function mapEvent(event) {
  return {
    id: event.id,
    title: event.summary || '(제목 없음)',
    start: event.start.dateTime || event.start.date,
    end: event.end.dateTime || event.end.date,
    allDay: !event.start.dateTime,
    colorId: event.colorId || null,
  };
}

function getCalendarClient(googleConfig) {
  if (!isSignedIn()) throw new Error('NOT_SIGNED_IN');
  const client = createOAuthClient(googleConfig);
  return calendarClient({ version: 'v3', auth: client });
}

// 타임아웃이 없으면 구글 API 라이브러리가 자체 재시도를 반복하면서 한 요청이 수십 초씩
// 매달려 있을 수 있다. 그동안 메인 프로세스가 그 작업에 묶여서 앱 전체가 굼떠진다.
const GOOGLE_API_TIMEOUT_MS = 15000;
const GOOGLE_REQ_OPTS = { timeout: GOOGLE_API_TIMEOUT_MS };

// 위 timeout은 "요청이 이미 나간 뒤"에만 적용된다 — 액세스 토큰이 만료돼 있으면 요청을
// 보내기도 전에 google-auth-library가 조용히 토큰부터 새로 받아오는데, 그 갱신 요청은
// 이 timeout 대상이 아니라서 막히면 수십 초씩 응답 없이 매달릴 수 있다(일정 등록이
// 20~30초 걸리던 증상의 원인으로 추정 — 실제로 겪고 계신 문제라 확실한 상한선을 둔다).
// 토큰 갱신 + 실제 API 호출을 통째로 다시 한번 감싸서, 어디서 막히든 이 시간 안에 확실히
// 실패로 끝나게 한다(재시도는 호출한 쪽 UI에서 버튼을 다시 누르면 되니 여기서 하지 않는다).
const GOOGLE_CALL_TIMEOUT_MS = 20000;
function withTimeout(promise, label, ms = GOOGLE_CALL_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`GOOGLE_TIMEOUT: ${label} 응답이 ${ms / 1000}초 안에 오지 않았습니다 (네트워크 상태를 확인해주세요)`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getUpcomingEvents(googleConfig, { timeMin, timeMax }) {
  const calendar = getCalendarClient(googleConfig);
  const res = await withTimeout(calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  }, GOOGLE_REQ_OPTS), '일정 목록 불러오기');

  return (res.data.items || []).map(mapEvent);
}

async function createEvent(googleConfig, { summary, start, end, colorId }) {
  const calendar = getCalendarClient(googleConfig);
  const res = await withTimeout(calendar.events.insert({
    calendarId: 'primary',
    requestBody: { summary, start, end, ...(colorId ? { colorId } : {}) },
  }, GOOGLE_REQ_OPTS), '일정 추가');
  return mapEvent(res.data);
}

async function updateEvent(googleConfig, { eventId, summary, start, end, colorId }) {
  const calendar = getCalendarClient(googleConfig);
  // colorId 는 항상 명시적으로 보낸다 — 값이 있으면 그 색으로, 없으면 null 로(구글 API가
  // 이걸 "캘린더 기본색으로 되돌리기"로 정확히 처리하는 걸 실제 호출로 확인했다). 빈
  // 문자열('')은 구글이 "Invalid color id value" 로 거부해서 색을 안 건드리는 수정까지
  // 전부 실패했었다 — 반드시 null 이어야 한다.
  const res = await withTimeout(calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: { summary, start, end, colorId: colorId || null },
  }, GOOGLE_REQ_OPTS), '일정 수정');
  return mapEvent(res.data);
}

async function deleteEvent(googleConfig, { eventId }) {
  const calendar = getCalendarClient(googleConfig);
  await withTimeout(calendar.events.delete({ calendarId: 'primary', eventId }, GOOGLE_REQ_OPTS), '일정 삭제');
}

// --- 왼쪽 메모장 = Google Tasks("내 할 일 목록") ---
// Tasks API 는 계정마다 기본 목록을 '@default' 별칭으로 바로 가리킬 수 있어서, 목록
// id를 따로 조회/저장할 필요가 없다.
const TASKLIST = '@default';

function getTasksClient(googleConfig) {
  if (!isSignedIn()) throw new Error('NOT_SIGNED_IN');
  const client = createOAuthClient(googleConfig);
  return tasksClient({ version: 'v1', auth: client });
}

// Google Tasks 의 마감일(due)은 날짜만 의미가 있고 시각은 API가 그냥 버린다(공식 문서에
// 명시된 제약) — 그래서 "몇 시 정각에 울리는 알람"은 이 필드로 표현할 수 없다. 대신 정확한
// 시각은 notes 맨 앞에 "⏰HH:mm" 표식으로 같이 저장해서, 앱이 직접 그 시각에 로컬 알림을
// 울리게 한다(폰 Tasks 앱엔 그냥 메모 텍스트로 보임 — 오히려 참고용으로 유용하다).
const ALARM_MARK_RE = /^⏰(\d{2}:\d{2})\s*/;

function mapTask(task) {
  const notes = task.notes || '';
  const m = ALARM_MARK_RE.exec(notes);
  return {
    id: task.id,
    text: task.title || '',
    due: task.due || null, // 'YYYY-MM-DDT00:00:00.000Z' — 날짜만 신뢰
    alarmTime: m ? m[1] : null, // 'HH:mm' | null
    done: task.status === 'completed',
  };
}

function toDueRFC3339(dateStr) {
  // 'YYYY-MM-DD' -> Google 이 기대하는 자정 UTC RFC3339. 시각은 어차피 버려지므로
  // 항상 00:00:00 으로 보낸다(타임존 드리프트로 하루씩 밀리는 걸 방지).
  if (!dateStr) return undefined;
  return `${dateStr}T00:00:00.000Z`;
}

// 오래된 완료 항목까지 무한정 불러오진 않는다 — 최근 것만 봐도 충분하고, 계속 켜두는
// 앱이라 매번 통째로 다 받아오면 아까 팀일정처럼 갈수록 느려지는 문제가 재발한다.
const TASKS_LOOKBACK_DAYS = 60;

async function listTasks(googleConfig) {
  const tasks = getTasksClient(googleConfig);
  const dueMin = new Date(Date.now() - TASKS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const res = await withTimeout(tasks.tasks.list({
    tasklist: TASKLIST,
    showCompleted: true,
    showHidden: true,
    maxResults: 100,
    dueMin,
  }, GOOGLE_REQ_OPTS), '할 일 목록 불러오기');
  return (res.data.items || []).map(mapTask);
}

async function createTask(googleConfig, { text, due, alarmTime }) {
  const tasks = getTasksClient(googleConfig);
  const res = await withTimeout(tasks.tasks.insert({
    tasklist: TASKLIST,
    requestBody: {
      title: text,
      due: toDueRFC3339(due),
      notes: alarmTime ? `⏰${alarmTime}` : undefined,
    },
  }, GOOGLE_REQ_OPTS), '할 일 추가');
  return mapTask(res.data);
}

// alarmTime 이 명시적으로 null 이면(문자열이 아니라 null) 알람 표식을 지운다 — 알람이
// 울린 뒤 다시 안 울리게 하거나, 사용자가 알람을 끌 때 쓴다. undefined 면 그대로 둔다.
async function updateTask(googleConfig, { id, text, due, alarmTime, done }) {
  const tasks = getTasksClient(googleConfig);
  const body = {};
  if (text != null) body.title = text;
  if (due !== undefined) body.due = toDueRFC3339(due);
  if (alarmTime !== undefined) body.notes = alarmTime ? `⏰${alarmTime}` : '';
  if (done != null) body.status = done ? 'completed' : 'needsAction';
  const res = await withTimeout(tasks.tasks.patch({ tasklist: TASKLIST, task: id, requestBody: body }, GOOGLE_REQ_OPTS), '할 일 수정');
  return mapTask(res.data);
}

async function deleteTask(googleConfig, { id }) {
  const tasks = getTasksClient(googleConfig);
  await withTimeout(tasks.tasks.delete({ tasklist: TASKLIST, task: id }, GOOGLE_REQ_OPTS), '할 일 삭제');
}

module.exports = {
  isSignedIn,
  hasTasksScope,
  signIn,
  signOut,
  getFreshIdToken,
  getUpcomingEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
};
