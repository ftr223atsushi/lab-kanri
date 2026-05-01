/**
 * shast LAB - GAS Web App
 *
 * ラボ用バーコードスキャン入力UI + サブコードQRラベル生成
 *
 * 役割:
 *  - 受入/風乾/振動/濾過/分析 モードでバーコードをスキャンすると
 *    「工程時刻」シートの該当列に時刻を記録
 *  - 受入モードでベースコードをスキャンすると
 *    「バーコード作成」シートにサブコード(-1, -2)のラベル+QRを追加生成
 *
 * シート構成 (前提):
 *  - バーコード      : shast書込み (A=地点 B=上下 C=コード D=採取時刻)
 *  - 工程時刻       : A〜D列はバーコードシートからARRAYFORMULA同期
 *                     E=受入 F=風乾 G=振動 H=濾過 I=分析 (このGASが書き込む)
 *  - バーコード作成  : 受入時にサブコードQRを追加 (印刷用)
 */

// ========== 定数 ==========
const SHEET_KOTEI = '工程時刻';
const SHEET_QR    = 'バーコード作成';

const COL_KOTEI = {
  POINT: 1,    // A
  UD:    2,    // B
  CODE:  3,    // C
  SAISHU: 4,   // D
  UKEIRE: 5,   // E
  FUKAN:  6,   // F
  SHINDOU: 7,  // G
  ROKA:   8,   // H
  BUNSEKI: 9   // I
};

// モード定義: モード名 -> { 列番号, 期待suffix(null=ベースコード, "1"=ラボ1, "2"=ラボ2) }
const MODES = {
  '受入': { col: COL_KOTEI.UKEIRE,  suffix: null },
  '風乾': { col: COL_KOTEI.FUKAN,   suffix: '1'  },
  '振動': { col: COL_KOTEI.SHINDOU, suffix: '1'  },
  '濾過': { col: COL_KOTEI.ROKA,    suffix: '1'  },
  '分析': { col: COL_KOTEI.BUNSEKI, suffix: '2'  }
};

const QR_SIZE = 200; // QR画像サイズ(px)

// ========== Web App エントリポイント ==========
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('shast LAB 入力')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ========== メイン処理: スキャン受信 ==========
/**
 * クライアント(HTML)からのスキャン要求を処理。
 * @param {string} mode  - '受入'|'風乾'|'振動'|'濾過'|'分析'
 * @param {string} code  - スキャンされた文字列(例: '0001' or '0001-1')
 * @return {Object} { ok, message, point, ud, baseCode, mode }
 */
