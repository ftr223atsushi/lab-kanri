/**
 * shast LAB - GAS Web App (v5: スタンドアロン版)
 *
 * v5での変更:
 *  - スタンドアロンWebアプリ化 (コンテナバインド廃止)
 *  - スプレッドシートIDをクライアント(端末)から毎リクエスト送信する方式に変更
 *  - 端末ごとに異なるスプレッドシート(現場)を編集可能
 *  - 現場切替時は4桁パスワード認証 (初期値1111)
 *  - SpreadsheetApp.getActiveSpreadsheet() / getUi() を全廃
 *
 * 役割:
 *  - フェーズ1: 採取/受入/風乾 (上下別管理) → 工程時刻シート
 *  - フェーズ1終了 (上+下 両方の風乾完了) → 前処理シート/分析シート の M列に混合地点名を自動追加
 *  - フェーズ2: 振り/ろか/分析 → すべて 前処理シート に集約
 *      振り = D/E、ろか = F/G、分析 = H/I
 *  - 分析権限: 早川 OR 山口
 *  - 日報シート: 受入/風乾/振り/ろか の4工程を当日付シート(yyyy-MM-dd)にリアルタイム追記
 *  - 「本日分」ボタン → 当日日報シートをPDFで取得 → iframe に流して即印刷ダイアログ
 *
 * バーコード形式:
 *  - ベースコード   "0001"            → 採取/受入/風乾モード (順番厳格)
 *  - サフィックス   "A1-1-R-huri"    → 振りモード自動切替
 *  - サフィックス   "A1-1-R-roka"    → ろかモード自動切替 (分析モード選択時は分析へ)
 *
 * シート構造:
 *  工程時刻: A=地点 B=上下 C=コード D=採取 E=採取担当 F=受入 G=受入担当 H=風乾 I=風乾担当
 *  前処理:   A=ID B=地点名 C=色 D=振り時刻 E=振り担当 F=ろか時刻 G=ろか担当 H=分析時刻 I=分析担当 ... M=地点名マスタ
 *  分析:     残置(本スクリプトは書込まない)
 *  yyyy-MM-dd (日報): A=地点 B=上下/RBK C=工程 D=時刻 E=担当者
 *
 *  ※ 前処理シートの M→B 展開、QR生成などは別エンジニア管轄(本スクリプトでは触らない)
 */

// ========== シート名 ==========
// v6: shast-picker新仕様 (地点抽出シート経由のコード解決、種別×シート分岐)
const SHEET_CHITEN      = '地点抽出';
const SHEET_HYOSO       = '表層土壌';
const SHEET_HAIKAN      = '配管・ピット・盛土下';
const SHEET_GAS         = '土壌ガス';
const SHEET_FUKADO      = '深度調査';     // v7.3 追加
const SHEET_CHIKASUI    = '地下水';       // v7.3 追加
const SHEET_ZENSHORI    = '前処理';
const SHEET_BUNSEKI     = '分析';
const SHEET_BARCODE_GEN = 'バーコード作成';

// v5以前互換用 (旧コード参照箇所のために残置、現行ロジックは使わない)
const SHEET_KOTEI       = '工程時刻';

// ========== バーコード生成定義 (印刷向けレイアウト) ==========
// 1地点 = 6カード(R/B/K × ろか/振り) を横1行に並べる
// カード = 3行(QR / 色マーク / ラベル) + 地点間に空白1行
// A4縦・8地点想定
const BARCODE_COLORS = ['R', 'B', 'K'];
const BARCODE_CARD_LAYOUT = [
  { color: 'R', suffix: 'roka', label: 'ろか' },
  { color: 'B', suffix: 'roka', label: 'ろか' },
  { color: 'K', suffix: 'roka', label: 'ろか' },
  { color: 'R', suffix: 'huri', label: '振り' },
  { color: 'B', suffix: 'huri', label: '振り' },
  { color: 'K', suffix: 'huri', label: '振り' }
];
const BARCODE_COLOR_HEX = {
  R: '#e53935', // 赤
  B: '#1e88e5', // 青
  K: '#000000'  // 黒
};
const BARCODE_QR_SIZE      = 72;   // QR画像px (mode 4 で実寸)
const CARD_COLS            = 6;    // 横6カード
const CARD_ROWS_PER_BLOCK  = 4;    // QR(1) + 色(1) + ラベル(1) + 空白(1)
const CARD_COL_WIDTH       = 120;  // 列幅: QR80 + 左右余白(切り取り用隙間)
const ROW_QR_HEIGHT        = 77;
const ROW_COLOR_HEIGHT     = 20;
const ROW_LABEL_HEIGHT     = 20;
const ROW_GAP_HEIGHT       = 8;
const HEADER_ROW_HEIGHT    = 24;
const BARCODE_PRINT_FLAG_COL = 7; // G列: 印刷フラグ用チェックボックス

