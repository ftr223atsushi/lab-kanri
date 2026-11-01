# lab-kanri ライセンス 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lab-kanri を、台帳に登録した会社キーを持つ端末だけが、その会社の共有ドライブ直下「現場シート」フォルダのシートだけを開ける状態にする（3.35）。

**Architecture:** 判定は今の lab-kanri GAS の新ファイル `License.gs`（`license_` 関数群）に置き、`Code_v2.gs` の doPost 入口で呼ぶ。台帳（shastライセンス管理）を読み、写しをスクリプトのプロパティに残す。書き込みはシートごとの札（CacheService＋一瞬の ScriptLock）で順番待ち。アプリは端末番号とキーを全呼び出しに付け、新ファイル `assets/license.js` に画面を置く。

**Tech Stack:** Google Apps Script（V8・Drive 高度なサービス v3）／Android WebView（Kotlin `MainActivity.kt`＋`assets/index.html`）／試験は Node（`~/.local/node/bin/node`）の vm 模擬。

**Spec:** `~/app_dev/lab-kanri/SPEC_license.md`（2026-11-01 承認）。経緯は メモリ `handover_lab_kanri_license.md`。

## Global Constraints

- 版の文字列は APK `index.html` の `appVersion` と GAS `APP_VERSION` を同じにする：`3.35-YYYYMMDD.HHMM`（最後の配信で確定）。
- 台帳 ID `1Jw5RwIFseRFZUOaLo90bg2pHRcvN4VLBbJrH7MDMjQ0`。新しいタブは**一番右**に足す。
- キーの形 `LAB-XXXX-XXXX`、文字は `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`。
- 台数上限：空＝5、0＝無制限。猶予期限の行が無い・空＝猶予中。
- キャッシュ：台帳5分・フォルダID6時間・「中にある」6時間（「外」は覚えない）・利用タブの書き直し1台1時間・台帳の写しは24時間まで使う。
- 札：キー `lk_<シートID>`／`lk_ledger`、寿命30秒、待ちは0.2秒ごと最長30秒、ScriptLock は最長5秒。
- 断りの文（画面にそのまま出る。一字一句このとおり）：
  - no_key：`ライセンスキーが登録されていません。画面上の「⬇ 更新」でアプリを更新してから、キーを登録してください`
  - unknown_key：`このライセンスキーは登録されていません`
  - suspended：`このライセンスキーは停止されています。販売元にご連絡ください`
  - expired：`ライセンスの期限（YYYY/MM/DD）が過ぎています。販売元にご連絡ください`
  - no_device：`端末の番号が取れません。アプリを更新してください`
  - too_many：`この会社の登録台数（N台）を超えています。販売元にご連絡ください`
  - no_folder：`現場シートフォルダが見つかりません。販売元にご連絡ください`
  - two_folders：`『現場シート』フォルダが2つあります。販売元にご連絡ください`
  - outside：`このシートは、この会社の現場シートの置き場所にありません`
  - ledger_unavailable：`ライセンスを確認できませんでした。少し待ってからもう一度読んでください（記録はされていません）`
  - busy：`サーバーが混み合っています。少し待ってからもう一度読んでください（記録はされていません）`
- 顧客の共有ドライブの中身は読むだけ（CLAUDE.md）。試験の書き込みは shast_自社テスト と 自社のマイドライブだけ。
- ビルドは母艦の debug.keystore だけ。実機は Note20 だけ（AGM・303・707 は配信まで触らない）。実機の後は force-stop。
- 配信の掟：APK をドライブに置いてから GAS。GAS は「書き込み → 田中が許可 → 公開」。
- ダイアログ内の `<label>` は `.modal label.xxx` で見た目を指定する。
- **ビルド・インストールの前に、そのタスクのレビューが通っていること**（ユーザー指示：いきなりビルドしない）。

## Review Focus

