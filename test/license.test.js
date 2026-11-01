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

test('license_msg_busy_exact', () => {
  const h = harness.build({ files: ['Code_v2.gs', 'License.gs'] });
  ok(h.eval('LICENSE_MSG_.busy') === 'サーバーが混み合っています。少し待ってからもう一度読んでください（記録はされていません）', 'LICENSE_MSG_.busy が一字一句同じ');
});

for (const [name, fn] of tests) {
  try { fn(); } catch (e) { ok(false, name + ' が例外: ' + (e && e.stack || e)); }
}
console.log(`${checks} 件中 ${checks - fails} 件OK` + (fails ? ` / ${fails} 件NG` : ''));
process.exit(fails ? 1 : 0);
