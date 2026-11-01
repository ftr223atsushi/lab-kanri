// ライセンス管理（会社ごとのキー・端末台数・現場シートの置き場所の確認）。
// Code_v2.gs と同じプロジェクトに入る別ファイル（gas-push.sh が「ライセンス.js」として送る）。
// 仕様は SPEC_license.md。台帳（スプレッドシート）の読み書きと、doPost 各処理の入口での確認をここに置く。

// 台帳スプレッドシートのID（全社共通・1冊）
const LICENSE_LEDGER_ID = '1Jw5RwIFseRFZUOaLo90bg2pHRcvN4VLBbJrH7MDMjQ0';

// 断りの文（画面にそのまま出る）。キーは reason。
// expired の YYYY/MM/DD と too_many の N は、呼び出し側で置き換える。
const LICENSE_MSG_ = {
  no_key:             'ライセンスキーが登録されていません。画面上の「⬇ 更新」でアプリを更新してから、キーを登録してください',
  unknown_key:        'このライセンスキーは登録されていません',
  suspended:          'このライセンスキーは停止されています。販売元にご連絡ください',
  expired:            'ライセンスの期限（YYYY/MM/DD）が過ぎています。販売元にご連絡ください',
  no_device:          '端末の番号が取れません。アプリを更新してください',
  too_many:           'この会社の登録台数（N台）を超えています。販売元にご連絡ください',
  no_folder:          '現場シートフォルダが見つかりません。販売元にご連絡ください',
  two_folders:        '『現場シート』フォルダが2つあります。販売元にご連絡ください',
  outside:            'このシートは、この会社の現場シートの置き場所にありません',
  ledger_unavailable: 'ライセンスを確認できませんでした。少し待ってからもう一度読んでください（記録はされていません）',
  busy:               'サーバーが混み合っています。少し待ってからもう一度読んでください（記録はされていません）'
};

// ---- 台帳の読み込み・写し・猶予・キー判定 ----

const LICENSE_KEY_CHARS_ = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 0・O・1・I を除く
const LICENSE_CACHE_KEY_ = 'lk_ledger_v1';                      // 台帳のキャッシュ札
const LICENSE_CACHE_SEC_ = 300;                                 // 台帳は5分
const LICENSE_SNAPSHOT_PROP_ = 'LK_LEDGER_SNAPSHOT';            // 台帳の写し（スクリプトのプロパティ）
const LICENSE_SNAPSHOT_MAX_MS_ = 24 * 3600 * 1000;              // 写しは24時間まで使う
const LICENSE_DEFAULT_LIMIT_ = 5;                               // 台数上限が空のとき

// 入力ゆれをそろえる：大文字・空白とハイフンを除く→ LAB＋8文字(許す文字だけ)なら LAB-XXXX-XXXX、違えば ''
function license_normalizeKey_(s) {
  if (s == null) return '';
  const t = String(s).toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
  const m = t.match(new RegExp('^LAB([' + LICENSE_KEY_CHARS_ + ']{8})$'));
  return m ? 'LAB-' + m[1].slice(0, 4) + '-' + m[1].slice(4) : '';
}

// 日付の文字列を YYYY-MM-DD にそろえる（2027/04/13・2027-4-3 など）。読めなければ ''
function license_ymd_(s) {
  const m = String(s == null ? '' : s).trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return '';
  const mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return m[1] + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// 今日の日付（日本時間）YYYY-MM-DD。「その日の終わりまで有効」は日付の文字列比較で判定する
function license_todayJst_(now) {
  return Utilities.formatDate(new Date(now), 'Asia/Tokyo', 'yyyy-MM-dd');
}

// 2つの YYYY-MM-DD の日数の差（b − a）
function license_dayDiff_(a, b) {
  const t = (x) => { const p = x.split('-'); return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])); };
  return Math.round((t(b) - t(a)) / 86400000);
}

// 見出し名 → 列番号(0始まり)の表。見出しが無ければ -1
function license_cols_(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => { const k = String(h).trim(); if (k && !(k in idx)) idx[k] = i; });
  return (name) => (name in idx ? idx[name] : -1);
}

