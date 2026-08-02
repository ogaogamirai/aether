// Aether Canvas Renderer v4.0.39 — arc edges use layout coords (match keyboard nav)
window.__AETHER_RENDERER_BUILD__ = '4.0.39-arc-layout-nav';

// Predefined beautiful SVG vector paths for icons (Approach A)
const PRESET_ICONS = {
  brain: "M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l1.9-1.9C9.07 19.57 10.48 20 12 20c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 15c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm-1-8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5c0 .66-.43 1.21-1.03 1.4-.08.03-.15.07-.22.12-.17.13-.25.33-.25.56v.42c0 .55-.45 1-1 1s-1-.45-1-1v-.92c0-.52.27-.99.71-1.25.13-.08.23-.2.29-.33.09-.23.09-.54-.09-.76-.09-.11-.22-.17-.36-.17-.28 0-.5.22-.5.5 0 .55-.45 1-1 1s-1-.45-1-1zm1 7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z",
  database: "M12 2C6.48 2 2 4 2 6.5S6.48 11 12 11s10-2 10-4.5S17.52 2 12 2zm0 11c-5.52 0-10-1.5-10-3.5v3.5C2 15.5 6.48 17.5 12 17.5s10-2 10-4v-3.5c0 2-4.48 3.5-10 3.5zm0 6.5c-5.52 0-10-1.5-10-3.5v3.5C2 21 6.48 23 12 23s10-2 10-4v-3.5c0 2-4.48 3.5-10 3.5z",
  ship: "M2 17h20c0 2.2-1.8 4-4 4H6c-2.2 0-4-1.8-4-4zm10-15l8 12H4l8-12z",
  lightbulb: "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1c-.03.02-.06.05-.08.08L13 14.25V16h-2v-1.75l-.77-.57c-.03-.02-.05-.05-.08-.08C8.97 12.54 8 10.9 8 9c0-2.21 1.79-4 4-4s4 1.79 4 4c0 1.9-.97 3.54-2.15 4.6z",
  shield: "M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm6 9.09c0 4.02-2.58 7.78-6 8.91-3.42-1.13-6-4.89-6-8.91V6.38l6-2.25 6 2.25v4.71z"
};

// sticky note 見た目: style.css width 180 / min-height 140 の半分（中心）
const NOTE_HALF_W = 90;
const NOTE_HALF_H = 70;
const NOTE_W = NOTE_HALF_W * 2; // 180
const NOTE_H = NOTE_HALF_H * 2; // 140

