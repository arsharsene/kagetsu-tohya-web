/* Kagetsu Tohya Web — NScripter script interpreter (DOM-free core).
   Runs the original, unmodified nscript.dat script (decoded to script.txt). */
(function (root) {
'use strict';

const CMDS = new Set(('br bg ld return gosub mov if playstop cl play skip inc goto wave wavestop numalias monocro selnum ' +
  'select quakey notif btn waveloop effect stralias quakex cmp vsp itoa setcursor sub add btndef print btnwait resettimer ' +
  'waittimer csp setwindow dec selgosub rnd windoweffect lsph lsp dim saveoff saveon end locate erasetextwindow movl ' +
  'versionstr caption nsa effectblank cdfadeout mp3fadeout selectcolor menusetwindow menuselectcolor rmenu savenumber ' +
  'savename lookbackbutton lookbackcolor globalon filelog labellog game blt getversion msp savegame date ofscpy ' +
  'loadgame systemcall jumpf jumpb reset').split(' '));

class Halt extends Error {}
class Restart extends Error {}
class LoadInt extends Error { constructor(slot) { super('load'); this.slot = slot; } }

/* ---------- small string helpers ---------- */
function splitTop(s, sep) {
  sep = sep || ',';
  const out = []; let cur = '', dq = false, bt = false, par = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (dq) { cur += ch; if (ch === '"') dq = false; continue; }
    if (bt) { cur += ch; if (ch === '`') bt = false; continue; }
    if (ch === '"') { dq = true; cur += ch; continue; }
    if (ch === '`') { bt = true; cur += ch; continue; }
    if (ch === '(' || ch === '[') par++;
    if (ch === ')' || ch === ']') par--;
    if (ch === sep && par === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim());
}
function stripComment(s) {
  let dq = false, bt = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (dq) { if (ch === '"') dq = false; continue; }
    if (bt) { if (ch === '`') bt = false; continue; }
    if (ch === '"') dq = true; else if (ch === '`') bt = true;
    else if (ch === ';') return s.slice(0, i);
  }
  return s;
}
class P { constructor(s) { this.s = s; this.i = 0; }
  ws() { while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++; }
  peek() { this.ws(); return this.s[this.i]; }
  eof() { this.ws(); return this.i >= this.s.length; } }

/* ---------- VM ---------- */
class VM {
  constructor(host, scriptText) {
    this.host = host;
    this.lines = scriptText.split('\n');
    this.cache = new Array(this.lines.length);
    this.labels = new Map();
    this.tildes = [];
    this.lines.forEach((l, i) => {
      const t = l.trim();
      if (t[0] === '*') this.labels.set(t.slice(1).trim().toLowerCase(), i);
      else if (t === '~') this.tildes.push(i);
    });
    this.numAlias = new Map(); this.strAlias = new Map(); this.dynIdx = new Map(); this.nextDyn = 100000;
    this.effects = new Map();
    this.seenLabels = new Set(); this.fileLog = new Set(); this.gnums = new Map();
    this.rmenu = []; this.savenum = 20;
    this.initState();
    this.unknown = new Map();
    this.timerT0 = 0;
  }
  initState() {
    this.nums = new Map(); this.strs = new Map(); this.arrs = new Map();
    this.stack = []; this.pc = { line: 0, s: 0 }; this.cur = { line: 0, s: 0 };
    this.jump = null;
    this.disp = { bg: { color: '#000000' }, tachi: { l: null, c: null, r: null }, sp: {}, mono: null };
    this.bgm = null; this.wave = null;
    this.win = null; this.pageHas = false; this.pageSnap = null;
    this.btn = { img: null, list: [] };
    this.dirty = false; this.saveOK = true;
    this.textSpeedOverride = null; this.textColor = null;
  }

  /* -------- persistence of globals -------- */
  loadGlobals(obj) {
    if (!obj) return;
    this.gnums = new Map((obj.n || []).map(([k, v]) => [k, v]));
    this.seenLabels = new Set(obj.l || []);
    this.fileLog = new Set(obj.f || []);
  }
  dumpGlobals() { return { ver: this.globalsVer || 0, n: [...this.gnums], l: [...this.seenLabels], f: [...this.fileLog] }; }
  normFile(s) { return String(s).replace(/^:[^;]*;/, '').replace(/\\/g, '/').trim().toLowerCase(); }
  logFile(s) {
    const k = this.normFile(s);
    if (k && !this.fileLog.has(k)) { this.fileLog.add(k); this.host.globalsDirty && this.host.globalsDirty(); }
  }

  /* -------- variables -------- */
  idx(name) {
    if (/^-?\d+$/.test(name)) return parseInt(name, 10);
    const k = name.toLowerCase();
    if (this.numAlias.has(k)) return this.numAlias.get(k);
    if (!this.dynIdx.has(k)) this.dynIdx.set(k, this.nextDyn++);
    return this.dynIdx.get(k);
  }
  getNum(r) {
    if (r.t === 'n') return (r.k >= 200 ? this.gnums.get(r.k) : this.nums.get(r.k)) || 0;
    if (r.t === 'a') { const a = this.arrs.get(r.k); return a ? (a.get(r.ix.join(',')) || 0) : 0; }
    return 0;
  }
  setNum(r, v) {
    v = Math.trunc(v) || 0;
    if (r.t === 'n') { if (r.k >= 200) { this.gnums.set(r.k, v); this.host.globalsDirty && this.host.globalsDirty(); } else this.nums.set(r.k, v); }
    else if (r.t === 'a') { let a = this.arrs.get(r.k); if (!a) { a = new Map(); this.arrs.set(r.k, a); } a.set(r.ix.join(','), v); }
  }
  getStr(r) { return this.strs.get(r.k) || ''; }
  setStr(r, v) { this.strs.set(r.k, String(v)); }

  /* -------- expression parsing -------- */
  ref(p) {
    p.ws();
    const c = p.s[p.i];
    if (c === '%' || c === '$') {
      p.i++;
      if (p.s[p.i] === '%') {
        // indirect addressing: $%<numexpr> / %%<numexpr> - the index itself
        // is the current value of a numeric variable (or expression).
        const idx = this.numExpr(p);
        return { t: c === '%' ? 'n' : 's', k: Math.trunc(idx) };
      }
      const m = /^[A-Za-z_0-9]+/.exec(p.s.slice(p.i));
      if (!m) return { t: c === '%' ? 'n' : 's', k: 0 };
      p.i += m[0].length;
      return { t: c === '%' ? 'n' : 's', k: this.idx(m[0]) };
    }
    if (c === '?') {
      p.i++;
      const m = /^[A-Za-z_0-9]+/.exec(p.s.slice(p.i));
      p.i += m ? m[0].length : 0;
      const name = m ? m[0].toLowerCase() : '0';
      const ix = [];
      while (p.s[p.i] === '[') { p.i++; ix.push(this.numExpr(p)); p.ws(); if (p.s[p.i] === ']') p.i++; }
      return { t: 'a', k: name, ix };
    }
    return { t: 'n', k: 0 };
  }
  numExpr(p) {
    let v = this.term(p);
    for (;;) {
      const c = p.peek();
      if (c === '+') { p.i++; v += this.term(p); }
      else if (c === '-') { p.i++; v -= this.term(p); }
      else break;
    }
    return v;
  }
  term(p) {
    let v = this.factor(p);
    for (;;) {
      const c = p.peek();
      if (c === '*') { p.i++; v *= this.factor(p); }
      else if (c === '/') { p.i++; const d = this.factor(p); v = d ? Math.trunc(v / d) : 0; }
      else if (p.s.startsWith('mod', p.i) && !/[A-Za-z0-9_]/.test(p.s[p.i + 3] || ' ')) { p.i += 3; const d = this.factor(p); v = d ? v % d : 0; }
      else break;
    }
    return v;
  }
  factor(p) {
    const c = p.peek();
    if (c === '-') { p.i++; return -this.factor(p); }
    if (c === '+') { p.i++; return this.factor(p); }
    if (c === '(') { p.i++; const v = this.numExpr(p); if (p.peek() === ')') p.i++; return v; }
    if (c === '%' || c === '?') return this.getNum(this.ref(p));
    if (c === '#') { const m = /^#[0-9a-fA-F]{6}/.exec(p.s.slice(p.i)); if (m) { p.i += 7; return parseInt(m[0].slice(1), 16); } }
    if (c !== undefined && /[0-9]/.test(c)) {
      const m = /^(0x[0-9a-fA-F]+|\d+)/.exec(p.s.slice(p.i));
      p.i += m[0].length; return Number(m[0]);
    }
    const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(p.s.slice(p.i));
    if (m) { p.i += m[0].length; const k = m[0].toLowerCase(); return this.numAlias.has(k) ? this.numAlias.get(k) : 0; }
    return 0;
  }
  strTerm(p) {
    const c = p.peek();
    if (c === '"') { const j = p.s.indexOf('"', p.i + 1); const e = j < 0 ? p.s.length : j; const r = p.s.slice(p.i + 1, e); p.i = e + 1; return r; }
    if (c === '`') { const j = p.s.indexOf('`', p.i + 1); const e = j < 0 ? p.s.length : j; const r = p.s.slice(p.i + 1, e); p.i = e + 1; return r; }
    if (c === '$') return this.getStr(this.ref(p));
    if (c === '#') { const m = /^#[0-9a-fA-F]{6}/.exec(p.s.slice(p.i)); if (m) { p.i += 7; return m[0]; } }
    const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(p.s.slice(p.i));
    if (m) { p.i += m[0].length; const k = m[0].toLowerCase(); return this.strAlias.has(k) ? this.strAlias.get(k) : m[0]; }
    return '';
  }
  strExpr(p) {
    let v = this.strTerm(p);
    while (p.peek() === '+') { p.i++; v += this.strTerm(p); }
    return v;
  }
  isStrStart(p) { const c = p.peek(); return c === '"' || c === '`' || c === '$'; }
  cmpTerm(p) {
    p.ws();
    if (p.s.startsWith('lchk', p.i)) { p.i += 4; p.ws(); const m = /^\*[^\s]+/.exec(p.s.slice(p.i)); if (m) { p.i += m[0].length; return this.seenLabels.has(m[0].slice(1).toLowerCase()); } return false; }
    if (p.s.startsWith('fchk', p.i)) { p.i += 4; p.ws(); return this.fileLog.has(this.normFile(this.strExpr(p))); }
    let a, b, isStr = this.isStrStart(p);
    a = isStr ? this.strExpr(p) : this.numExpr(p);
    p.ws();
    const m = /^(>=|<=|==|!=|<>|=|>|<)/.exec(p.s.slice(p.i));
    if (!m) return !!a;
    p.i += m[1].length;
    b = isStr ? this.strExpr(p) : this.numExpr(p);
    switch (m[1]) {
      case '>=': return a >= b; case '<=': return a <= b; case '>': return a > b; case '<': return a < b;
      case '==': case '=': return a === b; default: return a !== b;
    }
  }
  cond(p) {
    let r = this.cmpTerm(p);
    for (;;) {
      p.ws();
      if (p.s.startsWith('&&', p.i)) { p.i += 2; const t = this.cmpTerm(p); r = r && t; }
      else if (p.s.startsWith('||', p.i)) { p.i += 2; const t = this.cmpTerm(p); r = r || t; }
      else if (p.s[p.i] === '&') { p.i++; const t = this.cmpTerm(p); r = r && t; }
      else break;
    }
    return r;
  }
  N(a) { return a === undefined || a === '' ? 0 : this.numExpr(new P(a)); }
  S(a) { return a === undefined ? '' : this.strExpr(new P(a)); }
  R(a) { return this.ref(new P(a)); }

  /* -------- line parsing -------- */
  parsed(i) {
    let c = this.cache[i]; if (c) return c;
    const raw = this.lines[i];
    const t = raw.replace(/^[\s\u3000]+/, '');
    let res;
    if (t === '' || t[0] === ';' || t === '~') res = { kind: 'empty', n: 1 };
    else if (t[0] === '*') res = { kind: 'label', name: t.slice(1).trim().toLowerCase(), n: 1 };
    else if (t[0] === '`') res = { kind: 'text', text: t.slice(1), n: 1 };
    else {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(t);
      const w = m ? m[0].toLowerCase() : null;
      if (w && (CMDS.has(w) || w === 'waveloop') && (m[0] === w || w === 'waveloop')) {
        let s = stripComment(t), n = 1;
        while (s.trimEnd().endsWith(',') && i + n < this.lines.length) { s = s.trimEnd() + ' ' + stripComment(this.lines[i + n]).trim(); n++; }
        const stmts = []; let cur = '', dq = false, bt = false;
        for (let k = 0; k < s.length; k++) {
          const ch = s[k];
          if (dq) { cur += ch; if (ch === '"') dq = false; continue; }
          if (bt) { cur += ch; if (ch === '`') bt = false; continue; }
          if (ch === '"') { dq = true; cur += ch; continue; }
          if (ch === '`') { bt = true; cur += ch; continue; }
          if (ch === ':') { stmts.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        stmts.push(cur.trim());
        res = { kind: 'cmd', stmts: stmts.filter(x => x), n };
      } else res = { kind: 'text', text: t, n: 1 };
    }
    this.cache[i] = res; return res;
  }

  /* -------- main loop -------- */
  labelLine(name) {
    const l = this.labels.get(String(name).replace(/^\*/, '').trim().toLowerCase());
    if (l === undefined) throw new Error('label not found: ' + name);
    return l;
  }
  async run(startLabel) {
    this.pc = { line: this.labelLine(startLabel || 'define'), s: 0 };
    for (;;) {
      try { await this.loop(); return; }
      catch (e) {
        if (e instanceof Restart) { await this.host.resetAbort(); this.initState(); this.pc = { line: this.labelLine('start'), s: 0 }; await this.host.resetView(); continue; }
        if (e instanceof LoadInt) { await this.host.resetAbort(); try { await this.loadSlot(e.slot); } catch (er) { console.error(er); } if (this.jump) { this.pc = this.jump; this.jump = null; } continue; }
        if (e instanceof Halt) return;
        console.error('VM error at line ' + (this.cur.line + 1) + ': ' + (this.lines[this.cur.line] || '').slice(0, 100), e);
        throw e;
      }
    }
  }
  async loop() {
    let guard = 0;
    while (this.pc.line < this.lines.length) {
      const i = this.pc.line;
      const pl = this.parsed(i);
      if (pl.kind === 'empty') { this.pc = { line: i + 1, s: 0 }; continue; }
      if (pl.kind === 'label') {
        if (!this.seenLabels.has(pl.name)) { this.seenLabels.add(pl.name); this.host.globalsDirty && this.host.globalsDirty(); }
        this.pc = { line: i + 1, s: 0 }; continue;
      }
      if (pl.kind === 'text') {
        this.cur = { line: i, s: 0 };
        await this.runText(pl.text, i);
        this.pc = { line: i + 1, s: 0 };
        if (++guard % 400 === 0) await this.host.yield();
        continue;
      }
      // cmd
      let k = this.pc.s;
      for (; k < pl.stmts.length; k++) {
        this.cur = { line: i, s: k };
        this.jump = null;
        const r = await this.exec(pl.stmts[k]);
        if (this.jump) { this.pc = this.jump; this.jump = null; k = -1; break; }
        if (r === 'endline') { k = pl.stmts.length; break; }
      }
      if (k >= 0) this.pc = { line: i + pl.n, s: 0 };
      if (++guard % 400 === 0) await this.host.yield();
    }
  }

  /* -------- statements -------- */
  async exec(stmt) {
    const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(stmt);
    if (!m) return;
    const w = m[0].toLowerCase();
    const rest = stmt.slice(m[0].length).trim();
    if (w === 'if' || w === 'notif') {
      const p = new P(rest);
      let c = this.cond(p);
      if (w === 'notif') c = !c;
      if (!c) return 'endline';
      const tail = rest.slice(p.i).trim();
      if (tail) return this.exec(tail);
      return;
    }
    const f = this['c_' + w];
    if (!f) { this.unknown.set(w, (this.unknown.get(w) || 0) + 1); return; }
    const args = rest === '' ? [] : splitTop(rest);
    return f.call(this, args, rest);
  }
  goLabel(a) { a = a.trim(); if (a[0] === '$') a = this.S(a); this.jump = { line: this.labelLine(a), s: 0 }; }

  c_goto(a) { this.goLabel(a[0]); }
  c_gosub(a) { this.stack.push({ line: this.cur.line, s: this.cur.s + 1 }); this.goLabel(a[0]); }
  c_return() { const r = this.stack.pop(); if (!r) throw new Error('return without gosub at line ' + (this.cur.line + 1)); this.jump = r; }
  c_skip(a) { this.jump = { line: this.cur.line + this.N(a[0]), s: 0 }; }
  c_jumpf() { const l = this.tildes.find(t => t > this.cur.line); this.jump = { line: l === undefined ? this.lines.length : l, s: 0 }; }
  c_jumpb() { let l; for (const t of this.tildes) if (t < this.cur.line) l = t; this.jump = { line: l === undefined ? 0 : l, s: 0 }; }
  c_end() { return this.host.end().then(() => { throw new Halt(); }); }
  c_reset() { throw new Restart(); }
  c_game() { if (this.host.beforeStart) this.host.beforeStart(this); this.jump = { line: this.labelLine('start'), s: 0 }; }

  c_numalias(a) { this.numAlias.set(a[0].toLowerCase(), this.N(a[1])); }
  c_stralias(a) { this.strAlias.set(a[0].toLowerCase(), this.S(a[1])); }
  c_mov(a) { const r = this.R(a[0]); if (r.t === 's') this.setStr(r, this.S(a[1])); else this.setNum(r, this.N(a[1])); }
  c_add(a) { const r = this.R(a[0]); if (r.t === 's') this.setStr(r, this.getStr(r) + this.S(a[1])); else this.setNum(r, this.getNum(r) + this.N(a[1])); }
  c_sub(a) { const r = this.R(a[0]); this.setNum(r, this.getNum(r) - this.N(a[1])); }
  c_inc(a) { const r = this.R(a[0]); this.setNum(r, this.getNum(r) + 1); }
  c_dec(a) { const r = this.R(a[0]); this.setNum(r, this.getNum(r) - 1); }
  c_cmp(a) { const r = this.R(a[0]); const x = this.S(a[1]), y = this.S(a[2]); this.setNum(r, x === y ? 0 : (x > y ? 1 : -1)); }
  c_itoa(a) { this.setStr(this.R(a[0]), String(this.N(a[1]))); }
  c_rnd(a) { this.setNum(this.R(a[0]), Math.floor(this.host.random() * this.N(a[1]))); }
  c_date(a) { const d = new Date(); [d.getFullYear(), d.getMonth() + 1, d.getDate()].forEach((v, i) => a[i] && this.setNum(this.R(a[i]), v)); }
  c_getversion(a) { this.setNum(this.R(a[0]), 199); }
  c_dim(a, rest) { const p = new P(rest); const r = this.ref(p); if (!this.arrs.has(r.k)) this.arrs.set(r.k, new Map()); }
  c_movl(a) { const r = this.R(a[0]); a.slice(1).forEach((v, i) => this.setNum({ t: 'a', k: r.k, ix: [i] }, this.N(v))); }

  /* display */
  imgPath(spec) {
    // strip ":a;" ":c;" ":l/3,160,2;" prefixes
    return String(spec).replace(/^:[^;]*;/, '');
  }
  colorSpec(s) {
    s = String(s).trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (s === 'black') return '#000000'; if (s === 'white') return '#ffffff';
    return null;
  }
  effectFor(n) { const e = this.effects.get(n); return e ? e : { type: n <= 1 ? 0 : 10, time: n <= 1 ? 0 : 400, n }; }
  async commit(n) {
    this.dirty = false;
    await this.host.commit(this.disp, this.effectFor(n));
  }
  async flush() { if (this.dirty) await this.commit(1); }
  async c_bg(a) {
    const s = this.S(a[0]); const col = this.colorSpec(s);
    this.disp.tachi = { l: null, c: null, r: null };
    this.disp.bg = col ? { color: col } : { path: this.imgPath(s) };
    if (!col) this.logFile(s);
    if (this.pageHas) this.clearPage();
    await this.commit(this.N(a[1]));
  }
  async c_ld(a) {
    const pos = a[0].trim().toLowerCase()[0];
    const ls = this.S(a[1]); this.disp.tachi[pos] = this.imgPath(ls); this.logFile(ls);
    if (this.pageHas) this.clearPage();
    await this.commit(this.N(a[2]));
  }
  async c_cl(a) {
    const pos = a[0].trim().toLowerCase()[0];
    if (pos === 'a') this.disp.tachi = { l: null, c: null, r: null }; else this.disp.tachi[pos] = null;
    if (this.pageHas) this.clearPage();
    await this.commit(this.N(a[1]));
  }
  c_lsp(a, r, hidden) {
    const n = this.N(a[0]); const s = this.S(a[1]);
    if (/^:s/.test(s)) { delete this.disp.sp[n]; return; }
    this.logFile(s);
    this.disp.sp[n] = { path: this.imgPath(s), x: this.N(a[2]), y: this.N(a[3]), a: a[4] !== undefined ? this.N(a[4]) : 255, v: !hidden };
    this.dirty = true;
  }
  c_lsph(a, r) { return this.c_lsp(a, r, true); }
  c_vsp(a) { const s = this.disp.sp[this.N(a[0])]; if (s) { s.v = !!this.N(a[1]); this.dirty = true; } }
  c_csp(a) { const n = this.N(a[0]); if (n < 0) this.disp.sp = {}; else delete this.disp.sp[n]; this.dirty = true; }
  c_msp(a) { const s = this.disp.sp[this.N(a[0])]; if (s) { s.x += this.N(a[1]); s.y += this.N(a[2]); if (a[3] !== undefined) s.a = Math.max(0, Math.min(255, s.a + this.N(a[3]))); this.dirty = true; } }
  async c_print(a) { await this.commit(this.N(a[0])); }
  c_monocro(a, rest) { const s = rest.trim().toLowerCase(); this.disp.mono = /^#[0-9a-f]{6}$/.test(s) ? s : null; this.dirty = true; }
  c_effect(a) { this.effects.set(this.N(a[0]), { type: this.N(a[1]), time: a[2] !== undefined ? this.N(a[2]) : 0, n: this.N(a[0]) }); }
  c_effectblank() {} c_windoweffect() {} c_setcursor() {} c_locate() {} c_ofscpy() {}
  c_versionstr() {} c_nsa() {} c_selectcolor() {} c_menusetwindow() {} c_menuselectcolor() {}
  c_lookbackbutton() {} c_lookbackcolor() {} c_globalon() {} c_filelog() {} c_labellog() {} c_savename() {}
  c_caption(a) { this.host.caption && this.host.caption(this.S(a[0])); }
  c_cdfadeout() {} c_mp3fadeout() {}
  c_saveoff() { this.saveOK = false; } c_saveon() { this.saveOK = true; }
  c_savenumber(a) { this.savenum = this.N(a[0]); }
  c_erasetextwindow() {}
  c_rmenu(a) { this.rmenu = []; for (let i = 0; i + 1 < a.length; i += 2) this.rmenu.push({ label: this.S(a[i]), cmd: a[i + 1].trim().toLowerCase() }); }
  c_setwindow(a) {
    const n = i => this.N(a[i]);
    const col = (a[11] || '').trim();
    this.win = { x: n(0), y: n(1), cols: n(2), rows: n(3), fw: n(4), fh: n(5), px: n(6), py: n(7), speed: n(8), bold: n(9), shadow: n(10),
      color: /^#[0-9a-fA-F]{6}$/.test(col) ? col : null, x1: n(12), y1: n(13), x2: n(14), y2: n(15) };
    this.host.setWindow(this.win);
  }
  async c_blt(a) { await this.host.blt(this.btn.img, a.slice(0, 8).map(x => this.N(x))); }
  async c_quakex(a) { await this.host.quake('x', this.N(a[0]), this.N(a[1])); }
  async c_quakey(a) { await this.host.quake('y', this.N(a[0]), this.N(a[1])); }
  async c_resettimer() { this.timerT0 = this.host.now(); }
  async c_waittimer(a) { const t = this.N(a[0]) - (this.host.now() - this.timerT0); if (t > 0) await this.host.wait(t); }

  /* audio */
  c_play(a) { const s = this.S(a[0]); const m = /^\*(\d+)/.exec(s); this.bgm = m ? parseInt(m[1], 10) : null; if (m) this.host.bgm(this.bgm); }
  c_playstop() { this.bgm = null; this.host.bgm(null); }
  c_wave(a) { const p = this.S(a[0]); this.wave = null; this.host.wave(p, false); }
  c_waveloop(a) { const p = this.S(a[0]); this.wave = p; this.host.wave(p, true); }
  c_wavestop() { this.wave = null; this.host.wave(null, false); }

  /* buttons */
  c_btndef(a) { this.btn = { img: this.S(a[0]) || null, list: [] }; this.host.buttons(this.btn); }
  c_btn(a) { this.btn.list.push({ n: this.N(a[0]), x: this.N(a[1]), y: this.N(a[2]), w: this.N(a[3]), h: this.N(a[4]), ox: this.N(a[5]), oy: this.N(a[6]) }); this.host.buttons(this.btn); }
  async c_btnwait(a) {
    await this.flush();
    this.host.buttons(this.btn);
    const v = await this.host.btnwait();
    this.setNum(this.R(a[0]), v);
  }

  /* choices */
  async choose(items) {
    await this.flush();
    if (this.pageHas && !items.length) return -1;
    const i = await this.host.choose(items.map(x => x.text));
    this.clearPage();
    return i;
  }
  async c_selnum(a) { const r = this.R(a[0]); const items = a.slice(1).map(x => ({ text: this.S(x) })); const i = await this.choose(items); this.setNum(r, i); }
  choiceList(a) { const items = []; for (let i = 0; i + 1 < a.length; i += 2) items.push({ text: this.S(a[i]), label: a[i + 1] }); return items; }
  async c_select(a) { const items = this.choiceList(a); const i = await this.choose(items); this.goLabel(items[i].label); }
  async c_selgosub(a) { const items = this.choiceList(a); const i = await this.choose(items); this.stack.push({ line: this.cur.line, s: this.cur.s + 1 }); this.goLabel(items[i].label); }

  /* system */
  async c_systemcall(a) {
    const w = (a[0] || '').trim().toLowerCase();
    await this.sysAction(w);
  }
  async sysAction(w) {
    if (w === 'load') { const r = await this.host.slotUI('load'); if (r) await this.loadSlot(r.slot); }
    else if (w === 'save') { if (this.saveOK) { const r = await this.host.slotUI('save'); if (r) this.saveSlot(r.slot); } }
    else if (w === 'lookback') await this.host.lookback();
    else if (w === 'windowerase') await this.host.windowErase();
    else if (w === 'skip') this.host.setSkip(true);
    else if (w === 'reset') throw new Restart();
  }
  c_savegame(a) { this.saveSlot(this.N(a[0]), true); }
  async c_loadgame(a) { await this.loadSlot(this.N(a[0]), true); }

  /* -------- state snapshots -------- */
  snapshot(pc) {
    const cp = m => [...m];
    const arrs = []; this.arrs.forEach((v, k) => arrs.push([k, [...v]]));
    return {
      pc, stack: this.stack.map(x => ({ ...x })), nums: cp(this.nums), strs: cp(this.strs), arrs,
      disp: JSON.parse(JSON.stringify(this.disp)), bgm: this.bgm, wave: this.wave, win: this.win && { ...this.win },
      btn: null
    };
  }
  saveSlot(n, fromScript) {
    let snap;
    if (fromScript) snap = this.snapshot({ line: this.cur.line, s: this.cur.s + 1 });
    else snap = this.pageHas && this.pageSnap ? this.pageSnap : this.snapshot({ line: this.cur.line, s: 0 });
    const text = this.host.pageText ? this.host.pageText() : '';
    this.host.storeSlot(n, { v: 1, t: Date.now(), text: text.replace(/\s+/g, ' ').trim().slice(0, 90), snap });
  }
  async loadSlot(n, fromScript) {
    const d = this.host.readSlot(n);
    if (!d) return false;
    const s = d.snap;
    this.stack = s.stack; this.nums = new Map(s.nums); this.strs = new Map(s.strs);
    this.arrs = new Map(s.arrs.map(([k, v]) => [k, new Map(v)]));
    this.disp = s.disp; this.bgm = s.bgm; this.wave = s.wave; this.win = s.win;
    this.pageHas = false; this.pageSnap = null;
    this.host.clearPageNow();
    if (this.win) this.host.setWindow(this.win);
    this.host.bgm(this.bgm); this.host.wave(this.wave, !!this.wave);
    await this.host.commit(this.disp, { type: 0, time: 0 });
    this.jump = { line: s.pc.line, s: s.pc.s };
    return true;
  }

  /* -------- text -------- */
  clearPage() {
    this.host.clearPage();
    this.pageHas = false; this.pageSnap = null; this.textColor = null;
  }
  async c_br() { if (!this.pageHas) { this.pageStart(); } this.host.newline(); this.pageHas = true; }
  pageStart() {
    if (!this.pageHas) { this.pageHas = true; this.pageSnap = this.snapshot({ line: this.cur.line, s: 0 }); }
  }
  async runText(raw, lineNo) {
    const h = this.host;
    await this.flush();
    if (!this.pageHas) { this.pageSnap = this.snapshot({ line: lineNo, s: 0 }); this.pageHas = true; }
    let i = 0, endedWait = false, buf = '';
    const flushBuf = async () => { if (buf) { await h.type(buf, { color: this.textColor, speed: this.textSpeedOverride }); buf = ''; } };
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '@') { await flushBuf(); i++; await h.waitClick(false); continue; }
      if (ch === '\\') { await flushBuf(); i++; await h.waitClick(true); this.clearPage(); this.pageHas = false; endedWait = i >= raw.length;
        if (i < raw.length) { this.pageSnap = this.snapshot({ line: lineNo, s: 0 }); this.pageHas = true; } continue; }
      if (ch === '!') {
        const m = /^!(sd|s(\d+)|w(\d+)|d(\d+))/.exec(raw.slice(i, i + 12));
        if (m) {
          await flushBuf(); i += m[0].length;
          if (m[1] === 'sd') this.textSpeedOverride = null;
          else if (m[2] !== undefined) this.textSpeedOverride = parseInt(m[2], 10);
          else if (m[3] !== undefined) await h.waitText(parseInt(m[3], 10), true);
          else if (m[4] !== undefined) await h.waitText(parseInt(m[4], 10), false);
          endedWait = false; continue;
        }
      }
      if (ch === '#') {
        const m = /^#[0-9a-fA-F]{6}/.exec(raw.slice(i, i + 7));
        if (m) { await flushBuf(); this.textColor = m[0]; i += 7; continue; }
      }
      buf += ch; i++; endedWait = false;
    }
    await flushBuf();
    if (!endedWait) h.newline();
  }
}

VM.splitTop = splitTop;
if (typeof module !== 'undefined' && module.exports) module.exports = { VM, Halt, Restart, LoadInt };
else root.KT_VM = { VM, Halt, Restart, LoadInt };
})(typeof window !== 'undefined' ? window : globalThis);
