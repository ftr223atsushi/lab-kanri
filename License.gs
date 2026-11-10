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
const LICENSE_DOWN_CK_ = 'lk_ledger_down';                      // 台帳を開けなかった覚え（CacheService）
const LICENSE_DOWN_SEC_ = 60;                                   // 覚えは60秒。その間は台帳を開きに行かず写しで判定する

// 台帳を開けなかった覚え（SPEC 3-3）。止まっている間、1回の呼び出しごとに openById を2回（台帳・利用タブ）試して
// 毎回待たされないよう、失敗したら60秒は開きに行かない。読み書きの失敗は「覚え無し」として扱う
function license_ledgerDown_() {
  try { return !!CacheService.getScriptCache().get(LICENSE_DOWN_CK_); } catch (e) { return false; }
}
function license_setLedgerDown_() {
  try { CacheService.getScriptCache().put(LICENSE_DOWN_CK_, '1', LICENSE_DOWN_SEC_); } catch (e) { Logger.log('開けない覚えを置けず: ' + e); }
}

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

// 台帳を返す。5分キャッシュ→台帳→(読めなければ・60秒以内に開けなかったなら)24時間以内の写し→null。
// v3.35: 写しは本物の 9KB/値 の上限に収まる最小限の項目だけにする。保存に失敗しても読み取りは成功とする
function license_ledger_(now) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(LICENSE_CACHE_KEY_);
  if (hit) {
    try { const l = JSON.parse(hit); l.fromSnapshot = false; return l; } catch (e) { /* 壊れていれば読み直す */ }
  }
  // 最終レビュー修正: 60秒以内に開けなかったなら開きに行かず、すぐ写しへ
  if (!license_ledgerDown_()) {
    try {
      const led = license_readLedger_(now);
      const json = JSON.stringify({ keys: led.keys, drives: led.drives, graceUntil: led.graceUntil, readAt: led.readAt });
      try { cache.put(LICENSE_CACHE_KEY_, json, LICENSE_CACHE_SEC_); } catch (e) { Logger.log('台帳キャッシュ保存失敗: ' + e); }
      try { PropertiesService.getScriptProperties().setProperty(LICENSE_SNAPSHOT_PROP_, json); } catch (e) { Logger.log('台帳の写し保存失敗: ' + e); }
      return led;
    } catch (e) {
      Logger.log('台帳を読めない: ' + e);
      license_setLedgerDown_();
    }
  }
  try {
    const snap = JSON.parse(PropertiesService.getScriptProperties().getProperty(LICENSE_SNAPSHOT_PROP_) || 'null');
    if (snap && typeof snap.readAt === 'number' && now - snap.readAt <= LICENSE_SNAPSHOT_MAX_MS_ && snap.keys) {
      snap.fromSnapshot = true;
      return snap;
    }
  } catch (e2) { /* 写しが壊れていれば使わない */ }
  return null;
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
// fn が例外を投げても札は消してから例外を外へ出す。後始末(flush・札を消す)の失敗は記録だけで、fn の結果は変えない
// （書けたスキャンを「エラー」と返すと、利用者が撮り直して二重に記録するため）。
function license_withSheetLock_(lockKey, fn, onBusy) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  const token = Utilities.getUuid();
  const t0 = Date.now();
  let taken = false;
  for (;;) {
    const remain = LICENSE_FLAG_WAIT_MS_ - (Date.now() - t0);   // 全体で30秒を超えないよう、ScriptLock の待ちも残りに合わせる
    if (remain <= 0) return onBusy();
    // 確認と立てるのを同時に2台がやらないよう、ここだけ ScriptLock で守る（取れたらすぐ離す）
    if (lock.tryLock(Math.min(LICENSE_SCRIPTLOCK_MS_, remain))) {
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
    // finally の中で投げると fn の戻り値・例外が上書きされるので、後始末は必ず握りつぶして記録だけする
    try { SpreadsheetApp.flush(); }   // 書き込みを確定してから札を消す（次の人が古い中身を読まないように）
    catch (e) { Logger.log('license_withSheetLock_ flush失敗: ' + e); }
    license_releaseFlag_(cache, lock, lockKey, token);
  }
}