1. 台帳がスキャンの途中で読めなくなる → 写し（24時間以内）で今までどおり通る。Task 2 の `ledger_snapshot_used_when_open_fails` で確かめる。
2. 端末でアプリのデータを消してから登録し直す → 同じ端末番号なので枠を増やさない。Task 4 の `same_device_rereg_no_new_row` で確かめる。
3. キーを小文字・空白入り・ハイフン無しで打つ → `LAB-XXXX-XXXX` にそろう。Task 2 の `normalize_key_variants`（GAS）と Task 8 の `normalizeKey` 試験（APK）で確かめる。
4. 「外」だったシートを「現場シート」に移した直後 → すぐ開ける（「外」は覚えない）。Task 5 の `outside_not_cached` で確かめる。
5. 設定タブの猶予期限の行を誤って消す → 猶予中として止めない。Task 2 の `grace_missing_row_is_grace` で確かめる。

---

## ファイル構成

| ファイル | 役目 |
|---|---|
| `lab-kanri/License.gs`（新） | 台帳の読み込みと写し・猶予・キー判定・端末登録・フォルダとシートの所属・一覧・シートの札・入口の判定（`license_gate_`） |
| `lab-kanri/Code_v2.gs` | doPost に判定と札を差し込む。`checkLicense`・`listSites` を受ける |
| `lab-kanri/appsscript.json` | Drive 高度なサービス v3 を足す |
| `lab-kanri/gas-push.sh` | `License.gs` も「ライセンス.js」として送る。`staging` デプロイ更新に対応 |
| `lab-kanri/test/harness.js`（新） | Apps Script の模擬（openById・CacheService・PropertiesService・LockService・Drive.Files・Utilities・ContentService・時計） |
| `lab-kanri/test/license.test.js`（新） | License.gs と doPost の試験 |
| `lab-kanri-android/.../MainActivity.kt` | 橋渡しに `getDeviceId()`・`getDeviceName()` |
| `lab-kanri-android/.../assets/license.js`（新） | キーの保存・正規化・判定の呼び出し・帯・キー登録・版の表示・会社の現場一覧 |
| `lab-kanri-android/.../assets/index.html` | 呼び出し表と送信部分・`license.js` 読み込み・スキャン経路と現場切替への差し込み・版の表示 |
| `lab-kanri-android/test/license-js.test.js`（新） | license.js の純粋な関数の試験（node） |
| `~/bin/labkanri-license-ledger.py`（新） | 台帳のタブ・見出しメモ・設定の行・会社タブと会社カードの欄を作る（`--mock` で見本シートに、`--commit` で本番） |
| `~/bin/labkanri-license-key.py`（新） | キーを作って lab-kanri タブに書く |
| `~/bin/labkanri-grace-set.py`（新） | 設定タブの猶予期限に「今日＋14日」（または指定日）を書いて読み直す |
| `~/bin/labkanri-concurrency-test.sh` | 2シート同時・キー付きに対応 |
| `~/bin/labkanri-build-staging.sh`（新） | GAS_URL を試験用デプロイに差し替えた試験用 APK を一時フォルダで作る（本物のツリーは触らない） |

---

### Task 1: GAS の模擬試験の土台と License.gs の枠

**Files:**
- Create: `lab-kanri/License.gs`, `lab-kanri/test/harness.js`, `lab-kanri/test/license.test.js`
- Modify: `lab-kanri/gas-push.sh`（`cp License.gs clasp-out/ライセンス.js` を足す）

**Interfaces:**
- Produces: `harness.build({ files:['Code_v2.gs','License.gs'], books:{<id>:{<タブ名>:[[...]]}}, drive:{ files:{<id>:{name,mimeType,parents:[...],driveId,trashed}} }, now:<ms> })` → `{ ctx, books, cache, props, clock }`。`ctx.doPost({postData:{contents:JSON}})` が使える。`clock.advance(ms)`、`Utilities.sleep(ms)` は時計を進める。`harness.post(h, obj)` → 応答の JSON。
- Produces: `License.gs` に `const LICENSE_LEDGER_ID = '1Jw5RwIFseRFZUOaLo90bg2pHRcvN4VLBbJrH7MDMjQ0';` と `LICENSE_MSG_`（Global Constraints の文を reason→文の対応で）。

