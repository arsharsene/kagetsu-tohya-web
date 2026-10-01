/* Kagetsu Tohya Web — browser host (rendering, text window, input, audio, save/load) */
(function () {
'use strict';
const { VM, Halt, Restart, LoadInt } = window.KT_VM;
const CFG = Object.assign({ base: 'a/', script: 'game/script.txt', maxScale: 4, tracks: [2, 17], seedFile: 'game/seed.json', seed: true, maxWide: 1280 }, window.KT_CONFIG || {});
const W = 640, H = 480;
let LW = 640, OX = 0, lastDisp = null;
const $ = s => document.querySelector(s);
const sleepRaw = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* ---------------- settings ---------------- */
const settings = Object.assign({ speed: 1, auto: false, mute: false, display: 'wide' }, store.get('kt-settings') || {});
if (settings.dver !== 3) { settings.display = 'wide'; settings.dver = 3; store.set('kt-settings', settings); }
if (!['wide', 'fit', 'stretch'].includes(settings.display)) settings.display = 'wide';
const saveSettings = () => store.set('kt-settings', settings);
const SPEEDS = [{ n: 'Slow', f: 1.8 }, { n: 'Normal', f: 1 }, { n: 'Fast', f: 0.5 }, { n: 'Instant', f: 0 }];
if (typeof settings.speed !== 'number' || settings.speed > 3) settings.speed = 1;

/* ---------------- DOM ---------------- */
const wrap = $('#wrap'), stage = $('#stage'), scr = $('#scr'), sctx = scr.getContext('2d');
const hov = $('#hov'), hctx = hov.getContext('2d'), shade = $('#shade'), txt = $('#txt');
const bar = $('#bar');

/* ---------------- layout ---------------- */
let scaleX = 1, scaleY = 1;
const amb = $('#amb'), actx = amb.getContext('2d'), bHandle = $('#bHandle');
function ambient() { try { actx.drawImage(scr, 0, 0, amb.width, amb.height); } catch (e) {} }
function setLW(lw) {
  if (lw === LW) return false;
  LW = lw; OX = Math.floor((LW - W) / 2);
  [scr, hov, oldC, newC].forEach(c => { c.width = LW; });
  scr.style.width = hov.style.width = LW + 'px';
  return true;
}
function layout() {
  const vw = window.innerWidth, vh = window.innerHeight, B = document.body;
  const land = vw > vh * 1.05;
  const stretch = settings.display === 'stretch' && land;
  const wide = settings.display === 'wide' && land && vw / vh > 4 / 3 + 0.02;
  B.classList.toggle('stretch', stretch); B.classList.toggle('wide', wide);
  let m;
  if (stretch || wide) m = 'float';
  else if (land) { const s0 = Math.min(vw / W, vh / H); m = ((vw - W * s0) / 2 >= 112) ? 'dock' : 'float'; }
  else m = 'bottom';
  B.classList.remove('dock', 'float', 'bottom'); B.classList.add(m);
  if (m !== 'float') B.classList.remove('open');
  let sx, sy, lw = W, ww, wh;
  if (stretch) { sx = vw / W; sy = vh / H; ww = vw; wh = vh; }
  else if (wide) { sy = sx = Math.min(vh / H, CFG.maxScale); lw = Math.max(W, Math.min(CFG.maxWide, Math.ceil(vw / sx))); ww = Math.min(vw, Math.floor(lw * sx)); wh = Math.floor(H * sy); }
  else {
    if (m === 'bottom') { const barH = bar.offsetHeight; sx = sy = Math.min(vw / W, Math.max(80, vh - barH) / H, CFG.maxScale); }
    else sx = sy = Math.min(vw / W, vh / H, CFG.maxScale);
    ww = Math.floor(W * sx); wh = Math.floor(H * sy);
  }
  const changed = setLW(lw);
  scaleX = sx; scaleY = sy;
  wrap.style.width = ww + 'px'; wrap.style.height = wh + 'px';
  stage.style.width = LW + 'px';
  stage.style.transform = 'scale(' + sx + ',' + sy + ')';
  amb.style.display = (ww >= vw - 1 && wh >= vh - 1) ? 'none' : 'block';
  if (win) setWindow(win);
  if (changed && lastDisp) redraw();
}
let redrawing = false;
async function redraw() {
  if (redrawing || !lastDisp) return; redrawing = true;
  try { const d = lastDisp, r = await resolveDisp(d); drawDisp(newX, d, r); sctx.globalAlpha = 1; sctx.drawImage(newC, 0, 0); ambient(); } catch (e) {} finally { redrawing = false; }
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => { setTimeout(layout, 150); setTimeout(layout, 500); });
if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);

/* ---------------- images ---------------- */
const imgCache = new Map();
function imgUrl(p) {
  p = String(p).trim().replace(/^:[^;]*;/, '').replace(/\\/g, '/').toLowerCase().replace(/\.(jpg|jpeg|png|bmp)$/, '.webp');
  return CFG.base + p;
}
function loadImg(p) {
  const url = imgUrl(p);
  let pr = imgCache.get(url);
  if (pr) { imgCache.delete(url); imgCache.set(url, pr); return pr; }
  pr = new Promise(res => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => { console.warn('image failed', url); res(null); };
    im.src = url;
  });
  imgCache.set(url, pr);
  if (imgCache.size > 90) imgCache.delete(imgCache.keys().next().value);
  return pr;
}

