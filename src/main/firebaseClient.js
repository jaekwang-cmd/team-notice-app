const { initializeApp } = require('firebase/app');
const { getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged, deleteUser } = require('firebase/auth');
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

// --- 계정 삭제 (Google Play "계정 삭제" 정책 대응) ---
// 로그인 정보(Firebase Auth 계정) 자체와 관리자 목록에 남은 이메일만 지운다.
// 출고/정산 기록(chulgoEntries)은 세무·회계 보존이 필요한 회사 자료라 여기서 지우지
// 않는다 — 삭제 확인 문구에도 이 사실을 그대로 안내한다. deleteUser는 마지막 로그인이
// 오래됐으면 auth/requires-recent-login으로 실패할 수 있는데, 그건 호출한 쪽(main.js)이
// 구분해서 재로그인을 안내한다.
async function deleteFirebaseAccount(auth, db) {
  const user = auth.currentUser;
  if (!user) throw new Error('NOT_SIGNED_IN');
  const email = (user.email || '').toLowerCase();
  try {
    const adminsRef = doc(db, 'settings', 'admins');
    const snap = await getDoc(adminsRef);
    const emails = (snap.exists() && snap.data().emails) || [];
    if (email && emails.includes(email)) {
      await setDoc(adminsRef, { emails: emails.filter((e) => e !== email) }, { merge: true });
    }
  } catch (err) {
    // 관리자 목록 정리는 부수 작업이라, 실패해도 계정 삭제 자체는 계속 진행한다.
    console.error('[account-delete] 관리자 목록 정리 실패(계속 진행):', err);
  }
  await deleteUser(user);
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

// --- 고객 리마인더 (몇 달 뒤 다시 연락하기로 한 고객) — 장부와 같은 개인 전용 패턴 ---

function subscribeToReminders(db, uid, onUpdate, onError) {
  const q = query(collection(db, 'customerReminders'), where('authorUid', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          name: data.name || '',
          phone: data.phone || '',
          car: data.car || '',
          remindDate: data.remindDate || '',
          note: data.note || '',
          done: !!data.done,
          notified: !!data.notified,
        };
      });
      onUpdate(items);
    },
    onError
  );
}