- [ ] **Step 1: 試験 `ping_still_works` を書く**（doPost に `{action:'ping'}` → `ok===true`・`version===APP_VERSION`）
- [ ] **Step 2: 走らせて失敗を確かめる** — `cd ~/app_dev/lab-kanri && ~/.local/node/bin/node test/license.test.js` → harness 未作成で失敗
- [ ] **Step 3: harness.js を作る**（shast の `shast-master/gas/test/harness.js` の Sheet/Range を手本に、上の Interfaces の模擬を足す。CacheService は寿命つき Map、LockService は tryLock/waitLock/releaseLock を数える、Drive.Files.list は q の `'<id>' in parents`・`name='…'`・mimeType・trashed だけ解釈）。License.gs に定数だけ置く
- [ ] **Step 4: 走らせて成功を確かめる** → `1 件中 1 件OK`
- [ ] **Step 5: Commit** — `git add License.gs test/ gas-push.sh && git commit -m "license: 模擬試験の土台と License.gs の枠"`

### Task 2: 台帳の読み込み・写し・猶予・キー判定

**Files:** Modify `License.gs`／Test `test/license.test.js`

**Interfaces:**
- Produces: `license_normalizeKey_(s: string) -> string`（`LAB-XXXX-XXXX` か ''）
- Produces: `license_ledger_(now: number) -> {keys:{[key]:{company,conn,status,expires,limit,row}}, drives:{[conn]:driveId}, graceUntil:'YYYY-MM-DD'|'', readAt:number, fromSnapshot:boolean} | null`（読めて写しも24時間超なら null）
- Produces: `license_grace_(ledger, now) -> {inGrace:boolean, daysLeft:number|null}`
- Produces: `license_checkKey_(ledger, key, deviceId, now) -> {ok:true, key, entry} | {ok:false, reason, message}`

- [ ] **Step 1: 試験を書く**
  - `normalize_key_variants`：`'lab7kq2m9xd'`・`' LAB-7KQ2-M9XD '`・`'lab 7kq2 m9xd'` → `'LAB-7KQ2-M9XD'`、`'LAB-7KQ2-M9X'`・`'SHAST-AAAA-BBBB'` → `''`
  - `key_ok`／`key_unknown`／`key_suspended`（状態「停止」）／`key_expired`（期限 2026/11/01・now 11/02 → 文に `2026/11/01`）／`no_device`
  - `limit_blank_is_5`（F列空 → entry.limit===5）・`limit_zero_unlimited`
  - `grace_before`（猶予 2026-11-19・now 11-05 → inGrace・daysLeft 14）／`grace_after`（now 11-20 → !inGrace）／`grace_missing_row_is_grace`（行なし → inGrace・daysLeft null）
  - `ledger_cached_5min`（2回目は openById を呼ばない、5分1秒後は呼ぶ）
  - `ledger_snapshot_used_when_open_fails`（1回読んだ後 openById が例外 → 写しで ok・fromSnapshot）／`ledger_snapshot_too_old`（25時間後に例外 → null）
- [ ] **Step 2: 走らせて失敗を確かめる**
- [ ] **Step 3: 実装** — 台帳の lab-kanri タブ（見出しで列を引く）・設定タブ（A列が `lab-kanri猶予期限` の行の B）・顧客タブ（A=接続先・L=共有ドライブID）を読む。読めたら `PropertiesService` の `LK_LEDGER_SNAPSHOT` に JSON で保存、`CacheService` の `lk_ledger_v1` に5分。
- [ ] **Step 4: 走らせて成功を確かめる**
- [ ] **Step 5: Commit**

