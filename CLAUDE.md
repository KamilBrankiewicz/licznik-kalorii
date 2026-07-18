# CLAUDE.md — instrukcja dla modelu pracującego nad tym repo

> Czytaj to jako pierwsze. Szczegóły architektury: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
> Proces wdrażania zmian: [docs/MAINTENANCE.md](docs/MAINTENANCE.md).
> Historia funkcji: [docs/CHANGELOG.md](docs/CHANGELOG.md).

## Czym jest ta aplikacja

Osobisty licznik kalorii i makroskładników jako PWA. **Jeden użytkownik** (autor repo),
interfejs **wyłącznie po polsku**, koszt utrzymania **zero zł**. Hosting: GitHub Pages.

Konsekwencje tych założeń — trzymaj się ich przy każdej decyzji:
- Nie ma backendu. Firebase (Firestore + Auth Google) to jedyna usługa serwerowa i służy
  wyłącznie do synchronizacji między urządzeniami tego samego użytkownika.
- Nie ma bundlera, frameworka, npm-owych zależności ani kroku budowania. Pliki, które są
  w repo, to dokładnie te pliki, które trafiają do przeglądarki.
- Nie ma testów automatycznych. Weryfikacja jest ręczna, w przeglądarce — dlatego
  checklista w `docs/MAINTENANCE.md` jest obowiązkowa, a nie opcjonalna.
- Nie ma wielojęzyczności i nie należy jej dodawać. Wszystkie stringi UI po polsku,
  inline w kodzie.

## Stack i struktura

Vanilla JS (moduły w IIFE eksponowane na `window`), CSS mobile-first, localStorage jako
źródło prawdy, service worker dla offline.

```
index.html          # cały SPA: markup wszystkich widoków i modali
css/style.css       # style, zmienne CSS, dark/light
js/app.js           # WYŁĄCZNIE podpięcie zdarzeń DOM → wywołania UI.*
js/ui.js            # renderowanie widoków, obsługa formularzy (największy plik)
js/storage.js       # localStorage: CRUD, merge do synca, eksport/import
js/ocr.js           # wywołania Gemini API (etykieta, zrzut, zdjęcie, głos, przepis)
js/voice.js         # Web Speech API
js/barcode.js       # BarcodeDetector + Open Food Facts
js/firebase-sync.js # push/pull do Firestore + logowanie Google
sw.js               # service worker
manifest.json, icons/
```

**Podział odpowiedzialności jest twardy.** `app.js` nigdy nie zawiera logiki — tylko
`addEventListener` delegujący do `UI.*`. Logika renderowania i walidacji zawsze w `ui.js`.
Każdy dostęp do localStorage przechodzi przez `Storage.*` — nigdy `localStorage` bezpośrednio
w `ui.js`.

## Nienaruszalne zasady (łamanie ich psuje dane użytkownika)

1. **Nagrobki przy usuwaniu.** Usunięcie wpisu, wagi, ulubionego produktu czy przepisu
   NIE kasuje rekordu — zapisuje `{ id, deleted: true, updatedAt }`. Bez tego usunięcie na
   telefonie „zmartwychwstaje" po syncu z laptopa. Każda nowa kolekcja danych, która ma być
   synchronizowana, musi mieć nagrobki i własną funkcję `merge*`.

2. **`updatedAt` przy każdym zapisie.** Merge rozstrzyga konflikty przez porównanie
   `updatedAt` (ISO 8601, string compare). Rekord bez `updatedAt` przegrywa każdy konflikt.

3. **Bump `CACHE_NAME` w `sw.js` przy każdej zmianie JS/CSS/HTML.** Obecnie `licznik-kalorii-v13`
   → podnieś do `v14` itd. Service worker serwuje zasoby stale-while-revalidate, więc bez
   bumpu użytkownik dostanie stary JS przy nowym HTML — typowy objaw to „przycisk nic nie robi".

4. **Nowy plik JS musi trafić do `APP_SHELL` w `sw.js`** oraz do `<script>` w `index.html`.
   Pominięcie = aplikacja działa online i wybucha offline.

5. **Klucze API należą do użytkownika i zostają w localStorage.** Klucz Gemini i config
   Firebase wpisuje użytkownik w Ustawieniach. Nigdy nie commituj kluczy, nie wpisuj ich
   w kod, nie loguj do konsoli.

6. **Zmiana modelu danych musi być wstecznie zgodna.** W localStorage użytkownika leżą
   wpisy sprzed miesięcy. Nowe pole = wartość domyślna przy odczycie (wzorzec:
   `Number(e.fiber) || 0`, `{ ...DEFAULT_SETTINGS, ...zapisane }`), nigdy migracja
   niszcząca ani zakładanie, że pole istnieje.

## Model danych — skrót

localStorage:
- `entries_YYYY-MM-DD` → tablica wpisów
- `settings` → cele, klucz Gemini, config Firebase
- `weights` → mapa `{ "YYYY-MM-DD": { kg, updatedAt } }`
- `favoriteProducts`, `recipes` → tablice

Wpis posiłku: `{ id, date, name, kcal, protein, carbs, fat, fiber, meal, time, updatedAt }`,
gdzie `meal` ∈ `breakfast|lunch|dinner|snack`.

Firestore: `users/{uid}/days/{YYYY-MM-DD}`, `users/{uid}/meta/{settings|weights|favorites|recipes}`.

Pełny opis w [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Zewnętrzne integracje

| Integracja | Gdzie | Uwagi |
|---|---|---|
| Gemini API | `js/ocr.js` | model `gemini-flash-latest`, darmowy tier, klucz użytkownika. Odpowiedzi parsowane jako JSON — zawsze obsłuż błąd parsowania. |
| Open Food Facts | `js/barcode.js` | publiczne API, bez klucza, może nie znać kodu → fallback na ręczne wpisanie |
| Firebase | `js/firebase-sync.js` | SDK ładowane dynamicznym `import()` z gstatic, wersja w stałej `FIREBASE_SDK_VERSION` |
| Web Speech API | `js/voice.js` | tylko Chrome/Android, wymaga HTTPS |

Wszystkie cztery mogą zawieść (brak sieci, brak uprawnień, brak wsparcia przeglądarki).
Każda ścieżka musi mieć czytelny polski komunikat błędu, nie cichy `catch`.

## Zanim uznasz zadanie za skończone

Przejdź checklistę z [docs/MAINTENANCE.md](docs/MAINTENANCE.md). Minimum przy każdej zmianie:
bump `CACHE_NAME`, test w przeglądarce (dodanie wpisu + przeładowanie + sprawdzenie że dane
przetrwały), aktualizacja `docs/CHANGELOG.md` i sekcji „Stan realizacji" w `PLAN.md`.
