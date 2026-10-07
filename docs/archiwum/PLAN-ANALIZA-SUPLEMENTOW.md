# Plan implementacji: analiza AI suplementów i leków (Gemini)

> Dokument dla modelu LLM implementującego funkcję. Wykonuj fazy **po kolei**, nie łącz ich
> w jeden krok. Po każdej fazie przejdź jej kryteria akceptacji. Zanim zaczniesz, przeczytaj
> `CLAUDE.md` (zasady nienaruszalne) oraz `docs/PLAN-MODUL-SUPLEMENTY.md` (model danych
> modułu suplementów) — ten plan z nich korzysta i żadnego punktu nie uchyla.

## Cel funkcji

Jedno wywołanie Gemini analizuje suplementację użytkownika w wybranym zakresie
(**dzień / tydzień / miesiąc**) i zwraca wielosekcyjny raport JSON:

| Sekcja | dzień | tydzień | miesiąc | Zależy od |
|---|---|---|---|---|
| `interactions` — interakcje między pozycjami | ✓ | ✓ | ✓ | tylko listy definicji |
| `dose_totals` — sumowanie substancji vs limity | ✓ | ✓ | ✓ | tylko listy definicji |
| `timing_issues` — pory dawek vs posiłki | ✓ | — | — | logu dawek + posiłków |
| `compliance` — regularność przyjmowania | — | ✓ | ✓ | logu dawek |
| `adhoc_patterns` — wzorce leków doraźnych | — | ✓ | ✓ | logu doraźnego |

Kluczowe decyzje projektowe (nie zmieniaj ich w trakcie implementacji):

1. **Jeden prompt, wiele sekcji.** Nigdy nie wysyłamy osobnych zapytań o interakcje,
   timing i dawki. Koszt tokenów siedzi w danych wejściowych, nie w liczbie zadań.
2. **Cache sekcji statycznych.** `interactions` i `dose_totals` zależą wyłącznie od listy
   definicji. Wynik trzymamy lokalnie z odciskiem (fingerprint) listy; dopóki lista się
   nie zmieni, prompt każe te sekcje pominąć, a do raportu wklejamy je z cache.
3. **Agregacja przed wysłaniem.** Surowy `supplementLog` i posiłki z miesiąca to szum.
   Tydzień i miesiąc dostają dane zagregowane w JS — prompt miesięczny ma być *mniejszy*
   niż dzienny.
4. **Funkcja jest częścią ukrytego modułu.** Cały UI analizy żyje w `view-suplementy`,
   który renderuje się tylko po odblokowaniu. Poza tym widokiem — zero śladów w DOM.

## Twarde ograniczenia (przeczytaj dwa razy)

1. **Żadnych nowych plików JS.** Kod idzie do: `js/ocr.js`, `js/storage.js`, `js/ui.js`,
   `js/firebase-sync.js`, `js/app.js`, `index.html`, `css/style.css`, `sw.js`.
2. Wszystkie stringi UI **po polsku**; każdy błąd sieci/parsowania ma czytelny polski komunikat.
3. `ui.js` nie woła `localStorage` bezpośrednio — tylko `Storage.*`.
4. Zapisane raporty: nagrobki `{ deleted: true, updatedAt }` + merge po `updatedAt`,
   wzór 1:1 z `dailyAnalyses`.
5. Każdy raport kończy się widocznym zastrzeżeniem, że to nie porada medyczna.
6. Klucz Gemini z `Storage.getSettings().geminiApiKey` — jak w `runGoalAnalysis`.

## Model danych

### Zapisane raporty: klucz localStorage `supplementAnalyses` (mapa, synchronizowana)

Klucz mapy: `"<scope>__<endDate>"`, np. `"day__2026-08-04"`, `"week__2026-08-04"`,
`"month__2026-08-04"`. `endDate` = ostatni dzień analizowanego zakresu (dla `day` — ten dzień).
Ponowna analiza tego samego zakresu **nadpisuje** rekord pod tym samym kluczem.

```js
// rekord:
{ scope: 'week', endDate: '2026-08-04', startDate: '2026-07-29',
  result: '<string: pełny JSON odpowiedzi>', updatedAt: '…ISO…' }
// nagrobek:
{ deleted: true, updatedAt: '…ISO…' }
```

Firestore: `users/{uid}/meta/supplementAnalyses` → `{ map: {...} }`.

