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

  function isRecordingSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  const PREFERRED_MIME_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg'];

  function pickMimeType() {
    return PREFERRED_MIME_TYPES.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  }

  // Nagrywa dźwięk z mikrofonu do wysłania jako plik audio do Gemini (transkrypcja),
  // zamiast polegać na wbudowanym w przeglądarkę rozpoznawaniu mowy. Web Speech API w
  // trybie ciągłym okazało się na Androidzie zbyt niestabilne (patrz historia w
  // docs/CHANGELOG.md — trzy próby naprawy duplikatów tekstu). Nagranie audio + jeden
  // request do Gemini nie ma tego problemu, bo transkrypcja odbywa się raz, na całości
  // nagrania, a nie w locie po każdym słowie.
  //
  // Zwraca kontroler: pause()/resume() do wstrzymywania i wznawiania w trakcie tego
  // samego nagrania (MediaRecorder), stopAndGetBlob() do zakończenia i pobrania gotowego
  // pliku audio, oraz discard() do anulowania i zwolnienia mikrofonu bez wysyłki.
  function createAudioRecorder() {
    let mediaRecorder = null;
    let stream = null;
    let chunks = [];
    let mimeType = '';

    async function start() {
      if (!isRecordingSupported()) throw new Error('NOT_SUPPORTED');

      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        throw new Error('PERMISSION_DENIED');
      }

      mimeType = pickMimeType();
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.start();
    }

    function pause() {
      if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.pause();
    }

    function resume() {
      if (mediaRecorder && mediaRecorder.state === 'paused') mediaRecorder.resume();
    }

    function stopTracks() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    }

    function stopAndGetBlob() {
      return new Promise((resolve, reject) => {
        if (!mediaRecorder) {
          reject(new Error('NOT_STARTED'));
          return;
        }
        if (mediaRecorder.state === 'inactive') {
          const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          stopTracks();
          resolve(blob);
          return;
        }
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          stopTracks();
          resolve(blob);
        };
        mediaRecorder.stop();
      });
    }

    function discard() {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (e) { /* już zatrzymany */ }
      }
      stopTracks();
    }

    return { start, pause, resume, stopAndGetBlob, discard };
  }

  return { isSupported, listenOnce, isRecordingSupported, createAudioRecorder };
})();
