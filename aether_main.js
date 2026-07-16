// Aether Control & Coordination Engine v4.0 (Serverless Super Whiteboard)
// Zero server dependency: IndexedDB autosave + file drag&drop + browser-only export

// Snapshot (0,eval) では free var がスクリプト境界で切れる。
// view / presentation 状態は window を単一の正とする。
function ensureViewGlobals() {
  if (typeof window === 'undefined') return;
  if (typeof window.scale !== 'number') window.scale = 1.0;
  if (typeof window.panX !== 'number') window.panX = 0;
  if (typeof window.panY !== 'number') window.panY = 0;
  if (typeof window.isDragging !== 'boolean') window.isDragging = false;
  if (typeof window.startX !== 'number') window.startX = 0;
  if (typeof window.startY !== 'number') window.startY = 0;
  if (typeof window.activeTag === 'undefined') window.activeTag = null;
  if (typeof window.focusedNoteId === 'undefined') window.focusedNoteId = null;
  if (typeof window.activeTime === 'undefined') window.activeTime = null;
  if (!Array.isArray(window.timeSteps)) window.timeSteps = [];
  if (typeof window.isPresentationMode !== 'boolean') window.isPresentationMode = false;
}
ensureViewGlobals();

// IndexedDB constants moved to aether_storage.js

function syncCanvasGlobals() {
  if (typeof window === 'undefined') return;
  window.notes = notes;
  window.connections = connections;
  window.drawings = drawings;
  window.relations = relations;
}

// Apply parsed DSL to Canvas
// options: { fromLive?: boolean, silent?: boolean, skipIdb?: boolean }
function applyDSL(options) {
  const opts = options || {};
  if (isAetherLiveMode() && !opts.fromLive) {
    showToast('LIVE中はファイルが正本です。キャンバス適用はできません。', 'error');
    return;
  }
  setupCanvasInteractions();
  const input = document.getElementById('dsl-input');
  const text = input ? input.value : '';
  if (typeof parseAetherDSL !== 'function') {
    console.error('[Aether] parseAetherDSL is missing');
    showToast('DSLパーサが読み込まれていません', 'error');
    return;
  }
  const parsed = parseAetherDSL(text);
  const deduped = (typeof dedupeCanvasState === 'function')
    ? dedupeCanvasState(parsed)
    : { state: parsed, renames: [] };
  const state = deduped.state || parsed;
  const renames = deduped.renames || [];

  notes = state.notes || [];
  connections = state.connections || [];
  drawings = state.drawings || [];
  relations = state.relations || [];
  // window へも同期（配布HTMLの共有状態を確実に保つ）
  syncCanvasGlobals();
  window.activeTag = null;
  window.focusedNoteId = null;
  window.activeTime = null;

  if (typeof renderCanvas === 'function') {
    renderCanvas();
  } else {
    console.error('[Aether] renderCanvas is missing');
    showToast('描画エンジンが読み込まれていません', 'error');
    return;
  }

  // 重複リネーム後はエディタDSLも一意ID版へ揃える（IDB legacy と一致）
  // LIVE中は正本ファイル本文を書き換えない（表示用メモのみリネーム結果を載せる）
  if (renames.length && typeof buildDSLFromState === 'function' && input) {
    if (!isAetherLiveMode()) {
      input.value = buildDSLFromState();
    }
  }

  const allTags = new Set();
  notes.forEach(n => { if (n.tags) n.tags.forEach(t => allTags.add(t)); });
  drawings.forEach(d => { if (d.tags) d.tags.forEach(t => allTags.add(t)); });
  relations.forEach(r => { if (r.tags) r.tags.forEach(t => allTags.add(t)); });
  updateTagsFilterBar(Array.from(allTags));

  const allTimes = new Set();
  notes.forEach(n => { if (n.time) allTimes.add(n.time); });
  drawings.forEach(d => { if (d.time) allTimes.add(d.time); });
  relations.forEach(r => { if (r.time) allTimes.add(r.time); });
  updateTimeSlider(Array.from(allTimes));

  if (!opts.silent) {
    if (renames.length) {
      const stickyN = renames.filter(r => r.kind === 'sticky').length;
      const drawingN = renames.filter(r => r.kind === 'drawing').length;
      const edgeN = renames.length - stickyN - drawingN;
      showToast(
        'Aether DSL を適用（重複IDを' + renames.length + '件リネーム: sticky ' + stickyN +
        ' / drawing ' + drawingN + ' / edge ' + edgeN + '）',
        'success'
      );
      console.warn('[Aether] Duplicate IDs renamed before IndexedDB sync:', renames);
    } else {
      showToast(opts.fromLive ? 'LIVE: 監視ファイルを反映しました' : 'Aether DSL を適用しました', 'success');
    }
  } else if (renames.length) {
    console.warn('[Aether] Duplicate IDs renamed (silent):', renames);
  }
  // LIVE中はファイルが正本。IDB は表示キャッシュとしてミラー可だが、手動適用経路は禁止済み
  if (!opts.skipIdb && (typeof window.__AETHER_SNAPSHOT__ === 'undefined' || !window.__AETHER_SNAPSHOT__)) {
    syncBoardStateToDB().catch(err => {
      console.warn('[Aether IndexedDB] Diff sync failed, fallback full save:', err);
      if (!isAetherLiveMode()) saveCanvasState();
    });
  }
}

function updateTimeSlider(times) {
  const containerEl = document.getElementById('time-slider-container');
  const slider = document.getElementById('time-slider');
  const labelsContainer = document.getElementById('time-slider-labels');

  if (times.length === 0) {
    containerEl.style.display = 'none';
    window.timeSteps = [];
    return;
  }

  containerEl.style.display = 'flex';
  window.timeSteps = ['すべて', ...times];
  slider.min = 0;
  slider.max = window.timeSteps.length - 1;
  slider.value = 0;

  labelsContainer.innerHTML = '';
  window.timeSteps.forEach((step, idx) => {
    const label = document.createElement('div');
    label.className = 'time-slider-label' + (idx === 0 ? ' active' : '');
    label.textContent = step;
    label.onclick = () => {
      slider.value = idx;
      handleTimeSlider(idx);
    };
    labelsContainer.appendChild(label);
  });
}

function handleTimeSlider(value) {
  const index = parseInt(value, 10);
  const targetStep = window.timeSteps[index];
  window.activeTime = targetStep === 'すべて' ? null : targetStep;

  const labels = document.querySelectorAll('.time-slider-label');
  labels.forEach((label, idx) => {
    if (idx === index) label.classList.add('active');
    else label.classList.remove('active');
  });

  renderCanvas();
  updatePresentationStepName();

  if (window.isPresentationMode) {
    setTimeout(() => {
      focusPresentationStepView();
    }, 50);
  }
}

