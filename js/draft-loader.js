// ══════════════════════════════════════════════════════════════════
// draft-loader.js — lazy-loader for the Draft Command module (~1.26MB across
// ~27 scripts). In built output (build-deploy / build-preview) those scripts are
// emitted INERT (type="text/wr-deferred", data-wr-defer="draft") so the browser
// never parses or executes them at app boot. On first Draft-tab open,
// league-detail.js calls window.wrLoadDraft(), which injects executable copies of
// the compiled modules in DOM order.
//
// Raw local dev (no build step): the tags stay type="text/babel" and are compiled
// + executed at boot by @babel/standalone, so wrLoadDraft is a no-op (injecting
// raw JSX as a plain script would fail). We detect this by only injecting tags the
// pipeline marked text/wr-deferred.
//
// Must be SERIAL (onload-chained): 11 draft modules destructure window.DraftCC.styles
// at IIFE entry, so styles.js must run before them — never load these in parallel.
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var _promise = null;
  window.__wrDraftLoaded = false;

  window.wrLoadDraft = function wrLoadDraft() {
    if (_promise) return _promise;
    _promise = new Promise(function (resolve, reject) {
      var tags = Array.prototype.slice.call(
        document.querySelectorAll('script[data-wr-defer="draft"]')
      ).filter(function (t) {
        // Only inject tags the build/serve pipeline made inert. In raw local dev
        // they remain type="text/babel" and already ran at boot, so skip them.
        return (t.getAttribute('type') || '') === 'text/wr-deferred';
      });
      if (!tags.length) {
        // Nothing inert to inject (raw dev, or already executable) — treat as loaded.
        window.__wrDraftLoaded = true;
        try { window.dispatchEvent(new Event('wr:draft-loaded')); } catch (e) {}
        return resolve();
      }
      var i = 0;
      function next() {
        if (i >= tags.length) {
          window.__wrDraftLoaded = true;
          try { window.dispatchEvent(new Event('wr:draft-loaded')); } catch (e) {}
          return resolve();
        }
        var srcTag = tags[i++];
        var src = srcTag.getAttribute('src');
        if (!src) return next();
        var s = document.createElement('script');
        s.src = src;
        s.async = false; // preserve execution order
        s.onload = next;
        s.onerror = function () {
          reject(new Error('Draft module failed to load: ' + src));
        };
        document.head.appendChild(s);
      }
      next();
    });
    return _promise;
  };
})();