### Task 3: シートごとの順番待ち

**Files:** Modify `License.gs`, `Code_v2.gs:410-431`（`WRITE_ACTIONS_`・`withWriteLock_` は setLabelSiteName・addWorker 用に残す）／Test

**Interfaces:**
- Produces: `license_withSheetLock_(lockKey: string, fn: () => any, onBusy: () => any) -> any`（札を立てられたら `fn()` の戻り値、30秒立てられなければ `onBusy()` の戻り値）

- [ ] **Step 1: 試験を書く**
  - `lock_free_runs_once`（fn が1回・札は終わったら消える・flush が呼ばれる）
  - `lock_waits_then_runs`（別の印の札を寿命10秒で置く → 時計が10秒以上進んでから fn）
  - `lock_busy_after_30s`（寿命60秒の札 → onBusy・fn は呼ばれない）
  - `lock_not_removed_if_not_owner`（fn の中で札を別の印に差し替え → 終わっても消さない）
  - `lock_releases_on_throw`（fn が例外 → 札は消える・例外は外へ）
  - `different_sheets_do_not_wait`（`lk_A` に札がある間に `lk_B` は待たずに走る）
- [ ] **Step 2〜4: 失敗 → 実装（SPEC 3-5 の手順。待ちは `Utilities.sleep(200)`）→ 成功**
- [ ] **Step 5: Commit**

### Task 4: 端末の登録（lab-kanri利用タブ）

**Files:** Modify `License.gs`／Test `test/license.test.js`

**Interfaces:**
- Consumes: `license_checkKey_` の entry、Task 3 の `license_withSheetLock_`（札のキー `lk_ledger`）
- Produces: `license_touchDevice_(key, entry, deviceId, deviceName, appVersion, verdict, now) -> {ok:true, used:number, limit:number} | {ok:false, reason:'too_many', message}`

- [ ] **Step 1: 試験を書く**
  - `new_device_adds_row`（A〜I を書く・J は空・E=F=今）
  - `same_device_rereg_no_new_row`（同じキー＋端末番号は行を増やさない）
  - `limit_reached_refuses`（上限2・2台登録済み → 3台目は too_many・文に `2台`・行は増えない）／`limit_zero_never_refuses`
  - `touch_throttled_1h`（同じ端末の2回目は59分後は書かない・61分後は F〜I を書き直す・G が +1）
  - `nickname_column_untouched`（J に「AGM」を入れておき、書き直し後も「AGM」）
- [ ] **Step 2〜4: 失敗 → 実装（利用タブは見出し「キー」「端末ID」で列を引く。無ければタブを作って見出しを書く）→ 成功**
- [ ] **Step 5: Commit**

### Task 5: 「現場シート」フォルダとシートの所属・一覧

**Files:** Modify `License.gs`, `appsscript.json`（`"dependencies":{"enabledAdvancedServices":[{"userSymbol":"Drive","serviceId":"drive","version":"v3"}]}`）／Test

**Interfaces:**
- Produces: `license_siteFolder_(driveId) -> {ok:true, folderId} | {ok:false, reason:'no_folder'|'two_folders'|'ledger_unavailable', message}`
- Produces: `license_sheetAllowed_(spreadsheetId, folderId) -> {ok:true} | {ok:false, reason:'outside'|'ledger_unavailable', message}`
- Produces: `license_listSites_(folderId) -> [{id, name, modified}]`（更新の新しい順・最大100）

- [ ] **Step 1: 試験を書く**
  - `folder_found`（ドライブ直下に「現場シート」1つ）／`folder_missing`／`folder_two`／`folder_nested_ignored`（別フォルダの中の「現場シート」だけ → no_folder）／`folder_cached_6h`
  - `sheet_inside`／`sheet_outside`／`inside_cached_6h`（2回目は Drive.Files.get を呼ばない）／`outside_not_cached`（外 → 中へ移す → 次はすぐ ok）／`trashed_is_outside`
  - `drive_error_with_cache_ok`／`drive_error_without_cache_unavailable`
  - `list_sorted_new_first_max100`（スプレッドシート以外・ゴミ箱は出ない）