function togglePresentationMode(forceState) {
  window.isPresentationMode = (typeof forceState === 'boolean') ? forceState : !window.isPresentationMode;
  
  const controller = document.getElementById('presentation-controller');
  const btn = document.getElementById('pres-mode-btn');
  
  if (window.isPresentationMode) {
    if (controller) controller.style.display = 'flex';
    if (btn) btn.classList.add('active');
    
    // Default to the first actual time step (index 1) if available, otherwise 0
    const defaultIdx = window.timeSteps.length > 1 ? 1 : 0;
    const slider = document.getElementById('time-slider');
    if (slider) {
      slider.value = defaultIdx;
    }
    handleTimeSlider(defaultIdx);
    showToast('プレゼンテーションモードを開始しました (Ctrl+← / Ctrl+→ で移動)', 'success');
  } else {
    if (controller) controller.style.display = 'none';
    if (btn) btn.classList.remove('active');
    showToast('プレゼンテーションモードを終了しました', 'success');
    setTimeout(() => {
      fitToView();
    }, 100);
  }
}

function updatePresentationStepName() {
  const nameEl = document.getElementById('pres-step-name');
  if (nameEl) {
    nameEl.textContent = window.activeTime || 'すべて';
  }
}

// 現在ステップで「新たに表示される」付箋（先頭1枚）
function getFirstNoteForCurrentStep() {
  const sourceNotes = (typeof notes !== 'undefined' && notes) ? notes : [];
  if (!sourceNotes.length) return null;

  if (window.activeTime) {
    const newcomers = sourceNotes.filter(n => n.time === window.activeTime);
    if (newcomers.length) return newcomers[0];
  }

  const visible = sourceNotes.filter(n => {
    if (typeof isTimeVisible === 'function') return isTimeVisible(n.time);
    return true;
  });
  return visible[0] || sourceNotes[0] || null;
}

// 上部UI・下部コントローラーを除いた「見えるグラフ領域」の縦中央（ビューポート座標）
function getVisibleCanvasMidViewportY(container) {
  if (!container) return window.innerHeight / 2;
  const cr = container.getBoundingClientRect();

  let topObstacle = cr.top;
  let bottomObstacle = cr.bottom;

  const tags = document.getElementById('tags-filter-bar');
  if (tags && tags.offsetParent !== null && tags.children.length > 0) {
    topObstacle = Math.max(topObstacle, tags.getBoundingClientRect().bottom + 8);
  }
  const slider = document.getElementById('time-slider-container');
  if (slider && slider.offsetParent !== null && getComputedStyle(slider).display !== 'none') {
    topObstacle = Math.max(topObstacle, slider.getBoundingClientRect().bottom + 8);
  }
  const presController = document.getElementById('presentation-controller');
  if (presController && getComputedStyle(presController).display !== 'none') {
    const top = presController.getBoundingClientRect().top - 8;
    if (isFinite(top)) bottomObstacle = Math.min(bottomObstacle, top);
  }

  if (bottomObstacle <= topObstacle + 1) {
    return (cr.top + cr.bottom) / 2;
  }
  return (topObstacle + bottomObstacle) / 2;
}

// 実測ベース: 倍率・横位置は維持し、選択付箋の中心を見える領域の上下中央へ
// panY のみ更新（screenY = worldY * scale + panY のため、差分は panY にそのまま加算）
function centerNoteVertically(note) {
  if (!note) return false;
  const refs = getCanvasRefs();
  if (!refs.container || !refs.transformLayer) return false;

  const el = document.getElementById('note-' + note.id);
  if (!el) return false;

  // 現在の transform を確定させてから実測
  updateTransform();

  const noteRect = el.getBoundingClientRect();
  if (!noteRect.height) return false;

  const noteCenterViewportY = noteRect.top + noteRect.height / 2;
  const desiredMidViewportY = getVisibleCanvasMidViewportY(refs.container);
  const deltaY = desiredMidViewportY - noteCenterViewportY;

  if (!isFinite(deltaY) || Math.abs(deltaY) < 0.5) return true;

  window.panY += deltaY;
  updateTransform();
  return true;
}

// レイアウト確定後に縦中央合わせ（連打時は最後の1回だけ）
function scheduleCenterNoteVertically(note) {
  if (!note || !window.isPresentationMode) return;
  if (window.__aetherCenterRaf) {
    cancelAnimationFrame(window.__aetherCenterRaf);
    window.__aetherCenterRaf = null;
  }
  if (window.__aetherCenterTimer) {
    clearTimeout(window.__aetherCenterTimer);
    window.__aetherCenterTimer = null;
  }
  // 2フレーム + 短遅延: 詳細パネル・幅フィット後の getBoundingClientRect を安定させる
  window.__aetherCenterRaf = requestAnimationFrame(() => {
    window.__aetherCenterRaf = requestAnimationFrame(() => {
      window.__aetherCenterRaf = null;
      centerNoteVertically(note);
      // レイアウト遅延時の再調整（1回）
      window.__aetherCenterTimer = setTimeout(() => {
        window.__aetherCenterTimer = null;
        centerNoteVertically(note);
      }, 40);
    });
  });
}

