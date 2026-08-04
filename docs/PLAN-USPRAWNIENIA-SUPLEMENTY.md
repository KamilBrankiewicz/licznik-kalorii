# Plan implementacji: usprawnienia modułu suplementów

> Dokument dla modelu LLM (Sonnet) wdrażającego zmiany. Wykonuj fazy **po kolei**, nie łącz
> ich w jeden krok. Po każdej fazie przejdź jej kryteria akceptacji. Zanim zaczniesz,
> przeczytaj `CLAUDE.md` (zasady nienaruszalne) — ten plan z nich korzysta i żadnego punktu
> nie uchyla. Moduł suplementów już istnieje i działa — ten plan go **poprawia**, niczego
> nie buduje od zera. Historia powstania modułu: `docs/PLAN-MODUL-SUPLEMENTY.md` (kontekst,
> nie zadanie).

## Cel zmian (6 usprawnień)

1. **`escapeHtml` nie escapuje cudzysłowów** — nazwa z `"` psuje atrybuty HTML (np.
   `data-adhoc-name="..."`).
2. **Szybkie chipy leków doraźnych (`adhocQuickItems`) łamią zasady projektu** — brak
   nagrobków, brak `updatedAt`, brak synca, brak eksportu/importu, brak w `clearAllData`.
3. **Zapas (`stock`) rozjeżdża się między urządzeniami** — bieżący stan jest nadpisywany
   przy każdym odhaczeniu przez `updateSupplement`, a merge definicji jest per-rekord.
   Zamiana na model „baza + data" liczony z logu dawek.
4. **Mądrzejszy alarm zapasu** — zamiast sztywnego progu „≤ 7 sztuk" pokazuj „zapas na
   X dni (do DD.MM)" wyliczone z harmonogramu; alarm gdy ≤ 7 **dni**.
5. **Dokument Firestore `meta/supplementLog` rośnie bez ograniczeń** (limit 1 MB) —
   sharding po miesiącach + debounce pusha.
6. **UX i wydajność renderu** — edycja godziny dawki przez `<input type="time">` zamiast
   `prompt()`, możliwość edycji godziny wpisu doraźnego, jednokrotny odczyt logu na render.

## Twarde ograniczenia (przeczytaj dwa razy)

1. **Żadnych nowych plików JS, bibliotek, npm, bundlera.** Cały kod idzie do istniejących
   plików: `js/storage.js`, `js/firebase-sync.js`, `js/ui.js`, `js/app.js`, `index.html`,
   `css/style.css`, `sw.js`.
2. **Wszystkie stringi UI po polsku.**
3. `ui.js` nigdy nie woła `localStorage` bezpośrednio — tylko przez `Storage.*`.
4. Usuwanie zawsze przez nagrobek `{ ..., deleted: true, updatedAt }`.
5. Każdy zapis rekordu ustawia `updatedAt: new Date().toISOString()`.
6. **Zmiany modelu danych wstecznie zgodne** — w localStorage leżą stare rekordy
   (np. definicje z polem `stock`, wpisy logu ze starym formatem `time`/`count`,
   chipy bez `updatedAt`). Odczyt musi je obsłużyć; żadnych migracji niszczących.
7. **Nie zmieniaj wpisów posiłków** (`entries_*`) ani niczego poza modułem suplementów —
   wyjątek: `escapeHtml` w Fazie 1 (funkcja globalna, zmiana celowa).
8. Nie dodawaj funkcji „przy okazji". Zakres = ten dokument.

---

## FAZA 1 — `escapeHtml` escapuje cudzysłowy

W `js/ui.js` (~linia 413) podmień implementację opartą o `div.innerHTML` na czyste
podmiany — dotychczasowa nie escapuje `"` ani `'`, a funkcja jest używana w atrybutach:

