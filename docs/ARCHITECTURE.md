# Architektura — Licznik Kalorii

Dokument opisuje *jak to działa i dlaczego tak*. Jeśli szukasz *co robić przy wdrożeniu* —
[MAINTENANCE.md](MAINTENANCE.md). Jeśli *co się zmieniło* — [CHANGELOG.md](CHANGELOG.md).

## 1. Zasada naczelna: localStorage jest źródłem prawdy

Aplikacja działa w pełni offline i bez konta. Firestore to **kopia zapasowa i kanał
synchronizacji**, nie baza główna. Każda operacja zapisuje najpierw lokalnie, a dopiero
potem — jeśli użytkownik jest zalogowany — próbuje wypchnąć do chmury. Nieudany push nie
może zablokować UI ani utracić danych lokalnych.

Praktyczny wzorzec w `ui.js`:

```javascript
Storage.addEntry(date, entry);   // 1. lokalnie, synchronicznie
renderDiary();                   // 2. UI od razu odświeżone
pushDayToCloud(date);            // 3. w tle, błąd tylko loguje/toastuje
```

Nie odwracaj tej kolejności i nie czekaj `await` na chmurę przed renderem.

## 2. Warstwy

```
index.html  →  app.js  →  ui.js  →  storage.js  →  localStorage
                            ↓
                 ocr.js / voice.js / barcode.js / firebase-sync.js  →  sieć
```

- **`app.js`** — jedyne miejsce z `addEventListener` na elementy statyczne z `index.html`.
  Zero logiki. Każdy handler to jedna linia delegująca do `UI.*`. Elementy generowane
  dynamicznie dostają handlery w `ui.js` w miejscu tworzenia.
- **`ui.js`** — renderowanie (funkcje `render*`), obsługa modali (`open*Modal` / `close*Modal`),
  walidacja formularzy (`save*FromForm`), integracja z modułami zewnętrznymi (`handle*`).
  Moduł IIFE zwracający obiekt `UI` na `window`.
- **`storage.js`** — jedyny właściciel localStorage. Wystawia CRUD, agregaty
  (`getDailySummary`, `getFrequentProducts`), funkcje `merge*` dla synca oraz
  eksport/import JSON. Moduł IIFE → `window.Storage`.
- **moduły zewnętrzne** — każdy hermetyzuje jedną integrację i zwraca czyste dane
  (obiekt z makrami) albo rzuca błąd z rozpoznawalnym kodem.

## 3. Model danych

### localStorage

| Klucz | Typ | Opis |
|---|---|---|
| `entries_YYYY-MM-DD` | `Entry[]` | wpisy jednego dnia, wraz z nagrobkami |
| `settings` | `Settings` | cele makro, klucz Gemini, profil zdrowotny, UID partnera, config Firebase |
| `weights` | `{ [date]: WeightRec }` | pomiary wagi ciała |
| `favoriteProducts` | `Product[]` | przypięte produkty, z nagrobkami |
| `recipes` | `Recipe[]` | przepisy z listą składników, z nagrobkami |
| `analysisGoals` | `Goal[]` | cele analizy dnia (własne system prompty), z nagrobkami; w Firestore dokument `meta/goals` |
| `dailyAnalyses` | `{ [YYYY-MM-DD__goalId]: AnalysisRec }` | raporty analizy dnia względem celu, z nagrobkami |
| `supplements` | `Supplement[]` | definicje suplementów/leków, z nagrobkami |
| `supplementLog` | `{ [YYYY-MM-DD__id]: LogRec }` | dziennik przyjęć (planowych i doraźnych), z nagrobkami; lokalnie zawsze jedna mapa — sharding dotyczy tylko Firestore, patrz niżej |
| `supplementAnalyses` | `{ [scope__endDate]: AnalysisRec }` | zapisane raporty analizy AI suplementów (dzień/tydzień/miesiąc), z nagrobkami |
| `suppAnalysisStaticCache` | `{ fingerprint, interactions, dose_totals, updatedAt }` | lokalny cache sekcji zależnych tylko od listy suplementów — **nie** synchronizowany, bez nagrobków, poza eksportem |
| `dietAnalyses` | `{ [scope__endDate]: AnalysisRec }` | zapisane raporty analizy AI diety (tydzień/miesiąc/kwartał), z nagrobkami; bez cache'u statycznego — każda sekcja zależy od danych okresu |
| `adhocQuickItems` | `AdhocQuickItem[]` | szybkie chipy leków doraźnych (nazwy ostatnio użyte), z nagrobkami |
| `geminiUsage` | `{ month, calls, usd }` | licznik zapytań i kosztu Gemini w bieżącym miesiącu — per-urządzenie, poza syncem i eksportem |
| `themePreference`, `historyMetricPreference` | string | preferencje per-urządzenie, poza syncem |

