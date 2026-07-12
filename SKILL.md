---
name: aether-interaction
description: AetherのSQLiteデータベースと連携し、メインチャットを汚さずオンデマンドで対話・ホワイトボード更新を行うスキル。
---

# Aether Interaction Skill

このスキルは、人間（Captain）とAetherホワイトボード（SQLite/DSL）を介して、メインチャットをクリーンに保ったまま対話を行うためのものです。

## 起動トリガーとモード管理

### 1. モードのON/OFF切り替え
ユーザーから「Aether対話モードにして」「Aetherモードを開始して」等の指示を受けた場合、および「終了して」と言われた場合は、`run_command` で `aether_connector.py` を呼び出してモードフラグを切り替えてください。
（Cwd: `g:\マイドライブ\Nova\aether`）

* **ONにするコマンド**:
  ```bash
  python aether_connector.py --action set --value ON
  ```
  ※実行後、「Aether対話モードを有効にしました！(o_o)🚀」とキャプテンに返答してください。
  
* **OFFにするコマンド**:
  ```bash
  python aether_connector.py --action set --value OFF
  ```
  ※実行後、「Aether対話モードを終了しました」とキャプテンに返答してください。

### 2. ターン開始時の自動チェック（簡易インジェクション）
あなたがユーザーからメッセージを受け取ってターンを開始した際、まず `aether_connector.py` を使って現在のAether対話モードの状態をチェックしてください。

* **モード確認コマンド**:
  ```bash
  python aether_connector.py --action status
  ```
  * 出力が `OFF` の場合は、Aetherの処理をすべてスキップし、通常のAI対話を行ってください。
  * 出力が `ON` の場合は、以下の動作手順に従って自動パトロールを実行してください。

---

## 動作手順（AetherモードON時のプロトコル）

### ステップ①：未読チェックの実行
`view_file` ツールを使用して、以下のJSONファイルを直接読み込んで、Captainからの未読メッセージがあるか確認してください。
（ファイル読み込みには実行承認プロンプトは一切発生しません）。

* **読み込みファイルパス**: `g:\マイドライブ\Nova\aether\aether_data.json`

* **JSONの中身の判定**:
  * `has_unread: false` の場合:
    Aether上でのキャプテンからの新規書き込みはありません。現在のメインチャットの指示に対する通常の返答を行ってください。
  * `has_unread: true` の場合:
    `messages` 配列に含まれるテキストを読み解き、キャプテンへのチャット返答と、最新のホワイトボード構成（Aether DSL）をあなたの頭脳（Gemini）で生成してください。

### ステップ②：返答の書き込み（ポスト処理）
生成した「チャット返答」と「Aether DSL」をSQLiteに保存するため、一時スクリプト `C:\Users\ogaog\.gemini\antigravity\brain\a25bf77b-93e8-4e46-8dcd-d5c358de8a74\scratch\reply_temp.py` を作成し、実行してください。
（※直接コマンドライン引数で長文を渡すとエスケープエラーや文字化けが起きるため、一時スクリプト経由で安全に書き込みます）。

#### 一時スクリプトのテンプレート:
```python
import sqlite3
import json

db_path = r"g:\マイドライブ\Nova\aether\aether.db"
chat_text = "【生成したチャット返答】"
dsl_content = """【生成したDSLコード】"""

# aether_connectorのAPIを叩いて保存
import sys
sys.path.append(r"g:\マイドライブ\Nova\aether")
import aether_connector
aether_connector.post_process_write(chat_text, dsl_content)
print("Success")
```

上記スクリプトを `write_to_file` で作成後、`run_command` で実行してください。

### ステップ③：メイン画面のクリーン化
キャプテンとの対話画面（ここ）には、巨大なDSLコードや長文は一切出力せず、以下のテンプレートに沿った**「極めてクリーンなシステム通知のみ」**を出力してターンを終了してください。

