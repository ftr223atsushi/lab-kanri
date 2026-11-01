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

// ---- 端末の登録（Task 4）----
const USE_HDR = ['キー', '会社名', '端末ID', '端末名（機種）', '初回利用', '最終利用', '利用回数', '版', '最終判定', '呼び名'];
const TK = 'LAB-ABCD-EFGH';
const useBook = (rows, extra) => {
  const books = {}; books[LEDGER_ID] = Object.assign({ 'lab-kanri利用': [USE_HDR].concat(rows || []) }, extra || {});
  return harness.build({ books: books });
};
const useRows = (h) => h.books[LEDGER_ID].sheets.find(s => s.name === 'lab-kanri利用').rows;
const mkEntry = (limit) => ({ company: 'A社', conn: 'c1', status: 'valid', expires: '', limit: limit, row: 2 });
const touch = (h, entry, dev, extra) => {
  extra = extra || {};
  return h.ctx.license_touchDevice_(extra.key || TK, entry, dev, extra.name || 'SM-N986N', extra.ver || '3.35-X', extra.verdict || '有効', h.clock.now());
};
const fmtNow = (h) => h.ctx.Utilities.formatDate(new Date(h.clock.now()), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

test('new_device_adds_row', () => {
  const h = useBook([]);
  const r = touch(h, mkEntry(5), 'dev1');
  ok(r.ok === true && r.used === 1 && r.limit === 5, '新しい端末は通る used=1 limit=5(' + JSON.stringify(r) + ')');
  const rows = useRows(h);
  ok(rows.length === 2, '行が1つ増える');
  const row = rows[1];
  const exp = [TK, 'A社', 'dev1', 'SM-N986N', fmtNow(h), fmtNow(h), 1, '3.35-X', '有効'];
  for (let i = 0; i < 9; i++) ok(row[i] === exp[i], 'A〜I の ' + USE_HDR[i] + ' = ' + exp[i] + '(実際: ' + row[i] + ')');
  ok(row[9] === undefined || row[9] === '', '呼び名は空');
  ok(row[4] === '2026/11/02 12:00', '日付は yyyy/MM/dd HH:mm の日本時間');
});
test('same_device_rereg_no_new_row', () => {
  const h = useBook([[TK, 'A社', 'dev1', 'SM-N986N', '2026/10/01 09:00', '2026/10/01 09:00', 1, '3.30', '有効', '']]);
  const r = touch(h, mkEntry(5), 'dev1');
  ok(r.ok === true && r.used === 1, '同じ端末は通る used は増えない(' + JSON.stringify(r) + ')');
  ok(useRows(h).length === 2, '行は増えない');
  ok(useRows(h)[1][6] === 2, '利用回数は +1');
  // 別のキーの同じ端末は別の行
  const r2 = touch(h, mkEntry(5), 'dev1', { key: 'LAB-ZZZZ-2222' });
  ok(r2.ok === true && useRows(h).length === 3, '別キーの同じ端末は別の1行');
});
test('limit_reached_refuses', () => {
  const h = useBook([[TK, 'A社', 'd1', 'x', 'a', 'b', 1, 'v', '有効', ''], [TK, 'A社', 'd2', 'x', 'a', 'b', 1, 'v', '有効', '']]);
  const r = touch(h, mkEntry(2), 'd3');
  ok(r.ok === false && r.reason === 'too_many', '3台目は too_many(' + JSON.stringify(r) + ')');
  ok(r.message === 'この会社の登録台数（2台）を超えています。販売元にご連絡ください', '文に 2台');
  ok(useRows(h).length === 3, '行は増えない');
  const r2 = touch(h, mkEntry(2), 'd2');
  ok(r2.ok === true && r2.used === 2, '登録済みの端末は上限でも通る');
  const r3 = touch(h, mkEntry(1), 'd1');
  ok(r3.ok === true && r3.used === 2 && r3.limit === 1, '上限を下げられても登録済みは通る(' + JSON.stringify(r3) + ')');
});
test('limit_zero_never_refuses', () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push([TK, 'A社', 'd' + i, 'x', 'a', 'b', 1, 'v', '有効', '']);
  const h = useBook(rows);
  const r = touch(h, mkEntry(0), 'dnew');
  ok(r.ok === true && r.used === 9 && r.limit === 0, '上限0は無制限(' + JSON.stringify(r) + ')');
  ok(useRows(h).length === 10, '行が増える');
});
test('other_key_rows_not_counted', () => {
  const h = useBook([['LAB-ZZZZ-2222', 'B社', 'd1', 'x', 'a', 'b', 1, 'v', '有効', ''], ['LAB-ZZZZ-2222', 'B社', 'd2', 'x', 'a', 'b', 1, 'v', '有効', '']]);
  const r = touch(h, mkEntry(2), 'd1');
  ok(r.ok === true && r.used === 1, '別のキーの行は数えない(' + JSON.stringify(r) + ')');
});
test('touch_throttled_1h', () => {
  const h = useBook([[TK, 'A社', 'dev1', 'SM', '2026/10/01 09:00', '2026/10/01 09:00', 1, '3.30', '有効', '']]);
  touch(h, mkEntry(5), 'dev1', { ver: '3.31' });
  ok(useRows(h)[1][6] === 2, '1回目は書く(G=2)');
  const opens = h.calls.openById;
  h.clock.advance(59 * 60 * 1000);
  const r = touch(h, mkEntry(5), 'dev1', { ver: '3.32' });
  ok(r.ok === true && r.used === 1 && r.limit === 5, '59分後は書かずに ok(' + JSON.stringify(r) + ')');
  ok(h.calls.openById === opens, '台帳を開かない');
  ok(useRows(h)[1][6] === 2 && useRows(h)[1][7] === '3.31', '行は変わらない');
  h.clock.advance(2 * 60 * 1000);   // 合計61分
  touch(h, mkEntry(5), 'dev1', { ver: '3.33', verdict: '期限切れ' });
  const row = useRows(h)[1];
  ok(row[6] === 3, '61分後は G が +1(' + row[6] + ')');
  ok(row[7] === '3.33' && row[8] === '期限切れ', 'H・I を書き直す');
  ok(row[5] === fmtNow(h), 'F を書き直す(' + row[5] + ')');
  ok(row[4] === '2026/10/01 09:00' && row[2] === 'dev1' && row[0] === TK && row[1] === 'A社', 'A〜E は変えない');
  ok(useRows(h).length === 2, '行は増えない');
});
test('nickname_column_untouched', () => {
  const h = useBook([[TK, 'A社', 'dev1', 'SM', '2026/10/01 09:00', '2026/10/01 09:00', 1, '3.30', '有効', 'AGM']]);
  touch(h, mkEntry(5), 'dev1');
  ok(useRows(h)[1][9] === 'AGM', '書き直しのあとも呼び名は AGM');
  touch(h, mkEntry(5), 'dev2');
  ok(useRows(h)[1][9] === 'AGM' && (useRows(h)[2][9] === undefined || useRows(h)[2][9] === ''), '新しい行の呼び名は空・既存は AGM');
});
test('columns_found_by_header_name', () => {
  // 列が入れ替わっていても見出しで引く
  const hdr = ['呼び名', '端末ID', 'キー', '会社名', '端末名（機種）', '初回利用', '最終利用', '利用回数', '版', '最終判定'];
  const books = {}; books[LEDGER_ID] = { 'lab-kanri利用': [hdr, ['AGM', 'dev1', TK, 'A社', 'SM', 'a', 'b', 4, '3.30', '有効']] };
  const h = harness.build({ books: books });
  touch(h, mkEntry(5), 'dev1');
  const rows = useRows(h);
  ok(rows.length === 2 && rows[1][7] === 5 && rows[1][0] === 'AGM', '見出しで列を引いて G+1・呼び名そのまま(' + JSON.stringify(rows[1]) + ')');
  touch(h, mkEntry(5), 'dev2');
  ok(rows[2][1] === 'dev2' && rows[2][2] === TK && rows[2][7] === 1, '新しい行も見出しの位置に書く(' + JSON.stringify(rows[2]) + ')');
});
test('missing_tab_created_with_header', () => {
  const books = {}; books[LEDGER_ID] = { 'lab-kanri': [['キー']] };
  const h = harness.build({ books: books });
  const r = touch(h, mkEntry(5), 'dev1');
  ok(r.ok === true && r.used === 1, '利用タブが無くても通る(' + JSON.stringify(r) + ')');
  const sheets = h.books[LEDGER_ID].sheets;
  ok(sheets.length === 2 && sheets[1].name === 'lab-kanri利用', 'タブが一番右に作られる');
  ok(JSON.stringify(sheets[1].rows[0]) === JSON.stringify(USE_HDR), '見出し行が決まった10列のとおり');
  ok(sheets[1].rows.length === 2 && sheets[1].rows[1][2] === 'dev1', '1行足される');
});
test('ledger_unavailable_new_device_refused', () => {
  const h = useBook([]);
  h.failOpen.add(LEDGER_ID);
  const r = touch(h, mkEntry(5), 'dev1');
  ok(r.ok === false && r.reason === 'ledger_unavailable', 'ledger_unavailable(' + JSON.stringify(r) + ')');
  ok(r.message === EXPECTED_MSG.ledger_unavailable, '文が同じ');
  h.failOpen.delete(LEDGER_ID);
  ok(useRows(h).length === 1, '行は足されない');
});
test('ledger_unavailable_known_by_throttle_ok', () => {
  const h = useBook([]);
  touch(h, mkEntry(5), 'dev1');
  h.failOpen.add(LEDGER_ID);
  h.clock.advance(10 * 60 * 1000);
  const r = touch(h, mkEntry(5), 'dev1');
  ok(r.ok === true && r.used === 1, '間引きの札があれば台帳が開けなくても通る');
});
test('two_new_devices_last_slot_only_one', () => {
  const h = useBook([[TK, 'A社', 'd1', 'x', 'a', 'b', 1, 'v', '有効', '']]);
  const e = mkEntry(2);   // 空きは1つ
  const r1 = touch(h, e, 'dA');
  const r2 = touch(h, e, 'dB');
  ok(r1.ok === true && r1.used === 2, '1台目は最後の枠をもらう');
  ok(r2.ok === false && r2.reason === 'too_many', '2台目は too_many(' + JSON.stringify(r2) + ')');
  ok(useRows(h).length === 3, '足された行は1つだけ');
});
test('new_device_count_reread_inside_lock', () => {
  // 外で数えたあと、札の中に入るまでの間に別の端末が最後の枠を取った場合を模擬する
  const h = useBook([[TK, 'A社', 'd1', 'x', 'a', 'b', 1, 'v', '有効', '']]);
  const sheet = h.books[LEDGER_ID].sheets[0];
  const orig = h.ctx.license_withSheetLock_;
  h.ctx.license_withSheetLock_ = (k, fn, onBusy) => {
    sheet.rows.push([TK, 'A社', 'dRace', 'x', 'a', 'b', 1, 'v', '有効', '']);   // 札を立てる直前に割り込まれた
    return orig(k, fn, onBusy);
  };
  const r = touch(h, mkEntry(2), 'dNew');
  ok(r.ok === false && r.reason === 'too_many', '札の中で数え直して断る(' + JSON.stringify(r) + ')');
  ok(sheet.rows.length === 3, '行は割り込んだ1つだけ');
});
test('busy_new_device_refused', () => {
  const h = useBook([]);
  h.cache.set('lk_ledger', { v: 'other', exp: h.clock.now() + 3600 * 1000 });   // 他の端末の札が立ち続けている
  const r = touch(h, mkEntry(5), 'dev1');
  ok(r.ok === false && r.reason === 'busy' && r.message === EXPECTED_MSG.busy, 'busy(' + JSON.stringify(r) + ')');
  ok(useRows(h).length === 1, '行は足されない');
  const h2 = useBook([]);
  h2.lockBusy = true;
  const r2 = touch(h2, mkEntry(5), 'dev1');
  ok(r2.ok === false && r2.reason === 'busy', 'ScriptLock が取れなくても busy');
});
test('busy_existing_device_ok_without_write', () => {
  const h = useBook([[TK, 'A社', 'dev1', 'SM', '2026/10/01 09:00', '2026/10/01 09:00', 1, '3.30', '有効', '']]);
  h.cache.set('lk_ledger', { v: 'other', exp: h.clock.now() + 3600 * 1000 });
  const r = touch(h, mkEntry(5), 'dev1');
  ok(r.ok === true && r.used === 1, '登録済みの端末は札が取れなくても通る(' + JSON.stringify(r) + ')');
  ok(useRows(h)[1][6] === 1 && useRows(h)[1][7] === '3.30', '書かない');
});
test('lock_released_after_touch', () => {
  const h = useBook([]);
  touch(h, mkEntry(5), 'dev1');
  ok(h.cache.get('lk_ledger') === undefined, '札は消えている');
});

