const FIREBASE_SDK_VERSION = '10.12.2';

let app = null;
let auth = null;
let db = null;
let authMod = null;
let firestoreMod = null;
let currentUser = null;
const authListeners = [];

function parseFirebaseConfig(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) throw new Error('EMPTY_CONFIG');
  try {
    return new Function('return (' + trimmed.replace(/^const\s+\w+\s*=\s*/, '').replace(/;\s*$/, '') + ')')();
  } catch (e) {
    throw new Error('INVALID_CONFIG');
  }
}

async function init(config) {
  const appMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`);
  authMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`);
  firestoreMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`);

  app = appMod.initializeApp(config);
  auth = authMod.getAuth(app);
  db = firestoreMod.getFirestore(app);

  authMod.onAuthStateChanged(auth, (user) => {
    currentUser = user;
    authListeners.forEach((cb) => cb(user));
  });
}

async function signIn() {
  const provider = new authMod.GoogleAuthProvider();
  await authMod.signInWithPopup(auth, provider);
}

async function signOutUser() {
  await authMod.signOut(auth);
}

function onAuthChange(callback) {
  authListeners.push(callback);
  if (auth) callback(currentUser);
}

function isSignedIn() {
  return !!currentUser;
}

function getCurrentUser() {
  return currentUser;
}

async function pushDay(date, entries) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'days', date), { entries });
}

async function pullAllDays() {
  if (!currentUser) return {};
  const { collection, getDocs } = firestoreMod;
  const snapshot = await getDocs(collection(db, 'users', currentUser.uid, 'days'));
  const result = {};
  snapshot.forEach((docSnap) => {
    result[docSnap.id] = docSnap.data().entries || [];
  });
  return result;
}

// Dokumenty users/{uid}/meta/* — jeden ogólny zapis; co w nich siedzi, opisuje META w ui.js
async function pushMeta(docId, data) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'meta', docId), data);
}

// Wszystkie dokumenty meta naraz (także shardy *-YYYY-MM) — jedno zapytanie na sync
async function pullAllMeta() {
  if (!currentUser) return {};
  const { collection, getDocs } = firestoreMod;
  const snapshot = await getDocs(collection(db, 'users', currentUser.uid, 'meta'));
  const result = {};
  snapshot.forEach((docSnap) => { result[docSnap.id] = docSnap.data(); });
  return result;
}

async function pushSharedRecipe(recipientUid, recipe) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  const shareId = crypto.randomUUID();
  await setDoc(doc(db, 'sharedRecipes', recipientUid, 'inbox', shareId), {
    name: recipe.name,
    ingredients: recipe.ingredients,
    totalWeightCooked: recipe.totalWeightCooked,
    per100g: recipe.per100g,
    sharedBy: currentUser.uid,
    sharedAt: new Date().toISOString()
  });
}

async function pullSharedRecipes() {
  if (!currentUser) return [];
  const { collection, getDocs } = firestoreMod;
  const snapshot = await getDocs(collection(db, 'sharedRecipes', currentUser.uid, 'inbox'));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function deleteSharedRecipe(id) {
  if (!currentUser) return;
  const { doc, deleteDoc } = firestoreMod;
  await deleteDoc(doc(db, 'sharedRecipes', currentUser.uid, 'inbox', id));
}

async function pushSharedSupplement(recipientUid, supplement) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  const shareId = crypto.randomUUID();
  const {
    name, displayName, dose, notes, timing, scheduleType, scheduleDays, scheduleN,
    cycleOn, cycleOff, timesPerDay, type, form, servingSize, packageSize, brand,
    ingredients, instructions, warnings
  } = supplement;
  const payload = {
    name, displayName, dose, notes, timing, scheduleType, scheduleDays, scheduleN,
    cycleOn, cycleOff, timesPerDay, type, form, servingSize, packageSize, brand,
    ingredients, instructions, warnings,
    sharedBy: currentUser.uid,
    sharedAt: new Date().toISOString()
  };
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });
  await setDoc(doc(db, 'sharedSupplements', recipientUid, 'inbox', shareId), payload);
}

async function pullSharedSupplements() {
  if (!currentUser) return [];
  const { collection, getDocs } = firestoreMod;
  const snapshot = await getDocs(collection(db, 'sharedSupplements', currentUser.uid, 'inbox'));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function deleteSharedSupplement(id) {
  if (!currentUser) return;
  const { doc, deleteDoc } = firestoreMod;
  await deleteDoc(doc(db, 'sharedSupplements', currentUser.uid, 'inbox', id));
}

const FirebaseSync = {
  init,
  signIn,
  signOutUser,
  onAuthChange,
  isSignedIn,
  getCurrentUser,
  pushDay,
  pullAllDays,
  pushMeta,
  pullAllMeta,
  pushSharedRecipe,
  pullSharedRecipes,
  deleteSharedRecipe,
  pushSharedSupplement,
  pullSharedSupplements,
  deleteSharedSupplement,
  parseFirebaseConfig
};

window.FirebaseSync = FirebaseSync;
