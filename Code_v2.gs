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
      '採取': { prevCol: 'SAKKO_T' },
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
// A=コード B=区画 C=色 D=振り時刻 E=振り担当 F=ろか時刻 G=ろか担当 H=分析時刻 I=分析担当
const COL_ZENSHORI = {
  CODE: 1, POINT: 2, COLOR: 3,
  HURI_T: 4, HURI_W: 5,
  ROKA_T: 6, ROKA_W: 7,
  BUNSEKI_T: 8, BUNSEKI_W: 9
};
const ZENSHORI_HEADER = ['コード', '区画', '色', '振り時刻', '振り担当', 'ろか時刻', 'ろか担当', '分析時刻', '分析担当'];

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

// 現場スプレッドシート共有フォルダ (picker v2 の出力先。変わったらここを更新)
const SHARED_FOLDER_ID = '1V4zi1031hEseO3QP9iARHAhyuRDwgYaM';

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
      case 'listSpreadsheetsInSharedFolder':
        return respond(listSpreadsheetsInSharedFolder());
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
      case 'getDailyReportData':
        return respond(getDailyReportData(p.spreadsheetId));

      // ---- 疎通確認 ----
      case 'ping':
        return respond({ ok: true, message: 'pong', version: 'v2', time: new Date().toISOString() });

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
  const s = String(input).trim();
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

// ========== コード解析 (v2) ==========
/**
 * 例:
 *  "TEDC-S-0001"        → { siteId:'TEDC', codeType:'S', baseCode:'TEDC-S-0001', suffix:'' }
 *  "TEDC-L-0001-huri"   → { siteId:'TEDC', codeType:'L', baseCode:'TEDC-L-0001', suffix:'huri' }
 * 形式外は null。
 */
function parseCodeV2(code) {
  const s = String(code || '').trim();
  const m = s.toUpperCase().match(/^([A-Z]{4})-(WG|WP|[SGHDL])-(\d{4})(?:-(HURI|ROKA))?$/);
  if (!m) return null;
  return {
    siteId: m[1],
    codeType: m[2],
    seq: m[3],
    suffix: m[4] ? m[4].toLowerCase() : '',
    baseCode: m[1] + '-' + m[2] + '-' + m[3]
  };
}

/**
 * 実データシートのコード列で直接行を引く (v2の1回引き)。
 * @return {Object|null} { row, sheet, point, ud, depth, status, extra } または null
 */
