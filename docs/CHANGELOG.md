# Changelog

Dziennik zmian funkcjonalnych. Cel: model LLM otwierający repo za pół roku ma z tego pliku
wiedzieć **co już jest, co zostało odrzucone i dlaczego**, bez czytania całego kodu.

Format wpisu — nowe na górze:

```
## [commit lub "w toku"] YYYY-MM-DD — Tytuł
**Co:** jedno-dwa zdania o zmianie widocznej dla użytkownika.
**Dlaczego:** problem, który to rozwiązuje.
**Pliki:** lista dotkniętych plików.
**Uwagi:** pułapki, decyzje, rzeczy do zapamiętania. Pomiń, jeśli brak.
```

---

## [w toku — niezacommitowane] 2026-08-04 — Udostępnianie suplementów/leków partnerowi
**Co:** Przycisk „Udostępnij" przy każdym suplemencie/leku na liście definicji. Wysyła kopię
  definicji (bez zapasu/harmonogramu aktywności — `active`/`stockBaseline` partner ustawia
  sam) na skrzynkę odbiorczą partnera; przy najbliższym syncu partnera pozycja trafia do jego
  listy suplementów jako nowy, niezależny rekord (`shared: true`, własne `id`/`updatedAt`).
**Dlaczego:** analogiczny mechanizm do „Udostępnianie przepisów partnerowi" niżej — dwie
  niezależne osoby na dwóch kontach, które chcą przekazać sobie gotowy suplement/lek bez
  ręcznego przepisywania składu i dawkowania.
**Pliki:** `js/firebase-sync.js`, `js/storage.js`, `js/ui.js`, `sw.js`, `index.html`,
  `docs/ARCHITECTURE.md`.
**Uwagi:** wzorowane 1:1 na `sharedRecipes` — jednorazowa skrzynka `sharedSupplements/{uid}/inbox`
  poza drzewem `users/{uid}`, bez nagrobków i `merge*` (nie ma czego scalać), z tym samym
  lokalnym guardem przed podwójnym importem (`seenSharedSupplementIds`, analogicznie do
  `seenSharedRecipeIds`). Reguły bezpieczeństwa Firestore dla `sharedSupplements` trzeba
  dopisać ręcznie w konsoli Firebase — patrz `ARCHITECTURE.md` sekcja 7.

---

## [w toku — niezacommitowane] 2026-08-04 — Dodawanie suplementów/leków ze zdjęcia etykiety i po nazwie (AI)
**Co:** Dwa nowe sposoby wypełniania formularza suplementu/leku: „📷 Ze zdjęcia etykiety"
  (Gemini analizuje zdjęcie opakowania) i „🔍 Znajdź po nazwie" (Gemini z groundingiem
  Google Search). Oba tylko wypełniają formularz — zapis wymaga ręcznego zatwierdzenia.
  Formularz suplementu rozszerzony o: typ (suplement/lek, badge „lek" na liście), formę,
  wielkość opakowania, markę, skład (dynamiczna lista składników w zwijanej sekcji),
  zalecenia przyjmowania, ostrzeżenia. Analiza AI suplementów (`Ocr.analyzeSupplements`)
  wykorzystuje teraz skład (`ingredients`), jeśli jest dostępny, zamiast zgadywać po nazwie.
**Dlaczego:** ręczne przepisywanie składu z etykiety było żmudne i podatne na literówki
  w dawkach — te dane są jednocześnie podstawą analizy interakcji/sumowania dawek.
**Pliki:** `index.html`, `css/style.css`, `js/ui.js`, `js/app.js`, `js/ocr.js`, `sw.js`.
**Uwagi:** `Ocr.callGemini` przyjął trzeci opcjonalny parametr `extraPayload` (używany do
  `tools: [{ google_search: {} }]` przy wyszukiwaniu po nazwie) — żadne istniejące wywołanie
  nie zmieniło zachowania. Wyszukiwanie po nazwie ma jedną próbę ponowną bez groundingu przy
  błędzie HTTP. Model danych suplementu wstecznie zgodny — stare rekordy bez nowych pól
  działają bez zmian, bez migracji. `storage.js`, nagrobki, merge i sync nie wymagały zmian
  (cały obiekt suplementu już podróżował w całości). Zob. `docs/PLAN-SUPLEMENTY-AI-DODAWANIE.md`.

---

## [w toku — niezacommitowane] 2026-08-04 — Usprawnienia modułu suplementów (6 poprawek)
**Co:** Sześć poprawek modułu suplementów wg `docs/PLAN-USPRAWNIENIA-SUPLEMENTY.md`:
  (1) `escapeHtml` escapuje też `"`/`'`, więc nazwy z cudzysłowem nie psują atrybutów HTML;
  (2) szybkie chipy leków doraźnych (`adhocQuickItems`) mają teraz nagrobki, merge po
  `updatedAt`, sync do Firestore (`meta/adhocQuickItems`) i obsługę w eksporcie/imporcie —
  wcześniej żyły tylko lokalnie i znikały przy czyszczeniu danych bez śladu; (3) zapas
  suplementu przeszedł z modelu „bieżąca liczba nadpisywana przy każdym odhaczeniu" na
  „baza (`stockBaseline`/`stockBaselineDate`) minus dawki z logu policzone na bieżąco" —
  odhaczenia z dwóch urządzeń już się nie gubią, bo log ma merge per-wpis, a definicja
  suplementu nie jest już dotykana przy każdym kliknięciu; (4) alarm zapasu liczy dni
  pokrycia z harmonogramu („zapas: N szt. · na X dni (do DD.MM)", czerwony przy ≤ 7 dniach
  lub 0 szt.) zamiast sztywnego progu „≤ 7 sztuk"; (5) log suplementów w Firestore jest
  teraz shardowany po miesiącach (`meta/supplementLog-YYYY-MM`) z debounce'em pusha (2 s),
  żeby jeden rosnący dokument nie uderzył w limit 1 MB; (6) edycja godziny dawki (planowej
  i doraźnej) przez natywny `<input type="time">` zamiast `prompt()`, a
  `renderSupplementsSection` czyta log dnia raz na render zamiast po razie na suplement.
**Dlaczego:** Moduł suplementów działał, ale łamał kilka nienaruszalnych zasad projektu
  (brak nagrobków przy chipach, brak `updatedAt`) i miał realne ryzyko utraty danych przy
  syncu (nadpisywanie zapasu, rosnący bez końca dokument logu) oraz szorstki UX (`prompt()`).
**Pliki:** `js/storage.js`, `js/firebase-sync.js`, `js/ui.js`, `js/app.js`, `index.html`,
  `css/style.css`, `sw.js`
**Uwagi:**
- Stare rekordy z samym polem `stock` (sprzed tej zmiany) nadal się wyświetlają — traktowane
  jako baza z datą w przyszłości, więc żadna dawka nie jest jeszcze odejmowana, dopóki
  użytkownik nie edytuje suplementu w formularzu (wtedy zapis przechodzi na nowy model).
  Świadomie bez migracji hurtowej — poza zakresem planu.
- Stary dokument Firestore `meta/supplementLog` zostaje jako pusty (`{ map: {} }`) po
  pierwszym pełnym syncu po tej zmianie; pull nadal go czyta (razem z shardami), żeby nie
  zgubić danych sprzed shardingu.

## [w toku — niezacommitowane] 2026-08-04 — Analiza AI diety (tydzień/miesiąc/kwartał)
**Co:** W Dzienniku, pod istniejącym raportem odżywczym dnia, doszła sekcja „Analiza AI diety"
  z trzema zakresami wielodniowymi (Tydzień/Miesiąc/Kwartał — celowo bez „Dnia", bo ten
  przypadek pokrywa już analiza względem celów). Raport zawiera bilans energetyczny
  (zmiana wagi, szacowane TDEE i dzienny deficyt/nadwyżka), przegląd średnich makro vs cele,
  wykryte wzorce (regularność, dni odstające, jakość diety) i rekomendacje. Bilans liczony
  w JS z pomiarów wagi (`Δkg × 7700 / dni`), AI go tylko interpretuje — nie przelicza.
**Dlaczego:** Motywujący przypadek: „schudłem 1 kg w miesiąc, co to oznacza względem tego,
  co jadłem?" — wymaga trendów wielodniowych i korelacji spożycia z wagą, czego nie daje
  analiza pojedynczego dnia względem celu.
**Pliki:** `js/storage.js`, `js/ocr.js`, `js/firebase-sync.js`, `js/ui.js`, `index.html`,
  `css/style.css`, `sw.js`
**Uwagi:**
- Bez cache'u statycznego (w przeciwieństwie do analizy suplementów) — tu każda sekcja
  zależy od danych okresu, nic nie jest niezmienne między wywołaniami.
- Guard w JS przed wywołaniem API: minimalna liczba dni z wpisami (week ≥ 3, month ≥ 7,
  quarter ≥ 14) — poniżej progu zero żądań sieciowych, tylko komunikat.
- Budżet tokenów rośnie z zakresem: week wysyła dzienne wiersze + nazwy posiłków, month —
  30 podsumowań dziennych bez nazw + top-10 częstych produktów, quarter — 13 agregatów
  tygodniowych + top-15 produktów (nigdy pojedyncze wpisy dla month/quarter).
- Waga jest opcjonalna: przy < 2 pomiarach lub rozpiętości < 5 dni `bilans_wstepny` to
  `null`, a AI ma to odnotować w `data_gaps` zamiast zgadywać.

---

## [w toku — niezacommitowane] 2026-08-04 — Analiza AI suplementów i leków (Gemini)
**Co:** W widoku suplementów doszła sekcja „Analiza AI" z trzema zakresami (Dzień/Tydzień/
  Miesiąc). Jedno wywołanie Gemini zwraca wielosekcyjny raport: interakcje między pozycjami,
  sumowanie substancji vs limity, pory dawek vs posiłki (tylko dzień), regularność przyjmowania
  i wzorce leków doraźnych (tylko tydzień/miesiąc). Raporty są zapisywane, synchronizowane
  i przetrwają eksport/import. Każdy raport kończy się zastrzeżeniem, że to nie porada medyczna.
