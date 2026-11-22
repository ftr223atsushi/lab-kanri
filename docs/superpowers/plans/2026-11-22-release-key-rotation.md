# lab-kanri を専用の正式な鍵へ（鍵の引き継ぎ）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lab-kanri を開発用の鍵（CN=Android Debug）から専用の正式な鍵へ、アンインストールなしの上書き更新で替え、本番用の作り（debuggable でない）で 3.41 を配れるようにする。

**Architecture:** 新しい鍵と「古い鍵が新しい鍵を認める」証明（lineage）を母艦の `~/app_dev/shast-keys/` に置き、`assembleRelease` の未署名の APK に `~/bin/labkanri-sign.sh` で v3 方式（`--rotation-min-sdk-version 28`）の署名をかける。試験版も本番も同じ署名の道具を通す。

**Tech Stack:** Android Gradle（Kotlin DSL）、JDK keytool、Android build-tools（zipalign・apksigner・aapt）、bash。

**Spec:** `~/app_dev/lab-kanri/docs/superpowers/specs/2026-11-22-release-key-rotation-design.md`（試しの記録＝`~/app_dev/_records/playprotect-2026-11/notes.md`）

## Global Constraints
- 鍵：`~/app_dev/shast-keys/labkanri-release.jks`（RSA 4096・有効期間 10950 日・別名 `labkanri`・名義 `CN=lab-kanri, O=Tanaka App Development, C=JP`）、証明 `~/app_dev/shast-keys/labkanri-lineage.bin`、パスワード `~/app_dev/shast-keys/labkanri-keystore.properties`（`storePassword`・`keyAlias`・`keyPassword`）。リポジトリには入れない。
- 古い鍵：`~/.android/debug.keystore`（パスワード `android`・別名 `androiddebugkey`・SHA-256 `89:C9:21:ED:…:E2:E9`）。消さない・書き換えない。
- 署名：`apksigner sign --ks 古い鍵 --next-signer --ks 新しい鍵 --lineage <lineage> --rotation-min-sdk-version 28`。v2＝古い鍵・v3＝新しい鍵。
- アンインストールしない（ラボの端末も Note20 も）。仮想スマホだけは試験で入れ直してよい。
- 一度新しい署名を入れた端末には、開発用の鍵だけの版は入らない。以後の試験版も本番もすべて新しい署名。
- 控え：ドライブ `gdrive:00_管理/鍵/` に3つ（jks・lineage・properties）。md5 が母艦と一致することを確かめてから配る。パスワードは紙にも（家のプリンターで刷る）。
- versionCode は 2 のまま（今までどおり。同じ versionCode の上書きは通る）。
- 試験版だけ WebView の開発者用の接続を有効にする（`assets/staging.flag` があるとき）。本番の APK には入れない。

## Review Focus
- 鍵のパスワードや鍵のファイルが git・ログ・画面に出る → 道具は properties から読み、表示しない。Task 2 で押さえる（`git status` と出力の目視）。
- 本番の APK に `staging.flag` が入ってしまう → 本番の作り方で入っていないことを確かめる。Task 3 で押さえる（`unzip -l` で無いこと）。
- 新しい署名の版を入れたあと、ライセンスキー・最近のスキャン（localStorage）が消える → Task 4 の Note20 で、入れる前と後の画面を比べる。
- 控えから鍵を戻したら同じ署名にならない（控えが壊れている）→ Task 2 の最後に、ドライブから取り戻した鍵で署名して証明書の指紋が同じことを確かめる。
- アプリの中の「⬇ 更新」（PackageInstaller の session）で新しい署名の版が入らない → Task 4 で、端末の中のファイルからの `pm install` で確かめる（同じ PackageManager の確かめ方を通る）。

---

### Task 1: 署名の道具 `~/bin/labkanri-sign.sh`（使い捨ての鍵で試験）

**Files:**
- Create: `~/bin/labkanri-sign.sh`
- Create: `~/bin/labkanri-sign-test.sh`

**Interfaces:**
- Produces: `labkanri-sign.sh <入力の未署名APK> <出力APK>`。鍵の場所は環境変数 `LK_KEYS_DIR`（既定 `~/app_dev/shast-keys`）、古い鍵は `LK_OLD_KS`（既定 `~/.android/debug.keystore`）。終了コード 0＝署名と確かめが全部通った。
  確かめること：`apksigner verify -v` で v2・v3 が true、`--print-certs` の証明書の SHA-256 が新しい鍵、`aapt dump badging` に `application-debuggable` が無い。最後に1行 `✔ 署名OK：<新しい鍵の SHA-256 先頭16字>／debuggable なし／<出力>`。パスワードは表示しない。

- [ ] **Step 1: 試験を書く** — `labkanri-sign-test.sh`：scratchpad に使い捨ての鍵（`CN=throwaway-test`）と lineage を作り `LK_KEYS_DIR` に置く → Note20 で使った試験版の APK（debuggable つき）を入れると **失敗**（debuggable があるので）、`assembleRelease` の未署名 APK を入れると **成功**、出力の v3 の証明書が使い捨ての鍵、v2 が開発用の鍵（`apksigner verify --print-certs --min-sdk-version 26` の Signer と、`--min-sdk-version 28` の Signer が違う）。
- [ ] **Step 2: 失敗を確かめる** — 道具が無いので NG。
- [ ] **Step 3: 作る** — zipalign（4・`-p`）→ apksigner sign（上の Global Constraints の引数・パスワードは `pass:` でなく `file:` か環境変数で渡し、ps に出さない）→ 確かめ。
- [ ] **Step 4: 通ることを確かめる** — `labkanri-sign-test.sh` が全部 OK。
- [ ] **Step 5: 記録** — ~/bin は git 管理外。進み具合の記録に書く。