// 台帳を実際に読む（失敗したら例外）。返すのは写しにも入れる最小限の項目だけ。
function license_readLedger_(now) {
  const book = SpreadsheetApp.openById(LICENSE_LEDGER_ID);
  const keys = {}, drives = {};
  let graceUntil = '';

  const lab = book.getSheetByName('lab-kanri');
  if (!lab) throw new Error('台帳に lab-kanri タブがありません');
  const lv = lab.getDataRange().getDisplayValues();
  const lc = license_cols_(lv[0] || []);
  const cKey = lc('キー'), cCo = lc('会社名'), cConn = lc('接続先'), cSt = lc('状態'), cExp = lc('期限'), cLim = lc('台数上限');
  if (cKey < 0) throw new Error('lab-kanri タブに「キー」の見出しがありません');
  const at = (row, c) => (c < 0 || c >= row.length ? '' : String(row[c]).trim());
  for (let i = 1; i < lv.length; i++) {
    const row = lv[i];
    const key = license_normalizeKey_(at(row, cKey));
    if (!key || keys[key]) continue;   // 形の違う行・同じキーの2行目は無視（先の行が勝つ）
    const st = at(row, cSt);
    const expY = license_ymd_(at(row, cExp));
    const expRaw = at(row, cExp);
    const limRaw = at(row, cLim);
    const lim = limRaw === '' ? LICENSE_DEFAULT_LIMIT_ : parseInt(limRaw, 10);
    keys[key] = {
      company: at(row, cCo),
      conn: at(row, cConn),
      status: (st === '' || st === '有効') ? 'valid' : 'suspended',   // 「停止」も知らない値も止める
      expires: expRaw === '' ? '' : (expY ? expY.replace(/-/g, '/') : expRaw),   // 読めない日付は文字のまま持つ（判定側で止める）
      limit: isNaN(lim) || lim < 0 ? LICENSE_DEFAULT_LIMIT_ : lim,
      row: i + 1
    };
  }

  const set = book.getSheetByName('設定');
  if (set) {
    const sv = set.getDataRange().getDisplayValues();
    for (let i = 0; i < sv.length; i++) {
      if (String(sv[i][0]).trim() === 'lab-kanri猶予期限') { graceUntil = license_ymd_(sv[i][1]); break; }   // 読めない値は空＝猶予中
    }
  }

  const cust = book.getSheetByName('顧客');
  if (cust) {
    const cv = cust.getDataRange().getDisplayValues();
    const cc = license_cols_(cv[0] || []);
    const aConn = cc('接続先'), aDrive = cc('共有ドライブID');
    if (aConn >= 0 && aDrive >= 0) {
      for (let i = 1; i < cv.length; i++) {
        const conn = at(cv[i], aConn), drive = at(cv[i], aDrive);
        if (conn && drive && !(conn in drives)) drives[conn] = drive;
      }
    }
  }
  return { keys: keys, drives: drives, graceUntil: graceUntil, readAt: now, fromSnapshot: false };
}

// 台帳を返す。5分キャッシュ→台帳→(読めなければ)24時間以内の写し→null。
// v3.35: 写しは本物の 9KB/値 の上限に収まる最小限の項目だけにする。保存に失敗しても読み取りは成功とする
function license_ledger_(now) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(LICENSE_CACHE_KEY_);
  if (hit) {
    try { const l = JSON.parse(hit); l.fromSnapshot = false; return l; } catch (e) { /* 壊れていれば読み直す */ }
  }
  try {
    const led = license_readLedger_(now);
    const json = JSON.stringify({ keys: led.keys, drives: led.drives, graceUntil: led.graceUntil, readAt: led.readAt });
    try { cache.put(LICENSE_CACHE_KEY_, json, LICENSE_CACHE_SEC_); } catch (e) { Logger.log('台帳キャッシュ保存失敗: ' + e); }
    try { PropertiesService.getScriptProperties().setProperty(LICENSE_SNAPSHOT_PROP_, json); } catch (e) { Logger.log('台帳の写し保存失敗: ' + e); }
    return led;
  } catch (e) {
    Logger.log('台帳を読めない: ' + e);
    try {
      const snap = JSON.parse(PropertiesService.getScriptProperties().getProperty(LICENSE_SNAPSHOT_PROP_) || 'null');
      if (snap && typeof snap.readAt === 'number' && now - snap.readAt <= LICENSE_SNAPSHOT_MAX_MS_ && snap.keys) {
        snap.fromSnapshot = true;
        return snap;
      }
    } catch (e2) { /* 写しが壊れていれば使わない */ }
    return null;
  }
}

