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

## Phase C — 接続線色のテーマ変数化（2026-07-15）

ライトテーマで fallback 接続線・ラベルが白固定で見えにくい問題を修正。

| ID | 内容 | ファイル |
|----|------|----------|
| C1 | CSS 変数 `--connection-line` / `--connection-label` / `--connection-label-muted` / `--arrow-default`（dark/light） | `style.css` |
| C2 | `themeColor()` で SVG 属性に解決 | `aether_renderer.js` |
| C3 | fallback 接続線・arc ラベル・icon ラベル・relation ラベルを変数参照 | `aether_renderer.js` |
| C4 | `#arrow-default` をテーマ連動（CSS fill + currentColor） | `style.css` / `index.html` / `aether_export.js` |

- ダーク既定値は従来の白半透明を維持（フォールバック引数も同値）
- DSL の color 名（blue/purple 等）は変更なし
- `toggleTheme` は既存の `drawAllShapes()` 再描画で線色が更新される

## Phase D — 配布HTML サイズ圧縮（2026-07-15）

表示・UI を維持したまま `exportPortableViewer` の埋め込みペイロードを削減。

| ID | 内容 | 効果 |
|----|------|------|
| D1 | snapshot から `aether_storage.js` を除外。IDB は prelude スタブ | JS ~16KB 削減（raw） |
| D2 | `minifySnapshotJs` / `minifySnapshotCss`（文字列保護） | 空白・コメント除去 |
| D3 | 巨大 `DEFAULT_DSL` / `window.onload` は従来どおり cut | 変更なし |

推定（DSL・画像を除く engine ペイロード Base64）:
- 旧: ~137 KB → 新: ~87 KB（**約 37% 減**、`scratch/size_estimate.js`）
- DSL やインライン画像が大きい場合はそちらが支配的（別途画像最適化）

維持: 付箋・接続・プレゼン・テーマ・DSL 編集/適用・詳細表示  
無効（ビューア仕様）: IndexedDB 永続化（配布 HTML では不要）

## Phase E（未着手）

- icon 背景 `rgba(22,26,33,0.8)` のテーマ連動（任意）
- 配布 HTML の DSL 画像圧縮オプション（任意）
