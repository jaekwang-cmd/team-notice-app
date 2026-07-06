const http = require('http');
const { google } = require('googleapis');
const { shell } = require('electron');
const Store = require('electron-store');

const store = new Store({ name: 'google-tokens' });

// calendar.events grants read+write on events (not full calendar admin) — enough for our CRUD needs.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'openid', 'email', 'profile'];

function createOAuthClient(googleConfig) {
  const client = new google.auth.OAuth2(
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

function waitForAuthCode(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
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

    server.listen(port);
  });
}

async function signIn(googleConfig) {
  const client = createOAuthClient(googleConfig);
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  const codePromise = waitForAuthCode(googleConfig.redirectPort);
  await shell.openExternal(authUrl);
  const code = await codePromise;

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
  await client.getAccessToken(); // refreshes + persists a new id_token if the old one expired
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
  };
}

function getCalendarClient(googleConfig) {
  if (!isSignedIn()) throw new Error('NOT_SIGNED_IN');
  const client = createOAuthClient(googleConfig);
  return google.calendar({ version: 'v3', auth: client });
}

async function getUpcomingEvents(googleConfig, { timeMin, timeMax }) {
  const calendar = getCalendarClient(googleConfig);
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (res.data.items || []).map(mapEvent);
}

async function createEvent(googleConfig, { summary, start, end }) {
  const calendar = getCalendarClient(googleConfig);
  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: { summary, start, end },
  });
  return mapEvent(res.data);
}

async function updateEvent(googleConfig, { eventId, summary, start, end }) {
  const calendar = getCalendarClient(googleConfig);
  const res = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: { summary, start, end },
  });
  return mapEvent(res.data);
}

async function deleteEvent(googleConfig, { eventId }) {
  const calendar = getCalendarClient(googleConfig);
  await calendar.events.delete({ calendarId: 'primary', eventId });
}

module.exports = {
  isSignedIn,
  signIn,
  signOut,
  getFreshIdToken,
  getUpcomingEvents,
  createEvent,
  updateEvent,
  deleteEvent,
};
