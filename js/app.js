document.addEventListener('DOMContentLoaded', () => {
  UI.renderDiary();

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => UI.switchView(btn.dataset.view));
  });

  document.getElementById('prevDay').addEventListener('click', () => UI.changeDay(-1));
  document.getElementById('nextDay').addEventListener('click', () => UI.changeDay(1));

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
      UI.lookupIngredientBarcode(code);
    } else {
      UI.lookupBarcode(code, false);
    }
  });
  document.getElementById('barcodeManualInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (window._barcodeReturnToIngredient) {
        UI.lookupIngredientBarcode(e.target.value);
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
  document.getElementById('entryName').addEventListener('change', () => UI.autofillFromName());
  document.getElementById('recentToggleBtn').addEventListener('click', () => UI.toggleRecentSection());
  document.getElementById('favoriteToggleBtn').addEventListener('click', () => UI.toggleFavoriteSection());

  document.querySelectorAll('#mealSelect button').forEach((btn) => {
    btn.addEventListener('click', () => UI.selectMeal(btn.dataset.meal));
  });

  document.getElementById('weightInput').addEventListener('change', () => UI.saveWeightFromInput());

  // Przycisk "Z przepisu" w modalu dodawania
  document.getElementById('fromRecipeBtn').addEventListener('click', () => {
    UI.closeEntryModal();
    UI.openPortionModal();
  });

  // ── Przepisy ──
  document.getElementById('newRecipeBtn').addEventListener('click', () => UI.openRecipeModal());
  document.getElementById('cancelRecipeBtn').addEventListener('click', () => UI.closeRecipeModal());
  document.getElementById('saveRecipeBtn').addEventListener('click', () => UI.saveRecipe());
  document.getElementById('recipeParseAiBtn').addEventListener('click', () => UI.parseRecipeWithAi());
  document.getElementById('recipeVoiceBtn').addEventListener('click', () => UI.handleRecipeVoice());
  document.getElementById('recipeVoiceSendBtn').addEventListener('click', () => UI.handleRecipeVoiceSend());
  document.getElementById('recipeVoiceDiscardBtn').addEventListener('click', () => UI.handleRecipeVoiceDiscard());
  document.getElementById('recipeScreenshotBtn').addEventListener('click', () => {
    document.getElementById('recipeScreenshotFileInput').click();
  });
  document.getElementById('recipeScreenshotFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) UI.handleRecipeScreenshot(file);
    e.target.value = '';
  });
  document.getElementById('recipeModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'recipeModalOverlay') UI.closeRecipeModal();
  });
  document.getElementById('recipeCookedWeight').addEventListener('input', () => UI.renderRecipeIngredients());

  // Składnik
  document.getElementById('recipeAddIngredientBtn').addEventListener('click', () => UI.openIngredientModal());
  document.getElementById('cancelIngredientBtn').addEventListener('click', () => UI.closeIngredientModal());
  document.getElementById('saveIngredientBtn').addEventListener('click', () => UI.saveIngredient());
  document.getElementById('ingredientModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'ingredientModalOverlay') UI.closeIngredientModal();
  });
  document.getElementById('ingredientScanLabelBtn').addEventListener('click', () => {
    document.getElementById('ingredientLabelFileInput').click();
  });
  document.getElementById('ingredientLabelFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) UI.handleIngredientLabelScan(file);
    e.target.value = '';
  });
  document.getElementById('ingredientScanBarcodeBtn').addEventListener('click', () => UI.openIngredientBarcodeScanner());
  document.getElementById('ingredientVoiceBtn').addEventListener('click', () => UI.handleIngredientVoice());
  document.getElementById('ingredientLookupBtn').addEventListener('click', () => UI.handleIngredientLookup());
  document.getElementById('ingredientFavoriteToggleBtn').addEventListener('click', () => UI.toggleIngredientFavoriteSection());

  // Porcja z przepisu
  document.getElementById('cancelPortionBtn').addEventListener('click', () => UI.closePortionModal());
  document.getElementById('savePortionBtn').addEventListener('click', () => UI.savePortionEntry());
  document.getElementById('portionModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'portionModalOverlay') UI.closePortionModal();
  });
  document.getElementById('portionRecipeSelect').addEventListener('change', () => {
    UI.updatePortionRecipeInfo();
    UI.updatePortionPreview();
  });
  document.getElementById('portionValue').addEventListener('input', () => UI.updatePortionPreview());
  document.querySelectorAll('#portionModeSelect button').forEach((btn) => {
    btn.addEventListener('click', () => UI.selectPortionMode(btn.dataset.mode));
  });
  document.querySelectorAll('#portionMealSelect button').forEach((btn) => {
    btn.addEventListener('click', () => UI.selectPortionMeal(btn.dataset.meal));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('barcodeOverlay').classList.contains('active')) {
      UI.closeBarcodeScanner();
    } else if (document.getElementById('ingredientModalOverlay').classList.contains('active')) {
      UI.closeIngredientModal();
    } else if (document.getElementById('recipeModalOverlay').classList.contains('active')) {
      UI.closeRecipeModal();
    } else if (document.getElementById('portionModalOverlay').classList.contains('active')) {
      UI.closePortionModal();
    } else if (document.getElementById('entryModalOverlay').classList.contains('active')) {
      UI.closeEntryModal();
    } else if (document.getElementById('goalModalOverlay').classList.contains('active')) {
      UI.closeGoalModal();
    } else if (document.getElementById('analysisGoalPickerOverlay').classList.contains('active')) {
      UI.closeGoalPickerModal();
    }
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
