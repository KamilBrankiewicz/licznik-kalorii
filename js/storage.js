const Storage = (() => {
  const SETTINGS_KEY = 'settings';
  const ENTRY_PREFIX = 'entries_';
  const WEIGHTS_KEY = 'weights';
  const FAVORITES_KEY = 'favoriteProducts';
  const RECIPES_KEY = 'recipes';
  const GOALS_KEY = 'analysisGoals';
  const DAILY_ANALYSES_KEY = 'dailyAnalyses';

  const DEFAULT_SETTINGS = {
    kcalGoal: 2000,
    proteinGoal: 150,
    carbsGoal: 200,
    fatGoal: 70,
    fiberGoal: 30,
    geminiApiKey: '',
    firebaseConfig: '',
    healthProfile: ''
  };

  function getSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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

  function setWeight(date, kg) {
    const map = getWeights();
    if (kg == null) {
      if (!map[date]) return;
      map[date] = { deleted: true, updatedAt: new Date().toISOString() };
    } else {
      map[date] = { kg, updatedAt: new Date().toISOString() };
    }
    saveWeights(map);
  }

  // Ostatni pomiar z dnia <= date — waga "obowiązuje" do następnego pomiaru
  function getLatestWeight(date) {
    let latest = null;
    Object.entries(getWeights()).forEach(([d, w]) => {
      if (w.deleted || d > date) return;
      if (!latest || d > latest.date) latest = { date: d, kg: w.kg };
    });
    return latest;
  }

  function getWeightHistory() {
    return Object.entries(getWeights())
      .filter(([, w]) => !w.deleted)
      .map(([date, w]) => ({ date, kg: w.kg }))
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

  function getFrequentProducts(limit = 8) {
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
      .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate))
      .slice(0, limit)
      .map((i) => i.entry);
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
      dailyAnalyses: getRawDailyAnalyses()
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
    getEntries,
    getRawEntries,
    saveEntries,
    mergeEntryLists,
    getWeights,
    saveWeights,
    getWeight,
    setWeight,
    getLatestWeight,
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
    exportData,
    importData,
    clearAllData
  };
})();
