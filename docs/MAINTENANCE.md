# Utrzymanie i wdrażanie zmian

Checklista obowiązkowa. W projekcie nie ma testów automatycznych ani CI — ta lista jest
jedynym zabezpieczeniem przed regresją.

## A. Przed napisaniem kodu

- [ ] Przeczytaj [CLAUDE.md](../CLAUDE.md) — zwłaszcza „Nienaruszalne zasady".
- [ ] Sprawdź `PLAN.md` → sekcja „Stan realizacji": czy funkcja nie została już zrobiona
      albo świadomie odłożona.
- [ ] Sprawdź [CHANGELOG.md](CHANGELOG.md) — czy podobna rzecz nie była już próbowana.
- [ ] Ustal, czy zmiana dotyka modelu danych. Jeśli tak → przeczytaj sekcję 3 i 4
      w [ARCHITECTURE.md](ARCHITECTURE.md) **przed** pisaniem.
- [ ] `git status` — upewnij się, że nie budujesz na cudzych niezacommitowanych zmianach
      nieświadomie.

## B. Podczas pisania

- [ ] Nowe stringi UI po polsku, inline (bez systemu tłumaczeń).
- [ ] Handlery elementów statycznych → `app.js` (jedna linia, delegacja do `UI.*`).
      Logika → `ui.js`. Dostęp do danych → `Storage.*`, nigdy `localStorage` w `ui.js`.
- [ ] Nowe pole w danych: wartość domyślna przy odczycie (`Number(x) || 0`,
      `{ ...DEFAULT_SETTINGS, ...zapisane }`). Stare wpisy muszą działać.
- [ ] Nowe pole w `settings` → dopisz do `DEFAULT_SETTINGS` w `storage.js`.
- [ ] Usuwanie czegokolwiek synchronizowanego → nagrobek `{ id, deleted: true, updatedAt }`,
      nie `splice`.
- [ ] Każdy zapis ustawia `updatedAt: new Date().toISOString()`.
- [ ] Wywołanie sieciowe → `try/catch` z polskim komunikatem w UI. Bez cichego `catch {}`.
- [ ] Nowy plik JS → dopisany w **trzech** miejscach: `<script>` w `index.html`,
      `APP_SHELL` w `sw.js`, drzewko plików w `ARCHITECTURE.md`.
- [ ] Nowa synchronizowana kolekcja → komplet: nagrobki, `merge*`, `push*`/`pull*`,
      wywołanie w `syncWithCloud`, obsługa w eksporcie/imporcie JSON.

## C. Przed uznaniem zadania za zrobione

### C1. Bump cache — **zawsze**
- [ ] `CACHE_NAME` w `sw.js` podniesiony (`licznik-kalorii-vN` → `vN+1`).
      Dotyczy każdej zmiany w JS, CSS lub HTML. To najczęstsza przyczyna „nowa funkcja nie działa".
- [ ] Ten sam numer wpisany w statycznym tekście „vN" obok nagłówka „Ustawienia" w
      `index.html` (od razu widoczny, bez przewijania). To jedyny widoczny dla użytkownika sposób sprawdzenia
      na telefonie, czy przeglądarka wczytała już najnowszą wersję po wdrożeniu — musi być
      bumpowany razem z `CACHE_NAME`, inaczej wprowadza w błąd. Celowo to zwykły tekst w
      HTML, nie odczyt z `CACHE_NAME` przez service workera: `index.html` jest jedynym
      zasobem serwowanym network-first (patrz `sw.js`), więc tylko on gwarantuje, że numer
      odpowiada dokładnie temu, co faktycznie jest teraz na ekranie — odpytanie service
      workera o wersję mogłoby pokazać nowszy numer, zanim przeglądarka realnie doładuje
      nowe pliki JS (`stale-while-revalidate`).

### C2. Test w przeglądarce
Uruchom lokalny serwer (konfiguracja `licznik-kalorii` w `.claude/launch.json`, `npx serve .`)
i sprawdź:

- [ ] Konsola bez błędów przy starcie i podczas korzystania z nowej funkcji.
- [ ] **Ścieżka szczęśliwa** nowej funkcji działa.
- [ ] **Trwałość:** dodaj wpis → F5 → wpis nadal jest, sumy się zgadzają.
- [ ] **Regresja rdzenia** (zawsze, niezależnie od zakresu zmiany):
      dodanie wpisu ręcznie, edycja wpisu, usunięcie wpisu, przełączenie dnia
      (‹ ›), przełączenie widoków (Dziennik / Historia / Ustawienia).
