# Plan implementacji — Licznik Kalorii (PWA)

> **Ten plik to zakres i stan prac.** Pozostała dokumentacja:
> [CLAUDE.md](CLAUDE.md) — zasady pracy nad repo (czytaj jako pierwsze) ·
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — jak to działa ·
> [docs/MAINTENANCE.md](docs/MAINTENANCE.md) — checklista wdrożenia ·
> [docs/CHANGELOG.md](docs/CHANGELOG.md) — co i kiedy się zmieniło.

## Stan realizacji (2026-07-19)

**Zrobione:**
- ✅ Faza 1 (MVP) w całości: szkielet PWA, storage, widok dzienny, formularz ręczny, OCR etykiet (Gemini), ustawienia, nawigacja + historia
- ✅ Faza 2 w całości: eksport/import JSON, synchronizacja Firebase (Auth Google + Firestore)
- ✅ Poza pierwotnym planem:
  - Wpis głosowy przez Gemini (dyktowanie makr lub opisu jedzenia) — `js/voice.js`
  - Analiza zrzutu ekranu (makra z innej aplikacji/przepisu) przez Gemini
  - Edycja istniejących wpisów + pole godziny
  - Ostatnio używane produkty (chipy + podpowiedzi nazw z przeliczaniem /100g)
  - Skaner kodów kreskowych: natywny `BarcodeDetector` + baza Open Food Facts, fallback ręcznego wpisania kodu — `js/barcode.js`
  - Zdjęcie posiłku → szacowanie makr całej porcji przez Gemini (dawna Faza 3)
  - Wykres kcal z ostatnich 7 dni + średnie makr i "dni w celu" w widoku Historia
  - Śledzenie wagi ciała: pole w dzienniku + wykres trendu 90 dni w Historii (Faza 4)
  - Kategorie posiłków (śniadanie/obiad/kolacja/przekąska) z grupowaniem w dzienniku (Faza 4)
  - Relog — ponowne dodanie wpisu na dziś jednym tapnięciem (Faza 4)
  - Błonnik jako piąty składnik (cel, pasek, formularz, OCR/AI, Open Food Facts) (Faza 4)
  - Raport odżywczy — analiza dnia przez Gemini względem własnych, zapisanych celów (np. żelazo), z generycznym formatem wyniku (Faza 5)

**Pozostało (świadomie odłożone):**
- Wielojęzyczność — raczej bez sensu przy aplikacji dla jednego użytkownika
- Realtime sync (nasłuchiwanie zmian na żywo między urządzeniami) — obecnie sync przy logowaniu/zapisie

## Opis projektu
Osobista aplikacja PWA do śledzenia dziennego spożycia kalorii i makroskładników (białko, węglowodany, tłuszcze). Interfejs w języku polskim. Aplikacja dla jednego użytkownika, zero kosztów.

## Stack technologiczny
- **Frontend:** HTML + CSS + vanilla JavaScript (bez frameworka — prostota, szybkość, zero bundlera)
- **Dane:** localStorage (JSON)
- **OCR etykiet:** Gemini API (darmowy tier, klucz API od użytkownika)
- **Hosting:** GitHub Pages
- **PWA:** manifest.json + service worker (offline)

## Struktura plików

```
/
├── index.html          # SPA — główna strona
├── css/
│   └── style.css       # Style (mobile-first, dark/light mode)
├── js/
│   ├── app.js          # Inicjalizacja, podpięcie zdarzeń
│   ├── storage.js      # Warstwa localStorage (CRUD wpisów, merge do synca)
│   ├── ui.js           # Renderowanie widoków, obsługa formularzy
│   ├── ocr.js          # Integracja z Gemini API (etykieta, zrzut ekranu, zdjęcie posiłku, głos)
│   ├── voice.js        # Rozpoznawanie mowy (Web Speech API)
│   ├── barcode.js      # Skaner kodów kreskowych (BarcodeDetector + Open Food Facts)
│   └── firebase-sync.js # Synchronizacja Firestore + logowanie Google
├── sw.js               # Service worker (cache offline)
├── manifest.json       # PWA manifest
├── icons/              # Ikony PWA (192x192, 512x512)
└── PLAN.md
```

## Model danych

