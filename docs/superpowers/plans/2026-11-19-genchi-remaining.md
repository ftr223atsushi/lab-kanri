# 現地確認の「残り」帯と本日の並べ替え（lab-kanri 3.40）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現地確認モードのメイン画面に「今日掘った N ／ 現地確認 M ／ ⚠ 残り K」と残りの一覧を出し、「📋本日」に［時刻の順｜地点の順］の切り替えを付ける。

**Architecture:** サーバーは今ある `getSaishuAll` の答えに `depthDone`（「掘削完了」タブの {地点: 検測}）を足すだけ。残りの計算・並べ替え・帯の HTML はアプリの新しい純粋関数ファイル `assets/genchi.js`（`window.Genchi`／node の `module.exports`）に置き、node で試験する。index.html は読み込み・表示・スキャン後の更新だけを受け持つ。

**Tech Stack:** Google Apps Script（Code_v2.gs・clasp）、Android WebView の素の JS（ES5 寄り・license.js と同じ書き方）、node 22（`~/.local/node/bin/node`）の素の assert 試験。

**Spec:** `~/app_dev/lab-kanri/docs/superpowers/specs/2026-11-18-genchi-remaining-design.md`

## Global Constraints
- 版は 3.40（アプリ `assets/index.html` の `#appVersion` とサーバー `Code_v2.gs` の `APP_VERSION` を同じ文字列 `3.40-YYYYMMDD.HHMM` に）。
- 現地確認モードの内部名は `'採取'`（画面の表示だけ「現地確認」）。帯は `currentMode === '採取'` のときだけ出す。
- `getSaishuAll` の行の並び（0=地点 1=上下 2=深度 5=採取日時 6=採取担当 9=コード 10=現地確認日時 14=状態 15=現地深度）は変えない。答えに項目を足すだけ（古いアプリ互換）。
- 種別キー（getSaishuAll の答え）：`'表層土壌' '土壌ガス' '配管・ピット・盛り土下' '深度調査'`（配管は旧表記「盛り土下」）。
- 並びの規則：種別（表層→ガス→配管→深度［→分析検体］）→地点（数字は数として比べる。A2 < A10）→上下（上→下）→深さ（最初の数字を数として。数字の無いものは後ろ）。
- 地下水の行＝コード `^[A-Z]{4}-(WG|WP)-\d{4}`。深度の浅い穴の判定から外す（瓶ごとに採取日時があるため）。
- 「掘った」＝採取日時あり。状態「削除」は数えない。今日＝端末の日付（`yyyy-MM-dd`）。現地確認日時の日付は問わない。
- 深度の土の行：「掘削完了」タブの検測（最初の数字）があり、行の深度の最初の数字が検測より深ければ「掘った」に数えず skipped へ。検測が無い・読めない地点は全部数える。
- 画面の文字は日本語。HTML に入れる文字は必ずエスケープ（`& < > " '`）。
- 試験は node：サーバー `~/.local/node/bin/node test/<file>.test.js`（lab-kanri）、アプリ `~/.local/node/bin/node test/<file>.test.js`（lab-kanri-android）。既存の試験（license.test.js 598件、license-js 75件、history-js 13件、key-boxes）を壊さない。

## Review Focus
- 採取日時の書式ゆれ（`2026/11/18 9:05`・`2026-11-18 09:05:33`・空白だけ・日付として読めない文字）→ 読めない採取日時は「前日まで」に入れ、日付は空で出す（落ちない）。Task 2 の試験で押さえる。
- 深度の値のゆれ（`1.0`・`1.0m`・`GL-1.0`・`1.0～1.5`・空・`地下水`）→ 最初の数字。`GL-1.0` は 1.0（マイナスにしない）。Task 2 の試験で押さえる。
- 同じコードを2回読んだ・別の現場のコードを読んだ → markGenchi が見つけられなければ何も変えず false。Task 2 の試験で押さえる。
- スキャンの成功ごとに setMode('採取') が呼ばれる → 帯の読み直し（サーバー呼び出し）は毎回しない。Task 3 の確認手順で押さえる。
- 「本日」の地点の順で、分析検体（振り・ろか）の行や上下が色（黒・赤・青）の行が混ざる → 分析検体は最後、色は上下の後ろ（並びは安定）。Task 2 の試験で押さえる。

---

### Task 1: サーバー：getSaishuAll に depthDone（掘削完了タブの検測）を足す

**Files:**
- Modify: `~/app_dev/lab-kanri/Code_v2.gs`（`getSaishuAll` 付近、`APP_VERSION` 37行）
- Create: `~/app_dev/lab-kanri/test/saishu.test.js`