// プレゼン step 用ビュー:
// - 新規表示の先頭1枚を選択・詳細表示
// - 倍率はホワイトボード横幅に最大フィット（高さはフィットしない）
// - 上下は選択付箋が「見える領域」の縦中央（上下見切れ可）
function focusPresentationStepView() {
  const refs = getCanvasRefs();
  if (!refs.container || !refs.transformLayer) return;

  const panel = document.getElementById('control-panel');
  if (panel && panel.classList.contains('collapsed')) {
    panel.classList.remove('collapsed');
    const btn = document.getElementById('sidebar-toggle-btn');
    if (btn) {
      btn.textContent = '◀';
      btn.title = 'サイドバーを閉じる';
    }
  }

  const focusNote = getFirstNoteForCurrentStep();
  // 詳細タブ切替は幅フィット後のレイアウトに影響するため、先に開いてから測る
  if (focusNote && typeof showNodeDetails === 'function') {
    // showNodeDetails 内の scheduleCenter は幅フィット前なので、後で上書きする
    showNodeDetails(focusNote);
  }

  const applyWidthFitThenCenter = () => {
    const container = getCanvasRefs().container;
    if (!container) return;

    const sourceNotes = (typeof notes !== 'undefined' && notes) ? notes : [];
    const visible = sourceNotes.filter(n => {
      if (typeof isTimeVisible === 'function') return isTimeVisible(n.time);
      return true;
    });
    const targets = visible.length ? visible : sourceNotes;
    if (!targets.length) return;

    const NOTE_W = 180;
    let minX = Infinity;
    let maxX = -Infinity;

    targets.forEach(note => {
      const el = document.getElementById('note-' + note.id);
      const w = el && el.offsetWidth ? el.offsetWidth : NOTE_W;
      minX = Math.min(minX, note.x);
      maxX = Math.max(maxX, note.x + w);
    });

    if (typeof drawings !== 'undefined' && drawings && drawings.length) {
      drawings.forEach(d => {
        if (typeof isTimeVisible === 'function' && d.time && !isTimeVisible(d.time)) return;
        if (d.type === 'icon' && d.anchor) {
          const anchor = sourceNotes.find(n => n.id === d.anchor);
          if (!anchor) return;
          const ox = (d.offset && d.offset[0]) || 0;
          const ix = anchor.x + ox;
          minX = Math.min(minX, ix - 20);
          maxX = Math.max(maxX, ix + 40);
        }
      });
    }

    if (!isFinite(minX) || !isFinite(maxX)) return;

    const contentPad = 16;
    minX -= contentPad;
    maxX += contentPad;
    const contentW = Math.max(1, maxX - minX);

    const sidePad = 16;
    // control-panel は flex 横並びのため clientWidth はホワイトボード幅のみ
    const viewW = Math.max(120, container.clientWidth - sidePad * 2);

    // 横幅のみ最大フィット（縦は centerNoteVertically が担当）
    window.scale = Math.max(0.15, Math.min(3.0, (viewW / contentW) * 0.99));
    window.panX = sidePad + (viewW - contentW * window.scale) / 2 - minX * window.scale;
    updateTransform();

    if (focusNote) {
      scheduleCenterNoteVertically(focusNote);
    }
  };

  // 詳細パネル・サイドバー開閉後のレイアウト確定を2フレーム待つ
  requestAnimationFrame(() => {
    requestAnimationFrame(applyWidthFitThenCenter);
  });
}

function nextPresentationStep() {
  if (!window.timeSteps.length) return;
  const slider = document.getElementById('time-slider');
  if (!slider) return;
  let currentIdx = parseInt(slider.value, 10);
  let nextIdx = currentIdx + 1;
  if (nextIdx >= window.timeSteps.length) {
    nextIdx = 0;
  }
  slider.value = nextIdx;
  handleTimeSlider(nextIdx);
}

function prevPresentationStep() {
  if (!window.timeSteps.length) return;
  const slider = document.getElementById('time-slider');
  if (!slider) return;
  let currentIdx = parseInt(slider.value, 10);
  let prevIdx = currentIdx - 1;
  if (prevIdx < 0) {
    prevIdx = window.timeSteps.length - 1;
  }
  slider.value = prevIdx;
  handleTimeSlider(prevIdx);
}


// キャンバスDOM参照は window 上に置く（配布HTMLの eval 分割でも共有される）
// ※ let は eval 間で共有されないため使わない
function refreshCanvasRefs() {
  window.aetherContainer = document.getElementById('canvas-container');
  window.aetherTransformLayer = document.getElementById('canvas-transform');
  window.aetherNotesContainer = document.getElementById('notes-container');
  window.aetherSvgLayer = document.getElementById('svg-layer');
  // 互換エイリアス（renderer / 既存コード）
  window.container = window.aetherContainer;
  window.transformLayer = window.aetherTransformLayer;
  window.notesContainer = window.aetherNotesContainer;
  window.svgLayer = window.aetherSvgLayer;
  return !!(window.aetherContainer && window.aetherTransformLayer && window.aetherNotesContainer && window.aetherSvgLayer);
}

function getCanvasRefs() {
  if (!window.aetherNotesContainer || !window.aetherSvgLayer) refreshCanvasRefs();
  return {
    container: window.aetherContainer || document.getElementById('canvas-container'),
    transformLayer: window.aetherTransformLayer || document.getElementById('canvas-transform'),
    notesContainer: window.aetherNotesContainer || document.getElementById('notes-container'),
    svgLayer: window.aetherSvgLayer || document.getElementById('svg-layer')
  };
}

let canvasInteractionsReady = false;

function setupCanvasInteractions() {
  if (canvasInteractionsReady) return refreshCanvasRefs();
  if (!refreshCanvasRefs()) return false;

  const refs = getCanvasRefs();
  const containerEl = refs.container;
  const svgEl = refs.svgLayer;
  if (!containerEl) return false;

  containerEl.addEventListener('mousedown', (e) => {
    if (e.target === containerEl || e.target === svgEl) {
      window.isDragging = true;
      window.startX = e.clientX - window.panX;
      window.startY = e.clientY - window.panY;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (window.isDragging) {
      window.panX = e.clientX - window.startX;
      window.panY = e.clientY - window.startY;
      updateTransform();
    }
  });

  window.addEventListener('mouseup', () => {
    window.isDragging = false;
  });

  containerEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = 0.05;
    if (e.deltaY < 0) window.scale = Math.min(window.scale + zoomFactor, 2.0);
    else window.scale = Math.max(window.scale - zoomFactor, 0.15);
    updateTransform();
  });

  canvasInteractionsReady = true;
  return true;
}

// モジュール読込直後にDOMがあれば接続（通常UI）。配布HTMLは onload 側でも再試行する。
setupCanvasInteractions();

function updateTransform() {
  const refs = getCanvasRefs();
  if (!refs.transformLayer) return;
  refs.transformLayer.style.transform = `translate(${window.panX}px, ${window.panY}px) scale(${window.scale})`;
  const indicator = document.getElementById('scale-indicator');
  if (indicator) indicator.textContent = `${Math.round(window.scale * 100)}%`;
}

function zoom(delta) {
  window.scale = Math.max(0.15, Math.min(2.0, window.scale + delta));
  updateTransform();
}

function resetTransform() {
  window.scale = 1.0;
  window.panX = 0;
  window.panY = 0;
  updateTransform();
}

