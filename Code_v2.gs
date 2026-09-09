/**
 * shast LAB2 - GAS Web App (picker v2 専用版)
 *
 * ============================================================
 * これは picker v2 (コード台帳方式) の現場「専用」のGASです。
 * 旧方式の現場は従来の lab-kanri (Code.gs / 旧URL) を使うこと。
 * 別の新規GASプロジェクトに貼り付けて Web App としてデプロイする。
 * ============================================================
 *
 * v2 で変わったこと (SPEC_code_ledger.md 第8版):
 *  - 「地点抽出」シートが存在しない。コードは各実データシートのコード列に直接ある
 *    → 旧: コード→地点抽出→地点名→実データシートの2段引き
 *    → 新: 実データシートのコード列で直接1回引き (行が即確定)
 *  - コード形式: 現場ID(4英字)-種別-連番4桁  例 TEDC-S-0001
 *    種別: S=表層土壌 / G=土壌ガス / H=配管・ピット・盛り土下 / D=深度調査の土
 *          WG=地下水ガラス(第1種) / WP=地下水ポリ(第2種3種) ← 深度調査シートに同居
 *          L=分析検体 (振り/ろか用。語尾 -huri / -roka)
 *  - 件名シート A12=「現場ID」/ B12=値。これが無いブック=旧方式 → 拒否 (誤爆防止)
 *  - 書込み前にコード先頭の現場IDと件名B12を照合 (SPEC §3.5)
 *  - バーコード作成シートは新方式では作らない (ラベル屋さんへ移行済み)
 *  - 前処理シートは廃止 → 振り/ろか/分析(土壌)の記録先は本スクリプトが
 *    「前処理」シートを自前で作成して記録する【暫定実装・仕様確認中】
 *
 * 実データシート列構成 (v2):
 *  表層土壌:   A状態 B地点 C上下 Dコード E採取 F採取担当 G受入 H受入担当 I風乾 J風乾担当 K被覆 L検測深度
 *  土壌ガス:   A状態 B地点名 Cコード D削孔 E削孔担当 F採取 G採取担当 H受入 I担当者 J分析 K分析担当
 *  配管・ピット・盛り土下:
 *              A状態 B地点 C採取深度 Dコード E採取 F採取担当 G受入 H受入担当 I風乾 J風乾担当 K現地深度 L被覆 M検測
 *  深度調査:   A状態 B地点 C深度 Dコード E採取 F採取担当 G受入 H受入担当 I風乾 J風乾担当 K被覆 L検測
 *              (地下水行も同居: 深度セル空・コード WG/WP)
 *  分析検体:   A区画 B〜J=1〜9 K黒 L赤 M青 N種別 O検体揃い状況 P印刷日 Q振りコード R ろかコード (旧と同じ)
 */

// ========== バージョン ==========
// 形式: メジャー.マイナー-yyyyMMdd.HHmm (更新ごとに 0.01 上げ、日時はデプロイ日時)
// APK 側 (index.html の APP_VERSION) と揃えること
const APP_VERSION = '2.65-20260909.2256';

// ========== シート名 ==========
const SHEET_HYOSO    = '表層土壌';
// 配管はひな形の表記ゆれ両対応 (v2ひな形は「盛り土下」)
const SHEET_HAIKAN_NAMES = ['配管・ピット・盛り土下', '配管・ピット・盛土下'];
const SHEET_GAS      = '土壌ガス';
const SHEET_FUKADO   = '深度調査';
const SHEET_KENTAI   = '分析検体';
const SHEET_KENMEI   = '件名';
const SHEET_ZENSHORI = '前処理';   // v2暫定: 振り/ろか/分析(土壌)の記録先 (無ければ自動作成)

// 件名シートの現場IDセル (SPEC: A12「現場ID」/ B12=値)
const KENMEI_SITE_ID_LABEL_CELL = 'A12';
const KENMEI_SITE_ID_VALUE_CELL = 'B12';

// ========== 種別×シート構成 (v2列マップ) ==========
const KIND_CONFIG = {
  '表層土壌': {
    hasUd: true,
    availableModes: ['採取', '受入', '風乾'],
    workCols: {
      STATUS: 1, POINT: 2, UD: 3, CODE: 4,
      SAISHU: 5, SAISHU_W: 6,
      UKEIRE: 7, UKEIRE_W: 8,
      FUKAN:  9, FUKAN_W: 10
    }
  },
  '土壌ガス': {
    hasUd: false,
    availableModes: ['削孔', '採取', '受入', '分析'],
    modeOverrides: {
      '削孔': { prevCol: null },
      // v2.65: 削孔チェックを外した。削孔は現場(shast)の記録で lab-kanri は書かないので、
      // 「削孔が未記録」で現地確認が止まってしまう。役割が分かれた以上ここは見ない
      '採取': { prevCol: null },
      '受入': { prevCol: null },
      '分析': { prevCol: 'UKEIRE' }
    },
    workCols: {
      STATUS: 1, POINT: 2, CODE: 3,
      SAKKO_T: 4, SAKKO_W: 5,
      SAISHU:  6, SAISHU_W: 7,
      UKEIRE:  8, UKEIRE_W: 9,
      BUNSEKI_T: 10, BUNSEKI_W: 11
    }
  },
  '配管・ピット・盛り土下': {
    hasUd: false,
    hasDepth: true,
    availableModes: ['採取', '受入', '風乾'],
    // v2: 現地深度は実データシートのK列。受入時に空なら入力ダイアログ (空白のみ書込)
    extraCol: 'GENCHI_DEPTH',
    extraLabel: '現地深度',
    extraType: 'depth-range',
    extraOnModes: ['受入'],
    workCols: {
      STATUS: 1, POINT: 2, DEPTH: 3, CODE: 4,
      SAISHU: 5, SAISHU_W: 6,
      UKEIRE: 7, UKEIRE_W: 8,
      FUKAN:  9, FUKAN_W: 10,
      GENCHI_DEPTH: 11
    }
  },
  '深度調査': {
    hasUd: false,
    hasDepth: true,
    availableModes: ['採取', '受入', '風乾'],
    workCols: {
      STATUS: 1, POINT: 2, DEPTH: 3, CODE: 4,
      SAISHU: 5, SAISHU_W: 6,
      UKEIRE: 7, UKEIRE_W: 8,
      FUKAN:  9, FUKAN_W: 10
    }
  }
};

// コード種別 → 内部種別
const CODE_TYPE_TO_KIND = {
  'S': '表層土壌',
  'G': '土壌ガス',
  'H': '配管・ピット・盛り土下',
  'D': '深度調査',
  'WG': '深度調査',   // 地下水ガラス (第1種) — 深度調査シートに同居
  'WP': '深度調査'    // 地下水ポリ (第2種3種)
};

// 地下水 (WG/WP) はモード制限 (風乾なし)
const WATER_CODE_TYPES = ['WG', 'WP'];
const WATER_AVAILABLE_MODES = ['採取', '受入'];

// 地下水の水位: 深度調査シートの深度列(C)へ後から記録 (SPEC §7.3 / 深度後決め)
const WATER_EXTRA = { col: 'DEPTH', label: '水位', type: 'plain', onModes: ['採取', '受入'] };

// 削除地点を赤文字で記録するための色
const DELETED_FONT_COLOR = '#c62828';

// v2暫定: 前処理シート (振り/ろか/分析(土壌) の記録先)
// ※現行構成ブック用に残置。分離構成ブック (ラボ記録あり) では使わない
// A=コード B=区画 C=色 D=振り時刻 E=振り担当 F=ろか時刻 G=ろか担当 H=分析時刻 I=分析担当
const COL_ZENSHORI = {
  CODE: 1, POINT: 2, COLOR: 3,
  HURI_T: 4, HURI_W: 5,
  ROKA_T: 6, ROKA_W: 7,
  BUNSEKI_T: 8, BUNSEKI_W: 9
};
const ZENSHORI_HEADER = ['コード', '区画', '色', '振り時刻', '振り担当', 'ろか時刻', 'ろか担当', '分析時刻', '分析担当'];

// ========== 分離構成 (SPEC_sheet_ownership.md §0/§3.2) ==========
// 「ラボ記録」シート = picker がヘッダー生成、行の書き手は lab-kanri のみ (find-or-append)
// このシートの有無で新旧構成を自動判別する (§4-4)。lab-kanri はシートを作らない。
// 列は見出し検索で引く (列の追加・移動に耐える。見出し文字列が契約)
const SHEET_LABREC = 'ラボ記録';

// ラボ記録の見出し名 (§3.2 の17列のうち lab-kanri が使うもの)
const LABREC_H = {
  CODE:    'コード',
  POINT:   '地点',
  KIND:    '種別',
  GENCHI_T: '現地確認日時', GENCHI_W: '現地確認担当',
  UKEIRE_T: '受入日時',     UKEIRE_W: '受入担当',
  FUKAN_T:  '風乾日時',     FUKAN_W:  '風乾担当',
  HURI_T:   '振り日時',     HURI_W:   '振り担当',
  ROKA_T:   'ろか日時',     ROKA_W:   'ろか担当',
  BUNSEKI_T:'分析日時',     BUNSEKI_W:'分析担当',
  LAB_DEPTH:'ラボ深度'
};

// UIモード → ラボ記録の書込列 (見出し名) と工程ルール
// UIの「採取」は分離構成では「現地確認」(旧運用の採取確認に相当。shastの採取日時とは別物)
const LABREC_MODE = {
  '採取': { t: LABREC_H.GENCHI_T, w: LABREC_H.GENCHI_W, prev: null, label: '現地確認' },
  '受入': { t: LABREC_H.UKEIRE_T, w: LABREC_H.UKEIRE_W, prev: null, label: '受入' },
  '風乾': { t: LABREC_H.FUKAN_T, w: LABREC_H.FUKAN_W, prev: LABREC_H.UKEIRE_T, prevLabel: '受入', strict: true, label: '風乾' },
  '振り': { t: LABREC_H.HURI_T, w: LABREC_H.HURI_W, prev: null, label: '振り' },
  'ろか': { t: LABREC_H.ROKA_T, w: LABREC_H.ROKA_W, prev: LABREC_H.HURI_T, prevLabel: '振り', strict: false, label: 'ろか' },
  '分析': { t: LABREC_H.BUNSEKI_T, w: LABREC_H.BUNSEKI_W, prev: LABREC_H.ROKA_T, prevLabel: 'ろか', strict: false, label: '分析', requireWorkers: ['早川', '山口'] }
};

/**
 * ラボ記録シートの見出し行を読み、見出し名→列番号(1始まり)のマップを返す。
 * 必須見出しが無ければ throw (どの見出しが無いかを明示)。
 */
function getLabRecCols_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const map = {};
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] || '').trim();
    if (h && !(h in map)) map[h] = i + 1;
  }
  // 必須: コードと各工程列
  const required = [LABREC_H.CODE, LABREC_H.POINT, LABREC_H.KIND,
                    LABREC_H.GENCHI_T, LABREC_H.UKEIRE_T, LABREC_H.FUKAN_T,
                    LABREC_H.HURI_T, LABREC_H.ROKA_T, LABREC_H.BUNSEKI_T, LABREC_H.LAB_DEPTH];
  for (let i = 0; i < required.length; i++) {
    if (!map[required[i]]) {
      throw new Error('ラボ記録シートに見出し「' + required[i] + '」が見つかりません (見出し名は変えないでください)');
    }
  }
  return map;
}

/**
 * ラボ記録シートでコードの行を検索。無ければ末尾に追記 (コード/地点/種別を書く)。
 * @return {number} 行番号
 */
function findOrAppendLabRow_(sheet, cols, baseCode, point, kindLabel) {
  const target = String(baseCode).trim().toUpperCase();
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const codes = sheet.getRange(2, cols[LABREC_H.CODE], lastRow - 1, 1).getDisplayValues();
    for (let i = 0; i < codes.length; i++) {
      if (String(codes[i][0]).trim().toUpperCase() === target) return i + 2;
    }
  }
  const row = Math.max(sheet.getLastRow(), 1) + 1;
  sheet.getRange(row, cols[LABREC_H.CODE]).setValue(baseCode);
  if (point) sheet.getRange(row, cols[LABREC_H.POINT]).setValue(point);
  if (kindLabel) sheet.getRange(row, cols[LABREC_H.KIND]).setValue(kindLabel);
  return row;
}

