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
  notes.forEach(function (n) {
    n.layoutX = Number(n.x) || 0;
    n.layoutY = Number(n.y) || 0;
  });
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

  renderMobileListView();
  if (typeof renderMobileTagFilter === 'function') renderMobileTagFilter();
  if (typeof applyViewModeLayout === 'function') applyViewModeLayout();
  if (typeof syncNavLayoutFromAllSources === 'function') {
    syncNavLayoutFromAllSources().catch(function (err) {
      console.warn('[Aether Nav] layout sync skipped:', err);
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

  if (typeof renderMobileListView === 'function') renderMobileListView();
  if (typeof reconcileKeyboardFocusAfterStepChange === 'function') {
    setTimeout(reconcileKeyboardFocusAfterStepChange, 30);
  }

  if (window.isPresentationMode) {
    setTimeout(() => {
      if (typeof getEffectiveViewMode === 'function' && getEffectiveViewMode() === 'list') {
        if (typeof focusPresentationMobileStep === 'function') focusPresentationMobileStep();
      } else {
        focusPresentationStepView();
      }
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
    const presHint = (typeof isMobileCanvasMode === 'function' && isMobileCanvasMode())
      ? '上部 🎬 で OFF'
      : ((typeof getEffectiveViewMode === 'function' && getEffectiveViewMode() === 'list')
        ? '下部またはスワイプで移動'
        : 'Ctrl+← / Ctrl+→ で移動');
    showToast('プレゼンテーションモードを開始しました (' + presHint + ')', 'success');
    if (typeof getEffectiveViewMode === 'function' && getEffectiveViewMode() === 'list') {
      setTimeout(() => {
        if (typeof focusPresentationMobileStep === 'function') focusPresentationMobileStep();
      }, 80);
    }
  } else {
    if (controller) controller.style.display = 'none';
    if (btn) btn.classList.remove('active');
    showToast('プレゼンテーションモードを終了しました', 'success');
    setTimeout(function () {
      fitToView();
    }, 100);
  }
  if (typeof updateMobilePresToggle === 'function') updateMobilePresToggle();
  if (typeof renderMobileNodeStrip === 'function') renderMobileNodeStrip();
  if (typeof renderMobileListView === 'function') renderMobileListView();
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

  topObstacle = Math.max(topObstacle, getCanvasTopObstacleViewportY());

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

// スマホ: フォーカス付箋を見える領域の上寄り（約28%）へ — グラフ全体の中央寄せとは別挙動
function getMobileFocusViewportY(container) {
  if (!container) return window.innerHeight * 0.28;
  const cr = container.getBoundingClientRect();
  let topObstacle = Math.max(cr.top, getCanvasTopObstacleViewportY());
  let bottomObstacle = cr.bottom;

  const presController = document.getElementById('presentation-controller');
  if (presController && getComputedStyle(presController).display !== 'none') {
    const top = presController.getBoundingClientRect().top - 8;
    if (isFinite(top)) bottomObstacle = Math.min(bottomObstacle, top);
  }
  if (bottomObstacle <= topObstacle + 1) return (cr.top + cr.bottom) * 0.28;
  return topObstacle + (bottomObstacle - topObstacle) * 0.28;
}

function getCanvasTopObstacleViewportY() {
  let top = 0;
  const viewBar = document.getElementById('view-mode-bar');
  if (viewBar && viewBar.offsetParent !== null && getComputedStyle(viewBar).display !== 'none') {
    top = Math.max(top, viewBar.getBoundingClientRect().bottom + 4);
  }
  const strip = document.getElementById('mobile-node-strip');
  if (strip && !strip.hidden && strip.offsetParent !== null) {
    top = Math.max(top, strip.getBoundingClientRect().bottom + 6);
  }
  const tagToggle = document.getElementById('tags-bar-toggle-wrap');
  if (tagToggle && !tagToggle.hidden && tagToggle.offsetParent !== null) {
    top = Math.max(top, tagToggle.getBoundingClientRect().bottom + 4);
  }
  const tagsChrome = document.getElementById('canvas-tags-chrome');
  if (tagsChrome && tagsChrome.offsetParent !== null && getComputedStyle(tagsChrome).display !== 'none') {
    const bar = document.getElementById('tags-filter-bar');
    if (bar && !bar.classList.contains('tags-bar-hidden') && bar.children.length > 0) {
      top = Math.max(top, tagsChrome.getBoundingClientRect().bottom + 6);
    }
  }
  return top;
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
    syncSidebarCollapsedBodyClass();
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
    // 倍率変更後はフォーカス付箋をグラフ中央へ（はみ出し可）
    if (window.focusedNoteId) {
      const n = (typeof notes !== 'undefined' ? notes : window.notes || []).find(function (x) {
        return x.id === window.focusedNoteId;
      });
      if (n) centerFocusedNote(n);
    }
  });

  let touchPanning = false;
  let touchStartDist = 0;
  let touchStartScale = window.scale;

  containerEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchPanning = true;
      window.isDragging = true;
      window.startX = e.touches[0].clientX - window.panX;
      window.startY = e.touches[0].clientY - window.panY;
    } else if (e.touches.length === 2) {
      touchPanning = false;
      window.isDragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDist = Math.hypot(dx, dy);
      touchStartScale = window.scale;
    }
  }, { passive: true });

  containerEl.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && touchPanning) {
      e.preventDefault();
      window.panX = e.touches[0].clientX - window.startX;
      window.panY = e.touches[0].clientY - window.startY;
      updateTransform();
    } else if (e.touches.length === 2 && touchStartDist > 0) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      window.scale = Math.min(2.0, Math.max(0.15, touchStartScale * (dist / touchStartDist)));
      updateTransform();
    }
  }, { passive: false });

  containerEl.addEventListener('touchend', () => {
    touchPanning = false;
    window.isDragging = false;
    touchStartDist = 0;
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
  if (window.focusedNoteId) {
    const n = (typeof notes !== 'undefined' ? notes : window.notes || []).find(function (x) {
      return x.id === window.focusedNoteId;
    });
    if (n) centerFocusedNote(n);
  }
}

// ---------------------------------------------------------------------------
// キーボードナビゲーション — 設計格子 layoutX/layoutY を正とする（表示 x/y とは分離）
// ドラッグで付箋位置がずれても、←→↑↓ は DSL pos の行・列で移動する。
// ---------------------------------------------------------------------------
var AETHER_GRID_ROW_TOL = 90;
var AETHER_GRID_COL_TOL = 130;

function getNoteLayoutX(note) {
  if (!note) return 0;
  var lx = note.layoutX;
  if (lx != null && isFinite(Number(lx))) return Number(lx);
  return Number(note.x) || 0;
}

function getNoteLayoutY(note) {
  if (!note) return 0;
  var ly = note.layoutY;
  if (ly != null && isFinite(Number(ly))) return Number(ly);
  return Number(note.y) || 0;
}

if (typeof window !== 'undefined') {
  window.getNoteLayoutX = getNoteLayoutX;
  window.getNoteLayoutY = getNoteLayoutY;
}

function extractLayoutMapFromDsl(text) {
  var map = {};
  if (!text) return map;
  var re = /sticky\s+(\w+)\s+"[^"]*"\s*\{[\s\S]*?pos:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  var m;
  while ((m = re.exec(String(text))) !== null) {
    map[m[1]] = [Number(m[2]), Number(m[3])];
  }
  return map;
}

function detectBoardKeyFromDsl(text) {
  var hit = String(text || '').match(/Board:\s*([\w-]+)/i);
  return hit ? hit[1] : null;
}

function applyLayoutMapToNotes(map, opts) {
  var options = opts || {};
  if (!map) return 0;
  var count = 0;
  getSourceNotesArray().forEach(function (note) {
    var entry = map[String(note.id)];
    if (!entry) return;
    var x = Array.isArray(entry) ? entry[0] : entry.x;
    var y = Array.isArray(entry) ? entry[1] : entry.y;
    if (!isFinite(Number(x)) || !isFinite(Number(y))) return;
    note.layoutX = Number(x);
    note.layoutY = Number(y);
    count += 1;
  });
  if (count && typeof syncCanvasGlobals === 'function') syncCanvasGlobals();
  if (count && (!options.silent) && typeof showToast === 'function') {
    showToast('ナビ格子を更新しました（' + count + ' 件）', 'success');
  }
  return count;
}

