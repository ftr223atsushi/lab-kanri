/**
 * shast LAB - GAS Web App (v2)
 *
 * ラボ用バーコードスキャン入力UI + サブコードQRラベル生成
 *
 * 工程マッピング:
 *  - 0001 (無印)   → 採取 / 受入 / 風乾 (モード選択)  順番厳格
 *  - 0001-1        → 振動 (自動)                     順番柔軟(警告ダイアログ)
 *  - 0001-2        → 濾過 (自動)                     順番柔軟
 *  - 0001-3        → 分析 (自動)                     順番柔軟
 *
 * 工程時刻シート列構成:
 *  A=地点 B=上下 C=コード D=採取 E=受入 F=風乾 G=振動 H=濾過 I=分析
 *
 * 担当者管理:
 *  - 既存システムの operator_name とは独立 (lab_current_worker)
 *  - 既定6名 + 動的追加可能
 */

// ========== 定数 ==========
const SHEET_KOTEI = '工程時刻';
const SHEET_QR    = 'バーコード作成';

const COL_KOTEI = {
  POINT:   1, // A
  UD:      2, // B
  CODE:    3, // C
  SAISHU:  4, // D 採取
  UKEIRE:  5, // E 受入
  FUKAN:   6, // F 風乾
  SHINDOU: 7, // G 振動
  ROKA:    8, // H 濾過
  BUNSEKI: 9  // I 分析
};

// モード定義
//   col       : 書込先列番号
//   suffix    : 期待サブコード (null=ベースコード, '1'/'2'/'3'=サブコード)
//   prevCol   : 直前工程の列番号 (順番チェック用、null=なし)
//   strict    : true=前工程未完了でエラー / false=警告ダイアログで強行可能
const MODES = {
  '採取': { col: COL_KOTEI.SAISHU,  suffix: null, prevCol: null,             strict: true,  qrSubcode: null },
  '受入': { col: COL_KOTEI.UKEIRE,  suffix: null, prevCol: COL_KOTEI.SAISHU, strict: true,  qrSubcode: null },
  '風乾': { col: COL_KOTEI.FUKAN,   suffix: null, prevCol: COL_KOTEI.UKEIRE, strict: true,  qrSubcode: null },
  '振動': { col: COL_KOTEI.SHINDOU, suffix: '1',  prevCol: COL_KOTEI.FUKAN,   strict: false, qrSubcode: '1' },
  '濾過': { col: COL_KOTEI.ROKA,    suffix: '2',  prevCol: COL_KOTEI.SHINDOU, strict: false, qrSubcode: '2' },
  '分析': { col: COL_KOTEI.BUNSEKI, suffix: '3',  prevCol: COL_KOTEI.ROKA,    strict: false, qrSubcode: '3' }
};

// suffix → モード逆引き (自動切替用)
const SUFFIX_TO_MODE = { '1': '振動', '2': '濾過', '3': '分析' };

// 担当者管理
const DEFAULT_WORKERS = ['川村', '山田', '川添', '石徹白', '早川', '田中'];
const PROP_WORKERS         = 'lab_workers';        // 動的追加された担当者リスト(JSON)
const PROP_CURRENT_WORKER  = 'lab_current_worker'; // 現在ログイン中の担当者名

const QR_SIZE = 200; // QR画像サイズ(px)

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
  // デフォルト + 追加分(重複除去)
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
 * @param {string} mode  - UI上で選択中のモード ('採取'|'受入'|'風乾'|'振動'|'濾過'|'分析'|'')
 * @param {string} code  - スキャンされた文字列
 * @param {boolean} force - true=順番警告を無視して強行
 * @return {Object} { ok, message, point, ud, baseCode, mode, time, needConfirm, autoMode }
 */