function handleScan(mode, code) {
  try {
    if (!mode || !MODES[mode]) {
      return { ok: false, message: 'モードが不正です' };
    }
    if (!code || !code.trim()) {
      return { ok: false, message: 'コードが空です' };
    }
    code = code.trim();

    const cfg = MODES[mode];
    // suffixバリデーション
    const parts = code.split('-');
    const baseCode = parts[0];
    const suffix = parts.length > 1 ? parts[1] : null;

    if (cfg.suffix === null && suffix !== null) {
      return { ok: false, message: '受入モードでは枝番なしのベースコード(例: 0001)を読んでください' };
    }
    if (cfg.suffix !== null && suffix !== cfg.suffix) {
      return { ok: false, message: mode + 'モードでは末尾「-' + cfg.suffix + '」のコードを読んでください' };
    }

    // 工程時刻シートからベースコードで地点行を検索
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const koteiSheet = ss.getSheetByName(SHEET_KOTEI);
    if (!koteiSheet) {
      return { ok: false, message: '「' + SHEET_KOTEI + '」シートが見つかりません' };
    }

    const lastRow = koteiSheet.getLastRow();
    if (lastRow < 2) {
      return { ok: false, message: '工程時刻シートにデータがありません' };
    }

    const codes = koteiSheet.getRange(2, COL_KOTEI.CODE, lastRow - 1, 1).getValues();
    let foundRow = -1;
    for (let i = 0; i < codes.length; i++) {
      if (String(codes[i][0]).trim() === baseCode) {
        foundRow = i + 2; // +2: 1始まり + ヘッダー行
        break;
      }
    }
    if (foundRow < 0) {
      return { ok: false, message: 'コード ' + baseCode + ' が見つかりません(採取記録なし)' };
    }

    // 既に時刻が記録済みかチェック
    const targetCell = koteiSheet.getRange(foundRow, cfg.col);
    const existing = targetCell.getValue();
    if (existing) {
      return {
        ok: false,
        message: mode + ' は既に記録済み: ' + Utilities.formatDate(existing instanceof Date ? existing : new Date(existing), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
      };
    }

    // 時刻書き込み
    const now = new Date();
    targetCell.setValue(now);
    targetCell.setNumberFormat('yyyy/MM/dd HH:mm');

    const point = koteiSheet.getRange(foundRow, COL_KOTEI.POINT).getValue();
    const ud    = koteiSheet.getRange(foundRow, COL_KOTEI.UD).getValue();

    // 受入モードの場合: サブコードQRを生成
    if (mode === '受入') {
      try {
        appendQrLabels(ss, point, ud, baseCode);
      } catch (e) {
        // QR生成失敗は警告だけ返す(時刻記録は成功扱い)
        return {
          ok: true,
          message: '受入記録OK / ただしQR生成失敗: ' + e.message,
          point: point, ud: ud, baseCode: baseCode, mode: mode
        };
      }
    }

    return {
      ok: true,
      message: mode + ' 記録完了: ' + point + '(' + udDisplay(ud) + ')',
      point: point, ud: ud, baseCode: baseCode, mode: mode,
      time: Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm:ss')
    };

  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

// ========== バーコード作成シートへのQR追加 ==========
/**
 * バーコード作成シートに 2 個のサブコードラベル(-1, -2)を追加する。
 * レイアウト: 3列フロー(A,B,C列)、ラベル行+QR行 のペアで2行使用。
 * 既存の埋まっている末尾を探して次のセルから配置。
 */
function appendQrLabels(ss, point, ud, baseCode) {
  let qrSheet = ss.getSheetByName(SHEET_QR);
  if (!qrSheet) {
    qrSheet = ss.insertSheet(SHEET_QR);
  }

  // 1行目ヘッダー(初回のみ)
  if (qrSheet.getRange(1, 1).getValue() === '') {
    qrSheet.getRange(1, 1, 1, 3).setValues([['ラベル / QR (列1)', 'ラベル / QR (列2)', 'ラベル / QR (列3)']]);
    qrSheet.getRange(1, 1, 1, 3).setBackground('#f0f0f0').setFontWeight('bold');
  }

  // ラボ1(0001-1) と ラボ2(0001-2) の2ラベルを生成
  const labels = [
    { suffix: '1', text: point + '(' + udDisplay(ud) + ')ラボ1' },
    { suffix: '2', text: point + '(' + udDisplay(ud) + ')ラボ2' }
  ];

  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i];
    const slot = nextEmptySlot(qrSheet);
    const subcode = baseCode + '-' + lab.suffix;
    const url = 'https://api.qrserver.com/v1/create-qr-code/?data=' + encodeURIComponent(subcode) + '&size=' + QR_SIZE + 'x' + QR_SIZE;

    // ラベル行: テキスト
    qrSheet.getRange(slot.labelRow, slot.col)
      .setValue(lab.text)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setFontSize(11);

    // QR行: =IMAGE()
    qrSheet.getRange(slot.qrRow, slot.col)
      .setFormula('=IMAGE("' + url + '")')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  }
}

/**
 * バーコード作成シートで次に書き込むべきセル位置を返す。
 * レイアウト: 3列(1,2,3) × 2行ペア(ラベル行/QR行)。
 * 既存の最終ラベル行を見つけて、次の空きスロットを返す。
 */
function nextEmptySlot(sheet) {
  // 2,4,6,...行目がラベル行 / 3,5,7,...行目がQR行
  // 3列(A,B,C)を順に埋める
  const lastRow = sheet.getLastRow();
  // ラベル行候補を下から探索
  let labelRow = 2;
  let col = 1;

  if (lastRow >= 2) {
    // 全ラベル行を確認して最初の空セルを探す
    // 効率重視: lastRow基準で位置計算
    // ラベル行 = 偶数行(2,4,6...) をスキャン
    for (let r = 2; r <= lastRow + 2; r += 2) {
      for (let c = 1; c <= 3; c++) {
        const val = sheet.getRange(r, c).getValue();
        if (val === '' || val === null) {
          return { labelRow: r, qrRow: r + 1, col: c };
        }
      }
    }
    // 全部埋まっている → 新規行
    const nextLabelRow = (lastRow % 2 === 1) ? lastRow + 1 : lastRow + 2;
    return { labelRow: nextLabelRow, qrRow: nextLabelRow + 1, col: 1 };
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

// ========== バーコード作成シート初期化(手動実行用) ==========
/**
 * バーコード作成シートをA-one 28379(21面)レイアウト用に初期化。
 * 列幅・行高をmm単位の見た目に近づける。
 * メニュー → スクリプトエディタから手動実行。
 */
function initQrSheetForAone28379() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let qr = ss.getSheetByName(SHEET_QR);
  if (!qr) qr = ss.insertSheet(SHEET_QR);

  // A-one 28379: 70mm × 42.3mm/枚, 3列 × 7行 = 21面
  // 1mm ≈ 3.78px (96dpi)
  // 列幅 70mm ≈ 265px
  // ラベル行高 12mm ≈ 45px / QR行高 30mm ≈ 113px (合計42mm相当)

  // 既存内容クリア(ヘッダー含む)
  qr.clear();
  qr.getRange(1, 1, 1, 3).setValues([['ラベル / QR (列1)', 'ラベル / QR (列2)', 'ラベル / QR (列3)']]);
  qr.getRange(1, 1, 1, 3).setBackground('#f0f0f0').setFontWeight('bold');

  // 列幅
  for (let c = 1; c <= 3; c++) {
    qr.setColumnWidth(c, 265);
  }
  // 1行目(ヘッダー)
  qr.setRowHeight(1, 30);
  // 以降のラベル行・QR行(印刷用に予め設定しておく)
  for (let r = 2; r <= 100; r++) {
    if (r % 2 === 0) qr.setRowHeight(r, 45);   // ラベル行
    else qr.setRowHeight(r, 113);               // QR行
  }

  SpreadsheetApp.getUi().alert('「' + SHEET_QR + '」シートをA-one 28379レイアウトに初期化しました。\n\n印刷時はファイル→印刷→「現在のシート」、用紙サイズA4、余白「狭い」または「カスタム」で実機に合わせて調整してください。');
}

// ========== メニュー追加 ==========
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('shast LAB')
    .addItem('バーコード作成シート初期化(A-one 28379)', 'initQrSheetForAone28379')
    .addToUi();
}
