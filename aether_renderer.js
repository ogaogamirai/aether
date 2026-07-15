// Aether Canvas Renderer v4.0

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
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    el.id = `note-${note.id}`;

    // Apply active tag dimmed state immediately on render
    if (window.activeTag !== null) {
      const matches = note.tags && note.tags.includes(window.activeTag);
      if (!matches) el.classList.add('dimmed');
    }

    el.innerHTML = `
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
    }
  });
}

function drawLineBetween(source, target, strokeColor, strokeWidth, dashArray = '') {
  const sx = source.x + NOTE_HALF_W;
  const sy = source.y + NOTE_HALF_H;
  const tx = target.x + NOTE_HALF_W;
  const ty = target.y + NOTE_HALF_H;

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', sx);
  line.setAttribute('y1', sy);
  line.setAttribute('x2', tx);
  line.setAttribute('y2', ty);
  line.setAttribute('stroke', strokeColor);
  line.setAttribute('stroke-width', strokeWidth);
  if (dashArray) line.setAttribute('stroke-dasharray', dashArray);
  
  // タグフィルターによる半透明化
  if (window.activeTag !== null) {
    const sourceHas = source.tags && source.tags.includes(window.activeTag);
    const targetHas = target.tags && target.tags.includes(window.activeTag);
    if (!sourceHas || !targetHas) {
      line.setAttribute('class', 'dimmed');
    }
  }
  
  appendToSvg(line);
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

// Draw semantic relation edges v3.0 (conflict, influence, similarity, default)
function drawRelation(rel) {
  const source = notes.find(n => n.id === rel.from);
  const target = notes.find(n => n.id === rel.to);
  if (!source || !target) return;

  const sx = source.x + NOTE_HALF_W;
  const sy = source.y + NOTE_HALF_H;
  const tx = target.x + NOTE_HALF_W;
  const ty = target.y + NOTE_HALF_H;

  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return;

  let colorHex = '#3b82f6';
  if (rel.color === 'purple') colorHex = '#8b5cf6';
  else if (rel.color === 'green') colorHex = '#10b981';
  else if (rel.color === 'pink') colorHex = '#ec4899';
  else if (rel.color === 'yellow') colorHex = '#eab308';
  else if (rel.color === 'red' || rel.type === 'conflict') colorHex = '#ef4444';

  // タグフィルターとの合致判定
  const matches = (window.activeTag === null) || 
                  (rel.tags && rel.tags.includes(window.activeTag)) || 
                  ((source.tags && source.tags.includes(window.activeTag)) && (target.tags && target.tags.includes(window.activeTag)));
  const isDimmed = !matches;

  if (rel.type === 'conflict') {
    const steps = 12;
    let d = `M ${sx} ${sy}`;
    const nx = -dy / dist;
    const ny = dx / dist;

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = sx + dx * t;
      const py = sy + dy * t;
      const offset = (i % 2 === 0 ? 8 : -8);
      d += ` L ${px + nx * offset} ${py + ny * offset}`;
    }
    d += ` L ${tx} ${ty}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', colorHex);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', '2');
    if (isDimmed) path.setAttribute('class', 'dimmed');
    appendToSvg(path);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', sx + dx/2);
    text.setAttribute('y', sy + dy/2 + 4);
    text.setAttribute('font-size', '14px');
    text.setAttribute('text-anchor', 'middle');
    text.textContent = '⚡';
    if (isDimmed) text.setAttribute('class', 'dimmed');
    appendToSvg(text);

    if (rel.label) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', sx + dx/2);
      label.setAttribute('y', sy + dy/2 - 12);
      label.setAttribute('fill', '#ef4444');
      label.setAttribute('font-size', '10px');
      label.setAttribute('font-weight', '600');
      label.setAttribute('font-family', 'var(--font-display)');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = rel.label;
      if (isDimmed) label.setAttribute('class', 'dimmed');
      appendToSvg(label);
    }
  } 
  else if (rel.type === 'influence') {
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    const nx = -dy / dist;
    const ny = dx / dist;
    const cx = mx + nx * 35;
    const cy = my + ny * 35;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const pathData = `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', colorHex);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-width', '3.5');
    path.setAttribute('stroke-dasharray', '8 4');
    if (isDimmed) path.setAttribute('class', 'dimmed');
    
    const markerId = `arrow-${rel.color}` || 'arrow-default';
    path.setAttribute('marker-end', `url(#${markerId})`);
    appendToSvg(path);

    if (rel.label) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', mx + nx * 20);
      text.setAttribute('y', my + ny * 20 - 5);
      text.setAttribute('fill', colorHex);
      text.setAttribute('font-size', '10px');
      text.setAttribute('font-family', 'var(--font-display)');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = rel.label;
      if (isDimmed) text.setAttribute('class', 'dimmed');
      appendToSvg(text);
    }
  }
  else if (rel.type === 'similarity') {
    const nx = -dy / dist;
    const ny = dx / dist;
    
    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', sx + nx * 4);
    line1.setAttribute('y1', sy + ny * 4);
    line1.setAttribute('x2', tx + nx * 4);
    line1.setAttribute('y2', ty + ny * 4);
    line1.setAttribute('stroke', colorHex);
    line1.setAttribute('stroke-width', '1.5');
    if (isDimmed) line1.setAttribute('class', 'dimmed');
    appendToSvg(line1);

    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', sx - nx * 4);
    line2.setAttribute('y1', sy - ny * 4);
    line2.setAttribute('x2', tx - nx * 4);
    line2.setAttribute('y2', ty - ny * 4);
    line2.setAttribute('stroke', colorHex);
    line2.setAttribute('stroke-width', '1.5');
    if (isDimmed) line2.setAttribute('class', 'dimmed');
    appendToSvg(line2);

    if (rel.label) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', sx + dx/2 - nx * 10);
      text.setAttribute('y', sy + dy/2 - ny * 10 + 3);
      text.setAttribute('fill', themeColor('--connection-label-muted', 'rgba(255,255,255,0.6)'));
      text.setAttribute('font-size', '9px');
      text.setAttribute('font-family', 'var(--font-display)');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = rel.label;
      if (isDimmed) text.setAttribute('class', 'dimmed');
      appendToSvg(text);
    }
  }
  else {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    path.setAttribute('x1', sx);
    path.setAttribute('y1', sy);
    path.setAttribute('x2', tx);
    path.setAttribute('y2', ty);
    path.setAttribute('stroke', colorHex);
    path.setAttribute('stroke-width', '2');
    if (isDimmed) path.setAttribute('class', 'dimmed');
    const markerId = `arrow-${rel.color}` || 'arrow-default';
    path.setAttribute('marker-end', `url(#${markerId})`);
    appendToSvg(path);

    if (rel.label) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', sx + dx/2);
      text.setAttribute('y', sy + dy/2 - 6);
      text.setAttribute('fill', themeColor('--connection-label-muted', 'rgba(255,255,255,0.6)'));
      text.setAttribute('font-size', '10px');
      text.setAttribute('font-family', 'var(--font-display)');
      text.setAttribute('text-anchor', 'middle');
      text.textContent = rel.label;
      if (isDimmed) text.setAttribute('class', 'dimmed');
      appendToSvg(text);
    }
  }
}

// タグフィルターバーを動的に再構成する
function updateTagsFilterBar(tags) {
  const bar = document.getElementById('tags-filter-bar');
  bar.innerHTML = '';
  if (tags.length === 0) return;

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
}