// ========== 種別×シート構成 (v7: 新スプレッドシート対応) ==========
// 地点抽出シート (各種別ブロックに「状態」列が追加された):
//   土壌ブロック  : A=状態 B=地点名 C=上下 D=コード                  (kind: 表層土壌)
//   ガスブロック  : E=状態 F=地点名 G=コード                          (kind: 土壌ガス)
//   配管ブロック  : H=状態 I=地点 J=採取深度 K=コード                  (kind: 配管・ピット・盛土下)
//
// 各種別の作業シート (こちらも「状態」列が冒頭に追加):
//   表層土壌:   A=状態 B=地点 C=上下     D=採取日時 E=採取担当 F=受入日時 G=受入担当 H=風乾日時 I=風乾担当
//   配管下:     A=状態 B=地点 C=採取深度 D=採取日時 E=採取担当 F=受入日時 G=受入担当 H=風乾日時 I=風乾担当
//   土壌ガス:   A=状態 B=地点名 C=削孔時間 D=採取時間 E=受入 F=担当者
//                ※ shast-kanri は受入(E)+担当(F)のみ書込 (削孔/採取は shast-picker または別系統)
//
// 状態列の値: ''(通常) / '削除' / '追加' / '変更'
//   - '削除' の地点は警告ダイアログ → 確認後に赤文字で記録
//
// 種別名 → 設定
const KIND_CONFIG = {
  '表層土壌': {
    pickupStatusCol: 1,  // 地点抽出 A列
    pickupPointCol:  2,  // 地点抽出 B列
    pickupUdCol:     3,  // 地点抽出 C列 (上下)
    pickupCodeCol:   4,  // 地点抽出 D列
    workSheet:       SHEET_HYOSO,
    hasUd:           true,
    availableModes: ['採取', '受入', '風乾', '振り', 'ろか', '分析'],
    // 書込先シート: A=状態 B=地点 C=上下 D=採取 E=採取担当 F=受入 G=受入担当 H=風乾 I=風乾担当
    workCols: {
      STATUS:   1, POINT: 2, UD: 3,
      SAISHU:   4, SAISHU_W: 5,   // D,E
      UKEIRE:   6, UKEIRE_W: 7,   // F,G
      FUKAN:    8, FUKAN_W:  9    // H,I
    }
  },
  '土壌ガス': {
    pickupStatusCol: 5,  // 地点抽出 E列
    pickupPointCol:  6,  // 地点抽出 F列
    pickupUdCol:     null,
    pickupCodeCol:   7,  // 地点抽出 G列
    workSheet:       SHEET_GAS,
    hasUd:           false,
    // v7.1: 4工程対応 (削孔/採取/受入/分析)
    availableModes: ['削孔', '採取', '受入', '分析'],
    // 種別固有の順番チェック (MODESの prevCol を上書き)
    //   削孔: 先頭 (チェックなし)
    //   採取: 削孔が前 (削孔→採取はワンセット)
    //   受入: 単独可 (削孔/採取スキップして受入スタート可)
    //   分析: 受入が前 (受入→分析はワンセット)
    modeOverrides: {
      '削孔': { prevCol: null },
      '採取': { prevCol: 'SAKKO_T' },
      '受入': { prevCol: null },
      '分析': { prevCol: 'UKEIRE' }
    },
    // 書込先シート: A=状態 B=地点名 C=削孔日時 D=削孔担当 E=採取日時 F=採取担当
    //                G=受入日時 H=担当者(=受入担当) I=分析日時 J=分析担当
    workCols: {
      STATUS:    1, POINT: 2,
      SAKKO_T:   3, SAKKO_W:   4,    // C,D
      SAISHU:    5, SAISHU_W:  6,    // E,F
      UKEIRE:    7, UKEIRE_W:  8,    // G,H
      BUNSEKI_T: 9, BUNSEKI_W: 10    // I,J
    }
  },
  '配管・ピット・盛土下': {
    pickupStatusCol: 8,   // 地点抽出 H列
    pickupPointCol:  9,   // 地点抽出 I列
    pickupUdCol:     null,
    pickupCodeCol:   11,  // 地点抽出 K列
    workSheet:       SHEET_HAIKAN,
    hasUd:           false,
    availableModes: ['採取', '受入', '風乾', '振り', 'ろか', '分析'],
    // 書込先シート: A=状態 B=地点 C=採取深度 D=採取 E=採取担当 F=受入 G=受入担当 H=風乾 I=風乾担当
    workCols: {
      STATUS:   1, POINT: 2,
      DEPTH:    3,   // C列 採取深度 (shast-kanri は日報用に読込)
      SAISHU:   4, SAISHU_W: 5,   // D,E
      UKEIRE:   6, UKEIRE_W: 7,   // F,G
      FUKAN:    8, FUKAN_W:  9    // H,I
    }
  },
  '深度調査': {
    // v7.3 新規: 地点抽出シート L〜O列
    //   L=状態 M=地点 N=深度 O=コード
    pickupStatusCol: 12,  // L列
    pickupPointCol:  13,  // M列
    pickupDepthCol:  14,  // N列 (深度調査専用)
    pickupCodeCol:   15,  // O列
    pickupUdCol:     null,
    workSheet:       SHEET_FUKADO,
    hasUd:           false,
    hasDepth:        true,  // 地点+深度 で行検索
    availableModes: ['採取', '受入', '風乾'],
    // 書込先シート: A=状態 B=地点 C=深度 D=採取 E=採取担当 F=受入 G=受入担当 H=風乾 I=風乾担当
    workCols: {
      STATUS:   1, POINT: 2, DEPTH: 3,
      SAISHU:   4, SAISHU_W: 5,   // D,E
      UKEIRE:   6, UKEIRE_W: 7,   // F,G
      FUKAN:    8, FUKAN_W:  9    // H,I
    }
  },
  '地下水': {
    // v7.3 新規: 地点抽出シート P〜T列
    //   P=状態 Q=地点 R=水位 S=容器の種類 T=コード
    pickupStatusCol: 16,  // P列
    pickupPointCol:  17,  // Q列
    pickupUdCol:     null,
    pickupCodeCol:   20,  // T列
    workSheet:       SHEET_CHIKASUI,
    hasUd:           false,
    // 地下水は受入のみ
    availableModes: ['受入'],
    // 書込先シート: A=状態 B=地点 C=水位 D=容器の種類 E=受け入れ F=受け入れ担
    // shast-kanri は E列(受入) と F列(担当) のみ書込。水位/容器の種類は触らない
    workCols: {
      STATUS:   1, POINT: 2,
      SUI:      3,  // C列 水位 (shast-kanriは触らない)
      YOKI:     4,  // D列 容器の種類 (shast-kanriは触らない)
      UKEIRE:   5, UKEIRE_W: 6   // E,F (shast-kanriが書込)
    }
  }
};

// 自動判別時の検索順序 (1コード=1種別前提、最初にヒットしたら確定)
const KIND_AUTO_ORDER = ['表層土壌', '土壌ガス', '配管・ピット・盛土下', '深度調査', '地下水'];

// v7.2-v7.3: UI上の種別 (soil/gas) → 内部種別配列のマッピング
// 「土壌」モードは 表層土壌・配管下・深度調査・地下水 を内部で自動判別する
const KIND_GROUPS = {
  'soil': ['表層土壌', '配管・ピット・盛土下', '深度調査', '地下水'],
  'gas':  ['土壌ガス']
};

// 範囲外コード検出時の親切エラーメッセージ用 (UI種別への逆引き)
function uiKindLabelOf_(internalKind) {
  if (internalKind === '土壌ガス') return 'ガス';
  return '土壌';
}

// 削除地点を赤文字で記録するための色
const DELETED_FONT_COLOR = '#c62828';

// v5以前の旧 列定義 (現行ロジックは使わない、旧 工程時刻 シート用)
const COL_KOTEI = {
  POINT:    1, UD: 2, CODE: 3,
  SAISHU:   4, SAISHU_W: 5,
  UKEIRE:   6, UKEIRE_W: 7,
  FUKAN:    8, FUKAN_W:  9
};

const COL_ZENSHORI = {
  ID:        1,  // A
  POINT:     2,  // B
  COLOR:     3,  // C
  HURI_T:    4,  // D 振り時刻
  HURI_W:    5,  // E 振り担当
  ROKA_T:    6,  // F ろか時刻
  ROKA_W:    7,  // G ろか担当
  BUNSEKI_T: 8,  // H 分析時刻
  BUNSEKI_W: 9,  // I 分析担当
  M:        13   // M 地点名マスタ
};

const COL_BUNSEKI = {
  ID:     1,
  POINT:  2,
  COLOR:  3,
  TIME:   4,  // D 分析時刻
  WORKER: 5,  // E 分析担当
  M:     13   // M 地点名マスタ
};

// ========== モード定義 ==========
// phase1 modes: 工程時刻シートに書込(地点+上下)
// phase2 modes: 前処理/分析シートに書込(地点+色)
const MODES = {
  // v7.1: 土壌ガス専用工程「削孔」(他種別では availableModes で弾く)
  '削孔': {
    phase: 1,
    col: 'SAKKO_T', workerCol: 'SAKKO_W',
    prevCol: null, strict: false
  },
  '採取': {
    phase: 1,
    col: 'SAISHU', workerCol: 'SAISHU_W',
    prevCol: null, strict: true
  },
  '受入': {
    phase: 1,
    col: 'UKEIRE', workerCol: 'UKEIRE_W',
    prevCol: 'SAISHU', strict: true
  },
  '風乾': {
    phase: 1,
    col: 'FUKAN', workerCol: 'FUKAN_W',
    prevCol: 'UKEIRE', strict: true
  },
  '振り': {
    phase: 2, sheet: SHEET_ZENSHORI, expectedSuffix: 'huri',
    col: 'HURI_T', workerCol: 'HURI_W',
    prevCol: null, prevLabel: null, strict: false
  },
  'ろか': {
    phase: 2, sheet: SHEET_ZENSHORI, expectedSuffix: 'roka',
    col: 'ROKA_T', workerCol: 'ROKA_W',
    prevCol: 'HURI_T', prevLabel: '振り', strict: false
  },
  '分析': {
    phase: 2, sheet: SHEET_ZENSHORI, expectedSuffix: 'roka',
    col: 'BUNSEKI_T', workerCol: 'BUNSEKI_W',
    prevCol: 'ROKA_T', prevLabel: 'ろか', strict: false,
    requireWorkers: ['早川', '山口']
  }
};

