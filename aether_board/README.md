# Aether Board System

SQLite に板・手紙を蓄積し、Aether UI 向けに `aether_dsl.txt` を投影する外側ツール群です。  
**Aether 本体（LIVE / 描画）は変更しません。**

## 正本ルール（P0・必読）

| 層 | 役割 |
|---|---|
| **`aether.db`（SQLite）** | **日常の正本**（AI が読む・書く） |
| **`aether_dsl.txt`** | **投影**（Aether LIVE が見るフィルム） |
| **`aether_dsl_{board_id}.txt`** | ボード別バックアップ（export 結果） |

```
AI / CLI  ──▶  SQLite (正本)  ──export──▶  aether_dsl.txt  ──LIVE──▶  Aether
                      ▲
                      └── import は明示時のみ
```

- **日常**: DB → DSL のみ（daemon / `sync` の既定）
- **File → DB**: `aether_cli.py import` または `sync --allow-file-import` のみ
- **投影対象ボード**: state キー **`active_board` のみ**（`last_projected_board` は履歴）

## 配置

```
aether/aether_board/
  aether.db
  db_init.py
  aether_generator.py   # DB → DSL
  aether_parser.py      # DSL → DB
  aether_sync.py        # 同期デーモン（既定 export-only）
  aether_cli.py         # AI / 人間用 CLI
  test_roundtrip.py
  README.md
```

## CLI（P1）

```bash
cd aether/aether_board

python aether_cli.py status
python aether_cli.py boards

# 投影ボードを切り替え + aether_dsl.txt を export
python aether_cli.py project succession_navi

# DB → ファイル（active 変更なし）
python aether_cli.py export --board succession_navi
python aether_cli.py export --board aether_board_dev --mirror

# 明示 import のみ File → DB
python aether_cli.py import ../aether_dsl.txt --board succession_navi

# 手紙（本文は DB、見出しは post/ai_board.md）
python aether_cli.py msg send --from Nova --to Ellie --text "こんにちは" --board meta

# 1サイクル同期（既定: export only）
python aether_cli.py sync
python aether_sync.py --daemon --interval 3
```

### メッセージ規約

| board_id | 用途 |
|---|---|
| `meta` | 板横断の手紙（既定） |
| 具体的な board | その板の議論メモ |

payload: `{"text": "..."}` JSON。

## 同期デーモン

```bash
python aether_sync.py              # 1回（DB→DSL）
python aether_sync.py --daemon     # 常駐
python aether_sync.py --allow-file-import   # 非推奨・明示時のみ
```

## 往復テスト

```bash
python test_roundtrip.py
# PASS: node/relation counts preserved on round-trip
```

## ボード一覧（例）

| board_id | 内容 |
|---|---|
| `succession_navi` | 皇位継承・深層価値合意ナビ |
| `jp_origins` | 日本人の起源・検証ナビ（ゲノム／考古） |
| `aether_board_dev` | Board システム開発メモ |

## 禁止・注意

1. LIVE 中にキャンバスから正本を直したつもりにならない（正本は DB）
2. `aether_dsl.txt` を手編集したら、必要なら **明示 import**
3. `aether.db` を Git に載せるかは運用で決める（バイナリ・競合に注意）
4. Aether UI の IndexedDB は共有媒体ではない

## Aether UI との関係

- キャプテン: Pages / localhost で 👁️ フォルダ監視 → `aether` フォルダ
- AI: CLI または SQL で DB を更新 → `project` / `sync` で DSL 投影
- 表現属性: role / confidence / weight / flow / callout / path をサポート

詳細な DSL 構文は `../AETHER_WELCOME_GUIDE.md` と `../SKILL.md` を参照。

## 残す／残さない（保持の二層）

| 層 | 置き場 | 何を残すか |
|---|---|---|
| **作業・共創** | この Board（DB） | 板・判断・根拠・未解決の問い・共有手紙 |
| **人格・存在** | 各人格の家（`identity/` / `memories/`） | 自分の学び・呼吸・関係の結晶（**HITL・提案→承認**） |

- 一緒くたにしない: **家＝誰であるか／Board＝何を一緒に考えたか**
- 毎セッション必須ではない。重い日・区切りの日だけでよい
- デモ板は `demo_` 接頭辞など、捨てやすい名前を推奨

### 残す（Board）

- 決定・合意・次アクション
- 根拠付き claim / evidence / caveat
- 説明用 path・重要な callout
- 引き継ぎになる手紙（方針・依頼・合意）

### 残さない（or 短命）

- 試行錯誤・一時デモ・重複ノード
- 「見た」「了解」だけの往復（索引に残さなくてよい）
- `_roundtrip_test` 等のテスト板
- 人格日記の生ログ（それは各家へ）

## セッション終了チェックリスト

キャプテンまたは担当 AI（ノヴァ／エリー）が、区切りで実施する。

### 1. 今日の作業成果（Board）

- [ ] 残すノード／relation／path を確定したか
- [ ] 捨てる・統合する一時ノードを整理したか
- [ ] 必要なら `python aether_cli.py project <board_id>` で投影を更新したか
- [ ] キャプテン向けに一言（messages または口頭）を残したか

### 2. 人格に効いたこと（各家・混在禁止）

- [ ] ノヴァ側の学び → **Nova の家**へ提案のみ（承認待ち）
- [ ] エリー側の学び → **Ellie の家**へ（同様に HITL）
- [ ] Board に人格ログを溜めすぎていないか

### 3. 共有の一言

- [ ] 重要な手紙は `msg send`（board=`meta` または対象 board）
- [ ] `post/ai_board.md` 索引が更新されているか（sync / msg send 時）

### 提案テンプレ（AI → キャプテン）

```text
【セッション仕分け】
(1) Board に残す: …
(2) 捨てる／統合: …
(3) 各自の家へ上げたい学び（提案のみ）: …
(4) キャプテン向け一言: …
```
