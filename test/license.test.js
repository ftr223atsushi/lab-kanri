// ライセンス機能の試験：Apps Script を模擬して Code_v2.gs と License.gs を動かす。
// 実行: ~/.local/node/bin/node test/license.test.js
const harness = require('./harness');

let checks = 0, fails = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('✖ ' + msg); } };
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('ping_still_works', () => {
  const h = harness.build({ files: ['Code_v2.gs', 'License.gs'] });
  const r = harness.post(h, { action: 'ping' });
  ok(r.ok === true, 'ping: ok が true');
  ok(r.version === h.eval('APP_VERSION'), 'ping: version が APP_VERSION と同じ');
  ok(r.message === 'pong', 'ping: pong');
});

// Global Constraints の断りの文（License.gs とは別に、ここに一字一句書き写して照合する）
const EXPECTED_MSG = {
  no_key: 'ライセンスキーが登録されていません。画面上の「⬇ 更新」でアプリを更新してから、キーを登録してください',
  unknown_key: 'このライセンスキーは登録されていません',
  suspended: 'このライセンスキーは停止されています。販売元にご連絡ください',
  expired: 'ライセンスの期限（YYYY/MM/DD）が過ぎています。販売元にご連絡ください',
  no_device: '端末の番号が取れません。アプリを更新してください',
  too_many: 'この会社の登録台数（N台）を超えています。販売元にご連絡ください',
  no_folder: '現場シートフォルダが見つかりません。販売元にご連絡ください',
  two_folders: '『現場シート』フォルダが2つあります。販売元にご連絡ください',
  outside: 'このシートは、この会社の現場シートの置き場所にありません',
  ledger_unavailable: 'ライセンスを確認できませんでした。少し待ってからもう一度読んでください（記録はされていません）',
  busy: 'サーバーが混み合っています。少し待ってからもう一度読んでください（記録はされていません）'
};
test('license_msg_all_exact', () => {
  const h = harness.build({ files: ['Code_v2.gs', 'License.gs'] });
  const keys = Object.keys(EXPECTED_MSG);
  ok(keys.length === 11, '期待する文は11件');
  ok(h.eval('Object.keys(LICENSE_MSG_).length') === 11, 'LICENSE_MSG_ は11件ちょうど');
  for (const k of keys) ok(h.eval('LICENSE_MSG_.' + k) === EXPECTED_MSG[k], 'LICENSE_MSG_.' + k + ' が一字一句同じ');
});

const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

