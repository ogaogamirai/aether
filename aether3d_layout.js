// Aether3D Layout — Phase 1 レイアウトエンジン
// 4大レイアウト: spring / tree-lr / tree-tb / timeline
// pos あり（layoutX/layoutY を持つノード）は固定。なしは自動配置。
(function (global) {
  'use strict';

  const SPRING_STEPS = 100;

  function hasFixedPos(note) {
    return typeof note.layoutX === 'number' && typeof note.layoutY === 'number';
  }

  // ノード間のエッジ集合を作る（relations + connections）
  function buildEdges(notes, relations, connections) {
    const ids = new Set(notes.map(n => n.id));
    const edges = [];
    (relations || []).forEach(r => {
      if (ids.has(r.from) && ids.has(r.to)) edges.push([r.from, r.to]);
    });
    (connections || []).forEach(c => {
      if (ids.has(c.source) && ids.has(c.target)) edges.push([c.source, c.target]);
    });
    return edges;
  }

  // 1. 星団・銀河型（Force-Directed）
  function layoutSpring(notes, relations, connections) {
    const positions = {};
    const ids = notes.map(n => n.id);
    const edges = buildEdges(notes, relations, connections);
    const fixed = new Set(notes.filter(hasFixedPos).map(n => n.id));

    notes.forEach(n => {
      if (hasFixedPos(n)) {
        positions[n.id] = [n.layoutX, n.layoutY];
      } else {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 300;
        positions[n.id] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
      }
    });

    for (let step = 0; step < SPRING_STEPS; step++) {
      const forces = {};
      ids.forEach(id => { forces[id] = [0, 0]; });

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i], b = ids[j];
          const dx = positions[a][0] - positions[b][0];
          const dy = positions[a][1] - positions[b][1];
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(distSq) || 1;
          const repel = 5000 / (distSq + 50);
          const fx = (dx / dist) * repel;
          const fy = (dy / dist) * repel;
          forces[a][0] += fx; forces[a][1] += fy;
          forces[b][0] -= fx; forces[b][1] -= fy;
        }
      }

      edges.forEach(([a, b]) => {
        const dx = positions[b][0] - positions[a][0];
        const dy = positions[b][1] - positions[a][1];
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const attract = 0.03 * (dist - 200);
        const fx = (dx / dist) * attract;
        const fy = (dy / dist) * attract;
        forces[a][0] += fx; forces[a][1] += fy;
        forces[b][0] -= fx; forces[b][1] -= fy;
      });

      const cooling = 1 - step / SPRING_STEPS;
      ids.forEach(id => {
        if (fixed.has(id)) return;
        positions[id][0] += forces[id][0] * cooling;
        positions[id][1] += forces[id][1] * cooling;
      });
    }

    return positions;
  }

  // relation の from -> to で深さ（レベル）を求める
  function computeLevels(notes, edges) {
    const levels = {};
    const children = {};
    const indegree = {};
    notes.forEach(n => { children[n.id] = []; indegree[n.id] = 0; });
    edges.forEach(([a, b]) => {
      if (children[a] && children[b]) {
        children[a].push(b);
        indegree[b]++;
      }
    });

    const queue = [];
    notes.forEach(n => { if (indegree[n.id] === 0) { levels[n.id] = 0; queue.push(n.id); } });
    if (queue.length === 0) {
      notes.forEach(n => { levels[n.id] = 0; queue.push(n.id); });
    }

    while (queue.length > 0) {
      const id = queue.shift();
      (children[id] || []).forEach(child => {
        if (levels[child] === undefined) {
          levels[child] = levels[id] + 1;
          queue.push(child);
        }
      });
    }
    notes.forEach(n => { if (levels[n.id] === undefined) levels[n.id] = 0; });
    return levels;
  }

  // 2/3. ツリー（tree-lr: 左→右 / tree-tb: 上→下）
  function layoutTree(notes, relations, connections, vertical) {
    const positions = {};
    const edges = buildEdges(notes, relations, connections);
    const levels = computeLevels(notes, edges);

    const levelGroups = {};
    notes.forEach(n => {
      const lv = levels[n.id];
      if (!levelGroups[lv]) levelGroups[lv] = [];
      levelGroups[lv].push(n.id);
    });

    const GAP_X = 260;
    const GAP_Y = 160;
    Object.keys(levelGroups).sort((a, b) => a - b).forEach(lv => {
      const group = levelGroups[lv];
      group.forEach((id, i) => {
        const cx = Number(lv) * GAP_X;
        const cy = (i - (group.length - 1) / 2) * GAP_Y;
        positions[id] = vertical ? [cy, cx] : [cx, cy];
      });
    });

    notes.forEach(n => {
      if (hasFixedPos(n)) positions[n.id] = [n.layoutX, n.layoutY];
    });

    return positions;
  }

  // 4. タイムライン（time 属性順）
  function layoutTimeline(notes) {
    const positions = {};
    const withTime = notes.filter(n => n.time);
    const withoutTime = notes.filter(n => !n.time);

    withTime.sort((a, b) =>
      String(a.time || '').localeCompare(String(b.time || ''), undefined, { numeric: true }));

    const GAP_X = 280;
    let index = 0;
    withTime.forEach(n => { positions[n.id] = [index * GAP_X, 0]; index++; });
    withoutTime.forEach(n => { positions[n.id] = [index * GAP_X, 260]; index++; });

    notes.forEach(n => {
      if (hasFixedPos(n)) positions[n.id] = [n.layoutX, n.layoutY];
    });

    return positions;
  }

  function computeLayout(notes, relations, connections, mode) {
    switch (mode) {
      case 'tree-lr': return layoutTree(notes, relations, connections, false);
      case 'tree-tb': return layoutTree(notes, relations, connections, true);
      case 'timeline': return layoutTimeline(notes);
      case 'spring':
      default: return layoutSpring(notes, relations, connections);
    }
  }

  global.Aether3DLayout = {
    hasFixedPos,
    computeLayout,
  };
})(typeof window !== 'undefined' ? window : globalThis);
