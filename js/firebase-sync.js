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

async function pushSettings(settings) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'meta', 'settings'), settings);
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

async function pullSettings() {
  if (!currentUser) return null;
  const { doc, getDoc } = firestoreMod;
  const snap = await getDoc(doc(db, 'users', currentUser.uid, 'meta', 'settings'));
  return snap.exists() ? snap.data() : null;
}

async function pushWeights(weights) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'meta', 'weights'), { map: weights });
}

async function pullWeights() {
  if (!currentUser) return {};
  const { doc, getDoc } = firestoreMod;
  const snap = await getDoc(doc(db, 'users', currentUser.uid, 'meta', 'weights'));
  return snap.exists() ? snap.data().map || {} : {};
}

async function pushFavorites(favorites) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'meta', 'favorites'), { list: favorites });
}

async function pullFavorites() {
  if (!currentUser) return [];
  const { doc, getDoc } = firestoreMod;
  const snap = await getDoc(doc(db, 'users', currentUser.uid, 'meta', 'favorites'));
  return snap.exists() ? snap.data().list || [] : [];
}

async function pushRecipes(recipes) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'meta', 'recipes'), { list: recipes });
}

async function pullRecipes() {
  if (!currentUser) return [];
  const { doc, getDoc } = firestoreMod;
  const snap = await getDoc(doc(db, 'users', currentUser.uid, 'meta', 'recipes'));
  return snap.exists() ? snap.data().list || [] : [];
}

async function pushGoals(goals) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'meta', 'goals'), { list: goals });
}

async function pullGoals() {
  if (!currentUser) return [];
  const { doc, getDoc } = firestoreMod;
  const snap = await getDoc(doc(db, 'users', currentUser.uid, 'meta', 'goals'));
  return snap.exists() ? snap.data().list || [] : [];
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

async function pushDailyAnalyses(map) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'meta', 'dailyAnalyses'), { map });
}

async function pullDailyAnalyses() {
  if (!currentUser) return {};
  const { doc, getDoc } = firestoreMod;
  const snap = await getDoc(doc(db, 'users', currentUser.uid, 'meta', 'dailyAnalyses'));
  return snap.exists() ? snap.data().map || {} : {};
}

const FirebaseSync = {
  init,
  signIn,
  signOutUser,
  onAuthChange,
  isSignedIn,
  getCurrentUser,
  pushDay,
  pushSettings,
  pullAllDays,
  pullSettings,
  pushWeights,
  pullWeights,
  pushFavorites,
  pullFavorites,
  pushRecipes,
  pullRecipes,
  pushGoals,
  pullGoals,
  pushDailyAnalyses,
  pullDailyAnalyses,
  pushSharedRecipe,
  pullSharedRecipes,
  deleteSharedRecipe,
  parseFirebaseConfig
};

window.FirebaseSync = FirebaseSync;
