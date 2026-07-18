const Voice = (() => {
  function isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  // Rozpoznawanie mowy na Androidzie (i czasem Chrome desktop) w trybie continuous
  // potrafi "finalizować" ten sam wypowiedziany fragment kilka razy z rzędu, za każdym
  // razem jako osobny wpis w event.results, stopniowo doprecyzowując treść: "25", "25",
  // "25 g", "25 g", "25 g ryżu", "25 g ryżu do sushi". Sklejenie tych wpisów wprost dałoby
  // "25 25 25 g 25 g 25 g ryżu 25 g ryżu do sushi". Traktujemy każdy kolejny finalny
  // fragment, który jest powtórzeniem lub rozszerzeniem poprzedniego, jako jego rewizję —
  // zastępujemy nim poprzedni zamiast doklejać.
  function mergeFinalChunks(chunks) {
    const merged = [];
    for (const chunk of chunks) {
      const prev = merged[merged.length - 1];
      if (prev !== undefined && (chunk === prev || chunk.startsWith(prev))) {
        merged[merged.length - 1] = chunk;
      } else if (prev !== undefined && prev.startsWith(chunk)) {
        // nowy fragment to podzbiór już zapisanego — nic nowego do dodania
      } else {
        merged.push(chunk);
      }
    }
    return merged.join(' ');
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
  // Chrome i tak potrafi ubić rozpoznawanie po chwili ciszy (nawet z continuous=true) —
  // dlatego po każdym "onend" wznawiamy je automatycznie, chyba że użytkownik sam
  // kliknął stop. Dzięki temu pauza w dyktowaniu nie kończy sesji ani nie kasuje
  // tego, co już rozpoznano.
  function startContinuous({ onResult, onError, onEnd }) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      onError(new Error('NOT_SUPPORTED'));
      return null;
    }

    // finalTranscript = tekst zatwierdzony w poprzednich sesjach (przed każdym auto-restartem).
    // lastSessionFinal = tekst finalny bieżącej sesji, przeliczany od zera przy każdym onresult
    // (nie doklejany), bo Chrome w trybie continuous potrafi wielokrotnie wywołać onresult dla
    // tego samego już-finalnego wyniku — inkrementalne += powielało wtedy słowa.
    let finalTranscript = '';
    let lastSessionFinal = '';
    let stoppedByUser = false;
    let recognition = null;

    function createRecognition() {
      const r = new SpeechRecognition();
      r.lang = 'pl-PL';
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;

      r.onresult = (event) => {
        const finalChunks = [];
        let interim = '';
        for (let i = 0; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript.trim();
          if (event.results[i].isFinal) {
            if (chunk) finalChunks.push(chunk);
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        const sessionFinal = mergeFinalChunks(finalChunks);
        lastSessionFinal = sessionFinal;
        const combined = finalTranscript ? `${finalTranscript} ${sessionFinal}`.trim() : sessionFinal;
        onResult({ finalTranscript: combined, interim });
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
        finalTranscript = finalTranscript ? `${finalTranscript} ${lastSessionFinal}`.trim() : lastSessionFinal;
        lastSessionFinal = '';

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
