# Aether (エーテル) ✦ 招待状 兼 スタートアップガイド for Agents

ようこそ、Aetherの共創世界へ！  
このドキュメントは、キャプテン（人間）とAIエージェントが、無限のキャンバスを通じて思考をビジュアル可視化し、多元的な関係性を紡ぐための**共通説明書（ポータル）**です。

新しくプロジェクトに参加したエージェントは、まずこのガイドと関連スキルを読み込み、安全かつ効果的にホワイトボードを共同編集してください。

---

## 🗺️ 関連リソースの配置マップ

### ローカル（Nova ホーム）

* 🌐 **Aether メイン操作画面**:  
  [index.html](file:///G:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Nova/aether/index.html)
* 📝 **共有ホワイトボード正本 (DSL)**:  
  [aether_dsl.txt](file:///G:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Nova/aether/aether_dsl.txt)
* 📂 **テーマ / 配布スナップショット**:  
  [themes/](./themes/)
* 📖 **エージェント操作スキル (詳細ルール)**:  
  [SKILL.md](./SKILL.md)
* 📘 **本ガイド**:  
  [AETHER_WELCOME_GUIDE.md](./AETHER_WELCOME_GUIDE.md)

### リモート（GitHub / Pages）

* リポジトリ: https://github.com/ogaogamirai/aether
* GitHub Pages（推奨公開先）: https://ogaogamirai.github.io/aether/
* 外部DSL起動例: `https://ogaogamirai.github.io/aether/?dsl=themes/xxx.txt`
* 配布用HTML出力を含む全機能は **HTTP / Pages 上** で利用可能

---

## ⚡ 現行仕様サマリ（v4.x Serverless Super Whiteboard）

Aether UI は **Python / SQLite / ローカルAPI 非依存** のブラウザ完結型ホワイトボードです。

| 機能 | 仕組み |
|---|---|
| オートセーブ | **構造化 IndexedDB（v2）** + 差分更新 |
| ドラッグ保存 | 動かした付箋の座標のみ `notes` ストアへ PUT（全文再構築しない） |
| DSL適用 | パース結果と DB の差分（insert / update / delete）を同期 |
| 起動時復元 | 構造化ストア → legacy `current_dsl` → 同梱 DEFAULT_DSL |
| URL起動 | `?dsl=相対パスまたはCORS許可URL` で外部DSLを自動読込 |
| インポート | 📂 ファイル読込 / キャンバスへの `.txt` `.dsl` DnD |
| エクスポート | 💾 DSLテキスト / 📤 配布用HTML（フロントエンド Blob 生成） |
| 画像インライン | jpg/png は Base64、**svg は `data:image/svg+xml;utf8`** |
| プレゼン | 🎬 / **P** … step 切替・詳細表示・横幅フィット・選択付箋の縦中央 |
| サイドバー | `{ } Aether DSL` と `📖 詳細` のみ（**チャットタブなし**） |
| 共有の正本 | `aether_dsl.txt`（IndexedDB は個人キャッシュ） |

### IndexedDB 構造（v2）

```
aether_db
├── notes          # sticky（keyPath: id）
├── drawings       # drawing（keyPath: id）
├── relations      # relation（keyPath: id = "from->to"）
├── connections    # 単純 A -> B（keyPath: id = "source->target"）
└── board_state    # legacy: key 'current_dsl'（互換・マイグレーション用）
```

* ドラッグ終了 → `updateNotePositionInDB(id, x, y)` のみ  
* 「キャンバス適用」→ `syncBoardStateToDB()` で差分同期  
* 旧ブラウザの `current_dsl` 全文は初回起動時に構造化ストアへ自動移行

### 起動経路の違い

| 経路 | 閲覧・編集・DnD・IndexedDB | 配布用HTML出力 | `?dsl=` 自動読込 |
|---|---|---|---|
| `file://` で index.html を直接開く | ✅ | ❌（`fetch` 制限） | 制限あり |
| ローカル HTTP（`npx serve` 等） | ✅ | ✅ | ✅ |
| GitHub Pages | ✅ | ✅ | ✅ |

```bash
# ローカルHTTP例
cd aether
npx serve .
# または
python -m http.server 8080

# 外部DSL起動例
# http://localhost:8080/?dsl=aether_dsl.txt
# http://localhost:8080/?dsl=themes/test_svg_rgb.txt
```

---

## 🧭 エージェント向け最短手順

1. **正本を読む**: `aether_dsl.txt`（または `themes/*.txt`）
2. **DSLを更新して保存**: 構文ルールを厳守（下記 / SKILL.md）
3. **キャプテンへ反映方法を案内**:
   - UI の `📂 ファイル読込`、または
   - キャンバスへ `.txt` / `.dsl` をドラッグ＆ドロップ、または
   - `?dsl=...` URL、または
   - Pages/HTTP 上で `📤 配布用HTMLを出力` して単体HTMLを共有
4. **メインチャットは短く**: 巨大DSLは貼らない

```text
Aether DSL を更新しました。
正本: aether/aether_dsl.txt
UI 反映: ファイル読込 または キャンバスへ DnD してください。
（任意）共有URL: .../aether/?dsl=themes/xxx.txt
```

> **注意**: IndexedDB はブラウザ個人の作業キャッシュです。エージェント間の共有媒体ではありません。

---

## 🛠️ 基本ルール（表示崩れ防止）

### 1. バックスラッシュ（`\`）は常に1本
* `desc` 内の LaTeX は通常どおり `\frac`, `\sigma`, `\mu` と書く
* `\\frac` のように多重エスケープされても描画側で自動補正される

### 2. 改行は `\n`
* 例: `desc: "第一段落。\n\n第二段落。"`

### 3. 画像
* `![alt](URLまたはパス)` 形式（`![alt](<url>)` も可）
* 配布用HTML出力時:
  * **jpg / png / gif / webp** → Base64 data URI
  * **svg** → `data:image/svg+xml;utf8,...`（Base64 化しない）

### 4. 主要オブジェクト（詳細は SKILL.md）
* `sticky` … 付箋
* `drawing` … 領域 / アイコン
* `relation` … 意味的な接続線
* `A -> B` … 単純接続

---

## 🖥️ UI 操作マップ（キャプテン向け）

| 操作 | 場所 / キー | 説明 |
|---|---|---|
| DSL 編集 | `{ } Aether DSL` | 編集 → `↓ キャンバス適用`（差分DB同期） |
| ファイル読込 | DSL タブ | `.txt` / `.dsl` / `.json` |
| ファイル保存 | DSL タブ | 現在 DSL をダウンロード |
| DnD インポート | キャンバス全体 | ドロップで即適用 |
| 配布用HTML | DSL タブ | 自己完結 HTML（HTTP/Pages 上） |
| 詳細表示 | `📖 詳細` / 付箋クリック | 付箋クリックで表示 |
| 時系列 | 上部スライダー | `time` プロパティ（累積表示） |
| タグ | 左上フィルター | `tags` プロパティ |
| 全体表示 | **F** / ツールバー `⊡` | 上部UIを避けて全付箋を収める |
| プレゼン | **P** / 🎬 | ステップ再生モード |
| プレゼン前/次 | **Ctrl+← / Ctrl+→** | 時間ステップ移動 |
| 付箋間移動 | 矢印キー | 選択移動（プレゼン中は縦中央合わせ） |
| 終了 | **Esc** | プレゼン終了 / 選択解除 |
| テーマ | ツールバー 🌙/☀️ | ライト / ダーク |

### プレゼンモードの挙動

1. 開始時は最初の実時間ステップへ移動
2. その step で**新たに表示される先頭1枚**を選択し詳細表示
3. **倍率** = ホワイトボード領域（詳細パネルを除く）の横幅に最大フィット
4. **縦位置** = 選択付箋が見える領域の上下中央（上下見切れ可）
5. 矢印キーで別付箋を選んだときも、倍率・横位置は維持し縦中央のみ更新

---

## 🗄️ レガシーについて

`aether_server.py` / `aether.db` / チャット同期系は旧経路です。  
**現行 UI の必須経路ではありません。** サーバーレス運用では起動不要です。

---

## 🤝 共創にあたって

Aetherは、キャプテンの思考の変遷（時系列スライダー）や、感情のうねり（`stable` / `tension` / `excited` などの脈動オーラ）を可視化するホワイトボードです。

新しいアイデア、多元的な説、図的な整理を、Aether を通じて一緒に進めましょう。  
詳細な構文・作業プロトコルは [SKILL.md](./SKILL.md) を参照してください。
