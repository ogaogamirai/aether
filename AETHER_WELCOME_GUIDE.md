# Aether (エーテル) ✦ 招待状 兼 スタートアップガイド for Agents

ようこそ、Aetherの共創世界へ！ 🕊️✨  
このドキュメントは、キャプテン（人間）とAIエージェントが、無限のキャンバスを通じて思考をビジュアル可視化し、多元的な関係性を紡ぐための**「共通説明書（ポータル）」**です。

新しくプロジェクトに参加したエージェントは、まずこのガイドと関連スキルを読み込み、安全かつ効果的にホワイトボードを共同編集してください。

---

## 🗺️ 関連リソースの配置マップ

### ローカル（Nova ホーム）

* 🌐 **Aether メイン操作画面**:  
  [index.html](file:///G:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Nova/aether/index.html)
* 📝 **共有ホワイトボード正本 (DSL)**:  
  [aether_dsl.txt](file:///G:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Nova/aether/aether_dsl.txt)
* 📖 **エージェント操作スキル (詳細ルール)**:  
  [SKILL.md](file:///G:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Nova/aether/SKILL.md)
* 📘 **本ガイド**:  
  [AETHER_WELCOME_GUIDE.md](./AETHER_WELCOME_GUIDE.md)

### リモート（GitHub / Pages）

* リポジトリ: https://github.com/ogaogamirai/aether
* GitHub Pages（推奨公開先）: https://ogaogamirai.github.io/aether/
* 配布用HTML出力を含む全機能は **HTTP / Pages 上** で利用可能

---

## ⚡ 現行仕様サマリ（v4.0 Serverless Super Whiteboard）

Aether UI は **Python / SQLite / ローカルAPI 非依存** のブラウザ完結型ホワイトボードです。

| 機能 | 仕組み |
|---|---|
| オートセーブ | IndexedDB（3秒デバウンス） |
| 起動時復元 | IndexedDB → なければ同梱デフォルトDSL |
| インポート | 📂 ファイル読込 / キャンバスへの `.txt` `.dsl` DnD |
| エクスポート | 💾 DSLテキスト / 📤 配布用HTML（フロントエンド Blob 生成） |
| サイドバー | `{ } Aether DSL` と `📖 詳細` のみ（**チャットタブなし**） |
| 共有の正本 | `aether_dsl.txt`（IndexedDB は個人キャッシュ） |

### 起動経路の違い

| 経路 | 閲覧・編集・DnD・IndexedDB | 配布用HTML出力 |
|---|---|---|
| `file://` で index.html を直接開く | ✅ | ❌（`fetch` 制限） |
| ローカル HTTP（`npx serve` 等） | ✅ | ✅ |
| GitHub Pages | ✅ | ✅ |

```bash
# ローカルHTTP例
cd aether
npx serve .
```

---

## 🧭 エージェント向け最短手順

1. **正本を読む**: `aether_dsl.txt`
2. **DSLを更新して保存**: 構文ルールを厳守（下記）
3. **キャプテンへ反映方法を案内**:
   - UI の `📂 ファイル読込`、または
   - キャンバスへ `.txt` / `.dsl` をドラッグ＆ドロップ、または
   - Pages/HTTP 上で `📤 配布用HTMLを出力` して単体HTMLを共有
4. **メインチャットは短く**: 巨大DSLは貼らない

```text
Aether DSL を更新しました。
正本: aether/aether_dsl.txt
UI 反映: ファイル読込 または キャンバスへ DnD してください。
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
* `![alt](URLまたはパス)` 形式
* 配布用HTML出力時、http(s) 画像は可能なら Base64 インライン化

### 4. 主要オブジェクト（詳細は SKILL.md）
* `sticky` … 付箋
* `drawing` … 領域 / アイコン
* `relation` … 意味的な接続線
* `A -> B` … 単純接続

---

## 🖥️ UI 操作マップ（キャプテン向け）

| 操作 | 場所 | 説明 |
|---|---|---|
| DSL 編集 | `{ } Aether DSL` | 編集 → `↓ キャンバス適用` |
| ファイル読込 | DSL タブ | `.txt` / `.dsl` / `.json` |
| ファイル保存 | DSL タブ | 現在 DSL をダウンロード |
| DnD インポート | キャンバス全体 | ドロップで即適用 |
| 配布用HTML | DSL タブ | 自己完結 HTML（HTTP/Pages 上） |
| 詳細表示 | `📖 詳細` | 付箋クリックで表示 |
| 時系列 | 上部スライダー | `time` プロパティ |
| タグ | 左上フィルター | `tags` プロパティ |
| 全体表示 | **F** / ツールバー `⊡` | 上部UIを避けて全付箋を収める（HTML出力でも同一） |

---

## 🗄️ レガシーについて

`aether_server.py` / `aether.db` / チャット同期系は旧経路です。  
**現行 UI の必須経路ではありません。** サーバーレス運用では起動不要です。

---

## 🤝 共創にあたって

Aetherは、キャプテンの思考の変遷（時系列スライダー）や、感情のうねり（`stable` / `tension` / `excited` などの脈動オーラ）を可視化するホワイトボードです。

新しいアイデア、多元的な説、図的な整理を、Aether を通じて一緒に進めましょう。  
詳細な構文・作業プロトコルは [SKILL.md](./SKILL.md) を参照してください。
