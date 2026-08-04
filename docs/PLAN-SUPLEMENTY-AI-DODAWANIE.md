# Plan implementacji: dodawanie suplementów/leków ze zdjęcia etykiety i po nazwie (AI)

> Dokument dla modelu LLM (Sonnet 5.0) implementującego rozszerzenie modułu suplementów.
> Wykonuj fazy **po kolei**, nie łącz ich w jeden krok. Po każdej fazie przejdź jej kryteria
> akceptacji. Zanim zaczniesz, przeczytaj `CLAUDE.md` (zasady nienaruszalne) oraz
> `docs/PLAN-MODUL-SUPLEMENTY.md` (model danych modułu) — ten plan z nich korzysta
> i żadnego punktu nie uchyla.

## Cel

Dwa nowe sposoby dodawania suplementu/leku, oba wypełniające **istniejący formularz**
(modal `#suppModalOverlay`), który użytkownik przegląda i zatwierdza ręcznie:

1. **📷 Ze zdjęcia etykiety** — zdjęcie opakowania → Gemini → wypełniony formularz.
2. **🔍 Znajdź po nazwie** — użytkownik wpisuje nazwę (np. „Ibuprom Max") → Gemini
   z groundingiem Google Search → wypełniony formularz.

Do tego rozszerzenie modelu danych definicji suplementu o pola, które te przepływy
wypełniają (skład, forma, typ, wielkość opakowania, zalecenia, ostrzeżenia), oraz
wykorzystanie składu w istniejącej analizie AI suplementów.

**Nic nie zapisuje się bez zatwierdzenia przez użytkownika.** AI tylko wypełnia formularz.

## Twarde ograniczenia (przeczytaj dwa razy)

1. **Żadnych nowych plików JS.** Kod idzie do istniejących: `ocr.js`, `ui.js`, `app.js`,
   `index.html`, `css/style.css`, `sw.js`. `storage.js` tylko jeśli faza tego wymaga.
2. **Żadnych bibliotek, npm, bundlera.** Vanilla JS, wzorce 1:1 z istniejącego kodu.
3. **Wszystkie stringi UI po polsku.** Prompty do Gemini również po polsku.
4. `ui.js` nigdy nie woła `localStorage` bezpośrednio — tylko przez `Storage.*`.
5. `app.js` zawiera wyłącznie `addEventListener` delegujące do `UI.*` — zero logiki.
6. Każdy zapis rekordu ustawia `updatedAt: new Date().toISOString()`.
7. **Wsteczna zgodność modelu danych.** Istniejące rekordy suplementów NIE mają nowych
   pól. Każdy odczyt nowego pola z wartością domyślną (`s.ingredients || []`,
   `s.type || 'supplement'`). Żadnej migracji zapisanych danych.
8. Klucz Gemini pochodzi wyłącznie z ustawień użytkownika (`Storage.getSettings()`),
   jak w istniejących wywołaniach. Nigdy w kodzie, nigdy w logach.
9. Każda ścieżka błędu (brak klucza, brak sieci, błąd API, nierozpoznana etykieta)
   kończy się czytelnym polskim komunikatem — wzoruj się na istniejącej obsłudze
   błędów `Ocr.*` w `ui.js`. Żadnych cichych `catch`.
10. Na końcu: bump `CACHE_NAME` w `sw.js` o 1 **oraz** parametrów `?v=N` przy
    `<script>`/`<link>` w `index.html` — obie rzeczy razem, zawsze.

## Rozszerzenie modelu danych

Definicja suplementu (klucz localStorage `supplements`) zyskuje pola — wszystkie
**opcjonalne**, stare rekordy działają bez nich:

```js
{
  // …istniejące pola bez zmian (id, name, displayName, dose, timing, scheduleType,
  // scheduleDays, scheduleN, cycleOn, cycleOff, anchorDate, timesPerDay,
  // stockBaseline, stockBaselineDate, stock, notes, active, updatedAt)…

  type: 'supplement',         // 'supplement' | 'medication'; domyślnie 'supplement'
  form: 'kapsułka',           // 'tabletka' | 'kapsułka' | 'krople' | 'proszek' | 'płyn' | 'inna'; domyślnie brak
  servingSize: '1 kapsułka',  // string; co znaczy „jedna dawka"
  packageSize: 60,            // liczba sztuk/porcji w opakowaniu; null = nieznane
  brand: 'Solgar',            // producent/marka; string, opcjonalne
  ingredients: [              // substancje czynne; domyślnie []
    { name: 'Witamina D3', amount: 2000, unit: 'IU', rws: 1000 }
    // unit ∈ 'mg' | 'µg' | 'g' | 'IU' | 'ml' | inne stringi z etykiety
    // rws = % referencyjnej wartości spożycia; number lub null
  ],
  instructions: 'przyjmować z posiłkiem zawierającym tłuszcz', // zalecenia; string
  warnings: 'nie łączyć z…',  // ostrzeżenia/interakcje z etykiety lub od AI; string
  source: 'photo'             // 'photo' | 'ai' | 'manual'; jak powstał rekord
}
```

Zasady:
- **Nie przechowujemy** pełnych ulotek, opisów działania ani „dawek maksymalnych
  z internetu" — tylko fakty o konkretnym produkcie.
- Nagrobki, merge (`mergeSupplements`), sync Firestore (`meta/supplements`) i
  eksport/import **nie wymagają zmian** — cały obiekt definicji już podróżuje w całości.
  Zweryfikuj to w Fazie 1, nie zakładaj.

---

## FAZA 1 — Model danych i formularz (index.html, ui.js, css/style.css)

Rozszerz istniejący modal suplementu o nowe pola. Bez AI — najpierw ma działać ręcznie.

### 1.1 Nowe pola formularza (`index.html`, modal `#suppModalOverlay`)

Kolejność w formularzu (wstaw po polu „Dawka"):

- **Typ**: segmentowany przełącznik 2 przyciski „Suplement" / „Lek"
  (`#suppTypeSelect`, wzór: istniejący `#suppTimingSelect`). Domyślnie „Suplement".
- **Forma**: `<select id="suppFormSelect">` z opcjami: (puste „—"), tabletka, kapsułka,
  krople, proszek, płyn, inna.
- **Wielkość opakowania**: `<input type="number" id="suppPackageSize">` z podpisem
  „szt. w opakowaniu (opcjonalnie)".
- **Producent/marka**: `<input type="text" id="suppBrand">` (opcjonalnie).
- **Skład** — sekcja zwijana (wzór: istniejące zwijane sekcje w aplikacji, jeśli są;
  inaczej `<details>`): dynamiczna lista wierszy `nazwa | ilość | jednostka | %RWS`
  z przyciskiem „+ Dodaj składnik" i „✕" przy każdym wierszu. Kontener
  `#suppIngredientsList`. Jednostka jako `<select>`: mg, µg, g, IU, ml, inna
  (przy „inna" pokaż input tekstowy).
- **Zalecenia przyjmowania**: `<input type="text" id="suppInstructions">`
  (placeholder „np. z posiłkiem, na czczo").
- **Ostrzeżenia**: `<input type="text" id="suppWarnings">` (opcjonalnie).

Pole `servingSize` NIE dostaje osobnego inputu — wypełnia je AI, a użytkownik widzi
je doklejone do dawki tylko jeśli chce (trzymaj w zmiennej stanu formularza i zapisuj;
przy ręcznym dodawaniu zostaje puste).

### 1.2 Logika formularza (`ui.js`)

- `openSupplementModal(suppId)`: wypełnij nowe pola z rekordu z domyślnymi
  (`supp.type || 'supplement'`, `supp.ingredients || []` itd.). Wyrenderuj wiersze składu.
- `saveSupplementFromForm()`: zbierz nowe pola do `data`. Walidacja składu: wiersz bez
  nazwy jest pomijany; `amount` przez `Number(...) || null`; pusty skład = `[]`.
- Renderowanie listy suplementów: przy pozycji typu `medication` pokaż mały badge „lek"
  (klasa CSS, subtelny — wzór: istniejące badge/chipy w aplikacji). Jeśli rekord ma
  `brand`, pokaż w podtytule obok dawki. **Nie rozbudowuj listy bardziej.**

### 1.3 `app.js`

Tylko `addEventListener` dla: przełącznika typu, przycisku „+ Dodaj składnik"
(delegacja do `UI.*`), usuwania wiersza składnika (delegacja zdarzeń na kontenerze).

### Kryteria akceptacji Fazy 1

- [ ] Ręczne dodanie suplementu z 2 składnikami, typem „lek", formą i opakowaniem —
      zapis, przeładowanie strony, edycja: wszystkie pola wracają poprawnie.
- [ ] Stary rekord (bez nowych pól) otwiera się w edycji bez błędów w konsoli,
      z pustym składem i typem „Suplement"; zapisanie go nie psuje istniejących pól.
- [ ] Usunięcie suplementu nadal tworzy nagrobek; sync/eksport działają jak dotąd.
- [ ] Zero odwołań do `localStorage` w `ui.js`, zero logiki w `app.js`.

---

## FAZA 2 — Ocr: analiza etykiety i wyszukiwanie po nazwie (js/ocr.js)

### 2.1 Wariant `callGemini` z narzędziami

Istniejące `callGemini(parts, apiKey)` buduje payload `{ contents: [{ parts }] }`.
Dodaj trzeci, opcjonalny parametr `extraPayload` scalany z payloadem:

```js
async function callGemini(parts, apiKey, extraPayload) {
  // …
  const payload = { contents: [{ parts }], ...(extraPayload || {}) };
```

Nie zmieniaj żadnego istniejącego wywołania. Ekstrakcja JSON (regex `\{[\s\S]*\}`)
zostaje bez zmian — działa też przy odpowiedziach z groundingiem.

### 2.2 `analyzeSupplementLabel(file, apiKey)`

Wzór 1:1: `analyzeLabel` (resize → base64 → `callGemini` z promptem + `inline_data`).

Prompt (stała `PROMPT_SUPP_LABEL`, po polsku) — wymagania:
- Zdjęcie przedstawia opakowanie/etykietę suplementu diety lub leku.
- Zwróć WYŁĄCZNIE JSON, bez tekstu przed/po, w formacie:

```json
{
  "name": "pełna nazwa produktu z opakowania",
  "brand": "producent lub null",
  "type": "supplement | medication",
  "form": "tabletka | kapsułka | krople | proszek | płyn | inna | null",
  "servingSize": "porcja wg etykiety, np. '1 kapsułka', lub null",
  "packageSize": 60,
  "dose": "krótki opis dawki do wyświetlania, np. '2000 IU' lub '200 mg'",
  "ingredients": [ { "name": "…", "amount": 2000, "unit": "IU", "rws": 1000 } ],
  "instructions": "zalecenia przyjmowania z etykiety lub null",
  "warnings": "istotne ostrzeżenia z etykiety (krótko) lub null",
  "suggestedTiming": "morning | noon | evening | any"
}
```

- `packageSize` jako liczba lub null. `rws` jako liczba (procent) lub null.
- `suggestedTiming` wywnioskuj z zaleceń (np. „na noc" → evening); gdy brak podstaw → "any".
- Jeśli zdjęcie nie przedstawia etykiety suplementu/leku → `{ "error": "not_recognized" }`
  (istniejący mechanizm `NOT_RECOGNIZED` w `callGemini` to obsłuży).
- Przepisuj dane z etykiety, **nie dopowiadaj** składników, których nie widać.

### 2.3 `lookupSupplementByName(name, apiKey)`

Tekstowy prompt (stała `PROMPT_SUPP_LOOKUP` z `%NAME%`), wywołany **z groundingiem**:

```js
return callGemini([{ text: prompt }], apiKey, { tools: [{ google_search: {} }] });
```

Format odpowiedzi: identyczny JSON jak w 2.2. Dodatkowe wymagania promptu:
- Znajdź konkretny produkt dostępny w Polsce o podanej nazwie; jeśli nazwa wskazuje
  wiele wariantów (różne dawki), wybierz najpopularniejszy. Uwagi tego typu umieszczaj
  w dodatkowym polu `"note": "string lub null"` (tylko w odpowiedzi wyszukiwania),
  nie w `instructions`.
- Skład podawaj tylko, jeśli znalazłeś dane produktu; nie zgaduj. Gdy produkt
  nierozpoznany → `{ "error": "not_recognized" }`.
- Dla leków podaj substancję czynną w `ingredients` (np. ibuprofen 200 mg).

**Fallback groundingu:** jeśli wywołanie z `tools` zwróci błąd HTTP (`API_ERROR`),
wykonaj jedną próbę ponowną bez `tools` (sama wiedza modelu). Dopiero błąd drugiej
próby propaguj wyżej.

### 2.4 Eksport

Dodaj obie funkcje do zwracanego obiektu publicznego `Ocr`.

### Kryteria akceptacji Fazy 2

- [ ] Żadne istniejące wywołanie `callGemini` nie zmieniło zachowania (przejrzyj diff).
- [ ] Obie funkcje rzucają istniejące kody błędów (`NO_API_KEY`, `NETWORK_ERROR`,
      `API_ERROR`, `PARSE_ERROR`, `NOT_RECOGNIZED`) — żadnych nowych kodów.
- [ ] Prompty po polsku, format JSON w prompcie zgodny z modelem danych z Fazy 1.

---

## FAZA 3 — UI przepływów AI (index.html, ui.js, app.js, css/style.css)

### 3.1 Punkty wejścia

W modalu suplementu, nad polem „Nazwa", dodaj rząd dwóch przycisków (widoczny tylko
przy **nowym** suplemencie, ukryty przy edycji):

- „📷 Ze zdjęcia etykiety" → ukryty `<input type="file" accept="image/*" capture="environment">`
  (wzór: istniejące wejście zdjęcia etykiety posiłku).
- „🔍 Znajdź po nazwie" → jeśli pole `#suppName` puste, pokaż błąd „Najpierw wpisz nazwę";
  inaczej uruchom wyszukiwanie dla wpisanej nazwy.

### 3.2 Przebieg

1. Pokaż stan ładowania (wzór: istniejący spinner/toast przy analizie etykiety posiłku;
   zablokuj oba przyciski na czas wywołania).
2. Wywołaj odpowiednią funkcję `Ocr.*` z kluczem z `Storage.getSettings()`.
3. Sukces → wypełnij pola formularza wynikiem:
   - `name`, `brand`, `dose`, `type`, `form`, `packageSize`, `instructions`, `warnings`,
     skład → wiersze w `#suppIngredientsList`, `suggestedTiming` → zaznacz przycisk timingu.
   - `packageSize` dodatkowo wpisz do pola zapasu `#suppStock`, **tylko jeśli pole
     zapasu jest puste**.
   - `note` (z wyszukiwania) doklej do pola notatek, jeśli niepuste.
   - Zapamiętaj w stanie formularza `source: 'photo'` lub `'ai'` oraz `servingSize`;
     `saveSupplementFromForm()` dołącza je do `data`. Przy czysto ręcznym wypełnieniu
     `source: 'manual'`.
   - Pod formularzem pokaż dopisek (klasa `.hint` lub istniejący odpowiednik):
     „Dane wypełnione przez AI — sprawdź przed zapisem."
4. Błąd → polski komunikat w `#suppFormError` (mapowanie kodów jak przy istniejących
   funkcjach Ocr: brak klucza → „Uzupełnij klucz Gemini w Ustawieniach", `NOT_RECOGNIZED`
   → „Nie rozpoznano produktu — wypełnij dane ręcznie" itd.). Formularz zostaje otwarty,
   nic nie nadpisuj.

Użytkownik może po wypełnieniu edytować każde pole. Zapis wyłącznie istniejącym
przyciskiem zapisu formularza.

### 3.3 `app.js`

Wyłącznie `addEventListener` (click obu przycisków, `change` inputu pliku) delegujące
do `UI.*`.

### Kryteria akceptacji Fazy 3

- [ ] Zdjęcie etykiety realnego suplementu wypełnia formularz; po zatwierdzeniu rekord
      ma skład, formę, `source: 'photo'`; po przeładowaniu dane przetrwały.
- [ ] Wyszukanie po nazwie znanego produktu wypełnia formularz (`source: 'ai'`).
- [ ] Brak klucza Gemini → czytelny komunikat, formularz dalej działa ręcznie.
- [ ] Zdjęcie niebędące etykietą → komunikat „Nie rozpoznano…", pola nietknięte.
- [ ] Przy edycji istniejącego suplementu przyciski AI są ukryte.
- [ ] Tryb offline: przyciski AI zwracają komunikat o braku sieci, reszta formularza działa.

---

## FAZA 4 — Skład w analizie AI suplementów (js/ocr.js lub ui.js)

Znajdź miejsce, gdzie budowany jest `payload.supplements` dla `Ocr.analyzeSupplements`
(budowa payloadu jest w `ui.js`). Wzbogać każdy element o nowe pola, jeśli istnieją:
`type`, `ingredients`, `form`, `instructions`. **Nie wysyłaj**: `brand`, `packageSize`,
`stock*`, `source` (szum dla analizy). Pola puste/domyślne pomijaj, żeby nie puchł prompt.

W prompcie `analyzeSupplements` (sekcja zadań lub opis danych) dopisz jedno zdanie:
skład (`ingredients`) jest przepisany z etykiet — wykorzystuj go do wykrywania
dublowania składników i sumowania dawek zamiast zgadywać skład po nazwie.

### Kryteria akceptacji Fazy 4

- [ ] Analiza suplementów działa dla mieszanki rekordów starych (bez składu) i nowych.
- [ ] Payload nie zawiera pól zapasu, marki ani `source`.

---

## FAZA 5 — Finalizacja

1. Bump `CACHE_NAME` w `sw.js` o 1 (sprawdź aktualną wartość w pliku, nie zakładaj)
   **i** parametry `?v=N` w `index.html` — spójnie.
2. `docs/CHANGELOG.md` — wpis z datą i opisem funkcji.
3. `PLAN.md`, sekcja „Stan realizacji" — odnotuj wykonanie.
4. `docs/ARCHITECTURE.md` — dopisz nowe pola definicji suplementu do opisu modelu danych.
5. Checklista z `docs/MAINTENANCE.md`: test w przeglądarce — dodanie wpisu posiłku,
   przeładowanie, dane przetrwały; dodanie suplementu ręcznie i (jeśli dostępny klucz)
   przez AI; przeładowanie; edycja.

## Poza zakresem (nie implementuj)

- Skanowanie kodów kreskowych leków (baza leków nie jest w Open Food Facts).
- Sumaryczny dzienny bilans witamin/minerałów w UI (przyszła iteracja — dane już będą).
- Przechowywanie ulotek, opisów działania, interakcji „z internetu" poza polem `warnings`.
- Zmiany w dzienniku przyjęć (`supplementLog`) — ten plan go nie dotyka.