```javascript
// Pojedynczy wpis posiłku
{
  id: "uuid",
  date: "2026-07-15",       // YYYY-MM-DD
  time: "12:30",            // HH:MM
  name: "Jogurt grecki",    // nazwa produktu/posiłku
  grams: 150,               // gramatura (opcjonalna)
  kcal: 230,
  protein: 15,              // białko [g]
  carbs: 12,                // węglowodany [g]
  fat: 14,                  // tłuszcze [g]
  fiber: 3,                 // błonnik [g]
  meal: "sniadanie",        // "sniadanie" | "obiad" | "kolacja" | "przekaska"
  source: "manual"          // "manual" | "ocr"
}

// Cele dzienne (ustawienia)
{
  kcalGoal: 2000,
  proteinGoal: 150,
  carbsGoal: 200,
  fatGoal: 70,
  fiberGoal: 30,
  geminiApiKey: "..."       // klucz Gemini, przechowywany lokalnie
}

// Waga (localStorage klucz "weights")
{
  "2026-07-16": { kg: 81.2, updatedAt: "ISO" }  // usunięcia jako { deleted: true, updatedAt }
}
```

## Faza 1 — MVP (do zbudowania teraz)

### Krok 1: Szkielet PWA
- Utworzyć `index.html` z meta viewport, manifest link, rejestracja SW
- `manifest.json` z nazwą "Licznik Kalorii", kolorami, ikonami
- `sw.js` — cache-first dla plików statycznych (app shell)
- Proste ikony (można wygenerować placeholder SVG)
- **Kryterium:** apka instaluje się na telefonie przez "Dodaj do ekranu głównego"

### Krok 2: Warstwa danych (storage.js)
- `getEntries(date)` — pobranie wpisów z danego dnia
- `addEntry(entry)` — dodanie wpisu (generuje UUID)
- `updateEntry(id, data)` — edycja wpisu
- `deleteEntry(id)` — usunięcie wpisu
- `getDailySummary(date)` — suma kcal/B/W/T dla dnia
- `getSettings()` / `saveSettings(settings)` — cele + klucz API
- Dane w localStorage pod kluczami: `entries_YYYY-MM-DD`, `settings`

### Krok 3: Interfejs — widok dzienny (główny)
- **Nagłówek:** data (z nawigacją ← dzisiaj →), podsumowanie dnia (kcal i makra vs cele)
- **Paski postępu:** wizualne słupki dla kcal, B, W, T (kolor zmienia się przy przekroczeniu celu)
- **Lista wpisów:** karty z nazwą, godziną, kcal, makra — swipe lub przycisk do usunięcia
- **Przycisk "+" (FAB):** otwiera formularz dodawania
- **Design:** mobile-first, ciemny motyw domyślny, duże przyciski dotykowe (min 48px)

### Krok 4: Formularz ręcznego dodawania
- Pola: nazwa produktu, gramatura (opcjonalna), kcal, białko, węglowodany, tłuszcze
- Walidacja: kcal wymagane, makra opcjonalne (ale zachęcane)
- Przelicznik "na 100g → na porcję": jeśli user poda gramaturę, może wpisać wartości /100g a apka przeliczy
- Przycisk "Zapisz" → dodaje do dziennika, wraca do widoku dziennego

### Krok 5: Zdjęcie etykiety (ocr.js)
- Przycisk "Skanuj etykietę" w formularzu dodawania
- Otwiera aparat telefonu (`<input type="file" accept="image/*" capture="environment">`)
- Wysyła zdjęcie do Gemini API z promptem:

```
Przeanalizuj zdjęcie etykiety wartości odżywczych produktu spożywczego.
Zwróć WYŁĄCZNIE JSON w formacie:
{
  "name": "nazwa produktu jeśli widoczna, inaczej null",
  "per100g": {
    "kcal": number,
    "protein": number,
    "carbs": number,
    "fat": number
  }
}
Jeśli nie rozpoznajesz etykiety, zwróć: {"error": "nie rozpoznano etykiety"}
```

- Parsuje odpowiedź, wypełnia formularz (user weryfikuje i może edytować przed zapisaniem)
- Obsługa błędów: brak klucza API → komunikat z linkiem do ustawień, błąd sieci → komunikat
- **Ustawienia:** pole na klucz Gemini API (z instrukcją jak go zdobyć: aistudio.google.com)

