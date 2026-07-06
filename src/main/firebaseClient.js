const { initializeApp } = require('firebase/app');
const { getAuth, GoogleAuthProvider, signInWithCredential, signOut } = require('firebase/auth');
const {
  getFirestore,
  collection,
  addDoc,
  doc,
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

async function deleteAnnouncement(db, id) {
  await deleteDoc(doc(db, 'announcements', id));
}

module.exports = {
  initFirebase,
  signInWithGoogleIdToken,
  signOutFirebase,
  subscribeToAnnouncements,
  postAnnouncement,
  updateAnnouncement,
  setConfirmedBy,
  deleteAnnouncement,
};