```javascript
Entry = {
  id: string,          // crypto.randomUUID()
  date: "YYYY-MM-DD",
  name: string,
  kcal, protein, carbs, fat, fiber: number,
  meal: "sniadanie" | "obiad" | "kolacja" | "przekaska", // brak → kategoria wg godziny (mealFromTime)
  grams?, source?, per100g?,
  time: "HH:MM",
  updatedAt: string    // ISO 8601
}
// nagrobek: { id, deleted: true, updatedAt }

Settings = {
  kcalGoal, proteinGoal, carbsGoal, fatGoal, fiberGoal: number,
  goalMode: 'cut'|'maintain'|'bulk',  // kierunek oceny kcal (od v65); brak = 'cut'
  geminiApiKey: string,
  healthProfile: string, partnerUid: string,
  firebaseConfig: string,  // wklejony obiekt konfiguracyjny jako tekst — per-urządzenie, NIE trafia do chmury
  updatedAt?: string       // ustawiany przy zapisie formularza; brak = rekord sprzed v64
}

WeightRec = { kg: number, smm?, bf?, updatedAt } | { deleted: true, updatedAt }

Supplement = {
  id: string, name: string, displayName?, dose?, notes?,
  timing: "morning" | "noon" | "evening" | "any",
  scheduleType: "daily" | "weekdays" | "everyN" | "cycle",
  scheduleDays?, scheduleN?, cycleOn?, cycleOff?, anchorDate: "YYYY-MM-DD",
  timesPerDay: number, active: boolean,
  stockBaseline: number | null,      // zapas wpisany w formularzu — punkt odniesienia
  stockBaselineDate: "YYYY-MM-DD" | null,  // data wpisania; dawki liczą się od dnia PO tej dacie
  stock?: number | null,             // pole legacy sprzed modelu baza+data — patrz niżej
  // pola opcjonalne (wypełniane ręcznie lub przez AI — patrz "Dodawanie AI" niżej),
  // stare rekordy ich nie mają, odczyt zawsze z domyślną wartością:
  type?: "supplement" | "medication",       // domyślnie 'supplement'
  form?: "tabletka" | "kapsułka" | "krople" | "proszek" | "płyn" | "inna",
  servingSize?: string,               // "jedna dawka" wg etykiety, np. "1 kapsułka"
  packageSize?: number | null,        // szt./porcji w opakowaniu
  brand?: string,
  ingredients?: { name: string, amount: number | null, unit: string, rws: number | null }[],
  instructions?: string,              // zalecenia przyjmowania
  warnings?: string,                  // ostrzeżenia/interakcje z etykiety
  source?: "photo" | "ai" | "manual", // jak powstał rekord
  updatedAt: string
}
// nagrobek: { id, deleted: true, updatedAt }
```

**Dodawanie AI (etykieta / wyszukiwanie po nazwie):** `Ocr.analyzeSupplementLabel(file, apiKey)`
i `Ocr.lookupSupplementByName(name, apiKey)` (w `ocr.js`) zwracają ten sam kształt JSON i
tylko wypełniają formularz suplementu (`ui.js: handleSuppLabelScan/handleSuppLookup` →
`fillSuppFormFromAiResult`) — nic nie zapisuje się bez ręcznego zatwierdzenia. Wyszukiwanie
po nazwie woła Gemini z groundingiem (`tools: [{ google_search: {} }]`); przy błędzie HTTP
jedna próba ponowna bez groundingu. `callGemini` przyjmuje trzeci opcjonalny parametr
`extraPayload` scalany z payloadem — tak dopięto `tools` bez zmiany istniejących wywołań.
```javascript

AdhocQuickItem = { name: string, usedAt: string, updatedAt: string } | { name, deleted: true, updatedAt }
// tożsamość rekordu = name.toLowerCase(); merge po updatedAt (fallback usedAt dla starych rekordów bez updatedAt)
```

**Zapas suplementu (`stockBaseline`/`stockBaselineDate` vs legacy `stock`):** bieżący zapas
nie jest już przechowywany — `Storage.getRemainingStockMap()` liczy go jako
`stockBaseline` minus liczbę dawek z `supplementLog`, których `date > stockBaselineDate`.
Odhaczanie dawek **nie** dotyka rekordu suplementu (`updatedAt` definicji się nie zmienia).
Stare rekordy sprzed tej zmiany mają tylko `stock` (bez `stockBaseline`) — traktowane jako
baza z datą w przyszłości, więc żadna dawka się nie odejmuje, dopóki użytkownik nie zapisze
suplementu ponownie w formularzu (wtedy zapis przechodzi na nowy model). Świadomie bez
migracji hurtowej. `Storage.getStockCoverage(supp, remaining)` liczy z harmonogramu, na ile
dni starczy zapasu (`{ days, lastDate }`) — alarm (`supp-stock-low`) gdy `days <= 7` lub
zapas == 0.