function handleScan(mode, code, force) {
  try {
    if (!code || !String(code).trim()) {
      return { ok: false, message: 'コードが空です' };
    }
    code = String(code).trim();

    // suffix判定 → 自動モード切替
    const parts = code.split('-');
    const baseCode = parts[0];
    const suffix = parts.length > 1 ? parts[1] : null;

    let effectiveMode = mode;
    let autoSwitched = false;

    if (suffix !== null) {
      // サブコード(-1/-2/-3)の場合は強制的に対応モード
      const auto = SUFFIX_TO_MODE[suffix];
      if (!auto) {
        return { ok: false, message: '不明なサブコード: -' + suffix };
      }
      if (effectiveMode !== auto) {
        autoSwitched = true;
        effectiveMode = auto;
      }
    } else {
      // ベースコード: モードが未選択 or サブコード系モードならエラー
      if (!effectiveMode) {
        return { ok: false, message: 'モードを選択してください (採取/受入/風乾)' };
      }
      const cfg = MODES[effectiveMode];
      if (!cfg) {
        return { ok: false, message: 'モードが不正です: ' + effectiveMode };
      }
      if (cfg.suffix !== null) {
        return { ok: false, message: effectiveMode + 'モードでは末尾「-' + cfg.suffix + '」のコードを読んでください' };
      }
    }

    const cfg = MODES[effectiveMode];

    // 工程時刻シートでベースコード検索
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_KOTEI);
    if (!sheet) {
      return { ok: false, message: '「' + SHEET_KOTEI + '」シートが見つかりません' };
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { ok: false, message: '工程時刻シートにデータがありません' };
    }

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

    // 二重記録チェック
    const targetCell = sheet.getRange(foundRow, cfg.col);
    const existing = targetCell.getValue();
    if (existing) {
      const t = (existing instanceof Date) ? existing : new Date(existing);
      return {
        ok: false,
        message: effectiveMode + ' は既に記録済み: ' + Utilities.formatDate(t, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
      };
    }

    // 順番チェック
    if (cfg.prevCol !== null) {
      const prevVal = sheet.getRange(foundRow, cfg.prevCol).getValue();
      if (!prevVal) {
        const prevName = colNameFor(cfg.prevCol);
        if (cfg.strict) {
          return {
            ok: false,
            message: prevName + ' が未記録です。先に ' + prevName + ' を記録してください'
          };
        } else if (!force) {
          // 警告ダイアログ要求
          return {
            ok: false,
            needConfirm: true,
            message: prevName + ' が完了していませんが ' + effectiveMode + ' を記録しますか？',
            mode: effectiveMode,
            code: code,
            autoMode: autoSwitched ? effectiveMode : null
          };
        }
        // force=true: そのまま進む
      }
    }

    // 書き込み
    const now = new Date();
    targetCell.setValue(now);
    targetCell.setNumberFormat('yyyy/MM/dd HH:mm');

    // 受入モードの場合: サブコードQRラベル生成 (-1=振動, -2=濾過, -3=分析)
    let qrNote = '';
    if (effectiveMode === '受入') {
      try {
        appendQrLabels(ss, point, ud, baseCode);
        qrNote = ' / QRラベル生成済み';
      } catch (e) {
        qrNote = ' / QR生成失敗: ' + e.message;
      }
    }

    // 担当者作業履歴(任意): 必要なら別シートに追記実装
    const worker = PropertiesService.getScriptProperties().getProperty(PROP_CURRENT_WORKER) || '';

    return {
      ok: true,
      message: effectiveMode + ' 記録完了: ' + point + '(' + udDisplay(ud) + ')' + qrNote,
      point: point, ud: ud, baseCode: baseCode, mode: effectiveMode,
      autoMode: autoSwitched ? effectiveMode : null,
      worker: worker,
      time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss')
    };

  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== バーコード作成シートへのQR追加 ==========
/**
 * 受入時に -1(振動), -2(濾過), -3(分析) の3ラベルを追加。
 * 3列フローで配置。ラベル行+QR行のペア。
 */
function appendQrLabels(ss, point, ud, baseCode) {
  let qr = ss.getSheetByName(SHEET_QR);
  if (!qr) qr = ss.insertSheet(SHEET_QR);

  // ヘッダー(初回のみ)
  if (!qr.getRange(1, 1).getValue()) {
    qr.getRange(1, 1, 1, 3).setValues([['ラベル / QR (列1)', 'ラベル / QR (列2)', 'ラベル / QR (列3)']]);
    qr.getRange(1, 1, 1, 3).setBackground('#f0f0f0').setFontWeight('bold');
  }

  const subs = [
    { suffix: '1', proc: '振動' },
    { suffix: '2', proc: '濾過' },
    { suffix: '3', proc: '分析' }
  ];

  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    const slot = nextEmptySlot(qr);
    const subcode = baseCode + '-' + s.suffix;
    const labelText = point + '(' + udDisplay(ud) + ')' + s.proc;
    const url = 'https://api.qrserver.com/v1/create-qr-code/?data=' + encodeURIComponent(subcode) + '&size=' + QR_SIZE + 'x' + QR_SIZE;

    qr.getRange(slot.labelRow, slot.col)
      .setValue(labelText)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setFontSize(11);
    qr.getRange(slot.qrRow, slot.col)
      .setFormula('=IMAGE("' + url + '")')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  }
}

function nextEmptySlot(sheet) {
  const lastRow = sheet.getLastRow();
  for (let r = 2; r <= lastRow + 2; r += 2) {
    for (let c = 1; c <= 3; c++) {
      const v = sheet.getRange(r, c).getValue();
      if (v === '' || v === null) {
        return { labelRow: r, qrRow: r + 1, col: c };
      }
    }
  }
  return { labelRow: 2, qrRow: 3, col: 1 };
}

// ========== ユーティリティ ==========
function udDisplay(ud) {
  const s = String(ud).toLowerCase().trim();
  if (s === 'up' || s === '上') return '上';
  if (s === 'down' || s === '下') return '下';
  return ud;
}

function colNameFor(col) {
  switch (col) {
    case COL_KOTEI.SAISHU:  return '採取';
    case COL_KOTEI.UKEIRE:  return '受入';
    case COL_KOTEI.FUKAN:   return '風乾';
    case COL_KOTEI.SHINDOU: return '振動';
    case COL_KOTEI.ROKA:    return '濾過';
    case COL_KOTEI.BUNSEKI: return '分析';
    default: return '?';
  }
}

// ========== バーコード作成シート初期化 (A-one 28379) ==========
function initQrSheetForAone28379() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let qr = ss.getSheetByName(SHEET_QR);
  if (!qr) qr = ss.insertSheet(SHEET_QR);

  qr.clear();
  qr.getRange(1, 1, 1, 3).setValues([['ラベル / QR (列1)', 'ラベル / QR (列2)', 'ラベル / QR (列3)']]);
  qr.getRange(1, 1, 1, 3).setBackground('#f0f0f0').setFontWeight('bold');

  for (let c = 1; c <= 3; c++) qr.setColumnWidth(c, 265);
  qr.setRowHeight(1, 30);
  for (let r = 2; r <= 100; r++) {
    if (r % 2 === 0) qr.setRowHeight(r, 45);
    else qr.setRowHeight(r, 113);
  }

  SpreadsheetApp.getUi().alert(
    '「' + SHEET_QR + '」シートをA-one 28379(21面)レイアウトに初期化しました。\n' +
    '受入スキャン時に -1(振動)/-2(濾過)/-3(分析) のラベル+QRが自動追加されます。'
  );
}