function syncLayoutFromDslTextarea(opts) {
  var ta = document.getElementById('dsl-input');
  if (!ta || !String(ta.value || '').trim()) return 0;
  return applyLayoutMapToNotes(extractLayoutMapFromDsl(ta.value), opts);
}

function applyBuiltinBoardLayout(opts) {
  var layouts = (typeof window !== 'undefined') ? window.AETHER_BOARD_LAYOUTS : null;
  if (!layouts) return 0;
  var ta = document.getElementById('dsl-input');
  var key = detectBoardKeyFromDsl(ta && ta.value);
  if (!key || !layouts[key]) return 0;
  return applyLayoutMapToNotes(layouts[key], opts);
}

async function syncNavLayoutFromAllSources() {
  var applied = 0;
  try {
    var res = await fetch('aether_dsl.txt?t=' + Date.now());
    if (res.ok) {
      applied = applyLayoutMapToNotes(extractLayoutMapFromDsl(await res.text()), { silent: true });
    }
  } catch (err) { /* file:// 等 */ }
  if (!applied) applied = syncLayoutFromDslTextarea({ silent: true });
  if (!applied) applied = applyBuiltinBoardLayout({ silent: true });
  if (applied) {
    console.log('[Aether Nav] layout coords synced for', applied, 'notes');
  }
  return applied;
}

function getSourceNotesArray() {
  return (typeof notes !== 'undefined' && notes && notes.length) ? notes : (window.notes || []);
}

function getKeyboardNavPool() {
  return getSourceNotesArray().filter(function (n) {
    if (typeof isTimeVisible === 'function' && !isTimeVisible(n.time)) return false;
    return !!document.getElementById('note-' + n.id);
  });
}

function getActiveNotesPool() {
  return getKeyboardNavPool().filter(function (n) {
    var el = document.getElementById('note-' + n.id);
    return !(el && el.hidden);
  });
}

function isSameGridRow(a, b) {
  return Math.abs(getNoteLayoutY(a) - getNoteLayoutY(b)) <= AETHER_GRID_ROW_TOL;
}

function isSameGridCol(a, b) {
  return Math.abs(getNoteLayoutX(a) - getNoteLayoutX(b)) <= AETHER_GRID_COL_TOL;
}

function getSortedNavPool() {
  return getKeyboardNavPool().slice().sort(function (a, b) {
    var dy = getNoteLayoutY(a) - getNoteLayoutY(b);
    if (Math.abs(dy) > 8) return dy;
    return getNoteLayoutX(a) - getNoteLayoutX(b);
  });
}

function resolveDrawingTargetIds(dw) {
  if (!dw || !dw.targets) return [];
  if (Array.isArray(dw.targets)) return dw.targets.slice();
  return String(dw.targets).split(/\s+/).filter(Boolean);
}

function findAreaGroupPeers(current, pool) {
  var drawingList = (typeof drawings !== 'undefined' && drawings && drawings.length)
    ? drawings
    : (window.drawings || []);
  if (!drawingList.length && typeof parseAetherDSL === 'function') {
    var ta = document.getElementById('dsl-input');
    if (ta && ta.value && ta.value.trim()) {
      var reparsed = parseAetherDSL(ta.value);
      if (reparsed.drawings && reparsed.drawings.length) {
        drawingList = reparsed.drawings;
        drawings = reparsed.drawings;
        window.drawings = reparsed.drawings;
      }
    }
  }
  var curId = String(current.id);
  for (var i = 0; i < drawingList.length; i++) {
    var dw = drawingList[i];
    if (dw.type !== 'circle-area') continue;
    if (typeof isTimeVisible === 'function' && dw.time && !isTimeVisible(dw.time)) continue;
    var ids = resolveDrawingTargetIds(dw);
    if (ids.indexOf(curId) < 0) continue;
    return ids.map(function (id) {
      return pool.find(function (n) { return String(n.id) === String(id); });
    }).filter(Boolean);
  }
  return null;
}

function findAreaGroupNeighbor(current, direction, pool) {
  var group = findAreaGroupPeers(current, pool);
  if (!group || group.length < 2) return null;
  return findGridNeighbor(current, direction, group);
}

function findGridNeighbor(current, direction, pool) {
  var curX = getNoteLayoutX(current);
  var curY = getNoteLayoutY(current);

  if (direction === 'Right' || direction === 'Left') {
    var rowPeers = pool.filter(function (n) {
      if (String(n.id) === String(current.id)) return false;
      return isSameGridRow(current, n);
    }).sort(function (a, b) { return getNoteLayoutX(a) - getNoteLayoutX(b); });

    if (direction === 'Right') {
      var right = rowPeers.filter(function (n) { return getNoteLayoutX(n) > curX + 1; });
      return right.length ? right[0] : null;
    }
    var left = rowPeers.filter(function (n) { return getNoteLayoutX(n) < curX - 1; });
    return left.length ? left[left.length - 1] : null;
  }

  var colPeers = pool.filter(function (n) {
    if (String(n.id) === String(current.id)) return false;
    return isSameGridCol(current, n);
  }).sort(function (a, b) { return getNoteLayoutY(a) - getNoteLayoutY(b); });

  if (direction === 'Down') {
    var down = colPeers.filter(function (n) { return getNoteLayoutY(n) > curY + 1; });
    return down.length ? down[0] : null;
  }
  var up = colPeers.filter(function (n) { return getNoteLayoutY(n) < curY - 1; });
  return up.length ? up[up.length - 1] : null;
}

function findArrowNavTarget(current, direction, pool) {
  var areaTarget = findAreaGroupNeighbor(current, direction, pool);
  if (areaTarget) return areaTarget;
  var gridTarget = findGridNeighbor(current, direction, pool);
  if (gridTarget) return gridTarget;
  return findRelationNeighborInDirection(current, direction, pool);
}

function directionAngleForNav(direction) {
  if (direction === 'Right') return 0;
  if (direction === 'Left') return Math.PI;
  if (direction === 'Down') return Math.PI / 2;
  if (direction === 'Up') return -Math.PI / 2;
  return 0;
}

function findRelationNeighborInDirection(current, direction, pool) {
  var relList = (typeof relations !== 'undefined' && relations && relations.length)
    ? relations
    : (window.relations || []);
  if (!relList.length) return null;

  var curId = String(current.id);
  var curX = getNoteLayoutX(current);
  var curY = getNoteLayoutY(current);
  var targetAngle = directionAngleForNav(direction);
  var best = null;
  var bestScore = -Infinity;
  var minScore = 0.35;

  relList.forEach(function (rel) {
    var otherId = null;
    if (String(rel.from) === curId) otherId = String(rel.to);
    else if (String(rel.to) === curId) otherId = String(rel.from);
    else return;

    var other = pool.find(function (n) { return String(n.id) === otherId; });
    if (!other) return;

    var dx = getNoteLayoutX(other) - curX;
    var dy = getNoteLayoutY(other) - curY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    var angle = Math.atan2(dy, dx);
    var score = Math.cos(angle - targetAngle);
    if (score > bestScore) {
      bestScore = score;
      best = other;
    }
  });

  return bestScore >= minScore ? best : null;
}

function findInitialGridFocusInDirection(direction, pool) {
  var sorted = getSortedNavPool();
  if (!sorted.length) return pool[0] || null;
  if (direction === 'Right' || direction === 'Down') return sorted[0];
  return sorted[sorted.length - 1];
}