**Dlaczego:** Ręczne śledzenie interakcji i limitów dawek między wieloma suplementami/lekami
  jest trudne; AI robi to na podstawie już zebranych danych z modułu suplementów, bez dodatkowej
  pracy użytkownika.
**Pliki:** `js/storage.js`, `js/ocr.js`, `js/firebase-sync.js`, `js/ui.js`, `index.html`,
  `css/style.css`, `sw.js`
**Uwagi:**
- Sekcje `interactions`/`dose_totals` zależą tylko od listy definicji, więc są cache'owane
  lokalnie (`suppAnalysisStaticCache`, z fingerprintem listy) i pomijane w kolejnych promptach
  dopóki lista się nie zmieni — oszczędza tokeny.
- Tydzień/miesiąc dostają dane zagregowane w JS (nie surowy log) — prompt rośnie wolniej niż
  liczba dni.
- Przy pierwszej analizie w ogóle (brak cache i brak zapisanych raportów) pokazuje się
  potwierdzenie wysyłki danych do Gemini API.

## [w toku — niezacommitowane] 2026-08-03 — Suplementy: picker dni tygodnia, sekcja leków doraźnych
**Co:**
- Picker dni tygodnia w formularzu suplementu przerobiony z prostych checkboxów na pełną
  siatkę 7 kolumn (Pn–Nd) z nazwą dnia na górze i okrągłym togglem pod spodem. Wypełnia
  cały wiersz, dużo czytelniejszy niż poprzednia wersja.
- Dodawanie leków doraźnych (Apap, Gripex itp.) wydzielone do osobnej sekcji „Leki doraźne"
  na dole widoku suplementów. Zamiast prostego `prompt()` jest pole tekstowe z przyciskiem
  „Dodaj". Po dodaniu leku pojawia się chip do szybkiego ponownego użycia — jedno tapnięcie
  i lek jest zapisany. Chipy można usuwać (×).
**Dlaczego:** Picker dni był mało czytelny. Dodawanie leków doraźnych przez `prompt()` było
  nieintuicyjne i nie zapamiętywało wcześniej używanych nazw.
**Pliki:** `index.html`, `css/style.css`, `js/ui.js`, `js/storage.js`, `sw.js`
**Uwagi:** Szybkie elementy doraźne przechowywane w `localStorage` pod kluczem `adhocQuickItems`.

## [w toku — niezacommitowane] 2026-08-03 — Suplementy: redesign UI, prywatność, log dawek, zwijane sekcje
**Co:** Kompletny redesign widoku suplementów:
- Karty w stylu posiłków (awatar z inicjałem, tło karty) zamiast prostej checklisty.
- Nowe pole „Nazwa wyświetlana" (opcjonalne) — w całym UI widoczna jest nazwa wyświetlana,
  prawdziwa nazwa pozostaje w danych i formularzu edycji. Cel: prywatność przy podglądaniu ekranu.
- Pole „Razy dziennie" — docelowa liczba dawek (np. 3 dla antybiotyku). Widok pokazuje
  postęp (1/3, 2/3, 3/3), nie blokuje dalszego klikania (4/3 OK). Awatar z obramowaniem
  gdy częściowo ukończone, zielony gdy ukończone.
- Sekcja „Log dawek" — każda dawka z godziną, posortowana chronologicznie. Kliknięcie wpisu
  pozwala edytować godzinę, „×" usuwa pojedynczą dawkę (aktualizuje licznik i zapas).
- „Log dawek" i „Zarządzaj suplementami" jako zwijalne sekcje (`<details>`).
- Nawigacja dni i „+" do wielokrotnych dawek z poprzedniego commitu.
- „Pora dnia" i „Harmonogram" w formularzu suplementu zamienione z natywnych `<select>`
  na stylowane grupy przycisków (button-grid), spójne z resztą UI.
- Harmonogram rozszerzalny: Codziennie / Dni tygodnia / Co N dni / Cykl — dodanie nowej
  opcji to jeden `<button>` w HTML i obsługa widoczności w `updateSuppScheduleRowsVisibility`.
- Pola „Dni brania" / „Dni przerwy" widoczne tylko przy wybranym „Cykl", „Dni tygodnia"
  pokazuje checkboxy dni, „Co N dni" — pole liczbowe.
**Dlaczego:** stara checklista wyglądała ubogo na tle reszty UI. Nazwy leków widoczne na ekranie
to problem prywatności. Brak informacji o godzinach dawek. Sekcje zarządzania i logu zajmowały
dużo miejsca — zwijanie porządkuje widok. Natywne `<select>` wyglądały niespójnie z resztą
formularzy w aplikacji.
**Pliki:** `index.html`, `css/style.css`, `js/ui.js`, `js/storage.js`, `js/app.js`, `sw.js` (bump v50).
**Uwagi:** Nowe pole `displayName` w definicji suplementu (opcjonalne, wstecznie zgodne — gdy
brak, wyświetlana jest `name`). `timesPerDay` (domyślnie 1). supplementLog: `{ times: [...] }`
zamiast `{ count, time }` — wstecznie zgodny. Nowe funkcje Storage: `getSupplementDoseTimes`,
`updateSupplementDoseTime`, `removeSupplementDose`. CSS: `.form-row-2[hidden] { display: none; }`
potrzebne, bo `display: grid` na `.form-row-2` nadpisywał atrybut `hidden`.

---

