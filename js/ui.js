const UI = (() => {
  let currentDate = toDateStr(new Date());
  let editingEntryId = null;
  let pendingSource = 'manual';

  function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDateLabel(dateStr) {
    const today = toDateStr(new Date());
    const yesterday = toDateStr(new Date(Date.now() - 86400000));
    const tomorrow = toDateStr(new Date(Date.now() + 86400000));
    if (dateStr === today) return 'Dziś';
    if (dateStr === yesterday) return 'Wczoraj';
    if (dateStr === tomorrow) return 'Jutro';
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.${y}`;
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function switchView(viewName) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === viewName);
    });
    if (viewName === 'historia') renderHistory();
    if (viewName === 'ustawienia') renderSettings();
  }

  function changeDay(delta) {
    const d = new Date(currentDate + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    currentDate = toDateStr(d);
    renderDiary();
  }

  function goToDate(dateStr) {
    currentDate = dateStr;
    switchView('dziennik');
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === 'dziennik');
    });
    renderDiary();
  }

  function pct(value, goal) {
    if (!goal || goal <= 0) return 0;
    return Math.min(100, Math.round((value / goal) * 100));
  }

  function renderDiary() {
    document.getElementById('currentDateLabel').textContent = formatDateLabel(currentDate);

    const settings = Storage.getSettings();
    const summary = Storage.getDailySummary(currentDate);

    document.getElementById('kcalValue').textContent = Math.round(summary.kcal);
    document.getElementById('kcalGoalLabel').textContent = `/ ${settings.kcalGoal} kcal`;
    const kcalPct = pct(summary.kcal, settings.kcalGoal);
    document.getElementById('kcalBarFill').style.width = kcalPct + '%';
    document.getElementById('kcalBar').classList.toggle('over', summary.kcal > settings.kcalGoal);

    document.getElementById('proteinValue').textContent = `${Math.round(summary.protein)} / ${settings.proteinGoal} g`;
    document.getElementById('proteinBarFill').style.width = pct(summary.protein, settings.proteinGoal) + '%';

    document.getElementById('carbsValue').textContent = `${Math.round(summary.carbs)} / ${settings.carbsGoal} g`;
    document.getElementById('carbsBarFill').style.width = pct(summary.carbs, settings.carbsGoal) + '%';

    document.getElementById('fatValue').textContent = `${Math.round(summary.fat)} / ${settings.fatGoal} g`;
    document.getElementById('fatBarFill').style.width = pct(summary.fat, settings.fatGoal) + '%';

    const entries = Storage.getEntries(currentDate).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const list = document.getElementById('entriesList');
    list.innerHTML = '';

    if (entries.length === 0) {
      list.innerHTML = '<div class="empty-state">Brak wpisów. Dodaj pierwszy posiłek przyciskiem +</div>';
      return;
    }

    entries.forEach((e) => {
      const card = document.createElement('div');
      card.className = 'entry-card';
      const gramsStr = e.grams ? `${e.grams} g · ` : '';
      const initial = (e.name || '?').trim().charAt(0).toUpperCase();
      card.innerHTML = `
        <div class="entry-avatar">${initial}</div>
        <div class="entry-info">
          <div class="name">${escapeHtml(e.name)}</div>
          <div class="meta">${gramsStr}${e.time || ''} · B:${Math.round(e.protein || 0)} W:${Math.round(e.carbs || 0)} T:${Math.round(e.fat || 0)}</div>
        </div>
        <div class="entry-kcal">${Math.round(e.kcal)} kcal</div>
        <button class="entry-delete" data-id="${e.id}" aria-label="Usuń">×</button>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('.entry-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        Storage.deleteEntry(currentDate, btn.dataset.id);
        pushDayToCloud(currentDate);
        renderDiary();
        showToast('Usunięto wpis');
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function renderHistory() {
    const dates = Storage.getAllDatesWithEntries();
    const container = document.getElementById('historyList');
    container.innerHTML = '';

    if (dates.length === 0) {
      container.innerHTML = '<div class="empty-state">Brak historii wpisów</div>';
      return;
    }

    dates.forEach((date) => {
      const summary = Storage.getDailySummary(date);
      const settings = Storage.getSettings();
      const over = summary.kcal > settings.kcalGoal;
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <div>
          <div class="date">${formatDateLabel(date)}</div>
          <div class="hint" style="margin-top:2px;">cel ${settings.kcalGoal} kcal</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="history-dot" style="background:${over ? 'var(--danger)' : 'var(--accent)'};"></div>
          <div class="kcal">${Math.round(summary.kcal)} kcal</div>
        </div>
      `;
      item.addEventListener('click', () => goToDate(date));
      container.appendChild(item);
    });
  }

  function renderSettings() {
    const s = Storage.getSettings();
    document.getElementById('settingKcalGoal').value = s.kcalGoal;
    document.getElementById('settingProteinGoal').value = s.proteinGoal;
    document.getElementById('settingCarbsGoal').value = s.carbsGoal;
    document.getElementById('settingFatGoal').value = s.fatGoal;
    document.getElementById('settingApiKey').value = s.geminiApiKey;
    document.getElementById('firebaseConfigInput').value = s.firebaseConfig || '';
    document.getElementById('settingsToast').textContent = '';
    renderFirebaseAuthBlock();
  }

  function renderFirebaseAuthBlock() {
    const authBlock = document.getElementById('firebaseAuthBlock');
    const statusEl = document.getElementById('firebaseStatus');
    const hasConfig = !!Storage.getSettings().firebaseConfig;

    if (!hasConfig) {
      authBlock.innerHTML = '';
      statusEl.textContent = '';
      return;
    }

    if (!window.FirebaseSync) {
      authBlock.innerHTML = '';
      statusEl.textContent = 'Moduł Firebase nie jest jeszcze załadowany.';
      return;
    }

    if (FirebaseSync.isSignedIn()) {
      const user = FirebaseSync.getCurrentUser();
      authBlock.innerHTML = `
        <div class="hint" style="margin-bottom:10px;">Zalogowano jako <strong>${escapeHtml(user.email || user.displayName || '')}</strong></div>
        <button class="btn btn-secondary" id="firebaseSignOutBtn">Wyloguj</button>
      `;
      document.getElementById('firebaseSignOutBtn').addEventListener('click', async () => {
        await FirebaseSync.signOutUser();
        renderFirebaseAuthBlock();
        showToast('Wylogowano');
      });
    } else {
      authBlock.innerHTML = '<button class="btn btn-primary" id="firebaseSignInBtn">Zaloguj przez Google</button>';
      document.getElementById('firebaseSignInBtn').addEventListener('click', async () => {
        statusEl.textContent = 'Logowanie...';
        try {
          await FirebaseSync.signIn();
        } catch (e) {
          statusEl.textContent = 'Nie udało się zalogować. Spróbuj ponownie.';
        }
      });
    }
  }

  async function saveFirebaseConfigFromForm() {
    const raw = document.getElementById('firebaseConfigInput').value;
    const statusEl = document.getElementById('firebaseStatus');

    if (!raw.trim()) {
      const settings = { ...Storage.getSettings(), firebaseConfig: '' };
      Storage.saveSettings(settings);
      renderFirebaseAuthBlock();
      statusEl.textContent = '';
      return;
    }

    try {
      const parsed = FirebaseSync.parseFirebaseConfig(raw);
      statusEl.textContent = 'Łączenie z Firebase...';
      await FirebaseSync.init(parsed);
      const settings = { ...Storage.getSettings(), firebaseConfig: raw };
      Storage.saveSettings(settings);
      FirebaseSync.onAuthChange(() => {
        renderFirebaseAuthBlock();
        if (FirebaseSync.isSignedIn()) syncWithCloud();
      });
      statusEl.textContent = 'Połączono ✓';
      renderFirebaseAuthBlock();
    } catch (e) {
      statusEl.textContent = 'Nieprawidłowa konfiguracja Firebase. Sprawdź wklejony obiekt.';
    }
  }

  async function syncWithCloud() {
    const statusEl = document.getElementById('firebaseStatus');
    statusEl.textContent = 'Synchronizowanie danych...';
    try {
      const remoteDays = await FirebaseSync.pullAllDays();
      const localDates = new Set([...Storage.getAllDates(), ...Object.keys(remoteDays)]);

      for (const date of localDates) {
        const local = Storage.getEntries(date);
        const remote = remoteDays[date] || [];
        const remoteIds = new Set(remote.map((e) => e.id));
        const merged = [...remote, ...local.filter((e) => !remoteIds.has(e.id))];
        Storage.saveEntries(date, merged);
        await FirebaseSync.pushDay(date, merged);
      }

      const remoteSettings = await FirebaseSync.pullSettings();
      const localSettings = Storage.getSettings();
      if (remoteSettings) {
        Storage.saveSettings({ ...localSettings, ...remoteSettings, firebaseConfig: localSettings.firebaseConfig });
      } else {
        await FirebaseSync.pushSettings(localSettings);
      }

      renderDiary();
      statusEl.textContent = 'Zsynchronizowano ✓';
    } catch (e) {
      statusEl.textContent = 'Błąd synchronizacji danych.';
    }
  }

  function saveSettingsFromForm() {
    const settings = {
      ...Storage.getSettings(),
      kcalGoal: Number(document.getElementById('settingKcalGoal').value) || 0,
      proteinGoal: Number(document.getElementById('settingProteinGoal').value) || 0,
      carbsGoal: Number(document.getElementById('settingCarbsGoal').value) || 0,
      fatGoal: Number(document.getElementById('settingFatGoal').value) || 0,
      geminiApiKey: document.getElementById('settingApiKey').value.trim()
    };
    Storage.saveSettings(settings);
    pushSettingsToCloud(settings);
    document.getElementById('settingsToast').textContent = 'Zapisano ✓';
    renderDiary();
  }

  function pushSettingsToCloud(settings) {
    if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
      FirebaseSync.pushSettings(settings).catch(() => showToast('Błąd synchronizacji ustawień'));
    }
  }

  function pushDayToCloud(date) {
    if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
      FirebaseSync.pushDay(date, Storage.getEntries(date)).catch(() => showToast('Błąd synchronizacji z chmurą'));
    }
  }

  function openEntryModal() {
    editingEntryId = null;
    pendingSource = 'manual';
    document.getElementById('entryModalTitle').textContent = 'Dodaj posiłek';
    ['entryName', 'entryGrams', 'entryKcal', 'entryProtein', 'entryCarbs', 'entryFat'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    document.getElementById('entryFormError').textContent = '';
    document.getElementById('scanError').textContent = '';
    document.getElementById('scanStatus').textContent = '';
    document.getElementById('voiceError').textContent = '';
    document.getElementById('voiceStatus').textContent = '';
    document.getElementById('entryModalOverlay').classList.add('active');
  }

  function closeEntryModal() {
    document.getElementById('entryModalOverlay').classList.remove('active');
  }

  function saveEntryFromForm() {
    const name = document.getElementById('entryName').value.trim();
    const kcal = Number(document.getElementById('entryKcal').value);
    const errorEl = document.getElementById('entryFormError');

    if (!name) {
      errorEl.textContent = 'Podaj nazwę produktu/posiłku';
      return;
    }
    if (!kcal || kcal <= 0) {
      errorEl.textContent = 'Podaj poprawną wartość kalorii';
      return;
    }

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    Storage.addEntry(currentDate, {
      name,
      grams: Number(document.getElementById('entryGrams').value) || null,
      kcal,
      protein: Number(document.getElementById('entryProtein').value) || 0,
      carbs: Number(document.getElementById('entryCarbs').value) || 0,
      fat: Number(document.getElementById('entryFat').value) || 0,
      time,
      source: pendingSource
    });

    pushDayToCloud(currentDate);
    closeEntryModal();
    renderDiary();
    showToast('Dodano posiłek');
  }

  async function handleLabelScan(file) {
    pendingSource = 'ocr';
    const settings = Storage.getSettings();
    const statusEl = document.getElementById('scanStatus');
    const errorEl = document.getElementById('scanError');
    errorEl.textContent = '';
    statusEl.textContent = 'Analizuję etykietę...';

    try {
      const result = await Ocr.analyzeLabel(file, settings.geminiApiKey);
      statusEl.textContent = '';

      if (result.name) document.getElementById('entryName').value = result.name;

      const grams = Number(document.getElementById('entryGrams').value) || 100;
      if (!document.getElementById('entryGrams').value) {
        document.getElementById('entryGrams').value = 100;
      }
      const factor = grams / 100;

      if (result.per100g) {
        document.getElementById('entryKcal').value = Math.round(result.per100g.kcal * factor);
        document.getElementById('entryProtein').value = Math.round(result.per100g.protein * factor * 10) / 10;
        document.getElementById('entryCarbs').value = Math.round(result.per100g.carbs * factor * 10) / 10;
        document.getElementById('entryFat').value = Math.round(result.per100g.fat * factor * 10) / 10;
      }
      showToast('Rozpoznano etykietę — sprawdź wartości');
    } catch (err) {
      statusEl.textContent = '';
      if (err.message === 'NO_API_KEY') {
        errorEl.innerHTML = 'Brak klucza Gemini API. Dodaj go w <button type="button" class="link-btn" id="goToSettingsLink">Ustawieniach</button>.';
        document.getElementById('goToSettingsLink')?.addEventListener('click', () => {
          closeEntryModal();
          switchView('ustawienia');
        });
      } else if (err.message === 'NETWORK_ERROR') {
        errorEl.textContent = 'Błąd sieci — sprawdź połączenie z internetem.';
      } else if (err.message === 'NOT_RECOGNIZED') {
        errorEl.textContent = 'Nie rozpoznano etykiety. Wpisz wartości ręcznie.';
      } else {
        errorEl.textContent = 'Nie udało się przeanalizować zdjęcia. Wpisz wartości ręcznie.';
      }
    }
  }

  async function handleVoiceEntry() {
    const statusEl = document.getElementById('voiceStatus');
    const errorEl = document.getElementById('voiceError');
    errorEl.textContent = '';

    if (!Voice.isSupported()) {
      errorEl.textContent = 'Rozpoznawanie mowy nie jest obsługiwane w tej przeglądarce.';
      return;
    }

    statusEl.textContent = 'Słucham... powiedz co zjadłeś';

    let transcript;
    try {
      transcript = await Voice.listenOnce();
    } catch (err) {
      statusEl.textContent = '';
      if (err.message === 'PERMISSION_DENIED') {
        errorEl.textContent = 'Brak dostępu do mikrofonu. Zezwól na dostęp w ustawieniach przeglądarki.';
      } else if (err.message === 'NO_SPEECH') {
        errorEl.textContent = 'Nie wykryto mowy. Spróbuj ponownie.';
      } else {
        errorEl.textContent = 'Rozpoznawanie mowy nie jest obsługiwane w tej przeglądarce.';
      }
      return;
    }

    pendingSource = 'voice';
    statusEl.textContent = `Rozpoznano: „${transcript}” — analizuję...`;
    const settings = Storage.getSettings();

    try {
      const result = await Ocr.analyzeVoiceEntry(transcript, settings.geminiApiKey);
      statusEl.textContent = '';

      if (result.name) document.getElementById('entryName').value = result.name;
      if (result.grams) document.getElementById('entryGrams').value = result.grams;
      if (typeof result.kcal === 'number') document.getElementById('entryKcal').value = Math.round(result.kcal);
      if (typeof result.protein === 'number') document.getElementById('entryProtein').value = Math.round(result.protein * 10) / 10;
      if (typeof result.carbs === 'number') document.getElementById('entryCarbs').value = Math.round(result.carbs * 10) / 10;
      if (typeof result.fat === 'number') document.getElementById('entryFat').value = Math.round(result.fat * 10) / 10;

      showToast('Rozpoznano posiłek — sprawdź wartości');
    } catch (err) {
      statusEl.textContent = '';
      if (err.message === 'NO_API_KEY') {
        errorEl.innerHTML = 'Brak klucza Gemini API. Dodaj go w <button type="button" class="link-btn" id="goToSettingsLinkVoice">Ustawieniach</button>.';
        document.getElementById('goToSettingsLinkVoice')?.addEventListener('click', () => {
          closeEntryModal();
          switchView('ustawienia');
        });
      } else if (err.message === 'NETWORK_ERROR') {
        errorEl.textContent = 'Błąd sieci — sprawdź połączenie z internetem.';
      } else if (err.message === 'NOT_RECOGNIZED') {
        errorEl.textContent = 'Nie rozpoznano jedzenia w wypowiedzi. Wpisz wartości ręcznie.';
      } else {
        errorEl.textContent = 'Nie udało się przeanalizować wypowiedzi. Wpisz wartości ręcznie.';
      }
    }
  }

  function exportDataToFile() {
    const data = Storage.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = toDateStr(new Date());
    a.href = url;
    a.download = `licznik-kalorii-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Wyeksportowano dane');
  }

  function importDataFromFile(file) {
    const statusEl = document.getElementById('backupStatus');
    const reader = new FileReader();
    reader.onerror = () => {
      statusEl.textContent = 'Nie udało się odczytać pliku.';
    };
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        statusEl.textContent = 'Plik nie jest poprawnym JSON-em.';
        return;
      }
      if (!data || typeof data !== 'object' || (!data.entries && !data.settings)) {
        statusEl.textContent = 'Plik nie ma oczekiwanej struktury kopii zapasowej.';
        return;
      }
      if (!confirm('Zaimportować dane z pliku? Zostaną scalone z obecnymi wpisami (bez usuwania niczego).')) {
        return;
      }
      Storage.importData(data, 'merge');
      renderDiary();
      renderSettings();
      statusEl.textContent = 'Zaimportowano dane ✓';
      showToast('Dane zaimportowane');
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (confirm('Czy na pewno chcesz usunąć wszystkie dane? Tej operacji nie można cofnąć.')) {
      Storage.clearAllData();
      renderDiary();
      renderSettings();
      showToast('Dane wyczyszczone');
    }
  }

  return {
    switchView,
    changeDay,
    renderDiary,
    renderHistory,
    renderSettings,
    saveSettingsFromForm,
    openEntryModal,
    closeEntryModal,
    saveEntryFromForm,
    handleLabelScan,
    handleVoiceEntry,
    clearAllData,
    exportDataToFile,
    importDataFromFile,
    saveFirebaseConfigFromForm,
    syncWithCloud,
    renderFirebaseAuthBlock,
    getCurrentDate: () => currentDate
  };
})();
