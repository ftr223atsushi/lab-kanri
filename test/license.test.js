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

for (const [name, fn] of tests) {
  try { fn(); } catch (e) { ok(false, name + ' が例外: ' + (e && e.stack || e)); }
}
console.log(`${checks} 件中 ${checks - fails} 件OK` + (fails ? ` / ${fails} 件NG` : ''));
process.exit(fails ? 1 : 0);
