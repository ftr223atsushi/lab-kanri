// getSaishuAll の試験（v3.40：掘削完了タブの検測 depthDone）: ~/.local/node/bin/node test/saishu.test.js
const harness = require('./harness');
let checks = 0, fails = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('✖ ' + msg); } };
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const DONE_HEAD = ['状態', '地点', '掘削完了日時', '掘削担当', '被覆', '検測', '水位'];
const build = (tabs) => harness.build({ books: { S1: tabs } });

test('depth_done_reads_kensoku', () => {
  const h = build({ '掘削完了': [DONE_HEAD,
    ['', 'B3', '2026/11/18 15:00', '鈴木', '', '5.0', ''],
    ['削除', 'B4', '', '', '', '3.0', ''],
    ['', '', '', '', '', '9.9', '']] });
  const r = h.ctx.getSaishuAll('S1');
  ok(r.ok === true, 'ok(' + JSON.stringify(r) + ')');
  ok(JSON.stringify(r.depthDone) === JSON.stringify({ B3: '5.0' }), '削除と地点なしを除いた {地点:検測}(' + JSON.stringify(r.depthDone) + ')');
});
test('depth_done_missing_tab', () => {
  const h = build({ '件名': [['件名', 'x']] });
  const r = h.ctx.getSaishuAll('S1');
  ok(r.ok === true && JSON.stringify(r.depthDone) === '{}', 'タブが無ければ {}(' + JSON.stringify(r) + ')');
});
test('depth_done_header_order', () => {
  const h = build({ '掘削完了': [['地点', '検測', '状態'], ['C1', '7.5', ''], ['C2', '', '']] });
  const r = h.ctx.getSaishuAll('S1');
  ok(JSON.stringify(r.depthDone) === JSON.stringify({ C1: '7.5', C2: '' }), '見出しの名前で引く(' + JSON.stringify(r.depthDone) + ')');
});

for (const [name, fn] of tests) {
  try { fn(); } catch (e) { ok(false, name + ' が例外: ' + (e && e.stack || e)); }
}
console.log(`${checks} 件中 ${checks - fails} 件OK` + (fails ? ` / ${fails} 件NG` : ''));
process.exit(fails ? 1 : 0);
