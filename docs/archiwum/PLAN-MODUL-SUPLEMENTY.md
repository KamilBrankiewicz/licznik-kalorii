# Plan implementacji: moduł suplementów i leków (ukryty)

> Dokument dla modelu LLM implementującego moduł. Wykonuj fazy **po kolei**, nie łącz ich
> w jeden krok. Po każdej fazie przejdź jej kryteria akceptacji. Zanim zaczniesz, przeczytaj
> `CLAUDE.md` (zasady nienaruszalne) — ten plan z nich korzysta i żadnego punktu nie uchyla.

## Cel modułu

Śledzenie przyjmowania suplementów i leków:
- lista definicji (nazwa, dawka, pora dnia, harmonogram, zapas),
- dzienna checklista w widoku dziennika z odhaczaniem,
- wpisy doraźne (lek wzięty jednorazowo, bez definicji),
- synchronizacja Firestore + eksport/import jak reszta danych.

**Cała sekcja jest ukryta.** Odsłania ją długie przytrzymanie (1,5 s) nagłówka z datą
w widoku dziennika. Stan odblokowania żyje w `sessionStorage` (znika po przeładowaniu,
nie synchronizuje się między urządzeniami). Szczegóły w Fazie 3.

## Twarde ograniczenia (przeczytaj dwa razy)

1. **Nie zmieniaj modelu wpisów posiłków** (`entries_*`). Moduł nie dotyka kcal ani makro.
2. **Żadnych nowych plików JS.** Cały kod idzie do istniejących plików: `storage.js`,
   `firebase-sync.js`, `ui.js`, `app.js`, `index.html`, `css/style.css`, `sw.js`.
3. **Żadnych bibliotek, npm, bundlera.** Vanilla JS, wzorce 1:1 z istniejącego kodu.
4. **Wszystkie stringi UI po polsku.**
5. `ui.js` nigdy nie woła `localStorage` bezpośrednio — tylko przez `Storage.*`.
6. Usuwanie zawsze przez nagrobek `{ ..., deleted: true, updatedAt }` — nigdy fizyczne
   usunięcie z listy/mapy.
7. Każdy zapis rekordu ustawia `updatedAt: new Date().toISOString()`.
8. Gdy moduł jest zablokowany, **żaden ślad** suplementów nie renderuje się w DOM
   (także puste stany i nagłówki sekcji).

## Model danych

### Definicje: klucz localStorage `supplements` (tablica)

```js
{
  id: crypto.randomUUID(),
  name: 'Witamina D3',        // wymagane
  dose: '2000 IU',            // string, opcjonalne
  timing: 'morning',          // 'morning' | 'noon' | 'evening' | 'any'
  scheduleType: 'daily',      // 'daily' | 'weekdays' | 'everyN' | 'cycle'
  scheduleDays: [1,3,5],      // tylko dla 'weekdays'; 0=niedziela … 6=sobota (jak Date.getDay())
  scheduleN: 2,               // tylko dla 'everyN' (co N dni)
  cycleOn: 5, cycleOff: 2,    // tylko dla 'cycle' (5 dni brania, 2 przerwy)
  anchorDate: '2026-08-03',   // data odniesienia dla 'everyN' i 'cycle'; domyślnie data utworzenia
  stock: 60,                  // liczba sztuk w zapasie; null = nie śledzimy zapasu
  notes: 'z tłuszczem',       // opcjonalne
  active: true,               // false = pauza (nie pokazuje się w checkliście, zostaje na liście)
  updatedAt: '…ISO…'
}
```

Nagrobek: `{ id, deleted: true, updatedAt }`.

### Dziennik przyjęć: klucz localStorage `supplementLog` (mapa)

Klucz mapy: `"YYYY-MM-DD__<id>"`, gdzie `<id>` to `id` suplementu (wpis planowy)
albo świeży `crypto.randomUUID()` (wpis doraźny).