// 猶予中か。猶予期限の日の終わり(日本時間)まで猶予中。行が無い・空・読めない＝猶予中(daysLeft は null)。
// daysLeft は猶予期限の日付 − 今日の日付（猶予明けは負の数）
function license_grace_(ledger, now) {
  const g = ledger && ledger.graceUntil;
  if (!g) return { inGrace: true, daysLeft: null };
  const days = license_dayDiff_(license_todayJst_(now), g);
  return { inGrace: days >= 0, daysLeft: days };
}

// キーの判定。順番：不明→停止→期限切れ→端末なし。通ったら正規化したキーと台帳の行を返す
function license_checkKey_(ledger, key, deviceId, now) {
  const fail = (reason, message) => ({ ok: false, reason: reason, message: message || LICENSE_MSG_[reason] });
  const k = license_normalizeKey_(key);
  const entry = k && ledger && ledger.keys ? ledger.keys[k] : null;
  if (!entry) return fail('unknown_key');
  if (entry.status !== 'valid') return fail('suspended');
  if (entry.expires) {
    const y = license_ymd_(entry.expires);
    // 期限の日の終わり(日本時間)まで有効。読めない日付は止める
    if (!y || license_todayJst_(now) > y) return fail('expired', LICENSE_MSG_.expired.replace('YYYY/MM/DD', entry.expires));
  }
  if (!deviceId) return fail('no_device');
  return { ok: true, key: k, entry: entry };
}

// ---- シートごとの順番待ち（SPEC 3-5）----
// 全社共通の ScriptLock を奪い合うと別々のシートに書く端末まで待つので、シートごとの「札」（CacheService）で待つ。
// 札のキーは lk_<シートID>（台帳への書き込みは lk_ledger）。ScriptLock は札の確認と立てる一瞬だけ使う。
const LICENSE_FLAG_SEC_ = 30;          // 札の寿命(秒)。fn が長引いて切れても、消すのは自分の印のときだけ
const LICENSE_FLAG_WAIT_MS_ = 30000;   // 札が立てられるまで最長30秒待つ
const LICENSE_FLAG_POLL_MS_ = 200;     // 待ちは0.2秒ごと
const LICENSE_SCRIPTLOCK_MS_ = 5000;   // ScriptLock は最長5秒

// lockKey の札を立てて fn() を実行し、戻り値を返す。30秒立てられなければ onBusy() の戻り値を返す（fn は呼ばない）。
// fn が例外を投げても札は消してから例外を外へ出す。
function license_withSheetLock_(lockKey, fn, onBusy) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  const token = Utilities.getUuid();
  const t0 = Date.now();
  let taken = false;
  while (!taken) {
    // 確認と立てるのを同時に2台がやらないよう、ここだけ ScriptLock で守る（取れたらすぐ離す）
    if (lock.tryLock(LICENSE_SCRIPTLOCK_MS_)) {
      try {
        if (!cache.get(lockKey)) { cache.put(lockKey, token, LICENSE_FLAG_SEC_); taken = true; }
      } finally { lock.releaseLock(); }
    }
    if (taken) break;
    if (Date.now() - t0 >= LICENSE_FLAG_WAIT_MS_) return onBusy();
    Utilities.sleep(LICENSE_FLAG_POLL_MS_);
  }
  try {
    return fn();
  } finally {
    try { SpreadsheetApp.flush(); }   // 書き込みを確定してから札を消す（次の人が古い中身を読まないように）
    finally { license_releaseFlag_(cache, lock, lockKey, token); }
  }
}

// 札が自分の印のときだけ消す（寿命が切れて他の端末が立て直した札は消さない）
function license_releaseFlag_(cache, lock, lockKey, token) {
  let got = false;
  try { got = lock.tryLock(LICENSE_SCRIPTLOCK_MS_); } catch (e) { got = false; }   // 取れなくても札は消す（残すと次の人が30秒待つ）
  try {
    if (cache.get(lockKey) === token) cache.remove(lockKey);
  } finally { if (got) lock.releaseLock(); }
}