// style.css のテーマ変数を SVG 属性用に解決（setAttribute では var() が効かない環境向け）
function themeColor(cssVar, fallback) {
  try {
    const el = document.body || document.documentElement;
    if (!el) return fallback;
    const v = getComputedStyle(el).getPropertyValue(cssVar).trim();
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}

// 指定された時間(time)が現在アクティブな時間軸(activeTime)において表示可能か判定
// 累積的な表示：指定された時間軸のインデックス以下であれば表示する
function isTimeVisible(timeProp) {
  if (window.activeTime === null || !timeProp) return true;
  
  const activeIdx = window.timeSteps.indexOf(window.activeTime);
  const targetIdx = window.timeSteps.indexOf(timeProp);
  
  if (activeIdx === -1 || targetIdx === -1) return true;
  
  // アクティブな時間軸のインデックス以下であれば表示する（過去から現在への推移を累積表現）
  return targetIdx <= activeIdx;
}

// 配布HTML(eval分割)でも確実にDOMを取る
function resolveNotesContainer() {
  if (typeof refreshCanvasRefs === 'function') refreshCanvasRefs();
  if (typeof getCanvasRefs === 'function') {
    const refs = getCanvasRefs();
    if (refs && refs.notesContainer) return refs.notesContainer;
  }
  return (typeof window !== 'undefined' && window.notesContainer)
    || document.getElementById('notes-container');
}

function resolveSvgLayer() {
  if (typeof refreshCanvasRefs === 'function') refreshCanvasRefs();
  if (typeof getCanvasRefs === 'function') {
    const refs = getCanvasRefs();
    if (refs && refs.svgLayer) return refs.svgLayer;
  }
  return (typeof window !== 'undefined' && window.svgLayer)
    || document.getElementById('svg-layer');
}

function appendToSvg(node) {
  const layer = resolveSvgLayer();
  if (!layer || !node) return;
  layer.appendChild(node);
}

// Render nodes & connections on screen
function renderCanvas() {
  if (typeof setupCanvasInteractions === 'function') setupCanvasInteractions();
  const notesContainer = resolveNotesContainer();
  if (!notesContainer) {
    console.error('[Aether] notesContainer missing');
    return;
  }
  notesContainer.innerHTML = '';
  
  // Render Notes
  notes.forEach(note => {
    // 時間フィルターによる表示・非表示の適用
    if (!isTimeVisible(note.time)) return;

    const el = document.createElement('div');
    el.className = `sticky-note ${note.color}`;
    if (note.tone) el.classList.add(note.tone);
    const roleClass = normalizeStickyRole(note.role);
    if (roleClass) el.classList.add('role-' + roleClass);
    const confClass = normalizeConfidence(note.confidence);
    if (confClass) el.classList.add('conf-' + confClass);
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    el.id = `note-${note.id}`;

    // Apply active tag dimmed state immediately on render
    if (window.activeTag !== null) {
      const matches = note.tags && note.tags.includes(window.activeTag);
      if (!matches) el.classList.add('dimmed');
    }

    if (window.focusedNoteId && String(note.id) === String(window.focusedNoteId)) {
      el.classList.add('focused');
    }

    const badges = [];
    if (roleClass) badges.push('<span class="sticky-badge role-badge">' + roleClass + '</span>');
    if (confClass) badges.push('<span class="sticky-badge conf-badge">' + confClass + '</span>');
    const badgesHtml = badges.length
      ? '<div class="sticky-badges">' + badges.join('') + '</div>'
      : '';

    el.innerHTML = `
      ${badgesHtml}
      <div class="sticky-content">${note.content}</div>
      <div class="sticky-footer">
        <span>ID: ${note.id}</span>
      </div>
    `;

    let isDraggingNote = false;
    let noteStartX = 0;
    let noteStartY = 0;
    let clickStartX = 0;
    let clickStartY = 0;

    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      clickStartX = e.clientX;
      clickStartY = e.clientY;
      // スマホキャンバス: 付箋ドラッグは無効（ノード切替は上部ストリップで行う）
      if (typeof isMobileCanvasMode === 'function' && isMobileCanvasMode()) {
        isDraggingNote = false;
        el.style.cursor = 'pointer';
        return;
      }
      // LIVE中は閲覧のみ: ドラッグ開始せず、mouseup で詳細表示
      if (typeof isAetherLiveMode === 'function' && isAetherLiveMode()) {
        isDraggingNote = false;
        clickStartX = e.clientX;
        clickStartY = e.clientY;
        el.style.cursor = 'pointer';
        return;
      }
      isDraggingNote = true;
      el.classList.add('dragging');
      noteStartX = e.clientX - note.x * window.scale;
      noteStartY = e.clientY - note.y * window.scale;
      clickStartX = e.clientX;
      clickStartY = e.clientY;
      el.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (isDraggingNote) {
        if (typeof isAetherLiveMode === 'function' && isAetherLiveMode()) {
          isDraggingNote = false;
          el.classList.remove('dragging');
          el.style.cursor = 'pointer';
          return;
        }
        note.x = (e.clientX - noteStartX) / window.scale;
        note.y = (e.clientY - noteStartY) / window.scale;
        el.style.left = `${note.x}px`;
        el.style.top = `${note.y}px`;
        drawAllShapes();
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (typeof isAetherLiveMode === 'function' && isAetherLiveMode()) {
        if (isDraggingNote) {
          isDraggingNote = false;
          el.classList.remove('dragging');
        }
        const dx = e.clientX - clickStartX;
        const dy = e.clientY - clickStartY;
        if (Math.sqrt(dx * dx + dy * dy) < 8) {
          showNodeDetails(note);
        }
        el.style.cursor = 'pointer';
        return;
      }
      if (isDraggingNote) {
        isDraggingNote = false;
        el.classList.remove('dragging');
        el.style.cursor = 'grab';

        // ドラッグの移動距離が4px未満なら「クリック」とみなして詳細情報を表示
        const dx = e.clientX - clickStartX;
        const dy = e.clientY - clickStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 4) {
          showNodeDetails(note);
        } else {
          // フェーズ1: ドラッグした付箋の座標のみ差分保存（全体DSL再構築しない）
          if (typeof updateNotePositionInDB === 'function') {
            updateNotePositionInDB(note.id, note.x, note.y);
          } else if (typeof saveCanvasState === 'function') {
            saveCanvasState();
          }
        }
      }
    });

    let touchStartX = 0;
    let touchStartY = 0;
    el.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isDraggingNote = false;
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      e.stopPropagation();
      if (e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.sqrt(dx * dx + dy * dy) < 12) {
        showNodeDetails(note);
      }
    }, { passive: true });

    el.addEventListener('mouseup', (e) => {
      if (typeof isMobileCanvasMode !== 'function' || !isMobileCanvasMode()) return;
      e.stopPropagation();
      const dx = e.clientX - clickStartX;
      const dy = e.clientY - clickStartY;
      if (Math.sqrt(dx * dx + dy * dy) < 8) {
        showNodeDetails(note);
      }
    });

    notesContainer.appendChild(el);
  });

  drawAllShapes();
}