Odczyt ustawień zawsze przez `{ ...DEFAULT_SETTINGS, ...zapisane }` — dzięki temu nowe pole
w `DEFAULT_SETTINGS` automatycznie działa dla istniejących użytkowników. **Dodając nowy cel
makro, dodaj go do `DEFAULT_SETTINGS`, a nie tylko do formularza.**

### Firestore

```
users/{uid}/days/{YYYY-MM-DD}   → { entries: Entry[] }
users/{uid}/meta/settings       → Settings bez firebaseConfig
users/{uid}/meta/weights        → { map: {...} }
users/{uid}/meta/favorites      → { list: [...] }
users/{uid}/meta/recipes        → { list: [...] }
users/{uid}/meta/goals          → { list: [...] }        // localStorage: analysisGoals
users/{uid}/meta/supplements    → { list: [...] }
users/{uid}/meta/adhocQuickItems → { list: [...] }
// kolekcje shardowane po miesiącach (patrz niżej):
users/{uid}/meta/supplementLog-YYYY-MM      → { map: {...} }   // miesiąc z daty w kluczu
users/{uid}/meta/dailyAnalyses-YYYY-MM      → { map: {...} }   // miesiąc z daty w kluczu
users/{uid}/meta/supplementAnalyses-YYYY-MM → { map: {...} }   // miesiąc z endDate w kluczu
users/{uid}/meta/dietAnalyses-YYYY-MM       → { map: {...} }   // miesiąc z endDate w kluczu
users/{uid}/meta/{nazwa}        → { map: {} }   // legacy dokument zbiorczy sprzed shardingu, opróżniany przy syncu

sharedRecipes/{recipientUid}/inbox/{itemId} → kopia Recipe + { sharedBy: uid, sharedAt }
sharedSupplements/{recipientUid}/inbox/{itemId} → kopia pól definicji Supplement (bez
  active/stockBaseline/stockBaselineDate/anchorDate) + { sharedBy: uid, sharedAt }
```

**Tabela `META` i sharding (`ui.js`):** każda synchronizowana kolekcja w `meta/` ma wpis w
`META` (`field` list/map, `get`/`save`/`merge` ze `Storage`, `label` do komunikatów). Firestore
ma limit 1 MB na dokument, a kolekcje z nagrobkami rosną bez końca — te, które rosną z czasem
(log suplementów i trzy rodzaje raportów AI), mają funkcję `shard(klucz) → 'YYYY-MM'` i żyją
jako dokumenty `nazwa-YYYY-MM`. Lokalnie to zawsze jedna mapa. `firebase-sync.js` zna tylko
ogólne `pushMeta(docId, data)` i `pullAllMeta()` (wszystkie dokumenty meta jednym zapytaniem).

Push w trakcie pracy: `UI.pushMetaToCloud(nazwa, kluczRekordu?)` — debounce 2 s, zbiera
dotknięte kolekcje i miesiące (domyślnie miesiąc oglądanego dnia; przy usuwaniu raportu z innego
miesiąca podaj jego klucz). `visibilitychange → hidden` w `app.js` woła `UI.flushMetaPush()`, żeby
chowanie aplikacji tuż po zmianie nie zgubiło zapisu. Pull przy pełnym syncu czyta shardy **oraz**
stary dokument zbiorczy `nazwa` (dane sprzed shardingu / ze starej wersji na drugim urządzeniu),
scala i opróżnia dokument zbiorczy — bez utraty danych przy mieszanych wersjach.

Dane dnia trzymane per-dokument, żeby push jednego dnia nie przepisywał całej historii.
Kolekcje globalne (waga, ulubione, przepisy) siedzą w `meta/` jako pojedyncze dokumenty —
są małe, a to upraszcza merge.

`sharedRecipes` jest świadomie **poza** drzewem `users/{uid}` — to skrzynka odbiorcza do
udostępniania przepisu drugiemu, niezależnemu kontu (np. partnerowi, który je te same
posiłki, ale w innej gramaturze), nie kolejna kolekcja synchronizowana między urządzeniami
tego samego użytkownika. Patrz sekcja 7.

## 4. Synchronizacja i rozwiązywanie konfliktów

