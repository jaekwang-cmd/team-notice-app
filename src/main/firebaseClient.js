const { initializeApp } = require('firebase/app');
const { getAuth, GoogleAuthProvider, signInWithCredential, signOut } = require('firebase/auth');
const {
  getFirestore,
  collection,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
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

// --- Announcements ---

function subscribeToAnnouncements(db, onUpdate, onError) {
  const q = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(
    q,
    (snapshot) => {
      const announcements = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          text: data.text,
          author: data.author,
          authorUid: data.authorUid,
          confirmedBy: data.confirmedBy || {},
          shoutedAt: data.shoutedAt ? data.shoutedAt.toMillis() : null,
          createdAt: data.createdAt ? data.createdAt.toMillis() : Date.now(),
        };
      });
      onUpdate(announcements);
    },
    onError
  );
}

async function postAnnouncement(db, { text, author, authorUid }) {
  await addDoc(collection(db, 'announcements'), {
    text,
    author,
    authorUid,
    confirmedBy: {},
    shoutedAt: null,
    createdAt: serverTimestamp(),
  });
}

async function updateAnnouncement(db, id, data) {
  await updateDoc(doc(db, 'announcements', id), data);
}

async function setConfirmedBy(db, id, uid, name, confirmed) {
  await updateDoc(doc(db, 'announcements', id), {
    [`confirmedBy.${uid}`]: confirmed ? name : deleteField(),
  });
}

async function shoutAnnouncement(db, id) {
  await updateDoc(doc(db, 'announcements', id), { shoutedAt: serverTimestamp() });
}

async function deleteAnnouncement(db, id) {
  await deleteDoc(doc(db, 'announcements', id));
}

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

function subscribeToTeamEvents(db, onUpdate, onError) {
  return onSnapshot(
    collection(db, 'teamEvents'),
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
    allDay,
    createdByName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

async function updateTeamEvent(db, id, data) {
  await updateDoc(doc(db, 'teamEvents', id), { ...data, updatedAt: serverTimestamp() });
}

async function deleteTeamEvent(db, id) {
  await deleteDoc(doc(db, 'teamEvents', id));
}

module.exports = {
  initFirebase,
  signInWithGoogleIdToken,
  signOutFirebase,
  subscribeToAnnouncements,
  postAnnouncement,
  updateAnnouncement,
  setConfirmedBy,
  shoutAnnouncement,
  deleteAnnouncement,
  subscribeToAdmins,
  setAdmins,
  subscribeToTeamEvents,
  createTeamEvent,
  updateTeamEvent,
  deleteTeamEvent,
};