## [w toku — niezacommitowane] 2026-08-03 — Odblokowanie od razu prowadzi do "+ Nowy suplement"
**Co:** Po odblokowaniu gestem `toggleSupplementsUnlocked` przełącza teraz widok na Ustawienia,
rozwija akordeon „Suplementy i leki” (`acc.open = true`), przewija go w widok
(`scrollIntoView`) i pokazuje toast „Moduł suplementów odblokowany”. Zablokowanie (drugie
odblokowanie) działa jak wcześniej — tylko chowa checklistę/akordeon bez zmiany widoku.
**Dlaczego:** użytkownik odblokował moduł, ale nie widział, gdzie dodać definicję suplementu —
sekcja zarządzania to zwinięty akordeon w długiej liście Ustawień, bez żadnego sygnału po
odblokowaniu. Sama checklista w dzienniku daje tylko „+ Doraźnie” (wpis jednorazowy), nie
tworzenie harmonogramu.
**Pliki:** `js/ui.js` (`toggleSupplementsUnlocked`), `sw.js` (bump v43), `index.html` (v43).
**Uwagi:** zachowanie przy blokowaniu (drugi gest) celowo zostało bez zmian — nie ma potrzeby
nawigować nigdzie, użytkownik i tak zwykle jest wtedy na Dzienniku (tam żyje gest).

---

## [w toku — niezacommitowane] 2026-08-03 — Triple-tap: touch-action:manipulation + szersze okno
**Co:** Po wdrożeniu potrójnego tapnięcia (patrz wpis niżej) użytkownik zgłosił, że nadal nic
się nie dzieje na telefonie. Dodano `touch-action: manipulation` na nagłówku daty i poszerzono
okno wykrywania z 600 ms do 800 ms.
**Dlaczego:** bez `touch-action: manipulation` przeglądarka na dotyku czeka ok. 300 ms po każdym
tapnięciu, żeby rozstrzygnąć, czy to nie jest podwójne tapnięcie do przybliżenia (natywny gest
zoom) — to opóźnienie kumuluje się i łatwo przekracza wąskie okno 600 ms, a w gorszym razie jedno
z tapnięć zostaje "zjedzone" przez gest zoomu zamiast wygenerować `click`. `touch-action:
manipulation` wyłącza zoom podwójnym tapnięciem na tym elemencie i usuwa opóźnienie.
**Pliki:** `css/style.css` (`touch-action: manipulation` na `.date-header h2`), `js/app.js`
(okno 600ms → 800ms), `sw.js` (bump v42), `index.html` (v42).
**Uwagi:** nie dało się w pełni zweryfikować rzeczywistego opóźnienia dotyku w środowisku
testowym (desktopowa przeglądarka nie odtwarza tego zachowania) — to standardowa, dobrze
udokumentowana poprawka na ten problem, ale wymaga potwierdzenia na telefonie użytkownika.

---

## [7ddc205] 2026-08-03 — Suplementy: potrójne tapnięcie zamiast długiego przytrzymania
**Co:** Gest odsłaniający moduł suplementów zmieniony z długiego przytrzymania (1,5 s) na
potrójne tapnięcie nagłówka z datą (3 kliknięcia w ciągu 600 ms).
**Dlaczego:** użytkownik zgłosił, że długie przytrzymanie na telefonie nic nie robiło —
`pointerdown`/`pointerup` w praktyce zawodziły (prawdopodobnie konflikt z natywnym
zaznaczaniem tekstu/scrollem na dotyku). Potrójne tapnięcie liczy zwykłe zdarzenia `click`,
które przeglądarka gwarantowanie wysyła przy kolejnych tapnięciach — prostsze i pewniejsze.
**Pliki:** `js/app.js` (licznik tapnięć zamiast `setTimeout` na `pointerdown`),
`css/style.css` (komentarz), `sw.js` (bump v41), `index.html` (v41).
**Uwagi:** pojedyncze i podwójne tapnięcie nie robią nic — sprawdzone w przeglądarce. Okazało
się to niewystarczające na prawdziwym telefonie — patrz wpis wyżej.

---

## [8cd62c5] 2026-08-03 — Ukryty moduł suplementów i leków
**Co:** Nowy, domyślnie ukryty moduł do śledzenia suplementów/leków: definicje z dowolnym
harmonogramem (codziennie / wybrane dni tygodnia / co N dni / cykl brania-przerwy),
dzienna checklista z odhaczaniem w widoku dziennika (grupowana wg pory dnia, ze śledzeniem
zapasu), wpisy doraźne (lek wzięty bez wcześniejszej definicji) oraz zarządzanie listą
w Ustawieniach. Sekcja jest niewidoczna w DOM, dopóki użytkownik nie odsłoni jej gestem na
nagłówku z datą w widoku dziennika (pierwotnie długie przytrzymanie, patrz wpis wyżej) —
stan odblokowania żyje w `sessionStorage`, więc znika dopiero przy zamknięciu karty/aplikacji
(przetrwa zwykłe przeładowanie strony — świadomie zaakceptowane, patrz Uwagi).
**Dlaczego:** dane o lekach/suplementach są bardziej wrażliwe niż licznik kalorii; ukrycie
za gestem sprawia, że nie są widoczne przy zwykłym korzystaniu z aplikacji ani przy
przelotnym spojrzeniu na ekran przez kogoś innego.
**Pliki:** `js/storage.js` (CRUD + harmonogram + dziennik przyjęć + eksport/import),
`js/firebase-sync.js` (push/pull `supplements`/`supplementLog`), `js/ui.js` (gest
odblokowania, checklista w dzienniku, zarządzanie listą w Ustawieniach), `js/app.js`
(gest na `#currentDateLabel`, podpięcia formularza), `index.html` (kontener
checklisty, akordeon i modal w Ustawieniach), `css/style.css` (`.supp-*`, blokada
zaznaczania nagłówka daty), `sw.js` (bump v40).
**Uwagi:** ukrycie jest wyłącznie wizualne (świadoma decyzja, bez szyfrowania) — dane
i tak trafiają do eksportu JSON i do Firestore jak każda inna kolekcja. Zakres celowo
nie obejmuje powiadomień, doliczania kcal, statystyk compliance ani skanu etykiety —
patrz `docs/PLAN-MODUL-SUPLEMENTY.md`, sekcja „Poza zakresem". `sessionStorage` NIE czyści
się przy przeładowaniu strony (tylko przy zamknięciu karty) — plan pierwotnie zakładał
inaczej, ale to świadomie zaakceptowana rozbieżność.

---

## [w toku — niezacommitowane] 2026-08-01 — Nie powtarzaj wartości SMM/PBF w podpisie
**Co:** Podpis pod panelem body-comp (`bodyCompLastHint`) pokazywał pełne „SMM X kg ·
PBF Y%" mimo że te same liczby są już widoczne jako placeholder w polach input tuż nad
nim. Teraz podpis pokazuje tylko datę ostatniego pomiaru, tak jak analogiczny hint przy
samej wadze (`weightLastHint`).
**Dlaczego:** użytkownik zauważył powielenie tych samych wartości w dwóch miejscach.
**Pliki:** `js/ui.js` (`renderDiary`), `sw.js` (bump v38), `index.html` (v38).

---

## [w toku — niezacommitowane] 2026-08-01 — Fix: panel body-comp nie zwijał się
**Co:** Panel SMM/PBF pod wierszem wagi był zawsze widoczny mimo atrybutu `hidden` —
klasa `.body-comp-panel` ustawiała `display: flex` o tej samej specyficzności co domyślne
`[hidden] { display: none }` przeglądarki, więc reguła autora wygrywała i `hidden` nie
robił nic. Dodatkowo cały wiersz wagi (`.weight-row`) nie miał `cursor: pointer`, co
utrudniało trafienie w małą strzałkę — teraz cały wiersz jest oczywiście klikalny.
**Dlaczego:** użytkownik zgłosił, że kliknięcie strzałki nic nie robi i chciał, żeby
całý wiersz otwierał szczegóły.
**Pliki:** `css/style.css` (`.body-comp-panel[hidden] { display: none }`, `cursor: pointer`
na `.weight-row`), `sw.js` (bump v37), `index.html` (v37).
**Uwagi:** `js/app.js`/`UI.toggleBodyComp` już obsługiwały klik na całym wierszu (poza
polami input) — brakowało tylko poprawki CSS.

