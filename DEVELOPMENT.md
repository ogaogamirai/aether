# Aether 開発メモ

## Phase A — 低リスク安定化（2026-07-15）

Synapse 同型のドック修理。挙動不変。

| ID | 内容 | ファイル |
|----|------|----------|
| A1 | dead cut marker `sanitizeForInlineScript` 削除 | `aether_main.js` |
| A2 | エンジン表記 v4.0 統一（DSL export ヘッダ v3.0 維持） | main / parser / renderer |
| A3 | `NOTE_HALF_W/H`, `NOTE_W/H` 定数化 | `aether_renderer.js` |
| A4 | `syncCanvasGlobals()` で window 同期を集約 | `aether_main.js` |
| A5 | `getFitChromePadding` 根拠コメント | `aether_main.js` |

- 検証: `node --check` 3 JS PASS / verifier **PASS**
- 索引: 構造変更後に `.ariadne.db` 削除 → 再 scan

## Phase B（未着手）

- `aether_main.js` 分割（IDB / export / presentation 等）
- `generateDSLFromCanvas` の DOM 副作用を main へ分離
- 接続線色のテーマ変数化