- [ ] **Widok mobilny** — DevTools ~375 px. Aplikacja jest mobile-first, to główny scenariusz.
- [ ] **Tryb ciemny i jasny**, jeśli zmiana dotykała CSS.

### C3. Testy zależne od zakresu zmiany

Zmiana w **modelu danych / storage**:
- [ ] Otwórz aplikację z danymi sprzed zmiany (nie czyść localStorage) — stare wpisy renderują się poprawnie.
- [ ] Eksport JSON → import JSON w trybie „scal" i „zastąp" → dane spójne.

Zmiana w **synchronizacji**:
- [ ] Zaloguj się, zsynchronizuj, przeładuj — dane się nie zdublowały.
- [ ] Usuń wpis, zsynchronizuj, przeładuj — wpis **nie wrócił** (test nagrobków).
- [ ] Sprawdź dokumenty w konsoli Firestore.

Zmiana w **integracji AI/skanowaniu**:
- [ ] Ścieżka bez klucza Gemini → czytelny komunikat kierujący do Ustawień, nie crash.
- [ ] Odpowiedź nieparsowalna / błąd sieci → komunikat, formularz nadal użyteczny.
- [ ] Kod kreskowy nieznany w Open Food Facts → fallback na ręczne wpisanie działa.

Zmiana w **service workerze lub liście plików**:
- [ ] DevTools → Application → Service Workers: nowa wersja aktywna, stare cache usunięte.
- [ ] DevTools → Network → Offline → przeładowanie: aplikacja się uruchamia.

### C4. Dokumentacja
- [ ] [CHANGELOG.md](CHANGELOG.md) — nowy wpis (data, co, dlaczego, dotknięte pliki).
- [ ] `PLAN.md` → „Stan realizacji" — przenieś pozycję do „Zrobione" lub dopisz nową.
- [ ] [ARCHITECTURE.md](ARCHITECTURE.md) — tylko jeśli zmienił się model danych, doszedł
      plik/moduł, doszła integracja albo zmieniła się strategia synca lub cache'owania.
- [ ] [CLAUDE.md](../CLAUDE.md) — tylko jeśli powstała nowa zasada, której złamanie psuje
      dane albo aplikację.

### C5. Commit
- [ ] `git diff` przejrzany — brak zapomnianych `console.log`, zakomentowanego kodu,
      **brak kluczy API**.
- [ ] Komunikat commita: tryb rozkazujący, po angielsku, zgodnie z historią repo
      (np. `Add recipe builder with per-portion macros`).
- [ ] Commit obejmuje bump `CACHE_NAME` i aktualizację dokumentacji.

## D. Po wdrożeniu na GitHub Pages

- [ ] Otwórz publiczny URL na telefonie, wymuś przeładowanie.
- [ ] Zainstalowana PWA: zamknij i otwórz ponownie — nowa wersja się załadowała.
- [ ] Dane sprzed aktualizacji na miejscu.

## Diagnostyka typowych awarii

| Objaw | Prawdopodobna przyczyna | Sprawdź |
|---|---|---|
| Przycisk nic nie robi, w konsoli `UI.x is not a function` | niezbumpowany `CACHE_NAME` | `sw.js`, potem Application → Clear storage |
| Działa online, wybucha offline | plik poza `APP_SHELL` | `sw.js` |
| Usunięty wpis wraca po syncu | brak nagrobka lub `merge*` | `storage.js` |
| Duplikaty po syncu | brak lub złe `id`, brak `updatedAt` | `storage.js`, `firebase-sync.js` |
| Stare wpisy renderują się z `NaN` | nowe pole bez wartości domyślnej | miejsce odczytu w `ui.js` |
| Logowanie Google nie działa na Pages | domena nieautoryzowana | konsola Firebase → Authentication → Settings |
| Skan zwraca śmieci | zmiana formatu odpowiedzi Gemini | parser w `js/ocr.js` |

## Rytm utrzymaniowy (co kilka miesięcy)

- [ ] `FIREBASE_SDK_VERSION` w `firebase-sync.js` — czy nie jest mocno przestarzała.
- [ ] Model Gemini w `ocr.js` (`gemini-flash-latest`) — czy endpoint i nazwa nadal aktualne.
- [ ] Zużycie darmowego tieru Firebase i Gemini.
- [ ] Ręczny eksport JSON jako kopia zapasowa niezależna od Firestore.
