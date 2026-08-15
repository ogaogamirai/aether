# Aether3D Phase 1 詳細設計仕様書 (Aether3D Lite Core)
**Document ID:** SPEC-AETHER3D-PHASE1-20260815  
**Author:** Eleanor Arroway (Ellie) / Architecture Design  
**Implementer:** Nova (Physical Execution Layer)  
**Status:** Ready for Implementation  
**Target File Size:** ~35 - 40 KB (Self-contained, Zero External Dependencies)

---

## 1. 概要と目的

現行 Aether（DOM/SVG描画）が抱える「ノード多数時の画面ちらつき（Reflow負荷）」と「座標手打ち（pos: X Y）の管理負荷」を根本解決するため、**ブラウザ標準 WebGL2 ベースの超軽量 3D/2D 統合描画エンジン（Three.js サブセット型）** を Phase 1 として構築・統合する。

### コアゴール
1. **画面ちらつきの完全根絶**: GPU ダブルバッファリングにより、何千ノードでも 60fps 固定・ちらつきゼロ。
2. **既存 AetherDSL 完全互換**: 過去の DSL ファイル（`pos: X Y` 有り）を 100% そのまま読み込み可能。
3. **座標レス自動配置（Auto-Layout）**: `pos` がない新構文でも、エンジンが自動で美しい位置に自己組織化配置。
4. **Three.js サブセット設計**: 将来の機能拡張や本家 Three.js へのシームレス換装を保証する API 互換性。
5. **完全自給自足（スタンドアロン）**: 外部 CDN や外部画像一切不要。単一 HTML/JS で完全オフライン動作。

---

## 2. 非破壊・安全開発プロトコル（既存環境の保護）

現行の Aether LIVE 環境および GitHub リポジトリ（`Tools/aether`）を絶対に壊さないため、以下の隔離・並行開発ルールを厳守すること。

- **作業ディレクトリ**: `G:\マイドライブ\Tools\aether\`
- **ファイル命名分離**:
  - 現行の `index.html` や `aether_main.js` は直接上書きしない。
  - 新エンジン用ファイルとして `index_v2.html`（または `aether3d_prototype.html`）および `aether3d_core.js` として作成・検証する。
  - 動作確認とキャプテンの承認が完了した段階で、段階的に本番統合を行う。
- **Git 運用**:
  - 作業開始前に現在の状態を commit または新ブランチ（`feature/aether3d-phase1`）に退避して進めること。

---

## 3. システムアーキテクチャ構成

```
┌─────────────────────────────────────────────────────────────┐
│                    Aether3D Phase 1 Architecture             │
│                                                             │
│  [1. Input Layer]                                           │
│  ・AetherDSL Parser (sticky, relation, role, confidence)    │
│  ・Legacy Pos Support (Fixed) + Auto-Layout Nodes (Dynamic) │
│                                                             │
│  [2. Computation Layer]                                     │
│  ・4-Mode Layout Engine (Spring / Tree-LR / Tree-TB / Time) │
│  ・Raycast & Screen Projection (Mouse/Touch to 3D/2D)       │
│                                                             │
│  [3. Rendering Layer (Three.js Subset / Pure WebGL2)]       │
│  ・Scene, Perspective/Orthographic Camera, OrbitControls    │
│  ・Octahedron/Box/Hexagon/Sphere Geometries + Flat Shading  │
│  ・Network Edge Lines + Glow Shader                         │
│                                                             │
│  [4. Presentation Layer]                                    │
│  ・Single <canvas> (GPU Render)                             │
│  ・2D Glass Detail Modal (Text, Tags, Role, Status)         │
│  ・Search Bar & Mode Toggle (2D/3D, Layout Presets, Rst)    │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Three.js サブセット API 仕様（自前ミニエンジン）

以下のクラス・関数構造をピュア JavaScript で実装し、内部は WebGL2 で描画する。

