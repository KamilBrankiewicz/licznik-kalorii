const Ocr = (() => {
  const PROMPT_LABEL = `Przeanalizuj zdjęcie etykiety wartości odżywczych produktu spożywczego.
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
  "fat": number
}

Zasady:
- Jeśli w wypowiedzi podano wprost kalorie i/lub makroskładniki, użyj dokładnie tych wartości.
- Jeśli podano tylko opis jedzenia (i ewentualnie porcję), oszacuj typowe wartości odżywcze dla CAŁEJ opisanej porcji.
- Wartości kcal/protein/carbs/fat dotyczą całego posiłku, NIE 100g produktu.
Jeśli nie da się rozpoznać żadnego jedzenia w wypowiedzi, zwróć: {"error": "nie rozpoznano jedzenia"}`;

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const payload = { contents: [{ parts }] };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  return { analyzeLabel, analyzeVoiceEntry };
})();
