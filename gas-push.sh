#!/bin/bash
# GASへ書き込み（clasp）。使い方: ./gas-push.sh          → コードを書き込むだけ（デプロイしない）
#                              ./gas-push.sh deploy "v3.01" → 書き込み＋既存デプロイを新バージョンに更新（URL不変）
# GAS側のファイル名は「コード.js」1本。リポジトリの Code_v2.gs をその名前で送る。
# 掟: APKをドライブに置いてからGASを上げる（逆だと更新バナーが消えない）。版の文字列はAPKと同じにする。
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$PATH"
rm -rf clasp-out && mkdir -p clasp-out
cp "Code_v2.gs" "clasp-out/コード.js"
cp appsscript.json clasp-out/appsscript.json
clasp push -f
if [ "$1" = "deploy" ]; then
  clasp deploy -i "AKfycbxMm_iW2CS_omYMXvJW9xFv4o_WfJhDFqO03X_U8qg6NKrZKmwKI8bnMCPROgMqFlKuxg" -d "${2:-update}"
fi