```js
// planowy (odhaczenie z checklisty):
{ date: '2026-08-03', suppId: '<id suplementu>', taken: true, time: '08:12', updatedAt: '…' }
// doraźny:
{ date: '2026-08-03', adhoc: true, name: 'Ibuprofen 200 mg', time: '14:30', updatedAt: '…' }
// odhaczenie cofnięte / wpis usunięty (nagrobek):
{ date: '2026-08-03', suppId: '<id>', deleted: true, updatedAt: '…' }
```

### Firestore

- `users/{uid}/meta/supplements` → `{ list: [...] }`
- `users/{uid}/meta/supplementLog` → `{ map: {...} }`

---

## FAZA 1 — Storage (js/storage.js)

Wzoruj się kolejno na: `getRawGoals`/`getGoals`/`addGoal`/`updateGoal`/`deleteGoal`/`mergeGoals`
(sekcja „Cele analizy dnia") oraz na `getRawDailyAnalyses`/`mergeDailyAnalyses`
(sekcja „Zapisane raporty analizy dnia").

### Krok 1.1 — stałe

Obok istniejących stałych na górze IIFE dodaj:

```js
const SUPPLEMENTS_KEY = 'supplements';
const SUPPLEMENT_LOG_KEY = 'supplementLog';
```

### Krok 1.2 — funkcje definicji (wstaw po `mergeGoals`)

```js
// ── Suplementy i leki — definicje; nagrobki + merge jak przy celach ──

function getRawSupplements() {
  const raw = localStorage.getItem(SUPPLEMENTS_KEY);
  return raw ? JSON.parse(raw) : [];
}

function getSupplements() {
  return getRawSupplements().filter((s) => !s.deleted);
}

function saveSupplements(list) {
  localStorage.setItem(SUPPLEMENTS_KEY, JSON.stringify(list));
}

function addSupplement(supp) {
  const list = getRawSupplements();
  const newSupp = {
    active: true,
    anchorDate: new Date().toISOString().slice(0, 10),
    ...supp,
    id: crypto.randomUUID(),
    updatedAt: new Date().toISOString()
  };
  list.push(newSupp);
  saveSupplements(list);
  return newSupp;
}

function updateSupplement(id, data) {
  const list = getRawSupplements();
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...data, updatedAt: new Date().toISOString() };
  saveSupplements(list);
  return list[idx];
}

function deleteSupplement(id) {
  const list = getRawSupplements().map((s) =>
    s.id === id ? { id: s.id, deleted: true, updatedAt: new Date().toISOString() } : s
  );
  saveSupplements(list);
}

function mergeSupplements(listA, listB) {
  const byId = new Map();
  [...listA, ...listB].forEach((s) => {
    const prev = byId.get(s.id);
    if (!prev || (s.updatedAt || '') > (prev.updatedAt || '')) byId.set(s.id, s);
  });
  return [...byId.values()];
}
```

### Krok 1.3 — harmonogram: czy suplement wypada danego dnia

```js
// Różnica pełnych dni między datami YYYY-MM-DD (UTC, odporne na zmianę czasu)
function daysBetween(dateA, dateB) {
  const [ya, ma, da] = dateA.split('-').map(Number);
  const [yb, mb, db] = dateB.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

// Czy wg harmonogramu suplement ma być wzięty w dniu `date` (YYYY-MM-DD)
function isSupplementDueOn(supp, date) {
  if (supp.deleted || supp.active === false) return false;
  const type = supp.scheduleType || 'daily';
  if (type === 'daily') return true;
  if (type === 'weekdays') {
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    return Array.isArray(supp.scheduleDays) && supp.scheduleDays.includes(dow);
  }
  const anchor = supp.anchorDate || date;
  const diff = daysBetween(anchor, date);
  if (diff < 0) return false;
  if (type === 'everyN') {
    const n = Number(supp.scheduleN) || 1;
    return diff % n === 0;
  }
  if (type === 'cycle') {
    const on = Number(supp.cycleOn) || 1;
    const off = Number(supp.cycleOff) || 0;
    return diff % (on + off) < on;
  }
  return true;
}
```

### Krok 1.4 — dziennik przyjęć (wstaw po `mergeDailyAnalyses`)

```js
// ── Dziennik przyjęć suplementów — mapa { "YYYY-MM-DD__id": {...} },
// nagrobki + merge jak przy raportach analizy dnia ──

function supplementLogKey(date, id) {
  return `${date}__${id}`;
}

function getRawSupplementLog() {
  const raw = localStorage.getItem(SUPPLEMENT_LOG_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveRawSupplementLog(map) {
  localStorage.setItem(SUPPLEMENT_LOG_KEY, JSON.stringify(map));
}

// Wpisy z danego dnia (bez nagrobków)
function getSupplementLogForDate(date) {
  return Object.entries(getRawSupplementLog())
    .filter(([, r]) => r.date === date && !r.deleted)
    .map(([key, r]) => ({ key, ...r }));
}

function isSupplementTaken(date, suppId) {
  const rec = getRawSupplementLog()[supplementLogKey(date, suppId)];
  return !!rec && !rec.deleted && rec.taken === true;
}

// Przełącza odhaczenie; zwraca nowy stan (true = wzięte)
function toggleSupplementTaken(date, suppId, time) {
  const map = getRawSupplementLog();
  const key = supplementLogKey(date, suppId);
  const now = new Date().toISOString();
  const wasTaken = !!map[key] && !map[key].deleted && map[key].taken === true;
  map[key] = wasTaken
    ? { date, suppId, deleted: true, updatedAt: now }
    : { date, suppId, taken: true, time: time || '', updatedAt: now };
  saveRawSupplementLog(map);
  return !wasTaken;
}

function addAdhocSupplementLog(date, name, time) {
  const map = getRawSupplementLog();
  const id = crypto.randomUUID();
  map[supplementLogKey(date, id)] = {
    date, adhoc: true, name, time: time || '', updatedAt: new Date().toISOString()
  };
  saveRawSupplementLog(map);
}

function deleteSupplementLogEntry(key) {
  const map = getRawSupplementLog();
  if (!map[key]) return;
  map[key] = { date: map[key].date, deleted: true, updatedAt: new Date().toISOString() };
  saveRawSupplementLog(map);
}

function mergeSupplementLog(mapA, mapB) {
  const merged = { ...mapA };
  Object.entries(mapB).forEach(([key, r]) => {
    const prev = merged[key];
    if (!prev || (r.updatedAt || '') > (prev.updatedAt || '')) merged[key] = r;
  });
  return merged;
}
```

### Krok 1.5 — eksport / import / czyszczenie

1. W `exportData()` dodaj do zwracanego obiektu:
   `supplements: getRawSupplements(), supplementLog: getRawSupplementLog()`.
2. W `importData(data, mode)` dodaj (analogicznie do bloku `analysisGoals`/`dailyAnalyses`):

```js
if (data.supplements) {
  saveSupplements(mode === 'replace' ? data.supplements : mergeSupplements(getRawSupplements(), data.supplements));
}
if (data.supplementLog) {
  saveRawSupplementLog(mode === 'replace' ? data.supplementLog : mergeSupplementLog(getRawSupplementLog(), data.supplementLog));
}
```

3. W `clearAllData()` dodaj `key === SUPPLEMENTS_KEY || key === SUPPLEMENT_LOG_KEY ||` do warunku.

### Krok 1.6 — eksponuj w `return { … }` na końcu IIFE

Dodaj: `getSupplements, getRawSupplements, saveSupplements, addSupplement, updateSupplement,
deleteSupplement, mergeSupplements, isSupplementDueOn, getRawSupplementLog, saveRawSupplementLog,
getSupplementLogForDate, isSupplementTaken, toggleSupplementTaken, addAdhocSupplementLog,
deleteSupplementLogEntry, mergeSupplementLog`.

### Kryteria akceptacji Fazy 1

W konsoli przeglądarki:
- `Storage.addSupplement({ name: 'Test', timing: 'morning', scheduleType: 'daily' })` tworzy rekord z `id` i `updatedAt`;
- `Storage.isSupplementDueOn({ scheduleType: 'cycle', cycleOn: 5, cycleOff: 2, anchorDate: '2026-08-01' }, '2026-08-06')` → `false` (dzień 5 = przerwa), a dla `'2026-08-08'` → `true` (nowy cykl);
- `Storage.toggleSupplementTaken('2026-08-03', 'x')` → `true`, drugi raz → `false`, a w mapie zostaje nagrobek;
- `Storage.exportData()` zawiera oba nowe klucze.

---

## FAZA 2 — Sync (js/firebase-sync.js + ui.js)

### Krok 2.1 — push/pull w `js/firebase-sync.js`

Wstaw po `pullDailyAnalyses`, wzór 1:1 z `pushGoals`/`pullGoals` (lista) i
`pushDailyAnalyses`/`pullDailyAnalyses` (mapa):

```js
async function pushSupplements(list) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'meta', 'supplements'), { list });
}

async function pullSupplements() {
  if (!currentUser) return [];
  const { doc, getDoc } = firestoreMod;
  const snap = await getDoc(doc(db, 'users', currentUser.uid, 'meta', 'supplements'));
  return snap.exists() ? snap.data().list || [] : [];
}

async function pushSupplementLog(map) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'meta', 'supplementLog'), { map });
}

async function pullSupplementLog() {
  if (!currentUser) return {};
  const { doc, getDoc } = firestoreMod;
  const snap = await getDoc(doc(db, 'users', currentUser.uid, 'meta', 'supplementLog'));
  return snap.exists() ? snap.data().map || {} : {};
}
```

Dodaj te 4 nazwy do obiektu `FirebaseSync` na dole pliku.

### Krok 2.2 — helpery push w `js/ui.js`

Wstaw obok `pushDailyAnalysesToCloud` (wzór 1:1):

```js
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
```

### Krok 2.3 — pełny sync

W `syncWithCloud()` w `ui.js`, bezpośrednio po bloku `remoteAnalyses`, dodaj:

```js
const remoteSupplements = await FirebaseSync.pullSupplements();
const mergedSupplements = Storage.mergeSupplements(remoteSupplements, Storage.getRawSupplements());
Storage.saveSupplements(mergedSupplements);
await FirebaseSync.pushSupplements(mergedSupplements);

const remoteSuppLog = await FirebaseSync.pullSupplementLog();
const mergedSuppLog = Storage.mergeSupplementLog(remoteSuppLog, Storage.getRawSupplementLog());
Storage.saveRawSupplementLog(mergedSuppLog);
await FirebaseSync.pushSupplementLog(mergedSuppLog);
```

### Kryteria akceptacji Fazy 2

Po zalogowaniu i kliknięciu synchronizacji w Ustawieniach: w konsoli Firestore widać dokumenty
`meta/supplements` i `meta/supplementLog`; sync nie zgłasza błędu przy pustych danych.

---

## FAZA 3 — Ukrycie i gest odblokowania

Zasada: widoczność steruje **wyłącznie** funkcja `supplementsUnlocked()`. Wszystkie miejsca
renderujące cokolwiek suplementowego zaczynają się od jej sprawdzenia.

### Krok 3.1 — stan odblokowania w `ui.js`

`sessionStorage` to wyjątek od zasady „tylko Storage.*" — stan jest celowo ulotny
i per-karta, jak preferencja motywu. Dodaj w `ui.js` (obok innych helperów):

```js
// Widoczność modułu suplementów — celowo sessionStorage: znika po zamknięciu karty,
// nie synchronizuje się i nie trafia do eksportu
function supplementsUnlocked() {
  return sessionStorage.getItem('supplementsUnlocked') === '1';
}

function toggleSupplementsUnlocked() {
  if (supplementsUnlocked()) {
    sessionStorage.removeItem('supplementsUnlocked');
  } else {
    sessionStorage.setItem('supplementsUnlocked', '1');
  }
  if (navigator.vibrate) navigator.vibrate(50);
  renderDiary();
  updateSupplementsSettingsVisibility();
}
```

### Krok 3.2 — gest: długie przytrzymanie nagłówka daty

Element gestu: `#currentDateLabel` (h2 w `.date-header` w `index.html`). Dodaj w `app.js`:

```js
// Długie przytrzymanie daty (1,5 s) odsłania/chowa moduł suplementów
let suppPressTimer = null;
const dateLabelEl = document.getElementById('currentDateLabel');
dateLabelEl.addEventListener('contextmenu', (e) => e.preventDefault());
dateLabelEl.addEventListener('pointerdown', () => {
  suppPressTimer = setTimeout(() => UI.toggleSupplementsUnlocked(), 1500);
});
['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((ev) => {
  dateLabelEl.addEventListener(ev, () => clearTimeout(suppPressTimer));
});
```

Uwaga: `pointermove` kasuje timer, żeby scroll zaczęty na dacie nie odblokowywał modułu.

### Krok 3.3 — CSS

W `css/style.css` dodaj:

```css
/* Gest długiego przytrzymania na dacie — bez menu kontekstowego i zaznaczania */
.date-header h2 {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
```

### Kryteria akceptacji Fazy 3

- Przytrzymanie daty 1,5 s → wibracja (na telefonie) i ponowny render dziennika; drugi raz — schowanie.
- Krótkie tapnięcie, scroll zaczęty na dacie ani klik strzałek ‹ › **nie** przełączają stanu.
- Po przeładowaniu strony moduł jest zawsze schowany.
- Długie przytrzymanie nie otwiera menu kontekstowego na Androidzie.

---

## FAZA 4 — Checklista w widoku dnia

### Krok 4.1 — kontener w `index.html`

W `view-dziennik`, bezpośrednio **po** `<div id="dailyAnalysesSection"></div>`, dodaj:

```html
<div id="supplementsSection"></div>
```

### Krok 4.2 — render w `ui.js`

Nowa funkcja (obok `renderDailyAnalysesSection`); wywołaj ją na końcu `renderDiary()`,
zaraz po `renderDailyAnalysesSection();`:

```js
const TIMING_LABELS = { morning: 'Rano', noon: 'Południe', evening: 'Wieczorem', any: 'Dowolna pora' };
const TIMING_ORDER = ['morning', 'noon', 'evening', 'any'];

function renderSupplementsSection() {
  const container = document.getElementById('supplementsSection');
  if (!container) return;
  if (!supplementsUnlocked()) {
    container.innerHTML = '';
    return;
  }

  const due = Storage.getSupplements().filter((s) => Storage.isSupplementDueOn(s, currentDate));
  const adhoc = Storage.getSupplementLogForDate(currentDate).filter((r) => r.adhoc);

  let itemsHtml = '';
  TIMING_ORDER.forEach((timing) => {
    const group = due.filter((s) => (s.timing || 'any') === timing);
    if (group.length === 0) return;
    itemsHtml += `<div class="supp-group-label">${TIMING_LABELS[timing]}</div>`;
    itemsHtml += group.map((s) => {
      const taken = Storage.isSupplementTaken(currentDate, s.id);
      const stockHtml = s.stock != null
        ? `<span class="supp-stock${s.stock <= 7 ? ' supp-stock-low' : ''}">zapas: ${s.stock}</span>`
        : '';
      return `
        <div class="supp-item${taken ? ' taken' : ''}" data-supp-id="${s.id}">
          <span class="supp-check">${taken ? '✓' : ''}</span>
          <span class="supp-name">${escapeHtml(s.name)}${s.dose ? ` <span class="supp-dose">${escapeHtml(s.dose)}</span>` : ''}</span>
          ${stockHtml}
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
    el.addEventListener('click', () => toggleSupplementCheck(el.dataset.suppId));
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

// Wpis doraźny — celowo prosty prompt(), bez nowego modalu
function openAdhocSuppPrompt() {
  const name = prompt('Nazwa leku / suplementu (np. Ibuprofen 200 mg):');
  if (!name || !name.trim()) return;
  Storage.addAdhocSupplementLog(currentDate, name.trim(), nowTimeStr());
  pushSupplementLogToCloud();
  renderSupplementsSection();
  showToast('Zapisano');
}
```

Dodaj `toggleSupplementsUnlocked` do obiektu `return { … }` UI na końcu `ui.js`
(pozostałe funkcje są wołane tylko wewnętrznie).

### Krok 4.3 — CSS checklisty

Dodaj w `css/style.css` (kolory przez istniejące zmienne CSS motywu — sprawdź nazwy
zmiennych na górze pliku i użyj tych samych, których używają `.entry-card` i `.hint`):

```css
.supp-group-label { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; opacity: .6; margin: 10px 0 4px; }
.supp-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; cursor: pointer; }
.supp-item .supp-check { width: 22px; height: 22px; border: 2px solid currentColor; border-radius: 50%; opacity: .4; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
.supp-item.taken .supp-check { opacity: 1; }
.supp-item.taken .supp-name { opacity: .55; text-decoration: line-through; }
.supp-dose { font-size: 12px; opacity: .6; }
.supp-stock { margin-left: auto; font-size: 11px; opacity: .5; }
.supp-stock-low { color: #e05555; opacity: 1; }
.supp-name { min-width: 0; }
```

### Kryteria akceptacji Fazy 4

- Przy zablokowanym module sekcja to pusty `<div>` (sprawdź w devtools — zero tekstu).
- Po odblokowaniu: suplementy pogrupowane po porze dnia, tap = odhaczenie (kółko ✓,
  przekreślenie), drugi tap = cofnięcie.
- Odhaczenie przy ustawionym `stock` zmniejsza zapas o 1, cofnięcie zwiększa; przy `stock <= 7`
  liczba jest czerwona.
- Nawigacja na wczorajszy dzień pozwala odhaczyć wstecz.
- „+ Doraźnie" dodaje wpis z nazwą i godziną; × usuwa go (nagrobek).

---

## FAZA 5 — Zarządzanie listą w Ustawieniach

Wzór 1:1: akordeon „Cele analizy dnia" w `index.html` + `renderGoalsList`/`openGoalModal`/
`saveGoalFromForm` w `ui.js` + podpięcia w `app.js`.

### Krok 5.1 — akordeon w `index.html`

Za akordeonem „Cele analizy dnia" dodaj (z atrybutem `hidden`!):

```html
<details class="settings-accordion" id="supplementsAccordion" hidden>
  <summary>Suplementy i leki</summary>
  <div class="settings-accordion-body">
    <div id="supplementsList"></div>
    <button class="btn btn-secondary" id="newSupplementBtn" style="margin-top:10px;">+ Nowy suplement</button>
  </div>
</details>
```

### Krok 5.2 — modal w `index.html`

Skopiuj strukturę modalu celu (`goalModalOverlay`) i dostosuj pola. ID: `suppModalOverlay`,
`suppModalTitle`, `suppFormError`, `cancelSuppBtn`, `saveSuppBtn` oraz pola:

- `suppName` (text, wymagane), `suppDose` (text), `suppNotes` (text),
- `suppTiming` (`<select>`: `morning` Rano / `noon` Południe / `evening` Wieczorem / `any` Dowolna pora),
- `suppScheduleType` (`<select>`: `daily` Codziennie / `weekdays` Wybrane dni tygodnia / `everyN` Co N dni / `cycle` Cykl (np. 5 dni / 2 przerwy)),
- `suppScheduleDaysRow` — rząd 7 checkboxów Pn…Nd z `data-dow="1"…"6","0"` (kolejność wyświetlania Pn=1 … So=6, Nd=0),
- `suppScheduleNRow` — input number `suppScheduleN` (min 2),
- `suppCycleRow` — dwa inputy number `suppCycleOn`, `suppCycleOff` (min 1 / min 0),
- `suppStock` (number, puste = nie śledzimy zapasu),
- `suppActive` (checkbox „Aktywny").

Rzędy `suppScheduleDaysRow`/`suppScheduleNRow`/`suppCycleRow` mają `hidden` i są pokazywane
zależnie od wyboru w `suppScheduleType` (listener `change` → pokaż właściwy rząd).

### Krok 5.3 — funkcje w `ui.js`

Analogicznie do celów: `renderSupplementsList()` (lista z Edytuj/×, potwierdzenie
`confirm('Usunąć? Historia przyjęć pozostanie.')`), `openSupplementModal(id)`,
`closeSupplementModal()`, `saveSupplementFromForm()` (walidacja: nazwa wymagana; dla
`weekdays` min 1 dzień; dla `everyN` N ≥ 2; dla `cycle` on ≥ 1, off ≥ 0 — komunikaty po
polsku do `suppFormError`). Po zapisie/usunięciu: `pushSupplementsToCloud()`,
`renderSupplementsList()`, `renderSupplementsSection()`.

Do tego widoczność akordeonu:

```js
function updateSupplementsSettingsVisibility() {
  const acc = document.getElementById('supplementsAccordion');
  if (acc) acc.hidden = !supplementsUnlocked();
}
```

Wywołaj `updateSupplementsSettingsVisibility()` na końcu `renderSettings()` oraz — jak już
jest w Kroku 3.1 — w `toggleSupplementsUnlocked()`. `renderSupplementsList()` wywołaj
w tych samych miejscach co `renderGoalsList()`.

### Krok 5.4 — podpięcia w `app.js`

Analogicznie do bloku „Cele analizy dnia": `newSupplementBtn` → `UI.openSupplementModal()`,
`cancelSuppBtn`, `saveSuppBtn`, klik w tło `suppModalOverlay`, `Escape` (dopisz do istniejącego
łańcucha `keydown`), listener `change` na `suppScheduleType`.

Eksponuj w `return` UI: `openSupplementModal`, `closeSupplementModal`, `saveSupplementFromForm`.

### Kryteria akceptacji Fazy 5

- Przy zablokowanym module akordeon jest niewidoczny w Ustawieniach.
- Dodanie suplementu z każdym z 4 typów harmonogramu działa i checklista w dzienniku
  pokazuje go tylko we właściwe dni (sprawdź nawigacją po dniach).
- Edycja i usunięcie działają; po usunięciu wpisy historyczne w dzienniku przyjęć zostają
  (nagrobek definicji nie kasuje logu).
- Pauza (odznaczenie „Aktywny") chowa suplement z checklisty bez usuwania.

---

## FAZA 6 — Finalizacja (obowiązkowa, wg docs/MAINTENANCE.md)

1. **Bump cache:** w `sw.js` podnieś `CACHE_NAME` o 1 (np. `licznik-kalorii-v39` → `v40`).
   W `index.html` podnieś widoczną etykietę wersji w nagłówku Ustawień (np. `v38` → `v39`).
   Nowych plików nie ma, więc `APP_SHELL` bez zmian.
2. **`docs/CHANGELOG.md`:** dopisz wpis o module suplementów (z datą).
3. **`PLAN.md`:** zaktualizuj sekcję „Stan realizacji".
4. **`docs/ARCHITECTURE.md`:** dopisz klucze `supplements`, `supplementLog` i dokumenty
   `meta/supplements`, `meta/supplementLog` do opisu modelu danych.
5. **Test ręczny w przeglądarce (pełna ścieżka):**
   - odblokuj gestem → dodaj suplement (codziennie, rano) → odhacz → przeładuj stronę →
     moduł schowany → odblokuj → odhaczenie przetrwało;
   - eksport danych → plik JSON zawiera `supplements` i `supplementLog`;
   - wyczyść dane → import pliku → suplementy i odhaczenia wróciły;
   - dodaj zwykły wpis posiłku i sprawdź, że dziennik, sumy i sync działają jak przed zmianą.

## Poza zakresem (nie implementuj, nawet jeśli wydaje się proste)

- Powiadomienia/przypomnienia (brak backendu — niewykonalne poprawnie).
- Doliczanie kcal z suplementów do sum dnia.
- Statystyki compliance w Historii.
- Skan etykiety suplementu przez Gemini.
- Szyfrowanie danych suplementów (ukrycie jest tylko wizualne — to świadoma decyzja).