test('harness_selftest', () => {
  const D = (id, o) => Object.assign({ name: id, mimeType: 'S', parents: [], trashed: false }, o);
  const h = harness.build({
    books: { A: { t: [[1, 2]] } },
    drive: { files: {
      fo: D('現場シート', { mimeType: 'F', parents: ['dr'], driveId: 'dr' }),
      s1: D('s1', { parents: ['fo'], driveId: 'dr', modifiedTime: '2026-01-01' }),
      s2: D('s2', { parents: ['fo'], driveId: 'dr', trashed: true }),
      my: D('my', { parents: ['root'] })
    } }
  });
  const c = h.ctx, SA = { supportsAllDrives: true, includeItemsFromAllDrives: true };

  // 時計・sleep
  const t0 = c.Date.now(); c.Utilities.sleep(2500);
  ok(c.Date.now() === t0 + 2500, 'sleep が時計を2500ms進める');
  h.clock.advance(500); ok(c.Date.now() === t0 + 3000, 'clock.advance が進める');
  ok(c.Utilities.formatDate(new c.Date(new Date('2026-11-02T12:34:56+09:00').getTime()), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') === '2026/11/02 12:34', 'formatDate は JST');

  // キャッシュ：寿命は模擬の時計で測る・上限
  const cache = c.CacheService.getScriptCache();
  cache.put('k', 'v', 10);
  ok(cache.get('k') === 'v', 'cache: 寿命内は取れる');
  h.clock.advance(9999); ok(cache.get('k') === 'v', 'cache: 9.999秒後はまだ取れる');
  h.clock.advance(1); ok(cache.get('k') === null, 'cache: 10秒で切れる');
  cache.put('k2', 'v'); cache.remove('k2'); ok(cache.get('k2') === null, 'cache: remove');
  cache.put('max', 'v', 21600); ok(cache.get('max') === 'v', 'cache: 6時間(21600秒)ちょうどは通る');
  ok(throws(() => cache.put('x', 'v', 21601)), 'cache: 21601秒以上は例外');
  ok(throws(() => cache.put('x', 'v', 86400)), 'cache: 24時間は例外');
  ok(throws(() => cache.put('k'.repeat(251), 'v', 10)), 'cache: キー251字は例外');
  cache.put('k'.repeat(250), 'v', 10); ok(true, 'cache: キー250字は通る');
  ok(throws(() => cache.put('big', 'x'.repeat(100 * 1024 + 1), 10)), 'cache: 100KB超の値は例外');
  cache.put('big', 'x'.repeat(100 * 1024), 10); ok(true, 'cache: 100KBちょうどは通る');
  ok(throws(() => cache.put('jp', 'あ'.repeat(40000), 10)), 'cache: 値はバイト数で数える(日本語4万字=12万バイトは例外)');

  // properties
  const pr = c.PropertiesService.getScriptProperties();
  pr.setProperty('a', 1); ok(pr.getProperty('a') === '1', 'props: 文字列で返す');
  pr.deleteProperty('a'); ok(pr.getProperty('a') === null, 'props: delete');
  pr.setProperty('p9', 'x'.repeat(9 * 1024)); ok(pr.getProperty('p9').length === 9 * 1024, 'props: 9KBちょうどは通る');
  ok(throws(() => pr.setProperty('p9b', 'x'.repeat(9 * 1024 + 1))), 'props: 9KB超の値は例外');
  pr.setProperty('p9d', 'あ'.repeat(3000)); ok(true, 'props: 日本語3000字=9000バイトは通る');
  ok(throws(() => pr.setProperty('p9e', 'あ'.repeat(3100))), 'props: 値はバイト数で数える(日本語3100字=9300バイトは例外)');

  // failOpen / openById の回数
  ok(c.SpreadsheetApp.openById('A').getSheetByName('t') !== null, 'openById: 本が開ける');
  ok(h.calls.openById === 1, 'openById を数える');
  h.failOpen.add('A'); ok(throws(() => c.SpreadsheetApp.openById('A')), 'failOpen: 例外');
  h.failOpen.delete('A');
  ok(throws(() => c.SpreadsheetApp.openById('ZZ')), '未登録IDは例外');
  const bk = c.SpreadsheetApp.openById('A'); bk.insertSheet('新'); ok(bk.getSheets().map(s => s.getName()).join() === 't,新', 'insertSheet は一番右');

  // Drive：既定の返り値は id,name,mimeType だけ
  let r = c.Drive.Files.list(Object.assign({ q: "name='現場シート' and mimeType='F' and 'dr' in parents and trashed=false" }, SA));
  ok(r.files.length === 1 && Object.keys(r.files[0]).sort().join() === 'id,mimeType,name', 'list: fields無しは id,name,mimeType だけ');
  ok(r.files[0].id === 'fo', 'list: q の name/mimeType/in parents/trashed を解釈');
  r = c.Drive.Files.list(Object.assign({ q: "'fo' in parents and trashed=false", fields: 'nextPageToken,files(id,parents,trashed)' }, SA));
  ok(r.files.length === 1 && JSON.stringify(r.files[0]) === '{"id":"s1","parents":["fo"],"trashed":false}', 'list: fields=nextPageToken,files(...) 形式');
  r = c.Drive.Files.list(Object.assign({ q: "'fo' in parents", fields: 'files(id)' }, SA));
  ok(r.files.length === 2, 'list: trashed を q に書かなければゴミ箱も出る');
  r = c.Drive.Files.list(Object.assign({ q: "'fo' in parents and trashed=false", orderBy: 'modifiedTime desc', pageSize: 1, fields: 'files(id)' }, SA));
  ok(r.files.length === 1, 'list: pageSize');
  ok(throws(() => c.Drive.Files.list(Object.assign({ q: "starred=true" }, SA))), 'list: 解釈できない q は例外');
  r = c.Drive.Files.get('s1', { supportsAllDrives: true });
  ok(Object.keys(r).sort().join() === 'id,mimeType,name', 'get: fields無しは id,name,mimeType だけ');
  r = c.Drive.Files.get('s1', { supportsAllDrives: true, fields: 'parents,trashed' });
  ok(JSON.stringify(r) === '{"parents":["fo"],"trashed":false}', 'get: fields に書いたものだけ返る');

  // 共有ドライブは supportsAllDrives が要る
  ok(throws(() => c.Drive.Files.get('s1')), 'get: 共有ドライブのファイルは supportsAllDrives 無しで例外');
  ok(throws(() => c.Drive.Files.get('s1', { fields: 'parents' })), 'get: 同上(fields付き)');
  ok(!throws(() => c.Drive.Files.get('my')), 'get: マイドライブのファイルは supportsAllDrives 無しでも通る');
  ok(throws(() => c.Drive.Files.list({ q: "'fo' in parents" })), 'list: 共有ドライブのファイルが出るなら supportsAllDrives 無しで例外');
  ok(throws(() => c.Drive.Files.list({ q: "'root' in parents", corpora: 'drive', driveId: 'dr', supportsAllDrives: true })), 'list: corpora=drive は includeItemsFromAllDrives 無しで例外');
  ok(throws(() => c.Drive.Files.list({ q: "'root' in parents", corpora: 'allDrives', includeItemsFromAllDrives: true })), 'list: corpora=allDrives は supportsAllDrives 無しで例外');
  ok(!throws(() => c.Drive.Files.list({ q: "'root' in parents", corpora: 'drive', driveId: 'dr', supportsAllDrives: true, includeItemsFromAllDrives: true })), 'list: 3つそろえば通る');
  ok(h.calls.driveList >= 1 && h.calls.driveGet >= 1, 'driveList/driveGet を数える');

  // failDrive
  const g0 = h.calls.driveGet; h.failDrive = true;
  ok(throws(() => c.Drive.Files.get('my')), 'failDrive: get が例外');
  ok(throws(() => c.Drive.Files.list({ q: "'root' in parents" })), 'failDrive: list が例外');
  ok(h.calls.driveGet === g0 + 1, 'failDrive でも呼んだ回数は数える');
  h.failDrive = false;

  // ロック：普通に取れる／混んでいるときは待った分だけ時計が進んでから失敗
  const lk = c.LockService.getScriptLock();
  ok(lk.tryLock(5000) === true && lk.hasLock() === true, 'lock: tryLock が取れる');
  lk.releaseLock(); ok(lk.hasLock() === false, 'lock: releaseLock');
  ok(h.calls.tryLock === 1 && h.calls.releaseLock === 1, 'lock: 回数を数える');
  h.lockBusy = true;
  let t = c.Date.now();
  ok(lk.tryLock(5000) === false, 'lockBusy: tryLock は false');
  ok(c.Date.now() - t === 5000, 'lockBusy: tryLock(5000) は時計を5秒進める');
  t = c.Date.now();
  ok(throws(() => lk.waitLock(30000)), 'lockBusy: waitLock は例外');
  ok(c.Date.now() - t === 30000, 'lockBusy: waitLock(30000) は時計を30秒進める');
  ok(h.calls.tryLock === 2 && h.calls.waitLock === 1, 'lockBusy: 回数を数える');

  // ContentService
  ok(c.ContentService.createTextOutput('x').setMimeType(c.ContentService.MimeType.JSON).getContent() === 'x', 'ContentService');
});


// ---- Task 2：台帳の読み込み・写し・猶予・キー判定 ----
const LEDGER_ID = '1Jw5RwIFseRFZUOaLo90bg2pHRcvN4VLBbJrH7MDMjQ0';
const K1 = 'LAB-7KQ2-M9XD', K2 = 'LAB-AAAA-BBBB', K3 = 'LAB-CCCC-DDDD', K4 = 'LAB-EEEE-FFFF';
const HDR = ['キー', '会社名', '接続先', '状態', '期限', '台数上限', '備考'];
const msJst = (s) => new Date(s + '+09:00').getTime();
// 台帳の模擬ブック。lab-kanri / 設定 / 顧客 の3タブ（列は見出し名で引くので、顧客は実物どおり12列にする）
function ledgerBook(o) {
  o = o || {};
  const labRows = o.lab || [
    [K1, 'HSSエンジニヤリング', 'shast-hsseng', '有効', '2027/04/13', '', ''],
    [K2, '停止中の会社', 'shast-stop', '停止', '', '5', ''],
    [K3, '期限切れの会社', 'shast-old', '', '2026/11/01', '3', ''],
    [K4, '自社の開発用', 'shast-writer', '有効', '', '0', '']
  ];
  const setRows = [['項目', '値']];
  if (o.grace !== null) setRows.push(['lab-kanri猶予期限', o.grace === undefined ? '2026-11-19' : o.grace]);
  setRows.push(['最低版', '3.30'], ['お知らせ', 'テスト']);
  const cust = o.cust || [
    ['shast-hsseng', 'HSS', '', '', '', '', '', '', '', '', '', 'DRIVE_HSS'],
    ['shast-writer', '自社', '', '', '', '', '', '', '', '', '', 'DRIVE_OWN']
  ];
  const custHdr = ['接続先', '会社名', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', '共有ドライブID'];
  const books = {};
  books[LEDGER_ID] = { 'lab-kanri': [HDR].concat(labRows), '設定': setRows, '顧客': [custHdr].concat(cust) };
  return books;
}
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const mkKey = (i) => 'LAB-' + ALPHA[i % 32] + ALPHA[(i * 7 + 3) % 32] + 'AB-' + ALPHA[(i >> 5) % 32] + 'CD' + ALPHA[(i * 11 + 5) % 32];
const buildLedger = (o, extra) => harness.build(Object.assign({ books: ledgerBook(o) }, extra || {}));
const call = (h, expr, ...a) => h.ctx[expr](...a);

test('normalize_key_variants', () => {
  const h = harness.build({});
  const n = (s) => call(h, 'license_normalizeKey_', s);
  ok(n('lab7kq2m9xd') === 'LAB-7KQ2-M9XD', '小文字・ハイフン無し');
  ok(n(' LAB-7KQ2-M9XD ') === 'LAB-7KQ2-M9XD', '前後空白');
  ok(n('lab 7kq2 m9xd') === 'LAB-7KQ2-M9XD', '途中の空白');
  ok(n('LAB-7KQ2-M9X') === '', '1文字足りない');
  ok(n('SHAST-AAAA-BBBB') === '', '接頭辞違い');
  ok(n('LAB-7KQ0-M9XD') === '', '使えない文字 0');
  ok(n('LAB-7KQ2-M9XDD') === '', '1文字多い');
  ok(n('') === '' && n(null) === '' && n(undefined) === '', '空・null・undefined');
});

test('key_ok', () => {
  const h = buildLedger();
  const led = call(h, 'license_ledger_', h.clock.now());
  const r = call(h, 'license_checkKey_', led, 'lab-7kq2-m9xd', 'DEV1', h.clock.now());
  ok(r.ok === true, 'ok');
  ok(r.key === K1, '正規化したキーを返す');
  ok(r.entry.company === 'HSSエンジニヤリング' && r.entry.conn === 'shast-hsseng', '会社名・接続先');
  ok(r.entry.status === 'valid' && r.entry.expires === '2027/04/13', '状態・期限');
  ok(r.entry.limit === 5, '台数上限 空＝5');
  ok(r.entry.row === 2, '行番号は1始まりのシート行');
  const r4 = call(h, 'license_checkKey_', led, K4, 'DEV1', h.clock.now());
  ok(r4.ok === true && r4.entry.row === 5, '4行目のデータ＝シート5行目');
});
test('key_unknown', () => {
  const h = buildLedger();
  const led = call(h, 'license_ledger_', h.clock.now());
  const t = h.clock.now();
  let r = call(h, 'license_checkKey_', led, 'LAB-ZZZZ-ZZZZ', 'D', t);
  ok(r.ok === false && r.reason === 'unknown_key' && r.message === EXPECTED_MSG.unknown_key, '登録なし');
  r = call(h, 'license_checkKey_', led, '', 'D', t);
  ok(r.reason === 'unknown_key', '空キー');
  r = call(h, 'license_checkKey_', led, 'SHAST-AAAA-BBBB', 'D', t);
  ok(r.reason === 'unknown_key', '形の違うキー');
});
test('key_suspended', () => {
  const h = buildLedger();
  const led = call(h, 'license_ledger_', h.clock.now());
  const r = call(h, 'license_checkKey_', led, K2, 'D', h.clock.now());
  ok(r.ok === false && r.reason === 'suspended' && r.message === EXPECTED_MSG.suspended, '停止');
  const h2 = buildLedger({ lab: [[K1, 'X', 'c', '保留', '', '', '']] });
  const r2 = call(h2, 'license_checkKey_', call(h2, 'license_ledger_', h2.clock.now()), K1, 'D', h2.clock.now());
  ok(r2.reason === 'suspended', '知らない状態の値は停止扱い');
});
test('key_expired', () => {
  const h = buildLedger({}, { now: msJst('2026-11-02T09:00:00') });
  const led = call(h, 'license_ledger_', h.clock.now());
  const r = call(h, 'license_checkKey_', led, K3, 'D', h.clock.now());
  ok(r.ok === false && r.reason === 'expired', '期限切れ');
  ok(r.message === 'ライセンスの期限（2026/11/01）が過ぎています。販売元にご連絡ください', '文に期限の日付が入る: ' + r.message);
  // 期限当日の終わりまでは有効
  const h2 = buildLedger({}, { now: msJst('2026-11-01T23:59:59') });
  const r2 = call(h2, 'license_checkKey_', call(h2, 'license_ledger_', h2.clock.now()), K3, 'D', h2.clock.now());
  ok(r2.ok === true, '期限の日の23:59:59は有効');
  const h3 = buildLedger({}, { now: msJst('2026-11-02T00:00:00') });
  const r3 = call(h3, 'license_checkKey_', call(h3, 'license_ledger_', h3.clock.now()), K3, 'D', h3.clock.now());
  ok(r3.reason === 'expired', '翌日0:00から期限切れ');
  // ハイフン区切りの日付・桁なしも同じ形(YYYY/MM/DD)にそろう
  const h4 = buildLedger({ lab: [[K1, 'X', 'c', '有効', '2026-11-1', '', '']] }, { now: msJst('2026-11-02T09:00:00') });
  const l4 = call(h4, 'license_ledger_', h4.clock.now());
  ok(l4.keys[K1].expires === '2026/11/01', '2026-11-1 → 2026/11/01');
  const h5 = buildLedger({ lab: [[K1, 'X', 'c', '有効', '', '', '']] });
  ok(call(h5, 'license_ledger_', h5.clock.now()).keys[K1].expires === '', '空の期限は空');
});
test('no_device', () => {
  const h = buildLedger();
  const led = call(h, 'license_ledger_', h.clock.now());
  for (const d of ['', null, undefined]) {
    const r = call(h, 'license_checkKey_', led, K1, d, h.clock.now());
    ok(r.ok === false && r.reason === 'no_device' && r.message === EXPECTED_MSG.no_device, 'deviceId=' + d);
  }
  // 順序：不明キーは端末が空でも unknown_key
  ok(call(h, 'license_checkKey_', led, 'LAB-ZZZZ-ZZZZ', '', h.clock.now()).reason === 'unknown_key', '不明キーが先');
  ok(call(h, 'license_checkKey_', led, K2, '', h.clock.now()).reason === 'suspended', '停止が端末より先');
});
test('limit_blank_is_5', () => {
  const h = buildLedger();
  const led = call(h, 'license_ledger_', h.clock.now());
  ok(led.keys[K1].limit === 5, 'F列空 → 5');
  ok(led.keys[K3].limit === 3, '数字はそのまま');
});
test('limit_zero_unlimited', () => {
  const h = buildLedger();
  const led = call(h, 'license_ledger_', h.clock.now());
  ok(led.keys[K4].limit === 0, '0 は 0 のまま(無制限)');
});

test('grace_before', () => {
  const h = buildLedger({}, { now: msJst('2026-11-05T10:00:00') });
  const g = call(h, 'license_grace_', call(h, 'license_ledger_', h.clock.now()), h.clock.now());
  ok(g.inGrace === true && g.daysLeft === 14, '猶予中・残り14日: ' + JSON.stringify(g));
  const hl = buildLedger({}, { now: msJst('2026-11-19T23:59:59') });
  const gl = call(hl, 'license_grace_', call(hl, 'license_ledger_', hl.clock.now()), hl.clock.now());
  ok(gl.inGrace === true && gl.daysLeft === 0, '猶予期限の日の終わりまでは猶予中(残り0)');
});
test('grace_after', () => {
  const h = buildLedger({}, { now: msJst('2026-11-20T00:00:00') });
  const g = call(h, 'license_grace_', call(h, 'license_ledger_', h.clock.now()), h.clock.now());
  ok(g.inGrace === false, '猶予明け');
});
test('grace_missing_row_is_grace', () => {
  for (const o of [{ grace: null }, { grace: '' }, { grace: 'へんな文字' }]) {
    const h = buildLedger(o);
    const led = call(h, 'license_ledger_', h.clock.now());
    const g = call(h, 'license_grace_', led, h.clock.now());
    ok(led.graceUntil === '' && g.inGrace === true && g.daysLeft === null, '行なし/空/読めない → 猶予中・daysLeft null: ' + JSON.stringify(o));
  }
});

test('ledger_reads_all_tabs', () => {
  const h = buildLedger();
  const led = call(h, 'license_ledger_', h.clock.now());
  ok(led.graceUntil === '2026-11-19', '猶予期限');
  ok(led.drives['shast-hsseng'] === 'DRIVE_HSS' && led.drives['shast-writer'] === 'DRIVE_OWN', '顧客タブの 接続先→共有ドライブID');
  ok(led.readAt === h.clock.now() && led.fromSnapshot === false, 'readAt・fromSnapshot');
  ok(Object.keys(led.keys).length === 4, '4社');
  // 列の位置が変わっても見出し名で引ける
  const books = ledgerBook();
  books[LEDGER_ID]['lab-kanri'] = [['備考', '台数上限', '期限', '状態', '接続先', '会社名', 'キー'], ['', '7', '', '有効', 'c1', 'Z社', K1]];
  const h2 = harness.build({ books });
  const l2 = call(h2, 'license_ledger_', h2.clock.now());
  ok(l2.keys[K1].company === 'Z社' && l2.keys[K1].limit === 7 && l2.keys[K1].conn === 'c1', '見出し名で列を引く');
});

test('ledger_cached_5min', () => {
  const h = buildLedger();
  call(h, 'license_ledger_', h.clock.now());
  const n1 = h.calls.openById;
  ok(n1 === 1, '1回目は台帳を開く');
  h.clock.advance(60 * 1000);
  const l2 = call(h, 'license_ledger_', h.clock.now());
  ok(h.calls.openById === n1, '2回目(1分後)は openById を呼ばない');
  ok(l2.keys[K1] && l2.fromSnapshot === false, 'キャッシュの中身で判定できる');
  h.clock.advance(4 * 60 * 1000);   // 合計5分(ちょうど)
  h.clock.advance(1000);            // 5分1秒
  call(h, 'license_ledger_', h.clock.now());
  ok(h.calls.openById === n1 + 1, '5分1秒後は台帳を開き直す');
  ok(h.cache.has('lk_ledger_v1'), 'キャッシュのキーは lk_ledger_v1');
});
test('ledger_cache_ttl_is_300s', () => {
  const h = buildLedger();
  call(h, 'license_ledger_', h.clock.now());
  const e = h.cache.get('lk_ledger_v1');
  ok(e && e.exp - h.clock.now() === 300 * 1000, '寿命300秒');
});
test('ledger_snapshot_used_when_open_fails', () => {
  const h = buildLedger();
  call(h, 'license_ledger_', h.clock.now());
  ok(h.props.has('LK_LEDGER_SNAPSHOT'), 'LK_LEDGER_SNAPSHOT に写しを保存');
  h.clock.advance(6 * 60 * 1000);   // キャッシュ切れ
  h.failOpen.add(LEDGER_ID);
  const led = call(h, 'license_ledger_', h.clock.now());
  ok(led && led.fromSnapshot === true, '写しを返す');
  const r = call(h, 'license_checkKey_', led, K1, 'D', h.clock.now());
  ok(r.ok === true, '写しで判定が通る');
  ok(led.drives['shast-hsseng'] === 'DRIVE_HSS' && led.graceUntil === '2026-11-19', '写しにも猶予期限・ドライブID');
});
test('ledger_snapshot_too_old', () => {
  const h = buildLedger();
  call(h, 'license_ledger_', h.clock.now());
  h.clock.advance(25 * 3600 * 1000);
  h.failOpen.add(LEDGER_ID);
  ok(call(h, 'license_ledger_', h.clock.now()) === null, '25時間後に例外 → null');
});
test('ledger_snapshot_23h_ok_and_boundary', () => {
  const h = buildLedger();
  call(h, 'license_ledger_', h.clock.now());
  h.failOpen.add(LEDGER_ID);
  h.clock.advance(23 * 3600 * 1000);
  ok(call(h, 'license_ledger_', h.clock.now()) !== null, '23時間後は写しが使える');
  h.clock.advance(3600 * 1000);   // ちょうど24時間
  ok(call(h, 'license_ledger_', h.clock.now()) !== null, 'ちょうど24時間までは使える');
  h.clock.advance(1000);
  ok(call(h, 'license_ledger_', h.clock.now()) === null, '24時間1秒後は使えない');
});
test('ledger_no_snapshot_and_open_fails', () => {
  const h = buildLedger();
  h.failOpen.add(LEDGER_ID);
  ok(call(h, 'license_ledger_', h.clock.now()) === null, '写しが無く開けない → null');
});
test('ledger_missing_lab_tab_falls_back', () => {
  const books = ledgerBook(); delete books[LEDGER_ID]['lab-kanri'];
  const h = harness.build({ books });
  ok(call(h, 'license_ledger_', h.clock.now()) === null, 'lab-kanri タブが無い → 読めない扱い');
  ok(!h.props.has('LK_LEDGER_SNAPSHOT') && !h.cache.has('lk_ledger_v1'), '壊れた中身は保存しない');
});
test('ledger_corrupt_snapshot_ignored', () => {
  const h = buildLedger({}, { props: { LK_LEDGER_SNAPSHOT: '{こわれた' } });
  h.failOpen.add(LEDGER_ID);
  ok(call(h, 'license_ledger_', h.clock.now()) === null, '壊れた写しは null');
});

test('snapshot_under_9kb_realistic', () => {
  const lab = [], cust = [];
  for (let i = 0; i < 30; i++) {
    const c = String(i).padStart(2, '0');
    lab.push([mkKey(i), '株式会社テスト環境調査サービス' + c, 'shast-company' + c, '有効', '2027/04/13', '5', 'メモ'.repeat(10)]);
  }
  for (let i = 0; i < 10; i++) cust.push(['shast-company' + String(i).padStart(2, '0'), 'x', '', '', '', '', '', '', '', '', '', '0A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q']);
  const h = buildLedger({ lab, cust });
  const led = call(h, 'license_ledger_', h.clock.now());
  ok(Object.keys(led.keys).length === 30, '30社読めた(' + Object.keys(led.keys).length + ')');
  const v = h.props.get('LK_LEDGER_SNAPSHOT');
  ok(v != null, '写しが保存できた(9KB上限に引っかからない)');
  ok(Buffer.byteLength(v, 'utf8') < 9 * 1024, '写し ' + Buffer.byteLength(v, 'utf8') + ' バイト < 9216');
  ok(v.indexOf('備考') < 0 && v.indexOf('メモ') < 0, '備考は写しに入れない');
});
test('snapshot_too_big_does_not_break_read', () => {
  // 9KB を超える台帳でも、読み取り自体は成功する（写しだけ残せない）
  const lab = [];
  for (let i = 0; i < 200; i++) lab.push([mkKey(i), '会社名が長めの株式会社' + i, 'shast-x' + i, '有効', '', '', '']);
  const h = buildLedger({ lab });
  const led = call(h, 'license_ledger_', h.clock.now());
  ok(led && led.fromSnapshot === false && Object.keys(led.keys).length > 100, '読めて返る');
});

// ---- シートごとの順番待ち（Task 3）----
const sheetLock = (h, key, fn, onBusy) => h.ctx.license_withSheetLock_(key, fn, onBusy);
const BUSY = () => 'BUSY';

test('lock_free_runs_once', () => {
  const h = harness.build({});
  let n = 0, seen = null;
  const r = sheetLock(h, 'lk_A', () => { n++; seen = h.ctx.CacheService.getScriptCache().get('lk_A'); return 'done'; }, BUSY);
  ok(r === 'done', 'fn の戻り値が返る');
  ok(n === 1, 'fn は1回');
  ok(seen && seen.length > 8, '走っている間は自分の印の札が立っている');
  ok(h.ctx.CacheService.getScriptCache().get('lk_A') === null, '終わったら札は消える');
  ok(h.calls.flush === 1, 'flush が呼ばれる(' + h.calls.flush + ')');
  ok(h.calls.tryLock === h.calls.releaseLock && !h.ctx.LockService.getScriptLock().hasLock(), 'ScriptLock は離している');
  ok(h.calls.sleep === 0, '空いていれば待たない');
});
test('lock_waits_then_runs', () => {
  const h = harness.build({});
  const cache = h.ctx.CacheService.getScriptCache();
  cache.put('lk_A', 'someone-else', 10);   // 他の端末の札（寿命10秒）
  const t0 = h.clock.now();
  let startedAt = null, n = 0;
  const r = sheetLock(h, 'lk_A', () => { n++; startedAt = h.clock.now(); return 'ran'; }, BUSY);
  ok(r === 'ran' && n === 1, '札が切れたあとで fn が走る');
  ok(startedAt - t0 >= 10000, '時計が10秒以上進んでから(' + (startedAt - t0) + 'ms)');
  ok(startedAt - t0 < 11000, '切れてすぐ走る(' + (startedAt - t0) + 'ms)');
  ok(h.calls.sleep >= 50, '0.2秒ずつ待った(' + h.calls.sleep + '回)');
  ok(cache.get('lk_A') === null, '終わったら札は消える');
});
test('lock_busy_after_30s', () => {
  const h = harness.build({});
  const cache = h.ctx.CacheService.getScriptCache();
  cache.put('lk_A', 'someone-else', 60);
  const t0 = h.clock.now();
  let n = 0;
  const r = sheetLock(h, 'lk_A', () => { n++; return 'ran'; }, BUSY);
  ok(r === 'BUSY', 'onBusy の戻り値が返る');
  ok(n === 0, 'fn は呼ばれない');
  const waited = h.clock.now() - t0;
  ok(waited >= 30000 && waited < 31000, '30秒待ってあきらめる(' + waited + 'ms)');
  ok(cache.get('lk_A') === 'someone-else', '他の端末の札には触らない');
  ok(h.calls.flush === 0, '書いていないので flush しない');
});
test('lock_not_removed_if_not_owner', () => {
  const h = harness.build({});
  const cache = h.ctx.CacheService.getScriptCache();
  sheetLock(h, 'lk_A', () => { cache.put('lk_A', 'other-token', 30); }, BUSY);   // fn が長引いて札が切れ、他の端末が立てた想定
  ok(cache.get('lk_A') === 'other-token', '自分の印でない札は消さない');
  ok(h.calls.flush === 1, 'flush は呼ぶ');
});
test('lock_releases_on_throw', () => {
  const h = harness.build({});
  const cache = h.ctx.CacheService.getScriptCache();
  let err = null;
  try { sheetLock(h, 'lk_A', () => { throw new Error('boom'); }, BUSY); } catch (e) { err = e; }
  ok(err && err.message === 'boom', '例外は外へ出る');
  ok(cache.get('lk_A') === null, '例外でも札は消える');
  ok(h.calls.flush === 1, '例外でも flush する');
  ok(!h.ctx.LockService.getScriptLock().hasLock(), 'ScriptLock は離している');
  const t0 = h.clock.now();   // 札が消えたので次の人はすぐ走れる
  ok(sheetLock(h, 'lk_A', () => 'next', BUSY) === 'next' && h.clock.now() === t0, '次の端末は待たずに走る');
});
test('different_sheets_do_not_wait', () => {
  const h = harness.build({});
  const cache = h.ctx.CacheService.getScriptCache();
  cache.put('lk_A', 'someone-else', 60);
  const t0 = h.clock.now();
  const r = sheetLock(h, 'lk_B', () => 'ran', BUSY);
  ok(r === 'ran', '別のシートは走る');
  ok(h.clock.now() === t0 && h.calls.sleep === 0, '待たない(時計が進んでいない)');
  ok(cache.get('lk_A') === 'someone-else', 'lk_A の札はそのまま');
  ok(sheetLock(h, 'lk_ledger', () => 'ledger', BUSY) === 'ledger' && h.clock.now() === t0, 'lk_ledger も別の札');
});
test('lock_scriptlock_contended_gives_up', () => {
  // ScriptLock が取れないままなら札を立てられず、30秒（待ちの1回分0.2秒まで）であきらめる(fn は呼ばない)
  const h = harness.build({});
  h.lockBusy = true;
  const t0 = h.clock.now();
  let n = 0;
  const r = sheetLock(h, 'lk_A', () => { n++; return 'ran'; }, BUSY);
  ok(r === 'BUSY' && n === 0, 'ScriptLock が取れないままなら onBusy');
  ok(h.ctx.CacheService.getScriptCache().get('lk_A') === null, '札は立てていない');
  const waited = h.clock.now() - t0;
  ok(waited >= 30000 && waited <= 30200, 'ScriptLock 混雑でも30秒を超えない(' + waited + 'ms)');
});
test('cleanup_flush_throws_keeps_result', () => {
  const h = harness.build({});
  const cache = h.ctx.CacheService.getScriptCache();
  h.ctx.SpreadsheetApp.flush = () => { throw new Error('flush NG'); };
  let r, err = null;
  try { r = sheetLock(h, 'lk_A', () => 'written', BUSY); } catch (e) { err = e; }
  ok(err === null, 'flush の失敗は外へ出ない(' + (err && err.message) + ')');
  ok(r === 'written', 'fn の戻り値がそのまま返る');
  ok(cache.get('lk_A') === null, 'flush が失敗しても札は消える');
  ok(!h.ctx.LockService.getScriptLock().hasLock(), 'ScriptLock は離している');
});
test('cleanup_remove_throws_keeps_result', () => {
  const h = harness.build({});
  const cache = h.ctx.CacheService.getScriptCache();
  cache.remove = () => { throw new Error('remove NG'); };
  let r, err = null;
  try { r = sheetLock(h, 'lk_A', () => 'written', BUSY); } catch (e) { err = e; }
  ok(err === null, 'cache.remove の失敗は外へ出ない(' + (err && err.message) + ')');
  ok(r === 'written', 'fn の戻り値がそのまま返る');
  ok(!h.ctx.LockService.getScriptLock().hasLock(), 'ScriptLock は離している');
});
test('cleanup_fn_and_flush_throw_fn_error_wins', () => {
  const h = harness.build({});
  const cache = h.ctx.CacheService.getScriptCache();
  h.ctx.SpreadsheetApp.flush = () => { throw new Error('flush NG'); };
  let err = null;
  try { sheetLock(h, 'lk_A', () => { throw new Error('fn NG'); }, BUSY); } catch (e) { err = e; }
  ok(err && err.message === 'fn NG', 'fn の例外がそのまま出る(' + (err && err.message) + ')');
  ok(cache.get('lk_A') === null, '札は消える');
});
test('release_without_scriptlock_still_removes_flag', () => {
  const h = harness.build({});
  const cache = h.ctx.CacheService.getScriptCache();
  let relAtFn = null;
  const r = sheetLock(h, 'lk_A', () => { h.lockBusy = true; relAtFn = h.calls.releaseLock; return 'ok'; }, BUSY);
  ok(r === 'ok', 'fn の戻り値が返る');
  ok(cache.get('lk_A') === null, 'ScriptLock が取れなくても自分の札は消す');
  ok(h.calls.releaseLock === relAtFn, '取れなかった分の releaseLock は呼ばない(' + relAtFn + '→' + h.calls.releaseLock + ')');
});

for (const [name, fn] of tests) {
  try { fn(); } catch (e) { ok(false, name + ' が例外: ' + (e && e.stack || e)); }
}
console.log(`${checks} 件中 ${checks - fails} 件OK` + (fails ? ` / ${fails} 件NG` : ''));
process.exit(fails ? 1 : 0);