```js
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

### Kryteria akceptacji Fazy 1

- Dodanie leku doraźnego o nazwie `Test "cudzysłów" & <b>` renderuje chip i wpis w logu
  poprawnie (tekst widoczny 1:1, brak rozjechanego HTML, klik w chip działa).
- Zwykłe nazwy (polskie znaki) renderują się jak dotąd.

---

## FAZA 2 — `adhocQuickItems`: nagrobki, merge, sync, eksport

Wzór 1:1: sekcja ulubionych produktów / celów w `storage.js` (lista z nagrobkami
i merge po `updatedAt`).

### Krok 2.1 — `js/storage.js`

1. Dodaj stałą obok pozostałych: `const ADHOC_QUICK_KEY = 'adhocQuickItems';` i użyj jej
   w istniejących `getAdhocQuickItems`/`saveAdhocQuickItems` (dziś literal).
2. Przerób funkcje (identyczność rekordu = `name.toLowerCase()`):

```js
function getRawAdhocQuickItems() {
  try { return JSON.parse(localStorage.getItem(ADHOC_QUICK_KEY)) || []; }
  catch { return []; }
}

function getAdhocQuickItems() {
  return getRawAdhocQuickItems().filter((i) => !i.deleted);
}

function addAdhocQuickItem(name) {
  const normalized = name.trim();
  if (!normalized) return;
  const items = getRawAdhocQuickItems();
  const now = new Date().toISOString();
  const idx = items.findIndex((i) => i.name.toLowerCase() === normalized.toLowerCase());
  if (idx !== -1) {
    items[idx] = { name: items[idx].deleted ? normalized : items[idx].name, usedAt: now, updatedAt: now };
  } else {
    items.push({ name: normalized, usedAt: now, updatedAt: now });
  }
  saveAdhocQuickItems(items);
}

function removeAdhocQuickItem(name) {
  const now = new Date().toISOString();
  const items = getRawAdhocQuickItems().map((i) =>
    i.name.toLowerCase() === name.toLowerCase() ? { name: i.name, deleted: true, updatedAt: now } : i
  );
  saveAdhocQuickItems(items);
}