- [ ] **Step 2〜4: 失敗 → 実装（Drive.Files.list / get の引数は SPEC 3-2 のとおり）→ 成功**
- [ ] **Step 5: Commit**

### Task 6: 入口の判定と新しい呼び出し

**Files:** Modify `License.gs`, `Code_v2.gs` の `doPost`（433〜451行）／Test

**Interfaces:**
- Consumes: Task 2〜5 の関数（Task 3＝札、Task 4＝端末登録、Task 5＝フォルダ）
- Produces: `license_gate_(action, p, now) -> {allow:true, notice?:{daysLeft}, company?, folderId?} | {allow:false, response:{ok:false, reason, message}}`
- Produces: `license_checkLicenseAction_(p, now) -> {ok, companyName, expires, used, limit, inGrace, daysLeft, reason?, message?}`
- 定数：`LICENSE_SHEET_ACTIONS_`＝handleScan・savePickupExtra・undoRecord・getSpreadsheetMeta・getDailyReportData・listDailyReportDates・getKentaiData・getSaishuAll・getLabelSiteName・setLabelSiteName・getLabelPrinted・markCodeLabelPrinted。`LICENSE_WRITE_ACTIONS_`＝handleScan・savePickupExtra・undoRecord・markCodeLabelPrinted。
- doPost の流れ：`gate = license_gate_` → 拒否なら `respond(gate.response)`／`checkLicense`→`respond(license_checkLicenseAction_)`／`listSites`→`respond({ok:true, company, sites: license_listSites_(folderId)})`／書き込み4種→`license_withSheetLock_('lk_'+p.spreadsheetId, …, () => respond({ok:false, message:busy}))`／setLabelSiteName・addWorker→今の `withWriteLock_`／ほか→`doPostAction_`。キー無し猶予中は応答 JSON に `licenseNotice:{daysLeft}` を足す。

- [ ] **Step 1: 試験を書く**（doPost 経由。`ctx.doPostAction_` を差し替えて「呼ばれたか」を数える）
  - `ping_no_check`・`checkLicense_no_gate`（台帳が読めなくても ping は ok）
  - `no_key_in_grace_passes_any_sheet`（フォルダの外のシートでも通る・`licenseNotice.daysLeft`）／`no_key_after_grace_refused`（文が no_key のとおり）
  - `listSites_requires_key_even_in_grace`
  - `key_ok_inside_passes`／`key_ok_outside_refused`／`key_suspended_refused`／`too_many_refused`
  - `non_sheet_action_skips_folder_check`（getWorkerList はキーだけ確かめる）
  - `checkLicense_returns_company_and_count`（`companyName`・`used`・`limit`・猶予の値）
  - `unknown_action_message_unchanged`（`unknown action: X` のまま＝古い APK と新しい APK の両方が頼る）
- [ ] **Step 2〜4: 失敗 → 実装 → 成功**（`~/.local/node/bin/node test/license.test.js` が全件 OK）
- [ ] **Step 5: 回帰の確認** — 今の `handleScan` などの関数本体には手を入れていないことを `git diff Code_v2.gs` で確かめる（変わるのは doPost と定数だけ）
- [ ] **Step 6: Commit**

### Task 7: 試験用デプロイと GAS への書き込み（本番は変えない）

**Files:** Modify `lab-kanri/gas-push.sh`（`./gas-push.sh staging` で試験用デプロイだけ更新）