### Cache sekcji statycznych: klucz localStorage `suppAnalysisStaticCache` (lokalny, NIE synchronizowany)

```js
{ fingerprint: '<odcisk listy>',
  interactions: [...], dose_totals: [...],   // sparsowane sekcje z ostatniej pełnej analizy
  updatedAt: '…ISO…' }
```

To cache odtwarzalny — bez nagrobków, bez merge, bez eksportu/importu, bez Firestore.
`clearAllData()` ma go usuwać.

Fingerprint listy: aktywne definicje posortowane po `id`, sklejone jako
`id:updatedAt` przez `|`. Każda edycja definicji zmienia `updatedAt`, więc odcisk łapie
zmiany nazwy/dawki/notatek automatycznie.

---

## FAZA 1 — Storage (js/storage.js)

Wzór 1:1: `getRawDailyAnalyses`/`saveDailyAnalysis`/`deleteDailyAnalysis`/`mergeDailyAnalyses`.

### Krok 1.1 — stałe

```js
const SUPPLEMENT_ANALYSES_KEY = 'supplementAnalyses';
const SUPP_STATIC_CACHE_KEY = 'suppAnalysisStaticCache';
```

### Krok 1.2 — raporty (wstaw po funkcjach `supplementLog`)

```js
// ── Raporty analizy suplementów — mapa { "scope__endDate": {...} },
// nagrobki + merge jak przy dailyAnalyses ──

function getRawSupplementAnalyses() {
  const raw = localStorage.getItem(SUPPLEMENT_ANALYSES_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveRawSupplementAnalyses(map) {
  localStorage.setItem(SUPPLEMENT_ANALYSES_KEY, JSON.stringify(map));
}

function getSupplementAnalyses() {
  return Object.entries(getRawSupplementAnalyses())
    .filter(([, r]) => !r.deleted)
    .map(([key, r]) => ({ key, ...r }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function saveSupplementAnalysis(scope, startDate, endDate, result) {
  const map = getRawSupplementAnalyses();
  map[`${scope}__${endDate}`] = {
    scope, startDate, endDate, result, updatedAt: new Date().toISOString()
  };
  saveRawSupplementAnalyses(map);
}

function deleteSupplementAnalysis(key) {
  const map = getRawSupplementAnalyses();
  if (!map[key]) return;
  map[key] = { deleted: true, updatedAt: new Date().toISOString() };
  saveRawSupplementAnalyses(map);
}

function mergeSupplementAnalyses(mapA, mapB) {
  const merged = { ...mapA };
  Object.entries(mapB).forEach(([key, r]) => {
    const prev = merged[key];
    if (!prev || (r.updatedAt || '') > (prev.updatedAt || '')) merged[key] = r;
  });
  return merged;
}
```

### Krok 1.3 — cache statyczny + fingerprint

```js
// ── Cache sekcji statycznych analizy (interakcje, sumy dawek) — lokalny, odtwarzalny ──

function getSupplementsFingerprint() {
  return getSupplements()
    .filter((s) => s.active !== false)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => `${s.id}:${s.updatedAt || ''}`)
    .join('|');
}

function getSuppStaticCache() {
  const raw = localStorage.getItem(SUPP_STATIC_CACHE_KEY);
  if (!raw) return null;
  const cache = JSON.parse(raw);
  return cache.fingerprint === getSupplementsFingerprint() ? cache : null;
}

function saveSuppStaticCache(interactions, doseTotals) {
  localStorage.setItem(SUPP_STATIC_CACHE_KEY, JSON.stringify({
    fingerprint: getSupplementsFingerprint(),
    interactions: interactions || [],
    dose_totals: doseTotals || [],
    updatedAt: new Date().toISOString()
  }));
}
```

### Krok 1.4 — eksport / import / czyszczenie

1. `exportData()`: dodaj `supplementAnalyses: getRawSupplementAnalyses()`.
   Cache statycznego **nie** eksportuj.
2. `importData(data, mode)`: blok analogiczny do `supplementLog`:

```js
if (data.supplementAnalyses) {
  saveRawSupplementAnalyses(mode === 'replace'
    ? data.supplementAnalyses
    : mergeSupplementAnalyses(getRawSupplementAnalyses(), data.supplementAnalyses));
}
```

3. `clearAllData()`: dodaj `key === SUPPLEMENT_ANALYSES_KEY || key === SUPP_STATIC_CACHE_KEY ||`.