// キャンバス上のオーバーレイUI（タグバー・時系列スライダー等）を避けた表示余白を測る
// ※ control-panel は body flex で whiteboard と横並びのため、clientWidth に既に含まれない。右余白に加算しない。
function getFitChromePadding() {
  // 既定余白: タグバー/スライダー未表示時の最低保証。実測で上書きされる。
  const pad = { top: 40, right: 24, bottom: 36, left: 24 };
  const refs = getCanvasRefs();
  if (!refs.container) return pad;

  const cr = refs.container.getBoundingClientRect();

  const tags = document.getElementById('tags-filter-bar');
  if (tags && tags.offsetParent !== null && tags.children.length > 0) {
    const r = tags.getBoundingClientRect();
    pad.top = Math.max(pad.top, Math.ceil(r.bottom - cr.top) + 16);
  }

  const slider = document.getElementById('time-slider-container');
  if (slider && slider.offsetParent !== null && getComputedStyle(slider).display !== 'none') {
    const r = slider.getBoundingClientRect();
    pad.top = Math.max(pad.top, Math.ceil(r.bottom - cr.top) + 16);
  }

  // プレゼンコントローラーが表示されている場合、下側余白を確保して重なりを避ける
  // pres bottom 100: #presentation-controller の高さ+マージン相当
  const presController = document.getElementById('presentation-controller');
  if (presController && getComputedStyle(presController).display !== 'none') {
    pad.bottom = Math.max(pad.bottom, 100);
  }

  return pad;
}


// グラフ全体を、オーバーレイUIに重ならない領域へ収めて表示（Fキー）
function fitToView() {
  const refs = getCanvasRefs();
  if (!refs.container || !refs.transformLayer) {
    resetTransform();
    return;
  }

  const sourceNotes = (typeof notes !== 'undefined' && notes && notes.length)
    ? notes
    : [];
  if (sourceNotes.length === 0) {
    resetTransform();
    return;
  }

  const visible = sourceNotes.filter(n => {
    if (typeof isTimeVisible === 'function') return isTimeVisible(n.time);
    return true;
  });
  const targets = visible.length ? visible : sourceNotes;

  const NOTE_W = 180;
  const NOTE_H = 160;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  targets.forEach(note => {
    const el = document.getElementById('note-' + note.id);
    const w = el && el.offsetWidth ? el.offsetWidth : NOTE_W;
    const h = el && el.offsetHeight ? el.offsetHeight : NOTE_H;
    minX = Math.min(minX, note.x);
    minY = Math.min(minY, note.y);
    maxX = Math.max(maxX, note.x + w);
    maxY = Math.max(maxY, note.y + h);
  });

  // 描画オブジェクト（円領域・アイコン）も境界に含める
  if (typeof drawings !== 'undefined' && drawings && drawings.length) {
    drawings.forEach(d => {
      if (typeof isTimeVisible === 'function' && d.time && !isTimeVisible(d.time)) return;
      if (d.type === 'icon' && d.anchor) {
        const anchor = sourceNotes.find(n => n.id === d.anchor);
        if (!anchor) return;
        const ox = (d.offset && d.offset[0]) || 0;
        const oy = (d.offset && d.offset[1]) || 0;
        const ix = anchor.x + ox;
        const iy = anchor.y + oy;
        minX = Math.min(minX, ix - 20);
        minY = Math.min(minY, iy - 20);
        maxX = Math.max(maxX, ix + 40);
        maxY = Math.max(maxY, iy + 40);
      }
    });
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    resetTransform();
    return;
  }

  // わずかな余白をコンテンツ側にも持たせる
  const contentPad = 24;
  minX -= contentPad;
  minY -= contentPad;
  maxX += contentPad;
  maxY += contentPad;

  const chrome = getFitChromePadding();
  const viewW = Math.max(120, refs.container.clientWidth - chrome.left - chrome.right);
  const viewH = Math.max(120, refs.container.clientHeight - chrome.top - chrome.bottom);
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);

  const fitScale = Math.min(viewW / contentW, viewH / contentH);
  window.scale = Math.max(0.15, Math.min(2.0, fitScale * 0.98));

  window.panX = chrome.left + (viewW - contentW * window.scale) / 2 - minX * window.scale;
  window.panY = chrome.top + (viewH - contentH * window.scale) / 2 - minY * window.scale;
  updateTransform();
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  const targetBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    return onclick.includes("'" + tabId + "'") || onclick.includes('"' + tabId + '"');
  });
  if (targetBtn) targetBtn.classList.add('active');

  const tabEl = document.getElementById('tab-' + tabId);
  if (tabEl) tabEl.classList.add('active');
}

function parseMarkdownImage(text) {
  if (!text) return '';
  return text.replace(/!\[([^\]]*)\]\s*\((?:<([^>]+)>|([^)]+))\)/g, (match, alt, urlAngle, urlPlain) => {
    const url = String(urlAngle || urlPlain || '').trim();
    return '<img src="' + url + '" alt="' + alt + '" class="details-image">';
  });
}

function parseKaTeX(text) {
  if (!text) return '';
  if (typeof katex === 'undefined') {
    console.error('[Aether Math] KaTeX library not loaded. Check internet connection or CDN URL.');
    return text;
  }

  text = text.replace(/\$\$(.+?)\$\$/gs, (match, math) => {
    try {
      const cleanMath = math.trim().replace(/\\\\/g, '\\');
      return '<div class="math-block">' + katex.renderToString(cleanMath, { displayMode: true, throwOnError: false }) + '</div>';
    } catch (e) {
      console.error('[Aether Math] Block parse error:', e);
      return match;
    }
  });

  text = text.replace(/\$(.+?)\$/g, (match, math) => {
    try {
      const cleanMath = math.trim().replace(/\\\\/g, '\\');
      return katex.renderToString(cleanMath, { displayMode: false, throwOnError: false });
    } catch (e) {
      console.error('[Aether Math] Inline parse error:', e);
      return match;
    }
  });

  return text;
}

function parseMarkdownTable(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let resultHtml = '';
  let inTable = false;
  let rowsHtml = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (line.match(/^\|[\s-|-]*\|$/)) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (!inTable) {
        inTable = true;
        rowsHtml += '<thead><tr>' + cells.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>';
      } else {
        rowsHtml += '<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
      }
    } else {
      if (inTable) {
        inTable = false;
        resultHtml += '<table class="details-table">' + rowsHtml + '</tbody></table>';
        rowsHtml = '';
      }
      resultHtml += line + '<br>';
    }
  }
  if (inTable) {
    resultHtml += '<table class="details-table">' + rowsHtml + '</tbody></table>';
  }
  return resultHtml;
}