// suffix → モード逆引き
const SUFFIX_TO_MODE = { 'huri': '振り', 'roka': 'ろか' };

// 担当者管理
const DEFAULT_WORKERS = ['川村', '山田', '川添', '石徹白', '早川', '田中', '山口'];
const PROP_WORKERS         = 'lab_workers';
const PROP_CURRENT_WORKER  = 'lab_current_worker';

// パスワード (現場切替用、4桁数字、初期値1111)
const PROP_PASSWORD_HASH = 'lab_password_hash';
const DEFAULT_PASSWORD   = '1111';
const PASSWORD_SALT      = 'shast-lab-v5-salt';

// 現場スプレッドシート共有フォルダ (shast-pickerが出力するフォルダ)
// このフォルダ内のスプレッドシート一覧を「現場切替」モーダルで選択可能にする
const SHARED_FOLDER_ID = '1V4zi1031hEseO3QP9iARHAhyuRDwgYaM';

// ========== Web App エントリ ==========
// アイコン: GASは公開URLしか受け付けない (data URL不可)
// → 公開ホスティング先のURLをここに設定する
const FAVICON_URL = 'https://raw.githubusercontent.com/ftr223atsushi/lab-kanri/main/icon-192.png';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('shast LAB 入力')
    .setFaviconUrl(FAVICON_URL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ========== スプレッドシート切替 (端末ごと/現場ごと) ==========

/**
 * URL貼付 or ID直接入力 のどちらでもIDを取り出す。
 * 例:
 *  - "https://docs.google.com/spreadsheets/d/1AbC.../edit" → "1AbC..."
 *  - "1AbC..." → "1AbC..."
 */
function parseSpreadsheetIdFromInput(input) {
  if (!input) return '';
  const s = String(input).trim();
  if (!s) return '';
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return s; // 既にIDの想定
}

/**
 * 内部用: 指定IDのスプレッドシートを開く。失敗時は throw。
 */
function openSpreadsheet_(spreadsheetId) {
  const id = parseSpreadsheetIdFromInput(spreadsheetId);
  if (!id) throw new Error('スプレッドシートが設定されていません (現場切替から設定してください)');
  return SpreadsheetApp.openById(id);
}

/**
 * 地点抽出シートでベースコードから地点情報を引く。
 * @param {Spreadsheet} ss 開かれたスプレッドシート
 * @param {string} kind 種別名 ('表層土壌' / '土壌ガス' / '配管・ピット・盛土下')
 * @param {string} baseCode スキャンされたベースコード
 * @return {Object|null} { point, ud, status } または null (未発見)
 *                       status: ''(通常) / '削除' / '追加' / '変更'
 */
function resolveBaseCode_(ss, kind, baseCode) {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) throw new Error('未対応の種別: ' + kind);

  const sheet = ss.getSheetByName(SHEET_CHITEN);
  if (!sheet) throw new Error('「' + SHEET_CHITEN + '」シートが見つかりません');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  // 必要な列幅 (コード列まで、状態列・深度列含む)
  const lastCol = Math.max(
    cfg.pickupCodeCol, cfg.pickupPointCol,
    cfg.pickupUdCol || 0, cfg.pickupStatusCol || 0,
    cfg.pickupDepthCol || 0
  );
  const dispRange = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
  const valRange  = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const target    = String(baseCode).trim();
  const targetNum = Number(target);
  const hasNum    = !isNaN(targetNum) && target !== '';

  for (let i = 0; i < dispRange.length; i++) {
    const codeDisp = String(dispRange[i][cfg.pickupCodeCol - 1]).trim();
    const codeRaw  = valRange[i][cfg.pickupCodeCol - 1];
    const codeStr  = String(codeRaw).trim();

    let hit = false;
    if (codeDisp === target) hit = true;
    else if (codeStr === target) hit = true;
    else if (hasNum && codeRaw !== '' && codeRaw !== null && !isNaN(Number(codeRaw))
             && Number(codeRaw) === targetNum) hit = true;

    if (hit) {
      const point  = String(valRange[i][cfg.pickupPointCol - 1]).trim();
      const ud     = cfg.pickupUdCol
        ? String(valRange[i][cfg.pickupUdCol - 1]).trim() : '';
      const status = cfg.pickupStatusCol
        ? String(valRange[i][cfg.pickupStatusCol - 1]).trim() : '';
      // 深度調査の場合のみ depth に値が入る
      const depth  = cfg.pickupDepthCol
        ? String(dispRange[i][cfg.pickupDepthCol - 1]).trim() : '';
      return { point: point, ud: ud, status: status, depth: depth };
    }
  }
  return null;
}

/**
 * コードから種別を自動判別。地点抽出シートを順に検索し、最初にヒットした種別を返す。
 *
 * @param {Spreadsheet} ss
 * @param {string} baseCode
 * @param {string[]} [allowedKinds] 検索対象の内部種別配列 (省略時は全種別)
 * @return {Object|null} { kind, point, ud, status } または null
 */
function autoDetectKind_(ss, baseCode, allowedKinds) {
  const list = (allowedKinds && allowedKinds.length) ? allowedKinds : KIND_AUTO_ORDER;
  for (let i = 0; i < list.length; i++) {
    const kind = list[i];
    try {
      const resolved = resolveBaseCode_(ss, kind, baseCode);
      if (resolved) return Object.assign({ kind: kind }, resolved);
    } catch (e) { /* シート無いなどは次へ */ }
  }
  return null;
}

/**
 * クライアントから呼ぶ: スプレッドシートが開けるか確認 + 名前を返す。
 * 現場切替モーダルでURL検証に使う。
 */
function getSpreadsheetMeta(spreadsheetId) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    return { ok: true, id: ss.getId(), name: ss.getName(), url: ss.getUrl() };
  } catch (e) {
    return { ok: false, message: 'スプレッドシートを開けません: ' + e.message };
  }
}

/**
 * クライアントから呼ぶ: 共有フォルダ内のスプレッドシート一覧を返す。
 * 現場切替モーダルの「📁 共有フォルダから選ぶ」ボタンから呼ばれる。
 * 並び: 最終更新降順 (最新が一番上)
 */
function listSpreadsheetsInSharedFolder() {
  try {
    const folder = DriveApp.getFolderById(SHARED_FOLDER_ID);
    const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    const list = [];
    while (files.hasNext()) {
      const f = files.next();
      list.push({
        id: f.getId(),
        name: f.getName(),
        url: f.getUrl(),
        lastUpdated: f.getLastUpdated().getTime()
      });
    }
    list.sort(function(a, b) { return b.lastUpdated - a.lastUpdated; });
    return { ok: true, folderName: folder.getName(), files: list };
  } catch (e) {
    return { ok: false, message: '共有フォルダを開けません: ' + e.message };
  }
}

// ========== パスワード認証 ==========

function hashPassword_(password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(password) + '|' + PASSWORD_SALT
  );
  return bytes.map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function getStoredPasswordHash_() {
  const props = PropertiesService.getScriptProperties();
  let hash = props.getProperty(PROP_PASSWORD_HASH);
  if (!hash) {
    hash = hashPassword_(DEFAULT_PASSWORD);
    props.setProperty(PROP_PASSWORD_HASH, hash);
  }
  return hash;
}

/**
 * クライアントから呼ぶ: 4桁パスワード検証。
 */