// Draw all elements on SVG layer
function drawAllShapes() {
  const svgLayer = resolveSvgLayer();
  if (!svgLayer) {
    console.error('[Aether] svgLayer missing');
    return;
  }
  // Preserve marker/filter defs while clearing drawn shapes
  const defs = svgLayer.querySelector('defs');
  svgLayer.innerHTML = '';
  if (defs) appendToSvg(defs);
  
  // 1. Draw area backdrops
  drawings.forEach(dw => {
    if (!isTimeVisible(dw.time)) return; // 時間フィルター適用
    if (dw.type === 'circle-area' && dw.targets.length > 0) {
      drawCircleArea(dw);
    }
  });

  // 2. Draw normal connection lines
  connections.forEach(conn => {
    const sourceNote = notes.find(n => n.id === conn.source);
    const targetNote = notes.find(n => n.id === conn.target);

    if (sourceNote && targetNote) {
      // 接続ノードのいずれかが未来のフェーズにある場合は接続線を描画しない
      if (!isTimeVisible(sourceNote.time) || !isTimeVisible(targetNote.time)) return;
      drawLineBetween(sourceNote, targetNote, themeColor('--connection-line', 'rgba(255,255,255,0.15)'), '2', '4 4');
    }
  });

  // 3. Draw relations (New in v3.0 - custom semantic edges)
  relations.forEach(rel => {
    if (!isTimeVisible(rel.time)) return; // 時間フィルター適用
    const source = notes.find(n => n.id === rel.from);
    const target = notes.find(n => n.id === rel.to);
    if (source && target) {
      if (!isTimeVisible(source.time) || !isTimeVisible(target.time)) return;
    }
    drawRelation(rel);
  });

  // 4. Draw advanced drawings (curves/arrows)
  drawings.forEach(dw => {
    if (!isTimeVisible(dw.time)) return; // 時間フィルター適用
    if (dw.type.startsWith('arc') && dw.from && dw.to) {
      const source = notes.find(n => n.id === dw.from);
      const target = notes.find(n => n.id === dw.to);
      if (source && target) {
        if (!isTimeVisible(source.time) || !isTimeVisible(target.time)) return;
      }
      drawCurveArrow(dw);
    } else if (dw.type === 'icon') {
      if (dw.anchor) {
        const anchorNode = notes.find(n => n.id === dw.anchor);
        if (anchorNode && !isTimeVisible(anchorNode.time)) return;
      }
      drawPresetIcon(dw);
    } else if (dw.type === 'callout') {
      drawCallout(dw);
    } else if (dw.type === 'path') {
      drawGuidePath(dw);
    }
  });
}

function isEdgeFocused(sourceId, targetId) {
  var fid = window.focusedNoteId;
  if (!fid) return false;
  return String(sourceId) === String(fid) || String(targetId) === String(fid);
}

function applyEdgeFocusStyle(el, colorHex, baseWidth, sourceId, targetId) {
  if (!el || !isEdgeFocused(sourceId, targetId)) return;
  var group = el;
  if (el.classList && !el.classList.contains('aether-edge') && el.parentElement &&
      el.parentElement.classList && el.parentElement.classList.contains('aether-edge')) {
    group = el.parentElement;
  }
  group.classList.add('edge-focused');
  var path = group.querySelector ? group.querySelector('.aether-edge-path') : el;
  if (!path) path = el;
  path.classList.add('edge-focused');
  path.setAttribute('stroke', themeColor('--edge-highlight', colorHex || 'rgba(59,130,246,0.9)'));
  path.setAttribute('stroke-width', String(Math.max(Number(baseWidth) + 1.2, 3.2)));
  path.setAttribute('opacity', '1');
}

function drawingColorHex(color, fallback) {
  var map = {
    blue: '--accent-blue',
    purple: '--accent-purple',
    green: '--accent-emerald',
    pink: '--accent-pink',
    yellow: '--accent-amber',
    red: '#ef4444',
    orange: '#f59e0b'
  };
  if (map[color] && map[color].startsWith('--')) {
    return themeColor(map[color], fallback || '#3b82f6');
  }
  if (map[color]) return map[color];
  return fallback || themeColor('--accent-blue', '#3b82f6');
}

