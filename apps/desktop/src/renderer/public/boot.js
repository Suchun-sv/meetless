/* Meetless boot guard. A classic script that loads before the app bundle (the CSP allows no inline
   scripts). It adds the few runtime APIs older Safari lacks, and it shows any error raised before the
   app mounts, so the page is never left blank. On the web it also reports that error to the server
   (POST /v1/client-error: message, stack, user agent, path; never cookies or tokens), queued and
   retried. Stylesheets and module scripts that fail to load are retried twice first. ES5 only. */
(function () {
  'use strict';
  var w = window;
  function def(obj, name, fn) {
    if (obj && !obj[name]) Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true });
  }
  function at(i) {
    var n = this.length >>> 0;
    var k = Math.trunc ? Math.trunc(i) || 0 : (i | 0);
    if (k < 0) k += n;
    return k < 0 || k >= n ? undefined : this[k];
  }
  def(Array.prototype, 'at', at);
  def(String.prototype, 'at', at);
  if (typeof Int8Array !== 'undefined') def(Object.getPrototypeOf(Int8Array.prototype), 'at', at);
  def(Object, 'hasOwn', function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
  if (w.crypto && w.crypto.getRandomValues) {
    def(w.crypto, 'randomUUID', function () {
      var b = w.crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      var h = [];
      for (var i = 0; i < 16; i++) h.push((b[i] + 256).toString(16).slice(1));
      return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
    });
  }
  if (w.AbortSignal && w.AbortController) {
    def(w.AbortSignal, 'timeout', function (ms) {
      var c = new AbortController();
      setTimeout(function () {
        var e;
        try { e = new DOMException('signal timed out', 'TimeoutError'); } catch (x) { e = new Error('signal timed out'); e.name = 'TimeoutError'; }
        c.abort(e);
      }, ms);
      return c.signal;
    });
  }

  var isWeb = !!document.querySelector('meta[name="meetless-host"][content="web"]');

  // Diagnostics: queued and retried with backoff, so a flaky link still delivers them.
  var queue = [];
  var queued = 0;
  var sending = false;
  function flush(attempt) {
    if (sending || queue.length === 0) return;
    sending = true;
    var body = queue[0];
    var done = function (ok) {
      sending = false;
      if (ok) {
        queue.shift();
        flush(0);
      } else if (attempt < 6) {
        setTimeout(function () { flush(attempt + 1); }, 1000 * Math.pow(2, attempt));
      }
    };
    try {
      var x = new XMLHttpRequest();
      x.open('POST', '/v1/client-error', true);
      x.setRequestHeader('content-type', 'application/json');
      x.timeout = 20000;
      x.onload = function () { done(x.status < 500 && x.status !== 0); };
      x.onerror = x.ontimeout = x.onabort = function () { done(false); };
      x.send(body);
    } catch (e) { done(false); }
  }
  function report(kind, message, stack) {
    if (!isWeb || queued >= 8) return;
    queued++;
    queue.push(JSON.stringify({
      kind: kind,
      message: String(message || '').slice(0, 2000),
      stack: String(stack || '').slice(0, 4000),
      ua: String(navigator.userAgent || '').slice(0, 400),
      path: String(location.pathname || '').slice(0, 200),
    }));
    flush(0);
  }
  w.__meetlessReport = report;

  // `fatal`: a stylesheet or the app script failed for good. That breaks the page even after React
  // has mounted, so the message then covers the page instead of replacing the root React owns.
  function show(message, fatal) {
    if (w.__meetlessMounted && !fatal) return;
    if (document.querySelector('[data-testid="boot-error"]')) return;
    var root = document.getElementById('root') || document.body;
    if (!root) return;
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.setAttribute('data-testid', 'boot-error');
    box.style.cssText = 'font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 20px;color:#1C1B19;line-height:1.5';
    var h = document.createElement('p');
    h.style.fontWeight = '600';
    h.textContent = 'Meetless 无法在此浏览器中启动 / Meetless could not start in this browser';
    var p = document.createElement('p');
    p.textContent = '网络不稳时请点重试；仍不行就把下面的信息发给管理员。 On a slow connection, tap Retry; if it keeps failing, send the text below to your admin.';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-testid', 'boot-retry');
    btn.textContent = '重试 / Retry';
    btn.style.cssText = 'min-height:44px;padding:0 20px;font:inherit;font-weight:600;border:1px solid #D8D7D3;border-radius:8px;background:#1C1B19;color:#FFFFFF';
    btn.onclick = function () { location.reload(); };
    var pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-size:12px;background:#F2F1ED;padding:12px;border-radius:6px';
    pre.textContent = String(message) + '\n\n' + navigator.userAgent;
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(btn);
    box.appendChild(pre);
    if (w.__meetlessMounted) {
      var cover = document.createElement('div');
      cover.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;overflow:auto;background:#FBFBFA;z-index:2147483647';
      cover.appendChild(box);
      document.body.appendChild(cover);
    } else {
      root.innerHTML = '';
      root.appendChild(box);
    }
  }
  w.__meetlessShowBootError = show;

  // A stylesheet or module script under /assets/ that fails to load is fetched again twice, after
  // 1 s and 3 s, with a cache-busting query, before the error screen shows.
  var RETRY_DELAYS = [1000, 3000];
  function retryCount(url) {
    var m = /[?&]r=(\d+)/.exec(url);
    return m ? Number(m[1]) : 0;
  }
  function withRetry(url, n) {
    var bare = url.replace(/([?&])r=\d+&?/, '$1').replace(/[?&]$/, '');
    return bare + (bare.indexOf('?') >= 0 ? '&' : '?') + 'r=' + n;
  }
  function retryLoad(el) {
    var url = el.tagName === 'LINK' ? el.href : el.src;
    if (!url || url.indexOf('/assets/') < 0) return false;
    var n = retryCount(url);
    if (n >= RETRY_DELAYS.length) return false;
    setTimeout(function () {
      var next;
      if (el.tagName === 'LINK') {
        next = document.createElement('link');
        next.rel = 'stylesheet';
        next.href = withRetry(url, n + 1);
      } else {
        next = document.createElement('script');
        next.type = 'module';
        next.src = withRetry(url, n + 1);
      }
      (el.parentNode || document.head).insertBefore(next, el.nextSibling);
      if (el.parentNode) el.parentNode.removeChild(el);
    }, RETRY_DELAYS[n]);
    return true;
  }

  w.addEventListener('error', function (e) {
    var t = e && e.target;
    // Resource errors: only a script or stylesheet that failed to load matters (not an image).
    var fatal = false;
    if (t && t !== w && t.tagName) {
      if (t.tagName !== 'SCRIPT' && t.tagName !== 'LINK') return;
      if (retryLoad(t)) return;
      fatal = true;
    }
    var msg = e && e.message ? e.message : t && (t.src || t.href) ? 'failed to load ' + (t.src || t.href) : 'unknown error';
    var stack = e && e.error && e.error.stack;
    report('error', msg, stack);
    show(msg + (stack ? '\n' + stack : ''), fatal);
  }, true);
  w.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    var msg = r && r.message ? r.message : String(r);
    report('unhandledrejection', msg, r && r.stack);
    show(msg + (r && r.stack ? '\n' + r.stack : ''));
  });
  // A module bundle that never ran (a syntax error in an old engine, a blocked script, a transfer
  // still crawling over a relay) leaves the root empty without always firing an error event.
  setTimeout(function () {
    if (w.__meetlessMounted) return;
    var root = document.getElementById('root');
    if (root && root.childNodes.length === 0) {
      report('no-mount', 'the app did not start within 45 s', '');
      show('The app did not start within 45 s (a very slow connection, or a script this browser does not support).');
    }
  }, 45000);
})();