### Task 2: 本物の鍵・証明・控え・紙（Claude が行う・取り返しがつかない作業は1回だけ）

**Files:**
- Create: `~/app_dev/shast-keys/labkanri-release.jks`・`labkanri-lineage.bin`・`labkanri-keystore.properties`
- Create: `~/app_dev/_records/playprotect-2026-11/鍵のパスワード（紙用）.html`（刷ったら消す）

- [ ] **Step 1: 鍵を作る** — パスワードは `openssl rand -base64 18` の英数字（紙に書き写しやすいよう、紛らわしい文字 `0O1lI` を除いた 20 字）。keytool で Global Constraints どおりに作る。properties は 600。
- [ ] **Step 2: 証明を作る** — `apksigner rotate --out labkanri-lineage.bin --old-signer（開発用の鍵）--new-signer（新しい鍵）`。`apksigner lineage --in … --print-certs` で2つ並ぶことを確かめる。
- [ ] **Step 3: 控え** — `rclone copy` で `gdrive:00_管理/鍵/` へ3つ。`rclone md5sum` と `md5sum` が一致。
- [ ] **Step 4: 控えが使えることを確かめる** — ドライブから scratchpad に取り戻し、`LK_KEYS_DIR=取り戻した場所` で Task 1 の道具を使い、出来た APK の証明書の SHA-256 が母艦の鍵と同じ。
- [ ] **Step 5: 紙** — パスワード・鍵の指紋（SHA-256）・置き場所・「なくすと二度と更新できない」の一文を A4 1枚の HTML にして、家のプリンター（`lp`）で刷る。刷ったら HTML を消す。ユーザーに「刷れたか・どこにしまったか」を聞く。
- [ ] **Step 6: 記録** — 進み具合の記録（パスワードは書かない）。

### Task 3: 本番用の作り＋試験版だけ開発者用の接続

**Files:**
- Modify: `~/app_dev/lab-kanri-android/app/src/main/java/com/shast/labkanri/MainActivity.kt`（WebView を作るところ）
- Modify: `~/bin/labkanri-build-staging.sh`（`assembleDebug` → `assembleRelease`・`staging.flag` を置く・`labkanri-sign.sh` で署名）
- Create: `~/bin/labkanri-build-release.sh`（本番：`assembleRelease` → `labkanri-sign.sh` → `~/app_dev/_records/lab-kanri-<版>/apk/shast-LAB2-<版>.apk`。`staging.flag` が無いこと・本番の GAS の ID が1つ・試験用の ID が0・「試験版」の字が0 を確かめる）

**Interfaces:**
- Consumes: Task 1 の `labkanri-sign.sh`、Task 2 の鍵。

- [ ] **Step 1: 試験版のときだけ接続を有効に** — MainActivity の onCreate で `assets.list("")` に `staging.flag` があれば `WebView.setWebContentsDebuggingEnabled(true)`。
- [ ] **Step 2: 道具を直す／作る** — 上の Files のとおり。
- [ ] **Step 3: 確かめる** — 試験版：`staging.flag` あり・署名OK・debuggable なし。本番：`staging.flag` なし・署名OK・debuggable なし・GAS の ID の確かめが通る（どちらも作るだけ。入れない）。
- [ ] **Step 4: 記録** — `git commit -m "v3.41: 本番用の作り（debuggable なし）・試験版だけ WebView の開発者用の接続"`（MainActivity.kt）。

### Task 4: 確かめ（仮想スマホ → Note20）

- [ ] **Step 1: 仮想スマホ（vfire11＝Android 11・vtab8＝Android 14）** — 入れ直してから本番 3.40 を入れ、目印を置く → 本物の鍵の試験版 3.41 を `pm install -r`（端末の中のファイルから）→ 入る・目印が残る・今の鍵が新しい鍵（`dumpsys package` の signatures）→ もう一度入る → 開発用の鍵だけの版は入らない。
- [ ] **Step 2: Note20（Android 13・今は開発用の鍵の 3.41 試験版）** — 入れる前の画面（版・現場・ライセンス・最近のスキャンの件数）を控える → 本物の鍵の 3.41 試験版を `pm install -r` → 同じ画面が出る（キーの登録画面が出ない・件数が同じ）・WebView の開発者用の接続がつながる・`dumpsys package` で新しい鍵。
- [ ] **Step 3: Play プロテクト** — Note20 のログ（Finsky VerifyApps）の判定。「スキャンしますか」や「有害」が出るか。
- [ ] **Step 4: 片付け** — 仮想スマホを止める・Note20 は force-stop。結果を記録。

### Task 5: 報告と配信の相談
- [ ] 結果（とくに Play プロテクトの判定）を報告し、3.41 の配信（本番の作り方で作る → apk-to-drive.sh → gas-push.sh deploy）の了承を聞く。
- [ ] 配信の手順書（ref）と次回メモ・ノートPC予備の手順（鍵2つ→3つ）を書き直す。
