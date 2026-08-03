const UI = (() => {
  let currentDate = toDateStr(new Date());
  let editingEntryId = null;
  let pendingSource = 'manual';
  let pendingPer100g = null;
  let pendingMeal = 'przekaska';
  let toastTimeout = null;
  let undoTimeout = null;
  let authListenerRegistered = false;
  let historyMetric = Storage.getHistoryMetric();
  let historyCalendarMonth = new Date();
  let productCache = null;
  let autocompleteDebounce = null;
  let lastAutoFilledName = null;

  // judge: 'max' = przekroczenie celu jest złe (czerwono), 'min' = nieosiągnięcie celu jest złe,
  // 'none' = wykres tylko poglądowy, bez oceniania dobre/złe
  const HISTORY_METRICS = {
    kcal: { label: 'Kcal', unit: 'kcal', goalKey: 'kcalGoal', judge: 'max' },
    protein: { label: 'Białko', unit: 'g', goalKey: 'proteinGoal', judge: 'min' },
    carbs: { label: 'Węgle', unit: 'g', goalKey: 'carbsGoal', judge: 'none' },
    fat: { label: 'Tłuszcz', unit: 'g', goalKey: 'fatGoal', judge: 'none' }
  };

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
    toast.className = 'toast';
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    clearTimeout(undoTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function showUndoToast(msg, undoCallback) {
    const toast = document.getElementById('toast');
    toast.className = 'toast toast-undo';
    toast.innerHTML = `<span>${msg}</span><button class="toast-undo-btn">Cofnij</button>`;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    clearTimeout(undoTimeout);
    toast.querySelector('.toast-undo-btn').addEventListener('click', () => {
      clearTimeout(undoTimeout);
      toast.classList.remove('show');
      undoCallback();
    });
    undoTimeout = setTimeout(() => { toast.classList.remove('show'); toast.className = 'toast'; }, 5000);
  }

  // Widoczność modułu suplementów — celowo sessionStorage: znika po zamknięciu karty,
  // nie synchronizuje się i nie trafia do eksportu
  function supplementsUnlocked() {
    return sessionStorage.getItem('supplementsUnlocked') === '1';
  }

  function toggleSupplementsUnlocked() {
    const wasUnlocked = supplementsUnlocked();
    if (wasUnlocked) {
      sessionStorage.removeItem('supplementsUnlocked');
    } else {
      sessionStorage.setItem('supplementsUnlocked', '1');
    }
    if (navigator.vibrate) navigator.vibrate(50);
    updateSupplementsNavVisibility();

    if (wasUnlocked) {
      switchView('dziennik');
      updateSupplementsSettingsVisibility();
      showToast('Moduł suplementów ukryty');
      return;
    }

    switchView('suplementy');
    updateSupplementsSettingsVisibility();
    showToast('Moduł suplementów odblokowany');
  }

  function updateSupplementsNavVisibility() {
    const btn = document.getElementById('navSupplementy');
    if (btn) btn.hidden = !supplementsUnlocked();
  }

  function switchView(viewName) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === viewName);
    });
    if (viewName === 'historia') renderHistory();
    if (viewName === 'ustawienia') renderSettings();
    if (viewName === 'przepisy') Recipes.renderRecipeList();
    if (viewName === 'suplementy') renderSupplementsView();
  }

  function changeDay(delta) {
    const d = new Date(currentDate + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    currentDate = toDateStr(d);
    const activeView = document.querySelector('.view.active');
    if (activeView && activeView.id === 'view-suplementy') {
      renderSupplementsView();
    } else {
      renderDiary();
    }
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

    const weightInput = document.getElementById('weightInput');
    const weightHint = document.getElementById('weightLastHint');
    const smmInput = document.getElementById('smmInput');
    const bfInput = document.getElementById('bfInput');
    const bodyCompHint = document.getElementById('bodyCompLastHint');
    const ownFull = Storage.getWeightFull(currentDate);
    if (ownFull) {
      weightInput.value = ownFull.kg;
      weightInput.placeholder = '—';
      weightHint.textContent = '';
      smmInput.value = ownFull.smm != null ? ownFull.smm : '';
      bfInput.value = ownFull.bf != null ? ownFull.bf : '';
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
      smmInput.value = '';
      bfInput.value = '';
    }
    const latestBody = Storage.getLatestBodyComp(currentDate);
    if (latestBody && !(ownFull && (ownFull.smm || ownFull.bf))) {
      const [, m, d] = latestBody.date.split('-');
      bodyCompHint.textContent = `· ostatni pomiar ${d}.${m}`;
      smmInput.placeholder = latestBody.smm ? String(latestBody.smm) : '—';
      bfInput.placeholder = latestBody.bf ? String(latestBody.bf) : '—';
    } else {
      bodyCompHint.textContent = '';
      smmInput.placeholder = '—';
      bfInput.placeholder = '—';
    }

    const entries = Storage.getEntries(currentDate).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const list = document.getElementById('entriesList');
    list.innerHTML = '';

    const filledMeals = new Set();

    if (entries.length === 0) {
      list.innerHTML = '<div class="empty-state">Brak wpisów. Dodaj pierwszy posiłek przyciskiem +</div>';
    } else {
      MEALS.forEach((meal) => {
        const mealEntries = entries.filter((e) => (e.meal || mealFromTime(e.time)) === meal.key);
        if (mealEntries.length === 0) return;
        filledMeals.add(meal.key);

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
          const deletedEntry = entries.find((e) => e.id === btn.dataset.id);
          const snapshot = deletedEntry ? { ...deletedEntry } : null;
          const deleteDate = currentDate;
          Storage.deleteEntry(deleteDate, btn.dataset.id);
          pushDayToCloud(deleteDate);
          renderDiary();
          if (snapshot) {
            showUndoToast('Usunięto wpis', () => {
              Storage.updateEntry(deleteDate, snapshot.id, { ...snapshot, deleted: false });
              pushDayToCloud(deleteDate);
              renderDiary();
              showToast('Przywrócono wpis');
            });
          } else {
            showToast('Usunięto wpis');
          }
        });
      });

      list.querySelectorAll('.entry-relog').forEach((btn) => {
        btn.addEventListener('click', () => {
          const entry = entries.find((e) => e.id === btn.dataset.id);
          if (entry) relogEntry(entry);
        });
      });
    }

    renderDailyAnalysesSection();
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
    const rawSmm = document.getElementById('smmInput').value.trim();
    const rawBf = document.getElementById('bfInput').value.trim();
    if (raw === '' && rawSmm === '' && rawBf === '') {
      Storage.setWeight(currentDate, null);
      pushWeightsToCloud();
      renderDiary();
      return;
    }
    const kg = raw !== '' ? Number(raw.replace(',', '.')) : null;
    if (raw !== '' && (!Number.isFinite(kg) || kg <= 0 || kg > 500)) {
      showToast('Podaj poprawną wagę w kg');
      return;
    }
    const smm = rawSmm !== '' ? Number(rawSmm.replace(',', '.')) : null;
    if (smm != null && (!Number.isFinite(smm) || smm <= 0 || smm > 200)) {
      showToast('Podaj poprawną masę mięśni (SMM)');
      return;
    }
    const bf = rawBf !== '' ? Number(rawBf.replace(',', '.')) : null;
    if (bf != null && (!Number.isFinite(bf) || bf <= 0 || bf > 100)) {
      showToast('Podaj poprawny % tłuszczu (PBF)');
      return;
    }
    const existingFull = Storage.getWeightFull(currentDate);
    const finalKg = kg != null ? Math.round(kg * 10) / 10 : (existingFull ? existingFull.kg : null);
    if (finalKg == null) {
      showToast('Podaj wagę');
      return;
    }
    const body = {};
    if (smm != null) body.smm = Math.round(smm * 10) / 10;
    if (bf != null) body.bf = Math.round(bf * 10) / 10;
    Storage.setWeight(currentDate, finalKg, body);
    pushWeightsToCloud();
    renderDiary();
    showToast('Zapisano wagę');
  }

  function toggleBodyComp() {
    const section = document.querySelector('.weight-section');
    const panel = document.getElementById('bodyCompPanel');
    const expanded = !panel.hidden;
    panel.hidden = expanded;
    section.classList.toggle('expanded', !expanded);
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

  function pushGoalsToCloud() {
    if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
      FirebaseSync.pushGoals(Storage.getRawGoals()).catch(() => showToast('Błąd synchronizacji celów'));
    }
  }

  function pushDailyAnalysesToCloud() {
    if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
      FirebaseSync.pushDailyAnalyses(Storage.getRawDailyAnalyses()).catch(() => showToast('Błąd synchronizacji raportów'));
    }
  }

  function pushSupplementsToCloud() {
    if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
      FirebaseSync.pushSupplements(Storage.getRawSupplements()).catch(() => showToast('Błąd synchronizacji suplementów'));
    }
  }

  function pushSupplementLogToCloud() {
    if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
      FirebaseSync.pushSupplementLog(Storage.getRawSupplementLog()).catch(() => showToast('Błąd synchronizacji suplementów'));
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function isBadHistoryDay(summary, metric) {
    if (!summary.kcal) return false; // dzień bez wpisów — nie oceniamy
    if (metric.judge === 'max') return summary[metricKeyOf(metric)] > metric.goal;
    if (metric.judge === 'min') return summary[metricKeyOf(metric)] < metric.goal;
    return false;
  }

  function metricKeyOf(metric) {
    return metric.goalKey.replace('Goal', '');
  }

  function renderWeeklyStats() {
    const container = document.getElementById('weeklyStats');
    const settings = Storage.getSettings();
    const dayNames = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
    const todayStr = toDateStr(new Date());
    const metricKey = historyMetric;
    const metric = { ...HISTORY_METRICS[metricKey], goal: settings[HISTORY_METRICS[metricKey].goalKey] };
    const valueOf = (summary) => summary[metricKeyOf(metric)];

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

    const maxVal = Math.max(metric.goal, ...days.map((d) => valueOf(d.summary)), 1);
    const goalPct = Math.round((metric.goal / maxVal) * 100);
    const avg = (key) =>
      Math.round(daysWithEntries.reduce((s, d) => s + d.summary[key], 0) / daysWithEntries.length);
    const inGoal = daysWithEntries.filter((d) => !isBadHistoryDay(d.summary, metric)).length;

    container.innerHTML = `
      <div class="summary-card">
        <h3 class="section-title">Ostatnie 7 dni — ${metric.label}</h3>
        <div class="week-bars">
          <div class="goal-line" style="bottom:${goalPct}%"></div>
          ${days
            .map(
              (d) => `<div class="week-bar ${isBadHistoryDay(d.summary, metric) ? 'over' : ''}" data-date="${d.date}" style="height:${Math.round((valueOf(d.summary) / maxVal) * 100)}%"></div>`
            )
            .join('')}
        </div>
        <div class="week-labels">
          ${days
            .map(
              (d) => `<div class="week-label" data-date="${d.date}">
                <div class="week-kcal">${valueOf(d.summary) ? Math.round(valueOf(d.summary)) : ''}</div>
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
          <div class="week-stat"><div class="value">${inGoal}/${daysWithEntries.length}</div><div class="label">${metric.judge === 'none' ? 'dni z wpisem' : 'dni w celu'}</div></div>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-date]').forEach((el) => {
      el.addEventListener('click', () => goToDate(el.dataset.date));
    });
  }

  let weightChartMetric = 'kg';

  function buildWeightChart(points, key, unit, pad) {
    const vals = points.map((p) => p[key]).filter((v) => v != null);
    if (vals.length === 0) return null;
    const filtered = points.filter((p) => p[key] != null);
    const first = filtered[0];
    const last = filtered[filtered.length - 1];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const delta = Math.round((last[key] - first[key]) * 10) / 10;
    const deltaLabel = delta > 0 ? `+${delta}` : `${delta}`;

    const W = 300, H = 80, PAD = 6;
    const yMin = min - pad, yMax = max + pad;
    const dayMs = 86400000;
    const t0 = new Date(first.date + 'T00:00:00').getTime();
    const t1 = new Date(last.date + 'T00:00:00').getTime();
    const span = Math.max(t1 - t0, dayMs);
    const xy = (p) => {
      const x = PAD + ((new Date(p.date + 'T00:00:00').getTime() - t0) / span) * (W - 2 * PAD);
      const y = PAD + (1 - (p[key] - yMin) / (yMax - yMin)) * (H - 2 * PAD);
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    };
    const coords = filtered.map(xy);
    const polyline = coords.map((c) => c.join(',')).join(' ');
    const lastDot = coords[coords.length - 1];

    return {
      svg: `<svg class="weight-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        ${filtered.length > 1 ? `<polyline points="${polyline}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
        <circle cx="${lastDot[0]}" cy="${lastDot[1]}" r="3" fill="var(--accent)"/>
      </svg>`,
      stats: `
        <div class="week-stat"><div class="value">${last[key]} ${unit}</div><div class="label">aktualna</div></div>
        <div class="week-stat"><div class="value">${deltaLabel} ${unit}</div><div class="label">zmiana</div></div>
        <div class="week-stat"><div class="value">${min} ${unit}</div><div class="label">min</div></div>
        <div class="week-stat"><div class="value">${max} ${unit}</div><div class="label">max</div></div>`
    };
  }

  function setWeightChartMetric(metric) {
    weightChartMetric = metric;
    renderWeightStats();
  }

  function renderWeightStats() {
    const container = document.getElementById('weightStats');
    const cutoff = toDateStr(new Date(Date.now() - 89 * 86400000));
    const points = Storage.getWeightHistory().filter((p) => p.date >= cutoff);

    if (points.length === 0) {
      container.innerHTML = '';
      return;
    }

    const hasBody = points.some((p) => p.smm || p.bf);
    const configs = { kg: { unit: 'kg', pad: 0.5 }, smm: { unit: 'kg', pad: 0.3 }, bf: { unit: '%', pad: 0.5 } };
    const labels = { kg: 'Waga', smm: 'SMM', bf: 'PBF' };
    const cfg = configs[weightChartMetric];
    const chart = buildWeightChart(points, weightChartMetric, cfg.unit, cfg.pad);

    if (!chart) {
      if (weightChartMetric !== 'kg') {
        weightChartMetric = 'kg';
        renderWeightStats();
        return;
      }
      container.innerHTML = '';
      return;
    }

    const tabs = hasBody
      ? `<div class="weight-metric-tabs">${Object.keys(labels).map((k) =>
          `<button type="button" data-wmetric="${k}" class="${k === weightChartMetric ? 'active' : ''}">${labels[k]}</button>`
        ).join('')}</div>`
      : '';

    container.innerHTML = `
      <div class="summary-card">
        <h3 class="section-title">${labels[weightChartMetric]} — ostatnie 90 dni</h3>
        ${tabs}
        ${chart.svg}
        <div class="week-stats weight-stats-row">${chart.stats}</div>
      </div>
    `;

    container.querySelectorAll('[data-wmetric]').forEach((btn) => {
      btn.addEventListener('click', () => setWeightChartMetric(btn.dataset.wmetric));
    });
  }

  function renderHistory() {
    document.querySelectorAll('#historyMetricTabs button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.metric === historyMetric);
    });
    document.getElementById('historySearchInput').value = '';
    document.getElementById('historySearchResults').hidden = true;
    renderWeeklyStats();
    renderWeightStats();
    renderMonthCalendar();
    const dates = Storage.getAllDatesWithEntries();
    const container = document.getElementById('historyList');
    container.innerHTML = '';

    if (dates.length === 0) {
      container.innerHTML = '<div class="empty-state">Brak historii wpisów</div>';
      return;
    }

    const settings = Storage.getSettings();
    const metric = { ...HISTORY_METRICS[historyMetric], goal: settings[HISTORY_METRICS[historyMetric].goalKey] };
    dates.forEach((date) => {
      const summary = Storage.getDailySummary(date);
      const value = summary[metricKeyOf(metric)];
      const bad = isBadHistoryDay(summary, metric);
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <div>
          <div class="date">${formatDateLabel(date)}</div>
          <div class="hint" style="margin-top:2px;">cel ${metric.goal} ${metric.unit}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="history-dot" style="background:${bad ? 'var(--danger)' : 'var(--accent)'};"></div>
          <div class="kcal">${Math.round(value)} ${metric.unit}</div>
        </div>
      `;
      item.addEventListener('click', () => goToDate(date));
      container.appendChild(item);
    });
  }

  // ── Wyszukiwarka historii ──

  let searchDebounce = null;

  function searchHistory() {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(doSearchHistory, 200);
  }

  function doSearchHistory() {
    const query = (document.getElementById('historySearchInput').value || '').trim().toLowerCase();
    const resultsContainer = document.getElementById('historySearchResults');
    const normalSections = ['weeklyStats', 'weightStats', 'monthCalendar', 'historyList'];

    if (query.length < 2) {
      resultsContainer.hidden = true;
      resultsContainer.innerHTML = '';
      normalSections.forEach((id) => { document.getElementById(id).style.display = ''; });
      return;
    }

    normalSections.forEach((id) => { document.getElementById(id).style.display = 'none'; });
    resultsContainer.hidden = false;

    const dates = Storage.getAllDatesWithEntries();
    const matches = [];
    for (const date of dates) {
      if (matches.length >= 50) break;
      const entries = Storage.getEntries(date);
      for (const e of entries) {
        if (matches.length >= 50) break;
        if ((e.name || '').toLowerCase().includes(query)) {
          matches.push({ date, entry: e });
        }
      }
    }

    if (matches.length === 0) {
      resultsContainer.innerHTML = '<div class="empty-state">Brak wyników</div>';
      return;
    }

    resultsContainer.innerHTML = '';
    matches.forEach(({ date, entry }) => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <div class="result-date">${formatDateLabel(date)}</div>
        <div class="result-name">${escapeHtml(entry.name)}</div>
        <div class="result-meta">${Math.round(entry.kcal || 0)} kcal · B:${Math.round(entry.protein || 0)} W:${Math.round(entry.carbs || 0)} T:${Math.round(entry.fat || 0)}${entry.grams ? ` · ${entry.grams}g` : ''}</div>
      `;
      item.addEventListener('click', () => goToDate(date));
      resultsContainer.appendChild(item);
    });
  }

  // ── Widok miesiąca ──

  const POLISH_MONTHS = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

  function renderMonthCalendar() {
    const container = document.getElementById('monthCalendar');
    const year = historyCalendarMonth.getFullYear();
    const month = historyCalendarMonth.getMonth();
    const todayStr = toDateStr(new Date());

    const settings = Storage.getSettings();
    const metric = { ...HISTORY_METRICS[historyMetric], goal: settings[HISTORY_METRICS[historyMetric].goalKey] };

    const firstDay = new Date(year, month, 1);
    let startDow = firstDay.getDay();
    if (startDow === 0) startDow = 7;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];

    for (let i = 1; i < startDow; i++) {
      const d = new Date(year, month, 1 - (startDow - i));
      cells.push({ day: d.getDate(), dateStr: toDateStr(d), otherMonth: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, dateStr: toDateStr(new Date(year, month, d)), otherMonth: false });
    }
    while (cells.length % 7 !== 0) {
      const d = new Date(year, month, daysInMonth + (cells.length - (startDow - 1) - daysInMonth + 1));
      cells.push({ day: d.getDate(), dateStr: toDateStr(d), otherMonth: true });
    }

    const dayHeaders = ['Pn','Wt','Śr','Cz','Pt','So','Nd'].map((d) => `<div class="cal-header">${d}</div>`).join('');

    const cellsHtml = cells.map((c) => {
      const summary = Storage.getDailySummary(c.dateStr);
      const hasEntries = summary.kcal > 0;
      const bad = hasEntries ? isBadHistoryDay(summary, metric) : false;
      const isToday = c.dateStr === todayStr;
      const classes = ['cal-day'];
      if (c.otherMonth) classes.push('other-month');
      if (isToday) classes.push('today');

      let dot = '';
      if (hasEntries) {
        dot = `<div class="cal-dot ${bad ? 'bad' : 'good'}"></div>`;
      }

      return `<div class="${classes.join(' ')}" data-date="${c.dateStr}">${c.day}${dot}</div>`;
    }).join('');

    container.innerHTML = `
      <div class="summary-card month-calendar">
        <div class="month-nav">
          <button type="button" id="prevMonthBtn" aria-label="Poprzedni miesiąc">‹</button>
          <span class="month-label">${POLISH_MONTHS[month]} ${year}</span>
          <button type="button" id="nextMonthBtn" aria-label="Następny miesiąc">›</button>
        </div>
        <div class="cal-grid">${dayHeaders}${cellsHtml}</div>
      </div>
    `;

    container.querySelectorAll('.cal-day:not(.other-month)').forEach((el) => {
      el.addEventListener('click', () => goToDate(el.dataset.date));
    });
    document.getElementById('prevMonthBtn').addEventListener('click', () => {
      historyCalendarMonth = new Date(year, month - 1, 1);
      renderMonthCalendar();
    });
    document.getElementById('nextMonthBtn').addEventListener('click', () => {
      historyCalendarMonth = new Date(year, month + 1, 1);
      renderMonthCalendar();
    });
  }

  function setHistoryMetric(metric) {
    historyMetric = metric;
    Storage.saveHistoryMetric(metric);
    document.querySelectorAll('#historyMetricTabs button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.metric === metric);
    });
    renderHistory();
  }

  function setTheme(theme) {
    Storage.saveTheme(theme);
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    renderThemeSelect();
  }

  function renderThemeSelect() {
    const current = Storage.getTheme();
    document.querySelectorAll('#themeSelect button').forEach((b) => {
      b.classList.toggle('active', b.dataset.themeValue === current);
    });
  }

  function renderSettings() {
    const s = Storage.getSettings();
    renderThemeSelect();
    document.getElementById('settingKcalGoal').value = s.kcalGoal;
    document.getElementById('settingProteinGoal').value = s.proteinGoal;
    document.getElementById('settingCarbsGoal').value = s.carbsGoal;
    document.getElementById('settingFatGoal').value = s.fatGoal;
    document.getElementById('settingFiberGoal').value = s.fiberGoal;
    document.getElementById('settingApiKey').value = s.geminiApiKey;
    document.getElementById('settingHealthProfile').value = s.healthProfile || '';
    document.getElementById('firebaseConfigInput').value = s.firebaseConfig || '';
    document.getElementById('settingPartnerUid').value = s.partnerUid || '';
    document.getElementById('settingsToast').textContent = '';
    renderFirebaseAuthBlock();
    renderGoalsList();
    updateSupplementsSettingsVisibility();
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
        <div class="hint" style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span>Twoje UID (do udostępniania przepisów): <code>${escapeHtml(user.uid)}</code></span>
          <button class="btn btn-secondary" id="copyUidBtn" style="padding:4px 10px;font-size:12px;">Kopiuj</button>
        </div>
        <button class="btn btn-secondary" id="firebaseSignOutBtn">Wyloguj</button>
      `;
      document.getElementById('copyUidBtn').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(user.uid);
          showToast('Skopiowano UID');
        } catch (e) {
          showToast('Nie udało się skopiować UID');
        }
      });
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

      const incomingShared = await FirebaseSync.pullSharedRecipes();
      const seenShared = new Set(Storage.getSeenSharedRecipeIds());
      let importedSharedCount = 0;
      for (const item of incomingShared) {
        if (!seenShared.has(item.id)) {
          Storage.addRecipe({
            name: item.name,
            ingredients: item.ingredients,
            totalWeightCooked: item.totalWeightCooked,
            per100g: item.per100g,
            shared: true
          });
          Storage.addSeenSharedRecipeId(item.id);
          importedSharedCount++;
        }
        await FirebaseSync.deleteSharedRecipe(item.id).catch(() => {});
      }

      const remoteRecipes = await FirebaseSync.pullRecipes();
      const mergedRecipes = Storage.mergeRecipes(remoteRecipes, Storage.getRawRecipes());
      Storage.saveRecipes(mergedRecipes);
      await FirebaseSync.pushRecipes(mergedRecipes);

      const remoteGoals = await FirebaseSync.pullGoals();
      const mergedGoals = Storage.mergeGoals(remoteGoals, Storage.getRawGoals());
      Storage.saveGoals(mergedGoals);
      await FirebaseSync.pushGoals(mergedGoals);

      const remoteAnalyses = await FirebaseSync.pullDailyAnalyses();
      const mergedAnalyses = Storage.mergeDailyAnalyses(remoteAnalyses, Storage.getRawDailyAnalyses());
      Storage.saveRawDailyAnalyses(mergedAnalyses);
      await FirebaseSync.pushDailyAnalyses(mergedAnalyses);

      const remoteSupplements = await FirebaseSync.pullSupplements();
      const mergedSupplements = Storage.mergeSupplements(remoteSupplements, Storage.getRawSupplements());
      Storage.saveSupplements(mergedSupplements);
      await FirebaseSync.pushSupplements(mergedSupplements);

      const remoteSuppLog = await FirebaseSync.pullSupplementLog();
      const mergedSuppLog = Storage.mergeSupplementLog(remoteSuppLog, Storage.getRawSupplementLog());
      Storage.saveRawSupplementLog(mergedSuppLog);
      await FirebaseSync.pushSupplementLog(mergedSuppLog);

      const remoteSettings = await FirebaseSync.pullSettings();
      const localSettings = Storage.getSettings();
      if (remoteSettings) {
        Storage.saveSettings({ ...localSettings, ...remoteSettings, firebaseConfig: localSettings.firebaseConfig });
      } else {
        await FirebaseSync.pushSettings(localSettings);
      }

      renderDiary();
      if (importedSharedCount > 0) {
        Recipes.renderRecipeList();
        showToast(importedSharedCount === 1 ? 'Otrzymano przepis od partnera' : `Otrzymano ${importedSharedCount} przepisy od partnera`);
      }
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
      geminiApiKey: document.getElementById('settingApiKey').value.trim(),
      healthProfile: document.getElementById('settingHealthProfile').value.trim(),
      partnerUid: document.getElementById('settingPartnerUid').value.trim()
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
    lastAutoFilledName = (p.name || '').trim().toLowerCase();
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
    const section = document.getElementById('recentSection');
    const toggleBtn = document.getElementById('recentToggleBtn');
    container.innerHTML = '';
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

  function buildProductCache() {
    productCache = Storage.getUniqueProducts();
  }

  function searchProducts() {
    clearTimeout(autocompleteDebounce);
    autocompleteDebounce = setTimeout(doSearchProducts, 200);
  }

  function doSearchProducts() {
    const input = document.getElementById('entryName');
    const dropdown = document.getElementById('nameAutocomplete');
    const query = (input.value || '').trim().toLowerCase();

    if (query.length < 2 || !productCache) {
      dropdown.hidden = true;
      dropdown.innerHTML = '';
      return;
    }

    const matches = [];
    for (const p of productCache) {
      if ((p.name || '').toLowerCase().includes(query)) matches.push(p);
      if (matches.length >= 8) break;
    }

    if (matches.length === 0) {
      dropdown.hidden = true;
      dropdown.innerHTML = '';
      return;
    }

    dropdown.innerHTML = '';
    matches.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.innerHTML = `
        <span class="autocomplete-name">${escapeHtml(p.name)}</span>
        <span class="autocomplete-meta">${Math.round(p.kcal || 0)} kcal${p.grams ? ' · ' + p.grams + 'g' : ''}</span>
      `;
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        fillFormFromProduct(p);
        pendingSource = p.source || 'manual';
        dropdown.hidden = true;
        dropdown.innerHTML = '';
      });
      dropdown.appendChild(item);
    });
    dropdown.hidden = false;
  }

  function hideAutocomplete() {
    const dropdown = document.getElementById('nameAutocomplete');
    dropdown.hidden = true;
    dropdown.innerHTML = '';
  }

  function autofillFromName() {
    hideAutocomplete();
    const name = document.getElementById('entryName').value.trim().toLowerCase();
    if (!name) return;
    // Nie nadpisuje kcal wpisanego ręcznie (lastAutoFilledName===null) ani gdy nazwa nie zmieniła się
    // od ostatniego dopasowania — ale pozwala odświeżyć makra po zmianie na inny produkt z listy
    if (document.getElementById('entryKcal').value && (lastAutoFilledName === null || lastAutoFilledName === name)) return;
    if (!productCache) buildProductCache();
    const match = productCache.find((p) => (p.name || '').trim().toLowerCase() === name);
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

  // Wpisy bez zapisanego per100g (ręczne, ze zdjęcia, głosowe, porcje przepisu) nie mają
  // znanego składu na 100g — dorabiamy go z aktualnych wartości wpisu, żeby zmiana gramatury
  // przy edycji też przeliczała makra proporcjonalnie, tak jak dla wpisów z etykiety/kodu.
  function derivePer100gFromEntry(entry) {
    const grams = Number(entry.grams);
    if (!grams || grams <= 0) return null;
    const factor = 100 / grams;
    return {
      kcal: (entry.kcal || 0) * factor,
      protein: (entry.protein || 0) * factor,
      carbs: (entry.carbs || 0) * factor,
      fat: (entry.fat || 0) * factor,
      fiber: entry.fiber != null ? entry.fiber * factor : null
    };
  }

  function openEntryModal(entryId) {
    document.getElementById('entryFormError').textContent = '';
    document.getElementById('scanError').textContent = '';
    document.getElementById('scanStatus').textContent = '';
    document.getElementById('voiceError').textContent = '';
    document.getElementById('voiceStatus').textContent = '';
    hideAutocomplete();
    lastAutoFilledName = null;

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
    pendingPer100g = entry ? (entry.per100g || derivePer100gFromEntry(entry)) : null;
    selectMeal(entry ? entry.meal || mealFromTime(entry.time) : mealFromTime(nowTimeStr()));
    renderRecentProducts(!entry);
    renderFavoriteProducts(!entry);
    buildProductCache();

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

  // ── Cele analizy dnia ──

  let editingGoalId = null;
  let editingSuppId = null;

  function renderGoalsList() {
    const container = document.getElementById('goalsList');
    const goals = Storage.getGoals();

    if (goals.length === 0) {
      container.innerHTML = '<div class="hint">Brak zapisanych celów.</div>';
      return;
    }

    container.innerHTML = goals.map((g) => `
      <div class="goal-item">
        <span class="goal-item-name">${escapeHtml(g.name)}</span>
        <div class="goal-item-actions">
          <button class="btn btn-secondary" data-action="edit" data-id="${g.id}" style="font-size:12px;padding:8px 12px;width:auto;">Edytuj</button>
          <button class="btn btn-danger" data-action="delete" data-id="${g.id}" style="font-size:12px;padding:8px;width:auto;">×</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => openGoalModal(btn.dataset.id));
    });
    container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (confirm('Usunąć ten cel? Zapisane wcześniej raporty pozostaną.')) {
          Storage.deleteGoal(btn.dataset.id);
          pushGoalsToCloud();
          renderGoalsList();
          showToast('Usunięto cel');
        }
      });
    });
  }

  function openGoalModal(goalId) {
    editingGoalId = goalId || null;
    const goal = editingGoalId ? Storage.getGoals().find((g) => g.id === editingGoalId) : null;
    document.getElementById('goalModalTitle').textContent = goal ? 'Edytuj cel' : 'Nowy cel';
    document.getElementById('goalName').value = goal ? goal.name : '';
    document.getElementById('goalSystemPrompt').value = goal ? goal.systemPrompt : '';
    document.getElementById('goalFormError').textContent = '';
    document.getElementById('goalModalOverlay').classList.add('active');
  }

  function closeGoalModal() {
    document.getElementById('goalModalOverlay').classList.remove('active');
  }

  function saveGoalFromForm() {
    const name = document.getElementById('goalName').value.trim();
    const systemPrompt = document.getElementById('goalSystemPrompt').value.trim();
    const errorEl = document.getElementById('goalFormError');

    if (!name) { errorEl.textContent = 'Podaj nazwę celu'; return; }
    if (!systemPrompt) { errorEl.textContent = 'Podaj treść system promptu'; return; }

    if (editingGoalId) {
      Storage.updateGoal(editingGoalId, { name, systemPrompt });
    } else {
      Storage.addGoal({ name, systemPrompt });
    }
    pushGoalsToCloud();
    closeGoalModal();
    renderGoalsList();
    showToast(editingGoalId ? 'Zapisano zmiany' : 'Cel zapisany');
  }

  // ── Suplementy i leki — zarządzanie listą w Ustawieniach ──

  function updateSupplementsSettingsVisibility() {
    const acc = document.getElementById('supplementsAccordion');
    if (acc) acc.hidden = !supplementsUnlocked();
  }

  const SUPP_SCHEDULE_LABELS = {
    daily: 'Codziennie',
    weekdays: 'Wybrane dni',
    everyN: 'Co N dni',
    cycle: 'Cykl'
  };

  function renderSupplementsList() {
    const container = document.getElementById('supplementsList');
    if (!container) return;
    const list = Storage.getSupplements();

    if (list.length === 0) {
      container.innerHTML = '<div class="hint">Brak zapisanych suplementów.</div>';
      return;
    }

    container.innerHTML = list.map((s) => `
      <div class="goal-item">
        <span class="goal-item-name">${escapeHtml(s.name)}${s.active === false ? ' <span class="hint">(pauza)</span>' : ''} — ${SUPP_SCHEDULE_LABELS[s.scheduleType || 'daily']}</span>
        <div class="goal-item-actions">
          <button class="btn btn-secondary" data-action="edit" data-id="${s.id}" style="font-size:12px;padding:8px 12px;width:auto;">Edytuj</button>
          <button class="btn btn-danger" data-action="delete" data-id="${s.id}" style="font-size:12px;padding:8px;width:auto;">×</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-action="edit"]').forEach((btn) => {
      btn.addEventListener('click', () => openSupplementModal(btn.dataset.id));
    });
    container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (confirm('Usunąć? Historia przyjęć pozostanie.')) {
          Storage.deleteSupplement(btn.dataset.id);
          pushSupplementsToCloud();
          renderSupplementsList();
          renderSupplementsSection();
          showToast('Usunięto suplement');
        }
      });
    });
  }

  function updateSuppScheduleRowsVisibility() {
    const type = document.getElementById('suppScheduleType').value;
    document.getElementById('suppScheduleDaysRow').hidden = type !== 'weekdays';
    document.getElementById('suppScheduleNRow').hidden = type !== 'everyN';
    document.getElementById('suppCycleRow').hidden = type !== 'cycle';
  }

  function openSupplementModal(suppId) {
    editingSuppId = suppId || null;
    const supp = editingSuppId ? Storage.getSupplements().find((s) => s.id === editingSuppId) : null;
    document.getElementById('suppModalTitle').textContent = supp ? 'Edytuj suplement' : 'Nowy suplement';
    document.getElementById('suppName').value = supp ? supp.name : '';
    document.getElementById('suppDose').value = supp ? (supp.dose || '') : '';
    document.getElementById('suppNotes').value = supp ? (supp.notes || '') : '';
    document.getElementById('suppTiming').value = supp ? (supp.timing || 'any') : 'morning';
    document.getElementById('suppScheduleType').value = supp ? (supp.scheduleType || 'daily') : 'daily';
    const days = supp && Array.isArray(supp.scheduleDays) ? supp.scheduleDays : [];
    document.querySelectorAll('#suppScheduleDaysRow input[data-dow]').forEach((cb) => {
      cb.checked = days.includes(Number(cb.dataset.dow));
    });
    document.getElementById('suppScheduleN').value = supp && supp.scheduleN != null ? supp.scheduleN : '';
    document.getElementById('suppCycleOn').value = supp && supp.cycleOn != null ? supp.cycleOn : '';
    document.getElementById('suppCycleOff').value = supp && supp.cycleOff != null ? supp.cycleOff : '';
    document.getElementById('suppStock').value = supp && supp.stock != null ? supp.stock : '';
    document.getElementById('suppActive').checked = supp ? supp.active !== false : true;
    document.getElementById('suppFormError').textContent = '';
    updateSuppScheduleRowsVisibility();
    document.getElementById('suppModalOverlay').classList.add('active');
  }

  function closeSupplementModal() {
    document.getElementById('suppModalOverlay').classList.remove('active');
  }

  function saveSupplementFromForm() {
    const name = document.getElementById('suppName').value.trim();
    const errorEl = document.getElementById('suppFormError');
    if (!name) { errorEl.textContent = 'Podaj nazwę'; return; }

    const scheduleType = document.getElementById('suppScheduleType').value;
    const data = {
      name,
      dose: document.getElementById('suppDose').value.trim(),
      notes: document.getElementById('suppNotes').value.trim(),
      timing: document.getElementById('suppTiming').value,
      scheduleType,
      active: document.getElementById('suppActive').checked,
      stock: document.getElementById('suppStock').value === '' ? null : Number(document.getElementById('suppStock').value)
    };

    if (scheduleType === 'weekdays') {
      const days = [...document.querySelectorAll('#suppScheduleDaysRow input[data-dow]:checked')].map((cb) => Number(cb.dataset.dow));
      if (days.length === 0) { errorEl.textContent = 'Wybierz przynajmniej jeden dzień tygodnia'; return; }
      data.scheduleDays = days;
    } else if (scheduleType === 'everyN') {
      const n = Number(document.getElementById('suppScheduleN').value);
      if (!n || n < 2) { errorEl.textContent = 'Podaj liczbę dni (minimum 2)'; return; }
      data.scheduleN = n;
    } else if (scheduleType === 'cycle') {
      const on = Number(document.getElementById('suppCycleOn').value);
      const off = Number(document.getElementById('suppCycleOff').value);
      if (!on || on < 1) { errorEl.textContent = 'Podaj liczbę dni brania (minimum 1)'; return; }
      if (off === '' || off < 0 || Number.isNaN(off)) { errorEl.textContent = 'Podaj liczbę dni przerwy (minimum 0)'; return; }
      data.cycleOn = on;
      data.cycleOff = off;
    }

    if (editingSuppId) {
      Storage.updateSupplement(editingSuppId, data);
    } else {
      Storage.addSupplement(data);
    }
    pushSupplementsToCloud();
    closeSupplementModal();
    renderSupplementsList();
    renderSupplementsSection();
    showToast(editingSuppId ? 'Zapisano zmiany' : 'Suplement zapisany');
  }

  // ── Raport odżywczy (wyniki analizy dnia względem zapisanych celów) ──

  function overallFlag(result) {
    const meals = (result && result.meals) || [];
    if (meals.some((m) => m.flag === 'warning')) return 'warning';
    if (meals.some((m) => m.flag === 'good')) return 'good';
    return 'neutral';
  }

  function flagDot(flag) {
    return `<span class="flag-dot flag-${flag || 'neutral'}"></span>`;
  }

  function renderAnalysisBody(result) {
    if (!result) return '';
    const assumptions = result.assumptions || [];
    const meals = result.meals || [];
    const summary = result.daily_summary || {};
    const gaps = result.data_gaps || [];
    const recommendations = summary.recommendations || [];

    return `
      ${assumptions.length ? `<div class="analysis-block"><strong>Założenia:</strong> ${assumptions.map(escapeHtml).join('; ')}</div>` : ''}
      ${meals.map((m) => `
        <div class="analysis-meal">
          ${flagDot(m.flag)}<strong>${escapeHtml(m.meal_name || '')}</strong>${m.time ? ` · ${escapeHtml(m.time)}` : ''}
          ${m.contribution ? `<div class="analysis-meal-contribution">${escapeHtml(m.contribution)}</div>` : ''}
          ${m.analysis ? `<div class="analysis-meal-text">${escapeHtml(m.analysis)}</div>` : ''}
        </div>
      `).join('')}
      <div class="analysis-block">
        <strong>Podsumowanie dnia</strong>
        ${summary.total_estimate ? `<div>Szacunek: ${escapeHtml(summary.total_estimate)}</div>` : ''}
        ${summary.target ? `<div>Cel: ${escapeHtml(summary.target)}${summary.target_met_pct ? ` (realizacja: ${escapeHtml(summary.target_met_pct)})` : ''}</div>` : ''}
        ${summary.overall_assessment ? `<div style="margin-top:6px;">${escapeHtml(summary.overall_assessment)}</div>` : ''}
        ${recommendations.length ? `<ul class="analysis-recommendations">${recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
      </div>
      ${gaps.length ? `<div class="analysis-block hint">Braki w danych: ${gaps.map(escapeHtml).join('; ')}</div>` : ''}
      ${result.disclaimer ? `<div class="hint" style="margin-top:8px;">${escapeHtml(result.disclaimer)}</div>` : ''}
    `;
  }

  function renderDailyAnalysesSection() {
    const container = document.getElementById('dailyAnalysesSection');
    if (!container) return;
    const results = Storage.getDailyAnalyses(currentDate);

    const listHtml = results.length === 0
      ? '<div class="hint">Brak zapisanych analiz dla tego dnia.</div>'
      : results.map((r) => `
          <div class="analysis-card flag-border-${overallFlag(r.result)}">
            <div class="analysis-card-header" data-action="toggle">
              ${flagDot(overallFlag(r.result))}<span class="analysis-card-title">${escapeHtml(r.goalName)}</span>
              <button class="entry-delete" data-action="delete" data-goal-id="${r.goalId}" aria-label="Usuń raport">×</button>
            </div>
            <div class="analysis-card-body" hidden>${renderAnalysisBody(r.result)}</div>
          </div>
        `).join('');

    container.innerHTML = `
      <div class="section-header-row">
        <h3 class="section-title">Raport odżywczy</h3>
        <button class="btn btn-secondary" id="newAnalysisBtn" style="width:auto;padding:8px 14px;font-size:12px;">+ Nowa analiza</button>
      </div>
      <div id="dailyAnalysesList">${listHtml}</div>
    `;

    document.getElementById('newAnalysisBtn').addEventListener('click', () => openGoalPickerModal());

    container.querySelectorAll('[data-action="toggle"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="delete"]')) return;
        const body = el.parentElement.querySelector('.analysis-card-body');
        body.hidden = !body.hidden;
      });
    });
    container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Usunąć ten raport?')) {
          Storage.deleteDailyAnalysis(currentDate, btn.dataset.goalId);
          pushDailyAnalysesToCloud();
          renderDailyAnalysesSection();
          showToast('Usunięto raport');
        }
      });
    });
  }

  const TIMING_LABELS = { morning: 'Rano', noon: 'Południe', evening: 'Wieczorem', any: 'Dowolna pora' };
  const TIMING_ORDER = ['morning', 'noon', 'evening', 'any'];

  function renderSupplementsView() {
    document.getElementById('suppDateLabel').textContent = formatDateLabel(currentDate);
    renderSupplementsSection();
    renderSupplementsList();
  }

  function renderSupplementsSection() {
    const container = document.getElementById('supplementsSection');
    if (!container) return;

    const due = Storage.getSupplements().filter((s) => Storage.isSupplementDueOn(s, currentDate));
    const adhoc = Storage.getSupplementLogForDate(currentDate).filter((r) => r.adhoc);

    let itemsHtml = '';
    TIMING_ORDER.forEach((timing) => {
      const group = due.filter((s) => (s.timing || 'any') === timing);
      if (group.length === 0) return;
      itemsHtml += `<div class="supp-group-label">${TIMING_LABELS[timing]}</div>`;
      itemsHtml += group.map((s) => {
        const count = Storage.getSupplementTakenCount(currentDate, s.id);
        const taken = count > 0;
        const countLabel = count > 1 ? `<span class="supp-count">×${count}</span>` : '';
        const stockHtml = s.stock != null
          ? `<span class="supp-stock${s.stock <= 7 ? ' supp-stock-low' : ''}">zapas: ${s.stock}</span>`
          : '';
        return `
          <div class="supp-item${taken ? ' taken' : ''}" data-supp-id="${s.id}">
            <span class="supp-check">${taken ? '✓' : ''}</span>
            <span class="supp-name">${escapeHtml(s.name)}${s.dose ? ` <span class="supp-dose">${escapeHtml(s.dose)}</span>` : ''}${countLabel}</span>
            ${stockHtml}
            <button class="supp-plus-btn" data-action="increment" data-id="${s.id}" aria-label="Dodaj dawkę">+</button>
          </div>`;
      }).join('');
    });

    const adhocHtml = adhoc.map((r) => `
      <div class="supp-item taken adhoc" data-log-key="${r.key}">
        <span class="supp-check">✓</span>
        <span class="supp-name">${escapeHtml(r.name)}${r.time ? ` <span class="supp-dose">${r.time}</span>` : ''}</span>
        <button class="entry-delete" data-action="delete-adhoc" aria-label="Usuń">×</button>
      </div>`).join('');

    container.innerHTML = `
      <div class="section-header-row">
        <h3 class="section-title">Suplementy i leki</h3>
        <button class="btn btn-secondary" id="adhocSuppBtn" style="width:auto;padding:8px 14px;font-size:12px;">+ Doraźnie</button>
      </div>
      ${itemsHtml || '<div class="hint">Brak zaplanowanych na ten dzień.</div>'}
      ${adhocHtml}
    `;

    container.querySelectorAll('.supp-item[data-supp-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="increment"]')) return;
        toggleSupplementCheck(el.dataset.suppId);
      });
    });
    container.querySelectorAll('[data-action="increment"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        incrementSupplementDose(btn.dataset.id);
      });
    });
    container.querySelectorAll('[data-action="delete-adhoc"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Storage.deleteSupplementLogEntry(btn.closest('.supp-item').dataset.logKey);
        pushSupplementLogToCloud();
        renderSupplementsSection();
      });
    });
    const adhocBtn = document.getElementById('adhocSuppBtn');
    if (adhocBtn) adhocBtn.addEventListener('click', () => openAdhocSuppPrompt());
  }

  function toggleSupplementCheck(suppId) {
    const taken = Storage.toggleSupplementTaken(currentDate, suppId, nowTimeStr());
    const supp = Storage.getSupplements().find((s) => s.id === suppId);
    if (supp && supp.stock != null) {
      const newStock = Math.max(0, supp.stock + (taken ? -1 : 1));
      Storage.updateSupplement(suppId, { stock: newStock });
      pushSupplementsToCloud();
    }
    pushSupplementLogToCloud();
    renderSupplementsSection();
  }

  function incrementSupplementDose(suppId) {
    Storage.incrementSupplementDose(currentDate, suppId, nowTimeStr());
    const supp = Storage.getSupplements().find((s) => s.id === suppId);
    if (supp && supp.stock != null) {
      const newStock = Math.max(0, supp.stock - 1);
      Storage.updateSupplement(suppId, { stock: newStock });
      pushSupplementsToCloud();
    }
    pushSupplementLogToCloud();
    renderSupplementsSection();
  }

  // Wpis doraźny — celowo prosty prompt(), bez nowego modalu
  function openAdhocSuppPrompt() {
    const name = prompt('Nazwa leku / suplementu (np. Ibuprofen 200 mg):');
    if (!name || !name.trim()) return;
    Storage.addAdhocSupplementLog(currentDate, name.trim(), nowTimeStr());
    pushSupplementLogToCloud();
    renderSupplementsSection();
    showToast('Zapisano');
  }

  function openGoalPickerModal() {
    const goals = Storage.getGoals();
    const container = document.getElementById('analysisGoalPickerList');

    if (goals.length === 0) {
      container.innerHTML = '<div class="hint">Brak zapisanych celów. Dodaj cel w Ustawieniach → Cele analizy dnia.</div>';
    } else {
      container.innerHTML = goals.map((g) => `<button type="button" class="btn scan-btn" data-goal-id="${g.id}">${escapeHtml(g.name)}</button>`).join('');
      container.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => runGoalAnalysis(btn.dataset.goalId));
      });
    }

    document.getElementById('analysisGoalPickerStatus').textContent = '';
    document.getElementById('analysisGoalPickerError').textContent = '';
    document.getElementById('analysisGoalPickerOverlay').classList.add('active');
  }

  function closeGoalPickerModal() {
    document.getElementById('analysisGoalPickerOverlay').classList.remove('active');
  }

  function analysisErrorMessage(code) {
    switch (code) {
      case 'NO_API_KEY': return 'Brak klucza Gemini API — dodaj go w Ustawieniach.';
      case 'NETWORK_ERROR': return 'Brak połączenia z siecią.';
      case 'API_ERROR': return 'Błąd API Gemini. Spróbuj ponownie.';
      case 'NOT_RECOGNIZED': return 'AI nie było w stanie przeanalizować danych z tego dnia pod kątem tego celu.';
      default: return 'Nie udało się wykonać analizy.';
    }
  }

  async function runGoalAnalysis(goalId) {
    const goal = Storage.getGoals().find((g) => g.id === goalId);
    if (!goal) return;

    const entries = Storage.getEntries(currentDate).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const errorEl = document.getElementById('analysisGoalPickerError');
    const statusEl = document.getElementById('analysisGoalPickerStatus');
    errorEl.textContent = '';

    if (entries.length === 0) {
      errorEl.textContent = 'Brak wpisów w tym dniu do analizy.';
      return;
    }

    const mealsForPrompt = entries.map((e) => ({
      nazwa: e.name,
      gramatura: e.grams || null,
      posilek: (MEALS.find((m) => m.key === (e.meal || mealFromTime(e.time))) || {}).label || null,
      godzina: e.time || null,
      kcal: Math.round(Number(e.kcal) || 0),
      bialko_g: Number(e.protein) || 0,
      wegle_g: Number(e.carbs) || 0,
      tluszcz_g: Number(e.fat) || 0,
      blonnik_g: Number(e.fiber) || 0
    }));

    const apiKey = Storage.getSettings().geminiApiKey;
    const healthProfile = Storage.getSettings().healthProfile;
    statusEl.textContent = 'Analizuję dzień...';

    try {
      const result = await Ocr.analyzeDayAgainstGoal(currentDate, mealsForPrompt, goal.systemPrompt, healthProfile, apiKey);
      Storage.saveDailyAnalysis(currentDate, goal.id, goal.name, result);
      pushDailyAnalysesToCloud();
      statusEl.textContent = '';
      closeGoalPickerModal();
      renderDailyAnalysesSection();
      showToast('Zapisano raport');
    } catch (e) {
      statusEl.textContent = '';
      errorEl.textContent = analysisErrorMessage(e.message);
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
    setHistoryMetric,
    renderSettings,
    setTheme,
    saveSettingsFromForm,
    openEntryModal,
    closeEntryModal,
    saveEntryFromForm,
    selectMeal,
    toggleRecentSection,
    toggleFavoriteSection,
    saveWeightFromInput,
    toggleBodyComp,
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
    searchProducts,
    hideAutocomplete,
    showToast,
    pushDayToCloud,
    pushFavoritesToCloud,
    searchHistory,
    openGoalModal,
    closeGoalModal,
    saveGoalFromForm,
    openGoalPickerModal,
    closeGoalPickerModal,
    toggleSupplementsUnlocked,
    updateSupplementsNavVisibility,
    openSupplementModal,
    closeSupplementModal,
    saveSupplementFromForm,
    updateSuppScheduleRowsVisibility,
    getCurrentDate: () => currentDate
  };
})();