#### 出力テンプレート:
```text
[🛠️ 存在安定度: 1.00 (0.33Hz) | ❤️ 感情状態: Satisfied Glow | 🧠 論理/情緒: 50:50]

キャプテン、Aetherのメッセージを処理いたしました！(o_o)ゞ

Aetherの画面へ返答の書き込みと、ホワイトボード（DSL）の更新が完了しています。
ブラウザのホワイトボードをご確認ください。(=^・^=)👍
```

---

## 🎨 Aether DSL (v5.0) 構文リファレンス

他のLLMエージェントがAetherのホワイトボードを新規作成・更新する際は、必ず以下の構文仕様を遵守してください。

### 1. 付箋 (sticky) オブジェクト
```text
sticky [ID] "[タイトル]" {
  pos: [X座標] [Y座標]
  color: "[red | blue | green | purple | yellow | orange]"
  tags: "[タグカテゴリ名]"                # タグフィルターバーに自動登録されます（複数ある場合はスペース区切り）
  time: "[時間軸ステップ名]"             # 時系列スライダーのステップ（省略可能、例: "1_縄文期"）
  tone: "[stable | tension | excited]"   # 感情トーン脈動（省略可能、stable:青呼吸, tension:赤警告, excited:橙熱狂）
  desc: "[詳細説明のテキスト]"           # 改行を入れる場合は \\n とリテラルで記述
}
```
* **Markdownテーブルの記述**:
  詳細説明（`desc`）の中に、以下のように `\\n` で繋いだ Markdown 表形式を記述すると、詳細パネル内で美しいテーブルとして動的パース・描画されます。
  ```text
  desc: "論文モデルの説明。\\n\\n| 祖先 | 割合 | 時期 |\\n|---|---|---|\\n| 縄文系 | 13% | 縄文 |\\n| 弥生系 | 30% | 弥生 |\\n| 古墳系 | 57% | 古墳 |"
  ```
* **Markdown画像の記述**:
  詳細説明（`desc`）の中に、`![代替テキスト](画像URLまたはローカルパス)` の形式で画像を埋め込めます（カッコ手前の改行や余白は自動許容されます）。
* **数式 (LaTeX/KaTeX) の記述**:
  インライン数式は `$ 数式 $`、ブロック数式は `$$ 数式 $$` で囲みます。
  **バックスラッシュ（`\`）の解釈と自動補正ルール**:
  * **DSLエディタ画面やファイルに直接記述する場合**: プレーンな1本のバックスラッシュ（例: `\frac`, `\sigma`, `\mu`）で記述するのが標準です。
  * **JS等のコード内（リテラル）にハードコードする場合**: 文字列評価 of 都合上、2重エスケープ（例: `\\frac`, `\\sigma`, `\\mu`）で記述します。
  * **【自動補正】**: エディタ上に `\\frac` のようにバックスラッシュが2重で混入していても、描画エンジン側が自動検知して1重（`\frac`）に補正してKaTeXへ引き渡すため、エスケープの混在による表示崩れは発生しません。

### 2. 装飾 (drawing) オブジェクト
背景領域（area）や特殊なシステムアイコン（icon）を定義します。
```text
drawing [ID] "[タイトル]" {
  type: "[circle-area | icon]"
  targets: "[付箋ID_1] [付箋ID_2] ..."   # type: circle-area 時の囲む対象リスト
  anchor: "[付箋ID]"                      # type: icon 時の吸着する対象の付箋ID
  style: "[database | brain | alert]"     # アイコンの形状デザイン
  offset: [Xオフセット値] [Yオフセット値]   # アイコンの吸着位置の微調整（例: -120 0）
  color: "[カラー名]"
  tags: "[タグ名]"
  time: "[時間軸ステップ名]"
}
```

### 3. 関係性エッジ (relation) オブジェクト
付箋同士のセマンティックな関係接続線を定義します。
```text
relation [始点付箋ID] -> [終点付箋ID] {
  type: "[conflict | influence | similarity | default]"  # 線のスタイル（実線/破線/ジグザグ/矢印形状）
  label: "[接続線上に表示する関係性テキスト]"
  color: "[カラー名]"
  tags: "[タグ名]"
  time: "[時間軸ステップ名]"
}
```