// 札が自分の印のときだけ消す（寿命が切れて他の端末が立て直した札は消さない）。失敗しても例外は出さない
function license_releaseFlag_(cache, lock, lockKey, token) {
  let got = false;
  try {
    // ScriptLock が取れなくても札は消しに行く（残すと次の人が30秒待つ）。自分の印の札がある間は他の端末は立てられないので
    // 競合するのは、確認と消すの間にちょうど札の寿命30秒が切れる瞬間だけ（fn が約30秒かかったときのみ）
    try { got = lock.tryLock(LICENSE_SCRIPTLOCK_MS_); } catch (e) { got = false; }
    if (cache.get(lockKey) === token) cache.remove(lockKey);
  } catch (e) {
    Logger.log('license_withSheetLock_ 札を消せず: ' + e);
  } finally {
    if (got) { try { lock.releaseLock(); } catch (e) { Logger.log('license_withSheetLock_ ScriptLock解放失敗: ' + e); } }
  }
}

// ---- 端末の登録（SPEC 2-2・3-2 の5）----
// 台帳の「lab-kanri利用」タブ：1キー×1端末＝1行。A〜I を GAS が書き、J（呼び名）は田中が手で書く（GAS は触らない）。
const LICENSE_USE_TAB_ = 'lab-kanri利用';
const LICENSE_USE_HEADER_ = ['キー', '会社名', '端末ID', '端末名（機種）', '初回利用', '最終利用', '利用回数', '版', '最終判定', '呼び名'];
const LICENSE_TOUCH_SEC_ = 3600;   // 書き直しは1台1時間に1回
const LICENSE_DEV_PROP_PREFIX_ = 'LK_DEV_';   // 知っている端末の印（スクリプトのプロパティ）LK_DEV_<キー>_<端末ID>
const LICENSE_DEV_ID_MAX_ = 200;              // これより長い端末IDには印を付けない（プロパティの名前を長くしない）

// 知っている端末の印（SPEC 3-3）。利用タブで行を確かめた・足した端末に付け、台帳が開けない間だけ使う。
// 値は {f: 初めて付けた時刻, l: 最後に確かめた時刻}（epoch ms・約40バイト）。1台1つ・書くのは1時間に1回（間引きと同じ）。
// CacheService（最長6時間・追い出しあり）ではなくプロパティにするのは、写しを使う24時間ずっと残したいから。
// 印が増えるのは台数上限の内側で登録できた端末だけ（数十台で数KB。プロパティ全体の上限 500KB に遠い）
function license_devProp_(key, deviceId) { return LICENSE_DEV_PROP_PREFIX_ + key + '_' + deviceId; }
function license_markKnown_(key, deviceId, now) {
  if (!key || !deviceId || deviceId.length > LICENSE_DEV_ID_MAX_) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const name = license_devProp_(key, deviceId);
    let first = now;
    try { const o = JSON.parse(props.getProperty(name) || 'null'); if (o && typeof o.f === 'number') first = o.f; } catch (e) { /* 壊れていれば付け直す */ }
    props.setProperty(name, JSON.stringify({ f: first, l: now }));
  } catch (e) { Logger.log('知っている端末の印を付けられず: ' + e); }
}
function license_isKnown_(key, deviceId) {
  if (!key || !deviceId || deviceId.length > LICENSE_DEV_ID_MAX_) return false;
  try { return !!PropertiesService.getScriptProperties().getProperty(license_devProp_(key, deviceId)); }
  catch (e) { Logger.log('知っている端末の印を読めず: ' + e); return false; }
}
function license_forgetKnown_(key, deviceId) {
  if (!key || !deviceId || deviceId.length > LICENSE_DEV_ID_MAX_) return;
  try { PropertiesService.getScriptProperties().deleteProperty(license_devProp_(key, deviceId)); }
  catch (e) { Logger.log('知っている端末の印を消せず: ' + e); }
}