/* ---------------- abort (for load/restart from menus) ---------------- */
let abortP, abortRej;
function newAbort() { abortP = new Promise((_, rej) => { abortRej = rej; }); abortP.catch(() => {}); }
newAbort();
const race = p => Promise.race([p, abortP]);
const sleep = ms => race(sleepRaw(ms));
function interrupt(err) { abortRej(err); if (clickResolve) { const r = clickResolve; clickResolve = null; r(); } }

/* ---------------- compositing ---------------- */
async function resolveDisp(d) {
  const r = { bg: null, tachi: {}, sp: [] };
  const jobs = [];
  if (d.bg && d.bg.path) jobs.push(loadImg(d.bg.path).then(i => { r.bg = i; }));
  ['l', 'c', 'r'].forEach(k => { if (d.tachi[k]) jobs.push(loadImg(d.tachi[k]).then(i => { r.tachi[k] = i; })); });
  Object.entries(d.sp).forEach(([n, s]) => { if (s.v) jobs.push(loadImg(s.path).then(i => { if (i) r.sp.push({ n: +n, s, i }); })); });
  await race(Promise.all(jobs));
  r.sp.sort((a, b) => b.n - a.n);
  return r;
}
function drawDisp(ctx, d, r) {
  const lw = ctx.canvas.width, ox = Math.floor((lw - W) / 2);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const im = r.bg;
  if (im) {
    if (lw > W) {
      const scale = Math.max(lw / im.naturalWidth, H / im.naturalHeight);
      const sw = lw / scale, sh = H / scale;
      const sx = (im.naturalWidth - sw) / 2, sy = (im.naturalHeight - sh) / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(im, sx, sy, sw, sh, 0, 0, lw, H);
    }
    ctx.drawImage(im, ox, 0, W, H);
  } else { ctx.fillStyle = (d.bg && d.bg.color) || '#000'; ctx.fillRect(0, 0, lw, H); }
const px = { l: W / 4, c: W / 2, r: 3 * W / 4 };
  ['l', 'c', 'r'].forEach(k => { const i = r.tachi[k]; if (i) ctx.drawImage(i, Math.round(px[k] - i.naturalWidth / 2) + ox, H - i.naturalHeight); });
  r.sp.forEach(({ s, i }) => { ctx.globalAlpha = Math.max(0, Math.min(1, s.a / 255)); ctx.drawImage(i, s.x + ox, s.y); });
  ctx.globalAlpha = 1;
  if (d.mono) {
    const c = parseInt(d.mono.slice(1), 16), cr = (c >> 16) & 255, cg = (c >> 8) & 255, cb = c & 255;
    const im2 = ctx.getImageData(0, 0, lw, H), a = im2.data;
    for (let i = 0; i < a.length; i += 4) {
      const g = (a[i] * 77 + a[i + 1] * 151 + a[i + 2] * 28) >> 8;
      a[i] = g * cr / 255; a[i + 1] = g * cg / 255; a[i + 2] = g * cb / 255;
    }
    ctx.putImageData(im2, 0, 0);
  }
}
const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
const oldC = mk(), newC = mk(), newX = newC.getContext('2d'), oldX = oldC.getContext('2d');

