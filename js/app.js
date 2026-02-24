(function () {
  // --- DOM ---
  var textDisplayArea = document.getElementById('text-display-area');
  var textContent = document.getElementById('text-content');
  var recordBtn = document.getElementById('record-btn');
  var statusText = document.getElementById('status-text');
  var keyboardBtn = document.getElementById('keyboard-btn');
  var hiddenInput = document.getElementById('hidden-input');
  var clearBtn = document.getElementById('clear-btn');

  // --- State ---
  var state = 'idle'; // idle | recording | displaying | editing
  var displayText = '';
  var cursorPos = 0;
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
  var longPressTriggered = false;
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
    textContent.innerHTML = '按住下方按鈕開始說話';
    textContent.classList.add('placeholder');
    textContent.style.fontSize = '';
  }

  // --- Render helpers ---
  function renderText() {
    if (!displayText) {
      showPlaceholder();
      return;
    }
    textContent.classList.remove('placeholder');
    var before = escapeHtml(displayText.slice(0, cursorPos));
    var after = escapeHtml(displayText.slice(cursorPos));
    textContent.innerHTML = before + '<span class="fake-caret">\u200B</span>' + after;
    fitText(textContent, textDisplayArea);
  }

  function renderInterimAtCursor(finalPart, interimPart) {
    textContent.classList.remove('placeholder');
    var before = escapeHtml(displayText.slice(0, cursorPos));
    var after = escapeHtml(displayText.slice(cursorPos));
    var html = before + escapeHtml(finalPart);
    if (interimPart) {
      html += '<span class="interim">' + escapeHtml(interimPart) + '</span>';
    }
    html += after;
    textContent.innerHTML = html;
    fitText(textContent, textDisplayArea);
  }

  // --- DOM cursor helpers ---
  function getCursorPosFromSelection() {
    var sel = window.getSelection();
    if (!sel.rangeCount) return cursorPos;

    var range = sel.getRangeAt(0);
    // Create a range from start of textContent to cursor position
    var preRange = document.createRange();
    preRange.selectNodeContents(textContent);
    preRange.setEnd(range.startContainer, range.startOffset);
    // Get text length before cursor (excluding zero-width spaces from fake caret)
    var text = preRange.toString().replace(/\u200B/g, '');
    return text.length;
  }

  function setCursorPosInDom(pos) {
    var sel = window.getSelection();
    var range = document.createRange();

    // Walk text nodes to find the right position
    var remaining = pos;
    var walker = document.createTreeWalker(textContent, NodeFilter.SHOW_TEXT, null, false);
    var node;
    var found = false;

    while ((node = walker.nextNode())) {
      // Skip zero-width space nodes (fake caret content)
      var nodeText = node.textContent.replace(/\u200B/g, '');
      if (nodeText.length === 0) continue;

      if (remaining <= nodeText.length) {
        // Account for zero-width spaces in offset calculation
        var actualOffset = 0;
        var counted = 0;
        for (var i = 0; i < node.textContent.length; i++) {
          if (node.textContent[i] !== '\u200B') {
            if (counted === remaining) break;
            counted++;
          }
          actualOffset++;
        }
        range.setStart(node, actualOffset);
        range.collapse(true);
        found = true;
        break;
      }
      remaining -= nodeText.length;
    }

    if (!found) {
      // Place at end
      range.selectNodeContents(textContent);
      range.collapse(false);
    }

    sel.removeAllRanges();
    sel.addRange(range);
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
  var wasEditing = false;

  function startRecording() {
    if (state === 'editing') {
      wasEditing = true;
      // Read current text from hidden input before recording
      displayText = hiddenInput.value;
      cursorPos = hiddenInput.selectionStart || 0;
      hiddenInput.blur();
    }
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
    renderInterimAtCursor(finalPart, interimPart);
  }

  function handleFinal(finalPart) {
    renderInterimAtCursor(finalPart, '');
  }

  function handleEnd(sessionText) {
    if (sessionText) {
      var before = displayText.slice(0, cursorPos);
      var after = displayText.slice(cursorPos);
      displayText = before + sessionText + after;
      cursorPos += sessionText.length;
    }

    if (wasEditing) {
      wasEditing = false;
      enterEditMode();
    } else if (displayText) {
      state = 'displaying';
      renderText();
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
    wasEditing = false;
    statusText.textContent = '按住說話';
    stopAudioLevel();
    state = displayText ? 'displaying' : 'idle';
  }

  // --- Edit mode ---
  function syncHiddenInput() {
    hiddenInput.value = displayText;
    hiddenInput.setSelectionRange(cursorPos, cursorPos);
  }

  function enterEditMode() {
    state = 'editing';
    document.body.classList.add('edit-mode');

    // Render with fake caret then focus hidden input
    renderText();
    syncHiddenInput();
    hiddenInput.focus();
  }

  function exitEditMode() {
    hiddenInput.blur();
    document.body.classList.remove('edit-mode');

    if (displayText) {
      state = 'displaying';
      renderText();
    } else {
      state = 'idle';
      cursorPos = 0;
      showPlaceholder();
    }
  }

  // --- Tap to position cursor ---
  function handleTapToPosition(e) {
    if (state !== 'displaying' && state !== 'idle') return;
    if (!displayText) return;
    if (longPressTriggered) return;

    var x, y;
    if (e.changedTouches) {
      x = e.changedTouches[0].clientX;
      y = e.changedTouches[0].clientY;
    } else {
      x = e.clientX;
      y = e.clientY;
    }

    // Use caretRangeFromPoint (WebKit) or caretPositionFromPoint
    var range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }

    if (range) {
      // Temporarily set selection to get cursor position
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      cursorPos = getCursorPosFromSelection();
      sel.removeAllRanges();
      // Clamp
      if (cursorPos > displayText.length) cursorPos = displayText.length;
      if (cursorPos < 0) cursorPos = 0;
      renderText();
    }
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

    // Hidden input — sync edits back to display
    hiddenInput.addEventListener('input', function () {
      if (state !== 'editing') return;
      displayText = hiddenInput.value;
      cursorPos = hiddenInput.selectionStart || 0;
      renderText();
    });

    // Track cursor movement in hidden input
    hiddenInput.addEventListener('keyup', function () {
      if (state !== 'editing') return;
      cursorPos = hiddenInput.selectionStart || 0;
      renderText();
    });

    // Long press on text area — touch
    textDisplayArea.addEventListener('touchstart', function (e) {
      if (state !== 'displaying' && state !== 'idle') return;
      longPressTriggered = false;
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        longPressTriggered = true;
        enterEditMode();
      }, LONG_PRESS_MS);
    });
    textDisplayArea.addEventListener('touchmove', function () {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    textDisplayArea.addEventListener('touchend', function (e) {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      // Tap to position cursor (only if not long press)
      if (!longPressTriggered && state === 'displaying') {
        handleTapToPosition(e);
      }
    });

    // Desktop: click to position cursor
    textDisplayArea.addEventListener('click', function (e) {
      // Only handle mouse clicks (touch is handled above)
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      if (state === 'displaying') {
        handleTapToPosition(e);
      }
    });

    // Desktop: double-click to edit
    textDisplayArea.addEventListener('dblclick', function (e) {
      if (state === 'displaying') {
        enterEditMode();
      }
    });

    // Keyboard button — toggle edit mode
    keyboardBtn.addEventListener('click', function () {
      if (state === 'recording') return;
      if (state === 'editing') {
        exitEditMode();
      } else {
        enterEditMode();
      }
    });

    // Clear button
    clearBtn.addEventListener('click', function () {
      if (state === 'recording') return;
      if (state === 'editing') {
        hiddenInput.blur();
        document.body.classList.remove('edit-mode');
      }
      displayText = '';
      cursorPos = 0;
      showPlaceholder();
      state = 'idle';
    });

    // --- Viewport height tracking (iOS keyboard) ---
    function updateVh() {
      var vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) / 100;
      document.documentElement.style.setProperty('--vh', vh + 'px');
    }
    updateVh();

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () {
        updateVh();
        if (state === 'editing') {
          fitText(textContent, textDisplayArea);
        } else if (displayText && (state === 'displaying' || state === 'idle')) {
          renderText();
        }
      });
    }

    // Resize handler
    window.addEventListener('resize', function () {
      updateVh();
      if (state === 'editing') {
        fitText(textContent, textDisplayArea);
      } else if (displayText && (state === 'displaying' || state === 'idle')) {
        renderText();
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