function focusNoteByArrowKey(direction) {
  if (typeof getEffectiveViewMode === 'function' && getEffectiveViewMode() === 'list') return;

  var pool = getKeyboardNavPool();
  if (!pool.length) return;

  var current = pool.find(function (n) { return String(n.id) === String(window.focusedNoteId); });
  if (!current) {
    var seed = findInitialGridFocusInDirection(direction, pool);
    if (seed) focusAndSelectNote(seed, { silent: true });
    return;
  }

  var target = findArrowNavTarget(current, direction, pool);
  if (target) {
    focusAndSelectNote(target, { silent: true });
  }
}

function focusNextNoteInOrder(delta) {
  var pool = getSortedNavPool();
  if (!pool.length) return;
  var idx = pool.findIndex(function (n) { return String(n.id) === String(window.focusedNoteId); });
  if (idx < 0) idx = 0;
  var nextIdx = (idx + delta + pool.length) % pool.length;
  focusAndSelectNote(pool[nextIdx], { silent: true });
}

function clearKeyboardFocusState() {
  window.focusedNoteId = null;
  document.querySelectorAll('#notes-container .sticky-note').forEach(function (el) {
    el.classList.remove('focused');
  });
  if (document.body) document.body.classList.remove('aether-kb-focus');
  if (typeof drawAllShapes === 'function') drawAllShapes();
}

function focusAndSelectNote(note, opts) {
  if (!note) return;
  var options = opts || {};
  window.focusedNoteId = String(note.id);

  document.querySelectorAll('#notes-container .sticky-note').forEach(function (el) {
    el.classList.remove('focused');
  });
  var targetEl = document.getElementById('note-' + note.id);
  if (targetEl) targetEl.classList.add('focused');
  if (document.body) document.body.classList.add('aether-kb-focus');

  var canvasEl = document.getElementById('canvas-container');
  if (canvasEl && typeof canvasEl.focus === 'function') {
    try { canvasEl.focus({ preventScroll: true }); } catch (err) { canvasEl.focus(); }
  }

  centerFocusedNote(note);

  if (typeof showNodeDetails === 'function') {
    showNodeDetails(note);
  } else if (typeof drawAllShapes === 'function') {
    drawAllShapes();
  }

  if (!options.silent) {
    showToast('フォーカス: ' + note.content, 'success');
  }
}

function reconcileKeyboardFocusAfterStepChange() {
  if (!window.focusedNoteId) return;
  var pool = getKeyboardNavPool();
  if (!pool.length) {
    clearKeyboardFocusState();
    return;
  }
  var stillVisible = pool.some(function (n) {
    return String(n.id) === String(window.focusedNoteId);
  });
  if (stillVisible) {
    var note = pool.find(function (n) { return String(n.id) === String(window.focusedNoteId); });
    if (note) {
      var el = document.getElementById('note-' + note.id);
      if (el) el.classList.add('focused');
      if (document.body) document.body.classList.add('aether-kb-focus');
      if (typeof drawAllShapes === 'function') drawAllShapes();
    }
    return;
  }
  var first = typeof getFirstNoteForCurrentStep === 'function'
    ? getFirstNoteForCurrentStep()
    : getSortedNavPool()[0];
  if (first) focusAndSelectNote(first, { silent: true });
}

// キーボード（capture で最優先）— build: 4.0.37-layout-nav
window.__AETHER_KB_NAV_BUILD__ = '4.0.37-layout-nav';

function handleAetherKeyboardNav(e) {
  if (e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'ArrowRight') {
      if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return;
      e.preventDefault();
      nextPresentationStep();
      return;
    }
    if (e.key === 'ArrowLeft') {
      if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return;
      e.preventDefault();
      prevPresentationStep();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return;
      e.preventDefault();
      zoom(e.key === 'ArrowUp' ? 0.1 : -0.1);
      return;
    }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Escape') {
    if (window.mobileDetailOpen && typeof closeMobileDetail === 'function') {
      closeMobileDetail();
      return;
    }
    if (window.isPresentationMode) {
      togglePresentationMode(false);
    }
    if (window.focusedNoteId) {
      if (typeof clearKeyboardFocusState === 'function') {
        clearKeyboardFocusState();
      } else {
        var el0 = document.getElementById('note-' + window.focusedNoteId);
        if (el0) el0.classList.remove('focused');
        window.focusedNoteId = null;
      }
      var detailsContainer = document.getElementById('details-view-container');
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

  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return;
    e.preventDefault();
    if (window.isPresentationMode) focusPresentationStepView();
    else if (typeof fitToView === 'function') fitToView();
    return;
  }

  if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return;
    e.preventDefault();
    togglePresentationMode();
    return;
  }

  var navKeys = ['ArrowRight', 'Right', 'ArrowLeft', 'Left', 'ArrowDown', 'Down', 'ArrowUp', 'Up', 'Tab'];
  if (navKeys.indexOf(e.key) < 0) return;

  if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) {
    var kbGraph = window.focusedNoteId && document.body && document.body.classList.contains('aether-kb-focus');
    if (!kbGraph) return;
  }

  e.preventDefault();
  e.stopImmediatePropagation();

  if (e.key === 'ArrowRight' || e.key === 'Right') focusNoteByArrowKey('Right');
  else if (e.key === 'ArrowLeft' || e.key === 'Left') focusNoteByArrowKey('Left');
  else if (e.key === 'ArrowDown' || e.key === 'Down') focusNoteByArrowKey('Down');
  else if (e.key === 'ArrowUp' || e.key === 'Up') focusNoteByArrowKey('Up');
  else if (e.key === 'Tab') focusNextNoteInOrder(e.shiftKey ? -1 : 1);
}

window.addEventListener('keydown', handleAetherKeyboardNav, true);

// フォーカス付箋をグラフ領域の中央へパン（世界座標基準・はみ出し可）
// getBoundingClientRect 依存だと画面外ノードや高倍率が崩れるため、note.x/y を正とする
function centerFocusedNote(note) {
  if (!note) {
    if (!window.focusedNoteId) return false;
    note = (typeof notes !== 'undefined' ? notes : window.notes || []).find(function (x) {
      return x.id === window.focusedNoteId;
    });
  }
  if (!note) return false;
  const refs = getCanvasRefs();
  if (!refs.container || !refs.transformLayer) return false;

  const halfW = (typeof NOTE_HALF_W === 'number') ? NOTE_HALF_W : 90;
  const halfH = (typeof NOTE_HALF_H === 'number') ? NOTE_HALF_H : 70;
  const worldCX = Number(note.x) + halfW;
  const worldCY = Number(note.y) + halfH;
  if (!isFinite(worldCX) || !isFinite(worldCY)) return false;

  const cr = refs.container.getBoundingClientRect();
  const desiredMidX = (cr.left + cr.right) / 2;
  const mobileCanvas = typeof isMobileCanvasMode === 'function' && isMobileCanvasMode();
  const desiredMidY = mobileCanvas
    ? getMobileFocusViewportY(refs.container)
    : getVisibleCanvasMidViewportY(refs.container);
  const s = window.scale || 1;
  window.panX = desiredMidX - cr.left - worldCX * s;
  window.panY = desiredMidY - cr.top - worldCY * s;
  updateTransform();
  return true;
}

function scheduleCenterFocusedNote(note) {
  if (!note) return;
  if (window.__aetherFocusCenterRaf) {
    cancelAnimationFrame(window.__aetherFocusCenterRaf);
    window.__aetherFocusCenterRaf = null;
  }
  window.__aetherFocusCenterRaf = requestAnimationFrame(function () {
    window.__aetherFocusCenterRaf = requestAnimationFrame(function () {
      window.__aetherFocusCenterRaf = null;
      centerFocusedNote(note);
    });
  });
}

function toggleLegend(forceOpen) {
  const panel = document.getElementById('legend-panel');
  const openBtn = document.getElementById('legend-open-btn');
  if (!panel) return;
  let open;
  if (typeof forceOpen === 'boolean') open = forceOpen;
  else open = panel.classList.contains('collapsed');
  if (open) {
    panel.classList.remove('collapsed');
    if (openBtn) openBtn.style.display = 'none';
  } else {
    panel.classList.add('collapsed');
    if (openBtn) openBtn.style.display = '';
  }
}

