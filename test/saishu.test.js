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

test('kinds_report_hasGenchi', () => {
  const head = ['状態', '地点', '上下', 'コード', '採取日時', '採取担当', '現地確認日時', '現地確認担当', '受入日時', '受入担当', '風乾日時', '風乾担当', '被覆', '検測深度'];
  const old = ['状態', '地点', '上下', 'コード', '採取日時', '採取担当', '受入日時', '受入担当', '風乾日時', '風乾担当', '被覆', '検測深度'];
  const h = build({ '表層土壌': [head, ['', 'A1', '上', 'ABCD-S-0001', '2026/11/18 10:00', '佐藤', '', '', '', '', '', '', '', '']],
                    '土壌ガス': [['状態', '地点', 'コード', '削孔日時', '削孔担当', '採取日時', '採取担当'], ['', 'G1', 'ABCD-G-0001', '', '', '', '']] });
  const r = h.ctx.getSaishuAll('S1');
  ok(r.kinds['表層土壌'].hasGenchi === true, '現地確認日時の列があれば true(' + JSON.stringify(r.kinds['表層土壌']) + ')');
  ok(r.kinds['土壌ガス'].hasGenchi === false, '無ければ false(' + JSON.stringify(r.kinds['土壌ガス']) + ')');
  ok(r.kinds['表層土壌'].rows.length === 1 && r.kinds['表層土壌'].rows[0][9] === 'ABCD-S-0001', '行はそのまま');
  const h2 = build({ '表層土壌': [old, ['', 'A1', '上', 'ABCD-S-0001', '', '', '', '', '', '', '', '']] });
  ok(h2.ctx.getSaishuAll('S1').kinds['表層土壌'].hasGenchi === false, '古い並びのシートは false');
});

for (const [name, fn] of tests) {
  try { fn(); } catch (e) { ok(false, name + ' が例外: ' + (e && e.stack || e)); }
}
console.log(`${checks} 件中 ${checks - fails} 件OK` + (fails ? ` / ${fails} 件NG` : ''));
process.exit(fails ? 1 : 0);