/**
 * v2.58: 分析検体シートの列を見出しで引く。picker が列を足しても効くようにする。
 *
 * 振り/ろかコードの列は見出しが無いことがあるので、次の順で探す。
 *   1. 見出し名 (「振りコード」「ろかコード」など)
 *   2. 実データの形 (末尾が -HURI / -ROKA)
 *   3. 従来の位置 (Q列 / R列)
 * 返すのは1始まりの列番号。
 */
function getKentaiCols_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
    .map(function(v) { return String(v == null ? '' : v).trim(); });
  const find = function(pred) {
    for (let i = 0; i < header.length; i++) { if (pred(header[i])) return i + 1; }
    return 0;
  };
  const cols = {
    lastCol: lastCol,
    kuga:  find(function(h) { return h === '区画'; }),
    kuro:  find(function(h) { return h === '黒'; }),
    aka:   find(function(h) { return h === '赤'; }),
    ao:    find(function(h) { return h === '青'; }),
    soroi: find(function(h) { return /揃い/.test(h); }),
    huri:  find(function(h) { return /振り/.test(h) && /コード/.test(h); }),
    roka:  find(function(h) { return /(ろか|ろ過|濾過)/.test(h) && /コード/.test(h); }),
    // v2.62: 振り/ろか/分析の記録先。picker が追加する6列 (無ければ0)
    HURI_T:    find(function(h) { return h === '振り日時'; }),
    HURI_W:    find(function(h) { return h === '振り担当'; }),
    ROKA_T:    find(function(h) { return h === 'ろか日時' || h === 'ろ過日時'; }),
    ROKA_W:    find(function(h) { return h === 'ろか担当' || h === 'ろ過担当'; }),
    BUNSEKI_T: find(function(h) { return h === '分析日時'; }),
    BUNSEKI_W: find(function(h) { return h === '分析担当'; })
  };
  // 見出しが空でも、末尾 -HURI / -ROKA の列を実データから探す
  if (!cols.huri || !cols.roka) {
    const n = Math.min(Math.max(sheet.getLastRow() - 1, 0), 50);
    if (n > 0) {
      const data = sheet.getRange(2, 1, n, lastCol).getDisplayValues();
      for (let r = 0; r < data.length && (!cols.huri || !cols.roka); r++) {
        for (let i = 0; i < data[r].length; i++) {
          const v = String(data[r][i] == null ? '' : data[r][i]).trim().toUpperCase();
          if (!cols.huri && /-HURI$/.test(v)) cols.huri = i + 1;
          if (!cols.roka && /-ROKA$/.test(v)) cols.roka = i + 1;
        }
      }
    }
  }
  // どうしても見つからない時だけ、従来の決め打ちに落とす
  if (!cols.kuga)  cols.kuga  = 1;    // A
  if (!cols.kuro)  cols.kuro  = 11;   // K
  if (!cols.aka)   cols.aka   = 12;   // L
  if (!cols.ao)    cols.ao    = 13;   // M
  if (!cols.soroi) cols.soroi = 15;   // O
  if (!cols.huri)  cols.huri  = 17;   // Q
  if (!cols.roka)  cols.roka  = 18;   // R
  return cols;
}

/**
 * 分析検体シートの 振り/ろか コード列からLコードの行を探し、区画名と色を返す。
 */
function lookupKentaiByLCode_(ss, baseCode) {
  // v2.62: 行番号と列位置も返す (振り/ろか/分析をこのシートに書くため)
  const out = { point: '', color: '', row: 0, sheet: null, cols: null };
  try {
    const ks = ss.getSheetByName(SHEET_KENTAI);
    if (!ks) return out;
    const lastRow = ks.getLastRow();
    if (lastRow < 2) return out;
    const c = getKentaiCols_(ks);
    out.sheet = ks;
    out.cols = c;
    const data = ks.getRange(2, 1, lastRow - 1, c.lastCol).getDisplayValues();
    const targetHuri = (baseCode + '-HURI');
    const targetRoka = (baseCode + '-ROKA');
    const cell = function(row, col) {
      return String(row[col - 1] == null ? '' : row[col - 1]).trim();
    };
    for (let i = 0; i < data.length; i++) {
      const q = cell(data[i], c.huri).toUpperCase();
      const r = cell(data[i], c.roka).toUpperCase();
      if (q === targetHuri || r === targetRoka) {
        out.row = i + 2;
        out.point = cell(data[i], c.kuga);
        if (cell(data[i], c.kuro)) out.color = '黒';
        else if (cell(data[i], c.aka)) out.color = '赤';
        else if (cell(data[i], c.ao)) out.color = '青';
        break;
      }
    }
  } catch (e) {}
  return out;
}

/** 分離構成: ラボ記録の種別列に入れる表示ラベル */
function labKindLabel_(kind, ud, codeType) {
  if (codeType === 'WG') return '地下水WG';
  if (codeType === 'WP') return '地下水WP';
  if (kind === '表層土壌') return ud ? ('表層(' + udDisplay(ud) + ')') : '表層';
  if (kind === '土壌ガス') return 'ガス';
  if (kind === '配管・ピット・盛り土下') return '配管';
  if (kind === '深度調査') return '深度';
  return kind;
}

// ========== モード定義 ==========
const MODES = {
  '削孔': { phase: 1, col: 'SAKKO_T', workerCol: 'SAKKO_W', prevCol: null, strict: false },
  '採取': { phase: 1, col: 'SAISHU', workerCol: 'SAISHU_W', prevCol: null, strict: true },
  // 採取はオプション扱い (現場で記録漏れの可能性) → 受入単独でも記録可
  '受入': { phase: 1, col: 'UKEIRE', workerCol: 'UKEIRE_W', prevCol: null, strict: false },
  '風乾': { phase: 1, col: 'FUKAN', workerCol: 'FUKAN_W', prevCol: 'UKEIRE', strict: true },
  '振り': {
    phase: 2, expectedSuffix: 'huri',
    col: 'HURI_T', workerCol: 'HURI_W',
    prevCol: null, prevLabel: null, strict: false
  },
  'ろか': {
    phase: 2, expectedSuffix: 'roka',
    col: 'ROKA_T', workerCol: 'ROKA_W',
    prevCol: 'HURI_T', prevLabel: '振り', strict: false
  },
  '分析': {
    phase: 2, expectedSuffix: 'roka',
    col: 'BUNSEKI_T', workerCol: 'BUNSEKI_W',
    prevCol: 'ROKA_T', prevLabel: 'ろか', strict: false,
    requireWorkers: ['早川', '山口']
  }
};

const SUFFIX_TO_MODE = { 'huri': '振り', 'roka': 'ろか' };

// 担当者管理 (v2 では担当者リストのみサーバー保存。current は端末ローカル)
const DEFAULT_WORKERS = ['川村', '山田', '川添', '石徹白', '早川', '田中', '山口'];
const PROP_WORKERS = 'lab2_workers';

// パスワード (現場切替用、4桁数字、初期値1111)
const PROP_PASSWORD_HASH = 'lab2_password_hash';
const DEFAULT_PASSWORD   = '1111';
const PASSWORD_SALT      = 'shast-lab2-v2-salt';

// v2.54: 共有フォルダの現場一覧は廃止した。
// 一覧はパスワード無しで呼べたため、Web App URL を知られると全現場のブック名とIDが
// 見えてしまっていた。現場の指定は QR か URL 手入力だけにする (DriveApp も不要になった)。

// ========== Web App エントリ ==========
function doGet() {
  return ContentService
    .createTextOutput('shast LAB2 API (picker v2 専用) - APK からアクセスしてください')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  const respond = function(obj) {
    return ContentService
      .createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  };

  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const p = JSON.parse(raw);
    const action = p.action || '';

    switch (action) {
      case 'handleScan':
        return respond(handleScan(
          p.spreadsheetId, p.kind, p.mode, p.code,
          !!p.force, p.overrideWorker || '', !!p.confirmDeleted
        ));

      case 'savePickupExtra':
        return respond(savePickupExtra(p.spreadsheetId, p.kind, p.code, p.value));

      // ---- 担当者管理 ----
      case 'getWorkerList':
        return respond(getWorkerList());
      case 'addWorker':
        return respond(addWorker(p.name));
      case 'setCurrentWorker':
        return respond({ ok: true });   // 互換 noop (担当者は端末ローカル)

      // ---- 現場切替・パスワード ----
      case 'getSpreadsheetMeta':
        return respond(getSpreadsheetMeta(p.spreadsheetId));
      case 'verifyPassword':
        return respond(verifyPassword(p.password));
      case 'changePassword':
        return respond(changePassword(p.oldPassword, p.newPassword));

      // ---- ビュー用データ ----
      case 'getKentaiData':
        return respond(getKentaiData(p.spreadsheetId));
      case 'getSaishuAll':
        return respond(getSaishuAll(p.spreadsheetId));

      // ---- 日報 ----
      // v2.4: date (yyyy-MM-dd) を渡すと過去の日報も見れる。省略時は今日
      case 'getDailyReportData':
        return respond(getDailyReportData(p.spreadsheetId, p.date));
      // v2.4: 日報シートが存在する日付の一覧 (カレンダー用)
      case 'listDailyReportDates':
        return respond(listDailyReportDates(p.spreadsheetId));

      // ---- v2.55: ラベル印刷 ----
      case 'markLabelPrinted':
        return respond(markLabelPrinted(p.spreadsheetId, p.date, p.rows));
      case 'getLabelSiteName':
        return respond(getLabelSiteName(p.spreadsheetId));
      case 'setLabelSiteName':
        return respond(setLabelSiteName(p.spreadsheetId, p.name));
      // v2.56: 揃いラベルの二度刷り防止
      case 'getLabelPrinted':
        return respond(getLabelPrinted(p.spreadsheetId));
      case 'markCodeLabelPrinted':
        return respond(markCodeLabelPrinted(p.spreadsheetId, p.codes));

      // ---- 疎通確認 ----
      case 'ping':
        return respond({ ok: true, message: 'pong', version: APP_VERSION, time: new Date().toISOString() });

      default:
        return respond({ ok: false, message: 'unknown action: ' + action });
    }
  } catch (err) {
    return respond({ ok: false, message: 'doPost error: ' + (err && err.message ? err.message : String(err)) });
  }
}

// ========== スプレッドシート/現場ID ==========

function parseSpreadsheetIdFromInput(input) {
  if (!input) return '';
  // shastのシート取込QR（shast:sheet:URL）をそのまま渡されても通す
  const s = String(input).trim().replace(/^shast:sheet:/, '');
  if (!s) return '';
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return s;
}

function openSpreadsheet_(spreadsheetId) {
  const id = parseSpreadsheetIdFromInput(spreadsheetId);
  if (!id) throw new Error('スプレッドシートが設定されていません (現場切替から設定してください)');
  return SpreadsheetApp.openById(id);
}

/**
 * 件名シート B12 の現場IDを返す。無ければ null (=旧方式ブック)。
 */
function getSiteId_(ss) {
  try {
    const sheet = ss.getSheetByName(SHEET_KENMEI);
    if (!sheet) return null;
    const label = String(sheet.getRange(KENMEI_SITE_ID_LABEL_CELL).getValue() || '').trim();
    const value = String(sheet.getRange(KENMEI_SITE_ID_VALUE_CELL).getValue() || '').trim().toUpperCase();
    if (label !== '現場ID' || !value) return null;
    if (!/^[A-Z]{4}$/.test(value)) return null;
    return value;
  } catch (e) {
    return null;
  }
}

/**
 * v2ブックであることを確認して現場IDを返す。旧方式なら throw。
 */
function getSiteIdOrThrow_(ss) {
  const siteId = getSiteId_(ss);
  if (!siteId) {
    throw new Error('このブックは旧方式です (件名B12に現場IDがありません)。旧アプリ「shast LAB」を使ってください');
  }
  return siteId;
}

/**
 * 配管シートを取得 (表記ゆれ両対応)。
 */
function getHaikanSheet_(ss) {
  for (let i = 0; i < SHEET_HAIKAN_NAMES.length; i++) {
    const sheet = ss.getSheetByName(SHEET_HAIKAN_NAMES[i]);
    if (sheet) return sheet;
  }
  return null;
}

