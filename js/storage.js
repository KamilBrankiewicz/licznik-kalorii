const Storage = (() => {
  const SETTINGS_KEY = 'settings';
  const ENTRY_PREFIX = 'entries_';

  const DEFAULT_SETTINGS = {
    kcalGoal: 2000,
    proteinGoal: 150,
    carbsGoal: 200,
    fatGoal: 70,
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
        fat: sum.fat + (Number(e.fat) || 0)
      }),
      { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    );
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
      entries
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
  }

  function clearAllData() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === SETTINGS_KEY || key.startsWith(ENTRY_PREFIX)) {
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