// Phase K3: callout — 付箋に付く吹き出し注釈
function drawCallout(dw) {
  const anchorId = dw.anchor || '';
  const anchor = notes.find(n => n.id === anchorId);
  if (!anchor) return;
  if (!isTimeVisible(anchor.time)) return;

  const ox = (dw.offset && dw.offset[0] !== undefined) ? Number(dw.offset[0]) : 40;
  const oy = (dw.offset && dw.offset[1] !== undefined) ? Number(dw.offset[1]) : -50;
  const ax = anchor.x + NOTE_HALF_W;
  const ay = anchor.y + 12;
  const bx = ax + (isNaN(ox) ? 40 : ox);
  const by = ay + (isNaN(oy) ? -50 : oy);
  const colorHex = drawingColorHex(dw.color, '#3b82f6');
  const label = String(dw.title || '').slice(0, 80);

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'aether-callout');

  const stem = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  stem.setAttribute('x1', ax);
  stem.setAttribute('y1', ay);
  stem.setAttribute('x2', bx);
  stem.setAttribute('y2', by + 14);
  stem.setAttribute('stroke', colorHex);
  stem.setAttribute('stroke-width', '1.5');
  stem.setAttribute('stroke-dasharray', '3 3');
  group.appendChild(stem);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', bx);
  text.setAttribute('y', by);
  text.setAttribute('font-size', '11px');
  text.setAttribute('font-family', 'var(--font-display), sans-serif');
  text.setAttribute('font-weight', '600');
  text.setAttribute('fill', colorHex);
  text.setAttribute('text-anchor', 'middle');
  text.textContent = label;
  group.appendChild(text);

  // 背景は text 後に測れないため推定幅で矩形
  const padX = 10;
  const padY = 6;
  const estW = Math.max(48, label.length * 7 + padX * 2);
  const estH = 22;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', bx - estW / 2);
  rect.setAttribute('y', by - 14);
  rect.setAttribute('width', estW);
  rect.setAttribute('height', estH);
  rect.setAttribute('rx', '8');
  rect.setAttribute('fill', themeColor('--bg-card', 'rgba(22,26,33,0.85)'));
  rect.setAttribute('stroke', colorHex);
  rect.setAttribute('stroke-width', '1.5');
  group.insertBefore(rect, text);

  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', ax);
  dot.setAttribute('cy', ay);
  dot.setAttribute('r', '3.5');
  dot.setAttribute('fill', colorHex);
  group.appendChild(dot);

  appendToSvg(group);
}

// Phase K3: path — 複数付箋を結ぶ誘導パス
function drawGuidePath(dw) {
  const ids = Array.isArray(dw.targets) ? dw.targets : [];
  if (ids.length < 2) return;

  const pts = [];
  for (let i = 0; i < ids.length; i++) {
    const n = notes.find(note => note.id === ids[i]);
    if (!n || !isTimeVisible(n.time)) return;
    pts.push({ x: n.x + NOTE_HALF_W, y: n.y + NOTE_HALF_H, id: n.id });
  }
  if (pts.length < 2) return;

  const colorHex = drawingColorHex(dw.color, '#8b5cf6');
  const style = String(dw.style || 'pulse').toLowerCase();
  let d = 'M ' + pts[0].x + ' ' + pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    d += ' L ' + pts[i].x + ' ' + pts[i].y;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', colorHex);
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('opacity', '0.85');
  if (style === 'pulse' || style === 'flow' || style === 'forward') {
    path.classList.add('guide-path-pulse');
  } else if (style === 'dashed') {
    path.setAttribute('stroke-dasharray', '10 6');
  }
  appendToSvg(path);

  // ノード上の番号マーカー
  pts.forEach((p, idx) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', p.x);
    c.setAttribute('cy', p.y);
    c.setAttribute('r', '9');
    c.setAttribute('fill', colorHex);
    c.setAttribute('opacity', '0.9');
    appendToSvg(c);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', p.x);
    t.setAttribute('y', p.y + 3.5);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('fill', '#fff');
    t.setAttribute('font-size', '10px');
    t.setAttribute('font-weight', '700');
    t.setAttribute('font-family', 'var(--font-display), sans-serif');
    t.textContent = String(idx + 1);
    appendToSvg(t);
  });

  if (dw.title) {
    const mid = pts[Math.floor((pts.length - 1) / 2)];
    const mid2 = pts[Math.min(pts.length - 1, Math.floor((pts.length - 1) / 2) + 1)];
    const lx = (mid.x + mid2.x) / 2;
    const ly = (mid.y + mid2.y) / 2 - 12;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', lx);
    label.setAttribute('y', ly);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', colorHex);
    label.setAttribute('font-size', '11px');
    label.setAttribute('font-weight', '600');
    label.setAttribute('font-family', 'var(--font-display), sans-serif');
    label.textContent = dw.title;
    appendToSvg(label);
  }
}

function drawLineBetween(source, target, strokeColor, strokeWidth, dashArray) {
  const geo = computeEdgeGeometry(source, target, source.id, target.id);
  const group = createEdgeGroup(source.id, target.id, 'aether-edge-legacy');
  const path = appendArcPath(group, geo, {
    color: strokeColor,
    width: strokeWidth,
    dash: dashArray || ''
  });
  if (window.activeTag !== null) {
    const sourceHas = source.tags && source.tags.includes(window.activeTag);
    const targetHas = target.tags && target.tags.includes(window.activeTag);
    if (!sourceHas || !targetHas) {
      group.classList.add('dimmed');
      path.classList.add('dimmed');
    }
  }
  finalizeEdgeGroup(group, path, strokeColor, strokeWidth, source.id, target.id, false);
}

