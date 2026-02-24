function createSpeechEngine({ onInterim, onFinal, onError, onEnd }) {
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return null;
  }

  var recognition = null;
  var finalTranscript = '';
  var running = false;

  function start() {
    finalTranscript = '';
    running = true;

    recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
          if (onFinal) onFinal(finalTranscript);
        } else {
          interim += transcript;
        }
      }
      if (onInterim) onInterim(finalTranscript, interim);
    };

    recognition.onerror = function (event) {
      if (event.error === 'aborted') return;
      if (onError) onError(event.error);
    };

    recognition.onend = function () {
      running = false;
      if (onEnd) onEnd(finalTranscript);
    };

    recognition.start();
  }

  function stop() {
    if (recognition && running) {
      recognition.stop();
    }
  }

  function reset() {
    finalTranscript = '';
    if (recognition) {
      try { recognition.abort(); } catch (e) {}
      recognition = null;
    }
    running = false;
  }

  return { start: start, stop: stop, reset: reset };
}