### Krok 6: Widok ustawień
- Cele dzienne (kcal, białko, węglowodany, tłuszcze)
- Klucz Gemini API (pole input type=password, przycisk pokaż/ukryj)
- Instrukcja: "Wejdź na aistudio.google.com → Get API Key → Create → skopiuj klucz"
- Przycisk "Wyczyść dane" (z potwierdzeniem)

### Krok 7: Nawigacja
- Dolny pasek nawigacji (3 zakładki): Dziennik | Historia | Ustawienia
- **Historia:** lista dni z podsumowaniem kcal (prosty widok, bez wykresów na start)

## Wymagania niefunkcjonalne
- Mobile-first, responsywny (ale priorytet to ekran telefonu ~375px)
- Offline-capable (service worker cachuje app shell; dane i tak w localStorage)
- Szybki start (<1s na przeciętnym telefonie)
- Brak zewnętrznych zależności (zero npm, zero CDN) — wszystko inline/lokalne
- Polski interfejs

## Prompt dla Gemini API
Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=API_KEY`

Payload:
```json
{
  "contents": [{
    "parts": [
      {"text": "PROMPT_TUTAJ"},
      {"inline_data": {"mime_type": "image/jpeg", "data": "BASE64_ZDJECIA"}}
    ]
  }]
}
```

## Faza 2 — dodane po MVP
- **Eksport/import danych (kopia zapasowa):** przycisk w Ustawieniach eksportuje wszystkie wpisy + ustawienia do pliku JSON (`Storage.exportData()`), import scala dane z pliku z istniejącymi (dedupe po `id`, `Storage.importData()`).
- **Synchronizacja z Firebase:** logowanie Google (Firebase Auth) + Firestore jako zapasowe/synchronizowane miejsce przechowywania. localStorage pozostaje źródłem prawdy do renderowania (szybkie, offline-first); po zalogowaniu dane są scalane (union po `id`) między lokalnym storage a Firestore (`users/{uid}/days/{date}`, `users/{uid}/meta/settings`), a każdy zapis wpisu/ustawień jest też wypychany do chmury w tle. Konfiguracja `firebaseConfig` wklejana ręcznie w Ustawieniach (użytkownik zakłada własny projekt na console.firebase.google.com, włącza Authentication → Google i Firestore Database). SDK Firebase ładowany dynamicznie z CDN (gstatic.com) tylko gdy konfiguracja jest ustawiona — nie obciąża aplikacji, gdy funkcja nieużywana.
  - Zalecane reguły bezpieczeństwa Firestore:
    ```
    match /databases/{database}/documents {
      match /users/{userId}/{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
    ```

## Faza 3 — dodane po fazie 2 (2026-07-16)
- **Skaner kodów kreskowych:** przycisk w formularzu dodawania otwiera skaner — na wspieranych przeglądarkach (Chrome/Android) kamera + natywne API `BarcodeDetector` (zero zależności), w pozostałych ręczne wpisanie kodu. Dane z Open Food Facts (`/api/v2/product/{kod}.json`) jako wartości na 100 g — działają z istniejącym przelicznikiem gramatury. Moduł: `js/barcode.js`.
- **Zdjęcie posiłku → AI:** przycisk otwiera aparat, Gemini szacuje nazwę, gramaturę i makra CAŁEJ widocznej porcji (prompt `PROMPT_MEAL` w `js/ocr.js`, source: `photo`). Wartości trafiają do formularza do weryfikacji.
- **Statystyki tygodniowe:** karta "Ostatnie 7 dni" na górze Historii — słupki kcal (czerwone przy przekroczeniu celu, przerywana linia celu), średnie kcal/B/W/T oraz "dni w celu" liczone tylko z dni z wpisami. Klik w słupek/dzień przechodzi do dziennika tego dnia. Renderowanie: `renderWeeklyStats()` w `js/ui.js`, czysty HTML/CSS (bez bibliotek).

## Faza 4 — dodane po analizie rynku (2026-07-16)
- **Śledzenie wagi:** pole "⚖️ Waga" pod podsumowaniem dnia (zapis per dzień, `Storage.setWeight`), dane w localStorage pod kluczem `weights` jako mapa `{data: {kg, updatedAt}}` z nagrobkami (deleted) — ten sam mechanizm merge co wpisy. Model carry-forward: pomiar obowiązuje do następnego pomiaru — bez wpisu danego dnia pole pokazuje ostatnią znaną wagę jako placeholder z dopiskiem "ostatni pomiar dd.mm" (`Storage.getLatestWeight`); ważenie raz w tygodniu w zupełności wystarcza. Sync przez Firestore (`users/{uid}/meta/weights`). W Historii karta "Waga — ostatnie 90 dni": wykres SVG (polyline, bez bibliotek) + aktualna/zmiana/min/max.
- **Kategorie posiłków:** pole `meal` we wpisie (`sniadanie|obiad|kolacja|przekaska`), wybór segmentowany w formularzu z domyślną kategorią wg godziny (`mealFromTime`: 4–11 śniadanie, 11–16 obiad, 16–22 kolacja, reszta przekąska). Dziennik grupuje wpisy w sekcje z sumą kcal; stare wpisy bez `meal` są przypisywane wg godziny.
- **Relog:** przycisk ⟳ na karcie wpisu kopiuje go na dziś z bieżącą godziną i kategorią wg godziny — działa też z dni historycznych.
- **Błonnik:** pole `fiber` we wpisie + `fiberGoal` w ustawieniach (domyślnie 30 g). Czwarty pasek w podsumowaniu dnia, pole w formularzu, "śr. błonnik" w statystykach tygodnia. Źródła danych: prompty Gemini (etykieta per100g, głos, zrzut, zdjęcie) i Open Food Facts (`fiber_100g`); przelicznik /100g uwzględnia błonnik, gdy jest znany.

## Faza 5 — dodane po analizie potrzeb (2026-07-19)
- **Raport odżywczy (analiza dnia względem własnych celów):** przycisk "+ Nowa analiza" pod listą wpisów w widoku dnia otwiera wybór zapisanego "celu analizy" i wysyła do Gemini listę posiłków tego dnia (nazwa, gramatura, pora, godzina, kcal/B/W/T/błonnik) razem z treścią celu i globalnym "Profilem zdrowotnym" z Ustawień. Cele to własne system prompty (nazwa + treść), zarządzane w Ustawieniach → "Cele analizy dnia" (`Storage.getGoals/addGoal/updateGoal/deleteGoal`, kolekcja `analysisGoals` z nagrobkami). Appka dokleja do każdego promptu użytkownika stały, generyczny fragment wymuszający jeden kształt odpowiedzi JSON (`meals[].flag` good/neutral/warning, `daily_summary`, `data_gaps`...) — dzięki temu jeden renderer (`renderAnalysisBody` w `js/ui.js`) obsługuje dowolny cel bez zmian w kodzie. Wynik zapisuje się per dzień+cel (`Storage.saveDailyAnalysis`, kolekcja `dailyAnalyses`, klucz `"YYYY-MM-DD__goalId"`, nadpisuje poprzedni przy ponownym uruchomieniu) i jest widoczny jako rozwijana karta z kolorowym oznaczeniem. Sync obu kolekcji przez Firestore (`meta/goals`, `meta/dailyAnalyses`). Moduł: `Ocr.analyzeDayAgainstGoal` w `js/ocr.js`.

## Co NIE weszło (świadomie)
- Wielojęzyczność
- Realtime sync (nasłuchiwanie zmian na żywo między urządzeniami) — obecnie sync tylko przy logowaniu/zapisie

## Uwagi dla implementującego
1. Zaczynaj od kroków po kolei (1→7). Każdy krok powinien dać działający rezultat.
2. Używaj `crypto.randomUUID()` do generowania ID.
3. Gemini API wymaga HTTPS — na localhost działa, na GitHub Pages też.
4. Zdjęcie konwertuj do base64 przez FileReader, przed wysłaniem zmniejsz do max 1024px (canvas resize) żeby nie przekraczać limitu payloadu.
5. Service worker: strategia cache-first dla app shell, network-first dla API calls.
6. CSS: użyj CSS custom properties dla kolorów — ułatwi dark/light mode.
7. Testuj na telefonie od początku (GitHub Pages lub `npx serve` + ngrok).
