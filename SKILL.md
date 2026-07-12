---
name: aether-interaction
description: Aetherサーバーレスホワイトボードの操作・DSL更新スキル。IndexedDB / ファイル入出力 / GitHub Pages 運用を含む。
---

# Aether Interaction Skill (v4.0 Serverless)

Aether は **ブラウザ完結のスーパーホワイトボード** です。  
UI 本体は Python / SQLite / ローカルAPI に依存しません。

## 現状アーキテクチャ（必読）

| 層 | 役割 | 依存 |
|---|---|---|
| UI (`index.html` 等) | 描画・編集・詳細表示 | ブラウザのみ |
| オートセーブ | 現在の DSL を IndexedDB に保存（3秒デバウンス） | ブラウザ個人キャッシュ |
| 共有正本 | `aether_dsl.txt` | ファイル / Git |
| 配布 | 配布用HTMLをフロントエンドで Blob 生成 | HTTP 配信上で export |

### 重要な境界
- **IndexedDB** = そのブラウザだけの作業キャッシュ（エージェント共有媒体ではない）
- **`aether_dsl.txt`** = 人間/エージェント間で共有する DSL の正本
- **UI チャットタブは撤廃済み**（サイドバーは `{ } Aether DSL` と `📖 詳細` のみ）

---

## 起動・公開方法

### A. ローカル直接起動
- `aether/index.html` をブラウザで開く（`file://` 可）
- 閲覧・編集・DnD・IndexedDB は動作
- **配布用HTML出力は `file://` では不可**（相対資産の `fetch` が必要）

### B. ローカル HTTP
```bash
cd aether
npx serve .
# または
python -m http.server 8080
```

### C. GitHub Pages（推奨）
- リポジトリ: https://github.com/ogaogamirai/aether
- Pages 設定: `main` / `/ (root)`
- 公開URL例: `https://ogaogamirai.github.io/aether/`
- Pages 上では **配布用HTML出力を含む全機能** が使える

---

## エージェント作業プロトコル（サーバーレス版）

エージェントが図面を更新するときの標準手順:

### 1. 現状 DSL を読む
- 正本: `G:\マイドライブ\Nova\aether\aether_dsl.txt`
- 必要なら `SKILL.md` の構文リファレンスを確認

### 2. DSL を編集して保存
- `aether_dsl.txt` を更新する（これが共有の正本）
- 構文ルール（`\` は1本、`desc` 改行は `\n` など）を厳守

### 3. キャプテンへの反映案内
UI は IndexedDB を優先復元するため、更新後は次のいずれかを案内する:

1. **ファイル読込**: UI の `📂 ファイル読込` で `aether_dsl.txt` を適用  
2. **ドラッグ＆ドロップ**: キャンバスに `.txt` / `.dsl` をドロップ  
3. **配布用HTML**: Pages または HTTP 上で `📤 配布用HTMLを出力` し、単体 HTML を共有

### 4. メインチャットはクリーンに
巨大 DSL をそのまま貼らず、短い完了通知のみ返す。

```text
Aether DSL を更新しました。
正本: aether/aether_dsl.txt
UI 反映: ファイル読込 または キャンバスへ DnD してください。
```

---

## UI 操作マップ（キャプテン向け説明用）

| 操作 | 場所 | 説明 |
|---|---|---|
| DSL 編集 | `{ } Aether DSL` タブ | テキスト編集 → `↓ キャンバス適用` |
| ファイル読込 | DSL タブ | `.txt` / `.dsl` / `.json` |
| ファイル保存 | DSL タブ | 現在 DSL をダウンロード |
| DnD インポート | キャンバス全体 | ドロップで即適用 |
| 配布用HTML | DSL タブ | 自己完結 HTML を生成（HTTP/Pages 上） |
| 詳細表示 | `📖 詳細` タブ | 付箋クリックで表示 |
| 時系列 | 上部スライダー | `time` プロパティで制御 |
| タグ | 左上フィルター | `tags` プロパティで制御 |
| 全体表示 | **F** キー / ツールバー `⊡` | タグバー・時系列スライダーを避けて全付箋を収める（HTMLエクスポートでも同一） |

---

## レガシー（任意・非推奨）

以下は旧「SQLite + ローカルAPI + チャット同期」経路です。  
**現行 UI の必須経路ではありません。** 互換・実験用途でのみ残置。

- `aether_server.py` / `aether_connector.py` / `aether.db`
- `aether_bot.py` / `aether_bot_for_captain.py`
- `mode_flag.txt` / `aether_data.json`

サーバーレス運用ではこれらを起動しなくてよいです。

---

## 🎨 Aether DSL (v5.0) 構文リファレンス

他のLLMエージェントがAetherのホワイトボードを新規作成・更新する際は、必ず以下の構文仕様を遵守してください。

### 1. 付箋 (sticky) オブジェクト
```text
sticky [ID] "[タイトル]" {
  pos: [X座標] [Y座標]
  color: "[red | blue | green | purple | yellow | orange]"
  tags: "[タグカテゴリ名]"                # タグフィルターバーに自動登録（複数はスペース区切り）
  time: "[時間軸ステップ名]"             # 時系列スライダー（例: "1_縄文期"）
  tone: "[stable | tension | excited]"   # 感情トーン脈動
  desc: "[詳細説明のテキスト]"           # 改行は \n
}
```

* **Markdownテーブル**:
  ```text
  desc: "論文モデルの説明。\n\n| 祖先 | 割合 | 時期 |\n|---|---|---|\n| 縄文系 | 13% | 縄文 |\n| 弥生系 | 30% | 弥生 |\n| 古墳系 | 57% | 古墳 |"
  ```
* **Markdown画像**: `![代替テキスト](画像URLまたはローカルパス)`
* **数式 (LaTeX/KaTeX)**:
  * インライン: `$ 数式 $` / ブロック: `$$ 数式 $$`
  * ファイル記述時のバックスラッシュは **常に1本**（例: `\frac`, `\sigma`）
  * `\\frac` のように多重エスケープされても描画側で自動補正

### 2. 装飾 (drawing) オブジェクト
```text
drawing [ID] "[タイトル]" {
  type: "[circle-area | icon]"
  targets: "[付箋ID_1] [付箋ID_2] ..."   # circle-area の囲み対象
  anchor: "[付箋ID]"                      # icon の吸着先
  style: "[database | brain | alert]"
  offset: [Xオフセット] [Yオフセット]
  color: "[カラー名]"
  tags: "[タグ名]"
  time: "[時間軸ステップ名]"
}
```

### 3. 関係性エッジ (relation) オブジェクト
```text
relation [始点付箋ID] -> [終点付箋ID] {
  type: "[conflict | influence | similarity | default]"
  label: "[関係性テキスト]"
  color: "[カラー名]"
  tags: "[タグ名]"
  time: "[時間軸ステップ名]"
}
```

### 4. 単純接続（フォールバック）
```text
Origin_J -> Y_D1a2a
Origin_J -> Dual_Structure
```

---

## エージェント向けチェックリスト

- [ ] 正本は `aether_dsl.txt` を更新したか
- [ ] `\` は1本、`desc` 改行は `\n` か
- [ ] UI 反映方法（読込 / DnD / 配布HTML）をキャプテンに案内したか
- [ ] メインチャットに巨大 DSL を貼っていないか
- [ ] GitHub へ反映が必要な場合、`aether` リポジトリへ commit/push したか