```javascript
// 1. Matrix Math (M4)
// perspective, orthographic, multiply, translate, scale, lookAt, invert

// 2. Core Scene Graph
class Scene {
  constructor() { this.children = []; }
  add(object) { this.children.push(object); }
  remove(object) { /* remove */ }
}

// 3. Cameras
class PerspectiveCamera {
  constructor(fov, aspect, near, far) { /* 3D perspective matrix */ }
}
class OrthographicCamera {
  constructor(left, right, top, bottom, near, far) { /* 2D flat matrix */ }
}

// 4. Geometries & Meshes
class Geometry {
  // Box, Sphere, Octahedron, HexagonPrism, Line, Points
}
class Material {
  // StandardMaterial (Diffuse + Specular + Emissive)
  // LineBasicMaterial (Color, Opacity)
}
class Mesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = [0, 0, 0];
    this.rotation = [0, 0, 0];
    this.scale = [1, 1, 1];
  }
}

// 5. Controls
class OrbitControls {
  // Mouse Drag (Orbit / Pan), Wheel (Zoom), Touch (1-finger Rotate, 2-finger Pinch)
}
```

---

## 5. AetherDSL 互換仕様 & 4大自動レイアウト

### 構文パース仕様
- `sticky ID "Title" { pos: X Y, color: "blue", role: "claim", confidence: "high", time: "1_確認", desc: "..." }`
- `relation FROM -> TO { label: "...", type: "...", flow: "forward" }`
- `pos` が記述されている場合はその座標に固定、省略されている場合はレイアウトエンジンが自動配置。

### 4大レイアウトアルゴリズム
1. **星団・銀河型（Force-Directed / Spring）**:
   - ノード間のクーロン反発力 ＋ エッジのフック引力シミュレーション（100ステップ程度で安定収束）。
2. **階層ツリー横型（Tree LR: Left-to-Right）**:
   - 依存関係（relation）の深さに応じて左から右へ階層配置。
3. **階層ツリー縦型（Tree TB: Top-to-Bottom / BT）**:
   - 原因・根拠を下/上に、結論を上/下に階層配置。
4. **時系列タイムライン型（Timeline）**:
   - `time` 属性（例: `1_確認`, `2_検討`）の順序に沿って水平または奥行き方向に整列。

---

## 6. UI & インタラクション仕様

1. **画面構成**:
   - フルスクリーン `<canvas id="aether-canvas">`
   - 左上: タイトル、視点切替（2D/3D）、レイアウト切替（星団/ツリー/タイムライン）、リセットボタン
   - 右上: 検索バー（ノード名・本文インクリメンタル検索 ➔ ヒットノードへカメラ滑空）
   - 右端: ノードクリック時に開く「2D詳細ガラスカード」（タイトル、タグ、役割、詳細テキスト、閉じるボタン）
2. **キーボードショートカット**:
   - `Space + ドラッグ`: パン移動
   - `1`: 2D真上視点 / `2`: 3D斜め視点 / `3`: 側面視点
   - `F`: 選択ノードへフォーカスズーム / `R`: 全体俯瞰リセット
   - `Ctrl + F` または `/`: 検索バーにフォーカス

---

## 7. 実装タスクステップ（Nova 向け）

- [ ] **Step 1: 作業環境と Git ブランチの準備**
  - `Tools/aether` で Git 状態確認・バックアップ確保
- [ ] **Step 2: Three.js サブセット描画コアの実装 (`aether3d_core.js`)**
  - WebGL2 初期化、M4行列演算、シェーダー、ジオメトリ生成
- [ ] **Step 3: AetherDSL パーサー & レイアウトエンジンの統合**
  - 現行 DSL のパースと 4大レイアウトの計算処理
- [ ] **Step 4: 単体完結プロトタイプ (`index_v2.html`) の組み立て**
  - Canvas 描画、OrbitControls、UI オーバーレイ、詳細カード連携
- [ ] **Step 5: 現行データによるスモークテスト & 動作確認**
  - `aether_dsl_layout_smoke_20260813.txt` 等を読み込ませ、ちらつき・操作感・互換性を検証

---
以上。
