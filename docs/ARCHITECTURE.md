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
| `settings` | `Settings` | cele makro, klucz Gemini, config Firebase |
| `weights` | `{ [date]: WeightRec }` | pomiary wagi ciała |
| `favoriteProducts` | `Product[]` | przypięte produkty, z nagrobkami |
| `recipes` | `Recipe[]` | przepisy z listą składników, z nagrobkami |

```javascript
Entry = {
  id: string,          // crypto.randomUUID()
  date: "YYYY-MM-DD",
  name: string,
  kcal, protein, carbs, fat, fiber: number,
  meal: "breakfast" | "lunch" | "dinner" | "snack",
  time: "HH:MM",
  updatedAt: string    // ISO 8601
}
// nagrobek: { id, deleted: true, updatedAt }

Settings = {
  kcalGoal, proteinGoal, carbsGoal, fatGoal, fiberGoal: number,
  geminiApiKey: string,
  firebaseConfig: string   // wklejony obiekt konfiguracyjny jako tekst
}

WeightRec = { kg: number, updatedAt } | { deleted: true, updatedAt }
```

Odczyt ustawień zawsze przez `{ ...DEFAULT_SETTINGS, ...zapisane }` — dzięki temu nowe pole
w `DEFAULT_SETTINGS` automatycznie działa dla istniejących użytkowników. **Dodając nowy cel
makro, dodaj go do `DEFAULT_SETTINGS`, a nie tylko do formularza.**

### Firestore

```
users/{uid}/days/{YYYY-MM-DD}   → { entries: Entry[] }
users/{uid}/meta/settings       → Settings
users/{uid}/meta/weights        → { map: {...} }
users/{uid}/meta/favorites      → { list: [...] }
users/{uid}/meta/recipes        → { list: [...] }

sharedRecipes/{recipientUid}/inbox/{itemId} → kopia Recipe + { sharedBy: uid, sharedAt }
```

Dane dnia trzymane per-dokument, żeby push jednego dnia nie przepisywał całej historii.
Kolekcje globalne (waga, ulubione, przepisy) siedzą w `meta/` jako pojedyncze dokumenty —
są małe, a to upraszcza merge.

`sharedRecipes` jest świadomie **poza** drzewem `users/{uid}` — to skrzynka odbiorcza do
udostępniania przepisu drugiemu, niezależnemu kontu (np. partnerowi, który je te same
posiłki, ale w innej gramaturze), nie kolejna kolekcja synchronizowana między urządzeniami
tego samego użytkownika. Patrz sekcja 7.

## 4. Synchronizacja i rozwiązywanie konfliktów

Sync jest **na żądanie**, nie realtime: uruchamia się przy logowaniu i po zapisie danych.
Świadomie zrezygnowano z nasłuchiwania na żywo — jeden użytkownik, rzadko dwa urządzenia naraz.

Algorytm (`syncWithCloud` w `ui.js`):
1. `pull*` — pobierz stan z Firestore.
2. `merge*` z `storage.js` — połącz po `id`/dacie, przy konflikcie wygrywa wyższy `updatedAt`.
3. Zapisz wynik lokalnie.
4. `push*` — odeślij scalony stan do Firestore.

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
otwarciu, a poprawną kombinację dopiero przy drugim. Dlatego `CACHE_NAME` musi rosnąć przy
każdej zmianie — `activate` kasuje wtedy stare cache i wymusza świeży pobór całego shella.

Objaw zapomnianego bumpu: przyciski nie reagują, w konsoli `UI.costamNowego is not a function`.

## 6. Integracje zewnętrzne

### Gemini (`js/ocr.js`)
Endpoint `v1beta/models/gemini-flash-latest:generateContent`. Pięć zastosowań: OCR etykiety,
zrzut ekranu z innej aplikacji, zdjęcie posiłku (szacowanie porcji), transkrypcja głosowa,
parsowanie przepisu. Model proszony o czysty JSON; parser musi znieść otoczenie ` ```json `
i odpowiedź niebędącą JSON-em. Brak klucza → czytelny komunikat kierujący do Ustawień,
nie cichy błąd.

### Open Food Facts (`js/barcode.js`)
Skan przez natywny `BarcodeDetector` (brak wsparcia → ręczne wpisanie kodu). Produkt
nieznaleziony to normalny scenariusz, nie błąd — prowadź użytkownika do ręcznego wpisu.
Wartości przychodzą na 100 g i wymagają przeliczenia na gramaturę porcji.

### Firebase (`js/firebase-sync.js`)
SDK ładowany dynamicznym `import()` z `gstatic.com` (stała `FIREBASE_SDK_VERSION`) — brak
npm, brak bundlera. Config użytkownika parsowany z wklejonego tekstu przez `parseFirebaseConfig`.
Logowanie: Google popup. Na GitHub Pages domena musi być na liście autoryzowanych w konsoli Firebase.

### Web Speech API (`js/voice.js`)
Chrome/Android, wymaga HTTPS i zgody na mikrofon. Safari/iOS nie wspiera — ścieżka głosowa
musi degradować się łagodnie.

## 7. Świadome ograniczenia

Nie są to braki do „naprawienia" — to decyzje projektowe:
- brak realtime sync (sync przy logowaniu i zapisie wystarcza),
- brak wielojęzyczności,
- brak testów automatycznych (weryfikacja ręczna wg checklisty),
- brak paginacji historii (skala jednego użytkownika),
- nagrobki nigdy nie są usuwane.

**Wyjątek od zasady nagrobków — `sharedRecipes`:** ta kolekcja to jednorazowa skrzynka
odbiorcza (przepis wysłany drugiemu, niezależnemu kontu — patrz `CHANGELOG.md`, wpis
„Udostępnianie przepisów partnerowi"), nie stan replikowany między urządzeniami jednego
użytkownika. Dokument jest usuwany z Firestore od razu po imporcie; nie ma dla niej
`merge*` ani nagrobków, bo nie ma czego scalać — importowany przepis staje się zwykłym,
niezależnym wpisem w kolekcji `recipes` odbiorcy (własne `id`/`updatedAt`, dalej żyje wg
normalnych zasad tej kolekcji). Ochronę przed podwójnym importem (gdyby usunięcie ze
skrzynki się nie powiodło) daje czysto lokalny, niesynchronizowany `seenSharedRecipeIds`
w `storage.js`. Reguły bezpieczeństwa Firestore dla tej kolekcji trzeba dopisać ręcznie
w konsoli Firebase (repo nie zawiera pliku `.rules`):
```
match /sharedRecipes/{recipientUid}/inbox/{itemId} {
  allow create: if request.auth != null && request.auth.uid == request.resource.data.sharedBy;
  allow read, delete: if request.auth != null &&
    (request.auth.uid == recipientUid || request.auth.uid == resource.data.sharedBy);
}
```

Jeśli któreś ma się zmienić, to decyzja użytkownika — nie zmieniaj z własnej inicjatywy.