// 利用タブの全行を見出し名で引いて調べる。tab が null（まだ無い）なら空として返す。
// 返す: { c(列名)→0始まり列番号, values, found(行の添字 or -1), used(そのキーの行数) }
function license_useScan_(tab, key, deviceId) {
  if (!tab || tab.getLastRow() === 0) return { c: null, values: [], found: -1, used: 0 };
  const values = tab.getDataRange().getValues();
  const c = license_cols_(values[0] || []);
  const cKey = c('キー'), cDev = c('端末ID');
  if (cKey < 0 || cDev < 0) throw new Error('lab-kanri利用 タブに「キー」「端末ID」の見出しがありません');
  let found = -1, used = 0;
  for (let i = 1; i < values.length; i++) {
    if (license_normalizeKey_(values[i][cKey]) !== key) continue;   // 手で直された小文字・空白も同じキーとして数える
    used++;
    if (found < 0 && String(values[i][cDev]).trim() === deviceId) found = i;
  }
  return { c: c, values: values, found: found, used: used };
}

// 端末をキーに登録する／最終利用を書き直す。
// 戻り値: { ok:true, used, limit } | { ok:false, reason:'too_many'|'busy'|'ledger_unavailable', message }
// - 既にある端末は常に通す（上限を下げられていても）。新しい端末は limit===0（無制限）か used<limit のとき行を足す
// - 同じ端末は1時間に1回しか書かない（CacheService）。間引き中は台帳を開かずに返す
// - 書くのは台帳の札（lk_ledger）の中だけ。新しい端末は札の中で数え直す（最後の1枠を2台が取り合っても1台だけ）
// - 台帳を開けない（または60秒以内に開けなかった）とき：知っている端末の印があれば {ok:true, used:null, limit} で通す。
//   印が無ければ ledger_unavailable。この道では行を足さない・数えない（台数の上限は守られる）
function license_touchDevice_(key, entry, deviceId, deviceName, appVersion, verdict, now) {
  key = license_normalizeKey_(key) || String(key == null ? '' : key).trim();   // 照合も間引き札も同じ形で
  deviceId = String(deviceId == null ? '' : deviceId).trim();   // 前後の空白で別端末にならないように
  const limit = entry.limit;
  const cache = CacheService.getScriptCache();
  const ckey = ('lk_touch_' + key + '_' + deviceId).slice(0, 250);
  const hit = cache.get(ckey);
  if (hit) {
    try { const h = JSON.parse(hit); return { ok: true, used: h.used, limit: h.limit }; } catch (e) { /* 壊れていれば書き直す */ }
  }
  const fail = (reason, message) => ({ ok: false, reason: reason, message: message || LICENSE_MSG_[reason] });
  const unavailable = () => fail('ledger_unavailable');
  const stamp = Utilities.formatDate(new Date(now), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  // 台帳が開けない間：知っている端末だけ通す。読めないのに行を足さない（台数の数え違いを防ぐ）
  const knownOrUnavailable = () => license_isKnown_(key, deviceId) ? { ok: true, used: null, limit: limit } : unavailable();
  if (license_ledgerDown_()) return knownOrUnavailable();

  // 札の外で先に一度見て、既にある端末か新しい端末かを決める（札が取れなかったときの扱いが違うため）
  let pre;
  let book;
  try {
    book = SpreadsheetApp.openById(LICENSE_LEDGER_ID);
  } catch (e) {
    Logger.log('台帳を開けない(利用タブ): ' + e);
    license_setLedgerDown_();
    return knownOrUnavailable();
  }
  try {
    pre = license_useScan_(book.getSheetByName(LICENSE_USE_TAB_), key, deviceId);
  } catch (e) {
    Logger.log('利用タブを読めない: ' + e);
    return knownOrUnavailable();
  }
  const isNew = pre.found < 0;

  let wrote = false;
  let res;
  try {
    res = license_withSheetLock_('lk_ledger', () => {
      const book = SpreadsheetApp.openById(LICENSE_LEDGER_ID);
      let tab = book.getSheetByName(LICENSE_USE_TAB_);
      if (!tab) {   // 無ければ作って見出しを書く（一番右に足される）
        tab = book.insertSheet(LICENSE_USE_TAB_);
        tab.getRange(1, 1, 1, LICENSE_USE_HEADER_.length).setValues([LICENSE_USE_HEADER_]);
      }
      let s = license_useScan_(tab, key, deviceId);   // 札の中で数え直す
      if (!s.c) {   // 空のタブ：見出しから書く
        tab.getRange(1, 1, 1, LICENSE_USE_HEADER_.length).setValues([LICENSE_USE_HEADER_]);
        s = license_useScan_(tab, key, deviceId);
      }
      const apply = (s) => {
        const c = s.c;
        if (s.found >= 0) {   // 既にある端末：F〜I だけ書き直す（J 呼び名は触らない）
          const r = s.found + 1;
          const times = parseInt(String(s.values[s.found][c('利用回数')]), 10);
          // 実際のSheetsは文字を入力と同じに解釈する（3.30→3.3・数字だけの端末ID→数値）ので、文字の列は書式'@'にしてから書く
          const put = (name, v, text) => {
            const col = c(name);
            if (col < 0) { Logger.log('lab-kanri利用 に「' + name + '」の見出しがない（書かない）'); return; }
            const rg = tab.getRange(r, col + 1);
            if (text) rg.setNumberFormat('@');
            rg.setValue(v);
          };
          put('最終利用', stamp, true);
          put('利用回数', (isNaN(times) ? 0 : times) + 1, false);   // 利用回数は数値のまま
          put('版', appVersion, true);
          put('最終判定', verdict, true);
          wrote = true;
          return { ok: true, used: s.used, limit: limit };
        }
        if (limit !== 0 && s.used >= limit) return fail('too_many', LICENSE_MSG_.too_many.replace('N', String(limit)));
        // 自分の列だけを1つずつ書く（呼び名や田中が足した列には触らない）。文字の列は書式'@'にしてから書く
        const r = s.values.length + 1;
        const put = (name, v, text) => {
          const col = c(name);
          if (col < 0) { Logger.log('lab-kanri利用 に「' + name + '」の見出しがない（書かない）'); return; }
          const rg = tab.getRange(r, col + 1);
          if (text) rg.setNumberFormat('@');
          rg.setValue(v);
        };
        put('キー', key, true); put('会社名', entry.company, true); put('端末ID', deviceId, true); put('端末名（機種）', deviceName, true);
        put('初回利用', stamp, true); put('最終利用', stamp, true); put('利用回数', 1, false); put('版', appVersion, true); put('最終判定', verdict, true);
        wrote = true;
        return { ok: true, used: s.used + 1, limit: limit };
      };
      return apply(s);
    }, () => isNew ? fail('busy') : { ok: true, used: pre.used, limit: limit });   // 既にある端末は書けなくても通す（最終利用が古いだけ）
  } catch (e) {
    Logger.log('利用タブへの書き込み失敗: ' + e);
    // 既にある端末は札の外で行を確かめてあるので通す（最終利用が古いだけ・混み合いと同じ扱い）。新しい端末は足せていないので断る
    if (isNew) return unavailable();
    res = { ok: true, used: pre.used, limit: limit };
  }
  if (res.ok && wrote) {
    try { cache.put(ckey, JSON.stringify({ used: res.used, limit: res.limit }), LICENSE_TOUCH_SEC_); } catch (e) { Logger.log('間引きの札を置けず: ' + e); }
  }
  // 利用タブに行があると確かめた（足した）端末だけ印を付ける。新しい端末を断ったら古い印は消す（田中が行を消した端末など）
  if (res.ok) license_markKnown_(key, deviceId, now);
  else if (isNew) license_forgetKnown_(key, deviceId);
  return res;
}

// ---- 現場シートフォルダ・シートの所属・一覧（Drive API v3 の高度なサービス） ----

const LICENSE_SITE_FOLDER_NAME_ = '現場シート';
const LICENSE_FOLDER_CACHE_SEC_ = 21600;   // フォルダID・「中にある」は6時間(CacheService の上限)
const LICENSE_LIST_MAX_ = 100;

// Drive の q に埋め込む文字列の ' と \ を逃がす
function license_q_(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// 会社の共有ドライブ直下の「現場シート」フォルダを探す。
// 1つ → {ok:true, folderId}（6時間覚える）／0 → no_folder／2つ以上 → two_folders（成功だけ覚える＝作った・消した直後にすぐ効く）。
// 入れ子（親が共有ドライブ直下でない）の「現場シート」は q の in parents で外れる。
// v3.35: Drive が失敗したら、覚えがあればそれで通し、無ければ ledger_unavailable
function license_siteFolder_(driveId) {
  const cache = CacheService.getScriptCache();
  const ckey = 'lk_folder_' + driveId;
  let hit = null;
  try { hit = cache.get(ckey); } catch (e) { Logger.log('フォルダ札の読み込み失敗: ' + e); }
  if (hit) return { ok: true, folderId: hit };
  let res;
  try {
    res = Drive.Files.list({
      q: "name='" + LICENSE_SITE_FOLDER_NAME_ + "' and mimeType='application/vnd.google-apps.folder' and '" + license_q_(driveId) + "' in parents and trashed=false",
      corpora: 'drive', driveId: driveId, includeItemsFromAllDrives: true, supportsAllDrives: true,
      fields: 'files(id,name)'
    });
  } catch (e) {
    Logger.log('現場シートフォルダを探せない: ' + e);
    return { ok: false, reason: 'ledger_unavailable', message: LICENSE_MSG_.ledger_unavailable };
  }
  const files = (res && res.files) || [];
  if (files.length === 0) return { ok: false, reason: 'no_folder', message: LICENSE_MSG_.no_folder };
  if (files.length >= 2) return { ok: false, reason: 'two_folders', message: LICENSE_MSG_.two_folders };
  try { cache.put(ckey, files[0].id, LICENSE_FOLDER_CACHE_SEC_); } catch (e) { Logger.log('フォルダ札の保存失敗: ' + e); }
  return { ok: true, folderId: files[0].id };
}

// スプレッドシートが folderId の直下にあるか。
// 中(ゴミ箱でない) → ok（6時間覚える。覚えがあれば Drive を呼ばない）。外・ゴミ箱・「見つからない」→ outside（覚えない＝移した直後にすぐ開ける）。
// それ以外の Drive の失敗 → ledger_unavailable（覚えが先に効くので「中」の覚えがあれば通る）
function license_sheetAllowed_(spreadsheetId, folderId) {
  const cache = CacheService.getScriptCache();
  const ckey = 'lk_in_' + folderId + '_' + spreadsheetId;
  let hit = null;
  try { hit = cache.get(ckey); } catch (e) { Logger.log('所属札の読み込み失敗: ' + e); }
  if (hit) return { ok: true };
  let f;
  try {
    f = Drive.Files.get(spreadsheetId, { supportsAllDrives: true, fields: 'parents,trashed' });
  } catch (e) {
    if (/not found/i.test(String((e && e.message) || e))) return { ok: false, reason: 'outside', message: LICENSE_MSG_.outside };
    Logger.log('シートの所属を確かめられない: ' + e);
    return { ok: false, reason: 'ledger_unavailable', message: LICENSE_MSG_.ledger_unavailable };
  }
  const inside = !!f && !f.trashed && (f.parents || []).indexOf(folderId) >= 0;
  if (!inside) return { ok: false, reason: 'outside', message: LICENSE_MSG_.outside };
  try { cache.put(ckey, '1', LICENSE_FOLDER_CACHE_SEC_); } catch (e) { Logger.log('所属札の保存失敗: ' + e); }
  return { ok: true };
}

// 現場シートフォルダの直下のスプレッドシートを更新の新しい順に最大100件。[{id, name, modified(epoch ms)}]
// Drive の失敗は例外のまま返す（呼び出し側が ledger_unavailable にする）
function license_listSites_(folderId) {
  const res = Drive.Files.list({
    q: "'" + license_q_(folderId) + "' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    corpora: 'allDrives', includeItemsFromAllDrives: true, supportsAllDrives: true,
    orderBy: 'modifiedTime desc', pageSize: LICENSE_LIST_MAX_,
    fields: 'files(id,name,modifiedTime)'
  });
  return ((res && res.files) || []).slice(0, LICENSE_LIST_MAX_).map(function (f) {
    const t = Date.parse(f.modifiedTime);
    return { id: f.id, name: f.name, modified: isNaN(t) ? 0 : t };
  });
}

// v3.39: 現場切替の一覧に出す正式な件名。件名タブの種別ごとの件名（picker が書く「件名(表層土壌)」など）を読む。
// シートを1つずつ開くので、読んだ答えはシートごとに6時間覚え、1回の呼び出しは約20秒で打ち切る（残りは次の呼び出しで読む）。
// 件名を picker で直したときは、最長6時間で一覧に出る。
const LICENSE_TITLE_CACHE_SEC_ = 21600;
const LICENSE_TITLE_BUDGET_MS_ = 20000;
const LICENSE_TITLE_KEYS_ = [['soil', '件名(表層土壌)'], ['gas', '件名(土壌ガス)'], ['pipe', '件名(配管・ピット・盛土下)'],
                             ['depth', '件名(深度調査)'], ['survey', '件名(測量)']];

// 1つのシートの件名 {soil?, gas?, pipe?, depth?, survey?}（空は省く）。件名タブが無ければ {}。開けないときは例外のまま返す
// （getKenmeiMap_ は失敗を飲み込むので使わない：一時の失敗で空の答えを6時間覚えてしまうため）
function license_readSiteTitle_(id) {
  const sheet = SpreadsheetApp.openById(id).getSheetByName(SHEET_KENMEI);
  const t = {};
  if (!sheet) return t;
  const lastRow = Math.min(sheet.getLastRow(), 20);
  if (lastRow < 1) return t;
  const map = {};
  sheet.getRange(1, 1, lastRow, 2).getDisplayValues().forEach(function (r) {
    const k = String(r[0] || '').trim();
    if (k) map[k] = String(r[1] || '').trim();
  });
  LICENSE_TITLE_KEYS_.forEach(function (kv) { if (map[kv[1]]) t[kv[0]] = map[kv[1]]; });
  return t;
}

// sites=[{id}]（license_listSites_ の答え）→ {titles: {id: {...}}, partial: 時間切れで読み残しがあれば true}
// 開けないシートは答えに入れず、覚えもしない（次の呼び出しで読み直す）
function license_siteTitles_(sites) {
  const cache = CacheService.getScriptCache();
  const list = (sites || []).filter(function (s) { return s && s.id; });
  const keyOf = function (id) { return 'lk_title_' + id; };
  let hits = {};
  try { hits = cache.getAll(list.map(function (s) { return keyOf(s.id); })) || {}; }
  catch (e) { Logger.log('件名の控えを読めず: ' + e); }
  const titles = {};
  let partial = false;
  const start = new Date().getTime();
  list.forEach(function (s) {
    const hit = hits[keyOf(s.id)];
    if (hit != null) {
      try { titles[s.id] = JSON.parse(hit); return; } catch (e) { /* 壊れた控えは読み直す */ }
    }
    if (new Date().getTime() - start >= LICENSE_TITLE_BUDGET_MS_) { partial = true; return; }
    let t;
    try { t = license_readSiteTitle_(s.id); }
    catch (e) { Logger.log('件名を読めない ' + s.id + ': ' + e); return; }
    titles[s.id] = t;
    try { cache.put(keyOf(s.id), JSON.stringify(t), LICENSE_TITLE_CACHE_SEC_); } catch (e) { Logger.log('件名の控えを置けず: ' + e); }
  });
  return { titles: titles, partial: partial };
}

// ---- 入口の判定と新しい action（SPEC 3-2・3-4）----

// v3.35: 判定するのは「知っている action」だけ。知らない action は判定せず doPostAction_ に渡し、
// 今までどおり 'unknown action: X' を返す（アプリが古いサーバーをこの文で見分けるため）。
// シートIDを使う action（置き場所の確認が要る）
const LICENSE_SHEET_ACTIONS_ = {
  handleScan: true, savePickupExtra: true, undoRecord: true, getSpreadsheetMeta: true,
  getDailyReportData: true, listDailyReportDates: true, getKentaiData: true, getSaishuAll: true,
  getLabelSiteName: true, setLabelSiteName: true, getLabelPrinted: true, markCodeLabelPrinted: true
};
// シートに行を足す action（シートごとの順番待ち lk_<シートID> を丸ごと通す）
// v3.35 Task 12d: handleScan は外した。スキャンは見つけた行のセルに書くだけで、同じコードを2台が同時に読んでも
// 後の端末が残るだけ（無害と確認済み）。handleScan の中で行を足す前処理シートの追加だけ、その場で札を取る（handlePhase2V2）
const LICENSE_WRITE_ACTIONS_ = {
  savePickupExtra: true, undoRecord: true, markCodeLabelPrinted: true
};
// シートを使わない action（キーの確認だけ）
const LICENSE_PLAIN_ACTIONS_ = {
  getWorkerList: true, addWorker: true, setCurrentWorker: true, verifyPassword: true, changePassword: true
};

// オブジェクトが自分で持つ名前だけ true（'constructor' などの継承された名前を除く）
function license_has_(table, name) { return Object.prototype.hasOwnProperty.call(table, name) && table[name] === true; }

function license_refuse_(reason, message) {
  return { ok: false, reason: reason, message: message || LICENSE_MSG_[reason] };
}

// ---- 通過札（v3.35 Task 12d・案A）----
// キー・端末（・シート）の判定が全部通ったら札を1枚置き、次からは get 1回で通す（台帳・利用タブ・Drive を見ない）。
// 札の名前：シートの action は lk_pass_<キー>_<端末ID>_<シートID>、シートを使わない action は lk_pass_<キー>_<端末ID>。
// 寿命は「台帳を読んだ時刻(readAt)＋300秒」まで（台帳キャッシュの残り）。停止・期限切れは今と同じく最長5分で効く。
// 写し(fromSnapshot)で判定した回は置かない。listSites（現場切替のときだけ）・checkLicense・キー無し(猶予)は札を使わない
const LICENSE_PASS_PREFIX_ = 'lk_pass_';
function license_passKey_(key, deviceId, sheetId) {
  return (LICENSE_PASS_PREFIX_ + key + '_' + deviceId + (sheetId ? '_' + sheetId : '')).slice(0, 250);   // キーは250字まで
}
// 札があり、中身（キー・端末・シート）が要求と同じで、readAt＋300秒より前なら中身を返す。それ以外・失敗は null（今の判定へ）
function license_passGet_(key, deviceId, sheetId, now) {
  try {
    const hit = CacheService.getScriptCache().get(license_passKey_(key, deviceId, sheetId));
    if (!hit) return null;
    const v = JSON.parse(hit);
    // 名前が衝突・切り詰めで重なっても他人の札で通らないよう中身でも確かめる。CacheService が長く残しても readAt で切る
    if (!v || v.k !== key || v.d !== deviceId || v.s !== (sheetId || '') || typeof v.r !== 'number') return null;
    if (!(now < v.r + LICENSE_CACHE_SEC_ * 1000)) return null;
    return v;
  } catch (e) {
    Logger.log('通過札の読み込み失敗: ' + e);
    return null;
  }
}
// 判定が全部通ったあとに札を置く。寿命は切り捨てで readAt＋300秒を超えない。1秒未満なら置かない
function license_passPut_(ledger, key, deviceId, sheetId, company, folderId, now) {
  if (!ledger || ledger.fromSnapshot || typeof ledger.readAt !== 'number') return;
  const ttl = Math.floor((ledger.readAt + LICENSE_CACHE_SEC_ * 1000 - now) / 1000);
  if (ttl < 1) return;
  const v = { k: key, d: deviceId, s: sheetId || '', c: company, f: folderId || '', r: ledger.readAt };
  try { CacheService.getScriptCache().put(license_passKey_(key, deviceId, sheetId), JSON.stringify(v), Math.min(ttl, LICENSE_CACHE_SEC_)); }
  catch (e) { Logger.log('通過札を置けず: ' + e); }
}

// 入口の判定。{allow:true, notice?, company?, folderId?, spreadsheetId?} | {allow:false, response}
// 順番：キー無し→猶予 ／ (通過札があればここで通す) ／ キー→台帳→端末の登録→(シートの action だけ)置き場所。拒否は利用タブに書かない
function license_gate_(action, p, now) {
  if (action === 'ping' || action === 'checkLicense') return { allow: true };   // ping は判定なし・checkLicense は自分で確かめる
  const isList = action === 'listSites' || action === 'listSiteTitles';   // v3.39: 件名の一覧も listSites と同じ判定
  const isSheet = license_has_(LICENSE_SHEET_ACTIONS_, action);
  if (!isList && !isSheet && !license_has_(LICENSE_PLAIN_ACTIONS_, action)) return { allow: true };   // 知らない action は素通し

  const deny = (reason, message) => ({ allow: false, response: license_refuse_(reason, message) });
  const key = String(p.licenseKey == null ? '' : p.licenseKey).trim();
  const deviceId = String(p.deviceId == null ? '' : p.deviceId).trim();   // 空白だけの端末IDは「無い」(no_device)

  if (!key) {
    if (isList) return deny('no_key');   // 一覧は猶予中でもキーが要る
    const g = license_grace_(license_ledger_(now), now);   // 台帳が読めない(null)＝猶予中として通す
    if (g.inGrace) return { allow: true, notice: { daysLeft: g.daysLeft } };
    return deny('no_key');
  }

  // getSpreadsheetMeta は URL が来る。action と同じ読み方でIDを取る（I/O なし）
  const id = isSheet ? parseSpreadsheetIdFromInput(p.spreadsheetId) : '';
  // 通過札：キー・端末（シートの action はシートIDも）がそろっているときだけ見る。無ければ下の今の判定
  const nkey = license_normalizeKey_(key);
  if (!isList && nkey && deviceId && (!isSheet || id)) {
    const pass = license_passGet_(nkey, deviceId, id, now);
    if (pass) return isSheet ? { allow: true, company: pass.c, folderId: pass.f, spreadsheetId: id } : { allow: true, company: pass.c };
  }

  const ledger = license_ledger_(now);
  if (!ledger) return deny('ledger_unavailable');
  const ck = license_checkKey_(ledger, key, deviceId, now);
  if (!ck.ok) return deny(ck.reason, ck.message);

  if (isSheet && !id) return deny('outside');

  const t = license_touchDevice_(ck.key, ck.entry, deviceId, String(p.deviceName || ''), String(p.appVersion || ''), '有効', now);
  if (!t.ok) return deny(t.reason, t.message);
  if (!isSheet && !isList) {
    license_passPut_(ledger, ck.key, deviceId, '', ck.entry.company, '', now);
    return { allow: true, company: ck.entry.company };
  }

  const driveId = ledger.drives && ledger.drives[ck.entry.conn];
  if (!driveId) return deny('no_folder');
  const f = license_siteFolder_(driveId);
  if (!f.ok) return deny(f.reason, f.message);
  if (isSheet) {
    const s = license_sheetAllowed_(id, f.folderId);
    if (!s.ok) return deny(s.reason, s.message);
    license_passPut_(ledger, ck.key, deviceId, id, ck.entry.company, f.folderId, now);
  }
  return { allow: true, company: ck.entry.company, folderId: f.folderId, spreadsheetId: id };
}

// checkLicense：キー登録・起動時・版の表示で使う。有効なキーなら端末もここで登録される
function license_checkLicenseAction_(p, now) {
  const key = String(p.licenseKey == null ? '' : p.licenseKey).trim();
  const ledger = license_ledger_(now);
  const g = license_grace_(ledger, now);
  const withGrace = (r) => { r.inGrace = g.inGrace; r.daysLeft = g.daysLeft; return r; };
  const deviceId = String(p.deviceId == null ? '' : p.deviceId).trim();
  if (!key) return withGrace(license_refuse_('no_key'));
  if (!ledger) return withGrace(license_refuse_('ledger_unavailable'));
  const ck = license_checkKey_(ledger, key, deviceId, now);
  if (!ck.ok) return withGrace(license_refuse_(ck.reason, ck.message));
  const t = license_touchDevice_(ck.key, ck.entry, deviceId, String(p.deviceName || ''), String(p.appVersion || ''), '有効', now);
  if (!t.ok) return withGrace(license_refuse_(t.reason, t.message));
  return { ok: true, companyName: ck.entry.company, expires: ck.entry.expires, used: t.used, limit: t.limit, inGrace: g.inGrace, daysLeft: g.daysLeft };
}
