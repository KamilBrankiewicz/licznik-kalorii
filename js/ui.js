const UI = (() => {
  let currentDate = toDateStr(new Date());
  let editingEntryId = null;
  let pendingSource = 'manual';
  let pendingPer100g = null;
  let pendingMeal = 'przekaska';
  let toastTimeout = null;
  let authListenerRegistered = false;

  const MEALS = [
    { key: 'sniadanie', label: 'Śniadanie' },
    { key: 'obiad', label: 'Obiad' },
    { key: 'kolacja', label: 'Kolacja' },
    { key: 'przekaska', label: 'Przekąska' }
  ];

  // Domyślna kategoria na podstawie godziny — także dla starych wpisów bez pola meal
  function mealFromTime(time) {
    const h = Number((time || '').split(':')[0]);
    if (!Number.isFinite(h)) return 'przekaska';
    if (h >= 4 && h < 11) return 'sniadanie';
    if (h >= 11 && h < 16) return 'obiad';
    if (h >= 16 && h < 22) return 'kolacja';
    return 'przekaska';
  }

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
    if (viewName === 'przepisy') renderRecipeList();
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

    document.getElementById('fiberValue').textContent = `${Math.round(summary.fiber)} / ${settings.fiberGoal} g`;
    document.getElementById('fiberBarFill').style.width = pct(summary.fiber, settings.fiberGoal) + '%';

    // Waga obowiązuje od pomiaru do następnego: pomiar z tego dnia jest edytowalny
    // w polu, a przy jego braku pokazujemy ostatnią znaną wagę jako podpowiedź
    const weightInput = document.getElementById('weightInput');
    const weightHint = document.getElementById('weightLastHint');
    const ownWeight = Storage.getWeight(currentDate);
    if (ownWeight != null) {
      weightInput.value = ownWeight;
      weightInput.placeholder = '—';
      weightHint.textContent = '';
    } else {
      const latest = Storage.getLatestWeight(currentDate);
      weightInput.value = '';
      weightInput.placeholder = latest ? String(latest.kg) : '—';
      if (latest) {
        const [, m, d] = latest.date.split('-');
        weightHint.textContent = `· ostatni pomiar ${d}.${m}`;
      } else {
        weightHint.textContent = '';
      }
    }

    const entries = Storage.getEntries(currentDate).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const list = document.getElementById('entriesList');
    list.innerHTML = '';

    if (entries.length === 0) {
      list.innerHTML = '<div class="empty-state">Brak wpisów. Dodaj pierwszy posiłek przyciskiem +</div>';
      return;
    }

    MEALS.forEach((meal) => {
      const mealEntries = entries.filter((e) => (e.meal || mealFromTime(e.time)) === meal.key);
      if (mealEntries.length === 0) return;

      const mealKcal = mealEntries.reduce((s, e) => s + (Number(e.kcal) || 0), 0);
      const header = document.createElement('div');
      header.className = 'meal-header';
      header.innerHTML = `<span>${meal.label}</span><span class="meal-kcal">${Math.round(mealKcal)} kcal</span>`;
      list.appendChild(header);

      mealEntries.forEach((e) => {
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
          <button class="entry-relog" data-id="${e.id}" aria-label="Dodaj ponownie dziś" title="Dodaj ponownie dziś">⟳</button>
          <button class="entry-delete" data-id="${e.id}" aria-label="Usuń">×</button>
        `;
        card.addEventListener('click', (ev) => {
          if (ev.target.closest('.entry-delete') || ev.target.closest('.entry-relog')) return;
          openEntryModal(e.id);
        });
        list.appendChild(card);
      });
    });

    list.querySelectorAll('.entry-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        Storage.deleteEntry(currentDate, btn.dataset.id);
        pushDayToCloud(currentDate);
        renderDiary();
        showToast('Usunięto wpis');
      });
    });

    list.querySelectorAll('.entry-relog').forEach((btn) => {
      btn.addEventListener('click', () => {
        const entry = entries.find((e) => e.id === btn.dataset.id);
        if (entry) relogEntry(entry);
      });
    });
  }

  // Relog: kopiuje wpis na dziś z bieżącą godziną (kategoria wg godziny)
  function relogEntry(entry) {
    const today = toDateStr(new Date());
    const time = nowTimeStr();
    Storage.addEntry(today, {
      name: entry.name,
      grams: entry.grams || null,
      kcal: entry.kcal,
      protein: entry.protein || 0,
      carbs: entry.carbs || 0,
      fat: entry.fat || 0,
      fiber: entry.fiber || 0,
      time,
      meal: mealFromTime(time),
      source: entry.source || 'manual',
      per100g: entry.per100g || null
    });
    pushDayToCloud(today);
    if (currentDate === today) renderDiary();
    showToast(currentDate === today ? 'Dodano ponownie' : 'Dodano ponownie — dziś');
  }

  function saveWeightFromInput() {
    const raw = document.getElementById('weightInput').value.trim();
    if (raw === '') {
      Storage.setWeight(currentDate, null);
      pushWeightsToCloud();
      renderDiary();
      return;
    }
    const kg = Number(raw.replace(',', '.'));
    if (!Number.isFinite(kg) || kg <= 0 || kg > 500) {
      showToast('Podaj poprawną wagę w kg');
      return;
    }
    Storage.setWeight(currentDate, Math.round(kg * 10) / 10);
    pushWeightsToCloud();
    renderDiary();
    showToast('Zapisano wagę');
  }

  function pushWeightsToCloud() {
    if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
      FirebaseSync.pushWeights(Storage.getWeights()).catch(() => showToast('Błąd synchronizacji wagi'));
    }
  }

  function pushFavoritesToCloud() {
    if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
      FirebaseSync.pushFavorites(Storage.getRawFavoriteProducts()).catch(() => showToast('Błąd synchronizacji ulubionych'));
    }
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
          <div class="week-stat"><div class="value">${avg('fiber')} g</div><div class="label">śr. błonnik</div></div>
          <div class="week-stat"><div class="value">${inGoal}/${daysWithEntries.length}</div><div class="label">dni w celu</div></div>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-date]').forEach((el) => {
      el.addEventListener('click', () => goToDate(el.dataset.date));
    });
  }

  function renderWeightStats() {
    const container = document.getElementById('weightStats');
    const cutoff = toDateStr(new Date(Date.now() - 89 * 86400000));
    const points = Storage.getWeightHistory().filter((p) => p.date >= cutoff);

    if (points.length === 0) {
      container.innerHTML = '';
      return;
    }

    const first = points[0];
    const last = points[points.length - 1];
    const kgs = points.map((p) => p.kg);
    const min = Math.min(...kgs);
    const max = Math.max(...kgs);
    const delta = Math.round((last.kg - first.kg) * 10) / 10;
    const deltaLabel = delta > 0 ? `+${delta}` : `${delta}`;

    // Wykres: oś X wg realnego odstępu dni, oś Y rozciągnięta między min i max (±0,5 kg zapasu)
    const W = 300, H = 80, PAD = 6;
    const yMin = min - 0.5, yMax = max + 0.5;
    const dayMs = 86400000;
    const t0 = new Date(first.date + 'T00:00:00').getTime();
    const t1 = new Date(last.date + 'T00:00:00').getTime();
    const span = Math.max(t1 - t0, dayMs);
    const xy = (p) => {
      const x = PAD + ((new Date(p.date + 'T00:00:00').getTime() - t0) / span) * (W - 2 * PAD);
      const y = PAD + (1 - (p.kg - yMin) / (yMax - yMin)) * (H - 2 * PAD);
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    };
    const coords = points.map(xy);
    const polyline = coords.map((c) => c.join(',')).join(' ');
    const lastDot = coords[coords.length - 1];

    container.innerHTML = `
      <div class="summary-card">
        <h3 class="section-title">Waga — ostatnie 90 dni</h3>
        <svg class="weight-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${points.length > 1 ? `<polyline points="${polyline}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
          <circle cx="${lastDot[0]}" cy="${lastDot[1]}" r="3" fill="var(--accent)"/>
        </svg>
        <div class="week-stats weight-stats-row">
          <div class="week-stat"><div class="value">${last.kg} kg</div><div class="label">aktualna</div></div>
          <div class="week-stat"><div class="value">${deltaLabel} kg</div><div class="label">zmiana</div></div>
          <div class="week-stat"><div class="value">${min} kg</div><div class="label">min</div></div>
          <div class="week-stat"><div class="value">${max} kg</div><div class="label">max</div></div>
        </div>
      </div>
    `;
  }

  function renderHistory() {
    renderWeeklyStats();
    renderWeightStats();
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
    document.getElementById('settingFiberGoal').value = s.fiberGoal;
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

      const remoteWeights = await FirebaseSync.pullWeights();
      const mergedWeights = Storage.mergeWeights(remoteWeights, Storage.getWeights());
      Storage.saveWeights(mergedWeights);
      await FirebaseSync.pushWeights(mergedWeights);

      const remoteFavorites = await FirebaseSync.pullFavorites();
      const mergedFavorites = Storage.mergeFavoriteProducts(remoteFavorites, Storage.getRawFavoriteProducts());
      Storage.saveFavoriteProducts(mergedFavorites);
      await FirebaseSync.pushFavorites(mergedFavorites);

      const remoteRecipes = await FirebaseSync.pullRecipes();
      const mergedRecipes = Storage.mergeRecipes(remoteRecipes, Storage.getRawRecipes());
      Storage.saveRecipes(mergedRecipes);
      await FirebaseSync.pushRecipes(mergedRecipes);

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
      fiberGoal: Number(document.getElementById('settingFiberGoal').value) || 0,
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
    document.getElementById('entryFiber').value = p.fiber || '';
    pendingPer100g = p.per100g || null;
  }

  // Buduje jeden "chip" z nazwą (klik = wypełnia formularz) i gwiazdką (klik = przełącza ulubione)
  function createProductChip(p, onToggleFavorite) {
    const item = document.createElement('div');
    item.className = 'chip-item';

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'chip';
    nameBtn.textContent = p.name;
    nameBtn.addEventListener('click', () => {
      fillFormFromProduct(p);
      pendingSource = p.source || 'manual';
    });

    const isFav = Storage.isFavoriteProduct(p.name);
    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'chip-star' + (isFav ? ' active' : '');
    starBtn.setAttribute('aria-pressed', String(isFav));
    starBtn.setAttribute('aria-label', isFav ? 'Usuń z ulubionych' : 'Dodaj do ulubionych');
    starBtn.textContent = isFav ? '★' : '☆';
    starBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onToggleFavorite(p);
    });

    item.appendChild(nameBtn);
    item.appendChild(starBtn);
    return item;
  }

  function renderRecentProducts(show) {
    const container = document.getElementById('recentProducts');
    const datalist = document.getElementById('productSuggestions');
    const section = document.getElementById('recentSection');
    const toggleBtn = document.getElementById('recentToggleBtn');
    container.innerHTML = '';
    datalist.innerHTML = '';
    container.classList.add('collapsed');
    toggleBtn.setAttribute('aria-expanded', 'false');

    const products = show ? Storage.getFrequentProducts(8) : [];
    section.hidden = products.length === 0;
    products.forEach((p) => {
      container.appendChild(createProductChip(p, (product) => {
        Storage.toggleFavoriteProduct(product);
        pushFavoritesToCloud();
        renderRecentProducts(true);
        renderFavoriteProducts(true);
      }));

      const opt = document.createElement('option');
      opt.value = p.name;
      datalist.appendChild(opt);
    });
  }

  function renderFavoriteProducts(show) {
    const container = document.getElementById('favoriteProducts');
    const section = document.getElementById('favoriteSection');
    const toggleBtn = document.getElementById('favoriteToggleBtn');
    container.innerHTML = '';
    container.classList.add('collapsed');
    toggleBtn.setAttribute('aria-expanded', 'false');

    const products = show ? Storage.getFavoriteProducts() : [];
    section.hidden = products.length === 0;
    products.forEach((p) => {
      container.appendChild(createProductChip(p, (product) => {
        Storage.toggleFavoriteProduct(product);
        pushFavoritesToCloud();
        renderRecentProducts(true);
        renderFavoriteProducts(true);
      }));
    });
  }

  function toggleRecentSection() {
    const container = document.getElementById('recentProducts');
    const toggleBtn = document.getElementById('recentToggleBtn');
    const collapsed = container.classList.toggle('collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  }

  function toggleFavoriteSection() {
    const container = document.getElementById('favoriteProducts');
    const toggleBtn = document.getElementById('favoriteToggleBtn');
    const collapsed = container.classList.toggle('collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
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
    if (pendingPer100g.fiber != null) {
      document.getElementById('entryFiber').value = Math.round(pendingPer100g.fiber * factor * 10) / 10;
    }
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
    document.getElementById('entryFiber').value = entry ? entry.fiber || '' : '';
    document.getElementById('entryTime').value = entry ? entry.time || nowTimeStr() : nowTimeStr();
    pendingSource = entry ? entry.source || 'manual' : 'manual';
    pendingPer100g = entry ? entry.per100g || null : null;
    selectMeal(entry ? entry.meal || mealFromTime(entry.time) : mealFromTime(nowTimeStr()));
    renderRecentProducts(!entry);
    renderFavoriteProducts(!entry);

    document.getElementById('entryModalOverlay').classList.add('active');
  }

  function selectMeal(mealKey) {
    pendingMeal = MEALS.some((m) => m.key === mealKey) ? mealKey : 'przekaska';
    document.querySelectorAll('#mealSelect button').forEach((b) => {
      b.classList.toggle('active', b.dataset.meal === pendingMeal);
    });
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
      fiber: Number(document.getElementById('entryFiber').value) || 0,
      time: document.getElementById('entryTime').value || nowTimeStr(),
      meal: pendingMeal,
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
    if (typeof result.fiber === 'number') document.getElementById('entryFiber').value = Math.round(result.fiber * 10) / 10;
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

  // ── Przepisy ──

  let recipeIngredients = [];
  let editingRecipeId = null;
  let ingredientEditIndex = null;
  let portionMode = 'grams';
  let portionMeal = 'obiad';

  function calcRecipeTotals(ingredients, cookedWeight) {
    const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    let totalWeightRaw = 0;
    ingredients.forEach((ing) => {
      const factor = (ing.grams || 0) / 100;
      totals.kcal += (ing.per100g.kcal || 0) * factor;
      totals.protein += (ing.per100g.protein || 0) * factor;
      totals.carbs += (ing.per100g.carbs || 0) * factor;
      totals.fat += (ing.per100g.fat || 0) * factor;
      totals.fiber += (ing.per100g.fiber || 0) * factor;
      totalWeightRaw += ing.grams || 0;
    });
    const effectiveWeight = cookedWeight || totalWeightRaw;
    const per100g = effectiveWeight > 0 ? {
      kcal: Math.round((totals.kcal / effectiveWeight) * 100 * 10) / 10,
      protein: Math.round((totals.protein / effectiveWeight) * 100 * 10) / 10,
      carbs: Math.round((totals.carbs / effectiveWeight) * 100 * 10) / 10,
      fat: Math.round((totals.fat / effectiveWeight) * 100 * 10) / 10,
      fiber: Math.round((totals.fiber / effectiveWeight) * 100 * 10) / 10
    } : { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    return { totals, totalWeightRaw, effectiveWeight, per100g };
  }

  function renderTotalsHtml(label, totals, effectiveWeight) {
    return `
      <div class="totals-title">${escapeHtml(label)}</div>
      <div class="totals-grid">
        <div><div class="t-value">${Math.round(totals.kcal)}</div><div class="t-label">kcal</div></div>
        <div><div class="t-value">${Math.round(totals.protein * 10) / 10}g</div><div class="t-label">białko</div></div>
        <div><div class="t-value">${Math.round(totals.carbs * 10) / 10}g</div><div class="t-label">węgle</div></div>
        <div><div class="t-value">${Math.round(totals.fat * 10) / 10}g</div><div class="t-label">tłuszcz</div></div>
        <div><div class="t-value">${Math.round((totals.fiber || 0) * 10) / 10}g</div><div class="t-label">błonnik</div></div>
        <div><div class="t-value">${Math.round(effectiveWeight)}g</div><div class="t-label">waga</div></div>
      </div>`;
  }

  function renderRecipeIngredients() {
    const list = document.getElementById('recipeIngredientsList');
    const totalsEl = document.getElementById('recipeTotals');
    list.innerHTML = '';

    if (recipeIngredients.length === 0) {
      list.innerHTML = '<div class="hint" style="text-align:center;padding:12px;">Brak składników. Dodaj ręcznie lub wklej przepis i użyj AI.</div>';
      totalsEl.hidden = true;
      return;
    }

    recipeIngredients.forEach((ing, idx) => {
      const ingKcal = Math.round(((ing.per100g.kcal || 0) * (ing.grams || 0)) / 100);
      const card = document.createElement('div');
      card.className = 'recipe-ingredient-card';
      card.dataset.idx = idx;
      card.innerHTML = `
        <div class="ing-info">
          <div class="ing-name">${escapeHtml(ing.name)}</div>
          <div class="ing-meta">${ing.grams}g · B:${Math.round((ing.per100g.protein || 0) * ing.grams / 100)} W:${Math.round((ing.per100g.carbs || 0) * ing.grams / 100)} T:${Math.round((ing.per100g.fat || 0) * ing.grams / 100)}</div>
        </div>
        <div class="ing-kcal">${ingKcal} kcal</div>
        <button class="ing-delete" data-idx="${idx}" aria-label="Usuń">×</button>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('.recipe-ingredient-card').forEach((card) => {
      card.addEventListener('click', () => {
        openIngredientModal(Number(card.dataset.idx));
      });
    });

    list.querySelectorAll('.ing-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        recipeIngredients.splice(Number(btn.dataset.idx), 1);
        renderRecipeIngredients();
      });
    });

    const cookedWeight = Number(document.getElementById('recipeCookedWeight').value) || null;
    const { totals, effectiveWeight } = calcRecipeTotals(recipeIngredients, cookedWeight);
    totalsEl.hidden = false;
    totalsEl.innerHTML = renderTotalsHtml('Suma przepisu', totals, effectiveWeight);
  }

  function openRecipeModal(recipeId) {
    editingRecipeId = recipeId || null;
    const recipe = recipeId ? Storage.getRecipeById(recipeId) : null;

    document.getElementById('recipeModalTitle').textContent = recipe ? 'Edytuj przepis' : 'Nowy przepis';
    document.getElementById('recipeName').value = recipe ? recipe.name || '' : '';
    document.getElementById('recipeTextInput').value = '';
    document.getElementById('recipeCookedWeight').value = recipe ? recipe.totalWeightCooked || '' : '';
    document.getElementById('recipeAiStatus').textContent = '';
    document.getElementById('recipeAiError').textContent = '';
    document.getElementById('recipeFormError').textContent = '';
    stopRecipeVoiceIfActive();

    recipeIngredients = recipe ? [...recipe.ingredients.map((i) => ({ ...i, per100g: { ...i.per100g } }))] : [];
    renderRecipeIngredients();

    document.getElementById('recipeModalOverlay').classList.add('active');
  }

  function closeRecipeModal() {
    stopRecipeVoiceIfActive();
    document.getElementById('recipeModalOverlay').classList.remove('active');
  }

  function saveRecipe() {
    const name = document.getElementById('recipeName').value.trim();
    const errorEl = document.getElementById('recipeFormError');

    if (!name) { errorEl.textContent = 'Podaj nazwę przepisu'; return; }
    if (recipeIngredients.length === 0) { errorEl.textContent = 'Dodaj przynajmniej jeden składnik'; return; }

    const cookedWeight = Number(document.getElementById('recipeCookedWeight').value) || null;
    const { totals, totalWeightRaw, per100g } = calcRecipeTotals(recipeIngredients, cookedWeight);

    const recipeData = {
      name,
      ingredients: recipeIngredients,
      totalWeightRaw,
      totalWeightCooked: cookedWeight,
      totals,
      per100g
    };

    if (editingRecipeId) {
      Storage.updateRecipe(editingRecipeId, recipeData);
    } else {
      Storage.addRecipe(recipeData);
    }

    pushRecipesToCloud();
    closeRecipeModal();
    renderRecipeList();
    showToast(editingRecipeId ? 'Zapisano zmiany' : 'Przepis zapisany');
  }

  function requireGeminiKeyOrPrompt(errorEl) {
    const settings = Storage.getSettings();
    if (settings.geminiApiKey) return settings;
    errorEl.innerHTML = 'Brak klucza Gemini API. Dodaj go w <button type="button" class="link-btn go-settings-recipe">Ustawieniach</button>.';
    errorEl.querySelector('.go-settings-recipe').addEventListener('click', () => {
      closeRecipeModal();
      switchView('ustawienia');
    });
    return null;
  }

  function applyParsedRecipe(result) {
    const errorEl = document.getElementById('recipeAiError');
    if (result.name && !document.getElementById('recipeName').value.trim()) {
      document.getElementById('recipeName').value = result.name;
    }

    if (result.ingredients && result.ingredients.length > 0) {
      recipeIngredients = result.ingredients.map((ing) => ({
        name: ing.name || 'Składnik',
        grams: Number(ing.grams) || 0,
        per100g: {
          kcal: Number(ing.per100g?.kcal) || 0,
          protein: Number(ing.per100g?.protein) || 0,
          carbs: Number(ing.per100g?.carbs) || 0,
          fat: Number(ing.per100g?.fat) || 0,
          fiber: ing.per100g?.fiber != null ? Number(ing.per100g.fiber) : null
        }
      }));
      renderRecipeIngredients();
      showToast(`Rozpoznano ${recipeIngredients.length} składników — sprawdź wartości`);
    } else {
      errorEl.textContent = 'Nie rozpoznano składników.';
    }
  }

  function showRecipeAiError(err, errorEl) {
    if (err.message === 'NO_API_KEY') {
      errorEl.textContent = 'Brak klucza Gemini API.';
    } else if (err.message === 'NETWORK_ERROR') {
      errorEl.textContent = 'Błąd sieci — sprawdź połączenie.';
    } else if (err.message === 'NOT_RECOGNIZED') {
      errorEl.textContent = 'Nie rozpoznano przepisu. Spróbuj ponownie lub wpisz składniki ręcznie.';
    } else {
      errorEl.textContent = 'Nie udało się przeanalizować przepisu. Spróbuj ponownie.';
    }
  }

  async function parseRecipeWithAi() {
    const text = document.getElementById('recipeTextInput').value.trim();
    const statusEl = document.getElementById('recipeAiStatus');
    const errorEl = document.getElementById('recipeAiError');
    errorEl.textContent = '';

    if (!text) { errorEl.textContent = 'Wklej tekst przepisu do pola powyżej'; return; }

    const settings = requireGeminiKeyOrPrompt(errorEl);
    if (!settings) return;

    statusEl.textContent = 'Analizuję przepis...';

    try {
      const result = await Ocr.analyzeRecipeText(text, settings.geminiApiKey);
      statusEl.textContent = '';
      applyParsedRecipe(result);
    } catch (err) {
      statusEl.textContent = '';
      showRecipeAiError(err, errorEl);
    }
  }

  let recipeAudioRecorder = null;
  let recipeRecordingState = 'idle'; // idle | recording | paused

  function setRecipeVoiceUiState(state) {
    recipeRecordingState = state;
    const btn = document.getElementById('recipeVoiceBtn');
    const controls = document.getElementById('recipeVoiceControls');
    if (state === 'recording') {
      btn.textContent = '⏸ Pauza';
    } else if (state === 'paused') {
      btn.textContent = '🎤 Wznów nagrywanie';
    } else {
      btn.textContent = '🎤 Nagraj przepis';
    }
    controls.style.display = state === 'idle' ? 'none' : '';
  }

  function stopRecipeVoiceIfActive() {
    if (recipeAudioRecorder) {
      recipeAudioRecorder.discard();
      recipeAudioRecorder = null;
    }
    setRecipeVoiceUiState('idle');
  }

  // Mikrofon nagrywa dźwięk (nie wysyła nic do Gemini w locie). Użytkownik może w
  // dowolnym momencie wstrzymać/wznowić nagrywanie (to samo nagranie, MediaRecorder
  // pause/resume), a wysyłkę do transkrypcji wykonuje świadomie przyciskiem „Wyślij
  // nagranie do AI", kiedy uzna, że skończył dyktować. Transkrybowany tekst trafia do
  // pola tekstowego — analizę składników robi osobno „Przeanalizuj przepis".
  //
  // Świadomie NIE używamy tu wbudowanego rozpoznawania mowy przeglądarki (Web Speech
  // API) — na Androidzie w trybie ciągłym okazało się zbyt niestabilne (patrz historia
  // w docs/CHANGELOG.md: trzy próby naprawy duplikowania tekstu). Wysłanie całego
  // nagrania do Gemini za jednym razem tego problemu nie ma.
  async function handleRecipeVoice() {
    const statusEl = document.getElementById('recipeAiStatus');
    const errorEl = document.getElementById('recipeAiError');
    errorEl.textContent = '';

    if (recipeRecordingState === 'recording') {
      recipeAudioRecorder.pause();
      setRecipeVoiceUiState('paused');
      statusEl.textContent = 'Wstrzymano. Wznów nagrywanie albo wyślij nagranie do AI.';
      return;
    }

    if (recipeRecordingState === 'paused') {
      recipeAudioRecorder.resume();
      setRecipeVoiceUiState('recording');
      statusEl.textContent = 'Nagrywam...';
      return;
    }

    if (!Voice.isRecordingSupported()) {
      errorEl.textContent = 'Nagrywanie dźwięku nie jest obsługiwane w tej przeglądarce.';
      return;
    }

    const recorder = Voice.createAudioRecorder();
    try {
      await recorder.start();
    } catch (err) {
      if (err.message === 'PERMISSION_DENIED') {
        errorEl.textContent = 'Brak dostępu do mikrofonu. Zezwól na dostęp w ustawieniach przeglądarki.';
      } else {
        errorEl.textContent = 'Nie udało się uruchomić nagrywania.';
      }
      return;
    }

    recipeAudioRecorder = recorder;
    setRecipeVoiceUiState('recording');
    statusEl.textContent = 'Nagrywam...';
  }

  async function handleRecipeVoiceSend() {
    const statusEl = document.getElementById('recipeAiStatus');
    const errorEl = document.getElementById('recipeAiError');
    errorEl.textContent = '';

    if (!recipeAudioRecorder) return;

    const settings = requireGeminiKeyOrPrompt(errorEl);
    if (!settings) return;

    const recorder = recipeAudioRecorder;
    recipeAudioRecorder = null;
    setRecipeVoiceUiState('idle');
    statusEl.textContent = 'Przepisuję nagranie...';

    try {
      const blob = await recorder.stopAndGetBlob();
      const transcript = await Ocr.transcribeAudio(blob, settings.geminiApiKey);
      const textarea = document.getElementById('recipeTextInput');
      const baseText = textarea.value.trim();
      textarea.value = baseText ? `${baseText} ${transcript}`.trim() : transcript;
      statusEl.textContent = 'Dodano przepisany tekst — sprawdź go i kliknij „Przeanalizuj przepis”.';
    } catch (err) {
      statusEl.textContent = '';
      if (err.message === 'NO_API_KEY') {
        errorEl.textContent = 'Brak klucza Gemini API.';
      } else if (err.message === 'NETWORK_ERROR') {
        errorEl.textContent = 'Błąd sieci — sprawdź połączenie.';
      } else {
        errorEl.textContent = 'Nie udało się przepisać nagrania. Spróbuj ponownie.';
      }
    }
  }

  function handleRecipeVoiceDiscard() {
    if (recipeAudioRecorder) {
      recipeAudioRecorder.discard();
      recipeAudioRecorder = null;
    }
    setRecipeVoiceUiState('idle');
    document.getElementById('recipeAiStatus').textContent = '';
  }

  async function handleRecipeScreenshot(file) {
    const statusEl = document.getElementById('recipeAiStatus');
    const errorEl = document.getElementById('recipeAiError');
    errorEl.textContent = '';

    const settings = requireGeminiKeyOrPrompt(errorEl);
    if (!settings) return;

    statusEl.textContent = 'Analizuję zrzut ekranu przepisu...';

    try {
      const result = await Ocr.analyzeRecipeImage(file, settings.geminiApiKey);
      statusEl.textContent = '';
      applyParsedRecipe(result);
    } catch (err) {
      statusEl.textContent = '';
      showRecipeAiError(err, errorEl);
    }
  }

  // ── Składnik do przepisu ──

  let ingredientPendingPer100g = null;

  function openIngredientModal(editIdx) {
    ingredientEditIndex = editIdx != null ? editIdx : null;
    const ing = editIdx != null ? recipeIngredients[editIdx] : null;

    document.getElementById('ingredientName').value = ing ? ing.name : '';
    document.getElementById('ingredientGrams').value = ing ? ing.grams : '';
    document.getElementById('ingredientKcal').value = ing ? ing.per100g.kcal || '' : '';
    document.getElementById('ingredientProtein').value = ing ? ing.per100g.protein || '' : '';
    document.getElementById('ingredientCarbs').value = ing ? ing.per100g.carbs || '' : '';
    document.getElementById('ingredientFat').value = ing ? ing.per100g.fat || '' : '';
    document.getElementById('ingredientFiber').value = ing && ing.per100g.fiber != null ? ing.per100g.fiber : '';
    document.getElementById('ingredientFormError').textContent = '';
    document.getElementById('ingredientScanStatus').textContent = '';
    document.getElementById('ingredientScanError').textContent = '';
    ingredientPendingPer100g = null;

    renderIngredientFavorites();
    document.getElementById('ingredientModalOverlay').classList.add('active');
  }

  function closeIngredientModal() {
    document.getElementById('ingredientModalOverlay').classList.remove('active');
  }

  function renderIngredientFavorites() {
    const container = document.getElementById('ingredientFavoriteProducts');
    const section = document.getElementById('ingredientFavoriteSection');
    const toggleBtn = document.getElementById('ingredientFavoriteToggleBtn');
    container.innerHTML = '';
    container.classList.add('collapsed');
    toggleBtn.setAttribute('aria-expanded', 'false');

    const products = Storage.getFavoriteProducts();
    section.hidden = products.length === 0;
    products.forEach((p) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = p.name;
      chip.addEventListener('click', () => {
        document.getElementById('ingredientName').value = p.name;
        if (p.per100g) {
          document.getElementById('ingredientKcal').value = p.per100g.kcal || '';
          document.getElementById('ingredientProtein').value = p.per100g.protein || '';
          document.getElementById('ingredientCarbs').value = p.per100g.carbs || '';
          document.getElementById('ingredientFat').value = p.per100g.fat || '';
          document.getElementById('ingredientFiber').value = p.per100g.fiber || '';
        }
        if (p.grams) document.getElementById('ingredientGrams').value = p.grams;
      });
      container.appendChild(chip);
    });
  }

  function toggleIngredientFavoriteSection() {
    const container = document.getElementById('ingredientFavoriteProducts');
    const toggleBtn = document.getElementById('ingredientFavoriteToggleBtn');
    const collapsed = container.classList.toggle('collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  }

  function saveIngredient() {
    const name = document.getElementById('ingredientName').value.trim();
    const grams = Number(document.getElementById('ingredientGrams').value);
    const errorEl = document.getElementById('ingredientFormError');

    if (!name) { errorEl.textContent = 'Podaj nazwę składnika'; return; }
    if (!grams || grams <= 0) { errorEl.textContent = 'Podaj wagę w gramach'; return; }

    const per100g = {
      kcal: Number(document.getElementById('ingredientKcal').value) || 0,
      protein: Number(document.getElementById('ingredientProtein').value) || 0,
      carbs: Number(document.getElementById('ingredientCarbs').value) || 0,
      fat: Number(document.getElementById('ingredientFat').value) || 0,
      fiber: document.getElementById('ingredientFiber').value !== '' ? Number(document.getElementById('ingredientFiber').value) : null
    };

    const ingredient = { name, grams, per100g };

    if (ingredientEditIndex != null) {
      recipeIngredients[ingredientEditIndex] = ingredient;
    } else {
      recipeIngredients.push(ingredient);
    }

    closeIngredientModal();
    renderRecipeIngredients();
  }

  async function handleIngredientLabelScan(file) {
    const settings = Storage.getSettings();
    const statusEl = document.getElementById('ingredientScanStatus');
    const errorEl = document.getElementById('ingredientScanError');
    errorEl.textContent = '';
    statusEl.textContent = 'Analizuję etykietę...';

    try {
      const result = await Ocr.analyzeLabel(file, settings.geminiApiKey);
      statusEl.textContent = '';
      if (result.name) document.getElementById('ingredientName').value = result.name;
      if (result.per100g) {
        document.getElementById('ingredientKcal').value = result.per100g.kcal || '';
        document.getElementById('ingredientProtein').value = result.per100g.protein || '';
        document.getElementById('ingredientCarbs').value = result.per100g.carbs || '';
        document.getElementById('ingredientFat').value = result.per100g.fat || '';
        document.getElementById('ingredientFiber').value = result.per100g.fiber || '';
      }
      showToast('Rozpoznano etykietę');
    } catch (err) {
      statusEl.textContent = '';
      if (err.message === 'NO_API_KEY') {
        errorEl.textContent = 'Brak klucza Gemini API.';
      } else {
        errorEl.textContent = 'Nie rozpoznano etykiety.';
      }
    }
  }

  async function handleIngredientVoice() {
    const statusEl = document.getElementById('ingredientScanStatus');
    const errorEl = document.getElementById('ingredientScanError');
    errorEl.textContent = '';

    if (!Voice.isSupported()) {
      errorEl.textContent = 'Rozpoznawanie mowy nie jest obsługiwane w tej przeglądarce.';
      return;
    }

    const settings = Storage.getSettings();
    if (!settings.geminiApiKey) {
      errorEl.innerHTML = 'Brak klucza Gemini API. Dodaj go w <button type="button" class="link-btn go-settings-ingredient">Ustawieniach</button>.';
      errorEl.querySelector('.go-settings-ingredient').addEventListener('click', () => {
        closeIngredientModal();
        switchView('ustawienia');
      });
      return;
    }

    statusEl.textContent = 'Słucham... powiedz jaki to składnik';

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

    document.getElementById('ingredientName').value = transcript;
    statusEl.textContent = `Rozpoznano: „${transcript}” — sprawdzam wartości odżywcze...`;

    try {
      const result = await Ocr.analyzeIngredientLookup(transcript, settings.geminiApiKey);
      statusEl.textContent = '';
      applyIngredientLookupResult(result);
    } catch (err) {
      statusEl.textContent = '';
      showIngredientLookupError(err, errorEl);
    }
  }

  async function handleIngredientLookup() {
    const name = document.getElementById('ingredientName').value.trim();
    const statusEl = document.getElementById('ingredientScanStatus');
    const errorEl = document.getElementById('ingredientScanError');
    errorEl.textContent = '';

    if (!name) { errorEl.textContent = 'Wpisz najpierw nazwę składnika'; return; }

    const settings = Storage.getSettings();
    if (!settings.geminiApiKey) {
      errorEl.innerHTML = 'Brak klucza Gemini API. Dodaj go w <button type="button" class="link-btn go-settings-ingredient">Ustawieniach</button>.';
      errorEl.querySelector('.go-settings-ingredient').addEventListener('click', () => {
        closeIngredientModal();
        switchView('ustawienia');
      });
      return;
    }

    statusEl.textContent = `Sprawdzam wartości odżywcze dla „${name}”...`;

    try {
      const result = await Ocr.analyzeIngredientLookup(name, settings.geminiApiKey);
      statusEl.textContent = '';
      applyIngredientLookupResult(result);
    } catch (err) {
      statusEl.textContent = '';
      showIngredientLookupError(err, errorEl);
    }
  }

  function applyIngredientLookupResult(result) {
    if (result.name) document.getElementById('ingredientName').value = result.name;
    if (result.per100g) {
      document.getElementById('ingredientKcal').value = result.per100g.kcal || '';
      document.getElementById('ingredientProtein').value = result.per100g.protein || '';
      document.getElementById('ingredientCarbs').value = result.per100g.carbs || '';
      document.getElementById('ingredientFat').value = result.per100g.fat || '';
      document.getElementById('ingredientFiber').value = result.per100g.fiber != null ? result.per100g.fiber : '';
    }
    showToast('Znaleziono wartości odżywcze — sprawdź i popraw');
  }

  function showIngredientLookupError(err, errorEl) {
    if (err.message === 'NO_API_KEY') {
      errorEl.textContent = 'Brak klucza Gemini API.';
    } else if (err.message === 'NETWORK_ERROR') {
      errorEl.textContent = 'Błąd sieci — sprawdź połączenie.';
    } else if (err.message === 'NOT_RECOGNIZED') {
      errorEl.textContent = 'Nie rozpoznano składnika. Wpisz wartości ręcznie.';
    } else {
      errorEl.textContent = 'Nie udało się sprawdzić wartości. Wpisz je ręcznie.';
    }
  }

  function openIngredientBarcodeScanner() {
    closeIngredientModal();
    const statusEl = document.getElementById('barcodeStatus');
    const video = document.getElementById('barcodeVideo');
    statusEl.textContent = '';
    document.getElementById('barcodeManualInput').value = '';
    document.getElementById('barcodeOverlay').classList.add('active');

    window._barcodeReturnToIngredient = true;

    if (Barcode.isSupported()) {
      video.style.display = '';
      Barcode.startCamera(video)
        .then(() => Barcode.startDetection(video, onIngredientBarcodeDetected))
        .catch(() => {
          video.style.display = 'none';
          statusEl.textContent = 'Brak dostępu do aparatu. Wpisz kod ręcznie poniżej.';
        });
    } else {
      video.style.display = 'none';
      statusEl.textContent = 'Skanowanie aparatem nie jest obsługiwane. Wpisz kod ręcznie.';
    }
  }

  function onIngredientBarcodeDetected(code) {
    if (navigator.vibrate) navigator.vibrate(80);
    lookupIngredientBarcode(code);
  }

  async function lookupIngredientBarcode(code) {
    const statusEl = document.getElementById('barcodeStatus');
    if (!code || !/^\d{6,14}$/.test(code.trim())) {
      statusEl.textContent = 'Kod kreskowy powinien składać się z 6–14 cyfr.';
      return;
    }

    Barcode.pauseDetection();
    statusEl.textContent = `Szukam produktu (${code.trim()})...`;

    try {
      const product = await Barcode.fetchProduct(code.trim());
      Barcode.stop();
      document.getElementById('barcodeOverlay').classList.remove('active');
      window._barcodeReturnToIngredient = false;

      document.getElementById('ingredientModalOverlay').classList.add('active');
      if (product.name) document.getElementById('ingredientName').value = product.name;
      if (product.per100g) {
        document.getElementById('ingredientKcal').value = product.per100g.kcal || '';
        document.getElementById('ingredientProtein').value = product.per100g.protein || '';
        document.getElementById('ingredientCarbs').value = product.per100g.carbs || '';
        document.getElementById('ingredientFat').value = product.per100g.fat || '';
        document.getElementById('ingredientFiber').value = product.per100g.fiber || '';
      }
      showToast('Znaleziono produkt');
    } catch (err) {
      if (err.message === 'PRODUCT_NOT_FOUND') {
        statusEl.textContent = 'Nie znaleziono produktu w bazie.';
      } else {
        statusEl.textContent = 'Nie udało się pobrać danych.';
      }
      if (Barcode.isSupported()) {
        Barcode.startDetection(document.getElementById('barcodeVideo'), onIngredientBarcodeDetected);
      }
    }
  }

  // ── Logowanie porcji ──

  function openPortionModal(preselectedRecipeId) {
    const recipes = Storage.getRecipes();
    if (recipes.length === 0) {
      showToast('Najpierw dodaj przepis');
      return;
    }

    const select = document.getElementById('portionRecipeSelect');
    select.innerHTML = recipes.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    if (preselectedRecipeId) select.value = preselectedRecipeId;

    portionMode = 'grams';
    document.querySelectorAll('#portionModeSelect button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === 'grams');
    });
    updatePortionInputLabel();
    document.getElementById('portionValue').value = '';
    document.getElementById('portionFormError').textContent = '';

    const time = nowTimeStr();
    portionMeal = mealFromTime(time);
    document.querySelectorAll('#portionMealSelect button').forEach((b) => {
      b.classList.toggle('active', b.dataset.meal === portionMeal);
    });

    updatePortionRecipeInfo();
    updatePortionPreview();
    document.getElementById('portionModalOverlay').classList.add('active');
  }

  function closePortionModal() {
    document.getElementById('portionModalOverlay').classList.remove('active');
  }

  function selectPortionMode(mode) {
    portionMode = mode;
    document.querySelectorAll('#portionModeSelect button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    updatePortionInputLabel();
    updatePortionPreview();
  }

  function selectPortionMeal(meal) {
    portionMeal = meal;
    document.querySelectorAll('#portionMealSelect button').forEach((b) => {
      b.classList.toggle('active', b.dataset.meal === meal);
    });
  }

  function updatePortionInputLabel() {
    const label = document.getElementById('portionInputLabel');
    const input = document.getElementById('portionValue');
    if (portionMode === 'grams') {
      label.textContent = 'Ile gramów zjadłeś?';
      input.placeholder = 'np. 150';
      input.step = 'any';
    } else if (portionMode === 'percent') {
      label.textContent = 'Ile procent zjadłeś?';
      input.placeholder = 'np. 50';
      input.step = 'any';
    } else {
      label.textContent = 'Jaki ułamek zjadłeś? (np. 0.25 = 1/4)';
      input.placeholder = 'np. 0.33';
      input.step = 'any';
    }
  }

  function updatePortionRecipeInfo() {
    const recipeId = document.getElementById('portionRecipeSelect').value;
    const recipe = Storage.getRecipeById(recipeId);
    const infoEl = document.getElementById('portionRecipeInfo');
    if (!recipe) { infoEl.hidden = true; return; }

    const { totals, effectiveWeight } = calcRecipeTotals(recipe.ingredients, recipe.totalWeightCooked);
    infoEl.hidden = false;
    infoEl.innerHTML = renderTotalsHtml(`Cały przepis: ${escapeHtml(recipe.name)}`, totals, effectiveWeight);
  }

  function updatePortionPreview() {
    const previewEl = document.getElementById('portionPreview');
    const recipeId = document.getElementById('portionRecipeSelect').value;
    const recipe = Storage.getRecipeById(recipeId);
    const rawValue = Number(document.getElementById('portionValue').value);

    if (!recipe || !rawValue || rawValue <= 0) { previewEl.hidden = true; return; }

    const { totals, effectiveWeight } = calcRecipeTotals(recipe.ingredients, recipe.totalWeightCooked);
    let factor = 0;
    let portionGrams = 0;

    if (portionMode === 'grams') {
      factor = rawValue / effectiveWeight;
      portionGrams = rawValue;
    } else if (portionMode === 'percent') {
      factor = rawValue / 100;
      portionGrams = Math.round(effectiveWeight * factor);
    } else {
      factor = rawValue;
      portionGrams = Math.round(effectiveWeight * factor);
    }

    const portionTotals = {
      kcal: totals.kcal * factor,
      protein: totals.protein * factor,
      carbs: totals.carbs * factor,
      fat: totals.fat * factor,
      fiber: (totals.fiber || 0) * factor
    };

    previewEl.hidden = false;
    previewEl.innerHTML = renderTotalsHtml('Twoja porcja', portionTotals, portionGrams);
  }

  function savePortionEntry() {
    const recipeId = document.getElementById('portionRecipeSelect').value;
    const recipe = Storage.getRecipeById(recipeId);
    const rawValue = Number(document.getElementById('portionValue').value);
    const errorEl = document.getElementById('portionFormError');

    if (!recipe) { errorEl.textContent = 'Wybierz przepis'; return; }
    if (!rawValue || rawValue <= 0) { errorEl.textContent = 'Podaj ilość porcji'; return; }

    const { totals, effectiveWeight, per100g } = calcRecipeTotals(recipe.ingredients, recipe.totalWeightCooked);
    let factor = 0;
    let portionGrams = 0;

    if (portionMode === 'grams') {
      factor = rawValue / effectiveWeight;
      portionGrams = rawValue;
    } else if (portionMode === 'percent') {
      factor = rawValue / 100;
      portionGrams = Math.round(effectiveWeight * factor);
    } else {
      factor = rawValue;
      portionGrams = Math.round(effectiveWeight * factor);
    }

    const time = nowTimeStr();
    const entryData = {
      name: recipe.name,
      grams: portionGrams,
      kcal: Math.round(totals.kcal * factor),
      protein: Math.round(totals.protein * factor * 10) / 10,
      carbs: Math.round(totals.carbs * factor * 10) / 10,
      fat: Math.round(totals.fat * factor * 10) / 10,
      fiber: Math.round((totals.fiber || 0) * factor * 10) / 10,
      time,
      meal: portionMeal,
      source: 'recipe',
      per100g
    };

    Storage.addEntry(currentDate, entryData);
    pushDayToCloud(currentDate);
    closePortionModal();
    renderDiary();
    showToast('Dodano porcję z przepisu');
  }

  // ── Lista przepisów ──

  function renderRecipeList() {
    const container = document.getElementById('recipeList');
    const recipes = Storage.getRecipes();
    container.innerHTML = '';

    if (recipes.length === 0) {
      container.innerHTML = '<div class="empty-state">Brak przepisów. Stwórz pierwszy przyciskiem powyżej.</div>';
      return;
    }

    recipes.forEach((recipe) => {
      const { totals, effectiveWeight } = calcRecipeTotals(recipe.ingredients, recipe.totalWeightCooked);
      const card = document.createElement('div');
      card.className = 'recipe-card';
      card.innerHTML = `
        <div class="recipe-title">${escapeHtml(recipe.name)}</div>
        <div class="recipe-meta">${recipe.ingredients.length} składników · ${Math.round(effectiveWeight)}g · ${Math.round(totals.kcal)} kcal</div>
        <div class="recipe-actions">
          <button class="btn btn-primary" data-action="portion" data-id="${recipe.id}" style="font-size:12px;padding:10px;">Dodaj porcję</button>
          <button class="btn btn-secondary" data-action="edit" data-id="${recipe.id}" style="font-size:12px;padding:10px;">Edytuj</button>
          <button class="btn btn-danger" data-action="delete" data-id="${recipe.id}" style="font-size:12px;padding:10px;width:auto;">×</button>
        </div>
      `;
      container.appendChild(card);
    });

    container.querySelectorAll('[data-action="portion"]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openPortionModal(btn.dataset.id); });
    });
    container.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openRecipeModal(btn.dataset.id); });
    });
    container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Usunąć ten przepis?')) {
          Storage.deleteRecipe(btn.dataset.id);
          pushRecipesToCloud();
          renderRecipeList();
          showToast('Usunięto przepis');
        }
      });
    });
  }

  function pushRecipesToCloud() {
    if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
      FirebaseSync.pushRecipes(Storage.getRawRecipes()).catch(() => showToast('Błąd synchronizacji przepisów'));
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
    selectMeal,
    toggleRecentSection,
    toggleFavoriteSection,
    saveWeightFromInput,
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
    openRecipeModal,
    closeRecipeModal,
    saveRecipe,
    parseRecipeWithAi,
    handleRecipeVoice,
    handleRecipeVoiceSend,
    handleRecipeVoiceDiscard,
    handleRecipeScreenshot,
    openIngredientModal,
    closeIngredientModal,
    saveIngredient,
    handleIngredientLabelScan,
    handleIngredientVoice,
    handleIngredientLookup,
    openIngredientBarcodeScanner,
    lookupIngredientBarcode,
    toggleIngredientFavoriteSection,
    renderRecipeIngredients,
    openPortionModal,
    closePortionModal,
    selectPortionMode,
    selectPortionMeal,
    updatePortionRecipeInfo,
    updatePortionPreview,
    savePortionEntry,
    renderRecipeList,
    getCurrentDate: () => currentDate
  };
})();