function verifyPassword(password) {
  try {
    const stored = getStoredPasswordHash_();
    return { ok: hashPassword_(password) === stored };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

/**
 * クライアントから呼ぶ: パスワード変更 (旧パスワード一致時のみ)。
 */
function changePassword(oldPassword, newPassword) {
  try {
    const stored = getStoredPasswordHash_();
    if (hashPassword_(oldPassword) !== stored) {
      return { ok: false, message: '現在のパスワードが違います' };
    }
    const np = String(newPassword || '').trim();
    if (!/^\d{4}$/.test(np)) {
      return { ok: false, message: '新パスワードは4桁の数字で入力してください' };
    }
    PropertiesService.getScriptProperties().setProperty(PROP_PASSWORD_HASH, hashPassword_(np));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== 担当者管理 ==========
function getWorkerList() {
  const props = PropertiesService.getScriptProperties();
  let added = [];
  try {
    const json = props.getProperty(PROP_WORKERS);
    if (json) added = JSON.parse(json);
  } catch (e) {}
  const merged = DEFAULT_WORKERS.concat(added.filter(n => DEFAULT_WORKERS.indexOf(n) < 0));
  return {
    workers: merged,
    current: props.getProperty(PROP_CURRENT_WORKER) || ''
  };
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

function setCurrentWorker(name) {
  const props = PropertiesService.getScriptProperties();
  if (name) {
    props.setProperty(PROP_CURRENT_WORKER, String(name));
  } else {
    props.deleteProperty(PROP_CURRENT_WORKER);
  }
  return { ok: true };
}

// ========== メイン: スキャン処理 ==========
/**
 * @param {string} spreadsheetId - 対象スプレッドシートID
 * @param {string} kind          - 種別 ('auto' / '表層土壌' / '土壌ガス' / '配管・ピット・盛土下')
 *                                 'auto' or '' なら地点抽出シートで自動振り分け
 * @param {string} mode          - 工程モード (採取/受入/風乾/振り/ろか/分析)
 * @param {string} code          - スキャンコード
 * @param {boolean} force        - 順番警告無視
 * @param {string} overrideWorker- 担当者上書き (ろか2段スキャン用)
 * @param {boolean} confirmDeleted - 削除地点ダイアログでOK押した後の再送信フラグ
 * @return {Object}
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

    const props = PropertiesService.getScriptProperties();
    // ろか2段スキャンの場合は1個目（ろか）スキャン時点の担当者で記録する
    const worker = (overrideWorker && String(overrideWorker).trim())
      ? String(overrideWorker).trim()
      : (props.getProperty(PROP_CURRENT_WORKER) || '');
    if (!worker) {
      return { ok: false, message: '担当者を選択してください' };
    }

    // コード解析
    const parsed = parseCode(code);
    // parsed = { type: 'base'|'sub', baseCode, point, color, suffix }

    let effectiveMode = mode;
    let autoSwitched = false;

    if (parsed.type === 'sub') {
      // サブコード: suffix から自動でモード決定
      // ただし -roka の時、UIで分析が選択中ならそれを尊重
      if (parsed.suffix === 'roka' && mode === '分析') {
        effectiveMode = '分析';
      } else {
        const auto = SUFFIX_TO_MODE[parsed.suffix];
        if (!auto) return { ok: false, message: '不明なサフィックス: -' + parsed.suffix };
        if (effectiveMode !== auto) {
          autoSwitched = true;
          effectiveMode = auto;
        }
      }
    } else {
      // ベースコード: phase1 のみ
      if (!effectiveMode) {
        return { ok: false, message: 'モードを選択してください (採取/受入/風乾)' };
      }
      const cfg = MODES[effectiveMode];
      if (!cfg || cfg.phase !== 1) {
        return { ok: false, message: effectiveMode + 'モードでは「-huri」「-roka」付きコードをスキャンしてください' };
      }
    }

    const cfg = MODES[effectiveMode];
    if (!cfg) return { ok: false, message: 'モードが不正です: ' + effectiveMode };

    // 分析モード権限チェック (複数許可)
    if (cfg.requireWorkers && cfg.requireWorkers.indexOf(worker) < 0) {
      return { ok: false, message: '分析モードは ' + cfg.requireWorkers.join('・') + ' のみ使用できます (現在: ' + worker + ')' };
    }

    // v7.1: 分析モードは「コード種別 (base/sub)」で phase を決める
    //   - baseコード → phase=1 (土壌ガスシートに直接書込)
    //   - -roka コード → phase=2 (前処理シート、既存ロジック)
    // 他モードは MODES の phase をそのまま使う。
    let effectivePhase = cfg.phase;
    if (effectiveMode === '分析') {
      effectivePhase = (parsed.type === 'base') ? 1 : 2;
    }

    if (effectivePhase === 1) {
      let effectiveKind = kind;
      let preResolved = null;

      // v7.2: UI種別 (soil/gas) → 内部種別配列マッピング
      // 'auto' は互換用 (旧UI)、空文字も含めて全種別検索扱い
      let searchKinds;
      if (kind === 'soil' || kind === 'gas') {
        searchKinds = KIND_GROUPS[kind];
      } else if (kind && KIND_CONFIG[kind]) {
        // 旧仕様の直接指定 (互換用)
        searchKinds = [kind];
      } else {
        // 'auto' or 空文字 or 不明 → 全種別 (互換)
        searchKinds = KIND_AUTO_ORDER;
      }

      preResolved = autoDetectKind_(ss, parsed.baseCode, searchKinds);
      if (!preResolved) {
        // 検索範囲外でヒットしないか確認 → 種別ボタン切替を促す親切エラー
        const allOther = autoDetectKind_(ss, parsed.baseCode);
        if (allOther && searchKinds.indexOf(allOther.kind) < 0) {
          return {
            ok: false,
            message: 'このコードは「' + allOther.kind + '」のものです。' +
                     '種別ボタンを「' + uiKindLabelOf_(allOther.kind) + '」に切り替えてください'
          };
        }
        return {
          ok: false,
          message: 'コード ' + parsed.baseCode + ' が地点抽出シートに見つかりません'
        };
      }
      effectiveKind = preResolved.kind;

      const kc = KIND_CONFIG[effectiveKind];

      // availableModes チェック (例: 表層・配管で削孔モード、土壌ガスで風乾/振り/ろか)
      if (kc.availableModes && kc.availableModes.indexOf(effectiveMode) < 0) {
        return {
          ok: false,
          message: '「' + effectiveKind + '」では「' + effectiveMode + '」モードは使えません。使用可: ' + kc.availableModes.join(' / ')
        };
      }

      // 状態=削除 の確認
      if (preResolved.status === '削除' && !confirmDeleted) {
        return {
          ok: false,
          needConfirm: 'deleted',
          message: 'この地点は「削除」状態です。' + preResolved.point +
                   (preResolved.ud ? '(' + preResolved.ud + ')' : '') +
                   ' に ' + effectiveMode + ' を赤文字で記録しますか？',
          kind: effectiveKind,
          mode: effectiveMode,
          code: parsed.baseCode,
          autoMode: autoSwitched ? effectiveMode : null
        };
      }

      const isDeleted = (preResolved.status === '削除');
      return handlePhase1(ss, effectiveKind, effectiveMode, cfg, parsed.baseCode, worker, force, autoSwitched, isDeleted, preResolved);
    } else {
      // phase=2: 振り/ろか/分析 (前処理シート)
      // ただし、kind が明示的に「土壌ガス」指定で分析モードなら、ここに来ない想定
      // (土壌ガスの分析は base コード経由で phase=1 ルートで処理されるべき)
      return handlePhase2or3(ss, effectiveMode, cfg, parsed, worker, force, autoSwitched);
    }

  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== コード解析 ==========
function parseCode(code) {
  // 例: "0001"           → { type:'base', baseCode:'0001' }
  // 例: "A1-1-R-huri"    → { type:'sub', point:'A1-1', color:'R', suffix:'huri' }
  // 例: "A1-1-R-roka"    → { type:'sub', point:'A1-1', color:'R', suffix:'roka' }
  const lower = code.toLowerCase();
  if (lower.endsWith('-huri') || lower.endsWith('-roka')) {
    const suffix = lower.endsWith('-huri') ? 'huri' : 'roka';
    const body = code.substring(0, code.length - (suffix.length + 1)); // "A1-1-R"
    // 末尾を色(R/B/K)、それより前を地点名と仮定
    const parts = body.split('-');
    const color = parts[parts.length - 1].toUpperCase();
    const point = parts.slice(0, -1).join('-');
    return { type: 'sub', point: point, color: color, suffix: suffix };
  }
  return { type: 'base', baseCode: code };
}

// ========== フェーズ1: 種別ごとの作業シート (v7) ==========
// 1) 地点抽出シートでコード→地点(+上下+状態)を解決 (または事前に解決済みを受取)
// 2) 種別の作業シート で地点(+上下)の行を探す
// 3) 該当工程の時刻/担当列に書込み (状態=削除なら赤文字)
function handlePhase1(ss, kind, mode, cfg, baseCode, worker, force, autoSwitched, isDeleted, preResolved) {
  const kc = KIND_CONFIG[kind];
  if (!kc) return { ok: false, message: '未対応の種別: ' + kind };

  // (1) コード解決 (handleScan側で済んでいれば preResolved を再利用)
  const resolved = preResolved || resolveBaseCode_(ss, kind, baseCode);
  if (!resolved) {
    return { ok: false, message: 'コード ' + baseCode + ' が ' + kind + ' に見つかりません (地点抽出シートを確認してください)' };
  }
  const point = resolved.point;
  const ud    = resolved.ud;
  if (!point) {
    return { ok: false, message: 'コード ' + baseCode + ' の地点名が空です' };
  }

  // (2) 作業シートで地点(+上下)の行を検索
  const sheet = ss.getSheetByName(kc.workSheet);
  if (!sheet) return { ok: false, message: '「' + kc.workSheet + '」シートが見つかりません' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: false, message: '「' + kc.workSheet + '」シートにデータがありません (地点が展開されているか確認してください)' };
  }

  // 行検索: 種別ごとにキー列が違う
  //   - 表層土壌 (hasUd):   地点 + 上下
  //   - 深度調査 (hasDepth): 地点 + 深度
  //   - その他:              地点のみ
  const numCols = kc.hasUd ? 2 : (kc.hasDepth ? 2 : 1);
  const data = sheet.getRange(2, kc.workCols.POINT, lastRow - 1, numCols).getValues();
  let foundRow = -1;
  for (let i = 0; i < data.length; i++) {
    const p = String(data[i][0]).trim();
    if (p !== String(point).trim()) continue;
    if (kc.hasUd) {
      const u = String(data[i][1]).trim();
      if (udNormalize(u) === udNormalize(ud)) { foundRow = i + 2; break; }
    } else if (kc.hasDepth) {
      const d = String(data[i][1]).trim();
      if (d === String(resolved.depth || '').trim()) { foundRow = i + 2; break; }
    } else {
      foundRow = i + 2; break;
    }
  }
  if (foundRow < 0) {
    let extra = '';
    if (kc.hasUd)        extra = '(' + udDisplay(ud) + ')';
    else if (kc.hasDepth) extra = '(深度:' + (resolved.depth || '') + ')';
    return { ok: false, message: kc.workSheet + 'シートに ' + point + extra + ' の行が見つかりません' };
  }

  // (3) 該当工程の時刻/担当列
  const targetCol = kc.workCols[cfg.col];
  const workerCol = kc.workCols[cfg.workerCol];
  if (!targetCol || !workerCol) {
    return { ok: false, message: kind + ' は ' + mode + ' モードに未対応です' };
  }
  const targetCell = sheet.getRange(foundRow, targetCol);

  // 二重チェック
  const existing = targetCell.getValue();
  if (existing) {
    const t = (existing instanceof Date) ? existing : new Date(existing);
    return {
      ok: false,
      message: mode + ' は既に記録済み: ' + Utilities.formatDate(t, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
    };
  }

  // 順番チェック (種別固有の modeOverrides があれば優先)
  // 例: 土壌ガス '採取' は prevCol='SAKKO_T' (削孔が前) に上書き
  //     土壌ガス '受入' は prevCol=null に上書き (単独可)
  //     土壌ガス '分析' は prevCol='UKEIRE' に上書き (受入が前)
  const modeOverride = (kc.modeOverrides && kc.modeOverrides[mode]) || null;
  const effectivePrevCol = (modeOverride && ('prevCol' in modeOverride))
    ? modeOverride.prevCol
    : cfg.prevCol;
  if (effectivePrevCol) {
    const prevCol = kc.workCols[effectivePrevCol];
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
            mode: mode, code: baseCode,
            autoMode: autoSwitched ? mode : null
          };
        }
      }
    }
  }

  // 書込 (削除地点なら赤文字、通常は黒)
  const now = new Date();
  const fontColor = isDeleted ? DELETED_FONT_COLOR : null;
  targetCell.setValue(now);
  targetCell.setNumberFormat('yyyy/MM/dd HH:mm');
  if (fontColor) targetCell.setFontColor(fontColor);
  else targetCell.setFontColor(null);
  const workerCell = sheet.getRange(foundRow, workerCol);
  workerCell.setValue(worker);
  if (fontColor) workerCell.setFontColor(fontColor);
  else workerCell.setFontColor(null);

  // 日報シートに追記 (土壌ガスは除外)
  // 日報B列: 表層土壌=上下、配管下/深度調査=深度、地下水=空
  if (kind !== '土壌ガス') {
    try {
      let dailyBCol = '';
      if (kc.hasUd) {
        dailyBCol = udDisplay(ud);
      } else if (kc.workCols.DEPTH) {
        // 配管下 or 深度調査: 書込先シートのDEPTH列から取得
        try {
          const d = sheet.getRange(foundRow, kc.workCols.DEPTH).getDisplayValue();
          dailyBCol = String(d || '').trim();
        } catch (e) {}
      }
      logToDailyReport(ss, mode, point, dailyBCol, worker, now);
    } catch (e) {}
  }

  // 風乾完了 → 上下揃いチェック → M列追加 (表層土壌のみ。配管下は上下なしのため別ロジック)
  let mergeNote = '';
  if (mode === '風乾') {
    try {
      if (kind === '表層土壌') {
        const merged = checkAndMergeIfReadyHyoso_(ss, point);
        if (merged) mergeNote = ' / 上下揃い → M列追加: ' + point;
      } else if (kind === '配管・ピット・盛土下') {
        // 上下概念なし → 風乾完了の瞬間に即追加
        const added = addToMaster(ss, SHEET_ZENSHORI, point);
        if (added) {
          addToMaster(ss, SHEET_BUNSEKI, point);
          try { SpreadsheetApp.flush(); generateBarcodesForPoint(ss, point); } catch (e) {}
          mergeNote = ' / M列追加: ' + point;
        }
      }
    } catch (e) {
      mergeNote = ' / M列追加失敗: ' + e.message;
    }
  }

  const udDispMsg = kc.hasUd ? '(' + udDisplay(ud) + ')' : '';
  const delTag = isDeleted ? ' [削除地点・赤文字]' : '';
  return {
    ok: true,
    message: mode + ' 記録完了: ' + point + udDispMsg + ' 担当:' + worker + mergeNote + delTag,
    kind: kind,
    mode: mode, autoMode: autoSwitched ? mode : null,
    point: point, ud: ud, worker: worker,
    isDeleted: isDeleted,
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss')
  };
}

function udNormalize(ud) {
  const s = String(ud).toLowerCase().trim();
  if (s === 'up' || s === '上') return 'up';
  if (s === 'down' || s === '下') return 'down';
  return s;
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

// ========== 上下揃い → M列追加 (表層土壌専用) ==========
function checkAndMergeIfReadyHyoso_(ss, point) {
  const kc = KIND_CONFIG['表層土壌'];
  const sheet = ss.getSheetByName(kc.workSheet);
  if (!sheet) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  // 必要範囲: A(POINT) ～ FUKAN列まで
  const data = sheet.getRange(2, 1, lastRow - 1, kc.workCols.FUKAN).getValues();
  let upDone = false, downDone = false;
  for (const row of data) {
    if (String(row[kc.workCols.POINT - 1]).trim() === String(point).trim()) {
      const ud = String(row[kc.workCols.UD - 1]).toLowerCase().trim();
      const fukan = row[kc.workCols.FUKAN - 1];
      if (fukan) {
        if (ud === 'up' || ud === '上') upDone = true;
        if (ud === 'down' || ud === '下') downDone = true;
      }
    }
  }
  if (!(upDone && downDone)) return false;

  // 前処理シート + 分析シート の M列に追加(重複チェック付き)
  let added = false;
  if (addToMaster(ss, SHEET_ZENSHORI, point)) added = true;
  if (addToMaster(ss, SHEET_BUNSEKI,  point)) added = true;

  // M列追加成功 → 数式展開(B,C列)を確定させてバーコード生成を試行
  if (added) {
    try {
      SpreadsheetApp.flush();
      generateBarcodesForPoint(ss, point);
    } catch (e) {
      // バーコード生成失敗してもM列追加自体は成功扱い
    }
  }
  return added;
}

function addToMaster(ss, sheetName, point) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return false;
  const M = COL_ZENSHORI.M; // = 13、両シート共通想定
  const lastRow = Math.max(sheet.getLastRow(), 1);
  // M列の既存値を取得して重複チェック
  let writeRow = 2;
  if (lastRow >= 2) {
    const vals = sheet.getRange(2, M, lastRow - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      const v = String(vals[i][0]).trim();
      if (v === String(point).trim()) return false; // 既存
    }
    // 末尾の空きを探す
    writeRow = 2;
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).trim() !== '') writeRow = i + 3;
      else { writeRow = i + 2; break; }
    }
  }
  sheet.getRange(writeRow, M).setValue(point);
  return true;
}

// ========== バーコード作成シート生成 ==========

/**
 * バーコード作成シートを取得(なければ作成)。
 * 列幅・ヘッダー行・固定行を A4縦印刷用にセット。
 */
function ensureBarcodeSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_BARCODE_GEN);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_BARCODE_GEN);
  }
  // 6列の列幅 + G列(チェックボックス)
  for (let c = 1; c <= CARD_COLS; c++) {
    sheet.setColumnWidth(c, CARD_COL_WIDTH);
  }
  sheet.setColumnWidth(BARCODE_PRINT_FLAG_COL, 50);

  // ヘッダー行 (A1:F1 結合)
  const headerRange = sheet.getRange(1, 1, 1, CARD_COLS);
  const cur = String(headerRange.getCell(1, 1).getValue()).trim();
  if (!cur) {
    try { headerRange.merge(); } catch (e) {}
    headerRange
      .setValue('shast LAB バーコード一覧')
      .setFontWeight('bold')
      .setFontSize(12)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setBackground('#f5f5f5');
    sheet.setRowHeight(1, HEADER_ROW_HEIGHT);
    sheet.setFrozenRows(1);
  }
  // G1 ヘッダー (印刷フラグ列)
  const flagHeader = sheet.getRange(1, BARCODE_PRINT_FLAG_COL);
  if (!String(flagHeader.getValue()).trim()) {
    flagHeader
      .setValue('印刷')
      .setFontWeight('bold')
      .setFontSize(11)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setBackground('#f5f5f5');
  }
  return sheet;
}

/**
 * バーコード作成シートで該当地点のブロック数(=行位置インデックス)を返す。
 * 既存ブロックを ラベル行(各ブロック先頭+2)の col1 文字列で識別。
 *  - 戻り値: 既存ブロック先頭行 (>=2) または 新規追加すべき先頭行
 */
function findOrAllocateBlockTop(bs, point) {
  const lastRow = bs.getLastRow();
  let blockCount = 0;
  // ラベル行 = ブロック先頭+2 → 行 4, 8, 12...
  for (let r = 4; r <= lastRow; r += CARD_ROWS_PER_BLOCK) {
    const v = String(bs.getRange(r, 1).getValue()).trim();
    if (!v) break;
    if (v.indexOf(point + ' ') === 0) {
      return { top: r - 2, isNew: false };
    }
    blockCount++;
  }
  return { top: 2 + blockCount * CARD_ROWS_PER_BLOCK, isNew: true };
}

/**
 * 指定地点のバーコードカードブロックを書き込む。
 * 1ブロック = 4行 (QR行 / 色マーク行 / ラベル行 / 空白行)
 * 横6カード = R-ろか / B-ろか / K-ろか / R-振り / B-振り / K-振り
 * 該当地点で C列に存在しない色のセルは空欄(歯抜け)。
 */
function generateBarcodesForPoint(ss, point) {
  const zen = ss.getSheetByName(SHEET_ZENSHORI);
  if (!zen) return { added: 0, message: '前処理シートなし' };
  const lastRow = zen.getLastRow();
  if (lastRow < 2) return { added: 0, message: '前処理にデータなし' };

  // 当該地点で C列が非空の色を抽出
  const bc = zen.getRange(2, COL_ZENSHORI.POINT, lastRow - 1, 2).getValues();
  const colorSet = {};
  const target = String(point).trim();
  for (const row of bc) {
    const p = String(row[0]).trim();
    const c = String(row[1]).trim().toUpperCase();
    if (p === target && BARCODE_COLORS.indexOf(c) >= 0) {
      colorSet[c] = true;
    }
  }
  const colorCount = Object.keys(colorSet).length;
  if (colorCount === 0) {
    return { added: 0, message: 'C列に色情報なし(' + point + ')' };
  }

  const bs = ensureBarcodeSheet(ss);
  const alloc = findOrAllocateBlockTop(bs, target);
  writeBarcodeBlock(bs, alloc.top, target, colorSet);
  return { added: colorCount, point: target, top: alloc.top, isNew: alloc.isNew };
}

/**
 * 1ブロックを書き込む (top行から4行ぶん)。
 */
function writeBarcodeBlock(bs, top, point, colorSet) {
  const qrRow    = top;
  const colorRow = top + 1;
  const labelRow = top + 2;
  const gapRow   = top + 3;

  const qrFormulas = [];
  const colorBgs   = [];
  const colorTexts = [];
  const labels     = [];

  for (const card of BARCODE_CARD_LAYOUT) {
    if (colorSet[card.color]) {
      const code = point + '-' + card.color + '-' + card.suffix;
      qrFormulas.push(
        '=IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=' +
        BARCODE_QR_SIZE + 'x' + BARCODE_QR_SIZE +
        '&data="&ENCODEURL("' + code + '"), 4, ' +
        BARCODE_QR_SIZE + ', ' + BARCODE_QR_SIZE + ')'
      );
      colorBgs.push(BARCODE_COLOR_HEX[card.color]);
      // 振りカードのみ色マーク行に「ペコタン」を白文字で表示
      colorTexts.push(card.suffix === 'huri' ? 'ペコタン' : '');
      labels.push(point + ' ' + card.color + ' ' + card.label);
    } else {
      qrFormulas.push('');
      colorBgs.push('#ffffff');
      colorTexts.push('');
      labels.push('');
    }
  }

  // QR行
  const qrRange = bs.getRange(qrRow, 1, 1, CARD_COLS);
  qrRange.setFormulas([qrFormulas]);
  qrRange.setHorizontalAlignment('center').setVerticalAlignment('middle');

  // 色マーク行 (振りのみ「ペコタン」白文字)
  const colorRange = bs.getRange(colorRow, 1, 1, CARD_COLS);
  colorRange.setBackgrounds([colorBgs]);
  colorRange.setValues([colorTexts]);
  colorRange.setFontColor('#ffffff');
  colorRange.setFontWeight('bold');
  colorRange.setFontSize(11);
  colorRange.setHorizontalAlignment('center');
  colorRange.setVerticalAlignment('middle');

  // ラベル行
  const labelRange = bs.getRange(labelRow, 1, 1, CARD_COLS);
  labelRange.setValues([labels])
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setFontSize(11)
    .setFontWeight('bold')
    .setBackground('#ffffff');

  // 空白行(切り取り余白)
  bs.getRange(gapRow, 1, 1, CARD_COLS).setBackground('#ffffff').setValues([['','','','','','']]);

  // 行高
  bs.setRowHeight(qrRow, ROW_QR_HEIGHT);
  bs.setRowHeight(colorRow, ROW_COLOR_HEIGHT);
  bs.setRowHeight(labelRow, ROW_LABEL_HEIGHT);
  bs.setRowHeight(gapRow, ROW_GAP_HEIGHT);

  // 印刷フラグ用チェックボックス (ラベル行のG列、初期=TRUE=印刷待ち)
  const flagCell = bs.getRange(labelRow, BARCODE_PRINT_FLAG_COL);
  const checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  flagCell.setDataValidation(checkboxRule);
  flagCell.setValue(true);
  flagCell.setHorizontalAlignment('center');
}

/**
 * 手動再生成: バーコード作成シートを一旦クリアし、
 * 前処理シートのB列にある全地点について再生成。
 *
 * クライアント(Web UI)から呼ばれる。戻り値オブジェクトをトーストで表示する想定。
 */
function regenerateAllBarcodes(spreadsheetId) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    const zen = ss.getSheetByName(SHEET_ZENSHORI);
    if (!zen) return { ok: false, message: '前処理シートが見つかりません' };

    const lastRow = zen.getLastRow();
    if (lastRow < 2) return { ok: false, message: '前処理シートにデータがありません' };

    const bs = ensureBarcodeSheet(ss);
    // 既存ブロック領域をクリア (ヘッダー行は残す)
    const bsLast = bs.getLastRow();
    if (bsLast >= 2) {
      bs.getRange(2, 1, bsLast - 1, CARD_COLS).clear();
    }

    // 全地点を出現順で抽出 (重複除去)
    const bc = zen.getRange(2, COL_ZENSHORI.POINT, lastRow - 1, 1).getValues();
    const points = [];
    bc.forEach(function(r) {
      const p = String(r[0]).trim();
      if (p && points.indexOf(p) < 0) points.push(p);
    });

    let blockCount = 0;
    let skipped = 0;
    points.forEach(function(p) {
      const r = generateBarcodesForPoint(ss, p);
      if (r.added) blockCount++; else skipped++;
    });

    return {
      ok: true,
      message: 'バーコード再生成完了 / 対象 ' + points.length + '件 / 生成 ' + blockCount + '件 / スキップ ' + skipped,
      total: points.length, generated: blockCount, skipped: skipped
    };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== フェーズ2/3: 前処理/分析シート ==========
function handlePhase2or3(ss, mode, cfg, parsed, worker, force, autoSwitched) {
  const sheet = ss.getSheetByName(cfg.sheet);
  if (!sheet) return { ok: false, message: '「' + cfg.sheet + '」シートが見つかりません' };

  // suffix mismatch チェック
  if (cfg.expectedSuffix && parsed.suffix !== cfg.expectedSuffix) {
    return { ok: false, message: mode + ' モードでは -' + cfg.expectedSuffix + ' のコードを読んでください' };
  }

  const point = parsed.point;
  const color = parsed.color;
  if (!point || !color) {
    return { ok: false, message: 'コード形式が不正です: ' + parsed.point + '-' + parsed.color };
  }

  // 該当行検索 (B列=地点名 C列=色)
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: false, message: '「' + cfg.sheet + '」シートにデータがありません(M列展開未完了の可能性)' };
  }
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  let foundRow = -1;
  for (let i = 0; i < data.length; i++) {
    const p = String(data[i][1]).trim();
    const c = String(data[i][2]).trim().toUpperCase();
    if (p === point && c === color.toUpperCase()) {
      foundRow = i + 2;
      break;
    }
  }
  if (foundRow < 0) {
    return { ok: false, message: cfg.sheet + 'シートに ' + point + ' の ' + color + ' 行が見つかりません' };
  }

  const colDef = (cfg.sheet === SHEET_ZENSHORI) ? COL_ZENSHORI : COL_BUNSEKI;
  const targetCol = colDef[cfg.col];
  const workerCol = colDef[cfg.workerCol];

  const targetCell = sheet.getRange(foundRow, targetCol);
  const existing = targetCell.getValue();
  if (existing) {
    const t = (existing instanceof Date) ? existing : new Date(existing);
    return {
      ok: false,
      message: mode + ' は既に記録済み: ' + Utilities.formatDate(t, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
    };
  }

  // 順番チェック
  if (cfg.prevCol) {
    const prevVal = sheet.getRange(foundRow, colDef[cfg.prevCol]).getValue();
    if (!prevVal && !force) {
      const prevLabel = cfg.prevLabel || '前工程';
      return {
        ok: false, needConfirm: true,
        message: prevLabel + ' が完了していませんが ' + mode + ' を記録しますか？',
        mode: mode, code: parsed.point + '-' + parsed.color + '-' + parsed.suffix,
        autoMode: autoSwitched ? mode : null
      };
    }
  }

  // 書込
  const now = new Date();
  targetCell.setValue(now);
  targetCell.setNumberFormat('yyyy/MM/dd HH:mm');
  sheet.getRange(foundRow, workerCol).setValue(worker);

  // 日報シートに追記 (振り/ろかのみ。分析は除外)
  try {
    logToDailyReport(ss, mode, point, color.toUpperCase(), worker, now);
  } catch (e) {}

  return {
    ok: true,
    message: mode + ' 記録完了: ' + point + ' ' + color + ' 担当:' + worker,
    mode: mode, autoMode: autoSwitched ? mode : null,
    point: point, color: color, worker: worker,
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss')
  };
}