async function createReminder(db, { authorUid, ...data }) {
  const ref = await addDoc(collection(db, 'customerReminders'), {
    ...data,
    authorUid,
    notified: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

async function updateReminder(db, id, data) {
  await updateDoc(doc(db, 'customerReminders', id), { ...data, updatedAt: serverTimestamp() });
}

async function deleteReminder(db, id) {
  await deleteDoc(doc(db, 'customerReminders', id));
}

// --- 조직 관리 (본부/지점/팀/직급/권한) ---
// orgMembers/{uid} — 계정마다 하나. 최초 로그인 시 본인이 "존재 등록"(create)만 할 수 있고,
// 이후 조직/팀/직급/권한 변경은 Firestore 규칙상 superAdmin만 가능(update). 그래서 이
// 컬렉션이 동시에 "이 앱에 로그인해본 계정 전체 목록"과 "조직도"를 겸한다.
const ORG_MEMBER_DEFAULTS = {
  name: '',
  organization: null, // 예: '본사-3본부' | '양주지점' 등 7개 고정값 중 하나, 미배정이면 null
  teamId: null,
  position: '',
  permission: 'member', // superAdmin | orgManager | teamManager | member
  active: true,
};

async function ensureOrgMemberRecord(db, user) {
  const ref = doc(db, 'orgMembers', user.uid);
  // 문서가 이미 있으면 절대 다시 안 쓴다 — superAdmin 본인은 규칙상 자기 문서를
  // update할 수 있어서, 존재 확인 없이 무조건 setDoc을 했더니 재로그인할 때마다
  // 본인의 permission/organization/team/position이 기본값으로 리셋되는 버그가 있었다.
  const existing = await getDoc(ref);
  if (existing.exists()) return;
  try {
    await setDoc(ref, {
      ...ORG_MEMBER_DEFAULTS,
      uid: user.uid,
      email: user.email || '',
      name: user.displayName || '',
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
  } catch (err) {
    if (err && err.code !== 'permission-denied') throw err;
    // 최초 등록 시점이 겹치는 등의 드문 경합 — 조용히 무시.
  }
}

function orgMemberFromSnap(docSnap) {
  const data = docSnap.data();
  return {
    uid: docSnap.id,
    email: data.email || '',
    name: data.name || '',
    organization: data.organization || null,
    teamId: data.teamId || null,
    position: data.position || '',
    permission: data.permission || 'member',
    active: data.active !== false,
  };
}

function subscribeToOrgMemberSelf(db, uid, onUpdate, onError) {
  return onSnapshot(doc(db, 'orgMembers', uid), (docSnap) => {
    onUpdate(docSnap.exists() ? orgMemberFromSnap(docSnap) : null);
  }, onError);
}

// superAdmin용 — 전체. Firestore 규칙이 실제 권한 없는 요청은 거부하므로, 여기선
// "부르는 쪽이 정당한 권한인지"를 다시 검증하지 않는다(규칙이 최종 방어선).
async function getAllOrgMembers(db) {
  const snapshot = await getDocs(collection(db, 'orgMembers'));
  return snapshot.docs.map(orgMemberFromSnap);
}

async function getOrgMembersByOrganization(db, organization) {
  const q = query(collection(db, 'orgMembers'), where('organization', '==', organization));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(orgMemberFromSnap);
}

async function getOrgMembersByTeam(db, teamId) {
  const q = query(collection(db, 'orgMembers'), where('teamId', '==', teamId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(orgMemberFromSnap);
}

async function updateOrgMember(db, uid, data) {
  await updateDoc(doc(db, 'orgMembers', uid), { ...data, updatedAt: serverTimestamp() });
}

// --- 팀 (본부/지점 안의 하위 조직) ---

function orgTeamFromSnap(docSnap) {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    organization: data.organization || '',
    teamName: data.teamName || '',
    teamManagerUid: data.teamManagerUid || null,
    order: data.order || 0,
  };
}

function subscribeToOrgTeams(db, onUpdate, onError) {
  return onSnapshot(collection(db, 'orgTeams'), (snapshot) => {
    onUpdate(snapshot.docs.map(orgTeamFromSnap));
  }, onError);
}

async function createOrgTeam(db, data) {
  const ref = await addDoc(collection(db, 'orgTeams'), { ...data, createdAt: serverTimestamp() });
  return ref.id;
}

async function updateOrgTeam(db, id, data) {
  await updateDoc(doc(db, 'orgTeams', id), data);
}

async function deleteOrgTeam(db, id) {
  await deleteDoc(doc(db, 'orgTeams', id));
}

// --- 인사이동/변경 로그 (superAdmin 전용) ---

async function addOrgHistory(db, entry) {
  await addDoc(collection(db, 'orgHistory'), { ...entry, at: serverTimestamp() });
}

function subscribeToOrgHistory(db, onUpdate, onError) {
  const q = query(collection(db, 'orgHistory'));
  return onSnapshot(q, (snapshot) => {
    const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));
    onUpdate(items);
  }, onError);
}

// --- 본부/지점별 외부 시트 링크 (settings/branchLinks 문서 하나에 map으로 저장) ---

async function getBranchLinks(db) {
  const snap = await getDoc(doc(db, 'settings', 'branchLinks'));
  return snap.exists() ? snap.data() : {};
}

async function setBranchLinks(db, links) {
  await setDoc(doc(db, 'settings', 'branchLinks'), links);
}

// --- 조직 장부(관리자 조회 전용) — 담당 범위 uid 목록으로 이번 달 항목을 모아온다.
// Firestore 'in'은 한 번에 최대 30개까지라, 그보다 많으면 나눠서 여러 번 쿼리한다. ---

async function getChulgoEntriesForAuthors(db, uids, month) {
  if (!uids.length) return [];
  const chunks = [];
  for (let i = 0; i < uids.length; i += 30) chunks.push(uids.slice(i, i + 30));

  // authorUid('in') + month('==')를 같이 걸면 Firestore 복합 색인이 별도로 필요해서
  // (콘솔에서 색인을 미리 만들어두지 않으면 조회 자체가 실패한다), authorUid만으로
  // 걸러 받고 month는 여기서 필터링한다 — 색인 설정 없이 그냥 동작하게.
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const q = query(collection(db, 'chulgoEntries'), where('authorUid', 'in', chunk));
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((e) => e.month === month);
    })
  );
  return results.flat();
}

// --- 계정 메모 (상호명/ID/PW) — 같은 본부/지점 사람들끼리만 보이는 공유 메모.
// 재광님 확인: Cloud Functions/암호화 없이 일단 평문으로 저장 — 그래서 접근 범위를
// "같은 소속"으로만 좁혀서(Firestore 규칙) 위험을 줄인다. 나중에 Blaze 준비되면
// 이 컬렉션을 암호화 구조로 옮길 수 있다. ---

function financeCredentialFromSnap(docSnap) {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    siteName: data.siteName || '',
    loginId: data.loginId || '',
    loginPw: data.loginPw || '',
    organization: data.organization || '',
    authorUid: data.authorUid || '',
    authorName: data.authorName || '',
  };
}

function subscribeToFinanceCredentials(db, organization, onUpdate, onError) {
  const q = query(collection(db, 'financeCredentials'), where('organization', '==', organization));
  return onSnapshot(q, (snapshot) => {
    onUpdate(snapshot.docs.map(financeCredentialFromSnap));
  }, onError);
}

async function createFinanceCredential(db, data) {
  const ref = await addDoc(collection(db, 'financeCredentials'), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}

async function updateFinanceCredential(db, id, data) {
  await updateDoc(doc(db, 'financeCredentials', id), { ...data, updatedAt: serverTimestamp() });
}

async function deleteFinanceCredential(db, id) {
  await deleteDoc(doc(db, 'financeCredentials', id));
}

module.exports = {
  initFirebase,
  signInWithGoogleIdToken,
  signOutFirebase,
  onAuthStateChangedListener,
  subscribeToAdmins,
  setAdmins,
  deleteFirebaseAccount,
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
  subscribeToReminders,
  createReminder,
  updateReminder,
  deleteReminder,
  ensureOrgMemberRecord,
  subscribeToOrgMemberSelf,
  getAllOrgMembers,
  getOrgMembersByOrganization,
  getOrgMembersByTeam,
  updateOrgMember,
  subscribeToOrgTeams,
  createOrgTeam,
  updateOrgTeam,
  deleteOrgTeam,
  addOrgHistory,
  subscribeToOrgHistory,
  getBranchLinks,
  setBranchLinks,
  getChulgoEntriesForAuthors,
  subscribeToFinanceCredentials,
  createFinanceCredential,
  updateFinanceCredential,
  deleteFinanceCredential,
};