**Interfaces:**
- Produces: `readDepthDone_(ss) -> Object<string,string>`（地点 → 検測の文字列そのまま。タブが無い・空なら `{}`。状態「削除」の行と地点が空の行は除く。見出しは1行目から「地点」「検測」「状態」を名前で探す）。`getSaishuAll(id)` の答え `{ok:true, kinds:{…}, depthDone:{…}}`（読めなくても `depthDone:{}` で ok のまま）。

- [ ] **Step 1: 試験を書く** — `test/saishu.test.js`（`harness.build({ books: { S1: { '掘削完了': [...], '深度調査': [...] } } })`、`harness.post` ではなく `h.ctx.getSaishuAll('S1')` を直接呼ぶ。harness の Book は `getSheetByName`／`getRange().getDisplayValues()` がある）
  - `depth_done_reads_kensoku`：掘削完了タブ `[['状態','地点','掘削完了日時','掘削担当','被覆','検測','水位'],['','B3','2026/11/18 15:00','鈴木','','5.0',''],['削除','B4','','','','3.0',''],['','','','','','9.9','']]` → `depthDone` が `{B3:'5.0'}` だけ。
  - `depth_done_missing_tab`：掘削完了タブなし → `ok===true` かつ `depthDone` が `{}`。
  - `depth_done_header_order`：列の順を入れ替えた見出し（`['地点','検測','状態']`）でも読める。
  - 先頭に `const harness = require('./harness')`、末尾で件数を出し、失敗があれば `process.exit(1)`（license.test.js と同じ形）。
- [ ] **Step 2: 失敗を確かめる** — `~/.local/node/bin/node test/saishu.test.js` → depthDone が undefined で NG。
- [ ] **Step 3: 作る** — `readDepthDone_` を `getSaishuAll` のすぐ下に置き、`getSaishuAll` の return に `depthDone: readDepthDone_(ss)` を足す（`readDepthDone_` の中は try/catch で `{}` を返す）。タブ名は `'掘削完了'`。
- [ ] **Step 4: 通ることを確かめる** — `node test/saishu.test.js` 全件OK、`node test/license.test.js` 598件OK。
- [ ] **Step 5: 記録** — `git commit -m "v3.40: getSaishuAll に掘削完了タブの検測（depthDone）"`（版の数字は Task 5 で上げる）。

### Task 2: アプリ：genchi.js（残りの計算・並べ替え・帯の HTML）

**Files:**
- Create: `~/app_dev/lab-kanri-android/app/src/main/assets/genchi.js`
- Create: `~/app_dev/lab-kanri-android/test/genchi-js.test.js`

**Interfaces:**
- Produces（`window.Genchi` と `module.exports` の両方。license.js の末尾と同じ書き出し方）:
  - `firstNumber(s) -> number|null`（`/\d+(?:\.\d+)?/` の最初。`GL-1.0`→1.0）
  - `dateKeyOf(s) -> string`（`yyyy/M/d…` か `yyyy-M-d…` → `yyyy-MM-dd`。読めなければ `''`）
  - `compareItems(a, b) -> number`（item 同士。Global Constraints の並びの規則。最後にコードで比べて順を決め切る）
  - `computeRemaining(kinds, depthDone, todayKey) -> { todayDug, todayDone, todayLeft: Item[], earlierLeft: Item[], skipped: {point, ken, count}[] }`
    - `kinds` は getSaishuAll の `kinds`（`{種別: {rows}}`）。Item = `{kind, point, ud, depth, code, dateKey, worker}`（kind は種別キー、depth は行の2列目の文字列）。
    - todayLeft・earlierLeft は compareItems で並べる。skipped は地点の順。
  - `markGenchi(kinds, code, timeStr) -> boolean`（コードを大文字にして r[9] と比べ、最初に合った行の r[10] に timeStr。状態「削除」の行は飛ばす）
  - `bandHtml(result, expanded) -> string`（帯の HTML。下の見た目どおり）
  - `dailyOrder(rows, kinds) -> number[]`（本日の行の並べ替え。rows は日報の行 `[地点, 上下(深度・色), 工程, 時刻, 担当, コード, 印刷]`、kinds は同じ長さの種別配列（`'分析検体'` を含む）。返すのは元の添字の並び）

帯の見た目（`bandHtml`。`expanded` で一覧を開く。`data-gb="toggle"` と `data-gb="refresh"` のボタン）:
```
今日掘った 24 ／ 現地確認 21 ／ ⚠ 残り 3 ▼   ［↻］      ← 残り0なら「✓ そろいました」・前日までの残りがあれば「（前日まで 1）」を足す
  表層  C6-2  下      採取：佐藤                         ← 種別の短い名（表層・ガス・配管・深度・地下水）
  深度  B3    4.0m    採取：鈴木
  前日までの残り
  表層  A1-3  上   11/17  採取：佐藤
  B3 は掘った深さ 5.0 より深い予定 3袋を数えていません   ← skipped（薄い色）
```
今日掘ったが 0 で、前日までの残りも skipped も無いときは `今日掘った検体はまだありません（shast の採取の記録を待っています）` の1行。

