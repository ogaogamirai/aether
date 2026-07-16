---
name: aether-interaction
description: Aetherサーバーレスホワイトボードの操作・DSL更新スキル。LIVE監視（ファイル正本）/ IndexedDB / GitHub Pages / role·confidence·weight·flow·callout·path を含む。
---

# Aether Interaction Skill (v4.0.6 Serverless + LIVE)

Aether は **ブラウザ完結のスーパーホワイトボード** です。  
UI 本体は Python / SQLite / ローカルAPI に依存しません。

エージェント（エリー・ノヴァ等）は **UI を操作せず、DSL ファイルを編集**して表現する。

---

## 現状アーキテクチャ（必読）

| 層 | 役割 | 依存 |
|---|---|---|
| UI (`index.html` 等) | 描画・閲覧・ナビ | ブラウザのみ |
| **共有正本** | **`aether_dsl.txt`** | ファイル / Git |
| LIVE フォルダ監視 | 正本 → キャンバス（片方向・約1秒） | Chrome/Edge + https/localhost |
| IndexedDB | ブラウザ個人キャッシュ | 共有媒体ではない |
| 配布 HTML | Blob 生成 | HTTP / Pages 上 |

### 重要な境界

- **`aether_dsl.txt`** = 人間/エージェント間で共有する **唯一の正本**
- **IndexedDB** = そのブラウザだけの作業キャッシュ（エージェント共有に使わない）
- **LIVE 中** = 監視ファイルが正本。キャンバスは **閲覧のみ**（データ変更不可）
- **UI チャットタブは撤廃済み**（サイドバーは `{ } Aether DSL` と `📖 詳細`）

### LIVE モード（ホワイトボード運用の標準）

| 項目 | 内容 |
|---|---|
| 正本 | 監視対象ファイル（既定 `aether_dsl.txt`） |
| 方向 | **ファイル → キャンバスのみ** |
| エージェント作業 | ファイルを編集して保存 |
| キャプテン作業 | 👁️ でフォルダ監視 ON、見る・説明する |
| LIVE 中に不可 | ドラッグ移動、手動適用、📂、DnD、↑キャンバス出力 |
| LIVE 中に可 | ズーム、パン、フォーカス、詳細、時系列、プレゼン |
| フォルダ選択 | 浅い専用フォルダ推奨（`C:\` やホーム直下は拒否されやすい） |
| `file://` | フォルダ監視 **不可**（Pages または `npx serve`） |

```
[AI] ──編集──▶ aether_dsl.txt ──LIVE──▶ キャンバス
```

---

## 起動・公開方法

### A. GitHub Pages（推奨・LIVE 可）

- https://ogaogamirai.github.io/aether/
- リポジトリ: https://github.com/ogaogamirai/aether

### B. ローカル HTTP（LIVE 可）

```bash
cd aether
npx serve .
# または python -m http.server 8080
```

### C. file://

- 閲覧・IndexedDB は可
- **LIVE / 配布HTML は不可**

資産が古いときはハードリロード（現行 `?v=4.0.6`）。

---

## エージェント作業プロトコル

### 1. 正本を読む

- 既定: `G:\マイドライブ\Nova\aether\aether_dsl.txt`
- キャプテンが別フォルダを監視している場合はそのパスの監視ファイル名

### 2. DSL を編集して保存

- 構文ルール厳守（下記）
- **ID はユニークに**（重複は `_2` 自動リネームされるが意図しない分裂の元）

### 3. 反映

| 状況 | やること |
|---|---|
| LIVE ON | 保存のみ。約1秒で自動反映 |
| LIVE OFF | キャプテンに 👁️ 開始 / 📂 / DnD を案内 |

### 4. チャットは短く

巨大 DSL を貼らない。

```text
Aether DSL を更新しました。
正本: G:\マイドライブ\Nova\aether\aether_dsl.txt
LIVE 中なら自動反映。OFF なら 📂 またはフォルダ監視を。
```

---

## Aether DSL 構文リファレンス

### 1. sticky（付箋）

