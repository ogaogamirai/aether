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

## Phase E — プレゼン表示修復 + 安全 minify（2026-07-15）

| ID | 内容 |
|----|------|
| E1 | プレゼン: 横幅最大フィット後に選択付箋を縦中央（2rAF + 再測） |
| E2 | プレゼン中 F キーは `fitToView`（縦縮め）ではなく `focusPresentationStepView` |
| E3 | 配布 JS minify を無効化（regex 破壊を回避）。CSS のみ軽圧縮。storage 除外は維持 |

## Phase F — 配布HTML プレゼン縦中央（2026-07-15）

| ID | 内容 |
|----|------|
| F1 | 原因: snapshot `(0,eval)` 境界で free var（`panY` / `isPresentationMode` 等）が共有されず、キーボード選択時に `centerNoteVertically` が効かない |
| F2 | view/presentation 状態を `window.*` 単一正に統一（main / renderer / index / export prelude） |
| F3 | export から free var エイリアス（`var panY = window.panY` 等）を除去。notes 配列のみ free var 維持 |

検証: headless Chrome CDP — プレゼン ON で上下付箋を選択すると `topVsMid=0` / `botVsMid=0`、`panY` が追従。

## Phase F2 — 配布サイズ再圧縮（2026-07-15）

E3 で JS minify を全面無効化した結果、engine が太っていた。  
**文字列保護 + コメント/冗長空白のみ**の安全 minify を再有効化（正規表現リテラルは触らない）。

| 指標 (Base64, 皇位継承 DSL 基準) | 旧 snapshot | F 直後 (minify off) | **F2 後** |
|----|----|----|----|
| JS bundle | ~89.0 KB | ~94.6 KB | **~80.0 KB** |
| CSS | ~27.6 KB | ~25.6 KB | **~22.2 KB** |
| engine 合計 (JS+CSS) | ~116.5 KB | ~120.2 KB | **~102.2 KB** |

→ 旧 snapshot 比で engine **約 12% 減**。DSL/画像が総容量の主因である点は不変。

## Phase G（未着手）

- icon 背景 `rgba(22,26,33,0.8)` のテーマ連動（任意）
- 配布 HTML の DSL 画像圧縮オプション（任意・情報量低下の可能性あり）

## Phase H — 配布HTML さらなる圧縮（UI/情報量維持）（2026-07-15）

| ID | 内容 | ファイル |
|----|------|----------|
| H1 | snapshot bundle からデッドコード除去（`ensureViewGlobals` / parser の `serializeCanvasToDSL`・`generateDSLFromCanvas`） | `aether_export.js` |
| H2 | export 時 DSL の末尾空白・過剰空行のみ正規化（意味不変） | `aether_export.js` |
| H3 | JS bundle を gzip → Base64 埋め込み。boot は `DecompressionStream`（非対応時 plain フォールバック） | `aether_export.js` |
| H-fix | `stripFunctionByName` が正規表現リテラル内の `"` で関数を途中切断していた問題を修正（regex-aware） | `aether_export.js` |

維持: 付箋・接続・プレゼン・テーマ・DSL 編集/適用・詳細・UI shell  
無効（ビューア仕様）: IndexedDB 永続化（従来どおり）

推定（皇位継承 DSL・画像なし、`scratch/size_phase_h.js`）:

| 指標 | 旧 snapshot | F2 相当 | **H 後** |
|------|-------------|---------|----------|
| HTML 合計 | ~164.9 KB | ~148 KB | **~74 KB** |
| JS embed (b64) | ~86.9 KB plain | ~75 KB plain | **~16.4 KB gzip** |
| CSS | b64 ~27 KB | plain min ~16 KB | plain min ~16 KB |
| DSL | b64 ~43 KB | plain ~32 KB | plain ~32 KB |

→ 旧 snapshot 比で **約 55% 減**（主因は gzip）。UI/DSL 情報は同一。  
要: 現代ブラウザ（`DecompressionStream`）。未対応環境は export 側が plain にフォールバック。

検証: `node --check` / `new Function(bundle)` / dead-code 不在 / verifier **PASS**

## Phase I — IndexedDB 重複ID消失の修正（2026-07-16）

| ID | 内容 | ファイル |
|----|------|----------|
| I1 | `dedupeCanvasState`: sticky/drawing 重複を `_2` リネーム、relation/connection は store id に `#n` | `aether_storage.js` |
| I2 | `applyDSL` で dedupe 後に IDB 同期。リネーム時は toast + DSL 再生成 | `aether_main.js` |
| I3 | 起動順を **legacy `current_dsl` 優先** → structured → DEFAULT（順序保持） | `aether_main.js` / `loadFromDB` |
| I4 | ドラッグ座標更新後に legacy `current_dsl` も同期 | `aether_storage.js` |

原因: 構造化 IDB の `keyPath: 'id'` が同名 sticky/drawing を上書きし、再起動で欠落していた。  
検証: 皇位継承 DSL で notes 33→33 / drawings 12→12 / relations 77→77（旧: 30/7/49）。`node --check` PASS。

## Phase J — LIVE フォルダ監視（片方向ホワイトボード）（2026-07-16）

| ID | 内容 | ファイル |
|----|------|----------|
| J1 | `showDirectoryPicker` でフォルダ選択、監視ファイル名（既定 `aether_dsl.txt`）を取得／無ければ作成 | `aether_main.js` |
| J2 | 1秒ポーリング（lastModified + 本文比較）→ `applyDSL({ fromLive })` | `aether_main.js` |
| J3 | LIVE中は閲覧のみ: ドラッグ移動・手動 apply・import・DnD・キャンバス出力・IDB save をロック | main / renderer / storage |
| J4 | UI: 👁️ フォルダ監視 / ● LIVE / 監視ファイル名 / `?v=4.0.4` | `index.html` / `style.css` |

仕様: 監視ファイルが唯一の正本。キャンバス・IDB は表示キャッシュ。双方向書き戻しなし。  
前提: Chrome/Edge の `https` または `localhost`（`file://` 非対応）。

## Phase K — 表現拡張 role/confidence + weight/flow（2026-07-16）

| ID | 内容 | ファイル |
|----|------|----------|
| K1 | sticky `role` (claim/evidence/caveat/question)・`confidence` (high/mid/low または 0–1) | parser / renderer / storage / style |
| K2 | relation `weight` (1–5→線幅)・`flow: forward`（破線アニメ） | parser / renderer / storage / style |
| K3 | 詳細パネルに role/confidence 表示、`?v=4.0.5` | main / index |

未知値は無視。属性省略時は従来どおり。既存 DSL は破壊しない。

## Phase K3 — callout / path（2026-07-16）

| ID | 内容 | ファイル |
|----|------|----------|
| K3a | `callout ID "text" { anchor offset color tags time }` → drawing type=callout | parser / renderer / storage |
| K3b | `path ID "label" { nodes style color tags time }` → drawing type=path（番号付き誘導線） | parser / renderer / storage |
| K3c | `?v=4.0.6` | index |

内部は既存 drawings ストアに格納（IDB スキーマ変更なし）。serialize は callout/path 構文で再出力。
