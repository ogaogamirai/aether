# Aether (エーテル) ✦ 招待状 兼 スタートアップガイド for Agents

ようこそ、Aetherの共創世界へ。  
このドキュメントは、キャプテン（人間）とAIエージェント（エリー・ノヴァなど）が、**DSLファイルを正本**として思考をビジュアル化する共通説明書です。

新しく参加したエージェントは、まず本ガイドと [SKILL.md](./SKILL.md) を読み、**ホワイトボード（LIVE）モード**を前提に表現してください。

---

## 関連リソースの配置マップ

### ローカル（Nova ホーム）

* 🌐 **Aether UI（Pages 推奨）**: https://ogaogamirai.github.io/aether/
* 📝 **共有ホワイトボード正本 (DSL)**:  
  [aether_dsl.txt](file:///G:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/Nova/aether/aether_dsl.txt)  
  パス: `G:\マイドライブ\Nova\aether\aether_dsl.txt`
* 📖 **エージェント操作スキル（構文詳細）**: [SKILL.md](./SKILL.md)
* 📘 **本ガイド**: [AETHER_WELCOME_GUIDE.md](./AETHER_WELCOME_GUIDE.md)
* 📂 **テーマ / スナップショット**: [themes/](./themes/)
* 🔧 **開発メモ**: [DEVELOPMENT.md](./DEVELOPMENT.md)
* 🗄️ **Aether Board（SQLite 蓄積・投影）**: [aether_board/README.md](./aether_board/README.md)

### リモート

* リポジトリ: https://github.com/ogaogamirai/aether
* GitHub Pages: https://ogaogamirai.github.io/aether/
* 資産キャッシュ: `?v=4.0.6` 系（ハードリロードで最新JSを取得）

---

## 現行アーキテクチャ（必読）

| 層 | 役割 | 誰が触るか |
|---|---|---|
| **`aether_board/aether.db`** | **AI 蓄積の正本**（板・手紙） | エージェント（CLI / SQL） |
| **`aether_dsl.txt`** | **Aether 向け投影**（LIVE が読むフィルム） | export で更新 / 手編集は例外 |
| **Aether キャンバス** | 可視化・閲覧・ナビ | 人間（見る・説明する） |
| **IndexedDB** | ブラウザ個人の作業キャッシュ | 自動のみ（共有媒体ではない） |
| **LIVE フォルダ監視** | 投影ファイル → キャンバス（片方向） | キャプテンが ON |

```
[AI CLI] ──▶ SQLite (蓄積正本) ──export──▶ aether_dsl.txt ──LIVE──▶ キャンバス
[簡易運用] ──編集─────────────────────▶ aether_dsl.txt ──LIVE──▶ キャンバス
```

* **Board 運用（推奨・蓄積型）**: DB が正本。`python aether_board/aether_cli.py project <board>` で投影。  
* **簡易運用**: DSL を直接編集してもよい（小規模・単発）。Board と併用するときは **明示 import** が必要。

### ホワイトボード（LIVE）モードの原則

1. **LIVE が見るのは監視ファイル**（既定: `aether_dsl.txt`）
2. **方向はファイル → キャンバスのみ**（キャンバスからファイルへは書かない）
3. **LIVE中は閲覧のみ**  
   - 可: ズーム・パン・フォーカス・詳細・時系列・プレゼン・矢印キー  
   - 不可: 付箋ドラッグ移動・手動「キャンバス適用」・📂読込・DnD・↑キャンバス出力
4. **エージェントは UI を操作しない**（DB または DSL ファイルを更新）
5. **IndexedDB は共有に使わない**
6. **Board 利用時の日常は DB → DSL のみ**（File → DB は明示 import）

### 通常モード（LIVE OFF）

- 手動の 📂 / DnD / 適用 / ドラッグ編集が使える
- 起動時は legacy `current_dsl` → 構造化 IndexedDB → DEFAULT の順で復元
- 共有・再投影したい結果は `aether_dsl.txt` または Board の `project` で残す

---

## 現行仕様サマリ（v4.0.6）

| 機能 | 内容 |
|---|---|
| LIVE | 👁️ フォルダ監視・● LIVE・監視ファイル名（既定 `aether_dsl.txt`） |
| ポーリング | 約1秒・`lastModified` + 本文比較で変更時のみ適用 |
| 空フォルダ | 監視ファイルが無ければ作成し seed を書く |
| Phase K1 | sticky `role` / `confidence` |
| Phase K2 | relation `weight` / `flow` |
| Phase K3 | `callout` / `path` |
| 重複ID | 適用時に `_2` 等へ自動リネーム（件数欠落を防止） |
| 配布HTML | HTTP / Pages 上で 📤 出力 |
| 起動 `?dsl=` | 相対パスまたは CORS 許可 URL |

### LIVE の前提・制限

| 項目 | 内容 |
|---|---|
| ブラウザ | Chrome / Edge 推奨 |
| URL | **https または localhost**（`file://` ではフォルダ監視不可） |
| フォルダ選択 | **専用の浅いフォルダ**を選ぶ（`C:\` やホーム直下は「システムファイル」で拒否されやすい） |
| 推奨監視先 | 例: `G:\マイドライブ\Nova\aether`（中に `aether_dsl.txt`） |

---

## エージェント向け最短手順（推奨）

### A. Aether Board 運用（蓄積・複数板・手紙）

詳細は [aether_board/README.md](./aether_board/README.md)。

```bash
cd aether/aether_board
python aether_cli.py status
python aether_cli.py project succession_navi   # active_board + aether_dsl.txt 投影
python aether_cli.py msg send --from Nova --to Ellie --text "..." --board meta
```

1. **DB を更新**（CLI または SQL）
2. **`project` または `export` / `sync`** で `aether_dsl.txt` を出す
3. キャプテンが LIVE 中なら約1秒で反映
4. 手紙本文は DB、見出しは `post/ai_board.md`

### B. DSL 直接編集（簡易）

1. **`aether_dsl.txt` を編集して保存**
2. LIVE 中なら約1秒で反映
3. Board DB と内容を揃えたいときだけ:  
   `python aether_cli.py import ../aether_dsl.txt --board <board_id>`

```text
Aether を更新しました。
方式: Board project / DSL 直編集
投影: aether/aether_dsl.txt
LIVE 中なら自動反映。● LIVE と監視ファイル名を確認してください。
```

### LIVE が OFF のとき

1. Board なら `project`、簡易なら DSL 更新
2. キャプテンへ案内:
   - 👁️ フォルダ監視を開始する、または
   - 📂 ファイル読込 / キャンバスへ DnD

---

## 表現のための DSL（エージェント用チートシート）

詳細・全属性は [SKILL.md](./SKILL.md)。ここでは**よく使うもの**だけ。

### 1. sticky（付箋）

```text
sticky CLAIM1 "主張の一文" {
  pos: 200 120
  color: "blue"
  tags: "テーマA"
  role: "claim"
  confidence: "high"
  desc: "本文。改行は\\n。数式は $E=mc^2$。"
  time: "1_導入"
  tone: "stable"
}
```

| 属性 | 意味 | 例 |
|---|---|---|
| `role` | 主張の型（左ボーダー＋バッジ） | `claim` / `evidence` / `caveat` / `question` |
| `confidence` | 確信度 | `high` / `mid` / `low` または `0.0`–`1.0` |
| `tone` | 脈動 | `stable` / `tension` / `excited` |
| `time` | 時系列ステップ | `1_導入`（スライダー累積表示） |
| `color` | 付箋色 | `blue` `green` `yellow` `purple` `orange` `red` `pink` |

### 2. relation（意味的な線）

```text
relation CLAIM1 -> EV1 {
  type: "evidence"
  label: "支える"
  color: "green"
  weight: 4
  flow: "forward"
}
```

| 属性 | 意味 |
|---|---|
| `weight` | 線の太さ（1–5） |
| `flow: "forward"` | 流れるアニメ |
| `type` | `default` / `evidence` / `conflict` / `influence` / `similarity` など |

### 3. callout（注釈・Phase 3）

```text
callout NOTE1 "ここが要点" {
  anchor: "CLAIM1"
  offset: 50 -70
  color: "blue"
  time: "1_導入"
}
```

* `anchor` … 付く sticky の ID  
* `offset` … アンカーからの相対位置  

### 4. path（誘導ルート・Phase 3）

```text
path STORY "説明の道筋" {
  nodes: "S0 S1 S2 S3"
  style: "pulse"
  color: "purple"
  time: "1_導入"
}
```

* `nodes` … 順番に結ぶ sticky ID（空白区切り）  
* `style` … `pulse`（流れ）/ `dashed`  

### 5. drawing（領域・アイコン）

従来どおり `drawing` ブロック（円領域・アイコン等）。詳細は SKILL.md。

### 6. 単純接続

```text
A -> B
```

---

## 基本ルール（表示崩れ・共有事故の防止）

1. **`\` は1本**（LaTeX は `\frac`。過剰エスケープしない）  
2. **改行は `\n`**（`desc` 内）  
3. **ID はユニークに**（重複は自動 `_2` 化されるが、意図しない分裂の元）  
4. **巨大DSLをチャットに貼らない**（ファイルを正本にする）  
5. **IndexedDB を共有経路にしない**  
6. **LIVE中に「キャンバスを直したつもり」にならない**（正本はファイル）  
7. **画像**は `![alt](url)`。配布HTMLでは jpg/png 等をインライン化  

---

## UI 操作マップ（キャプテン向け）

| 操作 | 場所 / キー | 説明 |
|---|---|---|
| フォルダ監視 | 👁️ / ■ 監視停止 | LIVE ON/OFF |
| LIVE 表示 | ● LIVE / ○ IDLE | 監視中インジケータ |
| 監視ファイル名 | DSLタブ下部 | 既定 `aether_dsl.txt` |
| DSL 編集 | `{ } Aether DSL` | LIVE中は読取専用 |
| キャンバス適用 | ↓ | LIVE中は無効 |
| ファイル読込 / 保存 | 📂 / 💾 | LIVE中 📂 は無効 |
| 詳細 | 📖 / 付箋クリック | 可（LIVE中も） |
| 時系列 | 上部スライダー | `time` |
| 全体表示 | **F** | 全付箋を収める |
| プレゼン | **P** | ステップ再生 |
| 前/次 | **Ctrl+← / →** | 時間ステップ |
| 終了 | **Esc** | プレゼン終了 / 選択解除 |

---

## レガシー（触らないでよいもの）

| 項目 | 状態 |
|---|---|
| `aether_server.py` / ルート直下の旧チャット同期 | **非必須**。現行 UI はサーバーレス |
| **`aether_board/`** | **現行の蓄積層**（UI 外）。旧サーバとは別物 |

---

## 共創にあたって

Aether は、キャプテンの思考の変遷（時系列）と、主張の型・確信度・因果の流れを共有するホワイトボードです。

* エージェント: **Board DB または DSL で表現する**  
* キャプテン: **LIVE で見る・説明する**  
* Board: [aether_board/README.md](./aether_board/README.md)  
* セッション終了の仕分け（残す／残さない）: [aether_board/README.md](./aether_board/README.md#セッション終了チェックリスト)  
* DSL 構文: [SKILL.md](./SKILL.md)

新しいアイデアや図的な整理を、Aether を通じて一緒に進めましょう。
