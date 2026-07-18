const Ocr = (() => {
  const PROMPT_LABEL = `Przeanalizuj zdjęcie etykiety wartości odżywczych produktu spożywczego.
Zwróć WYŁĄCZNIE JSON w formacie:
{
  "name": "nazwa produktu jeśli widoczna, inaczej null",
  "per100g": {
    "kcal": number,
    "protein": number,
    "carbs": number,
    "fat": number,
    "fiber": number lub null jeśli błonnik nie jest podany na etykiecie
  }
}
Jeśli nie rozpoznajesz etykiety, zwróć: {"error": "nie rozpoznano etykiety"}`;

  const PROMPT_VOICE = `Jesteś asystentem do liczenia kalorii. Użytkownik podał głosowo opis posiłku, który właśnie zjadł: "%TRANSCRIPT%"

To może być:
(a) dokładne dane — nazwa i kalorie/makroskładniki podane wprost w wypowiedzi, albo
(b) sam opis jedzenia i porcji (np. "duży banan", "talerz makaronu z sosem pomidorowym"), bez podanych wartości liczbowych.

Zwróć WYŁĄCZNIE JSON w formacie:
{
  "name": "nazwa posiłku/produktu",
  "grams": number lub null jeśli gramatura nieznana,
  "kcal": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "fiber": number lub null jeśli nieznany
}

Zasady:
- Jeśli w wypowiedzi podano wprost kalorie i/lub makroskładniki, użyj dokładnie tych wartości.
- Jeśli podano tylko opis jedzenia (i ewentualnie porcję), oszacuj typowe wartości odżywcze dla CAŁEJ opisanej porcji (w tym błonnik).
- Wartości kcal/protein/carbs/fat/fiber dotyczą całego posiłku, NIE 100g produktu.
Jeśli nie da się rozpoznać żadnego jedzenia w wypowiedzi, zwróć: {"error": "nie rozpoznano jedzenia"}`;

  const PROMPT_SCREENSHOT = `Przeanalizuj zrzut ekranu (screenshot) zrobiony na telefonie. Może pochodzić z aplikacji do liczenia kalorii, aplikacji dostawy jedzenia, sklepu spożywczego, przepisu kulinarnego lub podobnego źródła i przedstawiać wartości odżywcze posiłku lub produktu.

Zwróć WYŁĄCZNIE JSON w formacie:
{
  "name": "nazwa posiłku/produktu jeśli widoczna, inaczej null",
  "grams": number lub null jeśli gramatura/wielkość porcji nieznana,
  "kcal": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "fiber": number lub null jeśli niewidoczny
}

Zasady:
- Wartości kcal/protein/carbs/fat/fiber dotyczą CAŁEJ pokazanej porcji/posiłku, NIE 100g produktu (chyba że ekran jednoznacznie pokazuje wyłącznie wartości na 100g — wtedy zwróć te wartości i ustaw grams na 100).
- Jeśli na ekranie widoczna jest tylko liczba kalorii bez makroskładników, zwróć kcal oraz oszacuj brakujące makroskładniki na podstawie typowych proporcji dla tego typu posiłku.
Jeśli zrzut ekranu nie zawiera żadnych danych o wartościach odżywczych, zwróć: {"error": "nie rozpoznano danych"}`;

  const PROMPT_MEAL = `Przeanalizuj zdjęcie posiłku (jedzenie na talerzu, w misce, w opakowaniu itp.).
Zidentyfikuj co to za posiłek, oszacuj wielkość porcji w gramach oraz wartości odżywcze CAŁEJ widocznej porcji.

Zwróć WYŁĄCZNIE JSON w formacie:
{
  "name": "krótka nazwa posiłku po polsku",
  "grams": number lub null jeśli trudno oszacować,
  "kcal": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "fiber": number lub null jeśli trudno oszacować
}

Zasady:
- Szacuj realistycznie na podstawie widocznych składników, wielkości porcji i typowych receptur.
- Wartości kcal/protein/carbs/fat/fiber dotyczą CAŁEJ widocznej porcji, NIE 100g produktu.
- Przy niepewności wybieraj wartości typowe/środkowe, nie skrajne.
Jeśli na zdjęciu nie widać jedzenia, zwróć: {"error": "nie rozpoznano jedzenia"}`;

  function resizeImageToBase64(file, maxSize = 1024) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Nie udało się odczytać pliku'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Nie udało się wczytać obrazu'));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = Math.round((height * maxSize) / width);
              width = maxSize;
            } else {
              width = Math.round((width * maxSize) / height);
              height = maxSize;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(dataUrl.split(',')[1]);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function callGemini(parts, apiKey) {
    if (!apiKey) {
      throw new Error('NO_API_KEY');
    }

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
    const payload = { contents: [{ parts }] };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw new Error('NETWORK_ERROR');
    }

    if (!response.ok) {
      throw new Error('API_ERROR');
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('PARSE_ERROR');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('PARSE_ERROR');

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error('PARSE_ERROR');
    }

    if (parsed.error) throw new Error('NOT_RECOGNIZED');

    return parsed;
  }

  async function analyzeLabel(file, apiKey) {
    const base64 = await resizeImageToBase64(file);
    return callGemini(
      [
        { text: PROMPT_LABEL },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ],
      apiKey
    );
  }

  async function analyzeVoiceEntry(transcript, apiKey) {
    const prompt = PROMPT_VOICE.replace('%TRANSCRIPT%', transcript);
    return callGemini([{ text: prompt }], apiKey);
  }

  async function analyzeScreenshot(file, apiKey) {
    const base64 = await resizeImageToBase64(file);
    return callGemini(
      [
        { text: PROMPT_SCREENSHOT },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ],
      apiKey
    );
  }

  async function analyzeMealPhoto(file, apiKey) {
    const base64 = await resizeImageToBase64(file);
    return callGemini(
      [
        { text: PROMPT_MEAL },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ],
      apiKey
    );
  }

  const PROMPT_RECIPE = `Przeanalizuj tekst przepisu kulinarnego podany przez użytkownika. Zidentyfikuj wszystkie składniki, przelicz miary kuchenne (łyżki, szklanki, sztuki itp.) na gramy i oszacuj wartości odżywcze na 100g dla każdego składnika.

Tekst przepisu:
"%RECIPE_TEXT%"

Zwróć WYŁĄCZNIE JSON w formacie:
{
  "name": "nazwa przepisu jeśli można ją wywnioskować, inaczej null",
  "ingredients": [
    {
      "name": "nazwa składnika",
      "grams": number (waga w gramach),
      "per100g": {
        "kcal": number,
        "protein": number,
        "carbs": number,
        "fat": number,
        "fiber": number lub null
      }
    }
  ]
}

Zasady:
- Przeliczaj WSZYSTKIE miary na gramy: 1 łyżka = 15g (płynów/oleju) lub 10-12g (sypkich), 1 łyżeczka = 5g, 1 szklanka = 250ml, 1 dag = 10g
- Sztuki przeliczaj na typową wagę: 1 ogórek ≈ 300g, 1 awokado ≈ 150g (miąższ), 1 jajko ≈ 60g
- Wartości per100g to standardowe wartości odżywcze na 100g danego składnika (NIE na porcję)
- Podawaj realistyczne, typowe wartości odżywcze
- Jeśli nie rozpoznajesz żadnych składników, zwróć: {"error": "nie rozpoznano przepisu"}`;

  async function analyzeRecipeText(text, apiKey) {
    const prompt = PROMPT_RECIPE.replace('%RECIPE_TEXT%', text);
    return callGemini([{ text: prompt }], apiKey);
  }

  const PROMPT_RECIPE_IMAGE = `Przeanalizuj zdjęcie/zrzut ekranu przepisu kulinarnego (może być zrzutem ekranu ze strony, aplikacji, notatki lub zdjęciem przepisu z książki/kartki). Zidentyfikuj wszystkie składniki, przelicz miary kuchenne (łyżki, szklanki, sztuki itp.) na gramy i oszacuj wartości odżywcze na 100g dla każdego składnika.

Zwróć WYŁĄCZNIE JSON w formacie:
{
  "name": "nazwa przepisu jeśli widoczna lub można ją wywnioskować, inaczej null",
  "ingredients": [
    {
      "name": "nazwa składnika",
      "grams": number (waga w gramach),
      "per100g": {
        "kcal": number,
        "protein": number,
        "carbs": number,
        "fat": number,
        "fiber": number lub null
      }
    }
  ]
}

Zasady:
- Przeliczaj WSZYSTKIE miary na gramy: 1 łyżka = 15g (płynów/oleju) lub 10-12g (sypkich), 1 łyżeczka = 5g, 1 szklanka = 250ml, 1 dag = 10g
- Sztuki przeliczaj na typową wagę: 1 ogórek ≈ 300g, 1 awokado ≈ 150g (miąższ), 1 jajko ≈ 60g
- Wartości per100g to standardowe wartości odżywcze na 100g danego składnika (NIE na porcję)
- Podawaj realistyczne, typowe wartości odżywcze
- Jeśli na obrazie nie widać listy składników przepisu, zwróć: {"error": "nie rozpoznano przepisu"}`;

  const PROMPT_INGREDIENT_LOOKUP = `Użytkownik podał nazwę lub krótki opis pojedynczego składnika kulinarnego (wpisany ręcznie lub podyktowany głosowo): "%TEXT%"

Podaj typowe wartości odżywcze na 100g dla tego składnika.

Zwróć WYŁĄCZNIE JSON w formacie:
{
  "name": "nazwa składnika (poprawiona/znormalizowana forma)",
  "per100g": {
    "kcal": number,
    "protein": number,
    "carbs": number,
    "fat": number,
    "fiber": number lub null jeśli trudno oszacować
  }
}

Zasady:
- Wartości per100g to standardowe, typowe wartości odżywcze na 100g SUROWEGO/BAZOWEGO produktu (chyba że opis jednoznacznie wskazuje na formę przetworzoną, np. "ugotowany ryż" — wtedy uwzględnij to)
- Przy niepewności wybieraj wartości typowe/środkowe dla danego typu produktu
Jeśli nie rozpoznajesz żadnego składnika w podanym tekście, zwróć: {"error": "nie rozpoznano składnika"}`;

  async function analyzeIngredientLookup(text, apiKey) {
    const prompt = PROMPT_INGREDIENT_LOOKUP.replace('%TEXT%', text);
    return callGemini([{ text: prompt }], apiKey);
  }

  async function analyzeRecipeImage(file, apiKey) {
    const base64 = await resizeImageToBase64(file);
    return callGemini(
      [
        { text: PROMPT_RECIPE_IMAGE },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ],
      apiKey
    );
  }

  const PROMPT_TRANSCRIBE = `Przepisz dokładnie to nagranie głosowe na tekst po polsku. Zwróć WYŁĄCZNIE surowy przepisany tekst, bez żadnych dodatkowych komentarzy, cudzysłowów, wprowadzeń ani formatowania.`;

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Nie udało się odczytać nagrania'));
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  async function transcribeAudio(blob, apiKey) {
    if (!apiKey) throw new Error('NO_API_KEY');

    const base64 = await blobToBase64(blob);
    const mimeType = blob.type || 'audio/webm';

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
    const payload = {
      contents: [{
        parts: [
          { text: PROMPT_TRANSCRIBE },
          { inline_data: { mime_type: mimeType, data: base64 } }
        ]
      }]
    };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw new Error('NETWORK_ERROR');
    }

    if (!response.ok) {
      throw new Error('API_ERROR');
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('PARSE_ERROR');

    return text;
  }

  return { analyzeLabel, analyzeVoiceEntry, analyzeScreenshot, analyzeMealPhoto, analyzeRecipeText, analyzeRecipeImage, analyzeIngredientLookup, transcribeAudio };
})();
