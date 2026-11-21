# 名前の見出しの地点を読む・並べる（lab-kanri 3.41）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** picker の名前の見出し（`A北1-1`・`B南-1-5`・`Aa2 (2,4,5,6,8)`）の地点を、読み違えずに表・マップ・揃い・並びに出す。今ある現場は今のまま。

**Architecture:** サーバーは `_picker_data` の `site.grid` から対応表（pointNames・axisOrder・rowNames・colNames）を `savedAt` で控えて取り出し、`getSaishuAll`・`getKentaiData`・`getDailyReportData` の答えに `pickerGrid` として付ける。アプリは新しい純粋関数のファイル `assets/pointname.js` の「読み手」（resolver）で地点名を読み、今の8か所の正規表現をこれに置き換える。

**Tech Stack:** GAS（Code_v2.gs・clasp）、WebView の素の JS（license.js・genchi.js と同じ書き方）、node 22（`~/.local/node/bin/node`）の素の assert 試験。

**Spec:** `~/app_dev/lab-kanri/docs/superpowers/specs/2026-11-21-named-headers-design.md`（依頼の原文＝`~/app_dev/shast-picker-pro/docs/依頼/2026-11-21_lab-kanri_名前のついた行・列（名前の見出し）.md`）

## Global Constraints
- 版は 3.41（アプリ `#appVersion` とサーバー `APP_VERSION` を同じ `3.41-YYYYMMDD.HHMM`）。
- 表の無い現場（`pickerGrid` が `null`）は、読み方・並び・表・揃いを今と同じにする。例外は `areaOf` の締め（`^([A-Za-z]+\d+)` の直後が英数字なら区画にしない）だけ。
- 表がある＝`pickerGrid.pointNames` があるとき。`{error}` のときは表なしの読み手＋画面に「地点名の対応表を読めませんでした（名前の付いた地点は表に出ていません）」。
- 大文字小文字はそのまま比べる（`Aa` と `AA` は別）。地点名をハイフンで切って親と枝番に分けない（`B南-1-5` の親は `B南-1`）。
- 中の番号（901〜・ZZA〜）を画面・ラベル・読み上げ・履歴に出さない。
- 枝番は 1〜9 の数字1つ。後ろの印は今と同じ（英字1つ（配管の `h` など）と ①〜⑨ の組み合わせ：`[A-Za-z]?[①-⑨]?`）。
- 読み上げは今の規則のまま（ハイフンは「の」。2026-11-22 ユーザー決定）。
- 既存の試験を壊さない：サーバー `test/license.test.js`(598)・`test/saishu.test.js`(8)、アプリ `test/genchi-js.test.js`(17)・`license-js`(75)・`history-js`(13)・`key-boxes`。

## Review Focus
- 表のある現場で、表に無い地点名（picker が後で足した・手で打った）が来た → 表から消えるだけで、ほかの区画と読み違えない。Task 2 の試験で押さえる。
- `pickerGrid` を受け取る前に表や揃いを作ってしまう（読み込みの順番）→ 3つの答えのどれでも、表を作る前に読み手を作り直す。Task 4 の手順で押さえる。
- 現場を切り替えたのに前の現場の読み手が残る → `resetSiteCaches_` で読み手を表なしに戻す。Task 4 で押さえる。
- `_picker_data` の chunks が meta の数より少ない・つないだ長さが length と違う → `{error}`（途中までの JSON を読まない）。Task 1 の試験で押さえる。
- 対応表が 100KB を超える大きな現場 → 控えずに毎回読む（落ちない）。Task 1 の試験で押さえる。

---

### Task 1: サーバー：対応表を取り出して3つの答えに付ける

**Files:**
- Modify: `~/app_dev/lab-kanri/Code_v2.gs`（`getSaishuAll`・`getKentaiData`（2168行の return）・`getDailyReportData`（2017行付近の return））
- Create: `~/app_dev/lab-kanri/test/pickergrid.test.js`

**Interfaces:**
- Produces: `readPickerGrid_(ss) -> null | {pointNames, axisOrder, rowNames, colNames} | {error: string}`（rowNames・colNames・axisOrder は無ければ `{}`／`{cols:[],rows:[]}`）。3つの答えの `pickerGrid`（読めないときも答え全体は今までどおり ok）。
- 控え：CacheService キー `'lk_grid_' + ss.getId()`、値 `JSON.stringify({savedAt, grid})`（grid は上の3通りのどれか）、寿命 21600 秒。値が 100KB（`100*1024` バイト）を超えるなら put しない。