// ========== マイグレーション (v2→v3、初回のみ実行) ==========
/**
 * 工程時刻シートを v2 旧レイアウト(D採取 E受入 F風乾 G振動 H濾過 I分析)から
 * v3 新レイアウト(D採取 E採取担当 F受入 G受入担当 H風乾 I風乾担当)に変換。
 *
 * クライアント(Web UI)から呼ばれる。戻り値オブジェクトをトーストで表示する想定。
 */
function migrateKoteiToV3(spreadsheetId) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    const sheet = ss.getSheetByName(SHEET_KOTEI);
    if (!sheet) return { ok: false, message: '工程時刻シートが見つかりません' };

    const lastRow = sheet.getLastRow();

    // 旧データを退避 (D=採取, E=旧受入, F=旧風乾, G/H/I=破棄)
    let oldData = [];
    if (lastRow >= 2) {
      oldData = sheet.getRange(2, 4, lastRow - 1, 6).getValues(); // D:I
    }

    // ヘッダー書き換え
    sheet.getRange(1, 1, 1, 9).setValues([[
      '地点', '上下', 'コード',
      '採取', '採取担当',
      '受入', '受入担当',
      '風乾', '風乾担当'
    ]]);

    // 旧 E/F/G/H/I 列をクリア
    if (lastRow >= 2) {
      sheet.getRange(2, 5, lastRow - 1, 5).clearContent(); // E:I
    }

    // 新レイアウトに書き戻し
    if (oldData.length > 0) {
      const newData = oldData.map(function(row) {
        const saishu     = row[0]; // 旧D
        const ukeireOld  = row[1]; // 旧E
        const fukanOld   = row[2]; // 旧F
        // 旧G/H/I は破棄
        return [saishu, '', ukeireOld, '', fukanOld, ''];
      });
      sheet.getRange(2, 4, newData.length, 6).setValues(newData);

      // 日時列の表示形式
      sheet.getRange(2, 4, newData.length, 1).setNumberFormat('yyyy/MM/dd HH:mm'); // D
      sheet.getRange(2, 6, newData.length, 1).setNumberFormat('yyyy/MM/dd HH:mm'); // F
      sheet.getRange(2, 8, newData.length, 1).setNumberFormat('yyyy/MM/dd HH:mm'); // H
    }

    return {
      ok: true,
      message: 'マイグレーション完了: 工程時刻シートを v3 レイアウトに変換しました'
    };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== 日報シート (LABO1: 受入/風乾/振り/ろか) ==========