function showNodeDetails(note) {
  const detailsContainer = document.getElementById('details-view-container');
  if (!detailsContainer) return;

  if (window.focusedNoteId) {
    const prevEl = document.getElementById('note-' + window.focusedNoteId);
    if (prevEl) prevEl.classList.remove('focused');
  }
  window.focusedNoteId = note.id;
  const currentEl = document.getElementById('note-' + note.id);
  if (currentEl) currentEl.classList.add('focused');

  const tagsHtml = note.tags && note.tags.length > 0
    ? note.tags.map(t => '<span class="details-tag-indicator">' + t + '</span>').join(' ')
    : '<span style="color: var(--text-secondary); font-style: italic;">タグなし</span>';

  const metaBits = [
    '付箋 ID: <strong>' + note.id + '</strong>',
    'カラー: <strong>' + note.color + '</strong>'
  ];
  if (note.role) metaBits.push('role: <strong>' + note.role + '</strong>');
  if (note.confidence !== undefined && note.confidence !== null && String(note.confidence) !== '') {
    metaBits.push('confidence: <strong>' + note.confidence + '</strong>');
  }

  const rawDesc = (note.desc || 'この項目に関する詳細説明はまだ登録されていません。右側のAether DSLタブから "desc" プロパティを記述して適用できます。').replace(/\\n/g, '\n');
  const withImages = parseMarkdownImage(rawDesc);
  const withTable = parseMarkdownTable(withImages);
  const descText = parseKaTeX(withTable);

  detailsContainer.innerHTML =
    '<div class="details-card">' +
      '<div class="details-meta">' +
        metaBits.map(function (b, i) {
          return (i ? '<span>|</span>' : '') + '<span>' + b + '</span>';
        }).join('') +
      '</div>' +
      '<div class="details-title">' + note.content + '</div>' +
      '<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;">' + tagsHtml + '</div>' +
      '<div class="details-desc" style="margin-top: 8px;">' + descText + '</div>' +
    '</div>';

  switchTab('details');

  // プレゼン中は選択変更のたびに縦中央へ（クリック/キーボード共通）
  if (window.isPresentationMode) {
    scheduleCenterNoteVertically(note);
  }
}

// IndexedDB: aether_storage.js

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (window.isPresentationMode) {
      togglePresentationMode(false);
    }
    if (window.focusedNoteId) {
      const el = document.getElementById('note-' + window.focusedNoteId);
      if (el) el.classList.remove('focused');
      window.focusedNoteId = null;

      const detailsContainer = document.getElementById('details-view-container');
      if (detailsContainer) {
        detailsContainer.innerHTML =
          '<div class="details-empty-state" style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">' +
            '<span style="font-size: 2.5rem; display: block; margin-bottom: 12px;">📖</span>' +
            '<p style="font-size: 0.85rem; line-height: 1.5;">キャンバス上の付箋をクリックすると、<br>ここに詳細情報が表示されます。</p>' +
          '</div>';
      }
      switchTab('dsl');
    }
    return;
  }

  // F: グラフ全体表示（入力中は無効）
  // プレゼン中は「横最大 + 選択縦中央」を維持（fitToView の縦縮めを避ける）
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    if (window.isPresentationMode) {
      focusPresentationStepView();
    } else {
      fitToView();
    }
    return;
  }

  // P: プレゼンモード切り替え（入力中は無効）
  if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    togglePresentationMode();
    return;
  }

  // Ctrl + ArrowRight: 次のプレゼンステップ
  if (e.ctrlKey && e.key === 'ArrowRight') {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    nextPresentationStep();
    return;
  }

  // Ctrl + ArrowLeft: 前のプレゼンステップ
  if (e.ctrlKey && e.key === 'ArrowLeft') {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    prevPresentationStep();
    return;
  }

  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return; // Ctrl 等の修飾キーがあればスキップ
    if (isTypingTarget(e.target)) return;
    if (!window.focusedNoteId) return;
    e.preventDefault();

    const currentNote = notes.find(n => n.id === window.focusedNoteId);
    if (!currentNote) return;

    let bestTarget = null;
    let minDistance = Infinity;

    notes.forEach(note => {
      if (note.id === window.focusedNoteId) return;
      // プレゼン中は現在ステップで見えている付箋だけを対象にする
      if (window.isPresentationMode && typeof isTimeVisible === 'function' && !isTimeVisible(note.time)) return;

      const dx = note.x - currentNote.x;
      const dy = note.y - currentNote.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let isCorrectDirection = false;
      if (e.key === 'ArrowRight' && dx > 20 && Math.abs(dy) < Math.abs(dx) * 1.5) isCorrectDirection = true;
      if (e.key === 'ArrowLeft' && dx < -20 && Math.abs(dy) < Math.abs(dx) * 1.5) isCorrectDirection = true;
      if (e.key === 'ArrowDown' && dy > 20 && Math.abs(dx) < Math.abs(dy) * 1.5) isCorrectDirection = true;
      if (e.key === 'ArrowUp' && dy < -20 && Math.abs(dx) < Math.abs(dy) * 1.5) isCorrectDirection = true;

      if (isCorrectDirection && dist < minDistance) {
        minDistance = dist;
        bestTarget = note;
      }
    });

    if (bestTarget) {
      // showNodeDetails 内でプレゼン時の縦中央合わせを行う
      showNodeDetails(bestTarget);
    }
  }
});

function toggleTheme() {
  const body = document.body;
  const themeBtn = document.getElementById('theme-btn');
  body.classList.toggle('light-theme');
  const isLight = body.classList.contains('light-theme');
  if (themeBtn) themeBtn.textContent = isLight ? '🌙' : '☀️';
  if (typeof drawAllShapes === 'function') drawAllShapes();
}

function toggleSidebar() {
  const panel = document.getElementById('control-panel');
  const btn = document.getElementById('sidebar-toggle-btn');
  if (!panel || !btn) return;
  const isCollapsed = panel.classList.toggle('collapsed');
  btn.textContent = isCollapsed ? '▶' : '◀';
  btn.title = isCollapsed ? 'サイドバーを開く' : 'サイドバーを閉じる';
}

function setupDragAndDrop() {
  const dropTarget = document.getElementById('canvas-container');
  if (!dropTarget) return;

  const setDropActive = (active) => {
    if (active) dropTarget.classList.add('drop-active');
    else dropTarget.classList.remove('drop-active');
  };

  ['dragenter', 'dragover'].forEach(evt => {
    dropTarget.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isAetherLiveMode()) return;
      setDropActive(true);
    });
  });

  dropTarget.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
  });

  dropTarget.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    if (isAetherLiveMode()) {
      showToast('LIVE中はドロップ適用できません（監視ファイルが正本）', 'error');
      return;
    }
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;

    const name = (file.name || '').toLowerCase();
    const ok = name.endsWith('.txt') || name.endsWith('.dsl') || name.endsWith('.json') || (file.type && file.type.startsWith('text/'));
    if (!ok) {
      showToast('対応形式: .txt / .dsl / .json', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
      document.getElementById('dsl-input').value = evt.target.result;
      applyDSL();
      showToast('ファイルをドロップ適用しました: ' + file.name, 'success');
    };
    reader.readAsText(file);
  });
}