### Krok 1.5 — eksponuj w `return { … }`

`getRawSupplementAnalyses, saveRawSupplementAnalyses, getSupplementAnalyses,
saveSupplementAnalysis, deleteSupplementAnalysis, mergeSupplementAnalyses,
getSupplementsFingerprint, getSuppStaticCache, saveSuppStaticCache`.

### Kryteria akceptacji Fazy 1

W konsoli:
- `Storage.saveSupplementAnalysis('day','2026-08-04','2026-08-04','{}')` tworzy rekord
  z `updatedAt`; `Storage.deleteSupplementAnalysis('day__2026-08-04')` zostawia nagrobek;
- `Storage.getSuppStaticCache()` → `null`; po `saveSuppStaticCache([],[])` → obiekt;
  po edycji dowolnego suplementu → znów `null`;
- `Storage.exportData()` zawiera `supplementAnalyses`, a **nie** zawiera cache.

---

## FAZA 2 — Prompt i wywołanie Gemini (js/ocr.js)

### Krok 2.1 — format odpowiedzi

Obok `GOAL_RESPONSE_FORMAT` dodaj:

```js
const SUPP_RESPONSE_FORMAT = `## Format odpowiedzi — WYŁĄCZNIE poniższy JSON, bez tekstu przed/po.
Pusta tablica jest poprawną odpowiedzią w każdej sekcji — NIE wymyślaj ustaleń, żeby wypełnić sekcje.
Sekcje oznaczone w zadaniach jako pomijane zwróć jako pustą tablicę.
{
  "interactions": [
    { "items": ["nazwa A", "nazwa B"], "severity": "info|uwaga|istotne",
      "problem": "na czym polega interakcja (1-2 zdania)",
      "advice": "co zrobić, np. 'rozdziel przyjmowanie o min. 2h'" }
  ],
  "dose_totals": [
    { "substance": "nazwa substancji", "daily_total": "łączna dawka dzienna ze wszystkich źródeł",
      "upper_limit": "górny bezpieczny limit lub null, jeśli nieznany",
      "status": "ok|blisko_limitu|przekroczenie", "sources": ["z których pozycji się sumuje"] }
  ],
  "timing_issues": [
    { "item": "nazwa", "observed": "co zaobserwowano w danych (pora dawki vs posiłki)",
      "advice": "konkretna sugestia zmiany pory" }
  ],
  "compliance": { "pct": 0, "note": "1-2 zdania o regularności; wskaż najsłabsze pozycje" },
  "adhoc_patterns": [
    { "name": "nazwa leku", "count": 0, "note": "obserwacja; przy częstym użyciu zasugeruj konsultację" }
  ],
  "summary": "2-3 zdania podsumowania całości",
  "recommendations": ["konkretna, wykonalna porada (maks. 4 pozycje)"],
  "data_gaps": ["czego zabrakło w danych, np. 'brak składu multiwitaminy'"],
  "confidence": "low|medium|high",
  "disclaimer": "krótkie zastrzeżenie: to nie porada medyczna"
}
Jeśli lista suplementów i log są puste, zwróć: {"error": "brak danych do analizy"}`;
```

### Krok 2.2 — prompt i funkcja

```js
const SUPP_SCOPE_TASKS = {
  day: `1. Interakcje między wszystkimi pozycjami (także doraźnymi i z profilem zdrowotnym).
2. Sumowanie substancji ze wszystkich źródeł vs górne bezpieczne limity.
3. Pory dawek vs posiłki z tego dnia (wchłanianie: tłuszcz, kawa, nabiał, "na czczo", odstępy między konkurującymi minerałami).
Sekcje compliance i adhoc_patterns pomiń (pusta tablica / pct 0).`,
  week: `1. Interakcje między wszystkimi pozycjami (także doraźnymi i z profilem zdrowotnym).
2. Sumowanie substancji ze wszystkich źródeł vs górne bezpieczne limity.
3. Regularność przyjmowania (compliance) na podstawie zagregowanych danych.
4. Wzorce leków doraźnych (częstotliwość, interakcje ze stałymi pozycjami).
Sekcję timing_issues pomiń (pusta tablica).`,
  month: `1. Interakcje między wszystkimi pozycjami (także doraźnymi i z profilem zdrowotnym).