- [ ] **Step 1: 試験を書く**（`test/genchi-js.test.js`。license-js.test.js と同じ `t(name, fn)` 形式）
  - `firstNumber`：`'1.0'→1`、`'1.0m'→1`、`'GL-1.5'→1.5`、`'1.0～1.5'→1`、`''→null`、`'地下水'→null`。
  - `dateKeyOf`：`'2026/11/18 9:05'→'2026-11-18'`、`'2026-11-8 09:05:33'→'2026-11-08'`、`'  '→''`、`'不明'→''`。
  - `computeRemaining` 表層：今日採取2行（うち1行現地確認済み）、昨日採取1行未確認、採取なし1行、削除1行 → `todayDug 2 / todayDone 1 / todayLeft 1件 / earlierLeft 1件（dateKey '2026-11-17'）`。
  - `computeRemaining` 深度の浅い穴：B3 の土の行 1.0〜8.0（8行・今日採取・未確認）、`depthDone {B3:'5.0'}` → todayDug 5、skipped `[{point:'B3', ken:5, count:3}]`、todayLeft の深さが 1,2,3,4,5 の数字の順。
  - 地下水の行（コード `ABCD-WG-0001`、深度列が空）は検測に関係なく数える。
  - 検測が `''` の地点は全部数える。
  - 並び：地点 `A10-1` と `A2-1` → A2-1 が先。上下は上→下。種別は表層→ガス→配管→深度。
  - 採取日時が読めない行（`'不明'`）は earlierLeft に入り dateKey `''`。
  - `markGenchi`：小文字で渡しても合う → true・r[10] が入り、次の computeRemaining で残りから消える。知らないコード → false・何も変わらない。
  - `bandHtml`：残り0→`そろいました` を含む。`<b>` という地点名がエスケープされる（`&lt;b&gt;`）。expanded=false では一覧の行を含まない。
  - `dailyOrder`：時刻ばらばらの深度 `10.0, 2.0, 1.0`（同じ地点）→ 1.0, 2.0, 10.0 の順の添字。分析検体の行は最後。上下が `黒` の行は `上`・`下` の後ろ。同じキーは元の順（安定）。
- [ ] **Step 2: 失敗を確かめる** — `node test/genchi-js.test.js` → ファイルが無くて NG。
- [ ] **Step 3: 作る** — `genchi.js` に上の関数。種別の短い名は `{'表層土壌':'表層','土壌ガス':'ガス','配管・ピット・盛り土下':'配管','深度調査':'深度'}`、地下水の行は `'地下水'`。地点の比べ方は、数字のかたまりと文字のかたまりに分けて順に比べる（数字は数として）。
- [ ] **Step 4: 通ることを確かめる** — `node test/genchi-js.test.js` 全件OK、既存3つの試験もOK。
- [ ] **Step 5: 記録** — `git commit -m "v3.40: genchi.js（現地確認の残りの計算・並べ替え・帯）"`

### Task 3: アプリ：現地確認モードに帯を出す（index.html）

**Files:**
- Modify: `~/app_dev/lab-kanri-android/app/src/main/assets/index.html`

**Interfaces:**
- Consumes: Task 2 の `Genchi.computeRemaining / markGenchi / bandHtml`、Task 1 の `getSaishuAll` の `depthDone`。

- [ ] **Step 1: 読み込み** — 1660行 `<script src="history.js"></script>` の次に `<script src="genchi.js"></script>`。
- [ ] **Step 2: 置き場所** — 1273行 `<div id="result" …>…</div>` の直後に `<div id="genchiBand" class="genchi-band" hidden></div>`。CSS は `.site-row` の近くに：帯は薄い黄色の枠（残りがあるとき）／薄い緑（そろったとき）、一覧の行は 13px、skipped の行は灰色。
- [ ] **Step 3: 状態と読み込み** — `let genchiState = { sheetId: '', kinds: null, depthDone: {}, expanded: false, loading: false, seq: 0 }`。
  `loadGenchiBand_(force)`：`currentMode !== '採取'` か現場が未設定なら帯を隠して終わり。`!force && genchiState.sheetId === getCurrentSpreadsheetId() && genchiState.kinds` なら描くだけ。そうでなければ `google.script.run.getSaishuAll(id)` で読み、`seq` で古い答えを捨て、`kinds`・`depthDone`（無ければ `{}`）を入れて描く。読み込み中は帯に「読み込み中…」、失敗は「残りを読めませんでした［↻］」。
  `renderGenchiBand_()`：`Genchi.computeRemaining(kinds, depthDone, dayKey_(new Date()))` → `Genchi.bandHtml(result, genchiState.expanded)` を `#genchiBand` に入れて `hidden=false`。
