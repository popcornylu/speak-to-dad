(function () {
  // --- DOM ---
  var textDisplayArea = document.getElementById('text-display-area');
  var textContent = document.getElementById('text-content');
  var recordBtn = document.getElementById('record-btn');
  var statusText = document.getElementById('status-text');
  var editOverlay = document.getElementById('edit-overlay');
  var editTextarea = document.getElementById('edit-textarea');
  var editOk = document.getElementById('edit-ok');
  var editCancel = document.getElementById('edit-cancel');
  var clearBtn = document.getElementById('clear-btn');

  // --- State ---
  var state = 'idle'; // idle | recording | displaying | editing
  var displayText = '';
  var speechEngine = null;

  // --- Audio level ---
  var recordBtnWrap = document.getElementById('record-btn-wrap');
  var volumeBar = document.getElementById('volume-bar');
  var volumeFill = document.getElementById('volume-fill');
  var audioCtx = null;
  var analyser = null;
  var micStream = null;
  var micSource = null;
  var levelRaf = null;

  // --- Long press detection ---
  var longPressTimer = null;
  var LONG_PRESS_MS = 600;

  // --- Init ---
  function init() {
    speechEngine = createSpeechEngine({
      onInterim: handleInterim,
      onFinal: handleFinal,
      onError: handleError,
      onEnd: handleEnd
    });

    if (!speechEngine) {
      textContent.textContent = '您的瀏覽器不支援語音辨識，請使用 Safari 開啟';
      textContent.classList.add('placeholder');
      recordBtn.disabled = true;
      return;
    }

    showPlaceholder();
    bindEvents();
  }

  function showPlaceholder() {
    textContent.textContent = '按住下方按鈕開始說話';
    textContent.classList.add('placeholder');
    textContent.style.fontSize = '';
  }

  // --- Audio level monitoring ---
  function startAudioLevel() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      micStream = stream;
      micSource = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      micSource.connect(analyser);

      volumeBar.classList.add('active');
      recordBtnWrap.classList.add('recording-active');
      pollLevel();
    }).catch(function () {
      // mic denied — speech engine will also error, handled there
    });
  }

  function pollLevel() {
    if (!analyser) return;
    var data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    var sum = 0;
    for (var i = 0; i < data.length; i++) sum += data[i];
    var avg = sum / data.length; // 0–255
    var vol = Math.min(avg / 80, 1); // normalise so speech is near 1

    volumeFill.style.width = (vol * 100) + '%';

    if (vol > 0.15) {
      recordBtnWrap.classList.add('has-voice');
    } else {
      recordBtnWrap.classList.remove('has-voice');
    }

    levelRaf = requestAnimationFrame(pollLevel);
  }

  function stopAudioLevel() {
    if (levelRaf) { cancelAnimationFrame(levelRaf); levelRaf = null; }
    if (micStream) {
      micStream.getTracks().forEach(function (t) { t.stop(); });
      micStream = null;
    }
    if (micSource) { micSource.disconnect(); micSource = null; }
    analyser = null;
    volumeBar.classList.remove('active');
    volumeFill.style.width = '0%';
    recordBtnWrap.classList.remove('recording-active', 'has-voice');
  }

  // --- Recording ---
  function startRecording() {
    if (state === 'editing') return;
    state = 'recording';
    recordBtn.classList.add('recording');
    statusText.textContent = '聆聽中...';
    speechEngine.start();
    startAudioLevel();
  }

  function stopRecording() {
    if (state !== 'recording') return;
    speechEngine.stop();
    recordBtn.classList.remove('recording');
    statusText.textContent = '按住說話';
    stopAudioLevel();
  }

  // --- Speech callbacks ---
  function handleInterim(finalPart, interimPart) {
    textContent.classList.remove('placeholder');
    var fullText = displayText + finalPart;
    if (interimPart) {
      textContent.innerHTML = escapeHtml(fullText) +
        '<span class="interim">' + escapeHtml(interimPart) + '</span>';
    } else {
      textContent.textContent = fullText;
    }
    fitText(textContent, textDisplayArea);
  }

  function handleFinal(finalPart) {
    textContent.classList.remove('placeholder');
    textContent.textContent = displayText + finalPart;
    fitText(textContent, textDisplayArea);
  }

  function handleEnd(sessionText) {
    if (sessionText) {
      displayText += sessionText;
    }
    state = 'displaying';
    textContent.classList.remove('placeholder');
    if (displayText) {
      textContent.textContent = displayText;
      fitText(textContent, textDisplayArea);
    } else {
      showPlaceholder();
      state = 'idle';
    }
  }

  function handleError(error) {
    if (error === 'not-allowed') {
      textContent.textContent = '請允許麥克風權限後重試';
      textContent.classList.add('placeholder');
    }
    recordBtn.classList.remove('recording');
    statusText.textContent = '按住說話';
    stopAudioLevel();
    state = displayText ? 'displaying' : 'idle';
  }

  // --- Edit mode ---
  function enterEditMode() {
    if (!displayText) return;
    state = 'editing';
    editTextarea.value = displayText;
    editOverlay.classList.remove('hidden');
    editTextarea.focus();
  }

  function exitEditMode(save) {
    if (save) {
      displayText = editTextarea.value;
      if (displayText) {
        textContent.textContent = displayText;
        fitText(textContent, textDisplayArea);
      } else {
        showPlaceholder();
      }
    }
    editOverlay.classList.add('hidden');
    state = displayText ? 'displaying' : 'idle';
  }

  // --- Event binding ---
  function bindEvents() {
    // Record button — touch
    recordBtn.addEventListener('touchstart', function (e) {
      e.preventDefault();
      startRecording();
    });
    recordBtn.addEventListener('touchend', function (e) {
      e.preventDefault();
      stopRecording();
    });
    recordBtn.addEventListener('touchcancel', function (e) {
      e.preventDefault();
      stopRecording();
    });

    // Record button — mouse (desktop testing)
    recordBtn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      startRecording();
    });
    recordBtn.addEventListener('mouseup', function (e) {
      e.preventDefault();
      stopRecording();
    });
    recordBtn.addEventListener('mouseleave', function (e) {
      if (state === 'recording') stopRecording();
    });

    // Long press on text area
    textDisplayArea.addEventListener('touchstart', function (e) {
      if (state !== 'displaying') return;
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        enterEditMode();
      }, LONG_PRESS_MS);
    });
    textDisplayArea.addEventListener('touchmove', function () {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    textDisplayArea.addEventListener('touchend', function () {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    // Clear button
    clearBtn.addEventListener('click', function () {
      if (state === 'recording' || state === 'editing') return;
      displayText = '';
      showPlaceholder();
      state = 'idle';
    });

    // Edit overlay buttons
    editOk.addEventListener('click', function () { exitEditMode(true); });
    editCancel.addEventListener('click', function () { exitEditMode(false); });

    // Resize handler
    window.addEventListener('resize', function () {
      if (displayText && (state === 'displaying' || state === 'idle')) {
        fitText(textContent, textDisplayArea);
      }
    });

    // Prevent default touch behaviors on app container
    document.getElementById('app').addEventListener('touchmove', function (e) {
      if (state !== 'editing') {
        e.preventDefault();
      }
    }, { passive: false });
  }

  // --- Utility ---
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Start ---
  init();
})();