2. Sumowanie substancji ze wszystkich źródeł vs górne bezpieczne limity.
3. Regularność przyjmowania (compliance) — trendy, najdłuższe przerwy.
4. Wzorce leków doraźnych w skali miesiąca (nadużywanie, powtarzalność objawów).
Sekcję timing_issues pomiń (pusta tablica).`
};

// skipStatic = sekcje interactions/dose_totals są w cache i mają być pominięte
async function analyzeSupplements(scope, payload, healthProfile, skipStatic, apiKey) {
  const profileText = (healthProfile || '').trim() || 'Nie podano.';
  const skipNote = skipStatic
    ? '\nUWAGA: sekcje interactions i dose_totals pomiń całkowicie (zwróć puste tablice) — są już policzone.'
    : '';
  const prompt = `Jesteś asystentem analizy suplementacji i leków. NIE jesteś lekarzem — przy każdej
istotnej interakcji lub przekroczeniu dawki zalecaj konsultację z lekarzem lub farmaceutą.
Odpowiadaj wyłącznie po polsku, rzeczowo i ostrożnie.

## Profil użytkownika
${profileText}

## Stałe suplementy i leki
${JSON.stringify(payload.supplements)}

## Dane z okresu (zakres: ${scope}, ${payload.startDate} – ${payload.endDate})
${JSON.stringify(payload.periodData)}

## Zadania
${SUPP_SCOPE_TASKS[scope]}${skipNote}
Raportuj TYLKO rzeczywiste ustalenia poparte danymi wejściowymi.

${SUPP_RESPONSE_FORMAT}`;
  return callGemini([{ text: prompt }], apiKey);
}
```

Dodaj `analyzeSupplements` do `return { … }` na końcu IIFE.

### Kryteria akceptacji Fazy 2

- `Ocr.analyzeSupplements('day', { supplements: [{name:'Magnez',dose:'375 mg'},{name:'Cynk',dose:'15 mg'}], startDate:'2026-08-04', endDate:'2026-08-04', periodData:{} }, '', false, KLUCZ)`
  w konsoli zwraca string, który `JSON.parse` przyjmuje i który zawiera niepustą sekcję
  `interactions` (magnez+cynk to znana para);
- to samo z `skipStatic = true` → `interactions` i `dose_totals` puste.

---

## FAZA 3 — Sync (js/firebase-sync.js + ui.js)

Wzór 1:1 z `pushSupplementLog`/`pullSupplementLog`.

1. W `js/firebase-sync.js`: `pushSupplementAnalyses(map)` / `pullSupplementAnalyses()`
   na dokumencie `users/{uid}/meta/supplementAnalyses` (`{ map }`). Dodaj obie do obiektu
   `FirebaseSync`.
2. W `ui.js`: `pushSupplementAnalysesToCloud()` obok `pushSupplementLogToCloud()`
   (toast błędu: `'Błąd synchronizacji analiz suplementów'`).
3. W `syncWithCloud()`, po bloku `remoteSuppLog`:

```js
const remoteSuppAnalyses = await FirebaseSync.pullSupplementAnalyses();
const mergedSuppAnalyses = Storage.mergeSupplementAnalyses(remoteSuppAnalyses, Storage.getRawSupplementAnalyses());
Storage.saveRawSupplementAnalyses(mergedSuppAnalyses);
await FirebaseSync.pushSupplementAnalyses(mergedSuppAnalyses);
```

### Kryteria akceptacji Fazy 3

Po syncu w konsoli Firestore widać `meta/supplementAnalyses`; sync bez błędu przy pustych danych.

---

## FAZA 4 — Agregacja danych i uruchamianie analizy (js/ui.js)

### Krok 4.1 — payload per zakres

Nowa funkcja w `ui.js` (obok `runGoalAnalysis`). Definicje idą zawsze w tej samej formie:

```js
function suppListForPrompt() {
  return Storage.getSupplements().filter((s) => s.active !== false).map((s) => ({
    nazwa: s.name, dawka: s.dose || null, notatki: s.notes || null,
    pora: s.timing || 'any', dawek_dziennie: s.timesPerDay || 1
  }));
}
```

`periodData` zależnie od zakresu (daty licz przez istniejące helpery dat; tydzień = 7 dni
wstecz od `currentDate` włącznie, miesiąc = 30 dni):