- [ ] **Step 4: つなぐ**
  - `setMode(mode)` の最後：`mode === '採取'` なら `loadGenchiBand_(false)`、それ以外なら帯を隠す（`prev === '採取'` でなくても描き直すだけなのでサーバーは呼ばない＝スキャンの成功ごとに呼ばれても安い）。
  - `onScanResult` の成功（`res.ok`）で `res.mode === '採取' && res.code && genchiState.kinds` なら `Genchi.markGenchi(genchiState.kinds, res.code, nowText)` のあと `renderGenchiBand_()`（サーバーは呼ばない）。
  - 取り消し（2621行の `.undoRecord(...)` の成功ハンドラ）で `res.mode === '採取'` なら `loadGenchiBand_(true)`。
  - `setCurrentSpreadsheet(id, …)`（1806行）の最後で `genchiState.kinds = null; genchiState.sheetId = ''; loadGenchiBand_(true)`。
  - 帯のクリック：`data-gb="toggle"` で expanded を反転して描き直し、`data-gb="refresh"` で `loadGenchiBand_(true)`。読み込みの答えで `genchiState.sheetId` を今の ID にする。
  - `ARG_NAMES` の `getSaishuAll` はすでにある（追加不要）。
- [ ] **Step 5: 確かめる** — インラインの script を取り出して `node --check`、既存の試験全部。
- [ ] **Step 6: 記録** — `git commit -m "v3.40: 現地確認モードに『今日掘った／現地確認／残り』の帯"`

### Task 4: アプリ：「📋本日」の並べ替えの切り替え

**Files:**
- Modify: `~/app_dev/lab-kanri-android/app/src/main/assets/index.html`（`renderDailyTable_` 5925行〜）

**Interfaces:**
- Consumes: Task 2 の `Genchi.dailyOrder(rows, kinds)`。

- [ ] **Step 1: 状態** — `let dailySort = (localStorage.getItem('lab_kanri_daily_sort') === 'point') ? 'point' : 'time';`（try/catch で読む）。
- [ ] **Step 2: 絞り込みを添字で** — 5946行の `allRows.filter(...)` を、条件を満たす添字の配列 `idx` に置き換え、`rows = idx.map(i => allRows[i])`、`rowKinds = kinds ? idx.map(i => kinds[i]) : rows.map(() => '')`。`dailySort === 'point'` なら `Genchi.dailyOrder(rows, rowKinds)` の順に並べ直す（件数・工程の集計は並べ替えの前後で同じ）。
- [ ] **Step 3: 切り替えボタン** — `tabsHtml` の次に `<div class="daily-kind-row no-print">` で［時刻の順］［地点の順］の2つ（`uni-btn daily-sort`、選んでいる方に `active`、`data-sort="time|point"`）。押したら `dailySort` を変えて保存し `renderDailyTable_()`。印刷物の表は並べ替えた順のまま（ボタンは印刷に出さない）。
- [ ] **Step 4: 確かめる** — `node --check`、既存の試験全部。
- [ ] **Step 5: 記録** — `git commit -m "v3.40: 本日に［時刻の順｜地点の順］の切り替え"`

### Task 5: 版を 3.40 に上げ、試験用サーバーと Note20 で確かめる（Claude が行う）

- [ ] **Step 1: 版** — アプリ `#appVersion` とサーバー `APP_VERSION` を `3.40-<今の日時>` にそろえて記録。
- [ ] **Step 2: 点検** — 別の担当（opus）にサーバーとアプリの差分を読んでもらう。指摘を直す。
- [ ] **Step 3: 試験用** — `./gas-push.sh staging "v3.40 試験"`、`STAGE_DIR=<scratchpad>/staging-build ~/bin/labkanri-build-staging.sh --ref <アプリのコミット>`、Note20 に入れる。
- [ ] **Step 4: Note20 で見る**（開発用キー・試験用の2現場）：
  - 現地確認を選ぶと帯が出る／受入にすると消える。
  - 帯の数が「🌱 現地」のリストの採取・現地確認の列と合う（今日の採取が無ければ「まだありません」の文）。
  - ▼で一覧が開き、深度が数字の順。
  - 📋本日で［地点の順］にすると深度が 1.0, 2.0 … の順、［時刻の順］で元に戻る、閉じて開き直しても選んだ方のまま。
  - JS のエラー 0 件（logcat）、最後に `am force-stop com.shast.labkanri2`。
- [ ] **Step 5: 報告** — ユーザーに結果と配信の了承を聞く（配信は了承の後：本線へ→本番 APK→apk-to-drive.sh（3.39→3.40）→gas-push.sh deploy→ping）。