- [ ] **Step 1:** `./gas-push.sh`（書き込みだけ）→ `clasp deploy -d "staging"` で試験用デプロイを作り、ID を `gas-push.sh` とメモリ `ref_lab_kanri_test_tools.md` に書く
- [ ] **Step 2:** **田中に GAS エディタで任意の関数を1回実行して「許可」を押してもらう**（Drive 高度なサービスの権限）。案内文は「PCのブラウザで https://script.google.com/ → lab-kanri のプロジェクト → 上の関数の選択で `doGet` → 実行 → 権限を確認 → tnk-app.jp で許可」
- [ ] **Step 3: 確認** — `curl -4 -sL -H 'Content-Type: text/plain' -d '{"action":"ping"}' <試験用URL>` → `"ok":true`。本番 URL の ping は版が 3.34 のまま（本番は変わっていない）
- [ ] **Step 4: Commit**

### Task 8: アプリ：端末番号・キーの保存・全呼び出しへの付加

**Files:**
- Modify: `MainActivity.kt`（`AndroidBarcodeScanBridge` に `@JavascriptInterface fun getDeviceId(): String`＝`Settings.Secure.ANDROID_ID`、`fun getDeviceName(): String`＝`android.os.Build.MODEL`）
- Create: `assets/license.js`, `test/license-js.test.js`
- Modify: `assets/index.html`（`ARG_NAMES` に `'checkLicense': []`・`'listSites': []`、`callGas` で `params.licenseKey/deviceId/deviceName/appVersion` を `window.LabLicense` から付ける、`<script src="license.js">` をメインの script の直前に）

**Interfaces:**
- Produces（license.js・`window.LabLicense`）：`normalizeKey(s) -> string`、`isKeyLike(s) -> boolean`（正規化後に `LAB-` で始まる13文字）、`getKey() -> string`、`setKey(k)`、`deviceId() -> string`、`deviceName() -> string`、`check(cb)`（checkLicense を呼び、`{serverHasLicense:boolean, ...応答}` を cb へ。応答の message が `unknown action` で始まれば `serverHasLicense:false`）
- node 試験のため、license.js の純粋な関数は `if (typeof module !== 'undefined') module.exports = {...}` で出す

- [ ] **Step 1: 試験を書く** — `normalizeKey` の4通り（Review Focus 3）・`isKeyLike('HSSG-L-0001')===false`・`isKeyLike('lab7kq2m9xd')===true`
- [ ] **Step 2〜4: 失敗 → 実装 → 成功**（`~/.local/node/bin/node test/license-js.test.js`）
- [ ] **Step 5: 古い版の呼び出しの確認** — `git show <3.24のコミット>:app/src/main/assets/index.html` の `ARG_NAMES` と今の `ARG_NAMES` を比べ、3.24 が送る action と引数が新しい GAS の doPost でそのまま受かることを表にして記録（3.24 のコミットは `git log --oneline -S "3.24-" -- app/src/main/assets/index.html` で探す）
- [ ] **Step 6: Commit**

### Task 9: アプリ：帯・キー登録・スキャン欄の LAB-・版の表示

**Files:** Modify `assets/license.js`, `assets/index.html`（帯とダイアログの HTML・CSS、`onAndroidPhysicalKey`（3060行付近）と keydown の Enter 経路と `submitFromInput`（2255行）で `LabLicense.isKeyLike` を先に見る、版の表示のタップ）

**Interfaces:**
- Consumes: Task 8 の `LabLicense`
- Produces: `LabLicense.showBanner(daysLeft)`、`LabLicense.openKeyDialog({fullScreen:boolean, prefill?:string})`、`LabLicense.onScanKey(raw) -> boolean`（キーなら確認を出して true＝サーバーへ送らない）、`LabLicense.versionPanelHtml(info) -> string`