- **day** — pełny detal:
  ```js
  {
    dawki: [ { nazwa, godziny: ['08:12','14:30'] } ],          // z Storage.getSupplementDoseTimes
    dorazne: [ { nazwa, godzina } ],                            // z getSupplementLogForDate (adhoc)
    posilki: [ { nazwa, godzina, kcal, bialko_g, wegle_g, tluszcz_g } ]  // jak mealsForPrompt
  }
  ```
- **week** — agregat per suplement + surowe doraźne:
  ```js
  {
    suplementy: [ { nazwa, dni_planowych, dni_wzietych, typowe_godziny: ['08:00'] } ],
    dorazne: [ { nazwa, data, godzina } ],
    posilki_srednio: { kcal, bialko_g, wegle_g, tluszcz_g, typowe_pory: ['07:30','13:00','19:00'] }
  }
  ```
  `dni_planowych` licz iterując po datach zakresu z `Storage.isSupplementDueOn`;
  `dni_wzietych` z `Storage.getSupplementTakenCount(date, id) > 0`.
- **month** — tylko agregaty:
  ```js
  {
    suplementy: [ { nazwa, dni_planowych, dni_wzietych, najdluzsza_przerwa_dni } ],
    dorazne_zliczone: [ { nazwa, ile_razy } ]     // grupowanie po znormalizowanej nazwie (trim+lowercase)
  }
  ```
  Bez posiłków.

Doraźne do sekcji interakcji: przy **każdym** zakresie dołącz dodatkowo pole
`periodData.dorazne_30_dni: [ { nazwa, ile_razy } ]` z ostatnich 30 dni — interakcje
mają widzieć leki brane jednorazowo nawet przy analizie dziennej.

### Krok 4.2 — uruchomienie z obsługą cache

```js
async function runSupplementAnalysis(scope) {
  const apiKey = Storage.getSettings().geminiApiKey;
  const statusEl = document.getElementById('suppAnalysisStatus');
  if (!apiKey) { statusEl.textContent = 'Brak klucza Gemini — uzupełnij w Ustawieniach.'; return; }

  const supplements = suppListForPrompt();
  const payload = buildSuppAnalysisPayload(scope);   // krok 4.1
  if (supplements.length === 0 && payload.pusty) {
    statusEl.textContent = 'Brak danych do analizy.'; return;
  }

  const cache = Storage.getSuppStaticCache();
  statusEl.textContent = 'Analizuję…';
  try {
    const raw = await Ocr.analyzeSupplements(scope, { supplements, ...payload },
      Storage.getSettings().healthProfile, !!cache, apiKey);
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('PARSE_ERROR'); }
    if (parsed.error) { statusEl.textContent = 'AI: ' + parsed.error; return; }

    if (cache) {                       // wklej sekcje statyczne z cache
      parsed.interactions = cache.interactions;
      parsed.dose_totals = cache.dose_totals;
    } else {                           // świeża pełna analiza → odśwież cache
      Storage.saveSuppStaticCache(parsed.interactions, parsed.dose_totals);
    }

    Storage.saveSupplementAnalysis(scope, payload.startDate, payload.endDate, JSON.stringify(parsed));
    pushSupplementAnalysesToCloud();
    statusEl.textContent = '';
    renderSupplementAnalysesSection();
    showToast('Zapisano raport');
  } catch (e) {
    statusEl.textContent = '';
    document.getElementById('suppAnalysisError').textContent = analysisErrorMessage(e.message);
  }
}
```

Przy pierwszym uruchomieniu analizy w ogóle (brak jakiegokolwiek zapisanego raportu
i brak cache) pokaż raz `confirm('Lista suplementów i leków zostanie wysłana do Gemini API (Google). Kontynuować?')`
— rezygnacja przerywa bez zapisu.

### Krok 4.3 — UI w `index.html` + render

W `view-suplementy`, po `<div id="adhocSupplementsSection"></div>`, dodaj:

```html
<div id="supplementAnalysesSection"></div>
```

`renderSupplementAnalysesSection()` — wzór 1:1 z `renderDailyAnalysesSection`:

- nagłówek `Analiza AI` + trzy przyciski zakresu: `Dzień` / `Tydzień` / `Miesiąc`
  (styl jak `#adhocSuppBtn`), pod nimi `#suppAnalysisStatus` i `#suppAnalysisError`;
