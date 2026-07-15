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

  return { isSupported, listenOnce };
})();