function drawCurveArrow(dw) {
  const source = notes.find(n => n.id === dw.from);
  const target = notes.find(n => n.id === dw.to);
  if (!source || !target) return;

  const sx = source.x + NOTE_HALF_W;
  const sy = source.y + NOTE_HALF_H;
  const tx = target.x + NOTE_HALF_W;
  const ty = target.y + NOTE_HALF_H;

  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;

  const nx = -dy / dist;
  const ny = dx / dist;

  const curvature = dw.type === 'arc-down' ? -40 : 40;
  const cx = mx + nx * curvature;
  const cy = my + ny * curvature;

  const pathData = `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  
  let colorHex = '#3b82f6';
  if (dw.color === 'purple') colorHex = '#8b5cf6';
  else if (dw.color === 'green') colorHex = '#10b981';
  else if (dw.color === 'pink') colorHex = '#ec4899';
  else if (dw.color === 'yellow') colorHex = '#eab308';
  
  path.setAttribute('stroke', colorHex);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-width', '2.5');
  if (dw.style === 'dashed') {
    path.setAttribute('stroke-dasharray', '5 5');
  }
  
  const markerId = `arrow-${dw.color}` || 'arrow-default';
  path.setAttribute('marker-end', `url(#${markerId})`);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', mx + nx * (curvature * 0.6));
  text.setAttribute('y', my + ny * (curvature * 0.6) - 5);
  text.setAttribute('fill', themeColor('--connection-label', 'rgba(255,255,255,0.7)'));
  text.setAttribute('font-size', '10px');
  text.setAttribute('font-family', 'var(--font-display)');
  text.setAttribute('text-anchor', 'middle');
  text.textContent = dw.title;

  // タグフィルターによる半透明化
  if (window.activeTag !== null) {
    const dwHas = dw.tags && dw.tags.includes(window.activeTag);
    const sourceHas = source.tags && source.tags.includes(window.activeTag);
    const targetHas = target.tags && target.tags.includes(window.activeTag);
    if (!dwHas && (!sourceHas || !targetHas)) {
      path.setAttribute('class', 'dimmed');
      text.setAttribute('class', 'dimmed');
    }
  }

  appendToSvg(path);
  appendToSvg(text);
}

function drawCircleArea(dw) {
  const targets = dw.targets.map(id => notes.find(n => n.id === id)).filter(Boolean);
  if (targets.length === 0) return;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  targets.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.x + NOTE_W > maxX) maxX = n.x + NOTE_W;
    if (n.y < minY) minY = n.y;
    if (n.y + NOTE_H > maxY) maxY = n.y + NOTE_H;
  });

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const width = (maxX - minX) + 80;
  const height = (maxY - minY) + 80;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', cx - width/2);
  rect.setAttribute('y', cy - height/2);
  rect.setAttribute('width', width);
  rect.setAttribute('height', height);
  rect.setAttribute('rx', '80');
  rect.setAttribute('ry', '80');
  
  let colorHex = 'rgba(59, 130, 246, 0.20)';
  if (dw.color === 'purple') colorHex = 'rgba(139, 92, 246, 0.20)';
  else if (dw.color === 'green') colorHex = 'rgba(16, 185, 129, 0.20)';
  else if (dw.color === 'pink') colorHex = 'rgba(236, 72, 153, 0.20)';
  else if (dw.color === 'yellow') colorHex = 'rgba(234, 179, 8, 0.15)';
  
  rect.setAttribute('fill', colorHex);
  rect.setAttribute('stroke', colorHex.replace('0.20', '0.45').replace('0.15', '0.35'));
  rect.setAttribute('stroke-width', '2');
  rect.setAttribute('filter', 'url(#glow)');

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', cx - width/2 + 25);
  text.setAttribute('y', cy - height/2 + 35);
  text.setAttribute('fill', dw.color === 'yellow' ? 'rgba(234, 179, 8, 0.8)' : colorHex.replace('0.20', '0.8').replace('0.15', '0.7'));
  text.setAttribute('font-size', '14px');
  text.setAttribute('font-weight', '600');
  text.setAttribute('font-family', 'var(--font-display)');
  text.textContent = `✦ ${dw.title}`;

  // タグフィルターによる半透明化
  if (window.activeTag !== null) {
    const dwHas = dw.tags && dw.tags.includes(window.activeTag);
    const anyTargetHas = targets.some(n => n.tags && n.tags.includes(window.activeTag));
    if (!dwHas && !anyTargetHas) {
      rect.setAttribute('class', 'dimmed');
      text.setAttribute('class', 'dimmed');
    }
  }

  appendToSvg(rect);
  appendToSvg(text);
}

