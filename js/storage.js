const Storage = (() => {
  const SETTINGS_KEY = 'settings';
  const ENTRY_PREFIX = 'entries_';
  const WEIGHTS_KEY = 'weights';

  const DEFAULT_SETTINGS = {
    kcalGoal: 2000,
    proteinGoal: 150,
    carbsGoal: 200,
    fatGoal: 70,
    fiberGoal: 30,
    geminiApiKey: '',
    firebaseConfig: ''
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

  function exportData() {
    const entries = {};
    getAllDates().forEach((date) => {
      entries[date] = getRawEntries(date);
    });
    return {
      exportedAt: new Date().toISOString(),
      settings: getSettings(),
      entries,
      weights: getWeights()
    };
  }

  function importData(data, mode) {
    if (mode === 'replace') clearAllData();
    if (data.settings) saveSettings({ ...DEFAULT_SETTINGS, ...data.settings });
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
  }

  function clearAllData() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === SETTINGS_KEY || key === WEIGHTS_KEY || key.startsWith(ENTRY_PREFIX)) {
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
    addEntry,
    updateEntry,
    deleteEntry,
    getDailySummary,
    getAllDatesWithEntries,
    getAllDates,
    exportData,
    importData,
    clearAllData
  };
})();
