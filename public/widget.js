(function () {
  'use strict';

  var WIDGET_URL = 'https://www.pmitop.com/widget';
  var BUTTON_ID = 'maia-widget-btn';
  var FRAME_ID = 'maia-widget-frame';

  if (document.getElementById(BUTTON_ID)) return; // already loaded

  // ── Floating button ────────────────────────────────────────────────────────

  var btn = document.createElement('div');
  btn.id = BUTTON_ID;
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '999999',
    width: '56px',
    height: '56px',
    background: '#f97316',
    borderRadius: '50%',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(249,115,22,0.4)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    userSelect: 'none',
    transition: 'background 0.15s, transform 0.12s',
  });
  btn.innerHTML =
    '<span style="font-size:1.3rem;line-height:1;color:#fff">💬</span>' +
    '<span style="font-size:0.48rem;font-weight:700;color:#fff;letter-spacing:0.04em;font-family:Arial,sans-serif">MAIA</span>';

  btn.addEventListener('mouseover', function () { btn.style.transform = 'scale(1.07)'; });
  btn.addEventListener('mouseout',  function () { btn.style.transform = 'scale(1)'; });

  // ── Iframe container ───────────────────────────────────────────────────────

  var container = document.createElement('div');
  container.id = FRAME_ID;
  Object.assign(container.style, {
    position: 'fixed',
    bottom: '86px',
    right: '20px',
    zIndex: '999998',
    width: '370px',
    height: '560px',
    borderRadius: '16px',
    overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
    border: '1px solid #e2e8f0',
    display: 'none',
    background: '#fff',
  });

  var iframe = document.createElement('iframe');
  iframe.src = WIDGET_URL;
  iframe.title = 'MAIA — PMI Top Florida Properties';
  Object.assign(iframe.style, {
    width: '100%',
    height: '100%',
    border: 'none',
    display: 'block',
  });
  iframe.setAttribute('allow', 'clipboard-write');
  container.appendChild(iframe);

  // ── Toggle ─────────────────────────────────────────────────────────────────

  var open = false;

  function show() {
    open = true;
    container.style.display = 'block';
    btn.style.background = '#333';
    btn.innerHTML = '<span style="font-size:1.1rem;color:#fff">✕</span>';
  }

  function hide() {
    open = false;
    container.style.display = 'none';
    btn.style.background = '#f97316';
    btn.innerHTML =
      '<span style="font-size:1.3rem;line-height:1;color:#fff">💬</span>' +
      '<span style="font-size:0.48rem;font-weight:700;color:#fff;letter-spacing:0.04em;font-family:Arial,sans-serif">MAIA</span>';
  }

  btn.addEventListener('click', function () { open ? hide() : show(); });

  // ── postMessage listener ───────────────────────────────────────────────────

  window.addEventListener('message', function (e) {
    if (e.data === 'maia:close') {
      hide();
    } else if (typeof e.data === 'string' && e.data.startsWith('maia:redirect:')) {
      var path = e.data.slice('maia:redirect:'.length);
      window.location.href = path;
    }
  });

  // ── Responsive: full-screen on mobile ─────────────────────────────────────

  function applyResponsive() {
    var mobile = window.innerWidth < 480;
    if (mobile) {
      Object.assign(container.style, { width: '100vw', height: '100vh', bottom: '0', right: '0', borderRadius: '0', border: 'none' });
      Object.assign(btn.style, { bottom: '16px', right: '16px' });
    } else {
      Object.assign(container.style, { width: '370px', height: '560px', bottom: '86px', right: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' });
      Object.assign(btn.style, { bottom: '20px', right: '20px' });
    }
  }

  applyResponsive();
  window.addEventListener('resize', applyResponsive);

  // ── Mount ──────────────────────────────────────────────────────────────────

  document.body.appendChild(container);
  document.body.appendChild(btn);
})();
