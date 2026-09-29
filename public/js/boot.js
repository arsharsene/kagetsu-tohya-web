/* Loaded first, before config.js/vm.js/ui.js. Makes sure a failed deploy or a
   runtime exception is always shown on screen instead of leaving a blank page,
   and does it without any inline <script> so a strict script-src CSP still works. */
(function () {
  'use strict';
  function KTfail(msg) {
    var m = document.getElementById('loadmsg');
    if (m) { m.textContent = msg; m.style.color = '#ff9c8a'; }
    var st = document.getElementById('startbtn'), se = document.getElementById('startero');
    if (st) st.disabled = true;
    if (se) se.style.display = 'none';
  }
  window.KTfail = KTfail;

  // Capturing listener also catches <script>/<img> resource load failures,
  // since those don't bubble but do fire on window when listened to in the
  // capture phase - this replaces per-tag onerror="" attributes.
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'SCRIPT') {
      KTfail((t.src ? t.src.split('/').pop() : 'a script') + " failed to load (404? check the deployment's output directory).");
      return;
    }
    if (e.message) {
      KTfail('Script error: ' + e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
    }
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    KTfail('Unhandled error: ' + (e && e.reason && e.reason.message ? e.reason.message : String(e && e.reason)));
  });

  setTimeout(function () {
    if (!window.KT_VM) KTfail("js/vm.js didn't load - check the deployment's output directory and that /js/vm.js is reachable.");
    else if (!window.KT) KTfail("js/ui.js didn't finish starting - check the browser console for details.");
  }, 8000);

  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('errReload');
    if (b) b.addEventListener('click', function () { location.reload(); });
  });
})();