function resolveByCode_(ss, kind, baseCode) {
  const kc = KIND_CONFIG[kind];
  if (!kc) throw new Error('未対応の種別: ' + kind);
  const sheet = getKindSheet_(ss, kind);
  if (!sheet) throw new Error('「' + kind + '」シートが見つかりません');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  let maxCol = 1;
  Object.keys(kc.workCols).forEach(function(k) {
    if (kc.workCols[k] > maxCol) maxCol = kc.workCols[k];
  });
  const disp = sheet.getRange(2, 1, lastRow - 1, maxCol).getDisplayValues();
  const target = String(baseCode).trim().toUpperCase();

  for (let i = 0; i < disp.length; i++) {
    const codeVal = String(disp[i][kc.workCols.CODE - 1]).trim().toUpperCase();
    if (codeVal !== target) continue;
    return {
      row: i + 2,
      sheet: sheet,
      point:  String(disp[i][kc.workCols.POINT - 1]).trim(),
      ud:     kc.workCols.UD ? String(disp[i][kc.workCols.UD - 1]).trim() : '',
      depth:  kc.workCols.DEPTH ? String(disp[i][kc.workCols.DEPTH - 1]).trim() : '',
      status: String(disp[i][kc.workCols.STATUS - 1]).trim(),
      extra:  kc.extraCol && kc.workCols[kc.extraCol]
        ? String(disp[i][kc.workCols[kc.extraCol] - 1]).trim() : ''
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

    // 担当者 (端末ローカルから毎回送信される)
    const worker = (overrideWorker && String(overrideWorker).trim()) ? String(overrideWorker).trim() : '';
    if (!worker) {
      return { ok: false, message: '担当者を選択してください' };
    }

    // コード解析
    const parsed = parseCodeV2(code);
    if (!parsed) {
      return { ok: false, message: '新方式のコードではありません: ' + code + ' (例: ' + siteId + '-S-0001)' };
    }

    // v2ゲート②: 現場ID照合 (SPEC §3.5 誤書き込み防止)
    if (parsed.siteId !== siteId) {
      return {
        ok: false,
        message: '別の現場のコードです (コード: ' + parsed.siteId + ' / この現場: ' + siteId + ')'
      };
    }

    let effectiveMode = mode;
    let autoSwitched = false;

    // ---- L コード (分析検体: 振り/ろか/分析) ----
    if (parsed.codeType === 'L') {
      if (!parsed.suffix) {
        return { ok: false, message: 'Lコードは -huri / -roka 付きで読んでください' };
      }
      if (parsed.suffix === 'roka' && mode === '分析') {
        effectiveMode = '分析';
      } else {
        const auto = SUFFIX_TO_MODE[parsed.suffix];
        if (effectiveMode !== auto) {
          autoSwitched = true;
          effectiveMode = auto;
        }
      }
      const cfg2 = MODES[effectiveMode];
      if (cfg2.requireWorkers && cfg2.requireWorkers.indexOf(worker) < 0) {
        return { ok: false, message: '分析モードは ' + cfg2.requireWorkers.join('・') + ' のみ使用できます (現在: ' + worker + ')' };
      }
      return handlePhase2V2(ss, effectiveMode, cfg2, parsed, worker, force, autoSwitched);
    }

    // ---- 実データコード (S/G/H/D/WG/WP): phase1 ----
    if (parsed.suffix) {
      return { ok: false, message: '-huri/-roka はLコード (分析検体) にだけ付きます: ' + code };
    }
    if (!effectiveMode) {
      return { ok: false, message: 'モードを選択してください' };
    }
    const cfg = MODES[effectiveMode];
    if (!cfg) return { ok: false, message: 'モードが不正です: ' + effectiveMode };

    const effectiveKind = CODE_TYPE_TO_KIND[parsed.codeType];
    const kc = KIND_CONFIG[effectiveKind];
    const isWater = WATER_CODE_TYPES.indexOf(parsed.codeType) >= 0;

    // 分析モード権限チェック
    if (cfg.requireWorkers && cfg.requireWorkers.indexOf(worker) < 0) {
      return { ok: false, message: '分析モードは ' + cfg.requireWorkers.join('・') + ' のみ使用できます (現在: ' + worker + ')' };
    }

    // ガスの分析はガスシート直書き (phase1扱い)。他種別の分析はLコードのみ。
    if (effectiveMode === '分析' && effectiveKind !== '土壌ガス') {
      return { ok: false, message: '分析モードでは -roka 付きのLコードを読んでください' };
    }

    // availableModes チェック (地下水はさらに制限)
    const allowedModes = isWater ? WATER_AVAILABLE_MODES : kc.availableModes;
    if (allowedModes && allowedModes.indexOf(effectiveMode) < 0) {
      const label = isWater ? '地下水 (WG/WP)' : effectiveKind;
      return {
        ok: false,
        message: '「' + label + '」では「' + effectiveMode + '」モードは使えません。使用可: ' + allowedModes.join(' / ')
      };
    }

    // コード直引き (1回引き)
    const resolved = resolveByCode_(ss, effectiveKind, parsed.baseCode);
    if (!resolved) {
      return { ok: false, message: 'コード ' + parsed.baseCode + ' が「' + effectiveKind + '」シートに見つかりません' };
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

  // 順番チェック (種別固有の modeOverrides 優先)
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
      else if (kc.workCols.DEPTH) dailyBCol = resolved.depth || '';
      logToDailyReport(ss, mode, point, dailyBCol, worker, now);
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
    message: mode + ' 記録完了: ' + point + udDispMsg + ' 担当:' + worker + delTag,
    kind: kind,
    mode: mode, autoMode: null,
    point: point, ud: ud, worker: worker,
    isDeleted: isDeleted,
    needExtra: needExtra,
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
    const isWater = String(kind || '').indexOf(':WATER') >= 0;
    const realKind = String(kind || '').replace(':WATER', '');
    const kc = KIND_CONFIG[realKind];
    if (!kc) return { ok: false, message: '不明な種別: ' + kind };

    const ss = openSpreadsheet_(spreadsheetId);
    getSiteIdOrThrow_(ss);

    const parsed = parseCodeV2(baseCode);
    if (!parsed) return { ok: false, message: 'コード形式が不正です: ' + baseCode };

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
function handlePhase2V2(ss, mode, cfg, parsed, worker, force, autoSwitched) {
  // 分析検体シートから区画名・色を補足 (Q or R 列でLコード検索)
  let kentaiPoint = '';
  let kentaiColor = '';
  try {
    const ks = ss.getSheetByName(SHEET_KENTAI);
    if (ks) {
      const lastRow = ks.getLastRow();
      if (lastRow >= 2) {
        // A〜R (18列)
        const data = ks.getRange(2, 1, lastRow - 1, 18).getDisplayValues();
        const targetHuri = (parsed.baseCode + '-HURI');
        const targetRoka = (parsed.baseCode + '-ROKA');
        for (let i = 0; i < data.length; i++) {
          const q = String(data[i][16]).trim().toUpperCase();  // Q=振りコード
          const r = String(data[i][17]).trim().toUpperCase();  // R=ろかコード
          if (q === targetHuri || r === targetRoka) {
            kentaiPoint = String(data[i][0]).trim();
            if (String(data[i][10]).trim()) kentaiColor = '黒';        // K
            else if (String(data[i][11]).trim()) kentaiColor = '赤';   // L
            else if (String(data[i][12]).trim()) kentaiColor = '青';   // M
            break;
          }
        }
      }
    }
  } catch (e) {}

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
    return { ok: true, id: ss.getId(), name: ss.getName(), url: ss.getUrl(), siteId: siteId };
  } catch (e) {
    return { ok: false, message: 'スプレッドシートを開けません: ' + e.message };
  }
}

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

// ========== 日報 ==========
const DAILY_REPORT_MODES = ['受入', '風乾', '振り', 'ろか'];
const DAILY_REPORT_HEADER = ['地点', '上下/深度/色', '工程', '日時', '担当者'];

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
    const values = sheet.getRange(1, 1, lastRow, DAILY_REPORT_HEADER.length).getDisplayValues();
    const header = values[0].map(function(v) { return String(v == null ? '' : v); });
    const rows = values.slice(1).map(function(r) { return r.map(function(v) { return String(v == null ? '' : v); }); });
    return { ok: true, name: today, header: header, rows: rows };
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
    const KENTAI_COLS = 16;  // A〜P
    const display = sheet.getRange(1, 1, lastRow, KENTAI_COLS).getDisplayValues();
    if (display.length === 0) {
      return { ok: true, name: '分析検体', header: [], rows: [] };
    }
    const header = display[0].map(function(v) { return String(v == null ? '' : v); });
    const rows = display.slice(1).map(function(r) {
      return r.map(function(v) { return String(v == null ? '' : v); });
    });
    return { ok: true, name: '分析検体', header: header, rows: rows };
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
    // APK側のキーは旧表記「配管・ピット・盛土下」なのでキー名は旧のまま返す
    const kindMap = {
      '表層土壌': '表層土壌',
      '土壌ガス': '土壌ガス',
      '配管・ピット・盛土下': '配管・ピット・盛り土下',
      '深度調査': '深度調査'
    };
    const result = {};
    Object.keys(kindMap).forEach(function(apkKey) {
      result[apkKey] = readKindWorkRows_(ss, kindMap[apkKey]);
    });
    return { ok: true, kinds: result };
  } catch (e) {
    return { ok: false, message: 'エラー: ' + e.message };
  }
}

function readKindWorkRows_(ss, kind) {
  const cfg = KIND_CONFIG[kind];
  const empty = { name: kind, rows: [] };
  if (!cfg) return empty;
  const sheet = getKindSheet_(ss, kind);
  if (!sheet) return empty;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return empty;
  const w = cfg.workCols;
  let maxCol = 1;
  Object.keys(w).forEach(function(k) {
    if (typeof w[k] === 'number' && w[k] > maxCol) maxCol = w[k];
  });
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
    rows.push([
      point,
      get(w.UD),
      get(w.DEPTH),
      get(w.SAKKO_T), get(w.SAKKO_W),
      get(w.SAISHU),  get(w.SAISHU_W),
      get(w.UKEIRE),  get(w.UKEIRE_W)
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
