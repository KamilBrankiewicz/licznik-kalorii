# Plan implementacji — Licznik Kalorii (PWA)

## Stan realizacji (2026-07-16)

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
  source: "manual"          // "manual" | "ocr"
}

// Cele dzienne (ustawienia)
{
  kcalGoal: 2000,
  proteinGoal: 150,
  carbsGoal: 200,
  fatGoal: 70,
  geminiApiKey: "..."       // klucz Gemini, przechowywany lokalnie
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
