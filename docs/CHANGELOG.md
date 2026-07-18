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