- [ ] **Step 1:** 画面は見本（https://claude.ai/artifact/1i2bhWs5hxhTaYXRLMkFHH）の①〜④・⑥のとおりに作る。帯は画面の一番上、更新の帯（#updateBanner・下）とは別の要素。
- [ ] **Step 2:** 起動時に `LabLicense.check` → `serverHasLicense:false` なら何もしない／キーあり有効なら何もしない／キー無し猶予中なら帯／サーバーが `no_key` と答えたら全画面のキー登録（ほかの操作を受け付けない）。**通信失敗では何も出さない**。
- [ ] **Step 3:** キー登録のダイアログが開いている間は、`onAndroidPhysicalKey` と keydown の文字をキー欄へ回す（スキャン欄へ入れない）。Enter で「登録する」。
- [ ] **Step 4:** 「登録する」→ checkLicense（新しいキーで）→ ok なら保存して③の表示、だめなら理由を出し保存しない（前のキーのまま）。版の表示の［キーを変える］も同じ流れ。消すボタンは置かない。
- [ ] **Step 5: ビルド前のレビュー** — ここまでの差分をレビューしてもらう（ユーザー指示）
- [ ] **Step 6: 試験用 APK を作って Note20 に入れる**（Task 11 の `labkanri-build-staging.sh` を先に作る）→ 帯・全画面・カメラ／`~/bin/fake-scanner.sh LAB-…`／手入力・スキャン欄の LAB- ・版の表示を確かめる。スクショは縮小。終わったら force-stop
- [ ] **Step 7: Commit**

### Task 10: アプリ：現場切替の「会社の現場」

**Files:** Modify `assets/license.js`, `assets/index.html`（`renderSiteList_`・`openSiteSwitchModal`（6175行付近）。一覧の行のタップは、保存した現場の行と同じ `getSpreadsheetMeta` → `setCurrentSpreadsheet` → `resetSiteCaches_` の流れを通す）

**Interfaces:**
- Consumes: Task 8 の `LabLicense`、index.html の `setCurrentSpreadsheet(id, name, url)`・`resetSiteCaches_()`
- Produces: `LabLicense.renderCompanySites(container, onPick)`

- [ ] **Step 1:** 見本⑤のとおり：キーのある端末だけ一番上に「会社の現場（会社名）[↻]」・更新の新しい順・`.site-pick` の見た目。
- [ ] **Step 2:** 保存した現場で、開いたときにサーバーが outside または「見つからない」を返したものは、消さずに灰色で「開けません」にする（端末の保存一覧に印を付ける）。
- [ ] **Step 3: ビルド前のレビュー → 試験用 APK を Note20 で確かめる → force-stop**
- [ ] **Step 4: Commit**

### Task 11: 道具（台帳づくり・キー・猶予・同時書き込み・試験用 APK）

**Files:** Create `~/bin/labkanri-license-ledger.py`, `~/bin/labkanri-license-key.py`, `~/bin/labkanri-grace-set.py`, `~/bin/labkanri-build-staging.sh`／Modify `~/bin/labkanri-concurrency-test.sh`

- [ ] **Step 1: 台帳づくり** — `labkanri-ledger-mock.py` の見出し・説明メモをそのまま使い、`--mock`（新しい見本シートに作る）と `--commit`（本番台帳に、一番右へタブを足す・設定タブに行と説明メモ・会社タブ右端の列と式・会社カードの欄）。本番に書く前に、会社タブ・会社カードの今の列と式を読み、どこに足すかを表示して止まる（`--commit --yes` で書く）。
- [ ] **Step 2: 確認** — `--mock` で作ったシートを読み直し、タブ・見出し・メモ・式の結果が見本どおり
- [ ] **Step 3: キー** — `labkanri-license-key.py <会社名> <接続先> [台数上限] [備考]`：キーを作り、既存と重ならないことを確かめ、lab-kanri タブに1行足して読み直す（`--dry-run` あり）
- [ ] **Step 4: 猶予** — `labkanri-grace-set.py [YYYY-MM-DD]`：省略時は今日＋14日。書いて読み直して表示
- [ ] **Step 5: 同時書き込み** — 引数に `--key` と2つ目のシートID、2シート同時に流して、同じシート＝1台だけ記録・違うシート＝待たない（時間を表示）
- [ ] **Step 6: 試験用 APK** — `labkanri-build-staging.sh [--ref <コミット>]`：作業用フォルダ（scratchpad）に lab-kanri-android を `git worktree` で出し（`--ref` で古い版、例 3.34 のコミット）、GAS_URL を試験用デプロイに sed、版の表示に「試験版」を付けて assembleDebug、APK の場所を出す（本物のツリーは触らない）
- [ ] **Step 7: Commit**（`~/bin` のリポジトリ）

