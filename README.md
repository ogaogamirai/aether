# Aether — Serverless Super Whiteboard

ブラウザ完結型の無限ホワイトボード。Python / SQLite 非依存。

## GitHub Pages

このリポジトリを GitHub Pages に公開すると、配布用HTMLエクスポートを含む全機能が使えます。

1. Repository → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / folder: `/ (root)`
4. 公開URL例: `https://ogaogamirai.github.io/aether/`

## ローカル起動

```bash
npx serve .
# または
python -m http.server 8080
```

`http://localhost:3000`（または表示されたURL）で `index.html` を開いてください。

## 主な機能

| 機能 | 説明 |
|---|---|
| IndexedDB オートセーブ | 3秒デバウンスでブラウザ内保存 |
| ドラッグ＆ドロップ | `.txt` / `.dsl` をキャンバスにドロップで即適用 |
| 配布用HTML | フロントエンド単体で自己完結HTMLを生成 |
| 時系列スライダー / タグ | DSL の `time` / `tags` を可視化 |

## ファイル構成（UI）

- `index.html` — メイン画面
- `style.css` — スタイル
- `aether_main.js` — 制御・IndexedDB・export
- `aether_parser.js` — DSL パーサ
- `aether_renderer.js` — キャンバス描画
- `aether_dsl.txt` — 共有用 DSL サンプル

## DSL の正本

エージェント／人間が共有する図面の正本は `aether_dsl.txt` です。  
IndexedDB はブラウザ個人の作業キャッシュです。