- lista zapisanych raportów z `Storage.getSupplementAnalyses()` jako karty-akordeony
  (tytuł: `Dzień 2026-08-04` / `Tydzień 2026-07-29 – 2026-08-04` / `Miesiąc …`,
  × usuwa przez `deleteSupplementAnalysis` + `confirm`);
- ciało karty: `renderSuppAnalysisBody(result)` — parsuje JSON i renderuje **tylko
  niepuste** sekcje, każda z polskim nagłówkiem: Interakcje (badge koloru wg `severity`:
  szary `info`, pomarańcz `uwaga`, czerwony `istotne`), Dawki łączne (czerwony przy
  `przekroczenie`), Pory przyjmowania, Regularność, Leki doraźne, Zalecenia, Braki w danych;
  na końcu zawsze `disclaimer` kursywą;
- błąd parsowania JSON → karta z tekstem `Nie udało się odczytać raportu.` (nie pusty DOM).

Wywołaj `renderSupplementAnalysesSection()` w `renderSupplementsView()`. Sekcja renderuje
się wyłącznie tam — `view-suplementy` jest już bramkowany odblokowaniem, więc nie trzeba
osobno sprawdzać `supplementsUnlocked()`, ale **nie wolno** przenosić sekcji do dziennika.

### Krok 4.4 — podpięcia w `app.js`

Przyciski zakresów renderowane są dynamicznie w `ui.js`, więc `app.js` nie wymaga zmian
(listenery wieszane w `renderSupplementAnalysesSection`, jak przy `adhocSuppBtn`).
Jeśli jednak coś dodasz statycznie do `index.html` — podpinaj w `app.js` wzorem reszty.

### Kryteria akceptacji Fazy 4

- Analiza `Dzień` z ≥2 suplementami zwraca raport; sekcje puste nie renderują się;
  disclaimer widoczny zawsze.
- Drugie uruchomienie (lista bez zmian) jest wyraźnie szybsze/tańsze, a interakcje w nowym
  raporcie są **identyczne** jak w pierwszym (z cache). Po edycji dowolnego suplementu
  kolejna analiza znów liczy interakcje na świeżo.
- `Tydzień`/`Miesiąc` działają przy danych z wielu dni; prompt miesięczny (podejrzyj
  w devtools/network) jest mniejszy niż dzienny przy pełnym dniu posiłków.
- Raporty przeżywają przeładowanie, synchronizują się i wracają z eksportu/importu.
- Przy zablokowanym module (przed gestem) w DOM nie ma śladu sekcji analiz.
- Brak klucza API, brak sieci, odpowiedź nie-JSON — trzy czytelne polskie komunikaty.

---

## FAZA 5 — Finalizacja (obowiązkowa, wg docs/MAINTENANCE.md)

1. **Bump cache:** `sw.js` → `CACHE_NAME` z `licznik-kalorii-v51` na `v52` (lub +1 od
   aktualnej). W `index.html` podnieś widoczną etykietę wersji w Ustawieniach. Nowych
   plików nie ma → `APP_SHELL` bez zmian.
2. **`docs/CHANGELOG.md`:** wpis o analizie AI suplementów (z datą).
3. **`PLAN.md`:** sekcja „Stan realizacji".
4. **`docs/ARCHITECTURE.md`:** dopisz klucz `supplementAnalyses` (+ lokalny
   `suppAnalysisStaticCache`) i dokument `meta/supplementAnalyses`.
5. **Test ręczny (pełna ścieżka):**
   - odblokuj moduł → analiza `Dzień` → raport widoczny → przeładuj → odblokuj → raport jest;
   - edytuj suplement → analiza ponownie → interakcje przeliczone na nowo;
   - eksport → `supplementAnalyses` w JSON; wyczyść dane → import → raporty wróciły;
   - zwykły wpis posiłku + sync działają jak przed zmianą.

## Poza zakresem (nie implementuj, nawet jeśli wydaje się proste)

- Skan opakowania suplementu (pole `sklad` w definicji) — osobny plan, po nim `dose_totals`
  zyska precyzję; format odpowiedzi już to przewiduje przez `data_gaps`.
- Automatyczne/cykliczne uruchamianie analiz (analiza tylko na żądanie — koszty i limity).
- Porównywanie raportów między okresami.
- Wysyłanie surowego `supplementLog` do Gemini (zawsze agregat wg Fazy 4).
- Jakiekolwiek sekcje analizy poza `view-suplementy` (dziennik, historia, ustawienia).