---

## [w toku — niezacommitowane] 2026-08-01 — Pomiary składu ciała (InBody)
**Co:** Kliknięcie wiersza wagi na głównej stronie rozwija panel z dwoma dodatkowymi
polami: SMM (masa mięśni szkieletowych, kg) i PBF (% tłuszczu). Dane zapisują się
razem z wagą. W sekcji Historia wykres wagi zyskał taby Waga/SMM/PBF — pojawiają się
gdy istnieją dane body comp.
**Dlaczego:** użytkownik co jakiś czas robi pomiar InBody i chce śledzić te wartości
w tej samej aplikacji.
**Pliki:** `js/storage.js` (rozszerzony `setWeight` o `body`, nowe `getWeightFull`,
`getLatestBodyComp`; `getLatestWeight`/`getWeightHistory` zwracają smm/bf),
`js/ui.js` (rozszerzony `renderDiary`/`saveWeightFromInput`, nowe `toggleBodyComp`,
`buildWeightChart`, `setWeightChartMetric`; refaktor `renderWeightStats` z tabami),
`js/app.js` (event listenery dla smmInput, bfInput, weightRowToggle),
`index.html` (rozbudowany weight-row w weight-section z body-comp-panel),
`css/style.css` (style body-comp-*, weight-metric-tabs, weight-expand-icon),
`sw.js` (bump v36).
**Uwagi:** model danych wstecznie zgodny — smm/bf to pola opcjonalne, odczyt przez
`Number(w.smm) || null`. Sync działa bez zmian bo `mergeWeights` operuje na całych
obiektach wagi.

---