function formatSourceHtml(source) {
  if (!source) return '';
  const raw = String(source);
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  if (/^https?:\/\//i.test(raw)) {
    return '<a class="details-source-link" href="' + escaped + '" target="_blank" rel="noopener noreferrer">' + escaped + '</a>';
  }
  return escaped;
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

  const tagsChrome = document.getElementById('canvas-tags-chrome');
  if (tagsChrome && tagsChrome.offsetParent !== null && getComputedStyle(tagsChrome).display !== 'none') {
    const r = tagsChrome.getBoundingClientRect();
    pad.top = Math.max(pad.top, Math.ceil(r.bottom - cr.top) + 12);
  }

  const strip = document.getElementById('mobile-node-strip');
  if (strip && !strip.hidden && strip.offsetParent !== null) {
    const r = strip.getBoundingClientRect();
    pad.top = Math.max(pad.top, Math.ceil(r.bottom - cr.top) + 8);
  }

  const viewBar = document.getElementById('view-mode-bar');
  if (viewBar && viewBar.offsetParent !== null && getComputedStyle(viewBar).display !== 'none') {
    const r = viewBar.getBoundingClientRect();
    pad.top = Math.max(pad.top, Math.ceil(r.bottom - cr.top) + 4);
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
  var topAlign = typeof isMobileCanvasMode === 'function' && isMobileCanvasMode();
  if (topAlign) {
    window.panY = chrome.top + 8 - minY * window.scale;
  } else {
    window.panY = chrome.top + (viewH - contentH * window.scale) / 2 - minY * window.scale;
  }
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
  window.focusedNoteId = String(note.id);
  const currentEl = document.getElementById('note-' + note.id);
  if (currentEl) currentEl.classList.add('focused');
  if (document.body) document.body.classList.add('aether-kb-focus');
  if (typeof drawAllShapes === 'function') drawAllShapes();

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

  const sourceHtml = note.source ? formatSourceHtml(note.source) : '';
  const sourceBlock = sourceHtml
    ? '<div class="details-source"><span class="details-source-label">出典</span> ' + sourceHtml + '</div>'
    : '';

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
      sourceBlock +
      '<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px;">' + tagsHtml + '</div>' +
      '<div class="details-desc">' + descText + '</div>' +
    '</div>';

  switchTab('details');

  if (typeof getEffectiveViewMode === 'function' && getEffectiveViewMode() === 'list') {
    if (window.mobileDetailOpen && window.focusedNoteId === note.id && typeof closeMobileDetail === 'function') {
      closeMobileDetail();
    } else if (typeof openMobileDetail === 'function') {
      openMobileDetail(note.id);
    }
  } else if (typeof isMobileCanvasMode === 'function' && isMobileCanvasMode()) {
    if (window.mobileDetailOpen && window.focusedNoteId === note.id && typeof closeMobileDetail === 'function') {
      closeMobileDetail();
    } else if (typeof openMobileDetail === 'function') {
      openMobileDetail(note.id, { drawer: true });
    }
  }

  // 選択変更時はフォーカス付箋をグラフ中央へ（倍率変更後も同じ経路・はみ出し可）
  scheduleCenterFocusedNote(note);
}

// IndexedDB: aether_storage.js

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function toggleTheme() {
  const body = document.body;
  const themeBtn = document.getElementById('theme-btn');
  body.classList.toggle('light-theme');
  const isLight = body.classList.contains('light-theme');
  if (themeBtn) themeBtn.textContent = isLight ? '🌙' : '☀️';
  if (typeof drawAllShapes === 'function') drawAllShapes();
}

// --- Tags filter bar visibility toggle ---
var AETHER_TAGS_BAR_KEY = 'aether_tags_bar_visible';

function getTagsBarVisiblePreference() {
  try {
    var stored = localStorage.getItem(AETHER_TAGS_BAR_KEY);
    if (stored === '0' || stored === 'false') return false;
  } catch (err) { /* ignore */ }
  return true;
}

function setTagsBarVisible(visible) {
  try { localStorage.setItem(AETHER_TAGS_BAR_KEY, visible ? '1' : '0'); } catch (err) { /* ignore */ }
  applyTagsBarVisibility();
  if (typeof fitToView === 'function' && !window.isPresentationMode) {
    setTimeout(function () { fitToView(); }, 60);
  }
}

function applyTagsBarVisibility() {
  var show = getTagsBarVisiblePreference();
  var bar = document.getElementById('tags-filter-bar');
  var wrap = document.getElementById('tags-bar-toggle-wrap');
  var toggle = document.getElementById('tags-bar-visible-toggle');
  var hasTags = bar && bar.children.length > 0;
  var listMode = typeof getEffectiveViewMode === 'function' && getEffectiveViewMode() === 'list';
  if (bar) bar.classList.toggle('tags-bar-hidden', !show);
  if (toggle) toggle.checked = show;
  if (wrap) wrap.hidden = !hasTags || listMode;
}

// --- Responsive / mobile list view v2 (overview + browse + detail sheet) ---
var AETHER_VIEW_MODE_KEY = 'aether_view_mode';
var AETHER_VIEW_BREAKPOINT = 768;
var _aetherWasNarrow = typeof window !== 'undefined' && window.innerWidth < AETHER_VIEW_BREAKPOINT;
window.mobileDetailOpen = false;

function isNarrowViewport() {
  return window.innerWidth < AETHER_VIEW_BREAKPOINT;
}

function getViewModePreference() {
  try {
    var stored = localStorage.getItem(AETHER_VIEW_MODE_KEY);
    if (stored === 'canvas' || stored === 'list' || stored === 'auto') return stored;
  } catch (err) { /* file:// private mode */ }
  return 'auto';
}

function setViewMode(mode) {
  var next = (mode === 'canvas' || mode === 'list' || mode === 'auto') ? mode : 'auto';
  try { localStorage.setItem(AETHER_VIEW_MODE_KEY, next); } catch (err) { /* ignore */ }
  if (next !== 'list' && window.mobileDetailOpen) closeMobileDetail();
  applyViewModeLayout();
}

function getEffectiveViewMode() {
  var pref = getViewModePreference();
  if (pref === 'canvas') return 'canvas';
  if (pref === 'list') return 'list';
  // 自動: 狭い画面でもキャンバス（グラフ）を基本表示。一覧は明示選択時のみ。
  return 'canvas';
}

function isMobileCanvasMode() {
  return isNarrowViewport() && getEffectiveViewMode() === 'canvas';
}

function escapeMobileHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function noteMatchesActiveTag(note) {
  if (!note || window.activeTag === null || window.activeTag === undefined) return true;
  return !!(note.tags && note.tags.indexOf(window.activeTag) >= 0);
}

function collectAllBoardTags() {
  var tags = new Set();
  var source = (typeof notes !== 'undefined' && notes) ? notes : (window.notes || []);
  source.forEach(function (n) {
    if (n.tags) n.tags.forEach(function (t) { if (t) tags.add(t); });
  });
  return Array.from(tags).sort();
}

function getMobileBrowseNotes() {
  var pool = getMobileDetailNavigatePool();
  if (window.isPresentationMode) {
    return pool.filter(noteVisibleInCurrentContext);
  }
  return pool;
}

function renderMobileTagFilter() {
  var wrap = document.getElementById('mobile-tag-filter-wrap');
  var sel = document.getElementById('mobile-tag-filter');
  if (!wrap || !sel) return;
  if (!isNarrowViewport()) {
    wrap.hidden = true;
    return;
  }
  var tags = collectAllBoardTags();
  if (!tags.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  var current = window.activeTag === null || window.activeTag === undefined ? '' : String(window.activeTag);
  var all = getNotesSortedForMobileList();
  var pool = getMobileDetailNavigatePool();
  var countLabel = window.activeTag
    ? pool.length + ' / ' + all.length + ' 件'
    : all.length + ' 件';
  sel.innerHTML = '<option value="">すべて (' + all.length + ')</option>' + tags.map(function (t) {
    return '<option value="' + escapeMobileHtml(t) + '">' + escapeMobileHtml(t) + '</option>';
  }).join('');
  sel.value = tags.indexOf(current) >= 0 || current === '' ? current : '';
  if (current && sel.value !== current) {
    window.activeTag = null;
    current = '';
    sel.value = '';
  }
  sel.title = 'タグで絞り込み · ' + countLabel;
}

function setMobileTagFilter(value) {
  if (typeof filterByTag === 'function') {
    filterByTag(value === '' ? null : value);
  }
}

function afterMobileTagFilterChange() {
  renderMobileTagFilter();
  renderMobileNodeStrip();
  if (typeof renderMobileListView === 'function') renderMobileListView();
  if (window.mobileDetailOpen && window.focusedNoteId) {
    var pool = getMobileDetailNavigatePool();
    var still = pool.find(function (n) { return String(n.id) === String(window.focusedNoteId); });
    if (still) {
      updateMobileDetailPosition(still.id);
    } else if (pool.length) {
      var drawerMode = document.body.classList.contains('mobile-canvas-detail');
      openMobileDetail(pool[0].id, { drawer: drawerMode });
    } else if (typeof closeMobileDetail === 'function') {
      closeMobileDetail();
    }
  }
}

function renderMobileModeHint() {
  var el = document.getElementById('mobile-mode-hint');
  if (!el) return;
  if (!isNarrowViewport()) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (getEffectiveViewMode() === 'list') {
    el.textContent = '読むモード — グラフは非表示。付箋をテキストで順に読む向け。タグで絞り込み可。';
  } else {
    el.textContent = '見るモード — 配置マップ＋付箋ストリップ。タップで詳細、タグで表示を絞る。';
  }
}

function noteVisibleInCurrentContext(note) {
  if (!note) return false;
  if (window.isPresentationMode && typeof isTimeVisible === 'function') {
    return isTimeVisible(note.time);
  }
  return true;
}

function getNotesSortedForMobileList() {
  var source = (typeof notes !== 'undefined' && notes) ? notes : (window.notes || []);
  var timeOrder = window.timeSteps || [];
  function timeIndex(t) {
    if (!t) return 0;
    var i = timeOrder.indexOf(t);
    return i >= 0 ? i : timeOrder.length;
  }
  var sorted = source.map(function (n, i) { return { note: n, dslOrder: i }; })
    .sort(function (a, b) {
      var ta = timeIndex(a.note.time);
      var tb = timeIndex(b.note.time);
      if (ta !== tb) return ta - tb;
      return a.dslOrder - b.dslOrder;
    })
    .map(function (x) { return x.note; });
  var seen = {};
  return sorted.filter(function (n) {
    if (!n || n.id === undefined || n.id === null || n.id === '') return false;
    var key = String(n.id);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function findMobileNoteById(noteId) {
  if (noteId === undefined || noteId === null || noteId === '') return null;
  var key = String(noteId);
  return getNotesSortedForMobileList().find(function (n) { return String(n.id) === key; }) || null;
}

function ensureMobileNoteTimeVisible(note) {
  if (!note || !note.time) return;
  if (typeof isTimeVisible === 'function' && isTimeVisible(note.time)) return;
  var steps = window.timeSteps || [];
  var idx = steps.indexOf(note.time);
  if (idx >= 0) {
    mobileJumpToStep(idx);
    return;
  }
  var slider = document.getElementById('time-slider');
  if (slider && steps.length) {
    slider.value = 0;
    handleTimeSlider(0);
  }
}

function scrollMobileStripToNote(noteId) {
  var strip = document.getElementById('mobile-node-strip');
  if (!strip || noteId === undefined || noteId === null) return;
  var key = String(noteId);
  var chip = null;
  strip.querySelectorAll('.mobile-strip-chip').forEach(function (el) {
    if (!chip && String(el.getAttribute('data-note-id')) === key) chip = el;
  });
  if (chip && chip.scrollIntoView) {
    chip.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
  }
}

function renderMobileDetailJumpSelect(noteId) {
  var sel = document.getElementById('mobile-detail-jump');
  if (!sel) return;
  var pool = getMobileDetailNavigatePool();
  sel.innerHTML = pool.map(function (n, i) {
    var title = String(n.content || n.id);
    if (title.length > 36) title = title.slice(0, 36) + '…';
    var label = (i + 1) + ' / ' + pool.length + ' — ' + title;
    return '<option value="' + escapeMobileHtml(String(n.id)) + '">' + escapeMobileHtml(label) + '</option>';
  }).join('');
  sel.value = String(noteId);
}

function mobileJumpToNoteId(noteId) {
  if (!noteId) return;
  var drawerMode = document.body.classList.contains('mobile-canvas-detail');
  openMobileDetail(noteId, { drawer: drawerMode });
}

function getMobileVisibleNotes() {
  return getNotesSortedForMobileList().filter(noteVisibleInCurrentContext);
}

function getMobileRelationCount() {
  return ((typeof relations !== 'undefined' && relations) ? relations : (window.relations || [])).length;
}

function renderMobileStatChips(allCount, visibleCount, relCount) {
  var chips =
    '<span class="mobile-stat-chip" title="このボードに含まれる付箋（sticky）の件数">' +
      '<span class="mobile-stat-label">付箋</span><span class="mobile-stat-value">' + allCount + '</span>' +
    '</span>';
  if (relCount > 0) {
    chips +=
      '<span class="mobile-stat-chip" title="付箋どうしを結ぶ線（relation）の本数">' +
        '<span class="mobile-stat-label">つながり</span><span class="mobile-stat-value">' + relCount + '</span>' +
      '</span>';
  }
  if (visibleCount !== allCount) {
    chips +=
      '<span class="mobile-stat-chip" title="いま選んでいる時系列ステップで表示中の件数">' +
        '<span class="mobile-stat-label">表示中</span><span class="mobile-stat-value">' + visibleCount + '</span>' +
      '</span>';
  }
  return '<div class="mobile-stat-row" aria-label="ボードの件数">' + chips + '</div>';
}

function getNoteRelationChips(noteId) {
  var rels = (typeof relations !== 'undefined' && relations) ? relations : (window.relations || []);
  var allNotes = (typeof notes !== 'undefined' && notes) ? notes : (window.notes || []);
  var chips = [];
  rels.forEach(function (r) {
    if (r.from === noteId) {
      var target = allNotes.find(function (n) { return n.id === r.to; });
      chips.push({ label: target ? target.content : r.to, type: r.type || 'default', targetId: r.to });
    }
    if (r.to === noteId) {
      var source = allNotes.find(function (n) { return n.id === r.from; });
      chips.push({ label: source ? source.content : r.from, type: r.type || 'default', targetId: r.from });
    }
  });
  return chips;
}

function formatNoteDescHtml(note) {
  var rawDesc = (note.desc || '詳細説明は未登録です。').replace(/\\n/g, '\n');
  var withImages = parseMarkdownImage(rawDesc);
  var withTable = parseMarkdownTable(withImages);
  return parseKaTeX(withTable);
}

function getNotePreviewText(note) {
  var raw = (note.desc || '').replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
  if (!raw) return 'タップして詳細を読む';
  return raw.length > 72 ? raw.slice(0, 72) + '…' : raw;
}

function updateViewModeButtons() {
  var pref = getViewModePreference();
  document.querySelectorAll('.view-mode-btn').forEach(function (btn) {
    var mode = btn.getAttribute('data-view-mode');
    btn.classList.toggle('active', mode === pref);
  });
}

function cleanupDesktopFromMobileLayout() {
  if (typeof closeMobileDetail === 'function') closeMobileDetail();
  document.body.classList.remove('mobile-detail-open', 'mobile-canvas-detail');
  if (window.activeTag !== null && typeof filterByTag === 'function') {
    filterByTag(null);
  } else if (typeof renderCanvas === 'function') {
    renderCanvas();
  }
  if (typeof fitToView === 'function') {
    setTimeout(function () { fitToView(); }, 80);
  }
}

function applyViewModeLayout() {
  var narrow = isNarrowViewport();
  var leavingMobile = _aetherWasNarrow && !narrow;
  var pref = getViewModePreference();
  var effective = getEffectiveViewMode();

  if (leavingMobile && pref === 'list') {
    try { localStorage.setItem(AETHER_VIEW_MODE_KEY, 'auto'); } catch (err) { /* ignore */ }
    pref = 'auto';
    effective = 'canvas';
  }

  document.body.classList.remove('view-pref-auto', 'view-pref-canvas', 'view-pref-list', 'view-effective-canvas', 'view-effective-list', 'view-mobile-ui');
  document.body.classList.add('view-pref-' + pref);
  document.body.classList.add('view-effective-' + effective);
  if (narrow) document.body.classList.add('view-mobile-ui');
  updateViewModeButtons();
  applyTagsBarVisibility();
  updateMobilePresToggle();
  renderMobileTagFilter();
  renderMobileModeHint();

  var viewBar = document.getElementById('view-mode-bar');
  if (viewBar) viewBar.hidden = !narrow;

  if (leavingMobile) cleanupDesktopFromMobileLayout();

  if (effective === 'list') {
    renderMobileListView();
    var mobileRoot = document.getElementById('mobile-list-view');
    if (mobileRoot) mobileRoot.hidden = false;
    var panel = document.getElementById('control-panel');
    if (panel && isNarrowViewport() && !panel.classList.contains('collapsed')) {
      panel.classList.add('collapsed');
      syncSidebarCollapsedBodyClass();
      var sidebarBtn = document.getElementById('sidebar-toggle-btn');
      if (sidebarBtn) {
        sidebarBtn.textContent = '▶';
        sidebarBtn.title = 'サイドバーを開く';
      }
    }
  } else {
    if (window.mobileDetailOpen) closeMobileDetail();
    var mobileRoot = document.getElementById('mobile-list-view');
    if (mobileRoot) mobileRoot.hidden = true;
    var panel = document.getElementById('control-panel');
    if (panel && isNarrowViewport() && !panel.classList.contains('collapsed')) {
      panel.classList.add('collapsed');
      syncSidebarCollapsedBodyClass();
      var sidebarBtn = document.getElementById('sidebar-toggle-btn');
      if (sidebarBtn) {
        sidebarBtn.textContent = '▶';
        sidebarBtn.title = 'サイドバーを開く';
      }
    }
    renderMobileNodeStrip();
    if (typeof fitToView === 'function') {
      setTimeout(function () { fitToView(); }, 80);
    }
  }

  _aetherWasNarrow = narrow;
}

function renderMobileMiniMap(notesList) {
  if (!notesList.length) return '';
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  notesList.forEach(function (n) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
  });
  var pad = 30;
  var w = Math.max(maxX - minX + pad * 2, 1);
  var h = Math.max(maxY - minY + pad * 2, 1);
  var svgW = 320, svgH = 150;
  function tx(x) { return ((x - minX + pad) / w) * (svgW - 24) + 12; }
  function ty(y) { return ((y - minY + pad) / h) * (svgH - 24) + 12; }
  var rels = (typeof relations !== 'undefined' && relations) ? relations : (window.relations || []);
  var lines = rels.map(function (r) {
    var a = notesList.find(function (n) { return n.id === r.from; });
    var b = notesList.find(function (n) { return n.id === r.to; });
    if (!a || !b) return '';
    return '<line x1="' + tx(a.x) + '" y1="' + ty(a.y) + '" x2="' + tx(b.x) + '" y2="' + ty(b.y) + '" class="mobile-minimap-line"/>';
  }).join('');
  var dots = notesList.map(function (n, i) {
    var focused = window.focusedNoteId === n.id;
    return '<g class="mobile-minimap-node' + (focused ? ' active' : '') + '" data-note-id="' + n.id + '" role="button" tabindex="0" aria-label="' + escapeMobileHtml(n.content) + '">' +
      '<circle cx="' + tx(n.x) + '" cy="' + ty(n.y) + '" r="' + (focused ? 8 : 6) + '" class="mobile-minimap-dot ' + n.color + '"/>' +
      '<text x="' + tx(n.x) + '" y="' + (ty(n.y) + 3) + '" text-anchor="middle" class="mobile-minimap-label">' + (i + 1) + '</text>' +
    '</g>';
  }).join('');
  return '<div class="mobile-minimap-wrap">' +
    '<div class="mobile-section-caption">配置マップ <span class="mobile-caption-hint">— 丸をタップすると詳細</span></div>' +
    '<svg viewBox="0 0 ' + svgW + ' ' + svgH + '" class="mobile-minimap" aria-label="付箋の配置マップ">' + lines + dots + '</svg></div>';
}

function bindMobileMiniMapClicks() {
  var wrap = document.getElementById('mobile-overview-panel');
  if (!wrap || wrap._minimapBound) return;
  wrap._minimapBound = true;
  wrap.addEventListener('click', function (e) {
    var node = e.target.closest('.mobile-minimap-node');
    if (!node) return;
    var id = node.getAttribute('data-note-id');
    if (id) openMobileDetail(id);
  });
}

function mobileJumpToStep(idx) {
  var slider = document.getElementById('time-slider');
  if (!slider || !window.timeSteps.length) return;
  var next = Math.max(0, Math.min(window.timeSteps.length - 1, idx));
  slider.value = next;
  handleTimeSlider(next);
}

function renderMobileOverviewPanel() {
  var panel = document.getElementById('mobile-overview-panel');
  if (!panel) return;
  var allNotes = getNotesSortedForMobileList();
  var visible = getMobileVisibleNotes();
  var relCount = getMobileRelationCount();
  var stepName = window.activeTime || 'すべて';
  var stepIdx = window.timeSteps.indexOf(stepName);
  if (stepIdx < 0) stepIdx = 0;
  var hasTimeSteps = (window.timeSteps || []).length > 1;

  if (!allNotes.length) {
    panel.innerHTML =
      '<div class="mobile-overview-head">' +
        '<h2 class="mobile-overview-title">スマホ表示</h2>' +
        '<p class="mobile-overview-lead">付箋がまだありません。PC表示（キャンバス）で DSL を読み込むか、配布 HTML にデータが含まれているか確認してください。</p>' +
      '</div>';
    return;
  }

  var stepBlock = '';
  if (hasTimeSteps) {
    var stepChips = window.timeSteps.map(function (step, idx) {
      var active = idx === stepIdx ? ' active' : '';
      return '<button type="button" class="mobile-step-chip' + active + '" onclick="mobileJumpToStep(' + idx + ')">' + escapeMobileHtml(step) + '</button>';
    }).join('');
    stepBlock =
      '<div class="mobile-section-caption">時系列ステップ <span class="mobile-caption-hint">— プレゼン順の切り替え</span></div>' +
      '<div class="mobile-step-bar" role="tablist" aria-label="時系列ステップ">' + stepChips + '</div>';
  }

  var indexRows = allNotes.map(function (note, i) {
    var tagHidden = !noteMatchesActiveTag(note);
    var hidden = !noteVisibleInCurrentContext(note) || tagHidden;
    var active = window.focusedNoteId === note.id ? ' active' : '';
    var dim = hidden ? ' dimmed' : '';
    if (tagHidden && window.activeTag) return '';
    return '<button type="button" class="mobile-index-row' + active + dim + '" onclick="openMobileDetail(\'' + note.id + '\')">' +
      '<span class="mobile-index-num">' + (i + 1) + '</span>' +
      '<span class="mobile-index-stripe ' + note.color + '"></span>' +
      '<span class="mobile-index-title">' + escapeMobileHtml(note.content) + '</span>' +
    '</button>';
  }).join('');

  panel.innerHTML =
    '<div class="mobile-overview-head">' +
      '<h2 class="mobile-overview-title">読むモード</h2>' +
      '<p class="mobile-overview-lead">グラフは非表示。付箋をテキストで読む向け。「見る」に切り替えると配置マップが見えます。</p>' +
      renderMobileStatChips(allNotes.length, visible.length, relCount) +
    '</div>' +
    renderMobileMiniMap(allNotes) +
    stepBlock +
    '<details class="mobile-index-panel">' +
      '<summary class="mobile-index-summary">付箋を番号順に見る（' +
        (window.activeTag ? getMobileDetailNavigatePool().length + ' / ' : '') + allNotes.length + '件）</summary>' +
      '<div class="mobile-index-list">' + indexRows + '</div>' +
    '</details>';
}

function renderMobileBrowseList() {
  var scroll = document.getElementById('mobile-list-scroll');
  if (!scroll) return;
  var visible = getMobileBrowseNotes();
  var allNotes = getNotesSortedForMobileList();
  var navNotes = getMobileDetailNavigatePool();

  if (!visible.length) {
    scroll.innerHTML =
      '<div class="mobile-list-section-label">いま表示中の付箋</div>' +
      '<div class="mobile-list-empty"><span class="mobile-list-empty-icon">📋</span><p>' +
      (window.activeTag
        ? 'タグ「' + escapeMobileHtml(window.activeTag) + '」に該当する付箋がありません。<br>タグを「すべて」に戻してください。'
        : 'このステップでは表示する付箋がありません。<br>上の「時系列ステップ」を切り替えてください。') +
      '</p></div>';
    return;
  }

  var html = '<div class="mobile-list-section-label">表示中の付箋（' + visible.length + '件';
  if (window.activeTag || navNotes.length !== allNotes.length) {
    html += ' / 全' + allNotes.length + '件中';
  }
  html += '）— タップで詳細</div>';
  html += visible.map(function (note) {
    var globalIdx = allNotes.findIndex(function (n) { return n.id === note.id; }) + 1;
    var active = window.focusedNoteId === note.id ? ' active' : '';
    return '<button type="button" class="mobile-browse-row' + active + '" onclick="openMobileDetail(\'' + note.id + '\')">' +
      '<span class="mobile-browse-num">' + globalIdx + '</span>' +
      '<span class="mobile-browse-stripe ' + note.color + '"></span>' +
      '<span class="mobile-browse-text">' +
        '<span class="mobile-browse-title">' + escapeMobileHtml(note.content) + '</span>' +
        '<span class="mobile-browse-preview">' + escapeMobileHtml(getNotePreviewText(note)) + '</span>' +
      '</span>' +
      '<span class="mobile-browse-arrow" aria-hidden="true">›</span>' +
    '</button>';
  }).join('');

  scroll.innerHTML = html;
}

function renderMobileBottomNav() {
  var nav = document.getElementById('mobile-bottom-nav');
  if (!nav) return;
  if (window.mobileDetailOpen) {
    nav.innerHTML = '';
    nav.hidden = true;
    return;
  }
  nav.hidden = false;
  var stepName = window.activeTime || 'すべて';
  var presLabel = window.isPresentationMode ? 'プレゼン ON' : 'プレゼン';
  var presClass = window.isPresentationMode ? ' active' : '';
  var stepLabel = stepName === 'すべて' ? '全ステップ' : stepName;
  nav.innerHTML =
    '<button type="button" class="mobile-bottom-btn' + presClass + '" onclick="togglePresentationMode()">🎬 ' + presLabel + '</button>' +
    '<button type="button" class="mobile-bottom-btn mobile-bottom-btn-accent" onclick="setViewMode(\'canvas\')" title="2Dキャンバス（グラフ）表示">🗺 グラフ</button>' +
    '<span class="mobile-bottom-step">' + escapeMobileHtml(stepLabel) + '</span>';
}

function renderMobileDetailContent(note) {
  var body = document.getElementById('mobile-detail-body');
  var titleEl = document.getElementById('mobile-detail-title');
  if (!body || !note) return;

  var tagsInline = (note.tags && note.tags.length)
    ? note.tags.map(function (t) {
        return '<span class="details-tag-indicator mobile-detail-tag-chip">' + escapeMobileHtml(t) + '</span>';
      }).join('')
    : '';
  var chips = getNoteRelationChips(note.id);
  var relHtml = chips.length
    ? '<div class="mobile-detail-rel-row">' +
        '<span class="mobile-detail-kicker">関連</span>' +
        '<div class="mobile-list-relations">' + chips.map(function (c) {
          return '<button type="button" class="mobile-list-rel-chip rel-' + c.type + '" data-note-id="' + escapeMobileHtml(String(c.targetId)) + '">' + escapeMobileHtml(c.label) + '</button>';
        }).join('') + '</div></div>'
    : '';

  if (titleEl) titleEl.textContent = note.content;
  body.innerHTML =
    '<div class="mobile-detail-compact">' +
      '<div class="mobile-detail-meta mobile-detail-meta-compact">' +
        '<span class="mobile-detail-badge ' + note.color + '">' + escapeMobileHtml(note.color) + '</span>' +
        (note.time ? '<span class="mobile-list-time">' + escapeMobileHtml(note.time) + '</span>' : '') +
        (tagsInline ? '<span class="mobile-detail-tags-inline">' + tagsInline + '</span>' : '') +
        '<span class="mobile-detail-id">#' + escapeMobileHtml(note.id) + '</span>' +
      '</div>' +
      relHtml +
      '<div class="mobile-detail-desc-block details-desc">' + formatNoteDescHtml(note) + '</div>' +
    '</div>';
}

function updateMobileDetailPosition(noteId) {
  var posEl = document.getElementById('mobile-detail-position');
  var pool = getMobileDetailNavigatePool();
  var idx = pool.findIndex(function (n) { return String(n.id) === String(noteId); });
  if (posEl) {
    if (idx >= 0) posEl.textContent = '付箋 ' + (idx + 1) + ' / ' + pool.length;
    else posEl.textContent = '付箋 ? / ' + pool.length;
  }
  renderMobileDetailJumpSelect(noteId);
}

function updateMobileDetailCloseLabel() {
  var btn = document.querySelector('.mobile-detail-close');
  if (!btn) return;
  btn.textContent = document.body.classList.contains('mobile-canvas-detail')
    ? '✕ グラフに戻る'
    : '✕ 一覧へ戻る';
}

function updateMobilePresToggle() {
  var btn = document.getElementById('mobile-pres-toggle-btn');
  if (!btn) return;
  var on = !!window.isPresentationMode;
  btn.classList.toggle('active', on);
  btn.textContent = on ? '🎬 ON' : '🎬';
  btn.title = on ? 'プレゼンモード OFF' : 'プレゼンモード ON';
}

function getMobileDetailNavigatePool() {
  return getNotesSortedForMobileList().filter(noteMatchesActiveTag);
}

function renderMobileNodeStrip() {
  var strip = document.getElementById('mobile-node-strip');
  if (!strip) return;
  if (!isMobileCanvasMode()) {
    strip.hidden = true;
    strip.innerHTML = '';
    return;
  }
  var allNotes = getNotesSortedForMobileList();
  var navNotes = getMobileDetailNavigatePool();
  if (!navNotes.length) {
    strip.hidden = false;
    strip.innerHTML = '<span class="mobile-strip-empty">' +
      (window.activeTag ? 'タグ「' + escapeMobileHtml(window.activeTag) + '」の付箋はありません' : '付箋がありません') +
    '</span>';
    return;
  }
  strip.hidden = false;
  strip.innerHTML = navNotes.map(function (note) {
    var globalIdx = allNotes.findIndex(function (n) { return String(n.id) === String(note.id); }) + 1;
    var hidden = !noteVisibleInCurrentContext(note);
    var active = String(window.focusedNoteId) === String(note.id) ? ' active' : '';
    var dim = hidden ? ' dimmed' : '';
    return '<button type="button" class="mobile-strip-chip' + active + dim + '" data-note-id="' + escapeMobileHtml(String(note.id)) + '" title="' + escapeMobileHtml(note.content) + '">' +
      '<span class="mobile-strip-num">' + globalIdx + '</span>' +
      '<span class="mobile-strip-stripe ' + note.color + '"></span>' +
      '<span class="mobile-strip-label">' + escapeMobileHtml(note.content) + '</span>' +
    '</button>';
  }).join('');
}

function bindMobileStripClicks() {
  var strip = document.getElementById('mobile-node-strip');
  if (!strip || strip._stripClickBound) return;
  strip._stripClickBound = true;
  strip.addEventListener('click', function (e) {
    var chip = e.target.closest('.mobile-strip-chip');
    if (!chip) return;
    var id = chip.getAttribute('data-note-id');
    if (id) focusMobileStripNote(id);
  });
}

function focusMobileStripNote(noteId) {
  var drawerMode = isMobileCanvasMode();
  openMobileDetail(noteId, { drawer: drawerMode });
}

function openMobileDetail(noteId, options) {
  options = options || {};
  var drawerMode = !!options.drawer || isMobileCanvasMode();
  if (!drawerMode && getEffectiveViewMode() !== 'list') return;
  var note = findMobileNoteById(noteId);
  if (!note) return;

  ensureMobileNoteTimeVisible(note);

  window.focusedNoteId = String(note.id);
  window.mobileDetailOpen = true;
  document.body.classList.add('mobile-detail-open');
  document.body.classList.toggle('mobile-canvas-detail', drawerMode);

  var sheet = document.getElementById('mobile-detail-sheet');
  var backdrop = document.getElementById('mobile-detail-backdrop');
  if (sheet) sheet.hidden = false;
  if (backdrop) backdrop.hidden = drawerMode;

  renderMobileDetailContent(note);
  updateMobileDetailPosition(note.id);
  updateMobileDetailCloseLabel();
  renderMobileNodeStrip();
  scrollMobileStripToNote(note.id);

  if (!drawerMode) {
    renderMobileBrowseList();
    renderMobileOverviewPanel();
    renderMobileBottomNav();
  }

  var canvasNote = document.getElementById('note-' + noteId);
  if (canvasNote) {
    document.querySelectorAll('#notes-container .sticky-note').forEach(function (el) { el.classList.remove('focused'); });
    canvasNote.classList.add('focused');
  }
}

function closeMobileDetail() {
  window.mobileDetailOpen = false;
  document.body.classList.remove('mobile-detail-open', 'mobile-canvas-detail');
  var sheet = document.getElementById('mobile-detail-sheet');
  var backdrop = document.getElementById('mobile-detail-backdrop');
  if (sheet) sheet.hidden = true;
  if (backdrop) backdrop.hidden = true;
  renderMobileBottomNav();
  renderMobileNodeStrip();
  if (isMobileCanvasMode() && typeof fitToView === 'function') {
    setTimeout(function () { fitToView(); }, 60);
  }
}

function mobileDetailNavigate(delta) {
  var pool = getMobileDetailNavigatePool();
  if (!pool.length) return;
  var idx = pool.findIndex(function (n) { return String(n.id) === String(window.focusedNoteId); });
  if (idx < 0) idx = 0;
  var next = (idx + delta + pool.length) % pool.length;
  var drawerMode = document.body.classList.contains('mobile-canvas-detail');
  openMobileDetail(pool[next].id, { drawer: drawerMode });
}

function focusMobileListCard(noteId, scrollIntoView) {
  openMobileDetail(noteId);
}

function focusPresentationMobileStep() {
  var visible = getMobileVisibleNotes();
  var target = visible[0] || getFirstNoteForCurrentStep();
  if (target) openMobileDetail(target.id);
}

function toggleMobileListCard(noteId) {
  openMobileDetail(noteId);
}

function renderMobileListView() {
  if (getEffectiveViewMode() !== 'list') {
    renderMobileNodeStrip();
    return;
  }
  renderMobileOverviewPanel();
  renderMobileBrowseList();
  renderMobileBottomNav();
  renderMobileNodeStrip();
  if (window.mobileDetailOpen && window.focusedNoteId) {
    var note = getNotesSortedForMobileList().find(function (n) { return n.id === window.focusedNoteId; });
    if (note) {
      renderMobileDetailContent(note);
      updateMobileDetailPosition(note.id);
    } else {
      closeMobileDetail();
    }
  }
}

function setupMobileDetailSwipe() {
  var body = document.getElementById('mobile-detail-body');
  if (!body || body._aetherSwipeBound) return;
  body._aetherSwipeBound = true;
  body.addEventListener('click', function (e) {
    var rel = e.target.closest('.mobile-list-rel-chip[data-note-id]');
    if (!rel) return;
    var id = rel.getAttribute('data-note-id');
    if (id) {
      var drawerMode = document.body.classList.contains('mobile-canvas-detail');
      openMobileDetail(id, { drawer: drawerMode });
    }
  });
  var startX = 0;
  body.addEventListener('touchstart', function (e) {
    startX = e.changedTouches[0].screenX;
  }, { passive: true });
  body.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].screenX - startX;
    if (Math.abs(dx) < 56) return;
    if (dx < 0) mobileDetailNavigate(1);
    else mobileDetailNavigate(-1);
  }, { passive: true });
}

function setupMobileListSwipe() {
  var el = document.getElementById('mobile-list-scroll');
  if (!el || el._aetherSwipeBound) return;
  el._aetherSwipeBound = true;
  var startX = 0;
  el.addEventListener('touchstart', function (e) {
    startX = e.changedTouches[0].screenX;
  }, { passive: true });
  el.addEventListener('touchend', function (e) {
    if (!window.isPresentationMode || window.mobileDetailOpen) return;
    var dx = e.changedTouches[0].screenX - startX;
    if (Math.abs(dx) < 56) return;
    if (dx < 0) nextPresentationStep();
    else prevPresentationStep();
  }, { passive: true });
}

var _aetherResizeTimer = null;
function initResponsiveView() {
  var bar = document.getElementById('view-mode-bar');
  if (!bar) return;
  applyTagsBarVisibility();
  updateMobilePresToggle();
  bindMobileMiniMapClicks();
  bindMobileStripClicks();
  setupMobileListSwipe();
  setupMobileDetailSwipe();
  applyViewModeLayout();
  if (bar._aetherViewBound) return;
  bar._aetherViewBound = true;
  window.addEventListener('resize', function () {
    clearTimeout(_aetherResizeTimer);
    _aetherResizeTimer = setTimeout(applyViewModeLayout, 120);
  });
}

function syncSidebarCollapsedBodyClass() {
  const panel = document.getElementById('control-panel');
  if (!panel) return;
  document.body.classList.toggle('sidebar-collapsed', panel.classList.contains('collapsed'));
}

function toggleSidebar() {
  const panel = document.getElementById('control-panel');
  const btn = document.getElementById('sidebar-toggle-btn');
  if (!panel || !btn) return;
  const isCollapsed = panel.classList.toggle('collapsed');
  syncSidebarCollapsedBodyClass();
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
    btn.textContent = on ? '■' : '👁️';
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
    // 0) aether_dsl.txt を最優先でオートロード（キャッシュ問題を解消）
    try {
      const res = await fetch('aether_dsl.txt?t=' + Date.now());
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim()) {
          document.getElementById('dsl-input').value = text;
          applyDSL({ silent: true });
          console.log('[Aether Loader] Successfully loaded latest aether_dsl.txt');
          return;
        }
      }
    } catch (e) {
      console.warn('[Aether Loader] Fetch aether_dsl.txt failed, fallback to IndexedDB:', e);
      if (location.protocol === 'file:') {
        showToast('file:// では aether_dsl.txt を自動読込できません。IndexedDB の保存データを使用します。python aether_server.py 等で開くと最新 DSL が読み込まれます。', 'error');
      }
    }

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
  console.log('[Aether] build 4.0.37-layout-nav (kb=', window.__AETHER_KB_NAV_BUILD__, ', dedupeCanvasState=', typeof dedupeCanvasState, ')');
  setupCanvasInteractions();
  setupDragAndDrop();
  updateLiveWatchUi();
  if (typeof initResponsiveView === 'function') initResponsiveView();

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
  await syncNavLayoutFromAllSources();
};
