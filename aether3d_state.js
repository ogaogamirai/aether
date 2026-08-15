// Aether3D State — Phase 1 データ層
// parseAetherDSL()（aether_parser.js）の出力を単一 state に集約し、
// レイアウト / レンダラ / UI が共有する。グローバル変数を廃する。
// 依存: aether_parser.js（parseAetherDSL）
(function (global) {
  'use strict';

  const state = {
    notes: [],        // sticky ノード
    relations: [],    // relation ブロック
    connections: [],  // フォールバック接続
    drawings: [],     // drawing / callout / path
    positions: {},    // nodeId -> [x, y]（レイアウト結果キャッシュ）
    layoutMode: 'spring', // spring | tree-lr | tree-tb | timeline
  };

  function loadDSL(text) {
    const parsed = parseAetherDSL(text);
    state.notes = parsed.notes || [];
    state.relations = parsed.relations || [];
    state.connections = parsed.connections || [];
    state.drawings = parsed.drawings || [];
    state.positions = {};
    return parsed;
  }

  function getNotes() { return state.notes; }
  function getRelations() { return state.relations; }
  function getConnections() { return state.connections; }
  function getDrawings() { return state.drawings; }

  function setPosition(nodeId, x, y) { state.positions[nodeId] = [x, y]; }
  function getPosition(nodeId) { return state.positions[nodeId]; }
  function clearPositions() { state.positions = {}; }

  function setLayoutMode(mode) { state.layoutMode = mode; }
  function getLayoutMode() { return state.layoutMode; }

  global.Aether3DState = {
    state,
    loadDSL,
    getNotes,
    getRelations,
    getConnections,
    getDrawings,
    setPosition,
    getPosition,
    clearPositions,
    setLayoutMode,
    getLayoutMode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