function showToast(msg, type) {
  console.log('[Aether Toast - ' + type + '] ' + msg);
  let el = document.getElementById('aether-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'aether-toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 16px;border-radius:10px;font-size:0.85rem;font-family:var(--font-display),sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.18);transition:opacity .25s;pointer-events:none;max-width:90vw;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.background = type === 'error' ? 'rgba(239,68,68,0.95)' : 'rgba(16,185,129,0.95)';
  el.style.color = '#fff';
  el.style.opacity = '1';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}

// Portable export: aether_export.js

function triggerImportDSL() {
  if (isAetherLiveMode()) {
    showToast('LIVE中はファイル読込できません（監視を停止してください）', 'error');
    return;
  }
  document.getElementById('dsl-file-input').click();
}

function handleImportDSL(event) {
  if (isAetherLiveMode()) {
    event.target.value = '';
    return;
  }
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('dsl-input').value = e.target.result;
    applyDSL();
    showToast('ファイルを読み込み、適用しました: ' + file.name, 'success');
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ---------------------------------------------------------------------------
// LIVE フォルダ監視（片方向: 監視ファイル = 正本、キャンバス = 閲覧のみ）
// File System Access API — https / localhost のみ。file:// は非対応。
// ---------------------------------------------------------------------------
const LIVE_POLL_MS = 1000;
let liveWatchState = {
  active: false,
  dirHandle: null,
  fileHandle: null,
  fileName: 'aether_dsl.txt',
  lastModified: 0,
  lastText: '',
  pollTimer: null,
  applying: false
};

function isAetherLiveMode() {
  return !!(liveWatchState && liveWatchState.active);
}

function getLiveWatchFileName() {
  const el = document.getElementById('live-watch-filename');
  const raw = el && el.value ? String(el.value).trim() : '';
  return raw || 'aether_dsl.txt';
}

function updateLiveWatchUi() {
  const on = isAetherLiveMode();
  document.body.classList.toggle('aether-live', on);
  const ind = document.getElementById('live-indicator');
  if (ind) {
    ind.textContent = on ? '● LIVE' : '○ IDLE';
    ind.classList.toggle('on', on);
  }
  const btn = document.getElementById('live-watch-btn');
  if (btn) {
    btn.textContent = on ? '■ 監視停止' : '👁️ フォルダ監視';
    btn.title = on
      ? 'フォルダ監視を停止して通常モードに戻る'
      : 'フォルダ内のDSLを監視（LIVE中は閲覧のみ・ファイルが正本）';
  }
  const nameInput = document.getElementById('live-watch-filename');
  if (nameInput) nameInput.disabled = on;
  const dslInput = document.getElementById('dsl-input');
  if (dslInput) {
    dslInput.readOnly = on;
    dslInput.title = on ? 'LIVE中は監視ファイルが正本（編集不可）' : '';
  }
  ['btn-apply-dsl', 'btn-import-dsl', 'btn-generate-dsl'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = on;
  });
}

function stopLiveFolderWatch(opts) {
  const silent = opts && opts.silent;
  if (liveWatchState.pollTimer) {
    clearInterval(liveWatchState.pollTimer);
    liveWatchState.pollTimer = null;
  }
  liveWatchState.active = false;
  liveWatchState.dirHandle = null;
  liveWatchState.fileHandle = null;
  liveWatchState.lastModified = 0;
  liveWatchState.lastText = '';
  liveWatchState.applying = false;
  updateLiveWatchUi();
  if (!silent) showToast('フォルダ監視を停止しました', 'success');
  console.log('[Aether LIVE] stopped');
}

async function ensureLiveFileHandle(dirHandle, fileName) {
  try {
    return await dirHandle.getFileHandle(fileName);
  } catch (err) {
    if (err && (err.name === 'NotFoundError' || err.code === err.NOT_FOUND_ERR)) {
      const fh = await dirHandle.getFileHandle(fileName, { create: true });
      const seed =
        (document.getElementById('dsl-input') && document.getElementById('dsl-input').value.trim())
          ? document.getElementById('dsl-input').value
          : (typeof DEFAULT_DSL === 'string' ? DEFAULT_DSL : '# Aether DSL\n');
      const writable = await fh.createWritable();
      await writable.write(seed);
      await writable.close();
      console.log('[Aether LIVE] created watch file:', fileName);
      return fh;
    }
    throw err;
  }
}

async function readLiveFileSnapshot(fileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  return { text: text, lastModified: file.lastModified, name: file.name };
}

async function applyLiveFileText(text, meta) {
  if (liveWatchState.applying) return;
  if (text === liveWatchState.lastText) {
    if (meta && meta.lastModified) liveWatchState.lastModified = meta.lastModified;
    return;
  }
  liveWatchState.applying = true;
  try {
    const input = document.getElementById('dsl-input');
    if (input) input.value = text;
    liveWatchState.lastText = text;
    if (meta && meta.lastModified) liveWatchState.lastModified = meta.lastModified;
    applyDSL({ fromLive: true, silent: false });
  } finally {
    liveWatchState.applying = false;
  }
}

async function pollLiveWatchFile() {
  if (!isAetherLiveMode() || !liveWatchState.fileHandle || liveWatchState.applying) return;
  try {
    const snap = await readLiveFileSnapshot(liveWatchState.fileHandle);
    if (snap.lastModified === liveWatchState.lastModified && snap.text === liveWatchState.lastText) {
      return;
    }
    if (snap.text === liveWatchState.lastText) {
      liveWatchState.lastModified = snap.lastModified;
      return;
    }
    console.log('[Aether LIVE] file changed, applying', snap.name, snap.lastModified);
    await applyLiveFileText(snap.text, snap);
  } catch (err) {
    console.warn('[Aether LIVE] poll failed:', err);
    showToast('LIVE監視の読取に失敗しました。監視を停止します。', 'error');
    stopLiveFolderWatch({ silent: true });
  }
}