### Task 12: 試験用の入口で通しの実機試験（Note20）

- [ ] **Step 1: 台帳の準備（試験）** — `labkanri-license-key.py 自社（開発用） shast-writer 0 開発用 --commit`。※本番の台帳に開発用キーの行が入るが、本番 GAS はまだ読まないので影響なし（台帳のタブが無ければ Task 11 の `--commit --yes` を先に）
- [ ] **Step 2: ①「現場シート」が無い** — 試験用 APK に開発用キー → 現場切替の一覧で no_folder の文
- [ ] **Step 3: ② 田中に依頼**：tnk-app.jp でドライブを開き、shast_自社テスト の一番上に「現場シート」フォルダを作り、TVOC（【テスト】lab-kanri深度VOC…）と 旧畜産研究所…_V2_20260803_2237 の**コピー**をそのフォルダへ入れてもらう → 一覧に2枚 → 選んでスキャン・表・ラベル印刷・日報
- [ ] **Step 4: ③** 「現場シート」をもう1つ作る → two_folders → 2つ目を消す（自社テストなので消してよい）
- [ ] **Step 5:** HSS のシートのID（読むだけ）を URL 欄に入れる → outside の文・何も書かれていない
- [ ] **Step 6: 古い版** — `labkanri-build-staging.sh --ref <3.34のコミット>` の APK を Note20 に入れて：猶予中は今までどおり → `labkanri-grace-set.py <昨日>` → no_key の文 → `labkanri-grace-set.py`（行を消して元に戻す）
- [ ] **Step 7: 同時書き込みと速さ** — `labkanri-concurrency-test.sh` を2シートで。スキャン1回の時間を、本番（3.34・ライセンス無し）と試験用（3.35）で各10回測って平均を表にする
- [ ] **Step 8:** 結果をユーザーに報告（表・スクショ縮小を share-file）。Note20 を force-stop

### Task 13: 配信（ユーザーの合意を取ってから）

- [ ] **Step 1:** 版の文字列を確定（APK と GAS を同じに）→ APK をビルド → `~/bin/apk-to-drive.sh … shast-LAB2-3.34.apk shast-LAB2-3.35.apk`
- [ ] **Step 2:** 台帳：`labkanri-license-ledger.py --commit --yes`（Task 12 で済みなら飛ばす）→ HSS のキー `labkanri-license-key.py HSSエンジニヤリング株式会社 shast-hsseng 5 覚書・社内無償 --commit`
- [ ] **Step 3:** `./gas-push.sh deploy "v3.35"`（権限は Task 7 で許可済み）→ `labkanri-grace-set.py` → 本番 ping が 3.35
- [ ] **Step 4:** HSS への書面通知と配布資料（キーのQR入り・`trial-handout.sh` を参考）、707 用の写真入り手順書を作って share-file
- [ ] **Step 5:** 端末ごとの確認手順を箇条書きで報告（feedback_test_items_after_build）。利用タブを見て、期限までに全端末がそろったか報告する
- [ ] **Step 6: 戻し方の控え** — 公開前の本番デプロイの版番号を `clasp deployments` で控え、引き継ぎ書に「戻すときは `clasp deploy -i <本番ID> -V <控えた番号>`」と書く（APK 3.35 は古いサーバーでも動く＝Task 8）
- [ ] **Step 7:** 設計書・引き継ぎ書・MEMORY.md・次回メモを更新し、両リポジトリを commit & push
