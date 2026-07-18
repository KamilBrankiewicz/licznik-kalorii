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

    let finalTranscript = '';
    let stoppedByUser = false;
    let recognition = null;

    function createRecognition() {
      const r = new SpeechRecognition();
      r.lang = 'pl-PL';
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;

      r.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript = (finalTranscript ? finalTranscript + ' ' : '') + chunk.trim();
          } else {
            interim += chunk;
          }
        }
        onResult({ finalTranscript, interim });
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