async function startLiveFolderWatch() {
  if (typeof window.showDirectoryPicker !== 'function') {
    showToast('このブラウザはフォルダ監視に非対応です（Chrome/Edge の https または localhost で開いてください）', 'error');
    return;
  }
  if (location.protocol === 'file:') {
    showToast('file:// ではフォルダ監視できません。localhost で起動してください（例: npx serve .）', 'error');
    return;
  }

  const fileName = getLiveWatchFileName();
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const fileHandle = await ensureLiveFileHandle(dirHandle, fileName);
    const snap = await readLiveFileSnapshot(fileHandle);

    liveWatchState.dirHandle = dirHandle;
    liveWatchState.fileHandle = fileHandle;
    liveWatchState.fileName = fileName;
    liveWatchState.active = true;
    liveWatchState.lastModified = 0;
    liveWatchState.lastText = '';
    updateLiveWatchUi();

    await applyLiveFileText(snap.text, snap);
    if (liveWatchState.pollTimer) clearInterval(liveWatchState.pollTimer);
    liveWatchState.pollTimer = setInterval(pollLiveWatchFile, LIVE_POLL_MS);

    showToast('LIVE監視開始: ' + fileName + '（閲覧のみ・ファイルが正本）', 'success');
    console.log('[Aether LIVE] started on', fileName);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      showToast('フォルダ選択をキャンセルしました', 'error');
      return;
    }
    console.error('[Aether LIVE] start failed:', err);
    stopLiveFolderWatch({ silent: true });
    showToast('フォルダ監視を開始できませんでした: ' + (err && err.message ? err.message : err), 'error');
  }
}

function toggleLiveFolderWatch() {
  if (isAetherLiveMode()) stopLiveFolderWatch();
  else startLiveFolderWatch();
}

// LIVE中: キャンバス→DSL生成はデータ変更扱いで禁止
const _generateDSLFromCanvasOrig =
  typeof generateDSLFromCanvas === 'function' ? generateDSLFromCanvas : null;
function generateDSLFromCanvasLiveGuard() {
  if (isAetherLiveMode()) {
    showToast('LIVE中はキャンバス出力できません（ファイルが正本）', 'error');
    return;
  }
  if (typeof window.__aetherGenerateDSLFromCanvasImpl === 'function') {
    return window.__aetherGenerateDSLFromCanvasImpl();
  }
  if (_generateDSLFromCanvasOrig) return _generateDSLFromCanvasOrig();
}
// parser の generateDSLFromCanvas をラップ（読込順: parser → main）
if (typeof generateDSLFromCanvas === 'function') {
  window.__aetherGenerateDSLFromCanvasImpl = generateDSLFromCanvas;
  generateDSLFromCanvas = generateDSLFromCanvasLiveGuard;
}

function exportDSLToFile() {
  const dsl = document.getElementById('dsl-input').value;
  if (!dsl.trim()) {
    showToast('エクスポートするDSLデータがありません。', 'error');
    return;
  }

  let title = 'AetherBoard';
  const titleMatch = dsl.match(/sticky\s+\w+\s+"([^"]+)"/);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].replace(/[\\\/: *?"<>|]/g, '_');
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = '' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const fileName = title + '_' + timestamp + '_dsl.txt';

  const blob = new Blob([dsl], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('DSLファイルを保存しました: ' + fileName, 'success');
}

