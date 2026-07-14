# Aether — Serverless Super Whiteboard

ブラウザ完結型の無限ホワイトボード。Python / SQLite 非依存。

人とAIが DSL で思考マップを共創し、時系列・タグ・プレゼン再生・配布用HTMLで共有できます。

## GitHub Pages

1. Repository → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / folder: `/ (root)`
4. 公開URL例: `https://ogaogamirai.github.io/aether/`
5. 外部DSL起動例: `https://ogaogamirai.github.io/aether/?dsl=themes/test_svg_rgb.txt`

## ローカル起動

```bash
npx serve .
# または
python -m http.server 8080
```

表示された URL で `index.html` を開いてください。

```text
http://localhost:8080/
http://localhost:8080/?dsl=aether_dsl.txt
http://localhost:8080/?dsl=themes/test_svg_rgb.txt
```

> `file://` でも閲覧・編集は可能ですが、配布用HTML出力と一部の `fetch` は HTTP 上で行ってください。

## 主な機能

| 機能 | 説明 |
|---|---|
| 構造化 IndexedDB (v2) | `notes` / `drawings` / `relations` / `connections` にオブジェクト保存 |
| ドラッグ差分保存 | 動かした付箋の座標だけ PUT（全文再シリアライズしない） |
| DSL差分同期 | 「キャンバス適用」時に insert / update / delete を差分反映 |
| 起動復元 | 構造化ストア → legacy `current_dsl` → DEFAULT_DSL |
| `?dsl=` 自動読込 | 相対パス / CORS 許可 URL の DSL を起動時に適用 |
| DnD インポート | `.txt` / `.dsl` をキャンバスへドロップで即適用 |
| 配布用HTML | 自己完結 Viewer をフロントエンドで生成 |
| SVG インライン | エクスポート時 svg は `data:image/svg+xml;utf8`（Base64 しない） |
| 時系列 / タグ | DSL の `time` / `tags` を可視化（time は累積表示） |
| プレゼンモード | **P** / 🎬 … step 再生・詳細表示・横幅フィット・選択縦中央 |
| 全体表示 | **F** / ⊡ … 上部UIを避けてフィット |

## キーボード

| キー | 動作 |
|---|---|
| **F** | 全体表示 |
| **P** | プレゼンモード ON/OFF |
| **Ctrl+← / Ctrl+→** | プレゼン step 前後 |
| **矢印キー** | 選択付箋の移動（プレゼン中は縦中央合わせ） |
| **Esc** | プレゼン終了 / 選択解除 |

## ファイル構成（UI）

- `index.html` — メイン画面
- `style.css` — スタイル
- `aether_main.js` — 制御・構造化 IndexedDB・export・プレゼン
- `aether_parser.js` — DSL パーサ
- `aether_renderer.js` — キャンバス描画
- `aether_dsl.txt` — 共有用 DSL 正本（サンプル）
- `themes/` — テーマ DSL / 配布スナップショット
- `AETHER_WELCOME_GUIDE.md` — エージェント向け招待状・操作ガイド
- `SKILL.md` — DSL 構文と作業プロトコル

## IndexedDB（v2）

```
aether_db
├── notes / drawings / relations / connections   # 構造化（差分更新）
└── board_state.current_dsl                      # legacy 互換ミラー
```

- ドラッグ終了 → 座標のみ更新
- DSL 適用 → オブジェクト差分同期
- 旧データの `current_dsl` は初回起動時に構造化ストアへマイグレーション

## DSL の正本

エージェント／人間が共有する図面の正本は `aether_dsl.txt`（または `themes/*.txt`）です。  
IndexedDB はブラウザ個人の作業キャッシュであり、共有媒体ではありません。

詳細な操作・構文は [AETHER_WELCOME_GUIDE.md](./AETHER_WELCOME_GUIDE.md) と [SKILL.md](./SKILL.md) を参照してください。