function mergeAdhocQuickItems(listA, listB) {
  const byName = new Map();
  [...listA, ...listB].forEach((i) => {
    const key = (i.name || '').toLowerCase();
    const prev = byName.get(key);
    const ts = i.updatedAt || i.usedAt || '';
    const prevTs = prev ? (prev.updatedAt || prev.usedAt || '') : '';
    if (!prev || ts > prevTs) byName.set(key, i);
  });
  return [...byName.values()];
}
```

Uwaga wsteczna zgodność: stare rekordy mają tylko `{ name, usedAt }` — merge używa
`usedAt` jako fallbacku znacznika, filtr `!i.deleted` je przepuszcza. Nic nie migruj.

3. `exportData()`: dodaj `adhocQuickItems: getRawAdhocQuickItems()`.
4. `importData(data, mode)`: dodaj blok analogiczny do `supplements`:
   `saveAdhocQuickItems(mode === 'replace' ? data.adhocQuickItems : mergeAdhocQuickItems(getRawAdhocQuickItems(), data.adhocQuickItems))`
   (pod warunkiem `if (data.adhocQuickItems)`).
5. `clearAllData()`: dopisz `key === ADHOC_QUICK_KEY ||` do warunku.
6. Eksponuj w `return { … }`: `getRawAdhocQuickItems`, `saveAdhocQuickItems`,
   `mergeAdhocQuickItems` (obok już eksponowanych `getAdhocQuickItems`,
   `addAdhocQuickItem`, `removeAdhocQuickItem`).

### Krok 2.2 — `js/firebase-sync.js`

Wzór 1:1 z `pushFavorites`/`pullFavorites`; dokument `users/{uid}/meta/adhocQuickItems`
→ `{ list }`. Nazwy: `pushAdhocQuickItems(list)`, `pullAdhocQuickItems()`. Dodaj obie do
obiektu `FirebaseSync` na dole pliku.

### Krok 2.3 — `js/ui.js`

1. Helper obok `pushSupplementsToCloud` (wzór 1:1):

```js
function pushAdhocQuickItemsToCloud() {
  if (window.FirebaseSync && FirebaseSync.isSignedIn()) {
    FirebaseSync.pushAdhocQuickItems(Storage.getRawAdhocQuickItems()).catch(() => showToast('Błąd synchronizacji leków doraźnych'));
  }
}
```

2. Wywołaj go po każdej mutacji chipów: w `renderAdhocSupplementsSection` po
   `Storage.removeAdhocQuickItem(...)`, oraz po każdym `Storage.addAdhocSupplementLog(...)`
   (które wewnętrznie woła `addAdhocQuickItem` — push chipów dołóż obok istniejącego
   `pushSupplementLogToCloud()`).
3. W `syncWithCloud()`, po bloku `remoteSuppAnalyses`, dodaj blok pull→merge→save→push
   analogiczny do suplementów, z użyciem `FirebaseSync.pullAdhocQuickItems()`,
   `Storage.mergeAdhocQuickItems`, `Storage.saveAdhocQuickItems`,
   `FirebaseSync.pushAdhocQuickItems`.

### Kryteria akceptacji Fazy 2

- Usunięcie chipa zostawia w localStorage nagrobek `{ name, deleted: true, updatedAt }`
  (sprawdź w devtools), a chip znika z UI.
- Ponowne dodanie leku o tej samej nazwie (inna wielkość liter) „wskrzesza" chip — jeden
  rekord, nie duplikat.
- `Storage.exportData()` zawiera `adhocQuickItems`; import po wyczyszczeniu danych
  przywraca chipy.
- Po syncu w konsoli Firestore widać dokument `meta/adhocQuickItems`.

---

## FAZA 3 — Zapas: model „baza + data" + alarm w dniach

Zasada: **bieżący zapas nie jest już przechowywany — jest wyliczany** z pary
`stockBaseline`/`stockBaselineDate` minus dawki z logu. Log ma merge per-wpis, więc
odhaczenia z dwóch urządzeń przestają się gubić.

### Krok 3.1 — model danych definicji

Nowe pola definicji suplementu: `stockBaseline` (number | null),
`stockBaselineDate` (string `YYYY-MM-DD`). Stare pole `stock` zostaje w starych rekordach
(wsteczna zgodność), nowy kod go **nie zapisuje**.

### Krok 3.2 — `js/storage.js`: wyliczanie zapasu

Wstaw po `isSupplementDueOn`:

```js
// Bieżący zapas: baza minus dawki z logu wzięte PO dacie bazy (date > stockBaselineDate).
// Zwraca mapę suppId -> liczba sztuk (tylko suplementy ze śledzonym zapasem).
function getRemainingStockMap() {
  const supps = getSupplements().filter((s) => s.stockBaseline != null || s.stock != null);
  if (supps.length === 0) return {};
  const result = {};
  supps.forEach((s) => {
    result[s.id] = { base: s.stockBaseline != null ? Number(s.stockBaseline) : Number(s.stock) || 0,
                     since: s.stockBaseline != null ? (s.stockBaselineDate || '') : '9999-12-31',
                     used: 0 };
  });
  Object.values(getRawSupplementLog()).forEach((rec) => {
    if (rec.deleted || !rec.suppId || !result[rec.suppId]) return;
    if ((rec.date || '') > result[rec.suppId].since) {
      result[rec.suppId].used += getSupplementTimes(rec).length;
    }
  });
  const out = {};
  Object.entries(result).forEach(([id, r]) => { out[id] = Math.max(0, r.base - r.used); });
  return out;
}