let transSkip = false;
function drawTrans(type, p) {
  const c = sctx, W = scr.width; c.globalAlpha = 1;
  const S = 40;
  if (type >= 2 && type <= 5) {
    c.drawImage(oldC, 0, 0);
    c.save(); c.beginPath();
    if (type === 2) for (let x = 0; x < W; x += S) c.rect(x, 0, S * p, H);
    else if (type === 3) for (let x = 0; x < W; x += S) c.rect(x + S * (1 - p), 0, S * p, H);
    else if (type === 4) for (let y = 0; y < H; y += S) c.rect(0, y, W, S * p);
    else for (let y = 0; y < H; y += S) c.rect(0, y + S * (1 - p), W, S * p);
    c.clip(); c.drawImage(newC, 0, 0); c.restore();
  } else if (type >= 6 && type <= 9) {
    c.drawImage(oldC, 0, 0);
    c.save(); c.beginPath();
    if (type === 6) c.rect(0, 0, W * p, H); else if (type === 7) c.rect(W * (1 - p), 0, W * p, H);
    else if (type === 8) c.rect(0, 0, W, H * p); else c.rect(0, H * (1 - p), W, H * p);
    c.clip(); c.drawImage(newC, 0, 0); c.restore();
  } else if (type >= 11 && type <= 14) {
    const dx = type === 11 ? W * p : type === 12 ? -W * p : 0, dy = type === 13 ? H * p : type === 14 ? -H * p : 0;
    c.drawImage(oldC, dx, dy);
    c.drawImage(newC, dx + (type === 11 ? -W : type === 12 ? W : 0), dy + (type === 13 ? -H : type === 14 ? H : 0));
  } else {
    c.drawImage(oldC, 0, 0); c.globalAlpha = p; c.drawImage(newC, 0, 0); c.globalAlpha = 1;
  }
}
function animate(type, time) {
  return race(new Promise(res => {
    const t0 = performance.now();
    const f = now => {
      const p = (now - t0) / time;
      if (p >= 1 || transSkip) { sctx.globalAlpha = 1; sctx.drawImage(newC, 0, 0); res(); return; }
      drawTrans(type, Math.max(0, p));
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }));
}
let vmRef = null;
function preloadAhead() {
  if (!vmRef) return;
  const L = vmRef.lines, s = vmRef.pc.line; let n = 0;
  for (let i = s; i < Math.min(L.length, s + 90) && n < 8; i++) {
    if (L[i].trimStart()[0] === ';') continue;
    const m = L[i].match(/image\\[A-Za-z0-9_\\\/\-]+\.jpg/g);
    if (m) m.forEach(x => { if (n < 8) { n++; loadImg(x); } });
  }
}

/* ---------------- text window ---------------- */
let win = null, log = [], pageChars = 0;
function setWindow(w) {
  win = w;
  txt.style.left = (w.x + OX) + 'px'; txt.style.top = w.y + 'px';
  txt.style.width = Math.max(100, w.cols * (w.fw + w.px)) + 'px';
  txt.style.height = (w.rows * (w.fh + w.py)) + 'px';
  txt.style.fontSize = w.fh + 'px'; txt.style.lineHeight = (w.fh + w.py) + 'px';
  const sl = w.x1 <= 0 ? 0 : w.x1 + OX, sr = w.x2 >= W - 1 ? LW : w.x2 + 1 + OX;
  shade.style.left = sl + 'px'; shade.style.top = w.y1 + 'px';
  shade.style.width = (sr - sl) + 'px'; shade.style.height = (w.y2 - w.y1 + 1) + 'px';
  shade.style.background = w.color || '#fff';
}
function showShade(on) { shade.style.display = on && win && win.color && win.color.toLowerCase() !== '#ffffff' ? 'block' : 'none'; }
let curRun = null, curRunColor = undefined;
function runNode(color) {
  color = color || null;
  if (curRun && curRunColor === color && curRun.parentNode === txt) return curRun.firstChild;
  const sp = document.createElement('span'); if (color) sp.style.color = color;
  const tn = document.createTextNode(''); sp.appendChild(tn); txt.appendChild(sp);
  curRun = sp; curRunColor = color; return tn;
}
let typing = false, skipTyping = false, winErased = false;
function pageText() { return txt.textContent.replace(/[▼▽]/g, ''); }
function pageHTML() {
  const c = txt.cloneNode(true);
  c.querySelectorAll('.cur').forEach(n => n.remove());
  return c.innerHTML;
}
function userFactor() { return SPEEDS[settings.speed].f; }
async function type(str, o) {
  removeCursor();
  showShade(true);
  const tn = runNode(o && o.color);
  pageChars += str.length;
  const sp = (o && o.speed != null) ? o.speed : (win ? win.speed : 22);
  const per = sp * userFactor();
  if (skipping() || per <= 0 || skipTyping) { tn.data += str; return; }
  typing = true;
  const chars = Array.from(str);
  let last = performance.now();
  try {
    for (let i = 0; i < chars.length; i++) {
      if (skipTyping || skipping()) { tn.data += chars.slice(i).join(''); break; }
      tn.data += chars[i];
      if (per >= 1 && chars[i] !== ' ') { await sleep(per); }
    }
  } finally { typing = false; }
}
function newline() { const tn = runNode(curRunColor); tn.data += '\n'; }
function clearPage() {
  const t = pageText().replace(/^\s+|\s+$/g, '');
  if (t) { log.push(pageHTML()); if (log.length > 300) log.shift(); }
  clearPageNow();
}
function clearPageNow() {
  txt.textContent = ''; curRun = null; curRunColor = undefined; pageChars = 0; skipTyping = false;
  showShade(false); winErased = false; txt.style.visibility = 'visible';
}
let cursorEl = null;
function showCursor(pageEnd) {
  removeCursor();
  cursorEl = document.createElement('span'); cursorEl.className = 'cur'; cursorEl.textContent = pageEnd ? '▼' : '▽';
  txt.appendChild(cursorEl);
}
function removeCursor() { if (cursorEl) { cursorEl.remove(); cursorEl = null; } }

/* ---------------- input / waiting ---------------- */
let mode = 'idle', clickResolve = null, autoTimer = null;
let skipOn = false, ctrlHeld = false;
function skipping() { return skipOn || ctrlHeld; }
function setSkip(v) { skipOn = v; updateBar(); }
async function waitClick(pageEnd) {
  removeCursor();
  skipTyping = false;
  if (skipping()) { await sleep(3); return; }
  showCursor(pageEnd);
  await race(new Promise(res => {
    clickResolve = res; mode = 'click';
    if (settings.auto) { const d = Math.max(700, 500 + pageChars * 45 * Math.max(0.3, userFactor())); autoTimer = setTimeout(() => { if (clickResolve === res) { clickResolve = null; res(); } }, d); }
  }));
  clearTimeout(autoTimer); mode = 'idle'; removeCursor();
}
async function waitText(ms, cancelable) {
  if (skipping()) return;
  await race(new Promise(res => {
    const t = setTimeout(() => { if (clickResolve === res) clickResolve = null; res(); }, ms);
    if (cancelable) clickResolve = () => { clearTimeout(t); res(); };
  }));
}
function advance() {
  if (typing) { skipTyping = true; return; }
  if (transitioning) { transSkip = true; return; }
  if (clickResolve) { const r = clickResolve; clickResolve = null; r(); }
}
let transitioning = false;

/* buttons */
let btnState = { img: null, list: [] }, btnImg = null, hoverBtn = null, btnResolve = null;
function buttons(b) {
  btnState = b; hoverBtn = null; hctx.clearRect(0, 0, hov.width, H);
  btnImg = null;
  if (b.img) loadImg(b.img).then(i => { btnImg = i; });
}
function hit(p) { for (const b of btnState.list) if (p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h) return b; return null; }
function setHover(b) {
  if (b === hoverBtn) return; hoverBtn = b; hctx.clearRect(0, 0, hov.width, H);
  if (b && btnImg) hctx.drawImage(btnImg, b.ox, b.oy, b.w, b.h, b.x + OX, b.y, b.w, b.h);
}
function btnwait() {
  setSkip(false);
  return race(new Promise(res => { btnResolve = res; mode = 'btn'; updateBar(); })).finally(() => { mode = 'idle'; btnResolve = null; hoverBtn = null; hctx.clearRect(0, 0, hov.width, H); updateBar(); });
}
function toStage(e) { const r = wrap.getBoundingClientRect(); return { x: (e.clientX - r.left) / scaleX - OX, y: (e.clientY - r.top) / scaleY }; }
wrap.addEventListener('pointermove', e => { if (mode === 'btn' && e.pointerType === 'mouse') setHover(hit(toStage(e))); });
let lastPT = 'mouse';
wrap.addEventListener('pointerdown', e => { lastPT = e.pointerType; if (mode === 'btn') setHover(hit(toStage(e))); });
wrap.addEventListener('pointerleave', () => { if (mode === 'btn') setHover(null); });
wrap.addEventListener('pointerup', e => {
  if (backlogOpen) { hideBacklog(); return; }
  if (overlayOpen()) return;
  if (e.button === 2) return;
  if (document.body.classList.contains('open')) { document.body.classList.remove('open'); return; }
  if (mode === 'btn') { const b = hit(toStage(e)); if (b && btnResolve) btnResolve(b.n); else setHover(null); return; }
  if (winErased) { winErased = false; txt.style.visibility = 'visible'; showShade(pageChars > 0); return; }
  if (skipOn && mode !== 'choice') { setSkip(false); return; }
  if (mode === 'click' || typing || transitioning) advance();
});
wrap.addEventListener('contextmenu', e => {
  e.preventDefault(); if (backlogOpen) { hideBacklog(); return; } if (overlayOpen() || lastPT === 'touch') return;
  if (mode === 'btn') { if (btnResolve) btnResolve(-1); } else openMenu();
});
wrap.addEventListener('wheel', e => {
  if (backlogOpen) return;
  if (e.deltaY < 0 && !overlayOpen() && mode !== 'btn') openLog();
  else if (e.deltaY > 0 && mode === 'click') advance();
}, { passive: true });
window.addEventListener('keydown', e => {
  if (e.key === 'Control') { ctrlHeld = true; return; }
  if (e.repeat) return;
  if (backlogOpen) { if (e.key === 'Escape' || e.key === 'l' || e.key === 'L') hideBacklog(); return; }
  if (overlayOpen()) { if (e.key === 'Escape') closeOverlay(); return; }
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); if (mode === 'click' || typing) advance(); }
  else if (e.key === 'Escape') { if (mode === 'btn') { if (btnResolve) btnResolve(-1); } else openMenu(); }
  else if (e.key === 'f' || e.key === 'F') fullscreen();
  else if (e.key === 'a' || e.key === 'A') toggleAuto();
  else if (e.key === 's' || e.key === 'S') setSkip(!skipOn);
  else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowUp' || e.key === 'PageUp') openLog();
});
window.addEventListener('keyup', e => { if (e.key === 'Control') ctrlHeld = false; });