- [ ] **Step 1: 試験を書く**（harness の Book で `_picker_data` タブを作る。A1 `__PICKER_V1__`、A2 meta、A3〜 JSON を分けた文字列）
  - `grid_reads_chunked`：`{site:{grid:{pointNames:{A901:'A北1'},axisOrder:{cols:['A'],rows:['901']},rowNames:{'901':'北1'},colNames:{}}}}` を3つに分けて置く → `readPickerGrid_` が4項目を返す。
  - `grid_cached_by_savedAt`：2回目は `getRange` で A2 だけ読む（A3 以降を読まない＝呼び出し回数か読んだ範囲で確かめる）。A2 の savedAt を変えると読み直す。
  - `grid_null_cases`：タブ無し → `null`、`site.grid` に `pointNames` 無し → `null`。
  - `grid_error_cases`：JSON が壊れている → `{error}`、chunks が meta より少ない／つないだ長さが length と違う → `{error}`。A1 が `__PICKER_V1__` でない → `null`。
  - `grid_too_big_not_cached`：pointNames を 120KB ぶん → 返す・`lk_grid_` を put しない。
  - `answers_carry_pickerGrid`：`getSaishuAll`・`getKentaiData`（分析検体タブのある最小の本）・`getDailyReportData` の答えに `pickerGrid` がある（無い本は `null`）。
- [ ] **Step 2: 失敗を確かめる** — `~/.local/node/bin/node test/pickergrid.test.js` → readPickerGrid_ が無くて NG。
- [ ] **Step 3: 作る** — `readPickerGrid_(ss)` を `readDepthDone_` の近くに。A2 を読み、控えの savedAt と同じなら控えの grid を返す。違えば A3〜A(2+chunks) を `getValues()` で読み、つないで長さを確かめ、JSON.parse → `site.grid`。3つの答えの return に `pickerGrid: readPickerGrid_(ss)`。
- [ ] **Step 4: 通ることを確かめる** — pickergrid・saishu・license の3つ全部 OK。
- [ ] **Step 5: 記録** — `git commit -m "v3.41: _picker_data の対応表（pickerGrid）を savedAt で控えて3つの答えに付ける"`

### Task 2: アプリ：pointname.js（地点名の読み手）

**Files:**
- Create: `~/app_dev/lab-kanri-android/app/src/main/assets/pointname.js`
- Create: `~/app_dev/lab-kanri-android/test/pointname-js.test.js`

**Interfaces:**
- Produces（`window.PointName` と `module.exports`）：`resolver(pickerGrid) -> R`。R は
  - `hasTable: boolean`（pointNames があるか）、`error: string`（`{error}` のときその文・ほかは `''`）
  - `parse(chiten: string) -> {area, item, suffix} | null`
  - `areaOf(text: string) -> string`（区画のキー。無ければ `''`）
  - `compareArea(a: string, b: string) -> number`
  - `mapAxes(areaKeys: string[]) -> {cols: {key,label}[], rows: {key,label}[], cell(colKey, rowKey) -> string}`（cell は区画のキーか `''`）
- 区画のキー：表あり＝親の地点名（`pointNames` の値。例 `B南-1`）、表なし＝今の区画コード（`A1`）。

当て方（表あり）：`pointNames` の値（親の名前）を長い順に並べ、地点名がその名前で始まり、残りが `parse` なら `^-(\d)([A-Za-z]?[①-⑨]?)$`（数字は 1〜9）、`areaOf` なら「空・空白・`(`・`（`・`-`」で始まるものの最初を採る。並びと見出しは `axisOrder.cols`（英字の側の中の番号）×`axisOrder.rows`（数字の側の中の番号）で、親の名前＝`pointNames[col+row]`、見出しの文字＝`colNames[col] || col`／`rowNames[row] || row`。

