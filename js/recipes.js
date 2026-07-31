const Recipes = (() => {
  let recipeIngredients = [];
  let editingRecipeId = null;
  let ingredientEditIndex = null;
  let portionMode = 'grams';
  let portionMeal = 'obiad';
  let recipeTabFilter = 'own';
  let recipeAudioRecorder = null;
  let recipeRecordingState = 'idle';
  let ingredientPendingPer100g = null;

  const MEALS = [
    { key: 'sniadanie', label: 'Śniadanie' },
    { key: 'obiad', label: 'Obiad' },
    { key: 'kolacja', label: 'Kolacja' },
    { key: 'przekaska', label: 'Przekąska' }
  ];

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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
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
    UI.showToast(editingRecipeId ? 'Zapisano zmiany' : 'Przepis zapisany');
  }

  function requireGeminiKeyOrPrompt(errorEl) {
    const settings = Storage.getSettings();
    if (settings.geminiApiKey) return settings;
    errorEl.innerHTML = 'Brak klucza Gemini API. Dodaj go w <button type="button" class="link-btn go-settings-recipe">Ustawieniach</button>.';
    errorEl.querySelector('.go-settings-recipe').addEventListener('click', () => {
      closeRecipeModal();
      UI.switchView('ustawienia');
    });
    return null;
  }

  function applyParsedRecipe(result) {
    const errorEl = document.getElementById('recipeAiError');
    if (result.name && !document.getElementById('recipeName').value.trim()) {
      document.getElementById('recipeName').value = result.name;
    }

    if (result.ingredients && result.ingredients.length > 0) {
      const aiIngredients = result.ingredients.map((ing) => ({
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

      if (recipeIngredients.length > 0) {
        const existingNames = new Set(recipeIngredients.map((i) => i.name.trim().toLowerCase()));
        const newOnly = aiIngredients.filter((i) => !existingNames.has(i.name.trim().toLowerCase()));
        recipeIngredients = recipeIngredients.concat(newOnly);
        UI.showToast(`Dodano ${newOnly.length} nowych składników (zachowano ${recipeIngredients.length - newOnly.length} istniejących)`);
      } else {
        recipeIngredients = aiIngredients;
        UI.showToast(`Rozpoznano ${recipeIngredients.length} składników — sprawdź wartości`);
      }
      renderRecipeIngredients();
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
      statusEl.textContent = 'Dodano przepisany tekst — sprawdź go i kliknij „Przeanalizuj przepis".';
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
    updateIngredientMacroPreview();

    renderIngredientFavorites();
    document.getElementById('ingredientModalOverlay').classList.add('active');
  }

  function closeIngredientModal() {
    document.getElementById('ingredientModalOverlay').classList.remove('active');
  }

  function updateIngredientMacroPreview() {
    const el = document.getElementById('ingredientMacroPreview');
    const grams = Number(document.getElementById('ingredientGrams').value);
    const kcal = Number(document.getElementById('ingredientKcal').value);
    const protein = Number(document.getElementById('ingredientProtein').value);
    const carbs = Number(document.getElementById('ingredientCarbs').value);
    const fat = Number(document.getElementById('ingredientFat').value);
    const fiber = Number(document.getElementById('ingredientFiber').value);
    if (!grams || grams <= 0 || (!kcal && !protein && !carbs && !fat)) {
      el.textContent = '';
      return;
    }
    const f = grams / 100;
    const parts = [
      `${Math.round(kcal * f)} kcal`,
      `B: ${Math.round(protein * f * 10) / 10}g`,
      `W: ${Math.round(carbs * f * 10) / 10}g`,
      `T: ${Math.round(fat * f * 10) / 10}g`
    ];
    if (fiber) parts.push(`Bł: ${Math.round(fiber * f * 10) / 10}g`);
    el.textContent = `= ${parts.join(' · ')}`;
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
        updateIngredientMacroPreview();
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

  function saveIngredientAsFavorite() {
    const name = document.getElementById('ingredientName').value.trim();
    const grams = Number(document.getElementById('ingredientGrams').value) || 0;
    const kcal = Number(document.getElementById('ingredientKcal').value) || 0;
    const protein = Number(document.getElementById('ingredientProtein').value) || 0;
    const carbs = Number(document.getElementById('ingredientCarbs').value) || 0;
    const fat = Number(document.getElementById('ingredientFat').value) || 0;
    const fiberVal = document.getElementById('ingredientFiber').value;
    const fiber = fiberVal !== '' ? Number(fiberVal) : null;
    const errorEl = document.getElementById('ingredientFormError');

    if (!name) { errorEl.textContent = 'Podaj nazwę składnika'; return; }
    if (!kcal && !protein && !carbs && !fat) { errorEl.textContent = 'Uzupełnij wartości odżywcze'; return; }

    Storage.addFavoriteProduct({
      name,
      grams: grams || null,
      kcal: grams ? Math.round(kcal * grams / 100) : kcal,
      protein: grams ? Math.round(protein * grams / 100 * 10) / 10 : protein,
      carbs: grams ? Math.round(carbs * grams / 100 * 10) / 10 : carbs,
      fat: grams ? Math.round(fat * grams / 100 * 10) / 10 : fat,
      fiber: fiber != null ? (grams ? Math.round(fiber * grams / 100 * 10) / 10 : fiber) : null,
      per100g: { kcal, protein, carbs, fat, fiber },
      source: 'ingredient'
    });
    renderIngredientFavorites();
    UI.showToast(`Zapamiętano: ${name}`);
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
      UI.showToast('Rozpoznano etykietę');
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
        UI.switchView('ustawienia');
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
    statusEl.textContent = `Rozpoznano: „${transcript}" — sprawdzam wartości odżywcze...`;

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
        UI.switchView('ustawienia');
      });
      return;
    }

    statusEl.textContent = `Sprawdzam wartości odżywcze dla „${name}"...`;

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
    UI.showToast('Znaleziono wartości odżywcze — sprawdź i popraw');
  }

  function showIngredientLookupError(err, errorEl) {
    if (err.message === 'NO_API_KEY') {
      errorEl.textContent = 'Brak klucza Gemini API.';
    } else if (err.message === 'NETWORK_ERROR') {
      errorEl.textContent = 'Błąd sieci — sprawdź połączenie.';
    } else if (err.message === 'NOT_RECOGNIZED') {
      errorEl.textContent = 'Nie rozpoznano składnika. Wpisz wartości ręcznie.';
    } else {
      errorEl.textContent = 'Nie udało się sprawdźić wartości. Wpisz je ręcznie.';
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
      UI.showToast('Znaleziono produkt');
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

  function nowTimeStr() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  function mealFromTime(time) {
    const h = Number((time || '').split(':')[0]);
    if (!Number.isFinite(h)) return 'przekaska';
    if (h >= 4 && h < 11) return 'sniadanie';
    if (h >= 11 && h < 16) return 'obiad';
    if (h >= 16 && h < 22) return 'kolacja';
    return 'przekaska';
  }

  function openPortionModal(preselectedRecipeId) {
    const recipes = Storage.getRecipes();
    if (recipes.length === 0) {
      UI.showToast('Najpierw dodaj przepis');
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
    const currentDate = UI.getCurrentDate();
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
    UI.pushDayToCloud(currentDate);
    closePortionModal();
    UI.renderDiary();
    UI.showToast('Dodano porcję z przepisu');
  }

  // ── Lista przepisów ──

  function setRecipeTab(tab) {
    recipeTabFilter = tab;
    document.querySelectorAll('#recipeTabs button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    renderRecipeList();
  }

  function renderRecipeList() {
    const container = document.getElementById('recipeList');
    const recipes = Storage.getRecipes()
      .filter((r) => (recipeTabFilter === 'shared' ? !!r.shared : !r.shared))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    container.innerHTML = '';

    if (recipes.length === 0) {
      container.innerHTML = recipeTabFilter === 'shared'
        ? '<div class="empty-state">Brak udostępnionych przepisów.</div>'
        : '<div class="empty-state">Brak przepisów. Stwórz pierwszy przyciskiem powyżej.</div>';
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
          <button class="btn btn-secondary" data-action="share" data-id="${recipe.id}" style="font-size:12px;padding:10px;">Udostępnij</button>
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
    container.querySelectorAll('[data-action="share"]').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); shareRecipeWithPartner(btn.dataset.id); });
    });
    container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Usunąć ten przepis?')) {
          Storage.deleteRecipe(btn.dataset.id);
          pushRecipesToCloud();
          renderRecipeList();
          UI.showToast('Usunięto przepis');
        }
      });
    });
  }

  async function shareRecipeWithPartner(id) {
    if (!window.FirebaseSync || !FirebaseSync.isSignedIn()) {
      UI.showToast('Zaloguj się przez Google w Ustawieniach, aby udostępniać przepisy');
      return;
    }
    const partnerUid = (Storage.getSettings().partnerUid || '').trim();
    if (!partnerUid) {
      UI.showToast('Ustaw UID partnera w Ustawieniach, aby udostępniać przepisy');
      return;
    }
    const recipe = Storage.getRecipeById(id);
    if (!recipe) return;
    try {
      await FirebaseSync.pushSharedRecipe(partnerUid, recipe);
      UI.showToast('Udostępniono przepis partnerowi');
    } catch (e) {
      UI.showToast('Błąd udostępniania przepisu');
    }
  }

  function pushRecipesToCloud() {
    if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
      FirebaseSync.pushRecipes(Storage.getRawRecipes()).catch(() => UI.showToast('Błąd synchronizacji przepisów'));
    }
  }

  return {
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
    saveIngredientAsFavorite,
    updateIngredientMacroPreview,
    renderRecipeIngredients,
    openPortionModal,
    closePortionModal,
    selectPortionMode,
    selectPortionMeal,
    updatePortionRecipeInfo,
    updatePortionPreview,
    savePortionEntry,
    renderRecipeList,
    setRecipeTab,
    pushRecipesToCloud
  };
})();