// Draw Preset Vector Icon (Approach A - anchor relative / absolute fallback)
function drawPresetIcon(dw) {
  let x = 100, y = 100;
  
  // Calculate coordinates: Anchor Node + Offset (relative) OR absolute coordinates
  if (dw.anchor) {
    const anchorNode = notes.find(n => n.id === dw.anchor);
    if (anchorNode) {
      const ax = anchorNode.x + NOTE_HALF_W;
      const ay = anchorNode.y + NOTE_HALF_H;
      x = ax + (dw.offset[0] || 0) - 24;
      y = ay + (dw.offset[1] || 0) - 24;
    }
  } else if (dw.pos && dw.pos.length === 2) {
    x = dw.pos[0] - 24;
    y = dw.pos[1] - 24;
  }

  const svgPath = PRESET_ICONS[dw.style] || PRESET_ICONS.brain;
  
  let colorHex = '#3b82f6';
  if (dw.color === 'purple') colorHex = '#8b5cf6';
  else if (dw.color === 'green') colorHex = '#10b981';
  else if (dw.color === 'pink') colorHex = '#ec4899';
  else if (dw.color === 'yellow') colorHex = '#eab308';

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('transform', `translate(${x}, ${y})`);
  
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '48');
  rect.setAttribute('height', '48');
  rect.setAttribute('rx', '12');
  rect.setAttribute('fill', 'rgba(22, 26, 33, 0.8)');
  rect.setAttribute('stroke', colorHex);
  rect.setAttribute('stroke-width', '1.5');
  rect.setAttribute('filter', 'url(#glow)');
  
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', svgPath);
  path.setAttribute('fill', colorHex);
  path.setAttribute('transform', 'translate(10, 10) scale(1.15)');

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', '24');
  text.setAttribute('y', '62');
  text.setAttribute('fill', themeColor('--connection-label', 'rgba(255,255,255,0.7)'));
  text.setAttribute('font-size', '10px');
  text.setAttribute('font-weight', '600');
  text.setAttribute('font-family', 'var(--font-display)');
  text.setAttribute('text-anchor', 'middle');
  text.textContent = dw.title;

  // タグフィルターによる半透明化
  if (window.activeTag !== null) {
    const dwHas = dw.tags && dw.tags.includes(window.activeTag);
    const anchorNode = notes.find(n => n.id === dw.anchor);
    const anchorHas = anchorNode && anchorNode.tags && anchorNode.tags.includes(window.activeTag);
    if (!dwHas && !anchorHas) {
      group.setAttribute('class', 'dimmed');
    }
  }

  group.appendChild(rect);
  group.appendChild(path);
  group.appendChild(text);
  appendToSvg(group);
}

function normalizeStickyRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (!r) return '';
  if (r === 'claim' || r === 'evidence' || r === 'caveat' || r === 'question') return r;
  return '';
}

function normalizeConfidence(conf) {
  if (conf === undefined || conf === null || conf === '') return '';
  const s = String(conf).trim().toLowerCase();
  if (s === 'high' || s === 'mid' || s === 'medium' || s === 'low') {
    return s === 'medium' ? 'mid' : s;
  }
  const n = Number(s);
  if (!isNaN(n)) {
    if (n >= 0.67) return 'high';
    if (n >= 0.34) return 'mid';
    return 'low';
  }
  return '';
}

function relationStrokeWidth(rel, base) {
  const b = typeof base === 'number' ? base : 2;
  const w = Number(rel && rel.weight);
  if (isNaN(w) || w <= 0) return b;
  // weight 1..5 → 倍率 0.75..2.0（既存 type の base を尊重）
  const clamped = Math.max(1, Math.min(5, w));
  return Math.round((b * (0.5 + clamped * 0.3)) * 10) / 10;
}

function applyRelationFlow(el, rel) {
  const flow = String((rel && rel.flow) || '').trim().toLowerCase();
  if (!flow || flow === 'none' || flow === 'off') return;
  if (flow === 'forward' || flow === 'true' || flow === '1' || flow === 'yes') {
    el.classList.add('rel-flow');
  }
}

// ---------------------------------------------------------------------------
// Arc edge routing v1 — 辺接続 + 符号付き二次ベジェ + フォーカス時ラベル
// ---------------------------------------------------------------------------
function getNoteLayoutX(note) {
  if (typeof window.getNoteLayoutX === 'function') return window.getNoteLayoutX(note);
  if (!note) return 0;
  var lx = note.layoutX;
  if (lx != null && isFinite(Number(lx))) return Number(lx);
  return Number(note.x) || 0;
}

function getNoteLayoutY(note) {
  if (typeof window.getNoteLayoutY === 'function') return window.getNoteLayoutY(note);
  if (!note) return 0;
  var ly = note.layoutY;
  if (ly != null && isFinite(Number(ly))) return Number(ly);
  return Number(note.y) || 0;
}

function getNoteCenter(note) {
  return { x: getNoteLayoutX(note) + NOTE_HALF_W, y: getNoteLayoutY(note) + NOTE_HALF_H };
}