const DAILY_REPORT_MODES = ['受入', '風乾', '振り', 'ろか'];
const DAILY_REPORT_HEADER = ['地点', '上下/RBK', '工程', '日時', '担当者'];

/**
 * 当日の日報シートに1行追記。シートが無ければ作成しヘッダーも書き込む。
 */
function logToDailyReport(ss, mode, point, udOrColor, worker, time) {
  if (DAILY_REPORT_MODES.indexOf(mode) < 0) return;
  const sheetName = Utilities.formatDate(time || new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, DAILY_REPORT_HEADER.length).setValues([DAILY_REPORT_HEADER]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, DAILY_REPORT_HEADER.length).setFontWeight('bold');
    sheet.setColumnWidths(1, 5, 100);
  }
  const timeStr = Utilities.formatDate(time || new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sheet.appendRow([point, udOrColor, mode, timeStr, worker]);
}

/**
 * 当日の日報シートのデータを返す。
 * クライアント側で HTML テーブルとして新タブに描画 → window.print()。
 * PDFファイルは一切作らないので、ダウンロード保存も発生しない。
 */
function getDailyReportData(spreadsheetId) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    const sheet = ss.getSheetByName(today);
    if (!sheet) {
      return { ok: false, message: '本日の日報シート ' + today + ' が見つかりません(まだ記録なし)' };
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { ok: false, message: '本日の日報シートはまだ空です' };
    }
    // getDisplayValues = 表示形式そのまま (時刻 "10:23" 等が文字列で返る)
    const values = sheet.getRange(1, 1, lastRow, DAILY_REPORT_HEADER.length).getDisplayValues();
    const header = values[0].map(v => String(v == null ? '' : v));
    const rows = values.slice(1).map(r => r.map(v => String(v == null ? '' : v)));
    return { ok: true, name: today, header: header, rows: rows };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

