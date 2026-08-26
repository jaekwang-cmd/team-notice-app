const { initializeApp } = require('firebase/app');
const { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged } = require('firebase/auth');
const {
  getFirestore,
  collection,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  getDocs,
  getDoc,
} = require('firebase/firestore');

function initFirebase(firebaseConfig) {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  return { app, auth, db };
}

async function signInWithGoogleIdToken(auth, idToken) {
  const credential = GoogleAuthProvider.credential(idToken);
  const result = await signInWithCredential(auth, credential);
  return result.user;
}

async function signOutFirebase(auth) {
  await signOut(auth);
}

// Fires once immediately with the current state and again on every future
// change — sign-in, sign-out, or a delayed/retried sign-in completing after
// the app already finished starting up (e.g. right after a reboot, before
// networking is fully back). Callers should start/stop their subscriptions
// from this instead of a one-time check right after calling signIn, so a
// slow or retried auth doesn't leave them silently never subscribed.
function onAuthStateChangedListener(auth, callback) {
  return onAuthStateChanged(auth, callback);
}

// 개인 메모("왼쪽 메모장")는 더 이상 여기(Firestore)에 저장하지 않는다 — 폰 Gmail/캘린더
// 앱의 "내 할 일 목록"과 그대로 공유되도록 Google Tasks 로 옮겼다(src/main/googleAuth.js
// 의 listTasks/createTask/updateTask/deleteTask 참고).

// --- Dynamic admin list ---

function subscribeToAdmins(db, onUpdate, onError) {
  return onSnapshot(
    doc(db, 'settings', 'admins'),
    (docSnap) => {
      const data = docSnap.data();
      onUpdate((data && data.emails) || []);
    },
    onError
  );
}

async function setAdmins(db, emails) {
  await setDoc(doc(db, 'settings', 'admins'), { emails }, { merge: true });
}

// --- Team-shared calendar events ---

// Google Calendar 이벤트 리소스 형태 그대로 { date: 'YYYY-MM-DD' } 또는
// { dateTime: 'YYYY-MM-DDTHH:mm:00', timeZone } 를 쓰는데, 이 안의 날짜만 뽑아서
// 별도의 평범한 문자열 필드(startDate)로도 저장해둔다 — Firestore 는 객체(map) 필드로
// 범위 검색을 못 하므로, "최근 것만 동기화"하려면 비교 가능한 문자열 필드가 따로 필요하다.
function teamEventStartDateKey(start) {
  if (!start) return null;
  if (start.date) return start.date;
  if (start.dateTime) return String(start.dateTime).slice(0, 10);
  return null;
}

// 팀 일정은 회사가 생긴 이래 만들어진 걸 전부 실시간으로 항상 동기화하고 있었다 —
// 데이터가 쌓일수록 앱이 켜질 때마다 점점 더 많은 걸 받아와서 느려지고 Firebase
// 사용량도 계속 늘어난다. 최근 것만 실시간으로 보면 되니 기간을 제한한다
// (지난 이벤트를 아예 못 보게 지우는 게 아니라, "실시간 동기화 대상"만 좁히는 것).
const TEAM_EVENTS_SYNC_MONTHS_PAST = 3;
const TEAM_EVENTS_SYNC_MONTHS_FUTURE = 12;

function dateKeyOffsetMonths(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function subscribeToTeamEvents(db, onUpdate, onError) {
  const windowStart = dateKeyOffsetMonths(-TEAM_EVENTS_SYNC_MONTHS_PAST);
  const windowEnd = dateKeyOffsetMonths(TEAM_EVENTS_SYNC_MONTHS_FUTURE);
  const q = query(
    collection(db, 'teamEvents'),
    where('startDate', '>=', windowStart),
    where('startDate', '<=', windowEnd)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const events = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          title: data.title,
          start: data.start,
          end: data.end,
          allDay: Boolean(data.allDay),
          createdByName: data.createdByName,
          updatedAt: data.updatedAt ? data.updatedAt.toMillis() : 0,
        };
      });
      onUpdate(events);
    },
    onError
  );
}