function getNoteAnchorPoint(note, towardX, towardY) {
  const cx = getNoteLayoutX(note) + NOTE_HALF_W;
  const cy = getNoteLayoutY(note) + NOTE_HALF_H;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return { x: cx, y: cy };
  }
  const inset = 6;
  const hw = NOTE_HALF_W - inset;
  const hh = NOTE_HALF_H - inset;
  const scale = Math.min(
    Math.abs(dx) > 0.001 ? hw / Math.abs(dx) : Infinity,
    Math.abs(dy) > 0.001 ? hh / Math.abs(dy) : Infinity
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function edgeRouteSign(fromId, toId) {
  var s = String(fromId) + '->' + String(toId);
  var h = 0;
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h % 2 === 0 ? 1 : -1;
}

function computeEdgeGeometry(source, target, fromId, toId, opts) {
  opts = opts || {};
  const tc = getNoteCenter(target);
  const sc = getNoteCenter(source);
  const start = getNoteAnchorPoint(source, tc.x, tc.y);
  const end = getNoteAnchorPoint(target, sc.x, sc.y);
  const sx = start.x;
  const sy = start.y;
  const tx = end.x;
  const ty = end.y;
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const nx = -dy / dist;
  const ny = dx / dist;
  const sign = typeof opts.sign === 'number' ? opts.sign : edgeRouteSign(fromId, toId);
  const magnitude = (opts.magnitudeScale || 1) * Math.min(140, Math.max(28, dist * 0.22));
  const cx = mx + nx * magnitude * sign;
  const cy = my + ny * magnitude * sign;
  return {
    sx: sx, sy: sy, tx: tx, ty: ty, cx: cx, cy: cy,
    mx: mx, my: my, nx: nx, ny: ny, dist: dist, sign: sign, magnitude: magnitude,
    d: 'M ' + sx + ' ' + sy + ' Q ' + cx + ' ' + cy + ' ' + tx + ' ' + ty
  };
}

function quadPointAt(t, sx, sy, cx, cy, tx, ty) {
  const u = 1 - t;
  return {
    x: u * u * sx + 2 * u * t * cx + t * t * tx,
    y: u * u * sy + 2 * u * t * cy + t * t * ty
  };
}

function createEdgeGroup(sourceId, targetId, extraClass) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'aether-edge' + (extraClass ? ' ' + extraClass : ''));
  g.setAttribute('data-from', String(sourceId));
  g.setAttribute('data-to', String(targetId));
  return g;
}

function appendArcPath(group, geo, options) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', geo.d);
  path.setAttribute('fill', 'none');
  path.setAttribute('class', 'aether-edge-path' + (options.extraClass ? ' ' + options.extraClass : ''));
  path.setAttribute('stroke', options.color);
  path.setAttribute('stroke-width', String(options.width));
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  if (options.dash) path.setAttribute('stroke-dasharray', options.dash);
  if (options.marker) path.setAttribute('marker-end', options.marker);
  if (options.dimmed) path.classList.add('dimmed');
  if (options.flowRel) applyRelationFlow(path, options.flowRel);
  group.appendChild(path);
  return path;
}

function appendEdgeLabel(group, geo, text, color, labelClass) {
  if (!text) return null;
  const mid = quadPointAt(0.5, geo.sx, geo.sy, geo.cx, geo.cy, geo.tx, geo.ty);
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('class', 'aether-edge-label' + (labelClass ? ' ' + labelClass : ''));
  label.setAttribute('x', mid.x);
  label.setAttribute('y', mid.y - 8);
  label.setAttribute('fill', color);
  label.setAttribute('font-size', '11px');
  label.setAttribute('font-weight', '600');
  label.setAttribute('font-family', 'var(--font-display), sans-serif');
  label.setAttribute('text-anchor', 'middle');
  label.textContent = text;
  group.appendChild(label);
  return label;
}

function finalizeEdgeGroup(group, pathEl, colorHex, baseWidth, sourceId, targetId, isDimmed) {
  if (isDimmed && group) group.classList.add('dimmed');
  applyEdgeFocusStyle(group, colorHex, baseWidth, sourceId, targetId);
  appendToSvg(group);
  return pathEl;
}

function relationMarkerId(rel) {
  var valid = ['blue', 'purple', 'green', 'pink', 'yellow'];
  var c = (rel && rel.color) ? String(rel.color) : 'blue';
  if (valid.indexOf(c) >= 0) return 'url(#arrow-' + c + ')';
  return 'url(#arrow-default)';
}