```text
sticky [ID] "[タイトル]" {
  pos: [X] [Y]
  color: "[blue|green|yellow|purple|orange|red|pink|...]"
  tags: "[タグ 複数はスペース]"
  time: "[時間ステップ名]"
  tone: "[stable|tension|excited]"
  role: "[claim|evidence|caveat|question]"
  confidence: "[high|mid|low]"   # または 0.0–1.0
  desc: "[詳細。改行は \n]"
}
```

| 属性 | 見た目 |
|---|---|
| `role` | 左ボーダー色 + バッジ |
| `confidence` | バッジ + high 影 / low 破線 |
| `tone` | 脈動オーラ |

* **表**: `desc` 内 Markdown テーブル  
* **画像**: `![alt](url)`  
* **数式**: `$...$` / `$$...$$`、バックスラッシュは **1本**

### 2. relation（意味的な線）

```text
relation [fromID] -> [toID] {
  type: "[default|evidence|conflict|influence|similarity]"
  label: "[ラベル]"
  color: "[カラー]"
  tags: "[タグ]"
  time: "[時間]"
  weight: [1-5]
  flow: "forward"
}
```

| 属性 | 見た目 |
|---|---|
| `weight` | 線の太さ |
| `flow: "forward"` | 流れるアニメ |

### 3. callout（注釈・Phase 3）

```text
callout [ID] "[注釈テキスト]" {
  anchor: "[stickyID]"
  offset: [dx] [dy]
  color: "[カラー]"
  tags: "[タグ]"
  time: "[時間]"
}
```

内部は drawings（type=callout）として保持。

### 4. path（誘導ルート・Phase 3）

```text
path [ID] "[ラベル]" {
  nodes: "[ID1] [ID2] [ID3] ..."
  style: "[pulse|dashed]"
  color: "[カラー]"
  tags: "[タグ]"
  time: "[時間]"
}
```

番号付きの道筋。`style: pulse` で流れアニメ。

### 5. drawing（領域・アイコン）

```text
drawing [ID] "[タイトル]" {
  type: "[circle-area|icon|arc-up|...]"
  targets: "[付箋ID ...]"
  anchor: "[付箋ID]"
  style: "[database|brain|alert|...]"
  offset: [X] [Y]
  color: "[カラー]"
  tags: "[タグ]"
  time: "[時間]"
}
```

### 6. 単純接続

```text
A -> B
```

---

## 基本ルール

1. `\` は1本、`desc` 改行は `\n`
2. sticky / drawing / callout / path の **ID はユニーク**
3. 未知の属性値は無視される（壊さない）
4. IndexedDB を共有に使わない
5. LIVE 中はファイルだけが正本

---

## UI 操作マップ（キャプテン向け説明用）

| 操作 | 場所 | 説明 |
|---|---|---|
| フォルダ監視 | 👁️ / ■ | LIVE ON/OFF |
| LIVE 表示 | ● LIVE | 監視中 |
| 監視ファイル名 | DSL タブ | 既定 `aether_dsl.txt` |
| DSL 編集 | `{ } Aether DSL` | LIVE 中は読取専用 |
| ファイル読込/保存 | 📂 / 💾 | LIVE 中 📂 無効 |
| 詳細 | 📖 | 付箋クリック |
| 時系列 | 上部スライダー | `time` |
| 全体表示 | **F** | 全付箋を収める |
| プレゼン | **P** | ステップ再生 |

---

## レガシー

- `aether_server.py` / 旧 `aether.db` チャット同期は **非必須**
- SQLite 経由の AI 操作は **将来案**（現時点は DSL 直編集）

---

## エージェント向けチェックリスト

- [ ] 正本 `aether_dsl.txt`（または監視ファイル）を更新したか
- [ ] `\` は1本、`desc` 改行は `\n` か
- [ ] ID はユニークか
- [ ] LIVE 中なら自動反映を案内したか / OFF なら 📂 または 👁️ を案内したか
- [ ] メインチャットに巨大 DSL を貼っていないか
- [ ] GitHub 反映が必要なら `aether` リポジトリへ commit/push したか