Sync jest **na żądanie**, nie realtime: pełny sync przy logowaniu/starcie aplikacji, a każdy zapis
wypycha w tle tylko zmienioną kolekcję/dzień.
Świadomie zrezygnowano z nasłuchiwania na żywo — jeden użytkownik, rzadko dwa urządzenia naraz.

Algorytm (`syncWithCloud` w `ui.js`):
1. `pullAllMeta` + `pullAllDays` — pobierz stan z Firestore.
2. `merge*` z `storage.js` — połącz po `id`/dacie, przy konflikcie wygrywa wyższy `updatedAt`.
3. Zapisz wynik lokalnie.
4. Push **tylko** dokumentów, w których wynik merge różni się od chmury (`sameData`, porównanie
   niezależne od kolejności kluczy). Bez tego każde otwarcie aplikacji przepisywało całą historię —
   koszt rósł z liczbą dni i zjadał darmowy limit Firestore (20 tys. zapisów/dzień).
5. Każda kolekcja we własnym `try` — błąd jednej (np. limit 1 MB) nie blokuje reszty; status
   i toast wymieniają, co się nie udało.

**Ustawienia** nie są listą rekordów, więc mają osobną regułę (`syncSettings`): wygrywa nowszy
`updatedAt`; gdy lokalnie go brak (dane sprzed v64), wygrywa chmura jak dawniej.
`firebaseConfig` nigdy nie idzie do chmury (`settingsForCloud`).

Merge jest w dwóch ogólnych funkcjach: `mergeListBy(a, b, keyOf, tsOf?)` dla list i `mergeMaps`
dla map; nazwane `merge*` to aliasy/jednolinijkowce na nich.

```javascript
function mergeEntryLists(listA, listB) {
  const byId = new Map();
  [...listA, ...listB].forEach((e) => {
    const prev = byId.get(e.id);
    if (!prev || (e.updatedAt || '') > (prev.updatedAt || '')) byId.set(e.id, e);
  });
  return [...byId.values()];
}
```

**Dlaczego nagrobki są konieczne:** bez nich urządzenie A usuwa wpis, urządzenie B nadal go
ma, merge widzi „A nie ma, B ma" i wpis wraca. Nagrobek z nowszym `updatedAt` wygrywa
z żywym rekordem i usunięcie się propaguje. Nagrobki nigdy nie są czyszczone — koszt jest
znikomy przy skali jednego użytkownika.

**Dodając nową synchronizowaną kolekcję** potrzebujesz kompletu: nagrobków przy usuwaniu,
`merge*` w `storage.js`, `push*`/`pull*` w `firebase-sync.js`, wywołania w `syncWithCloud`,
obsługi w eksporcie/imporcie JSON.

## 5. Service worker

`sw.js`, dwie strategie:
- **nawigacja** (`request.mode === 'navigate'`) → network-first, fallback na cache.
  Nowy `index.html` dociera natychmiast.
- **zasoby** (JS/CSS/ikony) → stale-while-revalidate. Odpowiedź z cache, aktualizacja w tle.

Konsekwencja: po deployu użytkownik dostaje **nowy HTML ze starym JS** przy pierwszym
otwarciu, a poprawną kombinację dopiero przy drugim. `install` pobiera shell z
`cache: 'reload'`, żeby nowa wersja cache nie została wypełniona plikami z HTTP cache przeglądarki
(GitHub Pages: `max-age=600`). Dlatego `CACHE_NAME` musi rosnąć przy
każdej zmianie — `activate` kasuje wtedy stare cache i wymusza świeży pobór całego shella.

Objaw zapomnianego bumpu: przyciski nie reagują, w konsoli `UI.costamNowego is not a function`.

## 6. Integracje zewnętrzne

### Gemini (`js/ocr.js`)
Endpoint `v1beta/models/gemini-flash-latest:generateContent`. Zastosowania: OCR etykiety,
zrzut ekranu z innej aplikacji, zdjęcie posiłku (szacowanie porcji), transkrypcja głosowa,
parsowanie przepisu, analizy (dzień/dieta/suplementy), dane suplementu. Całe HTTP idzie przez
`requestGemini`: kody błędów (`NO_API_KEY`, `NETWORK_ERROR`, `QUOTA_EXCEEDED` dla 429,
`API_ERROR`, `PARSE_ERROR`), `responseMimeType: 'application/json'` dla wywołań JSON-owych (poza
groundingiem `google_search`, który go nie obsługuje) i zapis zużycia. Parser nadal znosi tekst wokół
JSON-a. Tekst błędu dla użytkownika zawsze z `UI.aiErrorText` / `UI.showAiError` (brak klucza →
link do Ustawień).