const DEFAULT_DSL = "# Aether DSL Auto-Saved v3.0\n\nsticky Origin_J \"日本人起源論\" {\n  pos: 420 80\n  color: \"blue\"\n  tags: \"全体概要\"\n  desc: \"日本列島の人間集団がどのような系譜や混血プロセスを経て形成されたかを探る学術・文化論。古くは単一起源説から始まり、混血説、二重構造、そして現代ゲノム科学による三重構造モデルへと進化を遂げている。\"\n}\n\nsticky Y_D1a2a \"Y染色体D1a2a系統\" {\n  pos: 100 250\n  color: \"purple\"\n  tags: \"科学・論文説\"\n  desc: \"東アジアの他地域ではほぼ見られない日本列島特有のY染色体系統（約35%）。世界的にはチベットに親縁系統が存在し、縄文男系系譜を引き継ぐ証拠とされる。\\n\\nアインシュタインの方程式：$ E = mc^2 $\\n頻度の正規分布モデル：$$ f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{1}{2}\\left(\\frac{x-\\mu}{\\sigma}\\right)^2} $$\\n\\n![ゲノムDNA解析イメージ](https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=400)\"\n  time: \"1_縄文期\"\n  tone: \"stable\"\n}\n\nsticky Jomon_Single \"単一縄文人起源説\" {\n  pos: 420 250\n  color: \"green\"\n  tags: \"考古学・従来説\"\n  desc: \"日本列島の住民は、外部からの大規模な混血を経ずに、縄文人が直接的に現代日本人へと進化したとする極めて初期の説。近代以降の骨格比較研究やゲノム解析により、現在はこの仮説は否定されている。\"\n  time: \"1_縄文期\"\n  tone: \"tension\"\n}\n\nsticky Dual_Structure \"二重構造モデル (埴原和郎)\" {\n  pos: 740 250\n  color: \"green\"\n  tags: \"考古学・従来説\"\n  desc: \"1991年に人類学者・埴原和郎が提唱した定説。日本人は「東南アジア系祖先から派生した縄文人」と、「北東アジア系祖先から派生し弥生時代に大挙渡来した渡来人」の二重の系統の混血によって形成されたとする。\"\n  time: \"2_弥生期\"\n}\n\nsticky Triple_Structure \"現代ゲノムの三重構造モデル\" {\n  pos: 420 450\n  color: \"purple\"\n  tags: \"科学・論文説\"\n  desc: \"2021年の古代DNA解析によって提唱された最新モデル。従来の「縄文・弥生」の二重構造に加え、古墳時代に大陸から大量の「第3の祖先集団（東アジア系）」が渡来し現代日本人の遺伝的ベースを決定づけたとする説。\\n\\n| 祖先集団 | 推定割合 | 主な流入時期 |\\n|---|---|---|\\n| 縄文系 | 約13% | 縄文時代以前 |\\n| 弥生系 | 約30% | 弥生時代 |\\n| 古墳系 | 約57% | 古墳時代 |\"\n  time: \"3_古墳期\"\n}\n\nsticky SC_Paper_2021 \"2021年ゲノム解析論文\" {\n  pos: 100 450\n  color: \"purple\"\n  tags: \"科学・論文説\"\n  desc: \"金沢大学や理化学研究所などの共同研究チームがサイエンス誌の姉妹紙に発表した画期的な論文。縄文人・弥生人・古墳人の古代ゲノムを解読し、現代日本人のルーツが古墳時代に完成した『三重構造』であることを初めて実証した。\"\n  time: \"3_古墳期\"\n}\n\nsticky YT_Lost_Tribes \"日ユ同祖論 (失われた10支族)\" {\n  pos: 740 650\n  color: \"yellow\"\n  tags: \"YouTube・オカルト説\"\n  desc: \"古代イスラエルの失われた10支族の一部が日本列島に渡来し、大和民族の祖先および皇室のルーツになったとする説。言語や神道儀礼の類似性が指摘されるが、学術的な歴史学やゲノム科学では裏付けがない。\"\n  time: \"4_拡散・論争\"\n  tone: \"tension\"\n}\n\nsticky YT_Ainu_Jewish \"アイヌ・ユダヤ同祖説\" {\n  pos: 980 650\n  color: \"yellow\"\n  tags: \"YouTube・オカルト説\"\n  desc: \"アイヌ民族や皇室がユダヤ人の末裔であるとする説。特定の儀礼や言語の類似を根拠にするが、遺伝学・言語学・考古学のいずれも支持しない。\"\n  time: \"4_拡散・論争\"\n  tone: \"tension\"\n}\n\nsticky YT_Hinomoto \"日の本＝ひのもと(火の元)説\" {\n  pos: 500 650\n  color: \"yellow\"\n  tags: \"YouTube・オカルト説\"\n  desc: \"日本の国名「日の本」が太陽崇拝に由来し、古代ユダヤ・エジプトなどの宗教と連続しているとする説。文学的な比喩に留まり、学術的系譜の裏付けはない。\"\n  time: \"4_拡散・論争\"\n  tone: \"tension\"\n}\n\nsticky YT_Korean_Origin \"朝鮮半島起源強調説\" {\n  pos: 260 650\n  color: \"yellow\"\n  tags: \"YouTube・オカルト説\"\n  desc: \"日本人の主要な祖先が朝鮮半島から直接渡来したと強調する説。一部の mitochondrial DNA や Y染色体ハプログループの類似性が指摘されるが、現代ゲノム解析は「朝鮮半島経由の東アジア系流入」の一部要素を示すに留まり、単純な起源置換ではない。\"\n  time: \"4_拡散・論争\"\n  tone: \"tension\"\n}\n\nrelation Origin_J -> Y_D1a2a {\n  type: \"evidence\"\n  label: \"Y染色体D1a2aは縄文系統の一証拠\"\n  color: \"blue\"\n}\n\nrelation Origin_J -> Jomon_Single {\n  type: \"historical\"\n  label: \"初期の単一起源仮説\"\n  color: \"green\"\n}\n\nrelation Origin_J -> Dual_Structure {\n  type: \"historical\"\n  label: \"1991年 二重構造モデル\"\n  color: \"green\"\n}\n\nrelation Origin_J -> Triple_Structure {\n  type: \"evidence\"\n  label: \"2021年 三重構造モデル\"\n  color: \"purple\"\n}\n\nrelation Triple_Structure -> SC_Paper_2021 {\n  type: \"source\"\n  label: \"2021年古代ゲノム解析\"\n  color: \"purple\"\n}\n\nrelation Dual_Structure -> Triple_Structure {\n  type: \"update\"\n  label: \"二重構造を更新\"\n  color: \"purple\"\n}\n\nrelation YT_Lost_Tribes -> YT_Ainu_Jewish {\n  type: \"similar\"\n  label: \"同系譜主張\"\n  color: \"yellow\"\n}\n\nrelation YT_Hinomoto -> YT_Lost_Tribes {\n  type: \"similar\"\n  label: \"象徴主義的類似\"\n  color: \"yellow\"\n}\n\nrelation YT_Korean_Origin -> YT_Lost_Tribes {\n  type: \"conflict\"\n  label: \"系譜解釈の対立\"\n  color: \"yellow\"\n}\n\nrelation YT_Lost_Tribes -> Triple_Structure {\n  type: \"conflict\"\n  label: \"学術的根拠の対比\"\n  color: \"yellow\"\n}\n";

// Boot helpers: legacy DSL（順序保持）→ structured → DEFAULT_DSL
async function applyDefaultOrCachedDsl() {
  try {
    // 1) legacy board_state.current_dsl 優先（配列順・全文を保持）
    const db = await initDB();
    if (db.objectStoreNames.contains(STORE_NAME)) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const legacyDsl = await idbReq(tx.objectStore(STORE_NAME).get('current_dsl'));
      await idbTxDone(tx);
      if (legacyDsl && String(legacyDsl).trim()) {
        document.getElementById('dsl-input').value = legacyDsl;
        applyDSL(); // 重複IDリネーム + 構造化ストア同期
        console.log('[Aether IndexedDB] Loaded legacy current_dsl.');
        return;
      }
    }

    // 2) 構造化ストア（legacy が無い場合のフォールバック）
    const structured = await loadStructuredStateFromDB();
    if (structured && structured.notes && structured.notes.length) {
      const dsl = (() => {
        notes = structured.notes;
        drawings = structured.drawings || [];
        relations = structured.relations || [];
        connections = structured.connections || [];
        syncCanvasGlobals();
        return buildDSLFromState();
      })();
      document.getElementById('dsl-input').value = dsl;
      applyDSL();
      console.log('[Aether IndexedDB] Loaded structured stores.');
      return;
    }
  } catch (err) {
    console.warn('[Aether IndexedDB] Restore skipped:', err);
  }

  document.getElementById('dsl-input').value = DEFAULT_DSL;
  applyDSL();
  console.log('[Aether UI] Serverless whiteboard ready.');
}

// Boot: ?dsl= remote/relative → IndexedDB restore → default DSL. No polling / no API.
window.onload = async () => {
  console.log('[Aether] build 4.0.5 LIVE+role/conf/weight/flow (dedupeCanvasState=', typeof dedupeCanvasState, ')');
  setupCanvasInteractions();
  setupDragAndDrop();
  updateLiveWatchUi();

  const urlParams = new URLSearchParams(window.location.search);
  const dslUrl = urlParams.get('dsl');
  if (dslUrl) {
    try {
      showToast('外部DSLを読み込み中...', 'success');
      const res = await fetch(dslUrl);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();

      document.getElementById('dsl-input').value = text;
      applyDSL();
      showToast('外部DSLの読み込みに成功しました', 'success');
    } catch (err) {
      console.warn('[Aether Init] Failed to load remote DSL via query param:', err);
      showToast('外部DSLの読み込みに失敗しました。デフォルトを適用します。', 'error');
      await applyDefaultOrCachedDsl();
    }
  } else {
    await applyDefaultOrCachedDsl();
  }
};
