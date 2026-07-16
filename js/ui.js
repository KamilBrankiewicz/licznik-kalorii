const UI = (() => {
  let currentDate = toDateStr(new Date());
  let editingEntryId = null;
  let pendingSource = 'manual';
  let pendingPer100g = null;
  let toastTimeout = null;
  let authListenerRegistered = false;

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
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2200);
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
        <div class="entry-avatar">${escapeHtml(initial)}</div>
        <div class="entry-info">
          <div class="name">${escapeHtml(e.name)}</div>
          <div class="meta">${gramsStr}${e.time || ''} · B:${Math.round(e.protein || 0)} W:${Math.round(e.carbs || 0)} T:${Math.round(e.fat || 0)}</div>
        </div>
        <div class="entry-kcal">${Math.round(e.kcal)} kcal</div>
        <button class="entry-delete" data-id="${e.id}" aria-label="Usuń">×</button>
      `;
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('.entry-delete')) return;
        openEntryModal(e.id);
      });
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

  function renderWeeklyStats() {
    const container = document.getElementById('weeklyStats');
    const settings = Storage.getSettings();
    const dayNames = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
    const todayStr = toDateStr(new Date());

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = toDateStr(d);
      days.push({ date, label: dayNames[d.getDay()], summary: Storage.getDailySummary(date) });
    }

    const daysWithEntries = days.filter((d) => d.summary.kcal > 0);
    if (daysWithEntries.length === 0) {
      container.innerHTML = '';
      return;
    }

    const maxKcal = Math.max(settings.kcalGoal, ...days.map((d) => d.summary.kcal), 1);
    const goalPct = Math.round((settings.kcalGoal / maxKcal) * 100);
    const avg = (key) =>
      Math.round(daysWithEntries.reduce((s, d) => s + d.summary[key], 0) / daysWithEntries.length);
    const inGoal = daysWithEntries.filter((d) => d.summary.kcal <= settings.kcalGoal).length;

    container.innerHTML = `
      <div class="summary-card">
        <h3 class="section-title">Ostatnie 7 dni</h3>
        <div class="week-bars">
          <div class="goal-line" style="bottom:${goalPct}%"></div>
          ${days
            .map(
              (d) => `<div class="week-bar ${d.summary.kcal > settings.kcalGoal ? 'over' : ''}" data-date="${d.date}" style="height:${Math.round((d.summary.kcal / maxKcal) * 100)}%"></div>`
            )
            .join('')}
        </div>
        <div class="week-labels">
          ${days
            .map(
              (d) => `<div class="week-label" data-date="${d.date}">
                <div class="week-kcal">${d.summary.kcal ? Math.round(d.summary.kcal) : ''}</div>
                <div class="week-day ${d.date === todayStr ? 'today' : ''}">${d.label}</div>
              </div>`
            )
            .join('')}
        </div>
        <div class="week-stats">
          <div class="week-stat"><div class="value">${avg('kcal')}</div><div class="label">śr. kcal</div></div>
          <div class="week-stat"><div class="value">${avg('protein')} g</div><div class="label">śr. białko</div></div>
          <div class="week-stat"><div class="value">${avg('carbs')} g</div><div class="label">śr. węgle</div></div>
          <div class="week-stat"><div class="value">${avg('fat')} g</div><div class="label">śr. tłuszcz</div></div>
          <div class="week-stat"><div class="value">${inGoal}/${daysWithEntries.length}</div><div class="label">dni w celu</div></div>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-date]').forEach((el) => {
      el.addEventListener('click', () => goToDate(el.dataset.date));
    });
  }

  function renderHistory() {
    renderWeeklyStats();
    const dates = Storage.getAllDatesWithEntries();
    const container = document.getElementById('historyList');
    container.innerHTML = '';

    if (dates.length === 0) {
      container.innerHTML = '<div class="empty-state">Brak historii wpisów</div>';
      return;
    }

    const settings = Storage.getSettings();
    dates.forEach((date) => {
      const summary = Storage.getDailySummary(date);
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

  function ensureAuthListener() {
    if (authListenerRegistered || !window.FirebaseSync) return;
    authListenerRegistered = true;
    FirebaseSync.onAuthChange(() => {
      renderFirebaseAuthBlock();
      if (FirebaseSync.isSignedIn()) syncWithCloud();
    });
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
      ensureAuthListener();
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
        const merged = Storage.mergeEntryLists(remoteDays[date] || [], Storage.getRawEntries(date));
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
      FirebaseSync.pushDay(date, Storage.getRawEntries(date)).catch(() => showToast('Błąd synchronizacji z chmurą'));
    }
  }

  function nowTimeStr() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  function fillFormFromProduct(p) {
    document.getElementById('entryName').value = p.name || '';
    document.getElementById('entryGrams').value = p.grams || '';
    document.getElementById('entryKcal').value = p.kcal || '';
    document.getElementById('entryProtein').value = p.protein || '';
    document.getElementById('entryCarbs').value = p.carbs || '';
    document.getElementById('entryFat').value = p.fat || '';
    pendingPer100g = p.per100g || null;
  }

  function renderRecentProducts(show) {
    const container = document.getElementById('recentProducts');
    const datalist = document.getElementById('productSuggestions');
    container.innerHTML = '';
    datalist.innerHTML = '';
    if (!show) return;

    const products = Storage.getFrequentProducts(8);
    products.forEach((p) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = p.name;
      chip.addEventListener('click', () => {
        fillFormFromProduct(p);
        pendingSource = p.source || 'manual';
      });
      container.appendChild(chip);

      const opt = document.createElement('option');
      opt.value = p.name;
      datalist.appendChild(opt);
    });
  }

  // Po wybraniu podpowiedzi z listy nazw uzupełnia makra, jeśli pola są puste
  function autofillFromName() {
    if (document.getElementById('entryKcal').value) return;
    const name = document.getElementById('entryName').value.trim().toLowerCase();
    if (!name) return;
    const match = Storage.getFrequentProducts(50).find((p) => (p.name || '').trim().toLowerCase() === name);
    if (match) fillFormFromProduct(match);
  }

  function recalcFromPer100g() {
    if (!pendingPer100g) return;
    const grams = Number(document.getElementById('entryGrams').value);
    if (!grams || grams <= 0) return;
    const factor = grams / 100;
    document.getElementById('entryKcal').value = Math.round((pendingPer100g.kcal || 0) * factor);
    document.getElementById('entryProtein').value = Math.round((pendingPer100g.protein || 0) * factor * 10) / 10;
    document.getElementById('entryCarbs').value = Math.round((pendingPer100g.carbs || 0) * factor * 10) / 10;
    document.getElementById('entryFat').value = Math.round((pendingPer100g.fat || 0) * factor * 10) / 10;
  }

  // Ręczna zmiana kcal/makr oznacza, że wartości z etykiety już nie obowiązują
  function clearPendingPer100g() {
    pendingPer100g = null;
  }

  function openEntryModal(entryId) {
    document.getElementById('entryFormError').textContent = '';
    document.getElementById('scanError').textContent = '';
    document.getElementById('scanStatus').textContent = '';
    document.getElementById('voiceError').textContent = '';
    document.getElementById('voiceStatus').textContent = '';

    const entry = entryId ? Storage.getEntries(currentDate).find((e) => e.id === entryId) : null;
    editingEntryId = entry ? entryId : null;

    document.getElementById('entryModalTitle').textContent = entry ? 'Edytuj posiłek' : 'Dodaj posiłek';
    document.getElementById('entryName').value = entry ? entry.name || '' : '';
    document.getElementById('entryGrams').value = entry ? entry.grams || '' : '';
    document.getElementById('entryKcal').value = entry ? entry.kcal || '' : '';
    document.getElementById('entryProtein').value = entry ? entry.protein || '' : '';
    document.getElementById('entryCarbs').value = entry ? entry.carbs || '' : '';
    document.getElementById('entryFat').value = entry ? entry.fat || '' : '';
    document.getElementById('entryTime').value = entry ? entry.time || nowTimeStr() : nowTimeStr();
    pendingSource = entry ? entry.source || 'manual' : 'manual';
    pendingPer100g = entry ? entry.per100g || null : null;
    renderRecentProducts(!entry);

    document.getElementById('entryModalOverlay').classList.add('active');
  }

  function closeEntryModal() {
    document.getElementById('entryModalOverlay').classList.remove('active');
  }

  function saveEntryFromForm() {
    const name = document.getElementById('entryName').value.trim();
    const kcalRaw = document.getElementById('entryKcal').value.trim();
    const kcal = Number(kcalRaw);
    const errorEl = document.getElementById('entryFormError');

    if (!name) {
      errorEl.textContent = 'Podaj nazwę produktu/posiłku';
      return;
    }
    if (kcalRaw === '' || !Number.isFinite(kcal) || kcal < 0) {
      errorEl.textContent = 'Podaj poprawną wartość kalorii';
      return;
    }

    const entryData = {
      name,
      grams: Number(document.getElementById('entryGrams').value) || null,
      kcal,
      protein: Number(document.getElementById('entryProtein').value) || 0,
      carbs: Number(document.getElementById('entryCarbs').value) || 0,
      fat: Number(document.getElementById('entryFat').value) || 0,
      time: document.getElementById('entryTime').value || nowTimeStr(),
      source: pendingSource,
      per100g: pendingPer100g
    };

    if (editingEntryId) {
      Storage.updateEntry(currentDate, editingEntryId, entryData);
    } else {
      Storage.addEntry(currentDate, entryData);
    }

    pushDayToCloud(currentDate);
    closeEntryModal();
    renderDiary();
    showToast(editingEntryId ? 'Zapisano zmiany' : 'Dodano posiłek');
  }

  function showScanError(err, errorEl, messages) {
    if (err.message === 'NO_API_KEY') {
      errorEl.innerHTML = 'Brak klucza Gemini API. Dodaj go w <button type="button" class="link-btn go-settings">Ustawieniach</button>.';
      errorEl.querySelector('.go-settings').addEventListener('click', () => {
        closeEntryModal();
        switchView('ustawienia');
      });
    } else if (err.message === 'NETWORK_ERROR') {
      errorEl.textContent = 'Błąd sieci — sprawdź połączenie z internetem.';
    } else if (err.message === 'NOT_RECOGNIZED') {
      errorEl.textContent = messages.notRecognized;
    } else {
      errorEl.textContent = messages.failed;
    }
  }

  function fillFormFromAnalysis(result) {
    if (result.name) document.getElementById('entryName').value = result.name;
    if (result.grams) document.getElementById('entryGrams').value = result.grams;
    if (typeof result.kcal === 'number') document.getElementById('entryKcal').value = Math.round(result.kcal);
    if (typeof result.protein === 'number') document.getElementById('entryProtein').value = Math.round(result.protein * 10) / 10;
    if (typeof result.carbs === 'number') document.getElementById('entryCarbs').value = Math.round(result.carbs * 10) / 10;
    if (typeof result.fat === 'number') document.getElementById('entryFat').value = Math.round(result.fat * 10) / 10;
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

      if (!document.getElementById('entryGrams').value) {
        document.getElementById('entryGrams').value = 100;
      }

      if (result.per100g) {
        pendingPer100g = result.per100g;
        recalcFromPer100g();
      }
      showToast('Rozpoznano etykietę — sprawdź wartości');
    } catch (err) {
      statusEl.textContent = '';
      showScanError(err, errorEl, {
        notRecognized: 'Nie rozpoznano etykiety. Wpisz wartości ręcznie.',
        failed: 'Nie udało się przeanalizować zdjęcia. Wpisz wartości ręcznie.'
      });
    }
  }

  async function handleScreenshotScan(file) {
    pendingSource = 'screenshot';
    const settings = Storage.getSettings();
    const statusEl = document.getElementById('scanStatus');
    const errorEl = document.getElementById('scanError');
    errorEl.textContent = '';
    statusEl.textContent = 'Analizuję zrzut ekranu...';

    try {
      const result = await Ocr.analyzeScreenshot(file, settings.geminiApiKey);
      statusEl.textContent = '';
      fillFormFromAnalysis(result);
      showToast('Rozpoznano dane ze zrzutu ekranu — sprawdź wartości');
    } catch (err) {
      statusEl.textContent = '';
      showScanError(err, errorEl, {
        notRecognized: 'Nie rozpoznano danych na zrzucie ekranu. Wpisz wartości ręcznie.',
        failed: 'Nie udało się przeanalizować zrzutu ekranu. Wpisz wartości ręcznie.'
      });
    }
  }

  async function handleMealPhoto(file) {
    pendingSource = 'photo';
    const settings = Storage.getSettings();
    const statusEl = document.getElementById('scanStatus');
    const errorEl = document.getElementById('scanError');
    errorEl.textContent = '';
    statusEl.textContent = 'Analizuję zdjęcie posiłku...';

    try {
      const result = await Ocr.analyzeMealPhoto(file, settings.geminiApiKey);
      statusEl.textContent = '';
      fillFormFromAnalysis(result);
      showToast('Oszacowano wartości ze zdjęcia — sprawdź i popraw');
    } catch (err) {
      statusEl.textContent = '';
      showScanError(err, errorEl, {
        notRecognized: 'Nie rozpoznano jedzenia na zdjęciu. Wpisz wartości ręcznie.',
        failed: 'Nie udało się przeanalizować zdjęcia. Wpisz wartości ręcznie.'
      });
    }
  }

  function openBarcodeScanner() {
    const statusEl = document.getElementById('barcodeStatus');
    const video = document.getElementById('barcodeVideo');
    statusEl.textContent = '';
    document.getElementById('barcodeManualInput').value = '';
    document.getElementById('barcodeOverlay').classList.add('active');

    if (Barcode.isSupported()) {
      video.style.display = '';
      Barcode.startCamera(video)
        .then(() => Barcode.startDetection(video, onBarcodeDetected))
        .catch(() => {
          video.style.display = 'none';
          statusEl.textContent = 'Brak dostępu do aparatu. Wpisz kod ręcznie poniżej.';
        });
    } else {
      video.style.display = 'none';
      statusEl.textContent = 'Skanowanie aparatem nie jest obsługiwane w tej przeglądarce. Wpisz kod ręcznie.';
    }
  }

  function closeBarcodeScanner() {
    Barcode.stop();
    document.getElementById('barcodeOverlay').classList.remove('active');
  }

  function onBarcodeDetected(code) {
    if (navigator.vibrate) navigator.vibrate(80);
    lookupBarcode(code, true);
  }

  async function lookupBarcode(code, fromCamera) {
    const statusEl = document.getElementById('barcodeStatus');
    if (!code || !/^\d{6,14}$/.test(code.trim())) {
      statusEl.textContent = 'Kod kreskowy powinien składać się z 6–14 cyfr.';
      return;
    }

    Barcode.pauseDetection();
    statusEl.textContent = `Szukam produktu (${code.trim()})...`;

    try {
      const product = await Barcode.fetchProduct(code.trim());
      closeBarcodeScanner();
      pendingSource = 'barcode';
      if (product.name) document.getElementById('entryName').value = product.name;
      if (!document.getElementById('entryGrams').value) {
        document.getElementById('entryGrams').value = 100;
      }
      pendingPer100g = product.per100g;
      recalcFromPer100g();
      showToast('Znaleziono produkt — sprawdź wartości');
    } catch (err) {
      if (err.message === 'PRODUCT_NOT_FOUND') {
        statusEl.textContent = 'Nie znaleziono produktu w bazie Open Food Facts.';
      } else if (err.message === 'NO_NUTRIMENTS') {
        statusEl.textContent = 'Produkt jest w bazie, ale nie ma danych odżywczych.';
      } else if (err.message === 'NETWORK_ERROR') {
        statusEl.textContent = 'Błąd sieci — sprawdź połączenie z internetem.';
      } else {
        statusEl.textContent = 'Nie udało się pobrać danych produktu.';
      }
      // wracamy do skanowania, żeby dało się spróbować z innym kodem
      if (fromCamera && Barcode.isSupported()) {
        Barcode.startDetection(document.getElementById('barcodeVideo'), onBarcodeDetected);
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
      fillFormFromAnalysis(result);
      showToast('Rozpoznano posiłek — sprawdź wartości');
    } catch (err) {
      statusEl.textContent = '';
      showScanError(err, errorEl, {
        notRecognized: 'Nie rozpoznano jedzenia w wypowiedzi. Wpisz wartości ręcznie.',
        failed: 'Nie udało się przeanalizować wypowiedzi. Wpisz wartości ręcznie.'
      });
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
    handleScreenshotScan,
    handleMealPhoto,
    handleVoiceEntry,
    openBarcodeScanner,
    closeBarcodeScanner,
    lookupBarcode,
    clearAllData,
    exportDataToFile,
    importDataFromFile,
    saveFirebaseConfigFromForm,
    syncWithCloud,
    renderFirebaseAuthBlock,
    ensureAuthListener,
    recalcFromPer100g,
    clearPendingPer100g,
    autofillFromName,
    getCurrentDate: () => currentDate
  };
})();
