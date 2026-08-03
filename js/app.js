document.addEventListener('DOMContentLoaded', () => {
  UI.renderDiary();
  UI.updateSupplementsNavVisibility();

  // Potrójne tapnięcie daty (w ciągu 800 ms) odsłania/chowa moduł suplementów.
  // Okno celowo szersze niż typowe 300-400ms — na dotyku zdarzenie click bywa
  // opóźnione, więc trzeba dać zapas (patrz też touch-action: manipulation w CSS).
  let suppTapCount = 0;
  let suppTapTimer = null;
  const dateLabelEl = document.getElementById('currentDateLabel');
  dateLabelEl.addEventListener('click', () => {
    suppTapCount++;
    clearTimeout(suppTapTimer);
    if (suppTapCount >= 3) {
      suppTapCount = 0;
      UI.toggleSupplementsUnlocked();
      return;
    }
    suppTapTimer = setTimeout(() => { suppTapCount = 0; }, 800);
  });

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => UI.switchView(btn.dataset.view));
  });

  document.getElementById('prevDay').addEventListener('click', () => UI.changeDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => UI.changeDay(1));
  document.getElementById('suppPrevDay').addEventListener('click', () => UI.changeDay(-1));
  document.getElementById('suppNextDay').addEventListener('click', () => UI.changeDay(1));

  document.getElementById('fabAdd').addEventListener('click', () => UI.openEntryModal());
  document.getElementById('cancelEntryBtn').addEventListener('click', () => UI.closeEntryModal());
  document.getElementById('saveEntryBtn').addEventListener('click', () => UI.saveEntryFromForm());
  document.getElementById('entryModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'entryModalOverlay') UI.closeEntryModal();
  });

  document.getElementById('scanLabelBtn').addEventListener('click', () => {
    document.getElementById('labelFileInput').click();
  });
  document.getElementById('labelFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) UI.handleLabelScan(file);
    e.target.value = '';
  });

  document.getElementById('scanScreenshotBtn').addEventListener('click', () => {
    document.getElementById('screenshotFileInput').click();
  });
  document.getElementById('screenshotFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) UI.handleScreenshotScan(file);
    e.target.value = '';
  });

  document.getElementById('voiceEntryBtn').addEventListener('click', () => UI.handleVoiceEntry());

  document.getElementById('scanMealPhotoBtn').addEventListener('click', () => {
    document.getElementById('mealPhotoFileInput').click();
  });
  document.getElementById('mealPhotoFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) UI.handleMealPhoto(file);
    e.target.value = '';
  });

  document.getElementById('scanBarcodeBtn').addEventListener('click', () => UI.openBarcodeScanner());
  document.getElementById('barcodeCancelBtn').addEventListener('click', () => {
    if (window._barcodeReturnToIngredient) {
      window._barcodeReturnToIngredient = false;
      Barcode.stop();
      document.getElementById('barcodeOverlay').classList.remove('active');
      document.getElementById('ingredientModalOverlay').classList.add('active');
    } else {
      UI.closeBarcodeScanner();
    }
  });
  document.getElementById('barcodeManualSearchBtn').addEventListener('click', () => {
    const code = document.getElementById('barcodeManualInput').value;
    if (window._barcodeReturnToIngredient) {
      Recipes.lookupIngredientBarcode(code);
    } else {
      UI.lookupBarcode(code, false);
    }
  });
  document.getElementById('barcodeManualInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (window._barcodeReturnToIngredient) {
        Recipes.lookupIngredientBarcode(e.target.value);
      } else {
        UI.lookupBarcode(e.target.value, false);
      }
    }
  });
  document.getElementById('barcodeOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'barcodeOverlay') {
      if (window._barcodeReturnToIngredient) {
        window._barcodeReturnToIngredient = false;
        Barcode.stop();
        document.getElementById('barcodeOverlay').classList.remove('active');
        document.getElementById('ingredientModalOverlay').classList.add('active');
      } else {
        UI.closeBarcodeScanner();
      }
    }
  });

  document.getElementById('entryGrams').addEventListener('input', () => UI.recalcFromPer100g());
  ['entryKcal', 'entryProtein', 'entryCarbs', 'entryFat', 'entryFiber'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => UI.clearPendingPer100g());
  });
  document.getElementById('entryName').addEventListener('input', () => UI.searchProducts());
  document.getElementById('entryName').addEventListener('blur', () => UI.hideAutocomplete());
  document.getElementById('entryName').addEventListener('change', () => UI.autofillFromName());
  document.getElementById('recentToggleBtn').addEventListener('click', () => UI.toggleRecentSection());
  document.getElementById('favoriteToggleBtn').addEventListener('click', () => UI.toggleFavoriteSection());

  document.querySelectorAll('#mealSelect button').forEach((btn) => {
    btn.addEventListener('click', () => UI.selectMeal(btn.dataset.meal));
  });

  document.getElementById('weightInput').addEventListener('change', () => UI.saveWeightFromInput());
  document.getElementById('smmInput').addEventListener('change', () => UI.saveWeightFromInput());
  document.getElementById('bfInput').addEventListener('change', () => UI.saveWeightFromInput());
  document.getElementById('weightRowToggle').addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT') return;
    UI.toggleBodyComp();
  });

  document.querySelectorAll('#historyMetricTabs button').forEach((btn) => {
    btn.addEventListener('click', () => UI.setHistoryMetric(btn.dataset.metric));
  });

  document.getElementById('historySearchInput').addEventListener('input', () => UI.searchHistory());

  // Przycisk "Z przepisu" w modalu dodawania
  document.getElementById('fromRecipeBtn').addEventListener('click', () => {
    UI.closeEntryModal();
    Recipes.openPortionModal();
  });

  // ── Przepisy ──
  document.getElementById('newRecipeBtn').addEventListener('click', () => Recipes.openRecipeModal());
  document.querySelectorAll('#recipeTabs button').forEach((btn) => {
    btn.addEventListener('click', () => Recipes.setRecipeTab(btn.dataset.tab));
  });
  document.getElementById('cancelRecipeBtn').addEventListener('click', () => Recipes.closeRecipeModal());
  document.getElementById('saveRecipeBtn').addEventListener('click', () => Recipes.saveRecipe());
  document.getElementById('recipeParseAiBtn').addEventListener('click', () => Recipes.parseRecipeWithAi());
  document.getElementById('recipeVoiceBtn').addEventListener('click', () => Recipes.handleRecipeVoice());
  document.getElementById('recipeVoiceSendBtn').addEventListener('click', () => Recipes.handleRecipeVoiceSend());
  document.getElementById('recipeVoiceDiscardBtn').addEventListener('click', () => Recipes.handleRecipeVoiceDiscard());
  document.getElementById('recipeScreenshotBtn').addEventListener('click', () => {
    document.getElementById('recipeScreenshotFileInput').click();
  });
  document.getElementById('recipeScreenshotFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) Recipes.handleRecipeScreenshot(file);
    e.target.value = '';
  });
  document.getElementById('recipeModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'recipeModalOverlay') Recipes.closeRecipeModal();
  });
  document.getElementById('recipeCookedWeight').addEventListener('input', () => Recipes.renderRecipeIngredients());

  // Składnik
  document.getElementById('recipeAddIngredientBtn').addEventListener('click', () => Recipes.openIngredientModal());
  document.getElementById('cancelIngredientBtn').addEventListener('click', () => Recipes.closeIngredientModal());
  document.getElementById('saveIngredientBtn').addEventListener('click', () => Recipes.saveIngredient());
  document.getElementById('ingredientModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'ingredientModalOverlay') Recipes.closeIngredientModal();
  });
  document.getElementById('ingredientScanLabelBtn').addEventListener('click', () => {
    document.getElementById('ingredientLabelFileInput').click();
  });
  document.getElementById('ingredientLabelFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) Recipes.handleIngredientLabelScan(file);
    e.target.value = '';
  });
  document.getElementById('ingredientScanBarcodeBtn').addEventListener('click', () => Recipes.openIngredientBarcodeScanner());
  document.getElementById('ingredientVoiceBtn').addEventListener('click', () => Recipes.handleIngredientVoice());
  document.getElementById('ingredientLookupBtn').addEventListener('click', () => Recipes.handleIngredientLookup());
  document.getElementById('ingredientFavoriteToggleBtn').addEventListener('click', () => Recipes.toggleIngredientFavoriteSection());
  document.getElementById('ingredientSaveFavoriteBtn').addEventListener('click', () => Recipes.saveIngredientAsFavorite());
  document.getElementById('ingredientGrams').addEventListener('input', () => Recipes.updateIngredientMacroPreview());
  document.getElementById('ingredientKcal').addEventListener('input', () => Recipes.updateIngredientMacroPreview());
  document.getElementById('ingredientProtein').addEventListener('input', () => Recipes.updateIngredientMacroPreview());
  document.getElementById('ingredientCarbs').addEventListener('input', () => Recipes.updateIngredientMacroPreview());
  document.getElementById('ingredientFat').addEventListener('input', () => Recipes.updateIngredientMacroPreview());
  document.getElementById('ingredientFiber').addEventListener('input', () => Recipes.updateIngredientMacroPreview());

  // Porcja z przepisu
  document.getElementById('cancelPortionBtn').addEventListener('click', () => Recipes.closePortionModal());
  document.getElementById('savePortionBtn').addEventListener('click', () => Recipes.savePortionEntry());
  document.getElementById('portionModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'portionModalOverlay') Recipes.closePortionModal();
  });
  document.getElementById('portionRecipeSelect').addEventListener('change', () => {
    Recipes.updatePortionRecipeInfo();
    Recipes.updatePortionPreview();
  });
  document.getElementById('portionValue').addEventListener('input', () => Recipes.updatePortionPreview());
  document.querySelectorAll('#portionModeSelect button').forEach((btn) => {
    btn.addEventListener('click', () => Recipes.selectPortionMode(btn.dataset.mode));
  });
  document.querySelectorAll('#portionMealSelect button').forEach((btn) => {
    btn.addEventListener('click', () => Recipes.selectPortionMeal(btn.dataset.meal));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('barcodeOverlay').classList.contains('active')) {
      UI.closeBarcodeScanner();
    } else if (document.getElementById('ingredientModalOverlay').classList.contains('active')) {
      Recipes.closeIngredientModal();
    } else if (document.getElementById('recipeModalOverlay').classList.contains('active')) {
      Recipes.closeRecipeModal();
    } else if (document.getElementById('portionModalOverlay').classList.contains('active')) {
      Recipes.closePortionModal();
    } else if (document.getElementById('entryModalOverlay').classList.contains('active')) {
      UI.closeEntryModal();
    } else if (document.getElementById('goalModalOverlay').classList.contains('active')) {
      UI.closeGoalModal();
    } else if (document.getElementById('analysisGoalPickerOverlay').classList.contains('active')) {
      UI.closeGoalPickerModal();
    } else if (document.getElementById('suppModalOverlay').classList.contains('active')) {
      UI.closeSupplementModal();
    }
  });

  document.querySelectorAll('#themeSelect button').forEach((btn) => {
    btn.addEventListener('click', () => UI.setTheme(btn.dataset.themeValue));
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', () => UI.saveSettingsFromForm());
  document.getElementById('clearDataBtn').addEventListener('click', () => UI.clearAllData());

  const toggleBtn = document.getElementById('toggleApiKeyVisibility');
  toggleBtn.addEventListener('click', () => {
    const input = document.getElementById('settingApiKey');
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    toggleBtn.textContent = isHidden ? 'Ukryj' : 'Pokaż';
  });

  document.getElementById('exportDataBtn').addEventListener('click', () => UI.exportDataToFile());
  document.getElementById('importDataBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) UI.importDataFromFile(file);
    e.target.value = '';
  });

  document.getElementById('saveFirebaseConfigBtn').addEventListener('click', () => UI.saveFirebaseConfigFromForm());

  // ── Cele analizy dnia ──
  document.getElementById('newGoalBtn').addEventListener('click', () => UI.openGoalModal());
  document.getElementById('cancelGoalBtn').addEventListener('click', () => UI.closeGoalModal());
  document.getElementById('saveGoalBtn').addEventListener('click', () => UI.saveGoalFromForm());
  document.getElementById('goalModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'goalModalOverlay') UI.closeGoalModal();
  });
  document.getElementById('cancelAnalysisGoalPickerBtn').addEventListener('click', () => UI.closeGoalPickerModal());
  document.getElementById('analysisGoalPickerOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'analysisGoalPickerOverlay') UI.closeGoalPickerModal();
  });

  // ── Suplementy i leki (Ustawienia) ──
  document.getElementById('newSupplementBtn').addEventListener('click', () => UI.openSupplementModal());
  document.getElementById('cancelSuppBtn').addEventListener('click', () => UI.closeSupplementModal());
  document.getElementById('saveSuppBtn').addEventListener('click', () => UI.saveSupplementFromForm());
  document.getElementById('suppModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'suppModalOverlay') UI.closeSupplementModal();
  });
  document.getElementById('suppScheduleType').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-schedule]');
    if (!btn) return;
    document.querySelectorAll('#suppScheduleType button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    UI.updateSuppScheduleRowsVisibility();
  });
  document.getElementById('suppTimingSelect').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-timing]');
    if (!btn) return;
    document.querySelectorAll('#suppTimingSelect button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Rejestracja service workera nieudana:', err);
    });
  }

  const existingFirebaseConfig = Storage.getSettings().firebaseConfig;
  if (existingFirebaseConfig && window.FirebaseSync) {
    try {
      const parsed = FirebaseSync.parseFirebaseConfig(existingFirebaseConfig);
      FirebaseSync.init(parsed).then(() => UI.ensureAuthListener());
    } catch (e) {
      console.warn('Nie udało się wczytać zapisanej konfiguracji Firebase:', e);
    }
  }
});