**Koszt zapytań:** z `usageMetadata` i `modelVersion` odpowiedzi `ocr.js` liczy koszt wg tabeli
`GEMINI_PRICES` (cennik płatnego tieru, USD/1M tokenów; audio osobno, tokeny „myślenia" jako
wyjście) i kursu `USD_PLN`. `UI.showAiToast(msg)` dokleja do toastu sukcesu drugą, drobną linijkę
„≈0,4 gr · 1,2k tok" (sumuje wywołania jednej akcji, wygasa po 60 s). Suma miesięczna
per-urządzenie (`Storage.getGeminiUsage`) jest w Ustawieniach → Klucz Gemini API. W darmowym
tierze faktyczny koszt to 0 zł — to koszt „gdyby płacić". Cennik trzeba aktualizować ręcznie
(komentarz `ponytail:` przy tabeli).

### Open Food Facts (`js/barcode.js`)
Skan przez natywny `BarcodeDetector` (brak wsparcia → ręczne wpisanie kodu). Produkt
nieznaleziony to normalny scenariusz, nie błąd — prowadź użytkownika do ręcznego wpisu.
Wartości przychodzą na 100 g i wymagają przeliczenia na gramaturę porcji.

### Firebase (`js/firebase-sync.js`)
SDK ładowany dynamicznym `import()` z `gstatic.com` (stała `FIREBASE_SDK_VERSION`) — brak
npm, brak bundlera. Config użytkownika parsowany z wklejonego tekstu przez `parseFirebaseConfig`.
Logowanie: Google popup. Na GitHub Pages domena musi być na liście autoryzowanych w konsoli Firebase.

### Web Speech API (`js/voice.js`)
Chrome/Android i Safari (`webkitSpeechRecognition`), wymaga HTTPS i zgody na mikrofon. Firefox
nie wspiera — ścieżka głosowa musi degradować się łagodnie. Dyktowanie przepisu nie używa Web Speech
API, tylko nagrania audio (`MediaRecorder`) + transkrypcji Gemini.

## 7. Świadome ograniczenia

Nie są to braki do „naprawienia" — to decyzje projektowe:
- brak realtime sync (sync przy logowaniu i zapisie wystarcza),
- brak wielojęzyczności,
- brak testów automatycznych (weryfikacja ręczna wg checklisty),
- brak paginacji historii (skala jednego użytkownika),
- nagrobki nigdy nie są usuwane.

**Wyjątek od zasady nagrobków — `sharedRecipes` i `sharedSupplements`:** te kolekcje to
jednorazowe skrzynki odbiorcze (przepis albo suplement/lek wysłany drugiemu, niezależnemu
kontu — patrz `CHANGELOG.md`, wpisy „Udostępnianie przepisów partnerowi" i „Udostępnianie
suplementów/leków partnerowi"), nie stan replikowany między urządzeniami jednego
użytkownika. Dokument jest usuwany z Firestore od razu po imporcie; nie ma dla nich
`merge*` ani nagrobków, bo nie ma czego scalać — importowana pozycja staje się zwykłym,
niezależnym wpisem w kolekcji `recipes`/`supplements` odbiorcy (własne `id`/`updatedAt`,
dalej żyje wg normalnych zasad tej kolekcji; suplement dodatkowo dostaje świeże
`active: true` i `anchorDate` dnia importu — harmonogram i zapas partner ustawia sam).
Ochronę przed podwójnym importem (gdyby usunięcie ze skrzynki się nie powiodło) daje czysto
lokalny, niesynchronizowany `seenSharedRecipeIds`/`seenSharedSupplementIds` w `storage.js`.
Reguły bezpieczeństwa Firestore dla tych kolekcji trzeba dopisać ręcznie w konsoli Firebase
(kopia referencyjna całości: `firestore.rules` w katalogu głównym repo):
```
match /sharedRecipes/{recipientUid}/inbox/{itemId} {
  allow create: if request.auth != null && request.auth.uid == request.resource.data.sharedBy;
  allow read, delete: if request.auth != null &&
    (request.auth.uid == recipientUid || request.auth.uid == resource.data.sharedBy);
}
match /sharedSupplements/{recipientUid}/inbox/{itemId} {
  allow create: if request.auth != null && request.auth.uid == request.resource.data.sharedBy;
  allow read, delete: if request.auth != null &&
    (request.auth.uid == recipientUid || request.auth.uid == resource.data.sharedBy);
}
```

Jeśli któreś ma się zmienić, to decyzja użytkownika — nie zmieniaj z własnej inicjatywy.