// Na ile dni starczy zapasu wg harmonogramu; zwraca { days, lastDate } albo null.
// Liczy od jutra, maks. 365 dni w przód. days = liczba dni od dziś do lastDate.
function getStockCoverage(supp, remaining) {
  if (remaining == null) return null;
  const perDay = Math.max(1, Number(supp.timesPerDay) || 1);
  const today = new Date().toISOString().slice(0, 10);
  let left = remaining;
  let lastDate = null;
  const d = new Date();
  for (let i = 1; i <= 365 && left > 0; i++) {
    d.setDate(d.getDate() + 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (isSupplementDueOn(supp, iso)) {
      left -= perDay;
      lastDate = iso;
    }
  }
  return { days: lastDate ? daysBetween(today, lastDate) : 0, lastDate };
}
```

Uwaga dla implementującego: `getSupplementTimes` i `daysBetween` już istnieją w pliku.
Kontrakt: iteracja po kolejnych dniach kalendarzowych od jutra, odejmowanie `perDay`
w dni, w które `isSupplementDueOn` zwraca `true`; `lastDate` = ostatni dzień, na który
starczyło pełnej lub częściowej dawki; `days` = `daysBetween(dziś, lastDate)`, maks. 365.

Stary rekord (tylko `stock`, bez `stockBaseline`): traktowany jako baza z `since`
w przyszłości, czyli **żadna dawka nie jest odejmowana** — wartość wyświetla się jak
zamrożona do czasu pierwszej edycji w formularzu (Krok 3.4). To celowe: prosto
i bez migracji w tle.

Eksponuj: `getRemainingStockMap`, `getStockCoverage`.

### Krok 3.3 — `js/ui.js`: usuń ręczne korekty zapasu

W `toggleSupplementCheck` i `incrementSupplementDose` (wersja w `ui.js`) oraz w handlerze
`delete-dose` w `renderSupplementsSection` **usuń wszystkie bloki**
`if (supp && supp.stock != null) { ... Storage.updateSupplement(...); pushSupplementsToCloud(); }`.
Po zmianie te funkcje dotykają wyłącznie logu (`toggleSupplementTaken` /
`incrementSupplementDose` / `removeSupplementDose` + `pushSupplementLogToCloud()` + render).

### Krok 3.4 — `js/ui.js`: formularz

W `openSupplementModal`: pole `suppStock` wypełniaj **wyliczonym** zapasem
(`Storage.getRemainingStockMap()[supp.id]`, puste gdy brak śledzenia). Zmień label pola
w `index.html` na „Aktualny zapas (szt.)" z hintem „puste = nie śledzimy zapasu".

W `saveSupplementFromForm`: zamiast `stock` zapisuj:

- pole puste → `{ stockBaseline: null, stockBaselineDate: null, stock: null }`;
- pole z liczbą różną od aktualnie wyliczonego zapasu (albo zapas dotąd nieśledzony /
  rekord miał tylko stare `stock`) → `{ stockBaseline: wartość, stockBaselineDate: dzisiejsza data, stock: null }`;
- pole z liczbą równą wyliczonemu zapasowi → nie nadpisuj pól bazy (zostaw jak są).

Dzisiejsza data = `new Date().toISOString().slice(0, 10)` — dawki liczone są od **jutra**
(`date > stockBaselineDate`), bo użytkownik podaje stan „na teraz", po dzisiejszych dawkach.

### Krok 3.5 — `js/ui.js`: wyświetlanie + alarm w dniach

W `renderSupplementsSection` (karta suplementu): pobierz raz `Storage.getRemainingStockMap()`
przed pętlą. Dla suplementu ze śledzonym zapasem pokaż:

- `zapas: N szt. · na X dni (do DD.MM)` — gdy `getStockCoverage` zwraca `lastDate`
  (format `DD.MM` z `lastDate`);
- `zapas: N szt.` — gdy coverage nie da się policzyć;
- klasa alarmowa `supp-stock-low` gdy `days <= 7` **lub** `N === 0` (zamiast dzisiejszego
  warunku `s.stock <= 7`).

To samo w `renderSupplementsList` (lista w akordeonie ustawień), jeśli pokazuje zapas.

### Kryteria akceptacji Fazy 3

- Odhaczenie dawki zmniejsza wyświetlany zapas o 1, cofnięcie odhaczenia przywraca —
  **bez** żadnego wywołania `Storage.updateSupplement` (sprawdź w kodzie i w localStorage:
  `updatedAt` definicji nie zmienia się przy odhaczaniu).
- Suplement „co 3 dni", zapas 6 szt., 1×dziennie → karta pokazuje ok. 18 dni pokrycia
  i nie jest czerwona; suplement codzienny 3×dziennie, zapas 6 szt. → 2 dni, czerwony.
- Edycja w formularzu: wpisanie nowej liczby ustawia `stockBaseline`/`stockBaselineDate`
  i `stock: null`; wyczyszczenie pola wyłącza śledzenie.
- Stary rekord z samym `stock` pokazuje tę wartość (zamrożoną) i po pierwszej edycji
  przechodzi na nowy model.

---

## FAZA 4 — Sharding logu po miesiącach + debounce pusha

Model docelowy w Firestore: wpisy logu w dokumentach per-miesiąc
`users/{uid}/meta/supplementLog-YYYY-MM` → `{ map }` (podmapa wpisów, których klucz
zaczyna się od `YYYY-MM`). Miesiąc wpisu = `key.slice(0, 7)` (klucz zawsze zaczyna się
datą `YYYY-MM-DD__`). Stary dokument `meta/supplementLog` zostaje tylko do odczytu przy
pełnym syncu (dane sprzed shardingu) — po udanym pełnym syncu nadpisz go `{ map: {} }`,
żeby nie liczył się do limitu. **Lokalnie nic się nie zmienia** — localStorage dalej
trzyma jedną mapę `supplementLog`.

### Krok 4.1 — `js/firebase-sync.js`

Zastąp `pushSupplementLog`/`pullSupplementLog` trzema funkcjami:

```js
// Push wybranych miesięcy: months = ['2026-08', ...]; map = pełna lokalna mapa logu
async function pushSupplementLogMonths(map, months) {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  for (const month of months) {
    const sub = {};
    Object.entries(map).forEach(([key, rec]) => {
      if (key.slice(0, 7) === month) sub[key] = rec;
    });
    await setDoc(doc(db, 'users', currentUser.uid, 'meta', `supplementLog-${month}`), { map: sub });
  }
}

// Pull całości: wszystkie shardy + stary dokument zbiorczy (dane sprzed shardingu)
async function pullSupplementLogAll() {
  if (!currentUser) return {};
  const { collection, getDocs } = firestoreMod;
  const snapshot = await getDocs(collection(db, 'users', currentUser.uid, 'meta'));
  const result = {};
  snapshot.forEach((docSnap) => {
    if (docSnap.id === 'supplementLog' || docSnap.id.startsWith('supplementLog-')) {
      Object.assign(result, docSnap.data().map || {});
    }
  });
  return result;
}

// Wyczyszczenie starego dokumentu zbiorczego po udanej migracji na shardy
async function clearLegacySupplementLog() {
  if (!currentUser) return;
  const { doc, setDoc } = firestoreMod;
  await setDoc(doc(db, 'users', currentUser.uid, 'meta', 'supplementLog'), { map: {} });
}
```

W obiekcie `FirebaseSync` podmień `pushSupplementLog`/`pullSupplementLog` na
`pushSupplementLogMonths`, `pullSupplementLogAll`, `clearLegacySupplementLog`.

### Krok 4.2 — `js/ui.js`: debounce + push per-miesiąc

Zastąp `pushSupplementLogToCloud()`:

```js
// Push logu: debounce 2 s, zbiera dotknięte miesiące; month = 'YYYY-MM'
let suppLogPushTimer = null;
const suppLogPendingMonths = new Set();

function pushSupplementLogToCloud(month) {
  suppLogPendingMonths.add(month || currentDate.slice(0, 7));
  clearTimeout(suppLogPushTimer);
  suppLogPushTimer = setTimeout(flushSupplementLogPush, 2000);
}

function flushSupplementLogPush() {
  clearTimeout(suppLogPushTimer);
  suppLogPushTimer = null;
  if (suppLogPendingMonths.size === 0) return;
  if (!(window.FirebaseSync && FirebaseSync.isSignedIn())) { suppLogPendingMonths.clear(); return; }
  const months = [...suppLogPendingMonths];
  suppLogPendingMonths.clear();
  FirebaseSync.pushSupplementLogMonths(Storage.getRawSupplementLog(), months)
    .catch(() => showToast('Błąd synchronizacji suplementów'));
}
```

Wszystkie dotychczasowe wywołania `pushSupplementLogToCloud()` zostają bez argumentu
(mutacje zawsze dotyczą `currentDate`). Dodatkowo w `app.js` dopisz flush przy chowaniu
aplikacji, żeby debounce nie zgubił ostatniego zapisu:

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') UI.flushSupplementLogPush();
});
```

Eksponuj `flushSupplementLogPush` w `return { … }` UI.

### Krok 4.3 — `js/ui.js`: pełny sync

W `syncWithCloud()` podmień blok `remoteSuppLog`:

```js
const remoteSuppLog = await FirebaseSync.pullSupplementLogAll();
const mergedSuppLog = Storage.mergeSupplementLog(remoteSuppLog, Storage.getRawSupplementLog());
Storage.saveRawSupplementLog(mergedSuppLog);
const allMonths = [...new Set(Object.keys(mergedSuppLog).map((k) => k.slice(0, 7)))];
await FirebaseSync.pushSupplementLogMonths(mergedSuppLog, allMonths);
await FirebaseSync.clearLegacySupplementLog();
```

### Kryteria akceptacji Fazy 4

- Po pełnym syncu w konsoli Firestore: dokumenty `meta/supplementLog-2026-08` (itd. po
  jednym na miesiąc z danymi), a `meta/supplementLog` ma pustą mapę.
- Kilka szybkich odhaczeń pod rząd = **jeden** zapis do Firestore po ~2 s (sprawdź
  w zakładce Network), do dokumentu bieżącego miesiąca.
- Odhaczenie wstecz na dzień z poprzedniego miesiąca pushuje dokument tamtego miesiąca.
- Zamknięcie/schowanie karty tuż po odhaczeniu nie gubi zapisu (visibilitychange flush).
- Drugie urządzenie (symulacja: wyczyść dane → zaloguj → sync) odtwarza pełny log,
  łącznie z wpisami sprzed shardingu.

---

## FAZA 5 — Edycja godzin bez `prompt()` + refactor renderu

### Krok 5.1 — `js/storage.js`: godzina wpisu doraźnego

```js
function updateSupplementLogEntryTime(key, time) {
  const map = getRawSupplementLog();
  if (!map[key] || map[key].deleted) return;
  map[key] = { ...map[key], time, updatedAt: new Date().toISOString() };
  saveRawSupplementLog(map);
}
```

Eksponuj w `return { … }`. Eksponuj też istniejące `getSupplementTimes` pod nazwą
`extractDoseTimes` (alias w `return`: `extractDoseTimes: getSupplementTimes`) — użyje go
Krok 5.3.

### Krok 5.2 — `js/ui.js`: inline `<input type="time">` w logu dawek

W `renderSupplementsSection`, w handlerze kliknięcia `.supp-log-entry[data-supp-id]`
(dziś `prompt(...)`): zamiast promptu podmień zawartość spana `.supp-log-time` na
`<input type="time" class="supp-time-input" value="...">` (wartość tylko gdy pasuje do
`HH:MM`, inaczej pusta), ustaw focus. Zapis na `change` i `blur` (raz — użyj flagi albo
zdejmij drugi listener): `Storage.updateSupplementDoseTime(currentDate, suppId, idx, input.value)`,
potem `pushSupplementLogToCloud()` i `renderSupplementsSection()`. `Escape` = render bez
zapisu. Analogicznie dla wpisów doraźnych (`.supp-log-entry.adhoc`, dziś bez edycji):
klik w godzinę → ten sam input → `Storage.updateSupplementLogEntryTime(logKey, input.value)`.

CSS (w `css/style.css`, kolory przez istniejące zmienne motywu):

```css
.supp-time-input { width: 74px; font: inherit; background: transparent; color: inherit; border: 1px solid var(--border, currentColor); border-radius: 6px; padding: 2px 4px; }
```

(Sprawdź nazwę zmiennej obramowania na górze `style.css` i użyj tej faktycznej.)

### Krok 5.3 — `js/ui.js`: jeden odczyt logu na render

Na początku `renderSupplementsSection` pobierz log dnia **raz**:

```js
const logForDate = Storage.getSupplementLogForDate(currentDate);
const timesBySuppId = new Map(
  logForDate.filter((r) => r.suppId).map((r) => [r.suppId, Storage.extractDoseTimes(r)])
);
```

i w całej funkcji zastąp wywołania `Storage.getSupplementTakenCount(currentDate, s.id)` /
`Storage.getSupplementDoseTimes(currentDate, s.id)` odczytami z `timesBySuppId`
(`(timesBySuppId.get(s.id) || []).length` itd.). Filtr `adhoc` też licz z `logForDate`
zamiast drugiego wywołania `getSupplementLogForDate`. Handlery zdarzeń (toggle,
increment, delete) zostają na funkcjach `Storage.*` — cache jest tylko na czas renderu.

### Kryteria akceptacji Fazy 5

- Klik w godzinę dawki (planowej i doraźnej) pokazuje natywny time-picker; zapis
  aktualizuje wpis, Escape porzuca zmianę; `prompt()` nie występuje już w module
  suplementów.
- `renderSupplementsSection` woła `Storage.getSupplementLogForDate` dokładnie raz
  i nie woła `getSupplementTakenCount`/`getSupplementDoseTimes` w pętli.
- Odhaczanie, multi-dose (`x/y`), log dawek i wpisy doraźne działają jak przed zmianą.

---

## FAZA 6 — Finalizacja (obowiązkowa, wg docs/MAINTENANCE.md)

1. **Bump cache:** w `sw.js` podnieś `CACHE_NAME` (`licznik-kalorii-v54` → `v55`);
   w `index.html` podnieś etykietę wersji w Ustawieniach (`v53` → `v54`). Nowych plików
   nie ma — `APP_SHELL` bez zmian.
2. **`docs/CHANGELOG.md`:** wpis z datą opisujący wszystkie 6 usprawnień.
3. **`PLAN.md`:** zaktualizuj „Stan realizacji".
4. **`docs/ARCHITECTURE.md`:** zaktualizuj opis modelu danych — pola
   `stockBaseline`/`stockBaselineDate` (i status starego `stock`), format rekordów
   `adhocQuickItems` (`updatedAt`, nagrobki) + dokument `meta/adhocQuickItems`,
   sharding `meta/supplementLog-YYYY-MM` (stary `meta/supplementLog` = pusty, legacy).
5. **Test ręczny w przeglądarce (pełna ścieżka):**
   - odblokuj moduł gestem → odhacz kilka dawek szybko → jeden push po 2 s → przeładuj →
     stan przetrwał;
   - dodaj/usuń chip doraźny → nagrobek w localStorage → eksport → wyczyść dane →
     import → chipy i log wróciły;
   - edytuj zapas w formularzu → odhaczaj → zapas maleje bez zmiany `updatedAt` definicji;
   - pełny sync → sprawdź w Firestore shardy per-miesiąc i pusty legacy dokument;
   - dodaj zwykły wpis posiłku i sprawdź, że dziennik, sumy i sync działają jak przed
     zmianą.

## Poza zakresem (nie implementuj, nawet jeśli wydaje się proste)

- Powiadomienia o kończącym się zapasie.
- Kompakcja/usuwanie nagrobków logu (sharding rozwiązuje problem rozmiaru).
- Statystyki compliance w Historii.
- Zmiany w analizie AI suplementów (działa na tych samych funkcjach Storage — nie ruszaj).
- Migracja hurtowa starych rekordów `stock` (przechodzą na nowy model lazy, przy edycji).
