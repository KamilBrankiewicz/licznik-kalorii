const Voice = (() => {
  function isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function listenOnce() {
    return new Promise((resolve, reject) => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        reject(new Error('NOT_SUPPORTED'));
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'pl-PL';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      let settled = false;

      recognition.onresult = (event) => {
        settled = true;
        const transcript = event.results[0]?.[0]?.transcript?.trim();
        if (transcript) {
          resolve(transcript);
        } else {
          reject(new Error('NO_SPEECH'));
        }
      };

      recognition.onerror = (event) => {
        settled = true;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          reject(new Error('PERMISSION_DENIED'));
        } else if (event.error === 'no-speech') {
          reject(new Error('NO_SPEECH'));
        } else {
          reject(new Error('RECOGNITION_ERROR'));
        }
      };

      recognition.onend = () => {
        if (!settled) reject(new Error('NO_SPEECH'));
      };

      recognition.start();
    });
  }

  // Nasłuchuje w trybie ciągłym, aż wywołasz stop() na zwróconym kontrolerze.
  //
  // Celowo NIE używamy continuous=true silnika rozpoznawania. Na Androidzie wewnętrzna
  // segmentacja continuous jest niestabilna — potrafi wielokrotnie "finalizować" ten sam
  // fragment jako osobne wpisy w event.results, w dodatku w nieprzewidywalnej kolejności
  // (raz jako narastająca cała fraza, raz jako pojedyncze nowe słowo), więc żadne łatanie
  // tego po fakcie (próbowaliśmy dwa razy) nie jest niezawodne.
  //
  // Zamiast tego każda sesja to pojedyncze, krótkie rozpoznanie (jak listenOnce) —
  // silnik zwraca dokładnie jeden finalny wynik i sam kończy nasłuch po pauzie w mowie
  // (onend). "Ciągłość" dyktowania zapewniamy sami: po każdym onend automatycznie
  // tworzymy nową sesję, chyba że użytkownik sam kliknął stop. Dzięki temu pauza w
  // dyktowaniu nie kończy sesji ani nie kasuje tego, co już rozpoznano — a każdy
  // finalny fragment pojawia się w tekście dokładnie raz.
  function startContinuous({ onResult, onError, onEnd }) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      onError(new Error('NOT_SUPPORTED'));
      return null;
    }

    let finalTranscript = ''; // tekst zatwierdzony w poprzednich (zakończonych) sesjach
    let stoppedByUser = false;
    let recognition = null;

    function createRecognition() {
      const r = new SpeechRecognition();
      r.lang = 'pl-PL';
      r.continuous = false;
      r.interimResults = true;
      r.maxAlternatives = 1;

      let sessionFinal = '';

      r.onresult = (event) => {
        let interim = '';
        for (let i = 0; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            sessionFinal = chunk.trim();
          } else {
            interim += chunk;
          }
        }
        const combined = finalTranscript
          ? (sessionFinal ? `${finalTranscript} ${sessionFinal}`.trim() : finalTranscript)
          : sessionFinal;
        onResult({ finalTranscript: combined, interim: sessionFinal ? '' : interim });
      };

      r.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          stoppedByUser = true;
          onError(new Error('PERMISSION_DENIED'));
        } else {
          stoppedByUser = true;
          onError(new Error('RECOGNITION_ERROR'));
        }
      };

      r.onend = () => {
        finalTranscript = finalTranscript ? `${finalTranscript} ${sessionFinal}`.trim() : sessionFinal;
        sessionFinal = '';

        if (stoppedByUser) {
          onEnd(finalTranscript);
        } else {
          try {
            recognition = createRecognition();
            recognition.start();
          } catch (e) {
            onEnd(finalTranscript);
          }
        }
      };

      return r;
    }

    recognition = createRecognition();
    recognition.start();

    return {
      stop() {
        stoppedByUser = true;
        recognition.stop();
      }
    };
  }

  return { isSupported, listenOnce, startContinuous };
})();