/**
 * バーコード印刷用データを返す。
 * バーコード作成シートのブロックを走査し、G列チェックボックスが TRUE の地点のみを対象。
 * カードの色情報は ラベル行(各ブロック先頭+2)の値 "A1-1 R ろか" を解析して取得。
 *
 * 戻り値: { ok, points: [{point, colors: ['R','B','K']}, ...] }
 */
function getBarcodePrintData(spreadsheetId) {
  try {
    const ss = openSpreadsheet_(spreadsheetId);
    const bs = ss.getSheetByName(SHEET_BARCODE_GEN);
    if (!bs) {
      return { ok: false, message: 'バーコード作成シートが見つかりません(まずスキャン or regenerateAllBarcodes を実行)' };
    }
    const lastRow = bs.getLastRow();
    if (lastRow < 4) {
      return { ok: false, message: 'バーコード作成シートにデータがありません' };
    }

    const points = [];
    // ラベル行 = 4, 8, 12...
    for (let labelRow = 4; labelRow <= lastRow; labelRow += CARD_ROWS_PER_BLOCK) {
      // ラベル6セル + チェックボックス1セル を一括取得
      const range = bs.getRange(labelRow, 1, 1, BARCODE_PRINT_FLAG_COL).getValues()[0];
      const labels = range.slice(0, CARD_COLS);
      const checked = range[BARCODE_PRINT_FLAG_COL - 1];

      const firstLabel = String(labels[0] || '').trim();
      // ブロックが完全に空ならそこで終了
      if (!firstLabel && !labels.some(v => String(v || '').trim())) break;
      // チェック未選択ならスキップ
      if (checked !== true) continue;

      let point = null;
      const colorSet = {};
      for (let i = 0; i < labels.length; i++) {
        const txt = String(labels[i] || '').trim();
        if (!txt) continue;
        // "A1-1 R ろか" 形式
        const parts = txt.split(/\s+/);
        if (parts.length < 2) continue;
        if (!point) point = parts[0];
        const color = parts[1];
        if (BARCODE_COLORS.indexOf(color) >= 0) colorSet[color] = true;
      }
      if (point && Object.keys(colorSet).length > 0) {
        points.push({
          point: point,
          colors: BARCODE_COLORS.filter(c => colorSet[c])
        });
      }
    }

    if (points.length === 0) {
      return { ok: false, message: '印刷対象のバーコードがありません(チェックボックスを確認してください)' };
    }
    return { ok: true, points: points };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

/**
 * 印刷完了マーク: 指定地点リストの G列チェックボックスを FALSE にする。
 * クライアント側で印刷完了ボタンが押されたときに呼ばれる。
 *
 * @param {string[]} pointList 地点名の配列 (例: ['A1-1', 'A1-2'])
 * @return {Object} { ok, unchecked: 件数 }
 */
function markBarcodePrinted(spreadsheetId, pointList) {
  try {
    if (!Array.isArray(pointList) || pointList.length === 0) {
      return { ok: false, message: '対象地点がありません' };
    }
    const targetSet = {};
    pointList.forEach(function(p) {
      const s = String(p || '').trim();
      if (s) targetSet[s] = true;
    });

    const ss = openSpreadsheet_(spreadsheetId);
    const bs = ss.getSheetByName(SHEET_BARCODE_GEN);
    if (!bs) return { ok: false, message: 'バーコード作成シートが見つかりません' };
    const lastRow = bs.getLastRow();
    if (lastRow < 4) return { ok: false, message: 'データなし' };

    let unchecked = 0;
    for (let labelRow = 4; labelRow <= lastRow; labelRow += CARD_ROWS_PER_BLOCK) {
      const firstLabel = String(bs.getRange(labelRow, 1).getValue() || '').trim();
      if (!firstLabel) break;
      const point = firstLabel.split(/\s+/)[0];
      if (targetSet[point]) {
        bs.getRange(labelRow, BARCODE_PRINT_FLAG_COL).setValue(false);
        unchecked++;
      }
    }
    return { ok: true, unchecked: unchecked };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== ユーティリティ ==========
function udDisplay(ud) {
  const s = String(ud).toLowerCase().trim();
  if (s === 'up' || s === '上') return '上';
  if (s === 'down' || s === '下') return '下';
  return ud;
}