## [w toku — niezacommitowane] 2026-08-01 — Usunięto zbiorcze „Skopiuj z wczoraj"
**Co:** Usunięty przycisk „Skopiuj z wczoraj (N)" pokazywany przy pustych kategoriach
posiłków (kopiował całą kategorię z poprzedniego dnia naraz).
**Dlaczego:** funkcja okazała się zbędna — przycisk „⟳" (relog, `Dodaj ponownie dziś`)
na każdej karcie wpisu, dostępny również przy przeglądaniu poprzednich dni, już pozwala
dodać pojedynczy wpis ponownie na dziś. Zbiorcze kopiowanie całej kategorii było
funkcją nadmiarową („za dużo" względem potrzeby).
**Pliki:** `js/ui.js` (usunięte `copyMealsFromYesterday` i blok renderujący przycisk
w `renderDiary`, wraz z nieużywanymi już `yesterdayStr`/`yesterdayEntries`),
`css/style.css` (usunięte `.copy-yesterday-wrapper`, `.meal-header-empty`,
`.copy-yesterday-btn`), `sw.js` (bump v35), `index.html` (v35).
**Uwagi:** Funkcja „⟳" (relog pojedynczego wpisu) nie zmieniła się — to ona teraz w pełni
pokrywa przypadek użycia.

---

## [w toku — niezacommitowane] 2026-07-31 — Fix: zmiana produktu po autouzupełnieniu nie odświeżała makr
**Co:** W modalu „Dodaj posiłek", po wybraniu produktu z listy/dropdowna, wpisanie innej
nazwy dokładnie pasującej do innego zapisanego produktu i opuszczenie pola (blur) nie
odświeżało kcal/makro — zostawały wartości poprzednio wybranego produktu.
**Dlaczego:** `autofillFromName` blokowała nadpisanie zawsze, gdy pole kcal miało już
jakąkolwiek wartość, bez sprawdzenia, czy ta wartość pochodzi z poprzedniego dopasowania
czy została wpisana ręcznie. Reprodukowane i zweryfikowane w przeglądarce (Playwright/MCP).
**Pliki:** `js/ui.js` (`fillFormFromProduct` zapisuje `lastAutoFilledName`; `autofillFromName`
porównuje aktualną nazwę z `lastAutoFilledName` zamiast tylko sprawdzać czy kcal jest puste;
`openEntryModal` resetuje `lastAutoFilledName` na `null`), `sw.js` (bump v34), `index.html` (v34).
**Uwagi:** Ręcznie wpisane kcal (bez wcześniejszego dopasowania z listy) nadal jest chronione
przed nadpisaniem — `lastAutoFilledName === null` traktowane jak "wartość ręczna".

---

## [w toku — niezacommitowane] 2026-07-31 — Autocomplete nazwy produktu przy dodawaniu posiłku
**Co:** Wpisywanie nazwy produktu w modalu „Dodaj posiłek" podpowiada pasujące produkty
z historii wpisów (substring match, debounce 200 ms, max 8 wyników). Kliknięcie podpowiedzi
wypełnia formularz (nazwa, gramy, kcal, makro). Zastępuje natywny `<datalist>` (8 pozycji)
custom dropdownem przeszukującym pełną historię unikalnych produktów.
**Dlaczego:** natywny `<datalist>` ograniczał podpowiedzi do 8 najczęstszych produktów i nie
pozwalał szukać; użytkownik musiał pamiętać dokładną nazwę lub scrollować chipy.
**Pliki:** `js/storage.js` (nowe: `buildProductIndex`, `getUniqueProducts`), `js/ui.js`
(`searchProducts`, `doSearchProducts`, `hideAutocomplete`, `buildProductCache`; `renderRecentProducts`
bez datalist), `js/app.js` (eventy `input`/`blur` na `#entryName`), `index.html` (dropdown
kontener zamiast datalist), `css/style.css` (style `.autocomplete-*`), `sw.js` (bump v32).
**Uwagi:** Cache budowany raz przy otwarciu modala (`buildProductCache`), filtrowanie na keystroke
operuje na tablicy w pamięci — zero dodatkowych odczytów localStorage. `mousedown` + `preventDefault`
na itemach dropdowna zapobiega `blur` przed obsłużeniem kliknięcia.

---

## [w toku — niezacommitowane] 2026-07-31 — Undo usunięcia, kopiowanie z wczoraj, szukaj w historii, kalendarz miesiąca, ekstrakcja przepisów do IIFE
**Co:** (1) Po usunięciu wpisu z dziennika pojawia się toast z przyciskiem „Cofnij" (5 s) —
kliknięcie przywraca wpis (tombstone z `deleted: false`).
(2) Puste kategorie posiłków pokazują przycisk „Skopiuj z wczoraj (N)" — kopiuje wpisy
z tej samej kategorii z poprzedniego dnia.
(3) Pole wyszukiwania w widoku Historia — szuka wpisów po nazwie we wszystkich dniach,
wyświetla do 50 wyników z debouncem 200 ms.
(4) Widok miesiąca (kalendarz) w Historii — siatka dni z kolorowymi kropkami (zielona =
w celu, czerwona = poza celem wg wybranej metryki), nawigacja miesiąc ←/→.
(5) Logika przepisów wyekstrahowana z `ui.js` do `js/recipes.js` (osobny moduł IIFE
`window.Recipes`), ~1000 linii mniej w `ui.js`. Cross-module: `Recipes.*` woła
`UI.showToast()`, `UI.switchView()`, `UI.getCurrentDate()`, `UI.pushDayToCloud()`,
`UI.renderDiary()`; lokalne kopie helperów (`escapeHtml`, `nowTimeStr`, `mealFromTime`,
`MEALS`) by uniknąć zależności cyklicznej.
**Dlaczego:** (1) przypadkowe usunięcie nie miało odwrotu; (2) ręczne przepisywanie
wczorajszych posiłków było uciążliwe; (3) brak sposobu na znalezienie dawnego wpisu;
(4) brak przeglądu miesiąca; (5) `ui.js` >2600 linii — przepisy stanowiły ~40% pliku.
**Pliki:** `index.html`, `css/style.css`, `js/ui.js`, `js/recipes.js` (nowy),
`js/app.js`, `sw.js`, `docs/CHANGELOG.md`.
**Uwagi:** `recipes.js` ładowany PO `ui.js`, PRZED `app.js`. Dodany do `APP_SHELL` w `sw.js`.
`app.js` zmienione: listenery przepisów `UI.*` → `Recipes.*`. Bump `CACHE_NAME` →
`licznik-kalorii-v31`, wersja widoczna → v31.

## [w toku — niezacommitowane] 2026-07-25 — Poprawki przepisów: merge składników, podgląd makro, zapamiętywanie
**Co:** (1) Analiza AI przepisu zachowuje ręcznie dodane składniki zamiast je nadpisywać —
nowe składniki z AI są dołączane, istniejące (po nazwie) nie są duplikowane.
(2) Pod polem gramów w modalu składnika wyświetla się podgląd przeliczonych makro na żywo
(np. „= 15 kcal · B: 0.6g · W: 3.3g · T: 0.1g"), aktualizowany przy każdej zmianie gramów
lub wartości per100g.
(3) Przycisk „Zapamiętaj składnik" w modalu składnika — zapisuje składnik do ulubionych
produktów z wartościami per100g i domyślną gramaturą, dzięki czemu przy kolejnych przepisach
wystarczy kliknąć chip i ewentualnie dostosować gramy.
**Dlaczego:** (1) składnik dodany z etykiety znikał po kliknięciu „Przeanalizuj przepis";
(2) użytkownik nie widział efektu zmiany gramów do momentu zapisania; (3) brak sposobu na
szybkie ponowne użycie składników przy nowych przepisach.
**Pliki:** `index.html`, `js/ui.js`, `js/app.js`, `sw.js`.
**Uwagi:** zapamiętane składniki korzystają z istniejącego systemu `favoriteProducts` — pojawiają
się też w formularzu dodawania wpisu do dziennika. Bump `CACHE_NAME` → `licznik-kalorii-v30`.

## [w toku — niezacommitowane] 2026-07-20 — Przełącznik metryki (Kcal/Białko/Węgle/Tłuszcz) w Historii
**Co:** nad wykresem tygodniowym w widoku Historia doszły 4 zakładki pozwalające przełączyć,
którą wartość pokazują słupki, linia celu i lista dni: Kcal, Białko, Węgle lub Tłuszcz.
**Dlaczego:** śledzenie samego kcal nie wystarcza — białko jest dla użytkownika ważniejszym
celem niż limit kaloryczny, a dotychczas historia pokazywała wyłącznie kcal.
**Pliki:** `index.html`, `css/style.css`, `js/ui.js`, `js/app.js`, `js/storage.js`, `sw.js`.
**Uwagi:** wybrana zakładka jest **per-urządzenie**, zapisana w `localStorage` pod kluczem
`historyMetricPreference` przez `Storage.getHistoryMetric/saveHistoryMetric` — celowo nie
wchodzi do `settings` i nie synchronizuje się przez Firebase (analogicznie do `themePreference`).
Kolorowanie „dobrze/źle” (czerwona kropka/słupek) zależy od kierunku celu danej metryki: dla
Kcal przekroczenie celu jest złe, dla Białka nieosiągnięcie celu jest złe, a Węgle/Tłuszcz są
czysto poglądowe (bez oceniania) — te dwie metryki nie mają jednoznacznego kierunku „dobrze”.
Bump `CACHE_NAME` → `licznik-kalorii-v28`.

---

## [w toku — niezacommitowane] 2026-07-19 — Reorganizacja Ustawień w akordeon + ręczny motyw jasny/ciemny
**Co:** zakładka Ustawienia była jedną długą listą 7 sekcji od góry do dołu. Teraz: sekcja
„Wygląd” z przełącznikiem Jasny/Ciemny/Auto na samej górze (zawsze widoczna), „Cele dzienne”
rozwinięte domyślnie, reszta (Profil zdrowotny, Klucz Gemini API, Cele analizy dnia, Kopia
zapasowa, Synchronizacja i udostępnianie, Strefa niebezpieczna) jako zwijane `<details>`.
Wszystkie dotychczasowe id pól zostały zachowane bez zmian.
**Dlaczego:** sekcja urosła organicznie (profil zdrowotny, cele analizy AI, udostępnianie
przepisów) i przewijanie stało się uciążliwe; brakowało ręcznego przełącznika motywu — apka
reagowała wyłącznie na `prefers-color-scheme` systemu.
**Pliki:** `index.html`, `css/style.css`, `js/ui.js`, `js/app.js`, `js/storage.js`, `sw.js`.
**Uwagi:** motyw jest **per-urządzenie** (świadomie), zapisany w `localStorage` pod kluczem
`themePreference` przez `Storage.getTheme/saveTheme` — celowo **nie** wchodzi do `settings` i
nie synchronizuje się przez Firebase ani nie jest usuwany przez „Wyczyść wszystkie dane”.
CSS: `:root[data-theme="light"]` nadpisuje jasne wartości niezależnie od systemu, a media query
`prefers-color-scheme: light` używa `:root:not([data-theme="dark"])`, żeby ręczny wybór
„Ciemny” działał nawet gdy system jest jasny. Inline `<script>` w `<head>` ustawia atrybut
`data-theme` przed pierwszym malowaniem strony (bez tego byłby flash jasnego motywu przy
starcie w trybie ciemnym). Bump `CACHE_NAME` → `licznik-kalorii-v27`.

---

## [w toku — niezacommitowane] 2026-07-19 — Zakładki Własne/Udostępnione w widoku Przepisy + kopiowanie UID
**Co:** przycisk „Kopiuj” obok własnego UID w Ustawieniach (kopiuje do schowka, toast
potwierdzenia). W widoku „Przepisy” doszły dwie zakładki nad listą, „Własne” i
„Udostępnione” — przepisy zaimportowane od partnera (patrz wpis niżej) mają teraz osobną
zakładkę zamiast mieszać się z własnymi przepisami na jednej liście. Lista przepisów (obie
zakładki) sortuje się teraz od najnowszych do najstarszych (`updatedAt` malejąco), zamiast
kolejności wstawienia. Naprawiono też bug: udostępniony przepis, którego odbiorca usunął
lokalnie, nie pojawiał się ponownie po ponownym udostępnieniu przez nadawcę tego samego
przepisu.
**Dlaczego:** po pierwszym użyciu udostępniania przepis od partnera lądował na końcu tej
samej listy co własne przepisy, trudno było go odróżnić. Bug z brakiem ponownego pojawienia
się: dokument w `sharedRecipes/{recipientUid}/inbox/{itemId}` używał jako `itemId` identyfikatora
przepisu nadawcy (`recipe.id`), stałego między kolejnymi udostępnieniami tego samego przepisu.
Lokalny `seenSharedRecipeIds` u odbiorcy (guard przeciw duplikatom, patrz `storage.js`) raz
zapisany dla tego `itemId` blokował import na zawsze, nawet po tym, jak odbiorca świadomie
usunął swoją kopię i nadawca udostępnił przepis ponownie.
**Pliki:** `js/ui.js`, `js/app.js`, `js/firebase-sync.js`, `index.html`, `css/style.css`, `sw.js`
**Uwagi:** import ustawia nowe pole `shared: true` na obiekcie przepisu — wsteczna
zgodność zachowana, bo filtr „Własne” to `!r.shared`, więc stare przepisy bez tego pola
trafiają tam domyślnie. Przełączenie zakładki jest czysto lokalnym stanem UI
(`recipeTabFilter` w `ui.js`), nie synchronizowanym — świeżo zaimportowany przepis nie
przełącza widoku automatycznie, trzeba samemu kliknąć „Udostępnione”. Naprawa buga: `itemId`
w skrzynce `sharedRecipes` to teraz świeży `crypto.randomUUID()` generowany przy każdym
wywołaniu „Udostępnij”, nie `recipe.id` nadawcy — każde udostępnienie tego samego przepisu
tworzy nowy, unikalny wpis w skrzynce odbiorcy, więc `seenSharedRecipeIds` już go nie myli
z poprzednim.

## [w toku — niezacommitowane] 2026-07-19 — Udostępnianie przepisów partnerowi (dwa konta Firebase)
**Co:** przycisk „Udostępnij” na karcie przepisu w widoku „Przepisy” wysyła kopię przepisu
(nazwa, składniki, waga po ugotowaniu, wartości na 100g) na konto partnera — osobne konto
Google/Firebase drugiej osoby, skonfigurowane wcześniej w Ustawieniach polem „UID partnera”
(własne UID widoczne w Ustawieniach po zalogowaniu, do skopiowania i przesłania partnerowi).
Przy najbliższej synchronizacji przepis pojawia się automatycznie na liście przepisów drugiej
osoby (bez potwierdzenia — to tylko dopisanie do listy, nie zalogowanie kcal), skąd może
użyć istniejącego „Dodaj porcję”, żeby zadeklarować własną zjedzoną gramaturę.
**Dlaczego:** dwie osoby używające aplikacji na osobnych kontach czasem gotują i jedzą to
samo danie, ale w innych porcjach — ręczne przepisywanie tego samego przepisu przez obie
osoby było zbędną pracą. Nie skopiowano gotowego wpisu dziennika (stałe kcal dla konkretnej
gramatury), tylko sam przepis, bo każda osoba je inną ilość.
**Pliki:** `js/storage.js`, `js/firebase-sync.js`, `js/ui.js`, `index.html`, `sw.js`
**Uwagi:** nowa kolekcja Firestore `sharedRecipes/{recipientUid}/inbox/{itemId}` jest
świadomym wyjątkiem od zasady 1 z CLAUDE.md (nagrobki + `merge*` dla każdej synchronizowanej
kolekcji) — to jednorazowa skrzynka odbiorcza, nie stan replikowany między urządzeniami
tego samego użytkownika: dokument jest usuwany z Firestore od razu po imporcie, a lokalny
`seenSharedRecipeIds` w `storage.js` (czysto lokalny, niesynchronizowany) chroni przed
duplikatem, gdyby usunięcie się nie powiodło. Reguły bezpieczeństwa Firestore trzeba dopisać
ręcznie w konsoli Firebase (repo nie zawiera pliku `.rules`) — patrz `docs/ARCHITECTURE.md`.

## [w toku — niezacommitowane] 2026-07-19 — Raport odżywczy: analiza dnia względem własnych celów (AI)
**Co:** nowa funkcja „Raport odżywczy” w widoku dnia — przycisk „+ Nowa analiza” wysyła
listę posiłków z danego dnia do Gemini razem z wybranym, zapisanym wcześniej „celem
analizy” (własny system prompt, np. ocena spożycia żelaza z uwzględnieniem czynników
wchłaniania). Cele zarządzane w Ustawieniach → „Cele analizy dnia” (dodaj/edytuj/usuń,
nazwa + treść system promptu). Dodano też globalne pole „Profil zdrowotny” (wiek, płeć,
stan fizjologiczny itp.), dołączane automatycznie do każdej analizy jako kontekst. Wynik
zapisuje się per dzień+cel (nadpisuje poprzedni przy ponownym uruchomieniu) i jest widoczny
po przeładowaniu jako rozwijana karta z kolorowym oznaczeniem (dobrze/neutralnie/uwaga).
**Dlaczego:** appka liczy makra, ale nie mikroelementy ani interakcje wchłaniania —
użytkownik chciał okazjonalnej, głębszej analizy dnia pod kątem konkretnego celu (np.
żelazo przy niedoborach) bez trzymania tej logiki na sztywno w kodzie, żeby móc dodawać
własne cele (sód, cukry proste, witaminy...) samodzielnie przez UI.
**Pliki:** `js/storage.js`, `js/ocr.js`, `js/firebase-sync.js`, `js/ui.js`, `js/app.js`,
`index.html`, `css/style.css`, `sw.js`
**Uwagi:** appka celowo nie ustala schematu JSON per cel — dokleja do każdego user-owego
system promptu stały, generyczny fragment (`GOAL_RESPONSE_FORMAT` w `ocr.js`) wymuszający
jeden kształt odpowiedzi (`meals[].flag`, `daily_summary`, `data_gaps`...), dzięki czemu
jeden renderer w `ui.js` (`renderAnalysisBody`) obsługuje dowolny cel bez zmian w kodzie.
Nowe kolekcje `analysisGoals` (lista, id) i `dailyAnalyses` (mapa `"YYYY-MM-DD__goalId"`)
mają nagrobki + `merge*` + push/pull do Firestore (`meta/goals`, `meta/dailyAnalyses`),
zgodnie z zasadą 1 z CLAUDE.md. Usunięcie celu w Ustawieniach nie kasuje wcześniej
zapisanych raportów (trzymają snapshot `goalName` w chwili analizy). Zweryfikowane w
przeglądarce: dodanie/edycja/usunięcie celu, uruchomienie analizy (błąd przy braku klucza
API pokazuje czytelny komunikat), zapis i rozwijanie karty raportu, trwałość po
przeładowaniu, usuwanie raportu, brak regresji w istniejącym dodawaniu/usuwaniu wpisów
przy pustym dniu (wcześniejszy wczesny `return` w `renderDiary` pomijał renderowanie
sekcji raportu przy braku wpisów — poprawione).

## [w toku — niezacommitowane] 2026-07-18 — Edycja składnika przepisu po kliknięciu karty
**Co:** kliknięcie karty składnika na liście w kreatorze przepisu otwiera teraz jego
edycję (nazwa, gramatura, makra na 100g) — wcześniej karta miała tylko przycisk usuwania.
**Dlaczego:** po dodaniu składników przez AI/dyktowanie/zrzut ekranu użytkownik często
musi poprawić pojedynczą wartość (np. źle rozpoznaną gramaturę), a jedyną opcją było
usunięcie całego składnika i ręczne dodanie go od nowa.
**Pliki:** `js/ui.js`, `css/style.css`, `sw.js`
**Uwagi:** funkcja edycji (`openIngredientModal(editIdx)` + `saveIngredient()`
nadpisujący `recipeIngredients[ingredientEditIndex]`) już istniała i była używana przez
`+ Dodaj`/edycję zapisanego przepisu — brakowało tylko wpięcia kliknięcia karty. Przycisk
usuwania woła `e.stopPropagation()`, więc klik w „×” nie otwiera przy okazji edycji.
Zweryfikowane w przeglądarce: klik w kartę wypełnia formularz poprawnymi danymi, zapis
nadpisuje ten sam wpis (nie duplikuje), usuwanie działa niezależnie od edycji.

## [w toku — niezacommitowane] 2026-07-18 — Dyktowanie przepisu: nagranie audio + transkrypcja Gemini zamiast Web Speech API
**Co:** „Dyktuj przepis" zastąpione „Nagraj przepis" — zamiast rozpoznawania mowy na żywo
w przeglądarce, mikrofon teraz nagrywa dźwięk (można wstrzymać/wznowić w trakcie tego
samego nagrania), a po kliknięciu „Wyślij nagranie do AI" całe nagranie trafia jednym
requestem do Gemini, które zwraca przepisany tekst wstawiany do pola przepisu. Jest też
„Odrzuć nagranie" do anulowania bez wysyłki.
**Dlaczego:** trzy poprawki tego samego dnia (patrz wpisy niżej) nie rozwiązały trwale
duplikowania tekstu w Web Speech API na Androidzie — nawet rezygnacja z `continuous=true`
na rzecz łańcucha krótkich sesji nadal nie dawała satysfakcjonującego efektu w praktyce na
urządzeniu użytkownika. Transkrypcja całego nagrania za jednym razem przez Gemini nie ma
tej klasy błędów, bo nie polega na niestabilnej segmentacji w locie po stronie silnika
przeglądarki/systemu.
**Pliki:** `js/voice.js`, `js/ocr.js`, `js/ui.js`, `js/app.js`, `index.html`, `sw.js`
**Uwagi:** `Voice.startContinuous` (Web Speech API) usunięte całkowicie z `voice.js` —
zastąpione `Voice.createAudioRecorder()` (MediaRecorder: start/pause/resume/stopAndGetBlob/
discard). `Voice.listenOnce` (rozpoznawanie jednorazowe, używane gdzie indziej — szybkie
dodawanie posiłku głosem, wyszukiwanie składnika) zostaje bez zmian, bo nie miało tego
problemu. Nowa funkcja `Ocr.transcribeAudio(blob, apiKey)` wysyła nagranie jako
`inline_data` do Gemini i zwraca surowy tekst (nie JSON, w przeciwieństwie do reszty
promptów w `ocr.js`). Zweryfikowane w przeglądarce mockiem `getUserMedia`/`MediaRecorder`/
`fetch` — pełny przepływ nagraj → pauza → wznów → wyślij → tekst w polu, oraz osobno
„odrzuć nagranie".

## [w toku — niezacommitowane] 2026-07-18 — Dyktowanie: rezygnacja z continuous=true (trzecia próba)
**Co:** dyktowanie przepisu na Androidzie nadal powielało tekst mimo dwóch wcześniejszych
poprawek tego samego dnia — tym razem w jeszcze bardziej chaotyczny sposób, mieszając
narastające pełne frazy z pojedynczymi słowami w nieprzewidywalnej kolejności
(„25 25 25 25 dag … 25 dag ryżu do sushi 10 25 dag ryżu do sushi 10 g … wędzonego łososia”).
**Dlaczego:** obie poprzednie poprawki próbowały odgadnąć i naprawić duplikaty parsując
wzorce w `event.results` z założeniem, że silnik zachowuje się w miarę przewidywalnie
(albo identyczne powtórzone eventy, albo czyste progresywne rozszerzenia). Realne
zachowanie silnika Androida w trybie `continuous=true` jest znacznie bardziej niestabilne
niż oba te założenia — nie da się tego niezawodnie odgadnąć samym parsowaniem po fakcie.
**Pliki:** `js/voice.js`, `sw.js`, `index.html`
**Uwagi:** zamiast łatać duplikaty, usunięto `continuous=true` z korzenia problemu.
`startContinuous` teraz otwiera krótkie, pojedyncze sesje (`continuous=false`, jak
działający od dawna `listenOnce`) i sam odpowiada za „ciągłość", automatycznie tworząc
nową sesję po każdym `onend`, dopóki użytkownik nie kliknie stop. Każda sesja daje więc
z definicji dokładnie jeden finalny wynik — nie ma czego duplikować. Usunięto
`mergeFinalChunks()` z poprzedniej (nieudanej) próby jako zbędny. Zweryfikowane w
przeglądarce mockiem `SpeechRecognition` sterowanym krok po kroku (bez zagnieżdżonych
`setTimeout`, które w tym środowisku testowym nie odpalają się poprawnie) — dwie kolejne
sesje po auto-restarcie dają poprawnie sklejony tekst bez duplikatów.

## [w toku — niezacommitowane] 2026-07-18 — Fix powielania słów przy dyktowaniu na Androidzie
**Co:** dyktowanie przepisu na Androidzie nadal wstawiało powielony, narastający tekst
(np. „25 25 25 g 25 g 25 g ryżu 25 g ryżu do sushi” zamiast „25 g ryżu do sushi”) mimo
poprzedniej poprawki tego samego dnia.
**Dlaczego:** poprzedni fix zakładał, że duplikaty to identyczne powtórzone zdarzenia
`onresult` dla tego samego wyniku. Na Androidzie rozpoznawanie mowy w trybie `continuous`
finalizuje ten sam wypowiedziany fragment wielokrotnie jako **osobne, kolejno
doprecyzowywane** wpisy w `event.results` („25” → „25 g” → „25 g ryżu” → „25 g ryżu do
sushi”), więc samo sumowanie wszystkich `isFinal` wpisów nadal je doklejało zamiast
zastępować.
**Pliki:** `js/voice.js`, `sw.js`, `index.html`
**Uwagi:** dodano `mergeFinalChunks()` — jeśli kolejny finalny fragment jest powtórzeniem
lub rozszerzeniem (`startsWith`) poprzedniego, zastępuje go zamiast doklejać. Zweryfikowane
w przeglądarce mockiem `SpeechRecognition` odtwarzającym dokładnie ten wzorzec progresywnych
rewizji, oraz ponownie scenariuszem identycznych duplikatów z poprzedniej poprawki. Przy
okazji wykryto, że pierwszy fix tego dnia nie był widoczny w testach lokalnie, bo service
worker serwował starą wersję `voice.js` z cache `CACHE_NAME` sprzed tej zmiany — przypomnienie,
że bump wersji musi iść w tym samym kroku co edycja JS, inaczej własne testy w przeglądarce
łapią stary kod.

## [w toku — niezacommitowane] 2026-07-18 — Fix powielania słów przy dyktowaniu przepisu
**Co:** dyktowanie przepisu głosem przestało wstawiać to samo słowo kilka razy pod rząd
(np. „gruszka gruszka gruszka gruszka”).
**Dlaczego:** `Voice.startContinuous` doklejał (`+=`) każdy finalny fragment mowy do
`finalTranscript`, a Chrome w trybie `continuous`/`interimResults` potrafi wielokrotnie
wywołać `onresult` dla tego samego już-finalnego wyniku — każde powtórzenie dodawało to
samo słowo ponownie.
**Pliki:** `js/voice.js`, `sw.js`
**Uwagi:** naprawa przelicza finalny tekst bieżącej sesji rozpoznawania od zera z całej
tablicy `event.results` (idempotentnie) zamiast doklejać przyrostowo, a przy `onend`
(w tym przy auto-restarcie po ciszy) scala go z tekstem poprzednich sesji, żeby nic się
nie zgubiło. Zweryfikowane w przeglądarce mockiem `SpeechRecognition` symulującym
duplikaty zdarzeń oraz restart sesji.

## [w toku — niezacommitowane] 2026-07-18 — Numer wersji w Ustawieniach
**Co:** obok nagłówka „Ustawienia" (od razu widoczny, bez przewijania) widać teraz „vN" —
pozwala sprawdzić na telefonie, czy po wdrożeniu przeglądarka wczytała już nową wersję,
czy jeszcze serwuje starą.
**Dlaczego:** aplikacja jest PWA z cache'em stale-while-revalidate; bez widocznego numeru
nie było łatwego sposobu odróżnienia „nowa wersja się nie wczytała" od „nic się nie zmieniło".
**Pliki:** `index.html`, `sw.js`, `docs/MAINTENANCE.md`
**Uwagi:** to zwykły statyczny tekst w `index.html`, nie odczyt z service workera — `index.html`
jest jedynym zasobem serwowanym network-first, więc jako jedyny gwarantuje zgodność wyświetlanego
numeru z tym, co faktycznie jest teraz na ekranie. Numer trzeba bumpować ręcznie razem z
`CACHE_NAME` w `sw.js` (dopisane do checklisty C1 w `MAINTENANCE.md`) — świadomie bez
mechanizmu automatycznego, żeby nie dodawać message-passing do service workera dla
jednorazowej, personalnej apki.

## [w toku — niezacommitowane] 2026-07-18 — Dyktowanie przepisu: mikrofon tylko nagrywa, wysyłka ręczna
**Co:** przycisk mikrofonu w kreatorze przepisu przełącza wyłącznie nasłuch (start/pauza/
wznowienie) i dopisuje rozpoznaną mowę do pola tekstowego — nie wysyła nic do Gemini
samoczynnie. Wysyłkę do AI wykonuje wyłącznie istniejący przycisk „Przeanalizuj przepis”,
kiedy użytkownik uzna dyktowanie za skończone.
**Dlaczego:** poprzednia wersja (commit `bf33cad`) sama wysyłała tekst do Gemini po każdym
zatrzymaniu nasłuchu, więc przy trzecim z rzędu dyktowaniu do tego samego przepisu ponowna
analiza całego (coraz dłuższego) tekstu przez AI czasem gubiła wcześniej rozpoznane składniki
i nadpisywała listę. Oddzielenie „nagrywania” od „wysyłki” daje użytkownikowi pełną kontrolę
nad tym, kiedy dokładnie tekst trafia do Gemini, i sprowadza to zwykle do jednej wysyłki na
cały przepis zamiast wielu wysyłek narastającego tekstu.
**Pliki:** `js/ui.js`, `sw.js`
**Uwagi:** `Voice.startContinuous()` (dodane w poprzedniej zmianie) zostaje bez zmian —
zmieniło się tylko to, co `js/ui.js` robi w callbacku `onEnd` (aktualizacja statusu zamiast
wywołania `Ocr.analyzeRecipeText`). `parseRecipeWithAi` nadal nadpisuje całą listę składników
wynikiem najnowszej analizy (jak przy wklejaniu tekstu) — jeśli użytkownik świadomie kliknie
„Przeanalizuj przepis” kilka razy z rzędu zamiast raz na końcu, nadal może stracić wcześniej
rozpoznane składniki, jeśli AI inaczej sparsuje dłuższy tekst. To świadomy kompromis: prosty,
przewidywalny model „jedno pole tekstowe → jedna analiza → jedna lista składników”, spójny
z zachowaniem wklejania tekstu i zrzutu ekranu.

## [bf33cad] 2026-07-18 — Dyktowanie przepisu: start/stop zamiast jednorazowego nasłuchu
**Co:** przycisk „Dyktuj przepis" działa teraz jako przełącznik start/stop zamiast
jednorazowego nasłuchu kończącego się po pierwszej pauzie w mowie. Rozpoznana mowa
dokleja się do wcześniej podyktowanego tekstu zamiast go nadpisywać, a zapytanie do
Gemini leci dopiero po kliknięciu stop — raz, z pełnym tekstem.
**Dlaczego:** Chrome kończy rozpoznawanie mowy po chwili ciszy nawet z `continuous=true`;
przy starym jednorazowym `Voice.listenOnce()` każda pauza wysyłała częściowy tekst do
Gemini i nadpisywała już rozpoznane składniki przy kolejnym kliknięciu mikrofonu.
**Pliki:** `js/voice.js`, `js/ui.js`, `sw.js`
**Uwagi:** `Voice.startContinuous()` sam wznawia rozpoznawanie po `onend`, jeśli
użytkownik nie kliknął jawnie stop — dzięki temu pauzy w dyktowaniu są niewidoczne dla
użytkownika. `Voice.listenOnce()` zostaje bez zmian, używany w innych miejscach
(nazwa produktu, etykieta).

## [w toku — niezacommitowane] 2026-07-18 — Przepisy z przeliczaniem porcji
**Co:** budowanie przepisów ze składników (skan etykiety, kod kreskowy, głos, AI, ulubione),
przeliczanie makr na 100 g dania po ugotowaniu i dodawanie porcji do dziennika.
**Dlaczego:** dania gotowane w domu wymagały ręcznego liczenia makr przy każdej porcji.
**Pliki:** `index.html`, `css/style.css`, `js/ui.js`, `js/storage.js`, `js/ocr.js`,
`js/firebase-sync.js`, `js/app.js`, `sw.js`
**Uwagi:** nowa kolekcja `recipes` w localStorage — ma nagrobki, `mergeRecipes`,
`pushRecipes`/`pullRecipes` i obsługę w eksporcie/imporcie. Waga po ugotowaniu jest
opcjonalna; bez niej przelicznik używa sumy wag surowych składników.

## [cc99eaf] 2026-07-17 — Zwijane sekcje ostatnich i ulubionych posiłków
**Co:** produkty ostatnio używane i ulubione jako zwijane sekcje w modalu wpisu, synchronizowane.
**Dlaczego:** lista chipów zajmowała pół ekranu na telefonie.
**Pliki:** `index.html`, `css/style.css`, `js/ui.js`, `js/storage.js`, `js/firebase-sync.js`, `sw.js`
**Uwagi:** `favoriteProducts` to pierwsza kolekcja globalna (poza dniami) z pełnym cyklem synca.

## [212cb13] 2026-07-16 — Waga ciała, kategorie posiłków, relog, błonnik
**Co:** pole wagi w dzienniku + wykres trendu 90 dni; kategorie śniadanie/obiad/kolacja/przekąska
z grupowaniem; ponowne dodanie wpisu jednym tapnięciem; błonnik jako piąty składnik.
**Dlaczego:** Faza 4 planu.
**Pliki:** `index.html`, `css/style.css`, `js/ui.js`, `js/storage.js`, `js/ocr.js`,
`js/barcode.js`, `js/firebase-sync.js`, `sw.js`
**Uwagi:** błonnik przeszedł przez wszystkie ścieżki wejścia (formularz, OCR, AI,
Open Food Facts) i cele w ustawieniach — wzorzec do naśladowania przy dodawaniu kolejnego
składnika. Waga używa mapy po dacie zamiast tablicy, z osobnym `mergeWeights`.

## [98b1959] 2026-07-16 — Skaner kodów, zdjęcie posiłku, wykres tygodniowy
**Co:** `BarcodeDetector` + Open Food Facts z fallbackiem ręcznego kodu; szacowanie makr
całej porcji ze zdjęcia przez Gemini; wykres kcal z 7 dni i średnie makr w Historii.
**Pliki:** `index.html`, `css/style.css`, `js/ui.js`, `js/ocr.js`, `js/barcode.js`, `sw.js`
**Uwagi:** `BarcodeDetector` nie istnieje w Safari — ścieżka ręcznego wpisania kodu jest
obowiązkowa, nie ozdobna.

## [4aaddc0] 2026-07-16 — Poprawki synca i SW, ostatnio używane produkty
**Co:** naprawa błędów synchronizacji i service workera; chipy ostatnio używanych produktów
z przeliczaniem wartości na 100 g.
**Uwagi:** tu wprowadzono nagrobki (`deleted: true`) — wcześniej usunięcia wracały po syncu.
Wtedy też ustalono strategię SW: network-first dla nawigacji, stale-while-revalidate dla zasobów.

## [1c5def3 … 2edcc98] 2026-07-15/16 — Wejście przez AI: zrzut ekranu i głos
**Co:** makra ze zrzutu ekranu innej aplikacji lub przepisu; wpis głosowy (dyktowanie makr
albo opisu jedzenia); edycja istniejących wpisów z polem godziny.
**Pliki:** `js/ocr.js`, `js/voice.js`, `js/ui.js`, `index.html`, `sw.js`

## [2a977f9] 2026-07-15 — Odświeżenie wizualne
**Co:** nowy kolor akcentu, awatary wpisów, kropki statusu w historii.

## [f90ec76] 2026-07-15 — Wersja początkowa
**Co:** szkielet PWA, storage na localStorage, widok dzienny, formularz ręczny, OCR etykiet
przez Gemini, ustawienia, historia, eksport/import JSON, synchronizacja Firebase.

---

## Odrzucone i świadomie odłożone

Nie wracaj do tych tematów bez wyraźnej prośby użytkownika:

| Temat | Powód |
|---|---|
| Wielojęzyczność | aplikacja dla jednego polskojęzycznego użytkownika |
| Realtime sync (`onSnapshot`) | sync przy logowaniu i zapisie wystarcza, mniej zapytań do darmowego tieru |
| Framework / bundler / npm | zero kroku budowania to celowa decyzja, deploy = `git push` |
| Backend własny | koszt; Firebase w darmowym tierze pokrywa potrzeby |
| Testy automatyczne | koszt utrzymania większy niż zysk przy tej skali; zamiast tego checklista ręczna |
| Czyszczenie nagrobków | rozmiar pomijalny, ryzyko regresji synca realne |