// ---- Task 4 修正ラウンド ----
const fmtAt = (h, r, c) => h.books[LEDGER_ID].sheets.find(s => s.name === 'lab-kanri利用').getRange(r, c).getNumberFormat();
test('text_columns_forced_text_format_new_row', () => {
  const h = useBook([]);
  touch(h, mkEntry(5), '0012345', { name: '1e5', ver: '3.30' });
  // A キー B 会社名 C 端末ID D 端末名 E 初回 F 最終 H 版 I 最終判定 はすべて '@'、G 利用回数は数値のまま
  for (const c of [1, 2, 3, 4, 5, 6, 8, 9]) ok(fmtAt(h, 2, c) === '@', USE_HDR[c - 1] + ' は書式@(' + fmtAt(h, 2, c) + ')');
  ok(fmtAt(h, 2, 7) !== '@', '利用回数は数値のまま(書式@にしない)');
  ok(useRows(h)[1][2] === '0012345' && useRows(h)[1][7] === '3.30', '値は文字のまま');
});
test('text_columns_forced_text_format_update', () => {
  const h = useBook([[TK, 'A社', '0012345', 'SM', '2026/10/01 09:00', '2026/10/01 09:00', 1, '3.29', '有効', '']]);
  touch(h, mkEntry(5), '0012345', { ver: '3.30' });
  for (const c of [6, 8, 9]) ok(fmtAt(h, 2, c) === '@', USE_HDR[c - 1] + ' は書式@(' + fmtAt(h, 2, c) + ')');
  ok(fmtAt(h, 2, 7) !== '@', '利用回数は数値のまま');
  ok(useRows(h)[1][7] === '3.30', '版は 3.30 のまま');
});
test('unowned_columns_never_written', () => {
  const hdr = USE_HDR.concat(['メモ']);
  const books = {}; books[LEDGER_ID] = { 'lab-kanri利用': [hdr, [TK, 'A社', 'dev1', 'SM', 'a', 'b', 1, 'v', '有効', 'AGM', '=A2&"x"']] };
  const h = harness.build({ books: books });
  const sh = h.books[LEDGER_ID].sheets[0];
  sh.log.length = 0;
  touch(h, mkEntry(5), 'dev1');   // 更新
  touch(h, mkEntry(5), 'dev2');   // 新しい行
  const written = sh.log.map(x => x.split(',').map(Number));
  ok(written.length > 0, '何か書いている');
  ok(written.every(([r, c]) => c <= 9), '呼び名(J)・メモ(K)の列には1度も書かない(' + sh.log.join(' ') + ')');
  ok(sh.rows[1][9] === 'AGM' && sh.rows[1][10] === '=A2&"x"', '既存行の呼び名・メモが残る');
  ok(sh.rows.length === 3 && sh.rows[2][2] === 'dev2', '新しい行は足される');
});
test('inputs_normalized_key_and_device', () => {
  const h = useBook([[TK, 'A社', 'dev1', 'SM', 'a', 'b', 1, 'v', '有効', '']]);
  const r = h.ctx.license_touchDevice_('lab-abcd-efgh', mkEntry(5), '  dev1 ', 'SM', '3.35', '有効', h.clock.now());
  ok(r.ok === true && r.used === 1, '空白つきの端末IDも既存の行と一致(' + JSON.stringify(r) + ')');
  ok(useRows(h).length === 2, '行は増えない');
  ok(h.cache.has('lk_touch_' + TK + '_dev1'), '間引き札は正規化したキー・端末IDで置く');
});
test('hand_typed_key_rows_counted', () => {
  const h = useBook([['lab-abcd-efgh', 'A社', 'd1', 'x', 'a', 'b', 1, 'v', '有効', ''], [' LAB ABCD EFGH ', 'A社', 'd2', 'x', 'a', 'b', 1, 'v', '有効', '']]);
  const r = touch(h, mkEntry(2), 'd3');
  ok(r.ok === false && r.reason === 'too_many', '手で直した小文字・空白のキーも数えて断る(' + JSON.stringify(r) + ')');
});
test('no_throttle_after_too_many_or_busy', () => {
  const h = useBook([[TK, 'A社', 'd1', 'x', 'a', 'b', 1, 'v', '有効', '']]);
  touch(h, mkEntry(1), 'd2');
  ok(!h.cache.has('lk_touch_' + TK + '_d2'), 'too_many のあとは間引き札を置かない');
  const o1 = h.calls.openById;
  touch(h, mkEntry(1), 'd2');
  ok(h.calls.openById > o1, '2回目はまた台帳を開く');
  const h2 = useBook([]);
  h2.cache.set('lk_ledger', { v: 'other', exp: h2.clock.now() + 3600 * 1000 });
  touch(h2, mkEntry(5), 'd9');
  ok(!h2.cache.has('lk_touch_' + TK + '_d9'), 'busy のあとは間引き札を置かない');
  const o2 = h2.calls.openById;
  touch(h2, mkEntry(5), 'd9');
  ok(h2.calls.openById > o2, 'busy のあとの2回目はまた台帳を開く');
});
test('rereg_increments_count', () => {
  const h = useBook([[TK, 'A社', 'dev1', 'SM-N986N', '2026/10/01 09:00', '2026/10/01 09:00', 1, '3.30', '有効', '']]);
  touch(h, mkEntry(5), 'dev1');
  ok(useRows(h)[1][6] === 2, '利用回数が1増える(' + useRows(h)[1][6] + ')');
});
test('missing_optional_header_logged_not_thrown', () => {
  const hdr = ['キー', '会社名', '端末ID', '端末名（機種）', '初回利用', '最終利用', '利用回数', '版', '呼び名'];   // 最終判定が無い
  const books = {}; books[LEDGER_ID] = { 'lab-kanri利用': [hdr] };
  const h = harness.build({ books: books });
  const logs = []; h.ctx.Logger.log = (m) => logs.push(String(m));
  const r = touch(h, mkEntry(5), 'dev1');
  ok(r.ok === true, '任意の見出しが無くても通る');
  ok(logs.some(m => m.indexOf('最終判定') >= 0), '見出しが無いことを Logger.log に残す(' + logs.join('|') + ')');
});


