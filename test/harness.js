// lab-kanri GAS の試験用ハーネス：Apps Script の API を最小限で模擬し、Code_v2.gs と License.gs を
// 1つの vm コンテキストに順に読み込む（ファイルをまたいで関数・定数を呼べる）。
// 手本: shast-master/gas/test/harness.js（Sheet/Range/vm の方式）。lab-kanri は単独スクリプトなので
// getActiveSpreadsheet ではなく SpreadsheetApp.openById(id) を模擬する。
//
// 使い方:
//   const harness = require('./harness');
//   const h = harness.build({ files:['Code_v2.gs','License.gs'], books:{ <id>:{ <タブ名>:[[...]] } },
//                             drive:{ files:{ <id>:{name,mimeType,parents:[...],driveId,trashed} } }, now:<ms> });
//   harness.post(h, {action:'ping'})   // doPost を呼んで応答の JSON を返す
//   h.clock.advance(ms)                // 模擬の時計を進める（Utilities.sleep も同じく進める）
//   h.calls.openById / driveGet / driveList / flush / tryLock ...  // 呼ばれた回数
//   h.failOpen.add(id)                 // そのIDの openById が例外を投げる
//   h.failDrive = true                 // Drive.Files.list/get が例外を投げる
//   h.eval('APP_VERSION')              // vm 内の const も読める
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT = path.join(__dirname, '..');
const FIXED_NOW = new Date('2026-11-02T12:00:00+09:00').getTime();

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); o.push(row); } return o; }
  getValue() { return this.sh.get(this.r, this.c); }
  getDisplayValues() { return this.getValues().map(r => r.map(v => v === '' || v == null ? '' : String(v))); }
  setValue(v) { this.sh.set(this.r, this.c, v); return this; }
  setValues(m) { m.forEach((row, i) => row.forEach((v, j) => this.sh.set(this.r + i, this.c + j, v))); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, ''); return this; }
  setNumberFormat() { return this; } setBackground() { return this; } setFontWeight() { return this; } setFontColor() { return this; }
  setDataValidation() { return this; } clearNote() { return this; } setNote() { return this; } getFormula() { return ''; }
}
class Sheet {
  constructor(name, rows) { this.name = name; this.rows = (rows || []).map(r => r.slice()); }
  getName() { return this.name; }
  get(r, c) { const row = this.rows[r - 1]; if (!row) return ''; const v = row[c - 1]; return v === undefined ? '' : v; }
  set(r, c, v) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
  appendRow(a) { this.rows.push(a.slice()); return this; }
  deleteRows(r, n = 1) { this.rows.splice(r - 1, n); }
  setFrozenRows() {} setColumnWidth() {} autoResizeColumns() {} hideSheet() { return this; }
}
class Book {
  constructor(id, tabs, h) {
    this.id = id; this.h = h; this.sheets = [];   // 並び順＝タブの左から右
    for (const [n, rows] of Object.entries(tabs || {})) this.sheets.push(new Sheet(n, rows));
  }
  getId() { return this.id; }
  getName() { return 'book:' + this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSheetByName(n) { this.h.calls.getSheetByName++; return this.sheets.find(s => s.name === n) || null; }
  getSheets() { this.h.calls.getSheets++; return this.sheets.slice(); }
  insertSheet(n) { const s = new Sheet(n, []); this.sheets.push(s); return s; }   // 一番右に足す
}

function build(opts) {
  opts = opts || {};
  const files = opts.files || ['Code_v2.gs', 'License.gs'];
  let nowMs = opts.now == null ? FIXED_NOW : opts.now;
  const clock = {
    now: () => nowMs,
    advance(ms) { nowMs += ms; },
    set(ms) { nowMs = ms; }
  };
  const calls = { openById: 0, getSheetByName: 0, getSheets: 0, flush: 0, driveGet: 0, driveList: 0,
                  cacheGet: 0, cachePut: 0, cacheRemove: 0, propGet: 0, propSet: 0, propDelete: 0,
                  tryLock: 0, waitLock: 0, releaseLock: 0, sleep: 0 };
  const failOpen = new Set();
  const h = { calls, failOpen, failDrive: false, clock };

  // ---- 本（スプレッドシート） ----
  const books = {};
  h.books = books;
  for (const [id, tabs] of Object.entries(opts.books || {})) books[id] = new Book(id, tabs, h);

  // ---- ドライブ ----
  const driveFiles = Object.assign({}, (opts.drive && opts.drive.files) || {});
  h.drive = { files: driveFiles };
  const toApi = (id, f, fields) => {
    const full = { id, name: f.name, mimeType: f.mimeType, parents: (f.parents || []).slice(), driveId: f.driveId, trashed: !!f.trashed, modifiedTime: f.modifiedTime };
    if (!fields) return full;
    const o = { id };
    for (const k of String(fields).replace(/files\(|\)/g, '').split(',').map(s => s.trim()).filter(Boolean)) if (k in full) o[k] = full[k];
    return o;
  };
  const matchQ = (f, q) => {   // 解釈するのは `'<id>' in parents` / name='…' / mimeType='…' / trashed=false|true を ` and ` でつないだもの
    for (const term of String(q || '').split(/\s+and\s+/).map(s => s.trim()).filter(Boolean)) {
      let m;
      if ((m = term.match(/^'([^']*)'\s+in\s+parents$/))) { if (!(f.parents || []).includes(m[1])) return false; }
      else if ((m = term.match(/^name\s*=\s*'((?:[^'\\]|\\.)*)'$/))) { if (f.name !== m[1].replace(/\\(.)/g, '$1')) return false; }
      else if ((m = term.match(/^mimeType\s*=\s*'([^']*)'$/))) { if (f.mimeType !== m[1]) return false; }
      else if ((m = term.match(/^trashed\s*=\s*(true|false)$/))) { if (!!f.trashed !== (m[1] === 'true')) return false; }
      else throw new Error('模擬ドライブが解釈できない q: ' + term);
    }
    return true;
  };
  const Drive = { Files: {
    list(params) {
      calls.driveList++;
      if (h.failDrive) throw new Error('Drive 模擬: 失敗させている (failDrive)');
      params = params || {};
      let rows = Object.entries(driveFiles).filter(([, f]) => matchQ(f, params.q));
      if (params.orderBy === 'modifiedTime desc') rows.sort((a, b) => String(b[1].modifiedTime || '').localeCompare(String(a[1].modifiedTime || '')));
      if (params.pageSize) rows = rows.slice(0, params.pageSize);
      return { files: rows.map(([id, f]) => toApi(id, f, params.fields)) };
    },
    get(id, params) {
      calls.driveGet++;
      if (h.failDrive) throw new Error('Drive 模擬: 失敗させている (failDrive)');
      if (!driveFiles[id]) throw new Error('File not found: ' + id);
      return toApi(id, driveFiles[id], params && params.fields);
    }
  } };

  // ---- キャッシュ（寿命は模擬の時計で測る・秒） ----
  const cacheMap = new Map();
  h.cache = cacheMap;   // key -> {v, exp}
  const cache = {
    get(k) { calls.cacheGet++; const e = cacheMap.get(k); if (!e) return null; if (e.exp <= clock.now()) { cacheMap.delete(k); return null; } return e.v; },
    put(k, v, sec) { calls.cachePut++; cacheMap.set(k, { v: String(v), exp: clock.now() + (sec == null ? 600 : sec) * 1000 }); },
    remove(k) { calls.cacheRemove++; cacheMap.delete(k); }
  };

  // ---- スクリプトプロパティ ----
  const propMap = new Map();
  h.props = propMap;
  for (const [k, v] of Object.entries(opts.props || {})) propMap.set(k, String(v));
  const props = {
    getProperty(k) { calls.propGet++; return propMap.has(k) ? propMap.get(k) : null; },
    setProperty(k, v) { calls.propSet++; propMap.set(k, String(v)); return props; },
    deleteProperty(k) { calls.propDelete++; propMap.delete(k); return props; }
  };

  // ---- ロック（1プロセスなので奪い合いは起きない。ただし h.lockBusy = true で tryLock/waitLock を失敗させられる） ----
  let held = false;
  h.lockBusy = false;
  const lock = {
    tryLock(ms) { calls.tryLock++; if (h.lockBusy) return false; held = true; return true; },
    waitLock(ms) { calls.waitLock++; if (h.lockBusy) throw new Error('Could not obtain lock'); held = true; },
    releaseLock() { calls.releaseLock++; held = false; },
    hasLock() { return held; }
  };

  // ---- 日付 ----
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(clock.now()); else super(...a); }
    static now() { return clock.now(); }
  }
  const jst = (d, fmt) => {
    const t = new Date(new Date(d).getTime() + 9 * 3600 * 1000), p = (n, w = 2) => String(n).padStart(w, '0');
    const Y = t.getUTCFullYear(), M = p(t.getUTCMonth() + 1), D = p(t.getUTCDate()), H = p(t.getUTCHours()), m = p(t.getUTCMinutes()), s = p(t.getUTCSeconds());
    return fmt.replace('yyyy', Y).replace('MM', M).replace('dd', D).replace('HH', H).replace('mm', m).replace('ss', s);
  };

  const ctx = {
    Date: FakeDate, Number, String, Object, Math, JSON, isNaN, isFinite, Array, parseInt, parseFloat, RegExp, Error, Set, Map, Boolean,
    SpreadsheetApp: {
      openById(id) {
        calls.openById++;
        if (failOpen.has(id)) throw new Error('Exception: ' + id + ' を開けません (failOpen)');
        if (!books[id]) throw new Error('Exception: スプレッドシートが見つかりません: ' + id);
        return books[id];
      },
      flush() { calls.flush++; },
      getActiveSpreadsheet: () => null
    },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => lock },
    Drive,
    Utilities: {
      formatDate: (d, tz, f) => jst(d, f),
      sleep(ms) { calls.sleep++; clock.advance(ms); },
      // Code_v2.gs のパスワード処理が使う。node の crypto で SHA-256 を模擬（符号つきバイト配列で返す）
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, str) => Array.from(require('crypto').createHash('sha256').update(String(str), 'utf8').digest()).map(b => b > 127 ? b - 256 : b)
    },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return s; } })
    },
    Logger: { log() {} },
    console
  };
  h.ctx = ctx;
  vm.createContext(ctx);
  for (const f of files) {
    const p = path.isAbsolute(f) ? f : path.join(ROOT, f);
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });   // 同じコンテキストに順に読む＝ファイルをまたいで呼べる
  }
  h.eval = (expr) => vm.runInContext(expr, ctx);   // const は ctx のプロパティにならないので式で読む
  return h;
}

// doPost を呼んで応答の JSON を返す
function post(h, obj) {
  return JSON.parse(h.ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).getContent());
}

module.exports = { build, post, Sheet, Range, Book };
