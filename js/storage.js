const Storage = (() => {
  const SETTINGS_KEY = 'settings';
  const ENTRY_PREFIX = 'entries_';
  const WEIGHTS_KEY = 'weights';
  const FAVORITES_KEY = 'favoriteProducts';
  const RECIPES_KEY = 'recipes';
  const GOALS_KEY = 'analysisGoals';
  const DAILY_ANALYSES_KEY = 'dailyAnalyses';
  const SUPPLEMENTS_KEY = 'supplements';
  const SUPPLEMENT_LOG_KEY = 'supplementLog';
  const SUPPLEMENT_ANALYSES_KEY = 'supplementAnalyses';
  const DIET_ANALYSES_KEY = 'dietAnalyses';
  const SUPP_STATIC_CACHE_KEY = 'suppAnalysisStaticCache';
  const ADHOC_QUICK_KEY = 'adhocQuickItems';
  const SEEN_SHARED_RECIPES_KEY = 'seenSharedRecipeIds';
  const SEEN_SHARED_SUPPLEMENTS_KEY = 'seenSharedSupplementIds';
  const THEME_KEY = 'themePreference';
  const HISTORY_METRIC_KEY = 'historyMetricPreference';

  const DEFAULT_SETTINGS = {
    kcalGoal: 2000,
    proteinGoal: 150,
    carbsGoal: 200,
    fatGoal: 70,
    fiberGoal: 30,
    geminiApiKey: '',
    firebaseConfig: '',
    healthProfile: '',
    partnerUid: ''
  };

  function getSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // Preferencja motywu jest per-urządzenie — celowo nie wchodzi do settings/sync
  function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'auto';
  }

  function saveTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
  }

  // Wybrana metryka wykresu w Historii — per-urządzenie, celowo nie wchodzi do settings/sync
  function getHistoryMetric() {
    return localStorage.getItem(HISTORY_METRIC_KEY) || 'kcal';
  }

  function saveHistoryMetric(metric) {
    localStorage.setItem(HISTORY_METRIC_KEY, metric);
  }

  // Surowa lista zawiera także nagrobki (deleted: true) potrzebne do synchronizacji
  function getRawEntries(date) {
    const raw = localStorage.getItem(ENTRY_PREFIX + date);
    return raw ? JSON.parse(raw) : [];
  }

  function getEntries(date) {
    return getRawEntries(date).filter((e) => !e.deleted);
  }

  function saveEntries(date, entries) {
    localStorage.setItem(ENTRY_PREFIX + date, JSON.stringify(entries));
  }

  function addEntry(date, entry) {
    const entries = getRawEntries(date);
    const newEntry = { ...entry, id: crypto.randomUUID(), date, updatedAt: new Date().toISOString() };
    entries.push(newEntry);
    saveEntries(date, entries);
    return newEntry;
  }

  function updateEntry(date, id, data) {
    const entries = getRawEntries(date);
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    entries[idx] = { ...entries[idx], ...data, updatedAt: new Date().toISOString() };
    saveEntries(date, entries);
    return entries[idx];
  }

  function deleteEntry(date, id) {
    const entries = getRawEntries(date).map((e) =>
      e.id === id ? { id: e.id, deleted: true, updatedAt: new Date().toISOString() } : e
    );
    saveEntries(date, entries);
  }

  // Scala dwie listy wpisów po id; przy konflikcie wygrywa nowszy updatedAt.
  // Dzięki nagrobkom usunięcie na jednym urządzeniu nie "zmartwychwstaje" po syncu.
  function mergeEntryLists(listA, listB) {
    const byId = new Map();
    [...listA, ...listB].forEach((e) => {
      const prev = byId.get(e.id);
      if (!prev || (e.updatedAt || '') > (prev.updatedAt || '')) byId.set(e.id, e);
    });
    return [...byId.values()];
  }

  function getDailySummary(date) {
    const entries = getEntries(date);
    return entries.reduce(
      (sum, e) => ({
        kcal: sum.kcal + (Number(e.kcal) || 0),
        protein: sum.protein + (Number(e.protein) || 0),
        carbs: sum.carbs + (Number(e.carbs) || 0),
        fat: sum.fat + (Number(e.fat) || 0),
        fiber: sum.fiber + (Number(e.fiber) || 0)
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );
  }

  // Waga: mapa { "YYYY-MM-DD": { kg, updatedAt } }, usunięcia jako nagrobki
  // (deleted: true) — ten sam mechanizm merge co przy wpisach
  function getWeights() {
    const raw = localStorage.getItem(WEIGHTS_KEY);
    return raw ? JSON.parse(raw) : {};
  }

  function saveWeights(map) {
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(map));
  }

  function getWeight(date) {
    const w = getWeights()[date];
    return w && !w.deleted ? w.kg : null;
  }

  function getWeightFull(date) {
    const w = getWeights()[date];
    if (!w || w.deleted) return null;
    return { kg: w.kg, smm: Number(w.smm) || null, bf: Number(w.bf) || null };
  }

  function setWeight(date, kg, body) {
    const map = getWeights();
    if (kg == null) {
      if (!map[date]) return;
      map[date] = { deleted: true, updatedAt: new Date().toISOString() };
    } else {
      const rec = { kg, updatedAt: new Date().toISOString() };
      if (body && body.smm != null) rec.smm = body.smm;
      if (body && body.bf != null) rec.bf = body.bf;
      map[date] = rec;
    }
    saveWeights(map);
  }

  // Ostatni pomiar z dnia <= date — waga "obowiązuje" do następnego pomiaru
  function getLatestWeight(date) {
    let latest = null;
    Object.entries(getWeights()).forEach(([d, w]) => {
      if (w.deleted || d > date) return;
      if (!latest || d > latest.date) latest = { date: d, kg: w.kg, smm: Number(w.smm) || null, bf: Number(w.bf) || null };
    });
    return latest;
  }

  function getLatestBodyComp(date) {
    let latest = null;
    Object.entries(getWeights()).forEach(([d, w]) => {
      if (w.deleted || d > date || (!w.smm && !w.bf)) return;
      if (!latest || d > latest.date) latest = { date: d, smm: Number(w.smm) || null, bf: Number(w.bf) || null };
    });
    return latest;
  }

  function getWeightHistory() {
    return Object.entries(getWeights())
      .filter(([, w]) => !w.deleted)
      .map(([date, w]) => ({ date, kg: w.kg, smm: Number(w.smm) || null, bf: Number(w.bf) || null }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function mergeWeights(mapA, mapB) {
    const merged = { ...mapA };
    Object.entries(mapB).forEach(([date, w]) => {
      const prev = merged[date];
      if (!prev || (w.updatedAt || '') > (prev.updatedAt || '')) merged[date] = w;
    });
    return merged;
  }

  function getAllDatesWithEntries() {
    const dates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(ENTRY_PREFIX)) {
        const date = key.slice(ENTRY_PREFIX.length);
        const entries = getEntries(date);
        if (entries.length > 0) dates.push(date);
      }
    }
    return dates.sort((a, b) => b.localeCompare(a));
  }

  function getAllDates() {
    const dates = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(ENTRY_PREFIX)) dates.push(key.slice(ENTRY_PREFIX.length));
    }
    return dates;
  }

  function buildProductIndex() {
    const byName = new Map();
    getAllDates().forEach((date) => {
      getEntries(date).forEach((e) => {
        if (!e.name) return;
        const key = e.name.trim().toLowerCase();
        const item = byName.get(key);
        if (!item) {
          byName.set(key, { count: 1, lastDate: date, entry: e });
        } else {
          item.count++;
          if (date > item.lastDate) {
            item.lastDate = date;
            item.entry = e;
          }
        }
      });
    });
    return [...byName.values()]
      .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
  }

  function getFrequentProducts(limit = 8) {
    return buildProductIndex().slice(0, limit).map((i) => i.entry);
  }

  function getUniqueProducts() {
    return buildProductIndex().map((i) => i.entry);
  }

  // Surowa lista zawiera także nagrobki (deleted: true) potrzebne do synchronizacji
  function getRawFavoriteProducts() {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  function getFavoriteProducts() {
    return getRawFavoriteProducts().filter((p) => !p.deleted);
  }

  function saveFavoriteProducts(list) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  }

  function isFavoriteProduct(name) {
    const key = (name || '').trim().toLowerCase();
    if (!key) return false;
    return getFavoriteProducts().some((p) => p.key === key);
  }

  function addFavoriteProduct(product) {
    const key = (product.name || '').trim().toLowerCase();
    if (!key) return;
    const list = getRawFavoriteProducts().filter((p) => p.key !== key);
    list.push({
      key,
      name: product.name,
      grams: product.grams,
      kcal: product.kcal,
      protein: product.protein,
      carbs: product.carbs,
      fat: product.fat,
      fiber: product.fiber,
      per100g: product.per100g || null,
      source: product.source || 'manual',
      updatedAt: new Date().toISOString()
    });
    saveFavoriteProducts(list);
  }

  function removeFavoriteProduct(name) {
    const key = (name || '').trim().toLowerCase();
    const list = getRawFavoriteProducts();
    const idx = list.findIndex((p) => p.key === key);
    if (idx === -1) return;
    list[idx] = { key, deleted: true, updatedAt: new Date().toISOString() };
    saveFavoriteProducts(list);
  }

  // Przełącza status ulubionego; zwraca nowy stan (true = dodano, false = usunięto)
  function toggleFavoriteProduct(product) {
    if (isFavoriteProduct(product.name)) {
      removeFavoriteProduct(product.name);
      return false;
    }
    addFavoriteProduct(product);
    return true;
  }

  // Scala dwie listy ulubionych po key; przy konflikcie wygrywa nowszy updatedAt
  // (ten sam mechanizm nagrobków co przy wpisach/wadze)
  function mergeFavoriteProducts(listA, listB) {
    const byKey = new Map();
    [...listA, ...listB].forEach((p) => {
      const prev = byKey.get(p.key);
      if (!prev || (p.updatedAt || '') > (prev.updatedAt || '')) byKey.set(p.key, p);
    });
    return [...byKey.values()];
  }

  // ── Przepisy ──

  function getRawRecipes() {
    const raw = localStorage.getItem(RECIPES_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  function getRecipes() {
    return getRawRecipes().filter((r) => !r.deleted);
  }

  function saveRecipes(list) {
    localStorage.setItem(RECIPES_KEY, JSON.stringify(list));
  }

  function addRecipe(recipe) {
    const list = getRawRecipes();
    const newRecipe = { ...recipe, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    list.push(newRecipe);
    saveRecipes(list);
    return newRecipe;
  }

  function updateRecipe(id, data) {
    const list = getRawRecipes();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...data, updatedAt: new Date().toISOString() };
    saveRecipes(list);
    return list[idx];
  }

  function deleteRecipe(id) {
    const list = getRawRecipes().map((r) =>
      r.id === id ? { id: r.id, deleted: true, updatedAt: new Date().toISOString() } : r
    );
    saveRecipes(list);
  }

  function getRecipeById(id) {
    return getRecipes().find((r) => r.id === id) || null;
  }

  function mergeRecipes(listA, listB) {
    const byId = new Map();
    [...listA, ...listB].forEach((r) => {
      const prev = byId.get(r.id);
      if (!prev || (r.updatedAt || '') > (prev.updatedAt || '')) byId.set(r.id, r);
    });
    return [...byId.values()];
  }

  // Lokalny guard przed duplikatem importu udostępnionego przepisu — czysto lokalny,
  // nie synchronizowany, na wypadek gdyby usunięcie ze skrzynki Firestore się nie udało
  function getSeenSharedRecipeIds() {
    const raw = localStorage.getItem(SEEN_SHARED_RECIPES_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  function addSeenSharedRecipeId(id) {
    const ids = getSeenSharedRecipeIds();
    if (!ids.includes(id)) {
      ids.push(id);
      localStorage.setItem(SEEN_SHARED_RECIPES_KEY, JSON.stringify(ids));
    }
  }

  // ── Cele analizy dnia (własne system prompty do oceny posiłków przez Gemini) ──

  function getRawGoals() {
    const raw = localStorage.getItem(GOALS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  function getGoals() {
    return getRawGoals().filter((g) => !g.deleted);
  }

  function saveGoals(list) {
    localStorage.setItem(GOALS_KEY, JSON.stringify(list));
  }

  function addGoal(goal) {
    const list = getRawGoals();
    const newGoal = { ...goal, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    list.push(newGoal);
    saveGoals(list);
    return newGoal;
  }

  function updateGoal(id, data) {
    const list = getRawGoals();
    const idx = list.findIndex((g) => g.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...data, updatedAt: new Date().toISOString() };
    saveGoals(list);
    return list[idx];
  }

  function deleteGoal(id) {
    const list = getRawGoals().map((g) =>
      g.id === id ? { id: g.id, deleted: true, updatedAt: new Date().toISOString() } : g
    );
    saveGoals(list);
  }

  function mergeGoals(listA, listB) {
    const byId = new Map();
    [...listA, ...listB].forEach((g) => {
      const prev = byId.get(g.id);
      if (!prev || (g.updatedAt || '') > (prev.updatedAt || '')) byId.set(g.id, g);
    });
    return [...byId.values()];
  }

  // ── Suplementy i leki — definicje; nagrobki + merge jak przy celach ──

  function getRawSupplements() {
    const raw = localStorage.getItem(SUPPLEMENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  function getSupplements() {
    return getRawSupplements().filter((s) => !s.deleted);
  }

  function saveSupplements(list) {
    localStorage.setItem(SUPPLEMENTS_KEY, JSON.stringify(list));
  }

  function addSupplement(supp) {
    const list = getRawSupplements();
    const newSupp = {
      active: true,
      anchorDate: new Date().toISOString().slice(0, 10),
      ...supp,
      id: crypto.randomUUID(),
      updatedAt: new Date().toISOString()
    };
    list.push(newSupp);
    saveSupplements(list);
    return newSupp;
  }

  function updateSupplement(id, data) {
    const list = getRawSupplements();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...data, updatedAt: new Date().toISOString() };
    saveSupplements(list);
    return list[idx];
  }

  function deleteSupplement(id) {
    const list = getRawSupplements().map((s) =>
      s.id === id ? { id: s.id, deleted: true, updatedAt: new Date().toISOString() } : s
    );
    saveSupplements(list);
  }

  function mergeSupplements(listA, listB) {
    const byId = new Map();
    [...listA, ...listB].forEach((s) => {
      const prev = byId.get(s.id);
      if (!prev || (s.updatedAt || '') > (prev.updatedAt || '')) byId.set(s.id, s);
    });
    return [...byId.values()];
  }

  // Lokalny guard przed duplikatem importu udostępnionego suplementu — jak przy przepisach
  function getSeenSharedSupplementIds() {
    const raw = localStorage.getItem(SEEN_SHARED_SUPPLEMENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  function addSeenSharedSupplementId(id) {
    const ids = getSeenSharedSupplementIds();
    if (!ids.includes(id)) {
      ids.push(id);
      localStorage.setItem(SEEN_SHARED_SUPPLEMENTS_KEY, JSON.stringify(ids));
    }
  }

  // Różnica pełnych dni między datami YYYY-MM-DD (UTC, odporne na zmianę czasu)
  function daysBetween(dateA, dateB) {
    const [ya, ma, da] = dateA.split('-').map(Number);
    const [yb, mb, db] = dateB.split('-').map(Number);
    return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
  }

  // Czy wg harmonogramu suplement ma być wzięty w dniu `date` (YYYY-MM-DD)
  function isSupplementDueOn(supp, date) {
    if (supp.deleted || supp.active === false) return false;
    const type = supp.scheduleType || 'daily';
    if (type === 'daily') return true;
    if (type === 'weekdays') {
      const [y, m, d] = date.split('-').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      return Array.isArray(supp.scheduleDays) && supp.scheduleDays.includes(dow);
    }
    const anchor = supp.anchorDate || date;
    const diff = daysBetween(anchor, date);
    if (diff < 0) return false;
    if (type === 'everyN') {
      const n = Number(supp.scheduleN) || 1;
      return diff % n === 0;
    }
    if (type === 'cycle') {
      const on = Number(supp.cycleOn) || 1;
      const off = Number(supp.cycleOff) || 0;
      return diff % (on + off) < on;
    }
    return true;
  }

  // Bieżący zapas: baza minus dawki z logu wzięte PO dacie bazy (date > stockBaselineDate).
  // Zwraca mapę suppId -> liczba sztuk (tylko suplementy ze śledzonym zapasem).
  function getRemainingStockMap() {
    const supps = getSupplements().filter((s) => s.stockBaseline != null || s.stock != null);
    if (supps.length === 0) return {};
    const result = {};
    supps.forEach((s) => {
      result[s.id] = { base: s.stockBaseline != null ? Number(s.stockBaseline) : Number(s.stock) || 0,
                       since: s.stockBaseline != null ? (s.stockBaselineDate || '') : '9999-12-31',
                       used: 0 };
    });
    Object.values(getRawSupplementLog()).forEach((rec) => {
      if (rec.deleted || !rec.suppId || !result[rec.suppId]) return;
      if ((rec.date || '') > result[rec.suppId].since) {
        result[rec.suppId].used += getSupplementTimes(rec).length;
      }
    });
    const out = {};
    Object.entries(result).forEach(([id, r]) => { out[id] = Math.max(0, r.base - r.used); });
    return out;
  }

  // Na ile dni starczy zapasu wg harmonogramu; zwraca { days, lastDate } albo null.
  // Liczy od jutra, maks. 365 dni w przód. days = liczba dni od dziś do lastDate.
  function getStockCoverage(supp, remaining) {
    if (remaining == null) return null;
    const perDay = Math.max(1, Number(supp.timesPerDay) || 1);
    const today = new Date().toISOString().slice(0, 10);
    let left = remaining;
    let lastDate = null;
    const d = new Date();
    for (let i = 1; i <= 365 && left > 0; i++) {
      d.setDate(d.getDate() + 1);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (isSupplementDueOn(supp, iso)) {
        left -= perDay;
        lastDate = iso;
      }
    }
    return { days: lastDate ? daysBetween(today, lastDate) : 0, lastDate };
  }

  // ── Zapisane raporty analizy dnia — mapa { "YYYY-MM-DD__goalId": {...} },
  // usunięcia jako nagrobki, ten sam mechanizm merge co przy wadze/ulubionych ──

  function analysisMapKey(date, goalId) {
    return `${date}__${goalId}`;
  }

  function getRawDailyAnalyses() {
    const raw = localStorage.getItem(DAILY_ANALYSES_KEY);
    return raw ? JSON.parse(raw) : {};
  }

  function saveRawDailyAnalyses(map) {
    localStorage.setItem(DAILY_ANALYSES_KEY, JSON.stringify(map));
  }

  function getDailyAnalyses(date) {
    return Object.values(getRawDailyAnalyses())
      .filter((a) => a.date === date && !a.deleted)
      .sort((a, b) => (a.goalName || '').localeCompare(b.goalName || ''));
  }

  function saveDailyAnalysis(date, goalId, goalName, result) {
    const map = getRawDailyAnalyses();
    const key = analysisMapKey(date, goalId);
    map[key] = { date, goalId, goalName, result, updatedAt: new Date().toISOString() };
    saveRawDailyAnalyses(map);
  }

  function deleteDailyAnalysis(date, goalId) {
    const map = getRawDailyAnalyses();
    const key = analysisMapKey(date, goalId);
    if (!map[key]) return;
    map[key] = { date, goalId, deleted: true, updatedAt: new Date().toISOString() };
    saveRawDailyAnalyses(map);
  }

  function mergeDailyAnalyses(mapA, mapB) {
    const merged = { ...mapA };
    Object.entries(mapB).forEach(([key, a]) => {
      const prev = merged[key];
      if (!prev || (a.updatedAt || '') > (prev.updatedAt || '')) merged[key] = a;
    });
    return merged;
  }

  // ── Dziennik przyjęć suplementów — mapa { "YYYY-MM-DD__id": {...} },
  // nagrobki + merge jak przy raportach analizy dnia ──

  function supplementLogKey(date, id) {
    return `${date}__${id}`;
  }

  function getRawSupplementLog() {
    const raw = localStorage.getItem(SUPPLEMENT_LOG_KEY);
    return raw ? JSON.parse(raw) : {};
  }

  function saveRawSupplementLog(map) {
    localStorage.setItem(SUPPLEMENT_LOG_KEY, JSON.stringify(map));
  }

  // Wpisy z danego dnia (bez nagrobków)
  function getSupplementLogForDate(date) {
    return Object.entries(getRawSupplementLog())
      .filter(([, r]) => r.date === date && !r.deleted)
      .map(([key, r]) => ({ key, ...r }));
  }

  function getSupplementTimes(rec) {
    if (!rec || rec.deleted || !rec.taken) return [];
    if (Array.isArray(rec.times)) return rec.times;
    const count = Number(rec.count) || 1;
    return Array.from({ length: count }, () => rec.time || '');
  }

  function getSupplementTakenCount(date, suppId) {
    const rec = getRawSupplementLog()[supplementLogKey(date, suppId)];
    return getSupplementTimes(rec).length;
  }

  function getSupplementDoseTimes(date, suppId) {
    const rec = getRawSupplementLog()[supplementLogKey(date, suppId)];
    return getSupplementTimes(rec);
  }

  function isSupplementTaken(date, suppId) {
    return getSupplementTakenCount(date, suppId) > 0;
  }

  function toggleSupplementTaken(date, suppId, time) {
    const map = getRawSupplementLog();
    const key = supplementLogKey(date, suppId);
    const now = new Date().toISOString();
    const wasTaken = getSupplementTimes(map[key]).length > 0;
    map[key] = wasTaken
      ? { date, suppId, deleted: true, updatedAt: now }
      : { date, suppId, taken: true, times: [time || ''], updatedAt: now };
    saveRawSupplementLog(map);
    return !wasTaken;
  }

  function incrementSupplementDose(date, suppId, time) {
    const map = getRawSupplementLog();
    const key = supplementLogKey(date, suppId);
    const now = new Date().toISOString();
    const times = getSupplementTimes(map[key]);
    times.push(time || '');
    map[key] = { date, suppId, taken: true, times, updatedAt: now };
    saveRawSupplementLog(map);
    return times.length;
  }

  function updateSupplementDoseTime(date, suppId, index, newTime) {
    const map = getRawSupplementLog();
    const key = supplementLogKey(date, suppId);
    const times = getSupplementTimes(map[key]);
    if (index < 0 || index >= times.length) return;
    times[index] = newTime;
    map[key] = { ...map[key], times, updatedAt: new Date().toISOString() };
    saveRawSupplementLog(map);
  }

  function removeSupplementDose(date, suppId, index) {
    const map = getRawSupplementLog();
    const key = supplementLogKey(date, suppId);
    const times = getSupplementTimes(map[key]);
    if (index < 0 || index >= times.length) return 0;
    times.splice(index, 1);
    if (times.length === 0) {
      map[key] = { date, suppId, deleted: true, updatedAt: new Date().toISOString() };
    } else {
      map[key] = { ...map[key], times, updatedAt: new Date().toISOString() };
    }
    saveRawSupplementLog(map);
    return times.length;
  }

  function addAdhocSupplementLog(date, name, time) {
    const map = getRawSupplementLog();
    const id = crypto.randomUUID();
    map[supplementLogKey(date, id)] = {
      date, adhoc: true, name, time: time || '', updatedAt: new Date().toISOString()
    };
    saveRawSupplementLog(map);
    addAdhocQuickItem(name);
  }

  function getRawAdhocQuickItems() {
    try { return JSON.parse(localStorage.getItem(ADHOC_QUICK_KEY)) || []; }
    catch { return []; }
  }

  function getAdhocQuickItems() {
    return getRawAdhocQuickItems().filter((i) => !i.deleted);
  }

  function saveAdhocQuickItems(items) {
    localStorage.setItem(ADHOC_QUICK_KEY, JSON.stringify(items));
  }

  function addAdhocQuickItem(name) {
    const normalized = name.trim();
    if (!normalized) return;
    const items = getRawAdhocQuickItems();
    const now = new Date().toISOString();
    const idx = items.findIndex((i) => i.name.toLowerCase() === normalized.toLowerCase());
    if (idx !== -1) {
      items[idx] = { name: items[idx].deleted ? normalized : items[idx].name, usedAt: now, updatedAt: now };
    } else {
      items.push({ name: normalized, usedAt: now, updatedAt: now });
    }
    saveAdhocQuickItems(items);
  }

  function removeAdhocQuickItem(name) {
    const now = new Date().toISOString();
    const items = getRawAdhocQuickItems().map((i) =>
      i.name.toLowerCase() === name.toLowerCase() ? { name: i.name, deleted: true, updatedAt: now } : i
    );
    saveAdhocQuickItems(items);
  }

  // Scala dwie listy chipów po name (case-insensitive); przy konflikcie wygrywa nowszy
  // updatedAt (fallback usedAt dla starych rekordów bez updatedAt) — ten sam mechanizm
  // nagrobków co przy wpisach/ulubionych
  function mergeAdhocQuickItems(listA, listB) {
    const byName = new Map();
    [...listA, ...listB].forEach((i) => {
      const key = (i.name || '').toLowerCase();
      const prev = byName.get(key);
      const ts = i.updatedAt || i.usedAt || '';
      const prevTs = prev ? (prev.updatedAt || prev.usedAt || '') : '';
      if (!prev || ts > prevTs) byName.set(key, i);
    });
    return [...byName.values()];
  }

  function updateSupplementLogEntryTime(key, time) {
    const map = getRawSupplementLog();
    if (!map[key] || map[key].deleted) return;
    map[key] = { ...map[key], time, updatedAt: new Date().toISOString() };
    saveRawSupplementLog(map);
  }

  function deleteSupplementLogEntry(key) {
    const map = getRawSupplementLog();
    if (!map[key]) return;
    map[key] = { date: map[key].date, deleted: true, updatedAt: new Date().toISOString() };
    saveRawSupplementLog(map);
  }

  function mergeSupplementLog(mapA, mapB) {
    const merged = { ...mapA };
    Object.entries(mapB).forEach(([key, r]) => {
      const prev = merged[key];
      if (!prev || (r.updatedAt || '') > (prev.updatedAt || '')) merged[key] = r;
    });
    return merged;
  }

  // ── Raporty analizy suplementów — mapa { "scope__endDate": {...} },
  // nagrobki + merge jak przy dailyAnalyses ──

  function getRawSupplementAnalyses() {
    const raw = localStorage.getItem(SUPPLEMENT_ANALYSES_KEY);
    return raw ? JSON.parse(raw) : {};
  }

  function saveRawSupplementAnalyses(map) {
    localStorage.setItem(SUPPLEMENT_ANALYSES_KEY, JSON.stringify(map));
  }

  function getSupplementAnalyses() {
    return Object.entries(getRawSupplementAnalyses())
      .filter(([, r]) => !r.deleted)
      .map(([key, r]) => ({ key, ...r }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  function saveSupplementAnalysis(scope, startDate, endDate, result) {
    const map = getRawSupplementAnalyses();
    map[`${scope}__${endDate}`] = {
      scope, startDate, endDate, result, updatedAt: new Date().toISOString()
    };
    saveRawSupplementAnalyses(map);
  }

  function deleteSupplementAnalysis(key) {
    const map = getRawSupplementAnalyses();
    if (!map[key]) return;
    map[key] = { deleted: true, updatedAt: new Date().toISOString() };
    saveRawSupplementAnalyses(map);
  }

  function mergeSupplementAnalyses(mapA, mapB) {
    const merged = { ...mapA };
    Object.entries(mapB).forEach(([key, r]) => {
      const prev = merged[key];
      if (!prev || (r.updatedAt || '') > (prev.updatedAt || '')) merged[key] = r;
    });
    return merged;
  }

  // ── Raporty analizy AI diety — mapa { "scope__endDate": {...} },
  // nagrobki + merge jak przy supplementAnalyses ──

  function getRawDietAnalyses() {
    const raw = localStorage.getItem(DIET_ANALYSES_KEY);
    return raw ? JSON.parse(raw) : {};
  }

  function saveRawDietAnalyses(map) {
    localStorage.setItem(DIET_ANALYSES_KEY, JSON.stringify(map));
  }

  function getDietAnalyses() {
    return Object.entries(getRawDietAnalyses())
      .filter(([, r]) => !r.deleted)
      .map(([key, r]) => ({ key, ...r }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  function saveDietAnalysis(scope, startDate, endDate, result) {
    const map = getRawDietAnalyses();
    map[`${scope}__${endDate}`] = {
      scope, startDate, endDate, result, updatedAt: new Date().toISOString()
    };
    saveRawDietAnalyses(map);
  }

  function deleteDietAnalysis(key) {
    const map = getRawDietAnalyses();
    if (!map[key]) return;
    map[key] = { deleted: true, updatedAt: new Date().toISOString() };
    saveRawDietAnalyses(map);
  }

  function mergeDietAnalyses(mapA, mapB) {
    const merged = { ...mapA };
    Object.entries(mapB).forEach(([key, r]) => {
      const prev = merged[key];
      if (!prev || (r.updatedAt || '') > (prev.updatedAt || '')) merged[key] = r;
    });
    return merged;
  }

  // ── Cache sekcji statycznych analizy (interakcje, sumy dawek) — lokalny, odtwarzalny ──

  function getSupplementsFingerprint() {
    return getSupplements()
      .filter((s) => s.active !== false)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => `${s.id}:${s.updatedAt || ''}`)
      .join('|');
  }

  function getSuppStaticCache() {
    const raw = localStorage.getItem(SUPP_STATIC_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    return cache.fingerprint === getSupplementsFingerprint() ? cache : null;
  }

  function saveSuppStaticCache(interactions, doseTotals) {
    localStorage.setItem(SUPP_STATIC_CACHE_KEY, JSON.stringify({
      fingerprint: getSupplementsFingerprint(),
      interactions: interactions || [],
      dose_totals: doseTotals || [],
      updatedAt: new Date().toISOString()
    }));
  }

  function exportData() {
    const entries = {};
    getAllDates().forEach((date) => {
      entries[date] = getRawEntries(date);
    });
    return {
      exportedAt: new Date().toISOString(),
      settings: getSettings(),
      entries,
      weights: getWeights(),
      favoriteProducts: getRawFavoriteProducts(),
      recipes: getRawRecipes(),
      analysisGoals: getRawGoals(),
      dailyAnalyses: getRawDailyAnalyses(),
      supplements: getRawSupplements(),
      supplementLog: getRawSupplementLog(),
      supplementAnalyses: getRawSupplementAnalyses(),
      dietAnalyses: getRawDietAnalyses(),
      adhocQuickItems: getRawAdhocQuickItems()
    };
  }

  function importData(data, mode) {
    if (mode === 'replace') clearAllData();
    if (data.settings) saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    if (data.favoriteProducts) {
      saveFavoriteProducts(
        mode === 'replace'
          ? data.favoriteProducts
          : mergeFavoriteProducts(getRawFavoriteProducts(), data.favoriteProducts)
      );
    }
    if (data.entries) {
      Object.entries(data.entries).forEach(([date, importedEntries]) => {
        if (mode === 'replace') {
          saveEntries(date, importedEntries);
          return;
        }
        saveEntries(date, mergeEntryLists(getRawEntries(date), importedEntries));
      });
    }
    if (data.weights) {
      saveWeights(mode === 'replace' ? data.weights : mergeWeights(getWeights(), data.weights));
    }
    if (data.recipes) {
      saveRecipes(mode === 'replace' ? data.recipes : mergeRecipes(getRawRecipes(), data.recipes));
    }
    if (data.analysisGoals) {
      saveGoals(mode === 'replace' ? data.analysisGoals : mergeGoals(getRawGoals(), data.analysisGoals));
    }
    if (data.dailyAnalyses) {
      saveRawDailyAnalyses(
        mode === 'replace' ? data.dailyAnalyses : mergeDailyAnalyses(getRawDailyAnalyses(), data.dailyAnalyses)
      );
    }
    if (data.supplements) {
      saveSupplements(
        mode === 'replace' ? data.supplements : mergeSupplements(getRawSupplements(), data.supplements)
      );
    }
    if (data.supplementLog) {
      saveRawSupplementLog(
        mode === 'replace' ? data.supplementLog : mergeSupplementLog(getRawSupplementLog(), data.supplementLog)
      );
    }
    if (data.supplementAnalyses) {
      saveRawSupplementAnalyses(mode === 'replace'
        ? data.supplementAnalyses
        : mergeSupplementAnalyses(getRawSupplementAnalyses(), data.supplementAnalyses));
    }
    if (data.dietAnalyses) {
      saveRawDietAnalyses(mode === 'replace'
        ? data.dietAnalyses
        : mergeDietAnalyses(getRawDietAnalyses(), data.dietAnalyses));
    }
    if (data.adhocQuickItems) {
      saveAdhocQuickItems(mode === 'replace'
        ? data.adhocQuickItems
        : mergeAdhocQuickItems(getRawAdhocQuickItems(), data.adhocQuickItems));
    }
  }

  function clearAllData() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key === SETTINGS_KEY ||
        key === WEIGHTS_KEY ||
        key === FAVORITES_KEY ||
        key === RECIPES_KEY ||
        key === GOALS_KEY ||
        key === DAILY_ANALYSES_KEY ||
        key === SUPPLEMENTS_KEY ||
        key === SUPPLEMENT_LOG_KEY ||
        key === SUPPLEMENT_ANALYSES_KEY ||
        key === DIET_ANALYSES_KEY ||
        key === SUPP_STATIC_CACHE_KEY ||
        key === ADHOC_QUICK_KEY ||
        key.startsWith(ENTRY_PREFIX)
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }

  return {
    getSettings,
    saveSettings,
    getTheme,
    saveTheme,
    getHistoryMetric,
    saveHistoryMetric,
    getEntries,
    getRawEntries,
    saveEntries,
    mergeEntryLists,
    getWeights,
    saveWeights,
    getWeight,
    getWeightFull,
    setWeight,
    getLatestWeight,
    getLatestBodyComp,
    getWeightHistory,
    mergeWeights,
    getFrequentProducts,
    getFavoriteProducts,
    getRawFavoriteProducts,
    saveFavoriteProducts,
    isFavoriteProduct,
    addFavoriteProduct,
    removeFavoriteProduct,
    toggleFavoriteProduct,
    mergeFavoriteProducts,
    addEntry,
    updateEntry,
    deleteEntry,
    getDailySummary,
    getAllDatesWithEntries,
    getAllDates,
    getRecipes,
    getRawRecipes,
    saveRecipes,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    getRecipeById,
    mergeRecipes,
    getSeenSharedRecipeIds,
    addSeenSharedRecipeId,
    getSeenSharedSupplementIds,
    addSeenSharedSupplementId,
    getGoals,
    getRawGoals,
    saveGoals,
    addGoal,
    updateGoal,
    deleteGoal,
    mergeGoals,
    getDailyAnalyses,
    getRawDailyAnalyses,
    saveRawDailyAnalyses,
    saveDailyAnalysis,
    deleteDailyAnalysis,
    mergeDailyAnalyses,
    getSupplements,
    getRawSupplements,
    saveSupplements,
    addSupplement,
    updateSupplement,
    deleteSupplement,
    mergeSupplements,
    isSupplementDueOn,
    getRemainingStockMap,
    getStockCoverage,
    getRawSupplementLog,
    saveRawSupplementLog,
    getSupplementLogForDate,
    isSupplementTaken,
    getSupplementTakenCount,
    getSupplementDoseTimes,
    toggleSupplementTaken,
    incrementSupplementDose,
    updateSupplementDoseTime,
    removeSupplementDose,
    addAdhocSupplementLog,
    updateSupplementLogEntryTime,
    extractDoseTimes: getSupplementTimes,
    getAdhocQuickItems,
    getRawAdhocQuickItems,
    saveAdhocQuickItems,
    addAdhocQuickItem,
    removeAdhocQuickItem,
    mergeAdhocQuickItems,
    deleteSupplementLogEntry,
    mergeSupplementLog,
    getRawSupplementAnalyses,
    saveRawSupplementAnalyses,
    getSupplementAnalyses,
    saveSupplementAnalysis,
    deleteSupplementAnalysis,
    mergeSupplementAnalyses,
    getRawDietAnalyses,
    saveRawDietAnalyses,
    getDietAnalyses,
    saveDietAnalysis,
    deleteDietAnalysis,
    mergeDietAnalyses,
    getSupplementsFingerprint,
    getSuppStaticCache,
    saveSuppStaticCache,
    getUniqueProducts,
    exportData,
    importData,
    clearAllData
  };
})();