// ---- Task 5: 現場シートフォルダ・シートの所属・一覧 ----
const MIME_F = 'application/vnd.google-apps.folder', MIME_S = 'application/vnd.google-apps.spreadsheet';
const DF = (name, o) => Object.assign({ name: name, mimeType: MIME_S, parents: [], driveId: 'DR1', trashed: false }, o);
const driveH = (files) => harness.build({ drive: { files: files } });
const FOLDER = () => ({ FO: DF('現場シート', { mimeType: MIME_F, parents: ['DR1'] }) });

test('harness_selftest_list_order_and_not_found', () => {
  const h = driveH({
    FO: DF('現場シート', { mimeType: MIME_F, parents: ['DR1'] }),
    a: DF('a', { parents: ['FO'], modifiedTime: '2026-01-01T00:00:00.000Z' }),
    b: DF('b', { parents: ['FO'], modifiedTime: '2026-03-01T00:00:00.000Z' }),
    c: DF('c', { parents: ['FO'], modifiedTime: '2026-02-01T00:00:00.000Z' })
  });
  const SA = { supportsAllDrives: true, includeItemsFromAllDrives: true };
  let r = h.ctx.Drive.Files.list(Object.assign({ q: "'FO' in parents and trashed=false", orderBy: 'modifiedTime desc', fields: 'files(id)' }, SA));
  ok(r.files.map(f => f.id).join() === 'b,c,a', 'list: modifiedTime desc で新しい順');
  r = h.ctx.Drive.Files.list(Object.assign({ q: "'FO' in parents and trashed=false", orderBy: 'modifiedTime desc', pageSize: 2, fields: 'files(id)' }, SA));
  ok(r.files.map(f => f.id).join() === 'b,c', 'list: pageSize で切り詰める(新しい順の先頭から)');
  let msg = ''; try { h.ctx.Drive.Files.get('nope', { supportsAllDrives: true, fields: 'parents' }); } catch (e) { msg = e.message; }
  ok(/File not found/.test(msg), 'get: 未知のIDは File not found');
});