function getKindSheet_(ss, kind) {
  if (kind === '配管・ピット・盛り土下') return getHaikanSheet_(ss);
  if (kind === '表層土壌') return ss.getSheetByName(SHEET_HYOSO);
  if (kind === '土壌ガス') return ss.getSheetByName(SHEET_GAS);
  if (kind === '深度調査') return ss.getSheetByName(SHEET_FUKADO);
  return null;
}

// ========== コード解析 (v2形式 + 旧形式引き継ぎ) ==========
/**
 * v2形式:
 *  "TEDC-S-0001"        → { format:'v2', siteId:'TEDC', codeType:'S', baseCode:'TEDC-S-0001', suffix:'' }
 *  "TEDC-L-0001-huri"   → { format:'v2', siteId:'TEDC', codeType:'L', baseCode:'TEDC-L-0001', suffix:'huri' }
 * 旧形式 (v2ブックに引き継いで使う場合。種別文字は信用せずシート横断検索する):
 *  "0004-S-260715-0055"       → { format:'legacy', baseCode:'0004-S-260715-0055', suffix:'' }
 *  "0004-K-260715-0057-huri"  → { format:'legacy', baseCode:'0004-K-260715-0057', suffix:'huri' }
 * 形式外は null。
 */
function parseCodeV2(code) {
  const s = String(code || '').trim();
  const up = s.toUpperCase();
  // v2形式
  let m = up.match(/^([A-Z]{4})-(WG|WP|[SGHDL])-(\d{4})(?:-(HURI|ROKA))?$/);
  if (m) {
    return {
      format: 'v2',
      siteId: m[1],
      codeType: m[2],
      seq: m[3],
      suffix: m[4] ? m[4].toLowerCase() : '',
      baseCode: m[1] + '-' + m[2] + '-' + m[3]
    };
  }
  // 旧形式 (現場番号4桁-種別/色1〜2文字-日付6桁-連番4桁)
  m = up.match(/^(\d{4})-([A-Z]{1,2})-(\d{6})-(\d{4})(?:-(HURI|ROKA))?$/);
  if (m) {
    return {
      format: 'legacy',
      siteId: m[1],          // 数字の現場番号 (件名B12の英字IDとは照合しない)
      codeType: m[2],        // 種別/色文字だが信用しない (シート横断検索で決める)
      seq: m[4],
      suffix: m[5] ? m[5].toLowerCase() : '',
      baseCode: m[1] + '-' + m[2] + '-' + m[3] + '-' + m[4]
    };
  }
  return null;
}

/**
 * 旧形式コード用: 4シートのコード列を横断検索して最初にヒットした種別を返す。
 * (種別文字がランダム付与でも動くように、コードの文字には依存しない)
 * @return {Object|null} { kind, resolved } または null
 */
function findCodeAcrossSheets_(ss, baseCode) {
  const kinds = ['表層土壌', '土壌ガス', '配管・ピット・盛り土下', '深度調査'];
  for (let i = 0; i < kinds.length; i++) {
    try {
      const resolved = resolveByCode_(ss, kinds[i], baseCode);
      if (resolved) return { kind: kinds[i], resolved: resolved };
    } catch (e) { /* シート無しは次へ */ }
  }
  return null;
}

// ========== 実データシートの列解決 (v2.62: 見出し式) ==========
// picker が列を足しても壊れないよう、列番号の決め打ちをやめて見出し名で引く。
// 見出しが見つからない列は KIND_CONFIG.workCols の従来位置に落とす
// (現地確認の2列を picker が足す前でも今まで通り動かすため)。
const WORKCOL_HEADERS = {
  STATUS:       ['状態'],
  POINT:        ['地点名', '地点'],
  UD:           ['上下'],
  DEPTH:        ['深度', '採取深度'],
  CODE:         ['コード'],
  SAKKO_T:      ['削孔日時'],          SAKKO_W:   ['削孔担当'],
  SAISHU:       ['採取日時'],          SAISHU_W:  ['採取担当'],
  // v2.62: lab-kanri が書く列。shast が書く「採取日時」とは別物
  GENCHI_T:     ['現地確認日時'],      GENCHI_W:  ['現地確認担当'],
  UKEIRE:       ['受入日時', '受け入れ日時', '受入'],
  UKEIRE_W:     ['受入担当', '受け入れ担当'],
  FUKAN:        ['風乾日時', '風乾'],  FUKAN_W:   ['風乾担当'],
  BUNSEKI_T:    ['分析日時', '分析'],  BUNSEKI_W: ['分析担当'],
  GENCHI_DEPTH: ['現地深度']
};

/**
 * 実データシートの列を見出しで引く。1始まりの列番号を返す。
 * 見つからない名前は従来の位置のまま (無い列は 0)。
 */
function resolveWorkCols_(sheet, kc) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let header = [];
  try {
    header = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
      .map(function(v) { return String(v == null ? '' : v).trim(); });
  } catch (e) {}
  const cols = {};
  // まず従来の位置を土台にする (見出しが無い現場でも今まで通り動く)
  Object.keys(kc.workCols).forEach(function(k) { cols[k] = kc.workCols[k]; });
  // 見出しで見つかったものだけ上書き
  Object.keys(WORKCOL_HEADERS).forEach(function(k) {
    const names = WORKCOL_HEADERS[k];
    for (let i = 0; i < header.length; i++) {
      if (names.indexOf(header[i]) >= 0) { cols[k] = i + 1; return; }
    }
  });
  cols.__lastCol = lastCol;
  return cols;
}

/**
 * 実データシートのコード列で直接行を引く (v2の1回引き)。
 * @return {Object|null} { row, sheet, cols, point, ud, depth, status, extra } または null
 */
function resolveByCode_(ss, kind, baseCode) {
  const kc = KIND_CONFIG[kind];
  if (!kc) throw new Error('未対応の種別: ' + kind);
  const sheet = getKindSheet_(ss, kind);
  if (!sheet) throw new Error('「' + kind + '」シートが見つかりません');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const cols = resolveWorkCols_(sheet, kc);
  let maxCol = 1;
  Object.keys(cols).forEach(function(k) {
    if (k !== '__lastCol' && cols[k] > maxCol) maxCol = cols[k];
  });
  maxCol = Math.min(Math.max(maxCol, cols.__lastCol), sheet.getMaxColumns());
  const disp = sheet.getRange(2, 1, lastRow - 1, maxCol).getDisplayValues();
  const target = String(baseCode).trim().toUpperCase();

  for (let i = 0; i < disp.length; i++) {
    const r = disp[i];
    const cell = function(col) {
      return (col && col >= 1 && col <= r.length) ? String(r[col - 1]).trim() : '';
    };
    const codeVal = cell(cols.CODE).toUpperCase();
    if (codeVal !== target) continue;
    return {
      row: i + 2,
      sheet: sheet,
      cols: cols,
      point:  cell(cols.POINT),
      ud:     cell(cols.UD),
      depth:  cell(cols.DEPTH),
      status: cell(cols.STATUS),
      extra:  kc.extraCol ? cell(cols[kc.extraCol]) : ''
    };
  }
  return null;
}

// ========== メイン: スキャン処理 ==========
/**
 * @param {string} spreadsheetId
 * @param {string} kind  (v2では未使用。コードから種別が確定するため。互換で受けるだけ)
 * @param {string} mode  工程モード
 * @param {string} code  スキャンコード
 */
