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

  document.getElementById('entryGrams').addEventListener('input', () => UI.recalcFromPer100g());
  ['entryKcal', 'entryProtein', 'entryCarbs', 'entryFat'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => UI.clearPendingPer100g());
  });
  document.getElementById('entryName').addEventListener('change', () => UI.autofillFromName());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('entryModalOverlay').classList.contains('active')) {
      UI.closeEntryModal();
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