- [ ] **Step 1: 試験を書く**（依頼の見本の grid をそのまま使う：`pointNames` 15件・`axisOrder {cols:[A,ZZA,B], rows:[901,1,2,3,902]}`・`rowNames {901:北1, 902:南-1}`・`colNames {ZZA:Aa}`）
  - parse 表あり：`A北1-1→{A北1,1,''}`・`Aa1-1→{Aa1,1,''}`・`B南-1-5→{B南-1,5,''}`・`A北1-5h→{A北1,5,'h'}`・`A北1-2①→{A北1,2,'①'}`・`A3-9→{A3,9,''}`・`A北1-10→null`・`X9-1→null`（表に無い）・`AA1-1→null`（大文字違い）。
  - 取り違え：表に `A1` と `A1N`、`Aa1` と `Aa11` がある grid で `A1N-2→A1N`・`A1-2→A1`・`Aa11-3→Aa11`・`Aa1-3→Aa1`。
  - 縦が先／ハイフン：`{pointNames:{A901:'北1A', B902:'南-1-B'}}` で `北1A-1→北1A`・`南-1-B-5→{南-1-B,5}`。名前の列 `{pointNames:{ZZA1:'北1'}}` で `北1-1→北1`。
  - areaOf 表あり：`Aa2 (2,4,5,6,8)→Aa2`・`A北1-1→A北1`・`B南-1-5→B南-1`・`A北1-5h 3.00-3.50m→A北1`・`A1N (2,4)→''`（見本の表に A1N は無い）。
  - areaOf 表なし：`A1 (2,4,5)→A1`・`A1-1→A1`・`K7-2h 3.00-3.50m→K7`・`A1N (2,4)→''`・`北1 (2)→''`。
  - parse 表なし：今の正規表現と同じ結果（`D6-1h①→{D6,1,'h①'}`・`A北1-1→null`・`A1-10→null`）。
  - compareArea 表あり：`[B南-1, A1, Aa北1, A北1, Aa1]` を並べると `[A北1, A1, Aa北1, Aa1, B南-1]`（英字の側 → 数字の側）。表に無いキーは後ろ。表なし：`[B2, A10, A2]→[A2, A10, B2]`（今と同じ）。
  - mapAxes 表あり：cols のラベル `[A, Aa, B]`・rows のラベル `[北1,1,2,3,南-1]`・`cell('ZZA','902')→'Aa南-1'`・901/ZZA の文字がラベルに無い。表なし：区画キー `[B1, A2, A1]` → cols `[A,B]`・rows `[1,2]`・`cell('A','2')→'A2'`。
  - `{error:'x'}`：hasTable false・error 'x'・parse は表なしと同じ。`null`・`undefined` も表なし。
- [ ] **Step 2: 失敗を確かめる** — `node test/pointname-js.test.js` → モジュールが無くて NG。
- [ ] **Step 3: 作る** — `pointname.js`。表なしの parse は今の `parsePointFull` の正規表現をそのまま写す。表なしの mapAxes は今の `renderSaishuMap` の分け方（英字は文字の順、数字は数の順）。
- [ ] **Step 4: 通ることを確かめる** — `node test/pointname-js.test.js` 全件 OK。
- [ ] **Step 5: 記録** — `git commit -m "v3.41: pointname.js（名前の見出しの地点の読み手）"`

### Task 3: アプリ：genchi.js の並びを読み手に合わせる

**Files:**
- Modify: `~/app_dev/lab-kanri-android/app/src/main/assets/genchi.js`
- Modify: `~/app_dev/lab-kanri-android/test/genchi-js.test.js`

**Interfaces:**
- Consumes: Task 2 の `R.compareArea`。
- Produces: `computeRemaining(kinds, depthDone, todayKey, opts)`・`dailyOrder(rows, kinds, opts)`。`opts.compareArea(a,b)` があれば地点（親の名前で比べたいので、地点名のうち枝番より前＝`opts.areaOf(point) || point`）の比べ方に使う。`opts` が無ければ今と同じ。

- [ ] **Step 1: 試験を足す** — 表ありの読み手（Task 2 の見本 grid）を opts に渡すと、残りの一覧が `A北1-1, A1-1, Aa北1-2, Aa1-1, B南-1-5` の順。dailyOrder も同じ順。opts 無しは今の17件がそのまま通る。
- [ ] **Step 2: 失敗を確かめる** → 並びが違って NG。
- [ ] **Step 3: 作る** — compareItems と dailyOrder の地点の比べ方を、opts があれば `opts.compareArea(areaOf(a), areaOf(b))` → 同じなら今の comparePoint（枝番の数の順）にする。
- [ ] **Step 4: 確かめる** — genchi-js 全件 OK（今の17件＋新しい分）。
- [ ] **Step 5: 記録** — `git commit -m "v3.41: 残りの一覧と本日の地点の順を名前の見出しの並びに"`

### Task 4: アプリ：index.html を読み手に切り替える

**Files:**
- Modify: `~/app_dev/lab-kanri-android/app/src/main/assets/index.html`

**Interfaces:**
- Consumes: Task 1 の `pickerGrid`、Task 2 の `PointName.resolver`、Task 3 の opts。