function handleScan(spreadsheetId, kind, mode, code, force, overrideWorker, confirmDeleted) {
  try {
    if (!code || !String(code).trim()) {
      return { ok: false, message: 'コードが空です' };
    }
    code = String(code).trim();

    let ss;
    try {
      ss = openSpreadsheet_(spreadsheetId);
    } catch (e) {
      return { ok: false, message: e.message };
    }

    // v2ゲート①: 旧方式ブックを拒否
    let siteId;
    try {
      siteId = getSiteIdOrThrow_(ss);
    } catch (e) {
      return { ok: false, message: e.message };
    }

    // v2.64: ラボ記録タブ案は取り下げた。現地確認・受入・風乾は実データタブへ、
    // 振り・ろか・分析は分析検体タブへ直接書く。
    // 作りかけの「ラボ記録」タブが残っていると分離構成と誤判定して
    // 「見出し『コード』が見つかりません」で止まるので、もう参照しない。
    const labSheet = null;

    // 担当者 (端末ローカルから毎回送信される)
    const worker = (overrideWorker && String(overrideWorker).trim()) ? String(overrideWorker).trim() : '';
    if (!worker) {
      return { ok: false, message: '担当者を選択してください' };
    }

    // コード解析 (v2形式 + 旧形式引き継ぎの両対応)
    const parsed = parseCodeV2(code);
    if (!parsed) {
      return { ok: false, message: 'コード形式を認識できません: ' + code + ' (例: ' + siteId + '-S-0001 / 0004-S-260715-0001)' };
    }

    // v2ゲート②: 現場ID照合 (SPEC §3.5 誤書き込み防止)
    // 旧形式コードは件名B12の英字IDと形が違うため照合しない
    // (シートのコード列に存在するかの検索自体が照合の代わりになる)
    if (parsed.format === 'v2' && parsed.siteId !== siteId) {
      return {
        ok: false,
        message: '別の現場のコードです (コード: ' + parsed.siteId + ' / この現場: ' + siteId + ')'
      };
    }

    let effectiveMode = mode;
    let autoSwitched = false;

    // ---- 振り/ろか/分析 (v2: Lコード / 旧形式: 色文字+suffix コード) ----
    // v2.62: 振りコードを廃止し、ろかコード1本をラボ内で使い回す方針になった。
    // そのため接尾辞で工程を決めるのをやめ、他の工程と同じくモードボタンで決める。
    // (以前は -roka を読むと必ず「ろか」に切り替わっていたので、振りが記録できなくなる)
    if (parsed.codeType === 'L' || (parsed.format === 'legacy' && parsed.suffix)) {
      const PHASE2_MODES = ['振り', 'ろか', '分析'];
      if (PHASE2_MODES.indexOf(effectiveMode) < 0) {
        return {
          ok: false,
          message: '分析検体のコードです。振り / ろか / 分析 のどれかを選んでください (現在: ' +
                   (effectiveMode || '未選択') + ')'
        };
      }
      const cfg2 = MODES[effectiveMode];
      if (cfg2.requireWorkers && cfg2.requireWorkers.indexOf(worker) < 0) {
        return { ok: false, message: '分析モードは ' + cfg2.requireWorkers.join('・') + ' のみ使用できます (現在: ' + worker + ')' };
      }
      // v2.62: 振り/ろか/分析は分析検体シートが正本。
      // handlePhase2V2 が「分析検体に記録列があればそちら、無ければ前処理シート」を判断する。
      // ラボ記録シートを使う旧案は取り下げたので、分析検体に列がある時はそちらを優先する
      const kInfo = lookupKentaiByLCode_(ss, parsed.baseCode);
      const kentaiReady = !!(kInfo.row && kInfo.cols &&
                             kInfo.cols[cfg2.col] && kInfo.cols[cfg2.workerCol]);
      if (labSheet && !kentaiReady) {
        return handlePhase2Lab_(ss, labSheet, effectiveMode, parsed, worker, force, autoSwitched);
      }
      return handlePhase2V2(ss, effectiveMode, cfg2, parsed, worker, force, autoSwitched);
    }

    // ---- 実データコード: phase1 ----
    if (parsed.suffix) {
      return { ok: false, message: '-huri/-roka はLコード (分析検体) にだけ付きます: ' + code };
    }
    if (!effectiveMode) {
      return { ok: false, message: 'モードを選択してください' };
    }
    const cfg = MODES[effectiveMode];
    if (!cfg) return { ok: false, message: 'モードが不正です: ' + effectiveMode };

    // 種別と行の解決
    //  - v2形式: コードの種別文字 → シート直行
    //  - 旧形式: 種別文字を信用せず4シートのコード列を横断検索
    let effectiveKind;
    let isWater;
    let resolved;
    if (parsed.format === 'v2') {
      effectiveKind = CODE_TYPE_TO_KIND[parsed.codeType];
      isWater = WATER_CODE_TYPES.indexOf(parsed.codeType) >= 0;
      resolved = resolveByCode_(ss, effectiveKind, parsed.baseCode);
      if (!resolved) {
        return { ok: false, message: 'コード ' + parsed.baseCode + ' が「' + effectiveKind + '」シートに見つかりません' };
      }
    } else {
      const found = findCodeAcrossSheets_(ss, parsed.baseCode);
      if (!found) {
        return { ok: false, message: 'コード ' + parsed.baseCode + ' がどの実データシートにも見つかりません' };
      }
      effectiveKind = found.kind;
      resolved = found.resolved;
      // 旧形式は地下水判定不可 → 深度調査シートの通常行として扱う
      isWater = false;
    }
    const kc = KIND_CONFIG[effectiveKind];

    // 分析モード権限チェック
    if (cfg.requireWorkers && cfg.requireWorkers.indexOf(worker) < 0) {
      return { ok: false, message: '分析モードは ' + cfg.requireWorkers.join('・') + ' のみ使用できます (現在: ' + worker + ')' };
    }

    // ガスの分析はガスシート直書き (phase1扱い)。他種別の分析はLコードのみ。
    if (effectiveMode === '分析' && effectiveKind !== '土壌ガス') {
      return { ok: false, message: '分析モードでは -roka 付きのLコードを読んでください' };
    }

    // 分離構成: 削孔は現場(shast)側の記録なのでラボアプリからは書けない
    if (labSheet && effectiveMode === '削孔') {
      return { ok: false, message: '分離構成のブックでは削孔は現場(shast)側の記録です' };
    }

    // availableModes チェック (地下水はさらに制限)
    let allowedModes = isWater ? WATER_AVAILABLE_MODES : kc.availableModes;
    // 分離構成のガス: 受入・分析はラボ記録へ。削孔は上で拒否済み → 採取(現地確認)/受入/分析
    if (labSheet && effectiveKind === '土壌ガス' && !isWater) {
      allowedModes = ['採取', '受入', '分析'];
    }
    if (allowedModes && allowedModes.indexOf(effectiveMode) < 0) {
      const label = isWater ? '地下水 (WG/WP)' : effectiveKind;
      return {
        ok: false,
        message: '「' + label + '」では「' + effectiveMode + '」モードは使えません。使用可: ' + allowedModes.join(' / ')
      };
    }

    // 状態=削除 の確認
    if (resolved.status === '削除' && !confirmDeleted) {
      return {
        ok: false,
        needConfirm: 'deleted',
        message: 'この地点は「削除」状態です。' + resolved.point +
                 (resolved.ud ? '(' + udDisplay(resolved.ud) + ')' : '') +
                 ' に ' + effectiveMode + ' を赤文字で記録しますか？',
        kind: effectiveKind,
        mode: effectiveMode,
        code: parsed.baseCode,
        autoMode: null
      };
    }

    const isDeleted = (resolved.status === '削除');
    // 分離構成: ラボ工程はラボ記録シートへ (実データシートは読み取り専用)
    if (labSheet) {
      return handlePhase1Lab_(ss, labSheet, effectiveKind, effectiveMode, parsed, worker, force, isDeleted, resolved, isWater);
    }
    return handlePhase1V2(ss, effectiveKind, effectiveMode, cfg, parsed, worker, force, isDeleted, resolved, isWater);

  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== フェーズ1 (v2: 行既知なので直接書込) ==========
function handlePhase1V2(ss, kind, mode, cfg, parsed, worker, force, isDeleted, resolved, isWater) {
  const kc = KIND_CONFIG[kind];
  const sheet = resolved.sheet;
  const foundRow = resolved.row;
  const point = resolved.point;
  const ud = resolved.ud;
  if (!point) {
    return { ok: false, message: 'コード ' + parsed.baseCode + ' の行に地点名がありません' };
  }

  // v2.62: 見出しで解決した列を使う (無ければ従来位置)
  const cols = resolved.cols || kc.workCols;
  // 採取モードは「現地確認日時」列があればそちらへ書く。
  // shast が書く「採取日時」とは別物なので、列を分けて取り合いを無くす。
  // 列がまだ無い現場では従来どおり採取列に書く (picker の追加を待たずに動かすため)
  let colKey = cfg.col, workerKey = cfg.workerCol;
  if (mode === '採取' && cols.GENCHI_T && cols.GENCHI_W) {
    colKey = 'GENCHI_T'; workerKey = 'GENCHI_W';
  }
  const targetCol = cols[colKey];
  const workerCol = cols[workerKey];
  if (!targetCol || !workerCol) {
    return { ok: false, message: kind + ' は ' + mode + ' モードに未対応です' };
  }
  const modeLabel = (colKey === 'GENCHI_T') ? '現地確認' : mode;
  const targetCell = sheet.getRange(foundRow, targetCol);

  // 二重チェック (v2.5: 地点名と経過時間を出して二重スキャンを見分けられるように)
  const existing = targetCell.getValue();
  if (existing) {
    const prevW = String(sheet.getRange(foundRow, workerCol).getDisplayValue() || '').trim();
    const ptDisp = point + (kc.hasUd ? '(' + udDisplay(ud) + ')' : (resolved.depth ? '(' + resolved.depth + ')' : ''));
    return {
      ok: false,
      point: point, kind: kind, mode: mode,
      message: alreadyRecordedMsg_(modeLabel, existing, ptDisp, prevW)
    };
  }

  // 順番チェック (種別固有の modeOverrides 優先)
  const modeOverride = (kc.modeOverrides && kc.modeOverrides[mode]) || null;
  const effectivePrevCol = (modeOverride && ('prevCol' in modeOverride))
    ? modeOverride.prevCol
    : cfg.prevCol;
  if (effectivePrevCol) {
    const prevCol = cols[effectivePrevCol];
    if (prevCol) {
      const prevVal = sheet.getRange(foundRow, prevCol).getValue();
      if (!prevVal) {
        const prevName = phase1ColName(effectivePrevCol);
        if (cfg.strict) {
          return { ok: false, message: prevName + ' が未記録です。先に ' + prevName + ' を記録してください' };
        } else if (!force) {
          return {
            ok: false, needConfirm: true,
            message: prevName + ' が完了していませんが ' + mode + ' を記録しますか？',
            mode: mode, code: parsed.baseCode,
            autoMode: null
          };
        }
      }
    }
  }

  // 書込 (削除地点なら赤文字)
  const now = new Date();
  const fontColor = isDeleted ? DELETED_FONT_COLOR : null;
  targetCell.setValue(now);
  targetCell.setNumberFormat('yyyy/MM/dd HH:mm');
  targetCell.setFontColor(fontColor);
  const workerCell = sheet.getRange(foundRow, workerCol);
  workerCell.setValue(worker);
  workerCell.setFontColor(fontColor);

  // 日報 (土壌ガスは除外)。B列: 表層=上下 / 配管・深度=深度 / 地下水=「地下水」
  if (kind !== '土壌ガス') {
    try {
      let dailyBCol = '';
      if (kc.hasUd) dailyBCol = udDisplay(ud);
      else if (isWater) dailyBCol = '地下水';
      else if (cols.DEPTH) dailyBCol = resolved.depth || '';
      logToDailyReport(ss, modeLabel, point, dailyBCol, worker, now);
    } catch (e) {}
  }

  // 追加入力ダイアログ判定
  //  - 配管: 受入時、現地深度(K列)が空なら入力促し (空白のみ書込・既存値は保護)
  //  - 地下水 (WG/WP): 採取/受入時、深度列(C)が空なら水位入力促し
  let needExtra = null;
  if (isWater) {
    if (WATER_EXTRA.onModes.indexOf(mode) >= 0 && !resolved.depth) {
      needExtra = {
        type: WATER_EXTRA.type, label: WATER_EXTRA.label,
        kind: kind + ':WATER',   // savePickupExtra 用の識別子
        code: parsed.baseCode, point: point
      };
    }
  } else if (kc.extraCol && kc.extraOnModes &&
             kc.extraOnModes.indexOf(mode) >= 0 && !resolved.extra) {
    needExtra = {
      type: kc.extraType || 'plain', label: kc.extraLabel || '入力',
      kind: kind,
      code: parsed.baseCode, point: point,
      hint: resolved.depth ? ('計画深度: ' + resolved.depth) : ''
    };
  }

  const udDispMsg = kc.hasUd ? '(' + udDisplay(ud) + ')' : (resolved.depth ? '(' + resolved.depth + ')' : (isWater ? '(地下水)' : ''));
  const delTag = isDeleted ? ' [削除地点・赤文字]' : '';
  return {
    ok: true,
    message: modeLabel + ' 記録完了: ' + point + udDispMsg + ' 担当:' + worker + delTag,
    kind: kind,
    mode: mode, modeLabel: modeLabel, autoMode: null,
    point: point, ud: ud, worker: worker,
    isDeleted: isDeleted,
    needExtra: needExtra,
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss')
  };
}

// ========== 分離構成: フェーズ1 (ラボ記録シートへ find-or-append) ==========
// SPEC_sheet_ownership.md §3.2。実データシートは読み取り専用 (地点/状態/深度の解決のみ)。
function handlePhase1Lab_(ss, labSheet, kind, mode, parsed, worker, force, isDeleted, resolved, isWater) {
  const mc = LABREC_MODE[mode];
  if (!mc) return { ok: false, message: 'モードが不正です: ' + mode };
  const point = resolved.point;
  if (!point) {
    return { ok: false, message: 'コード ' + parsed.baseCode + ' の行に地点名がありません' };
  }

  const cols = getLabRecCols_(labSheet);
  const kindLabel = labKindLabel_(kind, resolved.ud, parsed.codeType);
  const row = findOrAppendLabRow_(labSheet, cols, parsed.baseCode, point, kindLabel);

  const targetCell = labSheet.getRange(row, cols[mc.t]);

  // 二重チェック (v2.5: 地点名と経過時間を出して二重スキャンを見分けられるように)
  const existing = targetCell.getValue();
  if (existing) {
    const prevW = String(labSheet.getRange(row, cols[mc.w]).getDisplayValue() || '').trim();
    const kc0 = KIND_CONFIG[kind];
    const ptDisp = point + ((kc0 && kc0.hasUd) ? '(' + udDisplay(resolved.ud) + ')'
                  : (resolved.depth ? '(' + resolved.depth + ')' : (isWater ? '(地下水)' : '')));
    return {
      ok: false,
      point: point, kind: kind, mode: mode,
      message: alreadyRecordedMsg_(mc.label, existing, ptDisp, prevW)
    };
  }

  // 順番チェック (ガスの分析は受入が前。それ以外は LABREC_MODE の定義)
  let prevHeader = mc.prev;
  let prevLabel = mc.prevLabel;
  if (mode === '分析' && kind === '土壌ガス') {
    prevHeader = LABREC_H.UKEIRE_T;
    prevLabel = '受入';
  }
  if (prevHeader) {
    const prevVal = labSheet.getRange(row, cols[prevHeader]).getValue();
    if (!prevVal) {
      if (mc.strict) {
        return { ok: false, message: prevLabel + ' が未記録です。先に ' + prevLabel + ' を記録してください' };
      } else if (!force) {
        return {
          ok: false, needConfirm: true,
          message: prevLabel + ' が完了していませんが ' + mc.label + ' を記録しますか？',
          mode: mode, code: parsed.baseCode,
          autoMode: null
        };
      }
    }
  }

  // 書込 (削除地点なら赤文字)
  const now = new Date();
  const fontColor = isDeleted ? DELETED_FONT_COLOR : null;
  targetCell.setValue(now);
  targetCell.setNumberFormat('yyyy/MM/dd HH:mm');
  targetCell.setFontColor(fontColor);
  const workerCell = labSheet.getRange(row, cols[mc.w]);
  workerCell.setValue(worker);
  workerCell.setFontColor(fontColor);

  // 日報 (土壌ガス除外・対象工程は DAILY_REPORT_MODES = 現行踏襲)
  if (kind !== '土壌ガス') {
    try {
      const kc = KIND_CONFIG[kind];
      let dailyBCol = '';
      if (kc && kc.hasUd) dailyBCol = udDisplay(resolved.ud);
      else if (isWater) dailyBCol = '地下水';
      else dailyBCol = resolved.depth || '';
      logToDailyReport(ss, mode, point, dailyBCol, worker, now);
    } catch (e) {}
  }

  // 追加入力: ラボ深度列 (§3.3 実データシートには書かない)
  //  - 配管: 受入時、ラボ深度が空なら現地深度入力を促す (計画深度をヒント表示)
  //  - 地下水 (WG/WP): 現地確認/受入時、ラボ深度が空なら水位入力を促す
  let needExtra = null;
  try {
    const labDepth = String(labSheet.getRange(row, cols[LABREC_H.LAB_DEPTH]).getDisplayValue() || '').trim();
    if (!labDepth) {
      if (isWater && WATER_EXTRA.onModes.indexOf(mode) >= 0) {
        needExtra = { type: 'plain', label: '水位', kind: kind + ':LAB', code: parsed.baseCode, point: point };
      } else if (kind === '配管・ピット・盛り土下' && mode === '受入') {
        needExtra = {
          type: 'depth-range', label: '現地深度', kind: kind + ':LAB',
          code: parsed.baseCode, point: point,
          hint: resolved.depth ? ('計画深度: ' + resolved.depth) : ''
        };
      }
    }
  } catch (e) {}

  const kc2 = KIND_CONFIG[kind];
  const udDispMsg = (kc2 && kc2.hasUd) ? '(' + udDisplay(resolved.ud) + ')'
    : (resolved.depth ? '(' + resolved.depth + ')' : (isWater ? '(地下水)' : ''));
  const delTag = isDeleted ? ' [削除地点・赤文字]' : '';
  return {
    ok: true,
    message: mc.label + ' 記録完了: ' + point + udDispMsg + ' 担当:' + worker + delTag,
    kind: kind,
    mode: mode, autoMode: null,
    point: point, ud: resolved.ud, worker: worker,
    isDeleted: isDeleted,
    needExtra: needExtra,
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss')
  };
}

// ========== 分離構成: フェーズ2 (Lコード 振り/ろか/分析 → ラボ記録シート) ==========
// 暫定「前処理」シートの正式な置き換え (SPEC_sheet_ownership.md §3.2)。
function handlePhase2Lab_(ss, labSheet, mode, parsed, worker, force, autoSwitched) {
  const mc = LABREC_MODE[mode];
  if (!mc) return { ok: false, message: 'モードが不正です: ' + mode };

  const info = lookupKentaiByLCode_(ss, parsed.baseCode);
  const cols = getLabRecCols_(labSheet);
  const kindLabel = info.color ? ('検体・' + info.color) : '検体';
  const row = findOrAppendLabRow_(labSheet, cols, parsed.baseCode, info.point, kindLabel);

  const targetCell = labSheet.getRange(row, cols[mc.t]);

  // 二重チェック (v2.5: 区画名・色と経過時間を出す)
  const existing = targetCell.getValue();
  if (existing) {
    const prevW = String(labSheet.getRange(row, cols[mc.w]).getDisplayValue() || '').trim();
    const ptDisp = (info.point || parsed.baseCode) + (info.color ? ' ' + info.color : '');
    return {
      ok: false,
      point: info.point || parsed.baseCode, mode: mode,
      message: alreadyRecordedMsg_(mc.label, existing, ptDisp, prevW)
    };
  }

  // 順番チェック (振り→ろか→分析)
  if (mc.prev) {
    const prevVal = labSheet.getRange(row, cols[mc.prev]).getValue();
    if (!prevVal && !force) {
      return {
        ok: false, needConfirm: true,
        message: (mc.prevLabel || '前工程') + ' が完了していませんが ' + mc.label + ' を記録しますか？',
        mode: mode, code: parsed.baseCode + '-' + (parsed.suffix || ''),
        autoMode: autoSwitched ? mode : null
      };
    }
  }

  // 書込
  const now = new Date();
  targetCell.setValue(now);
  targetCell.setNumberFormat('yyyy/MM/dd HH:mm');
  labSheet.getRange(row, cols[mc.w]).setValue(worker);

  // 日報 (振り/ろかのみ。logToDailyReport 内で対象工程フィルタ)
  try {
    logToDailyReport(ss, mode, info.point || parsed.baseCode, info.color, worker, now);
  } catch (e) {}

  const disp = info.point ? (info.point + (info.color ? ' ' + info.color : '')) : parsed.baseCode;
  return {
    ok: true,
    message: mc.label + ' 記録完了: ' + disp + ' 担当:' + worker,
    mode: mode, autoMode: autoSwitched ? mode : null,
    point: info.point || parsed.baseCode, color: info.color, worker: worker,
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss')
  };
}

// ========== 追加入力 (配管の現地深度 / 地下水の水位) ==========
/**
 * v2: 実データシートに直接書く (地点抽出は無い)。
 * 空白の場合だけ書込み。既存値がある場合は上書きしない (現地データ保護)。
 * kind に ':WATER' サフィックスが付いていたら地下水 (深度列へ水位)。
 */
function savePickupExtra(spreadsheetId, kind, baseCode, value) {
  try {
    const isLab = String(kind || '').indexOf(':LAB') >= 0;
    const isWater = String(kind || '').indexOf(':WATER') >= 0;
    const realKind = String(kind || '').replace(':WATER', '').replace(':LAB', '');
    const kc = KIND_CONFIG[realKind];
    if (!kc) return { ok: false, message: '不明な種別: ' + kind };

    const ss = openSpreadsheet_(spreadsheetId);
    getSiteIdOrThrow_(ss);

    const parsed = parseCodeV2(baseCode);
    if (!parsed) return { ok: false, message: 'コード形式が不正です: ' + baseCode };

    // 分離構成: ラボ記録シートのラボ深度列へ (空白のみ。実データシートには書かない §3.3)
    if (isLab) {
      const labSheet = ss.getSheetByName(SHEET_LABREC);
      if (!labSheet) return { ok: false, message: 'ラボ記録シートが見つかりません' };
      const cols = getLabRecCols_(labSheet);
      const lastRow = labSheet.getLastRow();
      let row = -1;
      if (lastRow >= 2) {
        const codes = labSheet.getRange(2, cols[LABREC_H.CODE], lastRow - 1, 1).getDisplayValues();
        const target = parsed.baseCode.toUpperCase();
        for (let i = 0; i < codes.length; i++) {
          if (String(codes[i][0]).trim().toUpperCase() === target) { row = i + 2; break; }
        }
      }
      if (row < 0) return { ok: false, message: 'コード ' + parsed.baseCode + ' の行がラボ記録に見つかりません (先にスキャンしてください)' };
      const label = (realKind === '配管・ピット・盛り土下') ? '現地深度' : '水位';
      const cur = String(labSheet.getRange(row, cols[LABREC_H.LAB_DEPTH]).getDisplayValue() || '').trim();
      if (cur) {
        return { ok: false, message: label + ' は既に入力済み: ' + cur + ' (上書きしません)' };
      }
      let wv = String(value || '').trim();
      if (realKind === '配管・ピット・盛り土下') wv = formatDepthRange_(wv);
      if (!wv) return { ok: false, message: '入力値が空です' };
      labSheet.getRange(row, cols[LABREC_H.LAB_DEPTH]).setValue(wv);
      return { ok: true, message: label + ' を記録 (ラボ深度): ' + wv, written: wv };
    }

    const resolved = resolveByCode_(ss, realKind, parsed.baseCode);
    if (!resolved) return { ok: false, message: 'コード ' + parsed.baseCode + ' の行が見つかりません' };

    let targetCol;
    let label;
    let extraType;
    if (isWater) {
      targetCol = kc.workCols[WATER_EXTRA.col];
      label = WATER_EXTRA.label;
      extraType = WATER_EXTRA.type;
    } else {
      if (!kc.extraCol) return { ok: false, message: realKind + ' は追加入力に未対応' };
      targetCol = kc.workCols[kc.extraCol];
      label = kc.extraLabel;
      extraType = kc.extraType;
    }

    // 空白のみ書込み (既存値は保護)
    const cur = String(resolved.sheet.getRange(resolved.row, targetCol).getDisplayValue() || '').trim();
    if (cur) {
      return { ok: false, message: label + ' は既に入力済み: ' + cur + ' (上書きしません)' };
    }

    let writeValue = String(value || '').trim();
    if (extraType === 'depth-range') {
      writeValue = formatDepthRange_(writeValue);
    }
    if (!writeValue) return { ok: false, message: '入力値が空です' };

    resolved.sheet.getRange(resolved.row, targetCol).setValue(writeValue);
    return { ok: true, message: label + ' を記録: ' + writeValue, written: writeValue };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// v7.4互換: 配管深度の範囲展開 "1.0" → "1.00-1.50m" (+0.5)
function formatDepthRange_(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  s = s.replace(/m$/i, '').trim();
  if (s.indexOf('-') >= 0 || s.indexOf('〜') >= 0 || s.indexOf('~') >= 0) {
    return /m$/i.test(input) ? String(input).trim() : String(input).trim() + 'm';
  }
  const num = parseFloat(s);
  if (isNaN(num)) return String(input).trim();
  return num.toFixed(2) + '-' + (num + 0.5).toFixed(2) + 'm';
}

/**
 * v2.5: 「既に記録済み」メッセージを作る。
 * 地点名と「何分前か」を入れて、二重スキャン (直前) と過去の記録を見分けられるようにする。
 * @param {string} modeLabel 工程名
 * @param {*} existing セルの既存値 (Date or 文字列)
 * @param {string} pointDisp 地点表示 (例: "A1-1(上)")
 * @param {string} [worker] 記録した担当者
 */
function alreadyRecordedMsg_(modeLabel, existing, pointDisp, worker) {
  const t = (existing instanceof Date) ? existing : new Date(existing);
  const valid = t && !isNaN(t.getTime());
  const when = valid ? Utilities.formatDate(t, 'Asia/Tokyo', 'MM/dd HH:mm') : String(existing);
  let ago = '';
  if (valid) {
    const diffMin = Math.floor((Date.now() - t.getTime()) / 60000);
    if (diffMin < 1)        ago = '（たった今）';
    else if (diffMin < 60)  ago = '（' + diffMin + '分前）';
    else if (diffMin < 1440) ago = '（' + Math.floor(diffMin / 60) + '時間前）';
    else                    ago = '（' + Math.floor(diffMin / 1440) + '日前）';
  }
  const who = worker ? ' ' + worker : '';
  const pt = pointDisp ? pointDisp + ' は' : '';
  return pt + modeLabel + '記録済み: ' + when + ago + who;
}

function phase1ColName(colKey) {
  switch (colKey) {
    case 'SAKKO_T':   return '削孔';
    case 'SAISHU':    return '採取';
    case 'UKEIRE':    return '受入';
    case 'FUKAN':     return '風乾';
    case 'BUNSEKI_T': return '分析';
    default: return colKey;
  }
}

// ========== フェーズ2 (v2暫定: 振り/ろか/分析(土壌) → 前処理シート) ==========
/**
 * 【暫定実装】v2では前処理シートが廃止されたが、振り/ろか/分析の
 * 日時・担当の記録先が仕様上未定のため、本スクリプトが「前処理」シートを
 * 自前で作成して記録する。書込先が正式決定したらここを差し替える。
 *
 * 行の同定: Lコード (TEDC-L-0001)。分析検体シートの Q列(振り)/R列(ろか) から
 * 区画名と色を補足して記録する (見つからなくても記録は続行)。
 */
/**
 * v2.62: 振り/ろか/分析 を分析検体シートの行に直接書く。
 * 混合すると複数地点が1検体になるので、実データシートの行では表せない。
 * 分析検体シートの1行がその検体そのものなので、そこが正本。
 * 行は必ず既にある (picker が作る) ので追記はしない。
 */
function handlePhase2Kentai_(ss, info, mode, cfg, parsed, worker, force, autoSwitched) {
  const sheet = info.sheet;
  const row = info.row;
  const c = info.cols;
  const targetCell = sheet.getRange(row, c[cfg.col]);
  const ptDisp = (info.point || parsed.baseCode) + (info.color ? ' ' + info.color : '');

  // 二重チェック
  const existing = targetCell.getValue();
  if (existing) {
    const prevW = String(sheet.getRange(row, c[cfg.workerCol]).getDisplayValue() || '').trim();
    return {
      ok: false,
      point: info.point || parsed.baseCode, mode: mode,
      message: alreadyRecordedMsg_(mode, existing, ptDisp, prevW)
    };
  }

  // 順番チェック (前工程の列がある時だけ)
  if (cfg.prevCol && c[cfg.prevCol]) {
    const prevVal = sheet.getRange(row, c[cfg.prevCol]).getValue();
    if (!prevVal && !force) {
      return {
        ok: false, needConfirm: true,
        message: (cfg.prevLabel || '前工程') + ' が完了していませんが ' + mode + ' を記録しますか？',
        mode: mode, code: parsed.baseCode + (parsed.suffix ? '-' + parsed.suffix : ''),
        autoMode: null
      };
    }
  }

  const now = new Date();
  targetCell.setValue(now);
  targetCell.setNumberFormat('yyyy/MM/dd HH:mm');
  sheet.getRange(row, c[cfg.workerCol]).setValue(worker);

  try { logToDailyReport(ss, mode, info.point || parsed.baseCode, info.color, worker, now); } catch (e) {}

  return {
    ok: true,
    message: mode + ' 記録完了: ' + ptDisp + ' 担当:' + worker,
    mode: mode, autoMode: null,
    point: info.point || parsed.baseCode, color: info.color, worker: worker,
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss')
  };
}

function handlePhase2V2(ss, mode, cfg, parsed, worker, force, autoSwitched) {
  // v2.58: 同じ処理が2か所にあったので lookupKentaiByLCode_ に寄せた (見出し式)
  const kentaiInfo = lookupKentaiByLCode_(ss, parsed.baseCode);
  const kentaiPoint = kentaiInfo.point;
  const kentaiColor = kentaiInfo.color;

  // v2.62: 分析検体シートに記録列があればそこへ書く (混合検体の正本はこの行)。
  // 列が無い現場では従来の前処理シートに落とす
  if (kentaiInfo.row && kentaiInfo.cols &&
      kentaiInfo.cols[cfg.col] && kentaiInfo.cols[cfg.workerCol]) {
    return handlePhase2Kentai_(ss, kentaiInfo, mode, cfg, parsed, worker, force, autoSwitched);
  }

  // 前処理シート (無ければ作成)
  let sheet = ss.getSheetByName(SHEET_ZENSHORI);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ZENSHORI);
    sheet.getRange(1, 1, 1, ZENSHORI_HEADER.length).setValues([ZENSHORI_HEADER]);
    sheet.getRange(1, 1, 1, ZENSHORI_HEADER.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  // Lコードで行検索 (無ければ追加)
  const lastRow = sheet.getLastRow();
  let foundRow = -1;
  if (lastRow >= 2) {
    const codes = sheet.getRange(2, COL_ZENSHORI.CODE, lastRow - 1, 1).getDisplayValues();
    const target = parsed.baseCode.toUpperCase();
    for (let i = 0; i < codes.length; i++) {
      if (String(codes[i][0]).trim().toUpperCase() === target) { foundRow = i + 2; break; }
    }
  }
  if (foundRow < 0) {
    foundRow = Math.max(sheet.getLastRow(), 1) + 1;
    sheet.getRange(foundRow, COL_ZENSHORI.CODE).setValue(parsed.baseCode);
    if (kentaiPoint) sheet.getRange(foundRow, COL_ZENSHORI.POINT).setValue(kentaiPoint);
    if (kentaiColor) sheet.getRange(foundRow, COL_ZENSHORI.COLOR).setValue(kentaiColor);
  }

  const targetCol = COL_ZENSHORI[cfg.col];
  const workerCol = COL_ZENSHORI[cfg.workerCol];
  const targetCell = sheet.getRange(foundRow, targetCol);

  // 二重チェック (v2.5: 区画名・色と経過時間を出す)
  const existing = targetCell.getValue();
  if (existing) {
    const prevW = String(sheet.getRange(foundRow, workerCol).getDisplayValue() || '').trim();
    const ptDisp = (kentaiPoint || parsed.baseCode) + (kentaiColor ? ' ' + kentaiColor : '');
    return {
      ok: false,
      point: kentaiPoint || parsed.baseCode, mode: mode,
      message: alreadyRecordedMsg_(mode, existing, ptDisp, prevW)
    };
  }

  // 順番チェック
  if (cfg.prevCol) {
    const prevVal = sheet.getRange(foundRow, COL_ZENSHORI[cfg.prevCol]).getValue();
    if (!prevVal && !force) {
      return {
        ok: false, needConfirm: true,
        message: (cfg.prevLabel || '前工程') + ' が完了していませんが ' + mode + ' を記録しますか？',
        mode: mode, code: parsed.baseCode + '-' + (cfg.expectedSuffix || parsed.suffix),
        autoMode: autoSwitched ? mode : null
      };
    }
  }

  // 書込
  const now = new Date();
  targetCell.setValue(now);
  targetCell.setNumberFormat('yyyy/MM/dd HH:mm');
  sheet.getRange(foundRow, workerCol).setValue(worker);

  // 日報 (振り/ろかのみ。分析は除外)
  try {
    const label = kentaiPoint || parsed.baseCode;
    logToDailyReport(ss, mode, label, kentaiColor, worker, now);
  } catch (e) {}

  const disp = kentaiPoint ? (kentaiPoint + (kentaiColor ? ' ' + kentaiColor : '')) : parsed.baseCode;
  return {
    ok: true,
    message: mode + ' 記録完了: ' + disp + ' 担当:' + worker,
    mode: mode, autoMode: autoSwitched ? mode : null,
    point: kentaiPoint || parsed.baseCode, color: kentaiColor, worker: worker,
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss')
  };
}

// ========== パスワード認証 ==========
function hashPassword_(password) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, PASSWORD_SALT + String(password), Utilities.Charset.UTF_8
  );
  return raw.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function getStoredPasswordHash_() {
  const props = PropertiesService.getScriptProperties();
  let h = props.getProperty(PROP_PASSWORD_HASH);
  if (!h) {
    h = hashPassword_(DEFAULT_PASSWORD);
    props.setProperty(PROP_PASSWORD_HASH, h);
  }
  return h;
}

function verifyPassword(password) {
  const ok = hashPassword_(String(password || '')) === getStoredPasswordHash_();
  return ok ? { ok: true } : { ok: false, message: 'パスワードが違います' };
}

function changePassword(oldPassword, newPassword) {
  if (hashPassword_(String(oldPassword || '')) !== getStoredPasswordHash_()) {
    return { ok: false, message: '現在のパスワードが違います' };
  }
  const np = String(newPassword || '').trim();
  if (!/^\d{4}$/.test(np)) {
    return { ok: false, message: '新しいパスワードは4桁の数字にしてください' };
  }
  PropertiesService.getScriptProperties().setProperty(PROP_PASSWORD_HASH, hashPassword_(np));
  return { ok: true, message: 'パスワードを変更しました' };
}

// ========== 担当者管理 ==========
function getWorkerList() {
  const props = PropertiesService.getScriptProperties();
  let added = [];
  try {
    const json = props.getProperty(PROP_WORKERS);
    if (json) added = JSON.parse(json);
  } catch (e) {}
  const merged = DEFAULT_WORKERS.concat(added.filter(function(n) { return DEFAULT_WORKERS.indexOf(n) < 0; }));
  return { workers: merged, current: '' };
}

function addWorker(name) {
  name = String(name || '').trim();
  if (!name) return { ok: false, message: '名前が空です' };
  const props = PropertiesService.getScriptProperties();
  let added = [];
  try {
    const json = props.getProperty(PROP_WORKERS);
    if (json) added = JSON.parse(json);
  } catch (e) {}
  if (DEFAULT_WORKERS.indexOf(name) >= 0 || added.indexOf(name) >= 0) {
    return { ok: false, message: '既に登録されています: ' + name };
  }
  added.push(name);
  props.setProperty(PROP_WORKERS, JSON.stringify(added));
  return { ok: true, workers: DEFAULT_WORKERS.concat(added) };
}

// ========== 現場切替 ==========
/**
 * v2: ブック検証を兼ねる。旧方式ブック (B12なし) はここで弾く。
 */
function getSpreadsheetMeta(spreadsheetId) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    const siteId = getSiteId_(ss);
    if (!siteId) {
      return { ok: false, message: 'このブックは旧方式です (件名B12に現場IDなし)。旧アプリ「shast LAB」で開いてください' };
    }
    // structure: 分離構成 (ラボ記録あり) or 現行構成
    // v2.64: 分離構成(ラボ記録タブ)は廃止。実データタブに現地確認列があるかで判定する
    let structure = '現行構成';
    try {
      const hy = getKindSheet_(ss, '表層土壌');
      if (hy) {
        const hc = resolveWorkCols_(hy, KIND_CONFIG['表層土壌']);
        if (hc.GENCHI_T) structure = '現地確認あり';
      }
    } catch (e) {}
    return { ok: true, id: ss.getId(), name: ss.getName(), url: ss.getUrl(), siteId: siteId, structure: structure };
  } catch (e) {
    return { ok: false, message: 'スプレッドシートを開けません: ' + e.message };
  }
}

// ========== 日報 ==========
const DAILY_REPORT_MODES = ['受入', '風乾', '振り', 'ろか'];
// v2.55: 末尾に「ラベル印刷」を追加 (機能A のラベルを刷った日時を残す)
const DAILY_REPORT_HEADER = ['地点', '上下/深度/色', '工程', '日時', '担当者', 'ラベル印刷'];
const DAILY_LABEL_COL = DAILY_REPORT_HEADER.indexOf('ラベル印刷') + 1;   // 1始まりの列番号

/**
 * v2.55: 2.54 以前に作られた日報シートには「ラベル印刷」列が無い。
 * 見出しが空なら足す (既存の記録は触らない)。
 */
function ensureDailyLabelCol_(sheet) {
  try {
    const cur = String(sheet.getRange(1, DAILY_LABEL_COL).getValue() || '').trim();
    if (cur === 'ラベル印刷') return;
    sheet.getRange(1, DAILY_LABEL_COL).setValue('ラベル印刷').setFontWeight('bold');
    sheet.setColumnWidth(DAILY_LABEL_COL, 120);
  } catch (e) { /* 失敗しても記録本体は続ける */ }
}

function logToDailyReport(ss, mode, point, udOrColor, worker, time) {
  if (DAILY_REPORT_MODES.indexOf(mode) < 0) return;
  const sheetName = Utilities.formatDate(time || new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, DAILY_REPORT_HEADER.length).setValues([DAILY_REPORT_HEADER]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, DAILY_REPORT_HEADER.length).setFontWeight('bold');
    sheet.setColumnWidths(1, DAILY_REPORT_HEADER.length, 100);
  } else {
    ensureDailyLabelCol_(sheet);
  }
  const timeStr = Utilities.formatDate(time || new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sheet.appendRow([point, udOrColor, mode, timeStr, worker, '']);
}

/**
 * v2.55: 機能A のラベルを刷った行に日時を書く。
 * @param {number[]} rowNumbers 日報シートの行番号 (1始まり・見出し行は2以上)
 */
function markLabelPrinted(spreadsheetId, dateName, rowNumbers) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    const sheet = ss.getSheetByName(String(dateName || '').trim());
    if (!sheet) return { ok: false, message: 'その日の日報シートがありません: ' + dateName };
    ensureDailyLabelCol_(sheet);
    const rows = (rowNumbers || []).map(Number).filter(function(n) {
      return n >= 2 && n <= sheet.getLastRow();
    });
    if (!rows.length) return { ok: false, message: '対象の行がありません' };
    const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    rows.forEach(function(r) {
      sheet.getRange(r, DAILY_LABEL_COL).setNumberFormat('@').setValue(stamp);
    });
    return { ok: true, count: rows.length, stamp: stamp };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== ラベル用の現場名 ==========
// 件名シートには現場IDしか無く現場名が無い。ブック名は長すぎるので、
// 端末で入力した短い名前をここ (スクリプトプロパティ) に覚えておく。
// ブックIDをキーにするので、どの端末から見ても同じ名前が出る。
const PROP_LABEL_SITE_PREFIX = 'lab2_label_site_';

function getLabelSiteName(spreadsheetId) {
  try {
    const id = parseSpreadsheetIdFromInput(spreadsheetId);
    if (!id) return { ok: false, message: '現場が未設定です' };
    const saved = PropertiesService.getScriptProperties()
      .getProperty(PROP_LABEL_SITE_PREFIX + id);
    if (saved) return { ok: true, name: saved, saved: true };
    // 未設定ならブック名の先頭を候補として返す (そのまま使わず画面で直せる)
    let suggest = '';
    try { suggest = SpreadsheetApp.openById(id).getName().slice(0, 8); } catch (e) {}
    return { ok: true, name: suggest, saved: false };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== 揃いラベル (機能B) の印刷履歴 ==========
// 3日/7日で遡ると同じ検体を二度刷りしかねないので、刷ったコードを覚えておく。
// キーは接尾辞まで含めた文字列 (BQYR-L-0006-roka)。ろかと振りは別扱い。
// 置き場は lab-kanri 専用の新しいシート (分析検体シートは picker のもの)。
const SHEET_LABELLOG = 'ラベル印刷履歴';
const LABELLOG_HEADER = ['コード', '印刷日時'];

function getLabelLogSheet_(ss, createIfMissing) {
  let sheet = ss.getSheetByName(SHEET_LABELLOG);
  if (!sheet && createIfMissing) {
    sheet = ss.insertSheet(SHEET_LABELLOG);
    sheet.getRange(1, 1, 1, LABELLOG_HEADER.length).setValues([LABELLOG_HEADER])
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 140);
  }
  return sheet;
}

/** 刷ったことのあるコード一覧を { コード: 印刷日時 } で返す。 */
function getLabelPrinted(spreadsheetId) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    const sheet = getLabelLogSheet_(ss, false);
    const map = {};
    if (!sheet || sheet.getLastRow() < 2) return { ok: true, map: map };
    const v = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
    v.forEach(function(r) {
      const code = String(r[0] || '').trim();
      if (code) map[code] = String(r[1] || '').trim();
    });
    return { ok: true, map: map };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

/** 刷ったコードを記録する (既にあれば日時を更新、無ければ追記)。 */
function markCodeLabelPrinted(spreadsheetId, codes) {
  try {
    const list = (codes || []).map(function(c) { return String(c || '').trim(); })
      .filter(Boolean);
    if (!list.length) return { ok: false, message: '対象のコードがありません' };
    const ss = openSpreadsheet_(spreadsheetId);
    const sheet = getLabelLogSheet_(ss, true);
    const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

    const last = sheet.getLastRow();
    const rowOf = {};
    if (last >= 2) {
      sheet.getRange(2, 1, last - 1, 1).getDisplayValues().forEach(function(r, i) {
        const code = String(r[0] || '').trim();
        if (code) rowOf[code] = i + 2;
      });
    }
    const append = [];
    list.forEach(function(code) {
      if (rowOf[code]) {
        sheet.getRange(rowOf[code], 2).setNumberFormat('@').setValue(stamp);
      } else if (append.indexOf(code) < 0) {
        append.push(code);
      }
    });
    if (append.length) {
      const start = sheet.getLastRow() + 1;
      sheet.getRange(start, 1, append.length, 2).setNumberFormat('@')
        .setValues(append.map(function(c) { return [c, stamp]; }));
    }
    return { ok: true, count: list.length, stamp: stamp };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

function setLabelSiteName(spreadsheetId, name) {
  try {
    const id = parseSpreadsheetIdFromInput(spreadsheetId);
    if (!id) return { ok: false, message: '現場が未設定です' };
    const v = String(name || '').trim().slice(0, 20);
    PropertiesService.getScriptProperties().setProperty(PROP_LABEL_SITE_PREFIX + id, v);
    return { ok: true, name: v };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

/**
 * 日報データを返す。
 * @param {string} [date] 'yyyy-MM-dd'。省略時は今日。
 * v2.4: 日付指定で過去の日報も見れるようにした。dates に選択可能な日付一覧も返す。
 */
function getDailyReportData(spreadsheetId, date) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const target = (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date).trim()))
      ? String(date).trim() : today;
    const dates = listDailyDateNames_(ss);
    const sheet = ss.getSheetByName(target);
    if (!sheet) {
      const isToday = (target === today);
      return {
        ok: false, name: target, dates: dates, isToday: isToday,
        message: (isToday ? '本日' : target) + ' の日報はまだありません' +
                 (dates.length ? '（記録がある日: ' + dates.slice(0, 5).join(' / ') + (dates.length > 5 ? ' …' : '') + '）' : '')
      };
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { ok: false, name: target, dates: dates, message: target + ' の日報は空です' };
    }
    ensureDailyLabelCol_(sheet);   // v2.55: 古い日報にも「ラベル印刷」列を用意する
    const values = sheet.getRange(1, 1, lastRow, DAILY_REPORT_HEADER.length).getDisplayValues();
    const header = values[0].map(function(v) { return String(v == null ? '' : v); });
    const rows = values.slice(1).map(function(r) { return r.map(function(v) { return String(v == null ? '' : v); }); });
    return { ok: true, name: target, header: header, rows: rows, dates: dates, isToday: (target === today) };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

/** 日報シート名 (yyyy-MM-dd) を新しい順で返す */
function listDailyDateNames_(ss) {
  const out = [];
  ss.getSheets().forEach(function(sh) {
    const nm = sh.getName();
    if (/^\d{4}-\d{2}-\d{2}$/.test(nm)) out.push(nm);
  });
  out.sort(function(a, b) { return a < b ? 1 : (a > b ? -1 : 0); });
  return out;
}

/** v2.4: 日報が存在する日付の一覧 (カレンダー用) */
function listDailyReportDates(spreadsheetId) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    return { ok: true, dates: listDailyDateNames_(ss) };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== ビュー用データ (APK 互換フォーマット) ==========
/**
 * 分析検体シート A〜P列 (v2でも旧と同じ構造)。
 */
function getKentaiData(spreadsheetId) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    const sheet = ss.getSheetByName(SHEET_KENTAI);
    if (!sheet) {
      return { ok: false, message: '分析検体シートが見つかりません' };
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 1) {
      return { ok: true, name: '分析検体', header: [], rows: [] };
    }
    // v2.58: 列数の決め打ちをやめ、シートの全列を返す。
    // どの列が何かは cols で伝える (アプリ側が位置を数えなくて済む)。
    // 2.56 までは A〜P だけで、コードのある Q/R が入っていなかった
    const cols = getKentaiCols_(sheet);
    const display = sheet.getRange(1, 1, lastRow, cols.lastCol).getDisplayValues();
    if (display.length === 0) {
      return { ok: true, name: '分析検体', header: [], rows: [] };
    }
    const header = display[0].map(function(v) { return String(v == null ? '' : v); });
    const rows = display.slice(1).map(function(r) {
      return r.map(function(v) { return String(v == null ? '' : v); });
    });
    // アプリ用は 0 始まりに直して渡す
    return { ok: true, name: '分析検体', header: header, rows: rows, cols: {
      kuga: cols.kuga - 1, kuro: cols.kuro - 1, aka: cols.aka - 1, ao: cols.ao - 1,
      soroi: cols.soroi - 1, huri: cols.huri - 1, roka: cols.roka - 1
    } };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

/**
 * 4種の実データシートを一括で読んで正規化して返す (APK 4種チップ用)。
 * 正規化 rows (9列固定・旧版と同一フォーマット):
 *   [地点, 上下, 深度, 削孔日時, 削孔担当, 採取日時, 採取担当, 受入日時, 受入担当]
 * 状態=削除 の行は除外。
 * 注: 地下水行 (WG/WP) は深度調査シートに同居しているのでそのまま含まれる (深度は空 or 水位)。
 */
function getSaishuAll(spreadsheetId) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    // 分離構成なら受入はラボ記録から結合 (実データシートに受入列は無い)
    const labMap = buildLabUkeireMap_(ss);
    // APK側のキーは旧表記「配管・ピット・盛土下」なのでキー名は旧のまま返す
    const kindMap = {
      '表層土壌': '表層土壌',
      '土壌ガス': '土壌ガス',
      '配管・ピット・盛土下': '配管・ピット・盛り土下',
      '深度調査': '深度調査'
    };
    const result = {};
    Object.keys(kindMap).forEach(function(apkKey) {
      result[apkKey] = readKindWorkRows_(ss, kindMap[apkKey], labMap);
    });
    return { ok: true, kinds: result };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

/**
 * 分離構成: ラボ記録シートから コード(大文字) → { ukT, ukW } のマップを作る。
 * 現行構成 (ラボ記録なし) は null を返す。
 */
function buildLabUkeireMap_(ss) {
  // v2.64: ラボ記録タブ案は取り下げ。受入は実データタブの列から読む
  return null;
  /* eslint-disable no-unreachable */
  const labSheet = ss.getSheetByName(SHEET_LABREC);
  if (!labSheet) return null;
  const map = {};
  try {
    const cols = getLabRecCols_(labSheet);
    const lastRow = labSheet.getLastRow();
    if (lastRow < 2) return map;
    const maxCol = Math.max(cols[LABREC_H.CODE], cols[LABREC_H.UKEIRE_T], cols[LABREC_H.UKEIRE_W]);
    const data = labSheet.getRange(2, 1, lastRow - 1, maxCol).getDisplayValues();
    for (let i = 0; i < data.length; i++) {
      const code = String(data[i][cols[LABREC_H.CODE] - 1] || '').trim().toUpperCase();
      if (!code) continue;
      map[code] = {
        ukT: String(data[i][cols[LABREC_H.UKEIRE_T] - 1] || '').trim(),
        ukW: String(data[i][cols[LABREC_H.UKEIRE_W] - 1] || '').trim()
      };
    }
  } catch (e) {}
  return map;
}

function readKindWorkRows_(ss, kind, labMap) {
  const cfg = KIND_CONFIG[kind];
  const empty = { name: kind, rows: [] };
  if (!cfg) return empty;
  const sheet = getKindSheet_(ss, kind);
  if (!sheet) return empty;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return empty;
  const w = resolveWorkCols_(sheet, cfg);   // v2.62: 見出し式
  let maxCol = 1;
  Object.keys(w).forEach(function(k) {
    if (k !== '__lastCol' && typeof w[k] === 'number' && w[k] > maxCol) maxCol = w[k];
  });
  maxCol = Math.min(Math.max(maxCol, w.__lastCol), sheet.getMaxColumns());
  const display = sheet.getRange(1, 1, lastRow, maxCol).getDisplayValues();
  const rows = [];
  for (let i = 1; i < display.length; i++) {
    const r = display[i];
    const get = function(col) {
      if (!col || col < 1 || col > r.length) return '';
      return String(r[col - 1] == null ? '' : r[col - 1]).trim();
    };
    const point = get(w.POINT);
    if (!point || point === '地点' || point === '地点名') continue;
    if (get(w.STATUS) === '削除') continue;
    // 受入: 分離構成ならラボ記録から (コードで結合)。現行構成は実データシートの列から
    let ukT = get(w.UKEIRE);
    let ukW = get(w.UKEIRE_W);
    if (labMap) {
      const lr = labMap[get(w.CODE).toUpperCase()];
      ukT = lr ? lr.ukT : '';
      ukW = lr ? lr.ukW : '';
    }
    rows.push([
      point,
      get(w.UD),
      get(w.DEPTH),
      get(w.SAKKO_T), get(w.SAKKO_W),
      get(w.SAISHU),  get(w.SAISHU_W),
      ukT, ukW,
      // v2.62: 末尾に追加 (既存の 0〜8 は動かさない)。
      //  9=コード ガスのラベル印刷に要る / 10,11=現地確認
      get(w.CODE),
      get(w.GENCHI_T), get(w.GENCHI_W)
    ]);
  }
  return { name: sheet.getName(), rows: rows };
}

// ========== ユーティリティ ==========
function udDisplay(ud) {
  const s = String(ud).toLowerCase().trim();
  if (s === 'up' || s === '上') return '上';
  if (s === 'down' || s === '下') return '下';
  return ud;
}

// ============================================================
// テスト用: picker v2 模擬ブックの生成 (GASエディタから1回実行)
// 実行後、ログ (実行ログ) に URL が出る。検証が終わったら削除してよい。
// ============================================================
function createV2TestBook() {
  const siteId = 'TEDC';
  const ss = SpreadsheetApp.create('【テスト】picker v2 模擬現場 (' + siteId + ')');

  // ---- 件名シート ----
  const kenmei = ss.insertSheet(SHEET_KENMEI);
  kenmei.getRange('A1').setValue('件名');
  kenmei.getRange('B1').setValue('picker v2 テスト現場 土壌汚染調査');
  kenmei.getRange('A2').setValue('ラベル略件名');
  kenmei.getRange('B2').setValue('v2テスト');
  kenmei.getRange('A3').setValue('現場番号');
  kenmei.getRange('B3').setValue('9999');
  kenmei.getRange(KENMEI_SITE_ID_LABEL_CELL).setValue('現場ID');
  kenmei.getRange(KENMEI_SITE_ID_VALUE_CELL).setValue(siteId);

  let seqS = 0, seqG = 0, seqH = 0, seqD = 0, seqWG = 0, seqWP = 0;
  const pad = function(n) { return ('0000' + n).slice(-4); };

  // ---- 表層土壌 (A状態 B地点 C上下 Dコード E採取...L検測深度) ----
  const hyoso = ss.insertSheet(SHEET_HYOSO);
  hyoso.getRange(1, 1, 1, 12).setValues([[
    '状態', '地点', '上下', 'コード', '採取日時', '採取担当', '受入日時', '受入担当', '風乾日時', '風乾担当', '被覆', '検測深度'
  ]]).setFontWeight('bold');
  const hyosoRows = [];
  // A1-2①/A1-2② は同一項目の複数サンプル (枝番テスト)
  ['A1-1', 'A1-2①', 'A1-2②', 'B1-5', 'B2-8'].forEach(function(pt) {
    ['上', '下'].forEach(function(ud) {
      seqS++;
      hyosoRows.push(['', pt, ud, siteId + '-S-' + pad(seqS), '', '', '', '', '', '', '', '']);
    });
  });
  hyoso.getRange(2, 1, hyosoRows.length, 12).setValues(hyosoRows);

  // ---- 土壌ガス (A状態 B地点名 Cコード D削孔...K分析担当) ----
  const gas = ss.insertSheet(SHEET_GAS);
  gas.getRange(1, 1, 1, 11).setValues([[
    '状態', '地点名', 'コード', '削孔日時', '削孔担当', '採取日時', '採取担当', '受入日時', '担当者', '分析日時', '分析担当'
  ]]).setFontWeight('bold');
  const gasRows = [];
  ['A1-5', 'B1-5', 'C2-5'].forEach(function(pt) {
    seqG++;
    gasRows.push(['', pt, siteId + '-G-' + pad(seqG), '', '', '', '', '', '', '', '']);
  });
  gas.getRange(2, 1, gasRows.length, 11).setValues(gasRows);

  // ---- 配管・ピット・盛り土下 (A状態 B地点 C採取深度 Dコード E採取...M検測) ----
  const haikan = ss.insertSheet(SHEET_HAIKAN_NAMES[0]);
  haikan.getRange(1, 1, 1, 13).setValues([[
    '状態', '地点', '採取深度', 'コード', '採取日時', '採取担当', '受入日時', '受入担当', '風乾日時', '風乾担当', '現地深度', '被覆', '検測'
  ]]).setFontWeight('bold');
  const haikanRows = [];
  [['D1-1h①', '1.00-1.50m'], ['D1-1h②', '2.00-2.50m'], ['D2-3h', '2.00-2.50m']].forEach(function(pd) {
    seqH++;
    haikanRows.push(['', pd[0], pd[1], siteId + '-H-' + pad(seqH), '', '', '', '', '', '', '', '', '']);
  });
  haikan.getRange(2, 1, haikanRows.length, 13).setValues(haikanRows);

  // ---- 深度調査 (A状態 B地点 C深度 Dコード E採取...L検測) + 地下水行同居 ----
  const fukado = ss.insertSheet(SHEET_FUKADO);
  fukado.getRange(1, 1, 1, 12).setValues([[
    '状態', '地点', '深度', 'コード', '採取日時', '採取担当', '受入日時', '受入担当', '風乾日時', '風乾担当', '被覆', '検測'
  ]]).setFontWeight('bold');
  const fukadoRows = [];
  ['1.00m', '2.00m', '3.00m'].forEach(function(depth) {
    seqD++;
    fukadoRows.push(['', 'A1-1', depth, siteId + '-D-' + pad(seqD), '', '', '', '', '', '', '', '']);
  });
  // 地下水行 (深度空・コード WG/WP)
  seqWG++;
  fukadoRows.push(['', 'A1-1', '', siteId + '-WG-' + pad(seqWG), '', '', '', '', '', '', '', '']);
  seqWP++;
  fukadoRows.push(['', 'A1-1', '', siteId + '-WP-' + pad(seqWP), '', '', '', '', '', '', '', '']);
  fukado.getRange(2, 1, fukadoRows.length, 12).setValues(fukadoRows);

  // ---- 分析検体 (A区画 B〜J=1〜9 K黒 L赤 M青 N種別 O揃い状況 P印刷日 Q振り R ろか) ----
  const kentai = ss.insertSheet(SHEET_KENTAI);
  kentai.getRange(1, 1, 1, 18).setValues([[
    '区画', '1', '2', '3', '4', '5', '6', '7', '8', '9', '黒', '赤', '青', '種別', '検体揃い状況', '印刷日', '振りコード', 'ろかコード'
  ]]).setFontWeight('bold');
  const kentaiRows = [];
  let seqL = 0;
  const addKentaiRow = function(kuga, color) {
    seqL++;
    const lcode = siteId + '-L-' + pad(seqL);
    kentaiRows.push([kuga, '', '', '', '', '', '', '', '', '',
                     color === '黒' ? '黒' : '', color === '赤' ? '赤' : '', color === '青' ? '青' : '',
                     '単体', '0/1', '', lcode + '-huri', lcode + '-roka']);
  };
  ['A1-1', 'A1-2①', 'A1-2②', 'B1-5', 'B2-8'].forEach(function(kuga) {
    addKentaiRow(kuga, '黒');
    addKentaiRow(kuga, '赤');
    addKentaiRow(kuga, '青');
  });
  kentai.getRange(2, 1, kentaiRows.length, 18).setValues(kentaiRows);

  // デフォルトの「シート1」を削除
  try {
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const nm = sheets[i].getName();
      if (nm === 'シート1' || nm === 'Sheet1') { ss.deleteSheet(sheets[i]); break; }
    }
  } catch (e) {}

  Logger.log('テストブック作成完了: ' + ss.getUrl());
  return ss.getUrl();
}

// ============================================================
// テスト用: 分離構成 (SPEC_sheet_ownership.md) の模擬ブック生成
// picker v2.10+ が作る構成を模す: 実データシート=ラボ列なし + ラボ記録ヘッダーのみ
// GASエディタから1回実行 → 実行ログにURL
// ============================================================
function createV2TestBookNew() {
  const siteId = 'TSEP';
  const ss = SpreadsheetApp.create('【テスト】分離構成 模擬現場 (' + siteId + ')');

  // ---- 件名シート ----
  const kenmei = ss.insertSheet(SHEET_KENMEI);
  kenmei.getRange('A1').setValue('件名');
  kenmei.getRange('B1').setValue('分離構成テスト現場 土壌汚染調査');
  kenmei.getRange('A2').setValue('ラベル略件名');
  kenmei.getRange('B2').setValue('分離テスト');
  kenmei.getRange(KENMEI_SITE_ID_LABEL_CELL).setValue('現場ID');
  kenmei.getRange(KENMEI_SITE_ID_VALUE_CELL).setValue(siteId);

  let seqS = 0, seqG = 0, seqH = 0, seqD = 0, seqWG = 0, seqWP = 0;
  const pad = function(n) { return ('0000' + n).slice(-4); };

  // ---- 表層土壌 (§3.1: 状態|地点|上下|コード|採取日時|採取担当|被覆|検測深度) ----
  const hyoso = ss.insertSheet(SHEET_HYOSO);
  hyoso.getRange(1, 1, 1, 8).setValues([[
    '状態', '地点', '上下', 'コード', '採取日時', '採取担当', '被覆', '検測深度'
  ]]).setFontWeight('bold');
  const hyosoRows = [];
  ['A1-1', 'A1-2①', 'A1-2②', 'B1-5'].forEach(function(pt) {
    ['上', '下'].forEach(function(ud) {
      seqS++;
      hyosoRows.push(['', pt, ud, siteId + '-S-' + pad(seqS), '', '', '', '']);
    });
  });
  hyoso.getRange(2, 1, hyosoRows.length, 8).setValues(hyosoRows);

  // ---- 土壌ガス (§3.1: 状態|地点名|コード|削孔日時|削孔担当|採取日時|採取担当) ----
  const gas = ss.insertSheet(SHEET_GAS);
  gas.getRange(1, 1, 1, 7).setValues([[
    '状態', '地点名', 'コード', '削孔日時', '削孔担当', '採取日時', '採取担当'
  ]]).setFontWeight('bold');
  const gasRows = [];
  ['A1-5', 'B1-5'].forEach(function(pt) {
    seqG++;
    gasRows.push(['', pt, siteId + '-G-' + pad(seqG), '', '', '', '']);
  });
  gas.getRange(2, 1, gasRows.length, 7).setValues(gasRows);

  // ---- 配管 (§3.1: 状態|地点|採取深度|コード|採取日時|採取担当|現地深度|被覆|検測) ----
  const haikan = ss.insertSheet(SHEET_HAIKAN_NAMES[0]);
  haikan.getRange(1, 1, 1, 9).setValues([[
    '状態', '地点', '採取深度', 'コード', '採取日時', '採取担当', '現地深度', '被覆', '検測'
  ]]).setFontWeight('bold');
  const haikanRows = [];
  [['D1-1h①', '1.00-1.50m'], ['D1-1h②', '2.00-2.50m']].forEach(function(pd) {
    seqH++;
    haikanRows.push(['', pd[0], pd[1], siteId + '-H-' + pad(seqH), '', '', '', '', '']);
  });
  haikan.getRange(2, 1, haikanRows.length, 9).setValues(haikanRows);

  // ---- 深度調査 (§3.1: 状態|地点|深度|コード|採取日時|採取担当|被覆|検測) + 地下水行 ----
  const fukado = ss.insertSheet(SHEET_FUKADO);
  fukado.getRange(1, 1, 1, 8).setValues([[
    '状態', '地点', '深度', 'コード', '採取日時', '採取担当', '被覆', '検測'
  ]]).setFontWeight('bold');
  const fukadoRows = [];
  ['1.00m', '2.00m'].forEach(function(depth) {
    seqD++;
    fukadoRows.push(['', 'A1-1', depth, siteId + '-D-' + pad(seqD), '', '', '', '']);
  });
  seqWG++;
  fukadoRows.push(['', 'A1-1', '', siteId + '-WG-' + pad(seqWG), '', '', '', '']);
  seqWP++;
  fukadoRows.push(['', 'A1-1', '', siteId + '-WP-' + pad(seqWP), '', '', '', '']);
  fukado.getRange(2, 1, fukadoRows.length, 8).setValues(fukadoRows);

  // ---- ラボ記録 (§3.2: ヘッダーのみ。picker生成を模す) ----
  const labrec = ss.insertSheet(SHEET_LABREC);
  const labHeader = ['コード', '地点', '種別', '現地確認日時', '現地確認担当',
                     '受入日時', '受入担当', '風乾日時', '風乾担当',
                     '振り日時', '振り担当', 'ろか日時', 'ろか担当',
                     '分析日時', '分析担当', 'ラボ深度', '備考'];
  labrec.getRange(1, 1, 1, labHeader.length).setValues([labHeader]).setFontWeight('bold');
  labrec.setFrozenRows(1);

  // ---- 分析検体 (現行と同構造) ----
  const kentai = ss.insertSheet(SHEET_KENTAI);
  kentai.getRange(1, 1, 1, 18).setValues([[
    '区画', '1', '2', '3', '4', '5', '6', '7', '8', '9', '黒', '赤', '青', '種別', '検体揃い状況', '印刷日', '振りコード', 'ろかコード'
  ]]).setFontWeight('bold');
  const kentaiRows = [];
  let seqL = 0;
  ['A1-1', 'A1-2①', 'B1-5'].forEach(function(kuga) {
    ['黒', '赤', '青'].forEach(function(color) {
      seqL++;
      const lcode = siteId + '-L-' + pad(seqL);
      kentaiRows.push([kuga, '', '', '', '', '', '', '', '', '',
                       color === '黒' ? '黒' : '', color === '赤' ? '赤' : '', color === '青' ? '青' : '',
                       '単体', '0/1', '', lcode + '-huri', lcode + '-roka']);
    });
  });
  kentai.getRange(2, 1, kentaiRows.length, 18).setValues(kentaiRows);

  // デフォルトシート削除
  try {
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const nm = sheets[i].getName();
      if (nm === 'シート1' || nm === 'Sheet1') { ss.deleteSheet(sheets[i]); break; }
    }
  } catch (e) {}

  Logger.log('分離構成テストブック作成完了: ' + ss.getUrl());
  return ss.getUrl();
}