async function createTeamEvent(db, { title, start, end, allDay, createdByName }) {
  const ref = await addDoc(collection(db, 'teamEvents'), {
    title,
    start,
    end,
    startDate: teamEventStartDateKey(start),
    allDay,
    createdByName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

async function updateTeamEvent(db, id, data) {
  const patch = { ...data, updatedAt: serverTimestamp() };
  if (data.start) patch.startDate = teamEventStartDateKey(data.start);
  await updateDoc(doc(db, 'teamEvents', id), patch);
}

async function deleteTeamEvent(db, id) {
  await deleteDoc(doc(db, 'teamEvents', id));
}

// 실시간 구독은 "최근 기간"만 보므로, 어떤 일정이 스냅샷에서 사라졌다고 해서 지워진
// 것이라고 단정하면 안 된다 — 날짜를 기간 밖(예: 1년 넘게 뒤)으로 옮겨도 똑같이
// 사라져 보이기 때문이다. 그걸 삭제로 오인하면 직원들 구글 캘린더에서 멀쩡한 일정을
// 지워버리게 되므로, 실제로 지워졌는지 문서를 직접 확인한다(드물게만 호출됨).
async function teamEventExists(db, id) {
  const snap = await getDoc(doc(db, 'teamEvents', id));
  return snap.exists();
}

// 이 필드를 새로 추가하면서, 이미 저장돼있던 옛날 팀 일정들엔 startDate 가 없다 —
// range 쿼리는 그 필드가 아예 없는 문서는 결과에서 빠뜨리므로, 한 번만 전체를 훑어서
// 채워준다(실시간 구독이 아니라 1회성 조회라 컬렉션이 계속 자라도 반복 비용이 없다).
async function migrateTeamEventStartDates(db) {
  const snapshot = await getDocs(collection(db, 'teamEvents'));
  const missing = snapshot.docs.filter((docSnap) => !docSnap.data().startDate);
  await Promise.all(
    missing.map((docSnap) => {
      const startDate = teamEventStartDateKey(docSnap.data().start);
      if (!startDate) return Promise.resolve();
      return updateDoc(doc(db, 'teamEvents', docSnap.id), { startDate });
    })
  );
  return missing.length;
}

// --- Personal 출고 관리 장부 (each user only ever sees their own entries) ---

function subscribeToChulgoEntries(db, uid, onUpdate, onError) {
  const q = query(collection(db, 'chulgoEntries'), where('authorUid', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const entries = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          month: data.month,
          order: data.order || 0,
          finType: data.finType || '',
          name: data.name || '',
          car: data.car || '',
          company: data.company || '',
          fee: data.fee || 0,
          promo: data.promo || 0,
          agencyFee: data.agencyFee || 0,
          supplies: data.supplies || 0,
          status: data.status || '-',
          dbType: data.dbType || '',
          memo: data.memo || '',
          contractPeriod: data.contractPeriod || '',
          mileage: data.mileage || '',
          // 예전엔 금액(숫자)이었다가 자유 텍스트로 바뀌었다 — 옛 숫자 데이터도 그냥
          // 문자열로 보여주고 편집하게 둔다(값 손실 없음).
          initialFunds: data.initialFunds != null ? String(data.initialFunds) : '',
          countsQuota: data.countsQuota !== false,
          // 아래 필드들은 새 필드를 추가할 때마다 여기 안 넣으면 저장 직후 실시간
          // 동기화가 조용히 지워버린다 (실제로 한동안 이렇게 돼 있었다 — 저장은 됐는데
          // 다음 스냅샷에서 사라져서, 화면에는 계속 빈 값으로 보였다).
          // 출고현황 엑셀 전용 필드
          deployDate: data.deployDate || '',
          vehiclePrice: data.vehiclePrice || 0,
          feeRate: data.feeRate === '' || data.feeRate == null ? '' : data.feeRate,
          feeMethod: data.feeMethod || 'AG',
          remark: data.remark != null ? data.remark : null,
          // 정산서 전용 필드
          nonPartner: !!data.nonPartner,
          retention: !!data.retention,
          // || 1 을 쓰면 0(=미인정으로 명시한 값)이 다시 1로 튕겨나온다 — 필드가
          // 아예 없던 예전 데이터일 때만 1로 기본값을 준다.
          recognizedUnits: data.recognizedUnits == null ? 1 : data.recognizedUnits,
          expenses: Array.isArray(data.expenses) ? data.expenses : [],
          paybacks: Array.isArray(data.paybacks) ? data.paybacks : [],
          extraFees: Array.isArray(data.extraFees) ? data.extraFees : [],
          promoItems: Array.isArray(data.promoItems) ? data.promoItems : [],
          agencyFeeItems: Array.isArray(data.agencyFeeItems) ? data.agencyFeeItems : [],
          settleMemo: data.settleMemo || '',
        };
      });
      onUpdate(entries);
    },
    onError
  );
}

async function createChulgoEntry(db, { authorUid, ...data }) {
  const ref = await addDoc(collection(db, 'chulgoEntries'), {
    ...data,
    authorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

async function updateChulgoEntry(db, id, data) {
  await updateDoc(doc(db, 'chulgoEntries', id), { ...data, updatedAt: serverTimestamp() });
}

async function deleteChulgoEntry(db, id) {
  await deleteDoc(doc(db, 'chulgoEntries', id));
}

module.exports = {
  initFirebase,
  signInWithGoogleIdToken,
  signOutFirebase,
  onAuthStateChangedListener,
  subscribeToAdmins,
  setAdmins,
  subscribeToTeamEvents,
  createTeamEvent,
  updateTeamEvent,
  deleteTeamEvent,
  teamEventExists,
  migrateTeamEventStartDates,
  subscribeToChulgoEntries,
  createChulgoEntry,
  updateChulgoEntry,
  deleteChulgoEntry,
};
