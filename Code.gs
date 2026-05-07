/**
 * shast LAB - GAS Web App (v4)
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
const SHEET_KOTEI       = '工程時刻';
const SHEET_ZENSHORI    = '前処理';
const SHEET_BUNSEKI     = '分析';
const SHEET_BARCODE_GEN = 'バーコード作成';

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
const BARCODE_QR_SIZE      = 80;   // QR画像px (mode 4 で実寸)
const CARD_COLS            = 6;    // 横6カード
const CARD_ROWS_PER_BLOCK  = 4;    // QR(1) + 色(1) + ラベル(1) + 空白(1)
const CARD_COL_WIDTH       = 120;  // 列幅: QR80 + 左右余白(切り取り用隙間)
const ROW_QR_HEIGHT        = 85;
const ROW_COLOR_HEIGHT     = 15;
const ROW_LABEL_HEIGHT     = 20;
const ROW_GAP_HEIGHT       = 8;
const HEADER_ROW_HEIGHT    = 24;

// ========== 列定義 ==========
const COL_KOTEI = {
  POINT:    1,  // A
  UD:       2,  // B
  CODE:     3,  // C
  SAISHU:   4,  // D 採取時刻
  SAISHU_W: 5,  // E 採取担当
  UKEIRE:   6,  // F 受入時刻
  UKEIRE_W: 7,  // G 受入担当
  FUKAN:    8,  // H 風乾時刻
  FUKAN_W:  9   // I 風乾担当
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

// ========== Web App エントリ ==========
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('shast LAB 入力')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
 * @param {string} mode  - UI上の選択モード
 * @param {string} code  - スキャンコード
 * @param {boolean} force - 順番警告無視
 * @return {Object}
 */
