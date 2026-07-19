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
