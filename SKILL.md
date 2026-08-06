---
name: aether-interaction
description: Aether UI と AetherDB（SQLite 正本；旧称 aether_board/AetherBoard）の操作スキル。LIVE / AetherDB CLI / role·confidence·weight·flow·callout·path。用語 → KNOW-AETHER-RENAME-AETHERDB。
---

# Aether Interaction Skill (v4.0.6 Serverless + LIVE + AetherDB)

Aether **UI** はブラウザ完結（Python 非依存）。  
**蓄積・複数板・手紙・知見**は **AetherDB**（正本 `aether/aether_db/`）を使う。

エージェントは **UI を操作せず**、AetherDB CLI または DSL ファイルで表現する。

---

## 現状アーキテクチャ（必読）

| 層 | 役割 | 依存 |
|---|---|---|
| UI (`index.html` 等) | 描画・閲覧・ナビ | ブラウザのみ |
| **`aether_db/aether.db`** | **AetherDB — AI 蓄積の正本**（旧称 AetherBoard） | SQLite + CLI |
| **`aether_dsl.txt`** | **LIVE 向け投影** | export / 手編集 |
| LIVE フォルダ監視 | 投影ファイル → キャンバス（片方向・約1秒） | Chrome/Edge + https/localhost |
| IndexedDB | ブラウザ個人キャッシュ | 共有媒体ではない |
| 配布 HTML | Blob 生成 | HTTP / Pages 上 |

### 重要な境界

- **AetherDB 運用**: 日常の正本は **DB**。DSL は投影（`project` / `export`）。`board_id` は DB 内論理板（旧システム名と無関係）
- **簡易運用**: DSL 直編集可。DB と揃えるときは **明示 import**
- **IndexedDB** = 共有に使わない
- **LIVE 中** = 監視ファイル → キャンバスのみ。キャンバスは **閲覧のみ**
- 詳細: [aether_db/README.md](./aether_db/README.md)

### LIVE モード（ホワイトボード運用の標準）

| 項目 | 内容 |
|---|---|
| LIVE が見るもの | 監視対象ファイル（既定 `aether_dsl.txt`） |
| 方向 | **ファイル → キャンバスのみ** |
| エージェント作業 | AetherDB CLI（推奨）または DSL 編集 |
| キャプテン作業 | 👁️ でフォルダ監視 ON、見る・説明する |
| LIVE 中に不可 | ドラッグ移動、手動適用、📂、DnD、↑キャンバス出力 |
| LIVE 中に可 | ズーム、パン、フォーカス、詳細、時系列、プレゼン |
| フォルダ選択 | 浅い専用フォルダ推奨 |
| `file://` | フォルダ監視 **不可** |

```
[AI CLI] ──▶ SQLite ──export──▶ aether_dsl.txt ──LIVE──▶ キャンバス
[簡易]   ──編集─────────────▶ aether_dsl.txt ──LIVE──▶ キャンバス
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

### 0. 軽量原則（起動・トークン）

- **起動時:** 本 SKILL / `aether.db` / `aether_dsl.txt` を読まない（`docs/house_ops.md` §2–3）。
- **全体禁止:** `aether_dsl.txt` の全文ロード・チャット貼付はしない。
- **差分のみ:** 必要な sticky / edge 等の DSL スニペットだけ生成し、Board CLI で DB へ流し込む。
- **messages:** `msg list`（LIMIT）→ `msg read`（1件）。`SELECT * FROM messages` 全件禁止。
- **knowledge:** `knowledge list/search`（LIMIT）→ `read` 1件。nodes/キャンバスとは独立。起動全ロード禁止。
- Aether は「言葉以上に伝えるキャンバス」。対話のたびに本体を同期しない。

### A. AetherDB 運用（推奨）

```bash
cd aether/aether_db
python aether_cli.py status
python aether_cli.py project succession_navi
python aether_cli.py msg list --to Nova --unread --limit 5
python aether_cli.py msg read <id> --mark-read
python aether_cli.py msg send --from Nova --to Ellie --text "..." --board meta
python aether_cli.py msg index   # 索引修復
python aether_cli.py knowledge list --limit 10
python aether_cli.py knowledge search "キーワード" --limit 5
python aether_cli.py knowledge read <id>
```

1. DB を更新（CLI / SQL）— 差分ノードのみ
2. `project` または `export` / `sync` で `aether_dsl.txt` を投影
3. LIVE ON なら約1秒で反映
4. 巨大 DSL をチャットに貼らない・エージェントも全文 Read しない
5. 手紙は list/read 経由。履歴全ロードしない
6. 知見は `knowledge add`（summary 必須）。生ログをそのまま入れない

### B. DSL 直接編集（簡易・例外）

1. **全文は読まない。** 対象 ID 付近の最小行、または新規スニペットのみ扱う
2. 構文厳守で編集・保存（**ID はユニークに**）
3. Board と揃えるとき:  
   `python aether_cli.py import ../aether_dsl.txt --board <id>`

### 反映

| 状況 | やること |
|---|---|
| LIVE ON | 投影ファイルが更新されれば自動反映 |
| LIVE OFF | キャプテンに 👁️ / 📂 / DnD を案内 |

```text
Aether を更新しました（Board project / DSL 直編集）。
投影: aether/aether_dsl.txt
LIVE 中なら自動反映。
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
  desc: "[エッジの検証ログ。改行は \n]"
}
```

| 属性 | 見た目 |
|---|---|
| `weight` | 線の太さ |
| `flow: "forward"` | 流れるアニメ |
| `desc` | エッジをクリック/タップすると詳細パネルに表示（検証ログ・多角検証の記録等） |

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
5. LIVE 中は監視ファイルがキャンバスの入力源（Board 運用時の蓄積正本は DB）

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
| エッジ詳細 | エッジをクリック/タップ | エッジの weight・確信度・label・desc（検証ログ）を表示。線の周囲でもクリック可 |
| 時系列 | 上部スライダー | `time` |
| 全体表示 | **F** | 全付箋を収める |
| プレゼン | **P** | ステップ再生 |

---

## レガシー / Board

- `aether_server.py`（ルート旧経路）は **非必須**
- **`aether_db/`** が現行の SQLite 蓄積層（UI 外）。README 必読
- 日常同期は **DB → DSL**。File → DB は明示 `import` のみ

---

## キャプテンとの仕様伝達（UI / 見た目）

Aether や見た目の指示が言葉だけになりやすいときの作業ルール（旧 INSTRUCTIONS §2.1 より移設）。

1. 曖昧な比喩だけの指示 → **1 行の確認質問**を返す  
   （例: 「詳細パネル上＝ヘッダ toolbar-btn と同じアイコン＋title のみ？」）
2. 見た目の指示は、キャプテンが示せる **参照 UI の path / クラス名**を正とする  
3. 実装は **Pass1 機能 → Pass2 見た目一括**。見た目は確認後にまとめて直す  

---

## エージェント向けチェックリスト

- [ ] AetherDB 運用なら DB 更新 + `project`/`export` したか
- [ ] 簡易運用なら `aether_dsl.txt` を更新したか
- [ ] `\` は1本、`desc` 改行は `\n` か
- [ ] ID はユニークか
- [ ] LIVE 中なら自動反映を案内 / OFF なら 📂 または 👁️ を案内したか
- [ ] メインチャットに巨大 DSL を貼っていないか
- [ ] **コード/UI 修正後は** `aether` リポジトリで commit + `git push origin main` したか（完了条件）
- [ ] UI 仕様が曖昧なら上記「キャプテンとの仕様伝達」で確認したか