function handleScan(mode, code, force) {
  try {
    if (!code || !String(code).trim()) {
      return { ok: false, message: 'コードが空です' };
    }
    code = String(code).trim();

    const props = PropertiesService.getScriptProperties();
    const worker = props.getProperty(PROP_CURRENT_WORKER) || '';
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

    // フェーズ別処理
    if (cfg.phase === 1) {
      return handlePhase1(effectiveMode, cfg, parsed.baseCode, worker, force, autoSwitched);
    } else {
      return handlePhase2or3(effectiveMode, cfg, parsed, worker, force, autoSwitched);
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

// ========== フェーズ1: 工程時刻シート ==========
function handlePhase1(mode, cfg, baseCode, worker, force, autoSwitched) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_KOTEI);
  if (!sheet) return { ok: false, message: '「' + SHEET_KOTEI + '」シートが見つかりません' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, message: '工程時刻シートにデータがありません' };

  // C列でベースコード検索
  const codes = sheet.getRange(2, COL_KOTEI.CODE, lastRow - 1, 1).getValues();
  let foundRow = -1;
  for (let i = 0; i < codes.length; i++) {
    if (String(codes[i][0]).trim() === baseCode) {
      foundRow = i + 2;
      break;
    }
  }
  if (foundRow < 0) {
    return { ok: false, message: 'コード ' + baseCode + ' が見つかりません(採取記録なし)' };
  }

  const point = sheet.getRange(foundRow, COL_KOTEI.POINT).getValue();
  const ud    = sheet.getRange(foundRow, COL_KOTEI.UD).getValue();

  const targetCol  = COL_KOTEI[cfg.col];
  const workerCol  = COL_KOTEI[cfg.workerCol];
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

  // 順番チェック
  if (cfg.prevCol) {
    const prevVal = sheet.getRange(foundRow, COL_KOTEI[cfg.prevCol]).getValue();
    if (!prevVal) {
      const prevName = phase1ColName(cfg.prevCol);
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

  // 書込
  const now = new Date();
  targetCell.setValue(now);
  targetCell.setNumberFormat('yyyy/MM/dd HH:mm');
  sheet.getRange(foundRow, workerCol).setValue(worker);

  // 日報シートに追記 (受入/風乾のみ)
  try {
    logToDailyReport(ss, mode, point, udDisplay(ud), worker, now);
  } catch (e) {}

  // 風乾完了 → 上下揃いチェック → M列追加
  let mergeNote = '';
  if (mode === '風乾') {
    try {
      const merged = checkAndMergeIfReady(ss, point);
      if (merged) mergeNote = ' / 上下揃い → M列追加: ' + point;
    } catch (e) {
      mergeNote = ' / M列追加失敗: ' + e.message;
    }
  }

  return {
    ok: true,
    message: mode + ' 記録完了: ' + point + '(' + udDisplay(ud) + ') 担当:' + worker + mergeNote,
    mode: mode, autoMode: autoSwitched ? mode : null,
    point: point, ud: ud, worker: worker,
    time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss')
  };
}

function phase1ColName(colKey) {
  switch (colKey) {
    case 'SAISHU': return '採取';
    case 'UKEIRE': return '受入';
    case 'FUKAN':  return '風乾';
    default: return colKey;
  }
}

// ========== 上下揃い → M列追加 ==========
function checkAndMergeIfReady(ss, point) {
  const sheet = ss.getSheetByName(SHEET_KOTEI);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const data = sheet.getRange(2, 1, lastRow - 1, COL_KOTEI.FUKAN).getValues();
  let upDone = false, downDone = false;
  for (const row of data) {
    if (String(row[COL_KOTEI.POINT - 1]).trim() === String(point).trim()) {
      const ud = String(row[COL_KOTEI.UD - 1]).toLowerCase().trim();
      const fukan = row[COL_KOTEI.FUKAN - 1];
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
  // 6列の列幅
  for (let c = 1; c <= CARD_COLS; c++) {
    sheet.setColumnWidth(c, CARD_COL_WIDTH);
  }
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
      labels.push(point + ' ' + card.color + ' ' + card.label);
    } else {
      qrFormulas.push('');
      colorBgs.push('#ffffff');
      labels.push('');
    }
  }

  // QR行
  const qrRange = bs.getRange(qrRow, 1, 1, CARD_COLS);
  qrRange.setFormulas([qrFormulas]);
  qrRange.setHorizontalAlignment('center').setVerticalAlignment('middle');

  // 色マーク行
  const colorRange = bs.getRange(colorRow, 1, 1, CARD_COLS);
  colorRange.setBackgrounds([colorBgs]);
  colorRange.setValues([['', '', '', '', '', '']]);

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
}

/**
 * 手動再生成: バーコード作成シートを一旦クリアし、
 * 前処理シートのB列にある全地点について再生成。
 *
 * 実行方法: Apps Scriptエディタで関数 regenerateAllBarcodes を選択して▶実行
 */
function regenerateAllBarcodes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const zen = ss.getSheetByName(SHEET_ZENSHORI);
  if (!zen) {
    SpreadsheetApp.getUi().alert('前処理シートが見つかりません');
    return;
  }
  const lastRow = zen.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('前処理シートにデータがありません');
    return;
  }

  const bs = ensureBarcodeSheet(ss);
  // 既存ブロック領域をクリア (ヘッダー行は残す)
  const bsLast = bs.getLastRow();
  if (bsLast >= 2) {
    bs.getRange(2, 1, bsLast - 1, CARD_COLS).clear();
  }

  // 全地点を出現順で抽出 (重複除去)
  const bc = zen.getRange(2, COL_ZENSHORI.POINT, lastRow - 1, 1).getValues();
  const points = [];
  bc.forEach(r => {
    const p = String(r[0]).trim();
    if (p && points.indexOf(p) < 0) points.push(p);
  });

  let blockCount = 0;
  let skipped = 0;
  points.forEach(p => {
    const r = generateBarcodesForPoint(ss, p);
    if (r.added) blockCount++; else skipped++;
  });

  SpreadsheetApp.getUi().alert(
    'バーコード再生成完了\n' +
    '・処理対象地点: ' + points.length + '件\n' +
    '・生成ブロック: ' + blockCount + '件\n' +
    '・スキップ(色情報なし): ' + skipped
  );
}

// ========== フェーズ2/3: 前処理/分析シート ==========
function handlePhase2or3(mode, cfg, parsed, worker, force, autoSwitched) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
 * 実行方法: Apps Scriptエディタで関数 migrateKoteiToV3 を選択して▶実行
 *           初回のみ承認ダイアログが出る
 */
function migrateKoteiToV3() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_KOTEI);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('工程時刻シートが見つかりません');
    return;
  }
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
    const newData = oldData.map(row => {
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

  SpreadsheetApp.getUi().alert(
    'マイグレーション完了\n' +
    '工程時刻シートを v3 レイアウトに変換しました。\n' +
    '・受入時刻: E列 → F列\n' +
    '・風乾時刻: F列 → H列\n' +
    '・旧 振動/濾過/分析 列は削除（前処理/分析シートに移管済み）'
  );
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
function getDailyReportData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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

// ========== ユーティリティ ==========
function udDisplay(ud) {
  const s = String(ud).toLowerCase().trim();
  if (s === 'up' || s === '上') return '上';
  if (s === 'down' || s === '下') return '下';
  return ud;
}