/* choices */
function choose(items) {
  setSkip(false);
  removeCursor();
  showShade(true);
  const box = document.createElement('div'); box.className = 'choices';
  txt.classList.add('choosing');
  if (win) txt.style.height = Math.max(120, H - win.y) + 'px';
  txt.appendChild(box); curRun = null;
  return race(new Promise(res => {
    mode = 'choice';
    items.forEach((t, i) => {
      const b = document.createElement('div'); b.className = 'ch'; b.textContent = t;
      b.addEventListener('pointerup', e => { e.stopPropagation(); if (e.button === 2) return; mode = 'idle'; res(i); });
      box.appendChild(b);
    });
  })).finally(() => { box.remove(); txt.classList.remove('choosing'); if (win) txt.style.height = (win.rows * (win.fh + win.py)) + 'px'; mode = 'idle'; });
}

/* ---------------- audio ---------------- */
const bgmEl = new Audio(), seEl = new Audio();
bgmEl.loop = true; bgmEl.preload = 'auto'; seEl.preload = 'auto';
let curTrack = null, fadeTok = 0;
function silentWav() {
  const n = 800, b = new Uint8Array(44 + n * 2), dv = new DataView(b.buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function unlockAudio() {
  const u = silentWav();
  [bgmEl, seEl].forEach(el => { el.src = u; const p = el.play(); if (p && p.then) p.then(() => el.pause()).catch(() => {}); });
  applyMute();
}
function applyMute() { bgmEl.muted = seEl.muted = !!settings.mute; }
function bgm(n) {
  fadeTok++;
  if (n == null) {
    curTrack = null; const tok = fadeTok; let v = bgmEl.volume;
    const step = () => { if (tok !== fadeTok) return; v -= 0.1; if (v <= 0) { bgmEl.pause(); bgmEl.volume = 1; } else { bgmEl.volume = v; setTimeout(step, 60); } };
    step(); return;
  }
  if (n < CFG.tracks[0] || n > CFG.tracks[1]) { bgm(null); return; }
  if (n === curTrack && !bgmEl.paused) return;
  curTrack = n; bgmEl.volume = 1;
  bgmEl.src = CFG.base + 'cd/track' + String(n).padStart(2, '0') + '.mp3';
  const p = bgmEl.play(); if (p && p.catch) p.catch(() => {});
}
function wave(path, loop) {
  if (!path) { seEl.pause(); return; }
  seEl.loop = !!loop;
  seEl.src = CFG.base + String(path).replace(/\\/g, '/').toLowerCase().replace(/\.wav$/, '.mp3');
  const p = seEl.play(); if (p && p.catch) p.catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { bgmEl.pause(); } else if (curTrack != null && started) { const p = bgmEl.play(); if (p && p.catch) p.catch(() => {}); } });

/* ---------------- overlays ---------------- */
const ov = $('#overlay'), ovBody = $('#ovbody'), ovTitle = $('#ovtitle');
let ovResolve = null, ovOpen = false;
function overlayOpen() { return ovOpen; }
function closeOverlay(val) { ov.style.display = 'none'; ovOpen = false; ovBody.textContent = ''; if (ovResolve) { const r = ovResolve; ovResolve = null; r(val === undefined ? null : val); } }
function openOverlay(title, wide) {
  ovBody.textContent = ''; ovTitle.textContent = title; ov.style.display = 'flex'; ovOpen = true; ov.classList.toggle('wide', !!wide);
  return new Promise(res => { ovResolve = res; });
}
$('#ovclose').addEventListener('click', () => closeOverlay());
ov.addEventListener('pointerup', e => { if (e.target === ov) closeOverlay(); });
function btn(label, fn, cls) { const b = document.createElement('button'); b.className = 'mb' + (cls ? ' ' + cls : ''); b.textContent = label; b.addEventListener('click', fn); return b; }

function fmtTime(t) { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
function readSlot(n) { return store.get('kt-slot-' + n); }
function storeSlot(n, d) { if (!store.set('kt-slot-' + n, d)) alert('Could not save (browser storage full or disabled).'); }
function slotUI(kind) {
  const p = openOverlay(kind === 'save' ? 'Save game' : 'Load game');
  const n = (vmRef && vmRef.savenum) || 20;
  const list = document.createElement('div'); list.className = 'slots';
  for (let i = 1; i <= n; i++) {
    const d = readSlot(i);
    const row = document.createElement('div'); row.className = 'slot' + (d ? '' : ' empty');
    row.innerHTML = '<b></b><span></span><i></i>';
    row.children[0].textContent = 'Slot ' + i;
    row.children[1].textContent = d ? fmtTime(d.t) : '— empty —';
    row.children[2].textContent = d ? d.text : '';
    row.addEventListener('click', () => {
      if (kind === 'load' && !d) return;
      if (kind === 'save' && d && !confirm('Overwrite slot ' + i + '?')) return;
      closeOverlay({ slot: i });
    });
    list.appendChild(row);
  }
  ovBody.appendChild(list);
  return p;
}
const backlogEl = $('#backlog'), backlogList = $('#backlogList');
let backlogOpen = false, backlogResolve = null;
function renderBacklog() {
  backlogList.innerHTML = '';
  const pages = log.slice(-120).concat(pageText().trim() ? [pageHTML()] : []);
  if (!pages.length) { backlogList.textContent = '(nothing yet)'; return; }
  pages.forEach(t => { const d = document.createElement('div'); d.className = 'logp'; d.innerHTML = t; backlogList.appendChild(d); });
}
function showBacklog() {
  if (backlogOpen) return Promise.resolve();
  renderBacklog();
  backlogEl.classList.add('open');
  backlogOpen = true;
  backlogEl.scrollTop = backlogEl.scrollHeight;
  return new Promise(res => { backlogResolve = res; });
}
function hideBacklog() {
  if (!backlogOpen) return;
  backlogEl.classList.remove('open');
  backlogOpen = false;
  if (backlogResolve) { const r = backlogResolve; backlogResolve = null; r(); }
}
function lookback() { return showBacklog(); }
function openLog() { if (!ovOpen && vmRef && mode !== 'btn') { if (backlogOpen) hideBacklog(); else showBacklog(); } }
function windowErase() {
  winErased = true; txt.style.visibility = 'hidden'; shade.style.display = 'none';
  return race(new Promise(res => { const h = () => { winErased = false; txt.style.visibility = 'visible'; showShade(pageChars > 0); res(); }; clickResolve = h; }));
}
function toggleAuto() { settings.auto = !settings.auto; saveSettings(); updateBar(); if (settings.auto && clickResolve) advance(); }
function setMute(v) { settings.mute = v; saveSettings(); applyMute(); updateBar(); }
function fullscreen() {
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else { const f = el.requestFullscreen || el.webkitRequestFullscreen; if (f) f.call(el); }
}
async function menuAction(cmd) {
  if (!vmRef) return;
  closeOverlay();
  if (cmd === 'windowerase') { winErased = true; txt.style.visibility = 'hidden'; shade.style.display = 'none'; return; }
  if (cmd === 'lookback') { lookback(); return; }
  if (cmd === 'skip') { setSkip(true); if (clickResolve) advance(); return; }
  if (cmd === 'save') { if (!vmRef.saveOK || mode === 'btn') { alert('Saving is not available right now.'); return; } const r = await slotUI('save'); if (r) vmRef.saveSlot(r.slot); return; }
  if (cmd === 'load') { const r = await slotUI('load'); if (r) interrupt(new LoadInt(r.slot)); return; }
  if (cmd === 'reset') { if (confirm('Return to title? Unsaved progress on this page will be lost.')) interrupt(new Restart()); return; }
  if (cmd === 'wipe') {
    if (!confirm('Erase ALL saved data for this game in this browser - every save slot and all unlocked progress? This cannot be undone.')) return;
    try {
      const ks = []; for (let i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i));
      ks.forEach(k => { if (k && k.indexOf('kt-') === 0) localStorage.removeItem(k); });
    } catch (e) {}
    location.reload();
  }
}
function openMenu() {
  if (ovOpen || !vmRef) return;
  openOverlay('Menu');
  const box = document.createElement('div'); box.className = 'menu';
  (vmRef.rmenu.length ? vmRef.rmenu : [{ label: 'Display text history', cmd: 'lookback' }, { label: 'Save game', cmd: 'save' }, { label: 'Load game', cmd: 'load' }])
    .forEach(it => box.appendChild(btn(it.label, () => menuAction(it.cmd))));
  const sp = document.createElement('div'); sp.className = 'row';
  sp.appendChild(document.createTextNode('Text speed: '));
  SPEEDS.forEach((s, i) => { const b = btn(s.n, () => { settings.speed = i; saveSettings(); [...sp.querySelectorAll('button')].forEach((x, j) => x.classList.toggle('on', j === i)); }, i === settings.speed ? 'on sm' : 'sm'); sp.appendChild(b); });
  box.appendChild(sp);
  const dr = document.createElement('div'); dr.className = 'row';
  dr.appendChild(document.createTextNode('Screen: '));
  [['wide', 'Widescreen'], ['fit', '4:3 + blur'], ['stretch', 'Stretch']].forEach(([k, n]) => {
    const b = btn(n, () => { settings.display = k; saveSettings(); layout(); [...dr.querySelectorAll('button')].forEach(x => x.classList.toggle('on', x === b)); }, k === settings.display ? 'on sm' : 'sm');
    dr.appendChild(b);
  });
  box.appendChild(dr);
  const links = document.createElement('div'); links.className = 'row';
  const a = document.createElement('a'); a.href = 'bonus/Kagetsu%20Tohya%20Flowchart.pdf'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open flowchart (PDF)'; a.className = 'mb sm';
  links.appendChild(a); box.appendChild(links);
  const wipeRow = document.createElement('div'); wipeRow.className = 'row';
  wipeRow.appendChild(btn('Reset all progress (erase saves)', () => menuAction('wipe'), 'sm danger'));
  box.appendChild(wipeRow);
  ovBody.appendChild(box);
}

/* ---------------- quick bar ---------------- */
const bBack = $('#bBack'), bMenu = $('#bMenu'), bLog = $('#bLog'), bAuto = $('#bAuto'), bSkip = $('#bSkip'), bSave = $('#bSave'), bLoad = $('#bLoad'), bFull = $('#bFull'), bSnd = $('#bSnd');
function updateBar() {
  bAuto.classList.toggle('on', !!settings.auto); bSkip.classList.toggle('on', skipOn);
  bSnd.textContent = settings.mute ? '🔇' : '🔊';
  bBack.style.display = mode === 'btn' ? '' : 'none';
}
bMenu.addEventListener('click', () => { if (ovOpen) return closeOverlay(); openMenu(); });
bBack.addEventListener('click', () => { if (!ovOpen && mode === 'btn' && btnResolve) btnResolve(-1); });
bHandle.addEventListener('click', () => document.body.classList.toggle('open'));
bar.addEventListener('click', e => { const b = e.target.closest('button'); if (b && document.body.classList.contains('float') && !['bAuto', 'bSkip', 'bSnd'].includes(b.id)) document.body.classList.remove('open'); });
bLog.addEventListener('click', () => { if (backlogOpen) hideBacklog(); else if (!ovOpen && mode !== 'btn') openLog(); });
bAuto.addEventListener('click', toggleAuto);
bSkip.addEventListener('click', () => { setSkip(!skipOn); if (skipOn && clickResolve) advance(); });
bSave.addEventListener('click', () => { if (!ovOpen && mode !== 'btn') menuAction('save'); });
bLoad.addEventListener('click', () => { if (!ovOpen) menuAction('load'); });
bFull.addEventListener('click', fullscreen);
bSnd.addEventListener('click', () => setMute(!settings.mute));

/* ---------------- shake ---------------- */
function quake(axis, amp, ms) {
  if (skipping()) return Promise.resolve();
  return race(new Promise(res => {
    const t0 = performance.now(), A = Math.max(1, amp) * 1.6;
    const f = now => {
      const p = (now - t0) / ms;
      if (p >= 1) { scr.style.transform = hov.style.transform = ''; res(); return; }
      const o = Math.sin(p * Math.PI * 12) * A * (1 - p);
      const t = axis === 'x' ? 'translate(' + o + 'px,0)' : 'translate(0,' + o + 'px)';
      scr.style.transform = hov.style.transform = t;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }));
}

/* ---------------- the host object ---------------- */
let started = false;
const host = {
  yield: () => sleepRaw(0),
  random: Math.random,
  now: () => performance.now(),
  wait: async ms => { if (!skipping()) await waitText(ms, false); },
  async resetView() { fadeTok++; curTrack = null; bgmEl.pause(); bgmEl.volume = 1; seEl.pause(); clearPageNow(); log = []; oldX.clearRect(0, 0, scr.width, H); sctx.fillStyle = '#000'; sctx.fillRect(0, 0, scr.width, H); ambient(); hctx.clearRect(0, 0, hov.width, H); mode = 'idle'; },
  resetAbort: async () => { newAbort(); clickResolve = null; mode = 'idle'; typing = false; transitioning = false; },
  async commit(d, eff) {
    preloadAhead();
    lastDisp = d;
    const r = await resolveDisp(d);
    drawDisp(newX, d, r);
    const type = eff.type, time = skipping() ? 0 : eff.time;
    if (type <= 1 || time <= 0) { sctx.globalAlpha = 1; sctx.drawImage(newC, 0, 0); ambient(); return; }
    oldX.globalAlpha = 1; oldX.drawImage(scr, 0, 0);
    transSkip = false; transitioning = true;
    try { await animate(type, time); } finally { transitioning = false; }
    ambient();
  },
  setWindow, type, newline, clearPage, clearPageNow, waitClick, waitText, pageText,
  choose, buttons, btnwait,
  async blt(path, a) { if (!path) return; const i = await loadImg(path); if (i) { sctx.drawImage(i, a[4], a[5], a[6], a[7], a[0] + OX, a[1], a[2], a[3]); ambient(); } },
  quake, bgm, wave, slotUI, lookback, windowErase, setSkip, readSlot, storeSlot,
  caption: t => { document.title = t; },
  globalsDirty: () => { gDirty = true; },
  end: () => new Promise(() => { const e = $('#end'); e.style.display = 'flex'; $('#endbtn').onclick = () => location.reload(); })
};
let gDirty = false;
setInterval(flushGlobals, 1500);
function flushGlobals() { if (gDirty && vmRef) { gDirty = false; store.set('kt-global', vmRef.dumpGlobals()); } }
window.addEventListener('pagehide', flushGlobals);
window.addEventListener('beforeunload', flushGlobals);

/* ---------------- boot ---------------- */
async function boot() {
  layout(); updateBar();
  const st = $('#startbtn'), msg = $('#loadmsg');
  msg.classList.add('busy');
  let text;
  try {
    const res = await fetch(CFG.script);
    if (!res.ok) throw new Error(res.status);
    text = await res.text();
  } catch (e) { msg.classList.remove('busy'); const f = window.KTfail || (t => { msg.textContent = t; msg.style.color = '#ff9c8a'; }); f('Failed to load game script (' + (e && e.message || e) + ').'); return; }
  const vm = new VM(host, text); vmRef = vm;
  const SEED_VER = 2; vm.globalsVer = SEED_VER;
  let stored = store.get('kt-global');
  const needChoice = !stored || stored.ver !== SEED_VER;
  if (needChoice && CFG.seed !== false) {
    try {
      const rs = await fetch(CFG.seedFile);
      if (rs.ok) {
        const sd = await rs.json();
        const n = new Map(sd.n || []);
        if (stored) (stored.n || []).forEach(([k, v]) => { if (!n.has(k)) n.set(k, v); });
        stored = { ver: SEED_VER, n: [...n], l: [...new Set([...(sd.l || []), ...((stored && stored.l) || [])])], f: [...new Set([...(sd.f || []), ...((stored && stored.f) || [])])] };
        store.set('kt-global', stored);
      }
    } catch (e) { console.warn('seed unavailable', e); }
  }
  vm.loadGlobals(stored);
  let presetEro = null;
  host.beforeStart = v => { if (presetEro !== null) { v.setNum({ t: 'n', k: v.idx('eroskip') }, presetEro); presetEro = null; } };
  // warm a few images used right away
  ['image/word/type_moon.jpg', 'image/title/kagetsu_title01_en.jpg'].forEach(loadImg);
  msg.classList.remove('busy'); msg.textContent = 'Ready.'; st.disabled = false;
  const se = $('#startero');
  if (needChoice) { se.style.display = ''; se.disabled = false; }
  const go = async (ero) => {
    if (started) return; started = true;
    if (needChoice) presetEro = ero;
    unlockAudio();
    const startEl = $('#start');
    startEl.classList.add('leaving');
    setTimeout(() => { startEl.style.display = 'none'; }, 460);
    if (document.documentElement.requestFullscreen && matchMedia('(pointer:coarse)').matches) { try { await document.documentElement.requestFullscreen(); } catch (e) {} }
    layout();
    try { await vm.run('define'); } catch (e) { console.error(e); $('#err').style.display = 'flex'; $('#errmsg').textContent = String(e && e.message || e); }
  };
  st.addEventListener('click', () => go(0));
  se.addEventListener('click', () => go(1));
  window.KT = { vm, host };
}
boot();
})();