- [ ] **Step 1: 読み込み** — `<script src="pointname.js"></script>` を genchi.js の前に。
- [ ] **Step 2: 読み手の持ち方** — `let pointR = PointName.resolver(null); let pointRSheet = '';` と `setPickerGrid_(sheetId, grid)`（そのシートの答えのときだけ作り直す。`grid === undefined`＝古いサーバーなら変えない）。`resetSiteCaches_` で表なしに戻す。`getSaishuAll`（現地の画面 4924行付近・検体の画面の pAll・残りの帯 `loadGenchiBand_`）・`getKentaiData`（pKentai）・`getDailyReportData`（5943行）の成功で、**表や揃いを作る前に** `setPickerGrid_` を呼ぶ。
- [ ] **Step 3: 8か所を置き換える**
  - `parsePointFull(chiten)` → `return pointR.parse(chiten)`（関数は残して中身だけ）。
  - `kentaiRowKinds` の `areaCodeMatch`・揃いの `acm`・区画コードの `areaCodeMatch` → `pointR.areaOf(...)`（空なら今の「一致なし」と同じ扱い）。
  - `parseScheduledNums` の単体地点（括弧の無い形）：表ありなら `pointR.parse(norm)` の item と suffix を使う（`-(\d)` の末尾は使わない）。表なしは今のまま。
  - `renderSaishuMap` の見出しとマス → `pointR.mapAxes(Array.from(saishuAreaMap.keys()))`。`saishuAxesSwapped` のときは cols と rows を入れ替える。見出しの文字は label。
  - 区画の並び（`areaCodes.sort`）・一覧の並び（`pointSortKey_` を使う sort）→ 表ありは `pointR.compareArea`（同じ区画は枝番の数 → 上下）、表なしは今の比べ方そのまま。
  - genchi の呼び出し（`computeRemaining`・`dailyOrder`）に `{ compareArea: pointR.compareArea, areaOf: pointR.areaOf }` を渡すのは表ありのときだけ。
- [ ] **Step 4: 読めないときの知らせ** — `pointR.error` があれば、現地・検体・本日の画面の上に「地点名の対応表を読めませんでした（名前の付いた地点は表に出ていません）」。
- [ ] **Step 5: 確かめる** — インラインの script を `node --check`、アプリの試験全部。
- [ ] **Step 6: 記録** — `git commit -m "v3.41: 地点名を読み手（pointname.js）で読む・名前の見出しの表・マップ・並び"`

### Task 5: 版・点検・試験用サーバーと Note20（Claude が行う）

- [ ] **Step 1: 版** — 3.41 に上げて両方を記録。
- [ ] **Step 2: 点検** — 別の担当（opus）にサーバーとアプリの差分を見てもらい、指摘を直す（重大・中は試験を先に書いてから）。
- [ ] **Step 3: 試験用の写し** — 見本のシート `1ioSKpCneF9plcDmRlNzBlveTM_zC2UcTTaSyJDXs-x0`（デモ会社）の写しを、自社テスト（開発用キーの会社）の「現場シート」フォルダに作る（Drive のサーバー内コピー。`_picker_data` も一緒に写る）。開発用キーの listSites に出ることを確かめる。元の見本には触らない。
- [ ] **Step 4: 試験用サーバー** — `./gas-push.sh staging`、`labkanri-build-staging.sh --ref <アプリのコミット>`、Note20 へ。
- [ ] **Step 5: Note20 で見る**（写しのシートで）：
  - 受入・現地の 1〜9 マスの表に `A北1`・`Aa北1`・`Aa1`・`Aa2`・`B南-1` の行、`A北1-1` が `A北1` の 1、`B南-1-5` が `B南-1` の 5。
  - 採取マップの見出し `A・Aa・B` ／ `北1・1・2・3・南-1` の順、901・ZZA・AA が出ない。
  - 分析検体の `Aa2 (…)` の揃いがその区画の受入で決まる。配管 `A北1-5h`・深度 `Aa北1-7`・`B南-1-7` も。
  - 本日の地点の順・残りの帯の並びが見出しの順。ラベル・履歴に 901・ZZA が出ない。読み上げの文（`speakTextFromResult_`）を WebView の中で呼んで、`B南-1-5` が「ビー南のイチのゴ」の形になる。
  - 今ある現場（旧畜産の写し・深度VOC）の表・マップ・並び・揃いが 3.40 と同じ（画面の文字を 3.40 と比べる）。
  - JS エラー 0・force-stop。
- [ ] **Step 6: 報告** — 結果と配信の了承を聞く。配信の後、picker セッションに版と時期を知らせる文を用意する。