// Draw semantic relation edges v3.0 — arc routing prototype
function drawRelation(rel) {
  const source = notes.find(n => n.id === rel.from);
  const target = notes.find(n => n.id === rel.to);
  if (!source || !target) return;

  let colorHex = drawingColorHex(rel.color, '#3b82f6');
  if (rel.type === 'conflict') colorHex = drawingColorHex('red', '#ef4444');

  const matches = (window.activeTag === null) ||
                  (rel.tags && rel.tags.includes(window.activeTag)) ||
                  ((source.tags && source.tags.includes(window.activeTag)) &&
                   (target.tags && target.tags.includes(window.activeTag)));
  const isDimmed = !matches;
  const relType = String(rel.type || 'default').toLowerCase();
  const group = createEdgeGroup(source.id, target.id, 'aether-edge-' + relType);

  if (relType === 'conflict') {
    const geo = computeEdgeGeometry(source, target, rel.from, rel.to);
    const dx = geo.tx - geo.sx;
    const dy = geo.ty - geo.sy;
    const dist = geo.dist;
    if (dist === 0) return;
    const steps = 12;
    let d = 'M ' + geo.sx + ' ' + geo.sy;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = geo.sx + dx * t;
      const py = geo.sy + dy * t;
      const offset = (i % 2 === 0 ? 8 : -8);
      d += ' L ' + (px + geo.nx * offset) + ' ' + (py + geo.ny * offset);
    }
    d += ' L ' + geo.tx + ' ' + geo.ty;
    geo.d = d;

    const width = relationStrokeWidth(rel, 2.5);
    const path = appendArcPath(group, geo, {
      color: colorHex,
      width: width,
      flowRel: rel
    });
    const bolt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    bolt.setAttribute('class', 'aether-edge-icon');
    bolt.setAttribute('x', geo.mx);
    bolt.setAttribute('y', geo.my + 4);
    bolt.setAttribute('font-size', '15px');
    bolt.setAttribute('text-anchor', 'middle');
    bolt.textContent = '⚡';
    group.appendChild(bolt);
    appendEdgeLabel(group, geo, rel.label, colorHex, 'aether-edge-label-conflict');
    finalizeEdgeGroup(group, path, colorHex, width, source.id, target.id, isDimmed);
    return;
  }

  if (relType === 'similarity' || relType === 'comparison') {
    const geoOuter = computeEdgeGeometry(source, target, rel.from, rel.to, { magnitudeScale: 1.28 });
    const geoInner = computeEdgeGeometry(source, target, rel.from, rel.to, { magnitudeScale: 0.52 });
    const width = relationStrokeWidth(rel, 2.1);
    appendArcPath(group, geoOuter, {
      color: colorHex,
      width: width + 0.5,
      flowRel: rel,
      extraClass: 'aether-edge-sim-outer'
    });
    const innerPath = appendArcPath(group, geoInner, {
      color: colorHex,
      width: Math.max(width - 0.6, 1.1),
      dash: '7 5',
      flowRel: rel,
      extraClass: 'aether-edge-sim-inner'
    });
    appendEdgeLabel(group, geoOuter, rel.label, colorHex);
    finalizeEdgeGroup(group, innerPath, colorHex, width, source.id, target.id, isDimmed);
    return;
  }

  const geo = computeEdgeGeometry(source, target, rel.from, rel.to);
  const width = relationStrokeWidth(rel, relType === 'influence' ? 2.6 : 2.2);
  const dash = relType === 'influence' ? '9 5' : (rel.style === 'dashed' ? '5 5' : '');
  const marker = relationMarkerId(rel);
  const path = appendArcPath(group, geo, {
    color: colorHex,
    width: width,
    dash: dash,
    marker: marker,
    flowRel: rel
  });
  appendEdgeLabel(group, geo, rel.label, colorHex);
  finalizeEdgeGroup(group, path, colorHex, width, source.id, target.id, isDimmed);
}

// タグフィルターバーを動的に再構成する
function updateTagsFilterBar(tags) {
  const bar = document.getElementById('tags-filter-bar');
  bar.innerHTML = '';
  if (tags.length === 0) {
    if (typeof applyTagsBarVisibility === 'function') applyTagsBarVisibility();
    return;
  }

  // 「すべて」チップを追加
  const allChip = document.createElement('div');
  allChip.className = 'tag-chip' + (window.activeTag === null ? ' active' : '');
  allChip.textContent = '✦ すべて';
  allChip.onclick = () => filterByTag(null);
  bar.appendChild(allChip);

  tags.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = 'tag-chip' + (window.activeTag === tag ? ' active' : '');
    chip.textContent = tag;
    chip.onclick = () => filterByTag(tag);
    bar.appendChild(chip);
  });

  if (typeof applyTagsBarVisibility === 'function') applyTagsBarVisibility();
}

// タグによるフィルタリング実行
function filterByTag(tag) {
  window.activeTag = tag;
  
  // チップのスタイル更新
  document.querySelectorAll('.tag-chip').forEach(chip => {
    if ((tag === null && chip.textContent === '✦ すべて') || chip.textContent === tag) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });

  // 1. 付箋ノードのフィルタリング
  notes.forEach(note => {
    const el = document.getElementById(`note-${note.id}`);
    if (!el) return;
    
    const matches = (tag === null) || (note.tags && note.tags.includes(tag));
    if (matches) {
      el.classList.remove('dimmed');
    } else {
      el.classList.add('dimmed');
    }
  });

  // 2. SVG関係線およびカスタム図形の再描画
  drawAllShapes();

  if (typeof afterMobileTagFilterChange === 'function') afterMobileTagFilterChange();
}
