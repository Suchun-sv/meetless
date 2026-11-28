// The OnlyOffice viewer page on the web and in the desktop app (src/features/artifacts/ui/OfficeFrame.web.tsx).
// A file, not inline script: the desktop CSP (script-src 'self' and the DocumentServer) refuses inline
// script, and a srcdoc frame inherits it. The parent posts the editor config once this page has loaded;
// the answers are the native WebView page's (officeHtml in features/artifacts/model).
(function () {
  // DocumentServer's api.js puts an empty onmousewheel attribute on its editor iframe ("for Safari on
  // Mac"). The CSP refuses every inline handler, even an empty one, and logs a violation: drop just that.
  var setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === 'onmousewheel' && value === '') return;
    return setAttribute.call(this, name, value);
  };
  var started = false;
  var done = false;
  var timer = null;
  function post(type) {
    window.parent.postMessage(JSON.stringify({ source: 'meetless-office', type: type }), '*');
  }
  function settle(type) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (type === 'app_ready') done = true;
    post(type);
  }
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (started || e.source !== window.parent || e.origin !== location.origin || !m || m.source !== 'meetless-office-init') return;
    started = true;
    var timeoutMs = m.timeoutMs;
    timer = setTimeout(function () {
      if (!done) settle('timeout');
    }, timeoutMs);
    var s = document.createElement('script');
    s.src = String(m.documentServerUrl).replace(/\/+$/, '') + '/web-apps/apps/api/documents/api.js';
    s.async = true;
    s.onerror = function () {
      settle('script_failed');
    };
    s.onload = function () {
      if (!window.DocsAPI) return settle('script_failed');
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!done) settle('timeout');
      }, timeoutMs);
      var cfg = m.config;
      cfg.events = {
        onAppReady: function () {
          settle('app_ready');
        },
        onError: function () {
          settle('editor_error');
        },
      };
      try {
        new window.DocsAPI.DocEditor('ed', cfg);
      } catch (err) {
        settle('editor_error');
      }
    };
    document.head.appendChild(s);
  });
})();
