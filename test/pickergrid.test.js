// _picker_data の対応表（pickerGrid・v3.41 名前の見出し）の試験: ~/.local/node/bin/node test/pickergrid.test.js
const harness = require('./harness');
let checks = 0, fails = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('✖ ' + msg); } };
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const GRID = { pointNames: { A901: 'A北1', A1: 'A1' }, axisOrder: { cols: ['A'], rows: ['901', '1'] }, rowNames: { '901': '北1' }, colNames: {} };
// picker の書き方：A1＝印、A2＝meta、A3〜＝JSON を分けた文字列
const pdTab = (obj, opts) => {
  opts = opts || {};
  const json = JSON.stringify(obj);
  const n = opts.parts || 3, size = Math.ceil(json.length / n), parts = [];
  for (let i = 0; i < json.length; i += size) parts.push(json.slice(i, i + size));
  const meta = { formatVersion: 1, chunks: opts.metaChunks != null ? opts.metaChunks : parts.length,
                 length: opts.metaLength != null ? opts.metaLength : json.length, savedAt: opts.savedAt || '2026-11-21T11:41:31.984Z' };
  return [[opts.mark || '__PICKER_V1__'], [JSON.stringify(meta)]].concat(parts.map(p => [p]));
};
const build = (tabs) => harness.build({ books: { S1: tabs } });
const book = (h) => h.books.S1;
// その本の getRange が読んだ行の範囲を数える
const spyRanges = (h) => {
  const seen = [];
  const sh = book(h).getSheetByName('_picker_data');
  const orig = sh.getRange.bind(sh);
  sh.getRange = (r, c, nr, nc) => { seen.push([r, nr || 1]); return orig(r, c, nr, nc); };
  return seen;
};

test('grid_reads_chunked', () => {
  const h = build({ '_picker_data': pdTab({ site: { grid: Object.assign({ xSpec: 'A', other: 1 }, GRID) } }) });
  const g = h.ctx.readPickerGrid_(book(h));
  ok(g && JSON.stringify(g.pointNames) === JSON.stringify(GRID.pointNames), 'pointNames(' + JSON.stringify(g) + ')');
  ok(JSON.stringify(g.axisOrder) === JSON.stringify(GRID.axisOrder) && g.rowNames['901'] === '北1' && JSON.stringify(g.colNames) === '{}', '並びと名前');
  ok(Object.keys(g).sort().join() === 'axisOrder,colNames,pointNames,rowNames', '返すのは4項目だけ(' + Object.keys(g) + ')');
});
test('grid_cached_by_savedAt', () => {
  const h = build({ '_picker_data': pdTab({ site: { grid: GRID } }) });
  h.ctx.readPickerGrid_(book(h));
  const seen = spyRanges(h);
  const g2 = h.ctx.readPickerGrid_(book(h));
  ok(g2 && g2.pointNames.A901 === 'A北1', '2回目も同じ答え');
  ok(seen.every(([r]) => r <= 2), '2回目は A1〜A2 だけ読む(' + JSON.stringify(seen) + ')');
  // picker が保存し直した（savedAt が変わった・中身も変わった）
  const sh = book(h).getSheetByName('_picker_data');
  const fresh = pdTab({ site: { grid: Object.assign({}, GRID, { pointNames: { A901: 'A北1', A1: 'A1', A2: 'A2' } }) } }, { savedAt: '2026-11-22T00:00:00.000Z' });
  sh.rows = fresh.map(r => r.slice());
  const g3 = h.ctx.readPickerGrid_(book(h));
  ok(g3 && g3.pointNames.A2 === 'A2', 'savedAt が変われば読み直す(' + JSON.stringify(g3) + ')');
});
test('grid_null_cases', () => {
  ok(build({ '件名': [['件名', 'x']] }).ctx.readPickerGrid_(book(build({ '件名': [['件名', 'x']] }))) === null, 'タブ無しは null');
  const h = build({ '_picker_data': pdTab({ site: { grid: { xSpec: 'A-H', ySpec: '1-6' } } }) });
  ok(h.ctx.readPickerGrid_(book(h)) === null, 'pointNames が無ければ null');
  const h2 = build({ '_picker_data': pdTab({ site: {} }) });
  ok(h2.ctx.readPickerGrid_(book(h2)) === null, 'grid が無ければ null');
  const h3 = build({ '_picker_data': pdTab({ site: { grid: GRID } }, { mark: 'OTHER' }) });
  ok(h3.ctx.readPickerGrid_(book(h3)) === null, 'A1 が印でなければ null');
});
test('grid_error_cases', () => {
  const broken = pdTab({ site: { grid: GRID } });
  broken[3][0] = broken[3][0].slice(0, -3);   // 途中が欠けた
  const h = build({ '_picker_data': broken.concat() });
  const g = h.ctx.readPickerGrid_(book(h));
  ok(g && typeof g.error === 'string' && g.error, '長さが合わなければ {error}(' + JSON.stringify(g) + ')');
  const h2 = build({ '_picker_data': pdTab({ site: { grid: GRID } }, { metaChunks: 9 }) });
  const g2 = h2.ctx.readPickerGrid_(book(h2));
  ok(g2 && g2.error, 'chunks が足りなければ {error}(' + JSON.stringify(g2) + ')');
  const bad = [['__PICKER_V1__'], [JSON.stringify({ chunks: 1, length: 5, savedAt: 'x' })], ['{abc}']];
  const h3 = build({ '_picker_data': bad });
  const g3 = h3.ctx.readPickerGrid_(book(h3));
  ok(g3 && g3.error, 'JSON が壊れていれば {error}(' + JSON.stringify(g3) + ')');
  const h4 = build({ '_picker_data': [['__PICKER_V1__'], ['meta が壊れている']] });
  const g4 = h4.ctx.readPickerGrid_(book(h4));
  ok(g4 && g4.error, 'meta が読めなければ {error}(' + JSON.stringify(g4) + ')');
});
test('grid_too_big_not_cached', () => {
  const big = {}; for (let i = 0; i < 6000; i++) big['A' + i] = 'ながい地点名の見本' + i;
  const h = build({ '_picker_data': pdTab({ site: { grid: Object.assign({}, GRID, { pointNames: big }) } }, { parts: 8 }) });
  const g = h.ctx.readPickerGrid_(book(h));
  ok(g && g.pointNames.A5999, '大きくても返す');
  ok(![...h.cache.keys()].some(k => k.indexOf('lk_grid_') === 0), '100KB を超えたら控えない');
});
test('answers_carry_pickerGrid', () => {
  const h = build({ '_picker_data': pdTab({ site: { grid: GRID } }), '分析検体': [['地点', '1', '2']] });
  const a = h.ctx.getSaishuAll('S1');
  ok(a.ok && a.pickerGrid && a.pickerGrid.pointNames.A901 === 'A北1', 'getSaishuAll(' + JSON.stringify(a.pickerGrid) + ')');
  const k = h.ctx.getKentaiData('S1');
  ok(k.ok && k.pickerGrid && k.pickerGrid.pointNames.A901 === 'A北1', 'getKentaiData(' + JSON.stringify(k).slice(0, 200) + ')');
  const d = h.ctx.getDailyReportData('S1', '');
  ok(d.ok && d.pickerGrid && d.pickerGrid.pointNames.A901 === 'A北1', 'getDailyReportData(' + JSON.stringify(d).slice(0, 200) + ')');
  const h2 = build({ '分析検体': [['地点', '1', '2']] });
  ok(h2.ctx.getSaishuAll('S1').pickerGrid === null && h2.ctx.getKentaiData('S1').pickerGrid === null && h2.ctx.getDailyReportData('S1', '').pickerGrid === null, '表の無い本は null');
});