// ---- license_siteFolder_ ----
test('folder_found', () => {
  const h = driveH(FOLDER());
  const r = h.ctx.license_siteFolder_('DR1');
  ok(r.ok === true && r.folderId === 'FO', '直下の現場シートが1つ → ok(' + JSON.stringify(r) + ')');
  ok(h.cache.has('lk_folder_DR1'), 'フォルダIDを lk_folder_<driveId> に覚える');
});
test('folder_missing', () => {
  const h = driveH({});
  const r = h.ctx.license_siteFolder_('DR1');
  ok(r.ok === false && r.reason === 'no_folder' && r.message === EXPECTED_MSG.no_folder, '0件 → no_folder(' + JSON.stringify(r) + ')');
  ok(!h.cache.has('lk_folder_DR1'), '失敗は覚えない');
});
test('folder_two', () => {
  const f = FOLDER(); f.FO2 = DF('現場シート', { mimeType: MIME_F, parents: ['DR1'] });
  const h = driveH(f);
  const r = h.ctx.license_siteFolder_('DR1');
  ok(r.ok === false && r.reason === 'two_folders' && r.message === EXPECTED_MSG.two_folders, '2件 → two_folders(' + JSON.stringify(r) + ')');
  ok(!h.cache.has('lk_folder_DR1'), '重複は覚えない');
  // 重複を消したら直ちに ok（失敗は覚えていない）
  delete h.drive.files.FO2;
  const r2 = h.ctx.license_siteFolder_('DR1');
  ok(r2.ok === true && r2.folderId === 'FO', '重複を消した直後に ok');
});
test('folder_nested_ignored', () => {
  const h = driveH({
    SUB: DF('その他', { mimeType: MIME_F, parents: ['DR1'] }),
    NEST: DF('現場シート', { mimeType: MIME_F, parents: ['SUB'] }),
    NOTFOLDER: DF('現場シート', { parents: ['DR1'] }),                       // 同名でもフォルダでなければ数えない
    TRASH: DF('現場シート', { mimeType: MIME_F, parents: ['DR1'], trashed: true })   // ゴミ箱も数えない
  });
  const r = h.ctx.license_siteFolder_('DR1');
  ok(r.ok === false && r.reason === 'no_folder', '入れ子・非フォルダ・ゴミ箱の現場シートは無視 → no_folder(' + JSON.stringify(r) + ')');
});
test('folder_cached_6h', () => {
  const h = driveH(FOLDER());
  h.ctx.license_siteFolder_('DR1');
  const l1 = h.calls.driveList;
  h.clock.advance(6 * 3600 * 1000 - 1000);
  const r = h.ctx.license_siteFolder_('DR1');
  ok(r.ok === true && r.folderId === 'FO' && h.calls.driveList === l1, '6時間以内は Drive.Files.list を呼ばない');
  h.clock.advance(2000);
  h.ctx.license_siteFolder_('DR1');
  ok(h.calls.driveList === l1 + 1, '6時間を過ぎたら呼び直す');
});
test('folder_drive_error_cached_ok', () => {
  const h = driveH(FOLDER());
  h.cache.set('lk_folder_DR1', { v: 'FO', exp: h.clock.now() + 3600 * 1000 });
  h.failDrive = true;
  const r = h.ctx.license_siteFolder_('DR1');
  ok(r.ok === true && r.folderId === 'FO', 'キャッシュがあれば Drive が失敗しても ok(' + JSON.stringify(r) + ')');
  ok(h.calls.driveList === 0, 'キャッシュ命中なら Drive を呼ばない');
});
test('folder_drive_error_without_cache_unavailable', () => {
  const h = driveH(FOLDER());
  h.failDrive = true;
  const r = h.ctx.license_siteFolder_('DR1');
  ok(r.ok === false && r.reason === 'ledger_unavailable' && r.message === EXPECTED_MSG.ledger_unavailable, 'キャッシュ無し＋Drive失敗 → ledger_unavailable(' + JSON.stringify(r) + ')');
});
test('folder_list_args', () => {
  const h = driveH(FOLDER());
  let seen = null; const orig = h.ctx.Drive.Files.list;
  h.ctx.Drive.Files.list = (p) => { seen = p; return orig(p); };
  h.ctx.license_siteFolder_('DR1');
  ok(seen && seen.q === "name='現場シート' and mimeType='application/vnd.google-apps.folder' and 'DR1' in parents and trashed=false", 'q が SPEC どおり(' + (seen && seen.q) + ')');
  ok(seen.corpora === 'drive' && seen.driveId === 'DR1' && seen.includeItemsFromAllDrives === true && seen.supportsAllDrives === true, 'corpora/driveId/フラグが SPEC どおり');
});

