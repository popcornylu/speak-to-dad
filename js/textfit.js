var fitText = (function () {
  var rafId = null;

  function measure(element, container, fontSize) {
    element.style.fontSize = fontSize + 'px';
    return element.scrollHeight <= container.clientHeight &&
           element.scrollWidth <= container.clientWidth;
  }

  function fit(element, container) {
    // Hide fake caret during measurement to prevent 2px border from affecting size
    var fakeCaret = element.querySelector('.fake-caret');
    if (fakeCaret) fakeCaret.style.display = 'none';

    var lo = 16;
    var hi = 48;
    var best = lo;

    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      if (measure(element, container, mid)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    element.style.fontSize = best + 'px';

    // Restore fake caret
    if (fakeCaret) fakeCaret.style.display = '';
  }

  function fitText(element, container) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(function () {
      rafId = null;
      fit(element, container);
    });
  }

  return fitText;
})();