test('grid_table_then_unreadable_is_error', () => {
  const h = build({ '_picker_data': pdTab({ site: { grid: GRID } }) });
  ok(h.ctx.readPickerGrid_(book(h)).pointNames, '1回目は表');
  const sh = book(h).getSheetByName('_picker_data');
  sh.rows = [[''], ['']];   // picker が消してから書き直す途中
  const g = h.ctx.readPickerGrid_(book(h));
  ok(g && g.error, 'さっきまで表があったのに読めない＝{error}（null にしない）(' + JSON.stringify(g) + ')');
  book(h).sheets = book(h).sheets.filter(x => x.name !== '_picker_data');
  const g2 = h.ctx.readPickerGrid_(book(h));
  ok(g2 && g2.error, 'タブが消えても、表を覚えている間は {error}(' + JSON.stringify(g2) + ')');
  const h2 = build({ '_picker_data': pdTab({ site: { grid: { xSpec: 'A' } } }) });
  ok(h2.ctx.readPickerGrid_(book(h2)) === null, '表を覚えていなければ null のまま');
});
test('grid_exception_does_not_break_answers', () => {
  const h = build({ '_picker_data': pdTab({ site: { grid: GRID } }), '分析検体': [['地点', '1', '2']] });
  h.ctx.CacheService.getScriptCache = () => { throw new Error('cache down'); };
  const g = h.ctx.readPickerGrid_(book(h));
  ok(g && (g.error || g.pointNames), '控えが壊れていても例外にしない(' + JSON.stringify(g) + ')');
  const a = h.ctx.getSaishuAll('S1');
  ok(a.ok === true, 'getSaishuAll は ok のまま(' + JSON.stringify(a).slice(0, 150) + ')');
});

for (const [name, fn] of tests) {
  try { fn(); } catch (e) { ok(false, name + ' が例外: ' + (e && e.stack || e)); }
}
console.log(`${checks} 件中 ${checks - fails} 件OK` + (fails ? ` / ${fails} 件NG` : ''));
process.exit(fails ? 1 : 0);
