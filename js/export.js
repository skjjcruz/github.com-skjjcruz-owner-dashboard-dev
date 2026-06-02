// export.js — Screenshot export utilities + on-demand html2canvas loader
(function () {
  window.wrExport = { capture: function () { return Promise.resolve(false); } };

  // html2canvas (~200KB) is only used by user-triggered exports (Trophy Room
  // image export + draft PNG pick card). Load it lazily on first use instead of
  // shipping it as an eager, render-blocking CDN <script> on every cold load.
  var _h2cPromise = null;
  window.ensureHtml2Canvas = function () {
    if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
    if (_h2cPromise) return _h2cPromise;
    _h2cPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.async = true;
      s.onload = function () { resolve(window.html2canvas); };
      s.onerror = function () { _h2cPromise = null; reject(new Error('html2canvas failed to load')); };
      document.head.appendChild(s);
    });
    return _h2cPromise;
  };
})();