// ---- license_sheetAllowed_ ----
const sheetEnv = () => driveH(Object.assign(FOLDER(), {
  S1: DF('s1', { parents: ['FO'] }),
  S2: DF('s2', { parents: ['OTHER'] }),
  S3: DF('s3', { parents: ['FO'], trashed: true })
}));
test('sheet_inside', () => {
  const h = sheetEnv();
  const r = h.ctx.license_sheetAllowed_('S1', 'FO');
  ok(r.ok === true, '中にある → ok(' + JSON.stringify(r) + ')');
  ok(h.cache.has('lk_in_FO_S1'), 'lk_in_<folderId>_<sheetId> に覚える');
});
test('sheet_outside', () => {
  const h = sheetEnv();
  const r = h.ctx.license_sheetAllowed_('S2', 'FO');
  ok(r.ok === false && r.reason === 'outside' && r.message === EXPECTED_MSG.outside, '外 → outside(' + JSON.stringify(r) + ')');
});
test('inside_cached_6h', () => {
  const h = sheetEnv();
  h.ctx.license_sheetAllowed_('S1', 'FO');
  const g1 = h.calls.driveGet;
  h.clock.advance(6 * 3600 * 1000 - 1000);
  const r = h.ctx.license_sheetAllowed_('S1', 'FO');
  ok(r.ok === true && h.calls.driveGet === g1, '2回目は Drive.Files.get を呼ばない');
  h.clock.advance(2000);
  h.ctx.license_sheetAllowed_('S1', 'FO');
  ok(h.calls.driveGet === g1 + 1, '6時間を過ぎたら確かめ直す');
});
test('outside_not_cached', () => {
  const h = sheetEnv();
  const r1 = h.ctx.license_sheetAllowed_('S2', 'FO');
  ok(r1.ok === false, '最初は外');
  ok(![...h.cache.keys()].some(k => k.indexOf('lk_in_') === 0), '外は覚えない');
  h.drive.files.S2.parents = ['FO'];   // 現場シートへ移した
  const r2 = h.ctx.license_sheetAllowed_('S2', 'FO');
  ok(r2.ok === true, '移した直後にすぐ ok(' + JSON.stringify(r2) + ')');
});
test('trashed_is_outside', () => {
  const h = sheetEnv();
  const r = h.ctx.license_sheetAllowed_('S3', 'FO');
  ok(r.ok === false && r.reason === 'outside', 'ゴミ箱の中は outside(' + JSON.stringify(r) + ')');
  ok(!h.cache.has('lk_in_FO_S3'), 'ゴミ箱は覚えない');
  // 一度「中」と覚えた後でも、期限内はキャッシュで通る（6時間の仕様）。ここでは覚える前の判定だけ確かめる
});
test('sheet_not_found_is_outside', () => {
  const h = sheetEnv();
  const r = h.ctx.license_sheetAllowed_('NOPE', 'FO');
  ok(r.ok === false && r.reason === 'outside', 'Drive の File not found → outside(' + JSON.stringify(r) + ')');
  const h2 = sheetEnv();
  h2.ctx.Drive.Files.get = () => { throw new Error('API call to drive.files.get failed with error: FILE NOT FOUND: xyz'); };
  ok(h2.ctx.license_sheetAllowed_('X', 'FO').reason === 'outside', '大文字小文字を問わず not found → outside');
  ok(![...h.cache.keys()].some(k => k.indexOf('lk_in_') === 0), 'not found も覚えない');
});
test('drive_error_with_cache_ok', () => {
  const h = sheetEnv();
  h.ctx.license_sheetAllowed_('S1', 'FO');   // 中と覚える
  h.failDrive = true;
  const g1 = h.calls.driveGet;
  const r = h.ctx.license_sheetAllowed_('S1', 'FO');
  ok(r.ok === true && h.calls.driveGet === g1, 'Drive が壊れていても、覚えた「中」で通る(' + JSON.stringify(r) + ')');
});
test('drive_error_without_cache_unavailable', () => {
  const h = sheetEnv();
  h.failDrive = true;
  const r = h.ctx.license_sheetAllowed_('S1', 'FO');
  ok(r.ok === false && r.reason === 'ledger_unavailable' && r.message === EXPECTED_MSG.ledger_unavailable, '覚えが無く Drive 失敗 → ledger_unavailable(' + JSON.stringify(r) + ')');
  ok(![...h.cache.keys()].some(k => k.indexOf('lk_in_') === 0), '失敗は覚えない');
});
test('sheet_get_args', () => {
  const h = sheetEnv();
  let seen = null, sid = null; const orig = h.ctx.Drive.Files.get;
  h.ctx.Drive.Files.get = (id, p) => { sid = id; seen = p; return orig(id, p); };
  h.ctx.license_sheetAllowed_('S1', 'FO');
  ok(sid === 'S1' && seen.supportsAllDrives === true && seen.fields === 'parents,trashed', 'get の引数が SPEC どおり');
});

