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

## Phase B — 機械分割 + serialize 分離（2026-07-15）

挙動不変の機械分割。テーマ色変更は Phase B では行わない。

| ID | 内容 | ファイル |
|----|------|----------|
| B1 | `aether_main.js` 機械分割 | `aether_storage.js` / `aether_export.js` / `aether_main.js` |
| B1a | IndexedDB + `buildDSLFromState` + `saveCanvasState` を `aether_storage.js` へ | `aether_storage.js` |
| B1b | 配布HTML export 一式を `aether_export.js` へ。snapshot 時は `storage.js + main.js` を結合 | `aether_export.js` |
| B1c | `index.html` の script 読込順を 5 ファイルに更新 | `index.html` |
| B2 | `generateDSLFromCanvas` の DOM 副作用を分離し、純粋 `serializeCanvasToDSL` を `aether_parser.js` に配置 | `aether_parser.js` |

ファイル読込順:

```html
<script src="aether_parser.js"></script>
<script src="aether_renderer.js"></script>
<script src="aether_storage.js"></script>
<script src="aether_main.js"></script>
<script src="aether_export.js"></script>
```

export snapshot 結合順:

```js
const combinedMain = String(storageJs || '') + '\n' + String(mainJs || '');
const bundleJs = buildSnapshotBundle(parserJs, rendererJs, combinedMain);
```

`prepareMainJsForSnapshot` の cutMarkers（export 分離後）:

```js
[
  'const DEFAULT_DSL =',
  'window.onload = async'
]
```

- 検証: `node --check` 5 JS PASS / structural asserts PASS
- 修正: export の `asset_fetch_failed` 判定に `storageJs` を追加
- 索引: 構造変更後 `.ariadne.db` 削除 → 再 scan（files: 12）

## Phase C（未着手）

- 接続線色のテーマ変数化