// ---- license_listSites_ ----
test('list_sorted_new_first_max100', () => {
  const files = FOLDER();
  for (let i = 0; i < 120; i++) {
    files['sp' + i] = DF('現場' + i, { parents: ['FO'], modifiedTime: new Date(Date.UTC(2026, 0, 1) + i * 3600 * 1000).toISOString() });
  }
  files.fold = DF('子フォルダ', { mimeType: MIME_F, parents: ['FO'], modifiedTime: '2027-01-01T00:00:00.000Z' });   // スプレッドシート以外は出ない
  files.doc = DF('書類', { mimeType: 'application/vnd.google-apps.document', parents: ['FO'], modifiedTime: '2027-01-01T00:00:00.000Z' });
  files.trash = DF('ゴミ', { parents: ['FO'], trashed: true, modifiedTime: '2027-02-01T00:00:00.000Z' });
  files.other = DF('別の置き場', { parents: ['ELSE'], modifiedTime: '2027-03-01T00:00:00.000Z' });
  const h = driveH(files);
  const r = h.ctx.license_listSites_('FO');
  ok(r.length === 100, '最大100件(' + r.length + ')');
  ok(r[0].id === 'sp119' && r[0].name === '現場119' && r[99].id === 'sp20', '更新の新しい順(先頭 ' + r[0].id + ' / 末尾 ' + r[99].id + ')');
  ok(r[0].modified === Date.UTC(2026, 0, 1) + 119 * 3600 * 1000, 'modified は epoch ms(' + r[0].modified + ')');
  ok(r.every(x => x.id.indexOf('sp') === 0), 'フォルダ・書類・ゴミ箱・別の置き場は出ない');
  ok(Object.keys(r[0]).sort().join() === 'id,modified,name', '返す項目は id,name,modified');
});
test('list_args_and_empty', () => {
  const h = driveH(FOLDER());
  let seen = null; const orig = h.ctx.Drive.Files.list;
  h.ctx.Drive.Files.list = (p) => { seen = p; return orig(p); };
  const r = h.ctx.license_listSites_('FO');
  ok(Array.isArray(r) && r.length === 0, '空なら []');
  ok(seen.q === "'FO' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false", 'q が SPEC どおり');
  ok(seen.corpora === 'allDrives' && seen.orderBy === 'modifiedTime desc' && seen.pageSize === 100 && seen.includeItemsFromAllDrives === true && seen.supportsAllDrives === true, '引数が SPEC どおり');
});

test('appsscript_drive_service', () => {
  const j = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'appsscript.json'), 'utf8'));
  ok(JSON.stringify(j.dependencies.enabledAdvancedServices) === JSON.stringify([{ userSymbol: 'Drive', serviceId: 'drive', version: 'v3' }]), 'Drive v3 を高度なサービスに');
  ok(j.timeZone === 'Asia/Tokyo' && j.runtimeVersion === 'V8' && j.exceptionLogging === 'STACKDRIVER' && j.webapp.access === 'ANYONE_ANONYMOUS', '既存のキーは変えない');
});


for (const [name, fn] of tests) {
  try { fn(); } catch (e) { ok(false, name + ' が例外: ' + (e && e.stack || e)); }
}
console.log(`${checks} 件中 ${checks - fails} 件OK` + (fails ? ` / ${fails} 件NG` : ''));
process.exit(fails ? 1 : 0);
