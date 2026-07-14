// Aether Control & Coordination Engine v4.0 (Serverless Super Whiteboard)
// Zero server dependency: IndexedDB autosave + file drag&drop + browser-only export

let focusedNoteId = null;
let activeTime = null;
let timeSteps = [];
let isPresentationMode = false;

const DB_NAME = 'aether_db';
const STORE_NAME = 'board_state'; // legacy: key 'current_dsl' (互換維持)
const STORE_NOTES = 'notes';
const STORE_RELATIONS = 'relations';
const STORE_DRAWINGS = 'drawings';
const STORE_CONNECTIONS = 'connections';
const DB_VERSION = 2;
const AUTOSAVE_DEBOUNCE_MS = 3000;
let debounceTimeout = null;
let _dbReadyPromise = null;

// Apply parsed DSL to Canvas
function applyDSL() {
  setupCanvasInteractions();
  const input = document.getElementById('dsl-input');
  const text = input ? input.value : '';
  if (typeof parseAetherDSL !== 'function') {
    console.error('[Aether] parseAetherDSL is missing');
    showToast('DSLパーサが読み込まれていません', 'error');
    return;
  }
  const parsed = parseAetherDSL(text);

  notes = parsed.notes || [];
  connections = parsed.connections || [];
  drawings = parsed.drawings || [];
  relations = parsed.relations || [];
  // window へも同期（配布HTMLの共有状態を確実に保つ）
  if (typeof window !== 'undefined') {
    window.notes = notes;
    window.connections = connections;
    window.drawings = drawings;
    window.relations = relations;
  }
  activeTag = null;
  focusedNoteId = null;
  activeTime = null;

  if (typeof renderCanvas === 'function') {
    renderCanvas();
  } else {
    console.error('[Aether] renderCanvas is missing');
    showToast('描画エンジンが読み込まれていません', 'error');
    return;
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

  showToast('Aether DSL を適用しました', 'success');
  if (typeof window.__AETHER_SNAPSHOT__ === 'undefined' || !window.__AETHER_SNAPSHOT__) {
    // フェーズ2: エディタ適用時は差分同期（insert/update/delete）
    syncBoardStateToDB().catch(err => {
      console.warn('[Aether IndexedDB] Diff sync failed, fallback full save:', err);
      saveCanvasState();
    });
  }
}

function updateTimeSlider(times) {
  const containerEl = document.getElementById('time-slider-container');
  const slider = document.getElementById('time-slider');
  const labelsContainer = document.getElementById('time-slider-labels');

  if (times.length === 0) {
    containerEl.style.display = 'none';
    timeSteps = [];
    return;
  }

  containerEl.style.display = 'flex';
  timeSteps = ['すべて', ...times];
  slider.min = 0;
  slider.max = timeSteps.length - 1;
  slider.value = 0;

  labelsContainer.innerHTML = '';
  timeSteps.forEach((step, idx) => {
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
  const targetStep = timeSteps[index];
  activeTime = targetStep === 'すべて' ? null : targetStep;

  const labels = document.querySelectorAll('.time-slider-label');
  labels.forEach((label, idx) => {
    if (idx === index) label.classList.add('active');
    else label.classList.remove('active');
  });

  renderCanvas();
  updatePresentationStepName();

  if (isPresentationMode) {
    setTimeout(() => {
      focusPresentationStepView();
    }, 50);
  }
}

function togglePresentationMode(forceState) {
  isPresentationMode = (typeof forceState === 'boolean') ? forceState : !isPresentationMode;
  
  const controller = document.getElementById('presentation-controller');
  const btn = document.getElementById('pres-mode-btn');
  
  if (isPresentationMode) {
    if (controller) controller.style.display = 'flex';
    if (btn) btn.classList.add('active');
    
    // Default to the first actual time step (index 1) if available, otherwise 0
    const defaultIdx = timeSteps.length > 1 ? 1 : 0;
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
    nameEl.textContent = activeTime || 'すべて';
  }
}

// 現在ステップで「新たに表示される」付箋（先頭1枚）
function getFirstNoteForCurrentStep() {
  const sourceNotes = (typeof notes !== 'undefined' && notes) ? notes : [];
  if (!sourceNotes.length) return null;

  if (activeTime) {
    const newcomers = sourceNotes.filter(n => n.time === activeTime);
    if (newcomers.length) return newcomers[0];
  }

  const visible = sourceNotes.filter(n => {
    if (typeof isTimeVisible === 'function') return isTimeVisible(n.time);
    return true;
  });
  return visible[0] || sourceNotes[0] || null;
}

// 上部UI・下部コントローラを除いた「見えるグラフ領域」の縦中央（ビューポート座標）
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

  panY += deltaY;
  updateTransform();
  return true;
}

// レイアウト確定後に縦中央合わせ（連打時は最後の1回だけ）
function scheduleCenterNoteVertically(note) {
  if (!note || !isPresentationMode) return;
  if (window.__aetherCenterRaf) {
    cancelAnimationFrame(window.__aetherCenterRaf);
    window.__aetherCenterRaf = null;
  }
  // 2フレーム待って詳細パネル切替・DOM 確定後に実測
  window.__aetherCenterRaf = requestAnimationFrame(() => {
    window.__aetherCenterRaf = requestAnimationFrame(() => {
      window.__aetherCenterRaf = null;
      centerNoteVertically(note);
    });
  });
}

// プレゼン step 用ビュー:
// - 新規表示の先頭1枚を選択・詳細表示
// - 倍率はホワイトボード横幅に最大フィット
// - 上下は選択付箋が縦中央（上下見切れ可）
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
  if (focusNote && typeof showNodeDetails === 'function') {
    showNodeDetails(focusNote);
  }

  // サイドバー開閉直後に幅が確定してからフィット
  requestAnimationFrame(() => {
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
    const viewW = Math.max(120, container.clientWidth - sidePad * 2);

    // step 切替時のみ: 横幅フィット + 横中央
    scale = Math.max(0.15, Math.min(3.0, (viewW / contentW) * 0.99));
    panX = sidePad + (viewW - contentW * scale) / 2 - minX * scale;
    updateTransform();

    // 選択付箋を縦中央へ（scale/panX 適用後に実測で panY のみ調整）
    if (focusNote) {
      scheduleCenterNoteVertically(focusNote);
    }
  });
}

function nextPresentationStep() {
  if (!timeSteps.length) return;
  const slider = document.getElementById('time-slider');
  if (!slider) return;
  let currentIdx = parseInt(slider.value, 10);
  let nextIdx = currentIdx + 1;
  if (nextIdx >= timeSteps.length) {
    nextIdx = 0;
  }
  slider.value = nextIdx;
  handleTimeSlider(nextIdx);
}

function prevPresentationStep() {
  if (!timeSteps.length) return;
  const slider = document.getElementById('time-slider');
  if (!slider) return;
  let currentIdx = parseInt(slider.value, 10);
  let prevIdx = currentIdx - 1;
  if (prevIdx < 0) {
    prevIdx = timeSteps.length - 1;
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
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) {
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      updateTransform();
    }
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  containerEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = 0.05;
    if (e.deltaY < 0) scale = Math.min(scale + zoomFactor, 2.0);
    else scale = Math.max(scale - zoomFactor, 0.15);
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
  refs.transformLayer.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  const indicator = document.getElementById('scale-indicator');
  if (indicator) indicator.textContent = `${Math.round(scale * 100)}%`;
}

function zoom(delta) {
  scale = Math.max(0.15, Math.min(2.0, scale + delta));
  updateTransform();
}

function resetTransform() {
  scale = 1.0;
  panX = 0;
  panY = 0;
  updateTransform();
}

// キャンバス上のオーバーレイUI（タグバー・時系列スライダー等）を避けた表示余白を測る
// ※ control-panel は body flex で whiteboard と横並びのため、clientWidth に既に含まれない。右余白に加算しない。
function getFitChromePadding() {
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
  scale = Math.max(0.15, Math.min(2.0, fitScale * 0.98));

  panX = chrome.left + (viewW - contentW * scale) / 2 - minX * scale;
  panY = chrome.top + (viewH - contentH * scale) / 2 - minY * scale;
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

  if (focusedNoteId) {
    const prevEl = document.getElementById('note-' + focusedNoteId);
    if (prevEl) prevEl.classList.remove('focused');
  }
  focusedNoteId = note.id;
  const currentEl = document.getElementById('note-' + note.id);
  if (currentEl) currentEl.classList.add('focused');

  const tagsHtml = note.tags && note.tags.length > 0
    ? note.tags.map(t => '<span class="details-tag-indicator">' + t + '</span>').join(' ')
    : '<span style="color: var(--text-secondary); font-style: italic;">タグなし</span>';

  const rawDesc = (note.desc || 'この項目に関する詳細説明はまだ登録されていません。右側のAether DSLタブから "desc" プロパティを記述して適用できます。').replace(/\\n/g, '\n');
  const withImages = parseMarkdownImage(rawDesc);
  const withTable = parseMarkdownTable(withImages);
  const descText = parseKaTeX(withTable);

  detailsContainer.innerHTML =
    '<div class="details-card">' +
      '<div class="details-meta">' +
        '<span>付箋 ID: <strong>' + note.id + '</strong></span>' +
        '<span>|</span>' +
        '<span>カラー: <strong>' + note.color + '</strong></span>' +
      '</div>' +
      '<div class="details-title">' + note.content + '</div>' +
      '<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;">' + tagsHtml + '</div>' +
      '<div class="details-desc" style="margin-top: 8px;">' + descText + '</div>' +
    '</div>';

  switchTab('details');

  // プレゼン中は選択変更のたびに縦中央へ（クリック/キーボード共通）
  if (isPresentationMode) {
    scheduleCenterNoteVertically(note);
  }
}

// --- IndexedDB (structured stores + legacy board_state) ---
function initDB() {
  if (_dbReadyPromise) return _dbReadyPromise;
  _dbReadyPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      _dbReadyPromise = null;
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      // legacy full-text store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      // structured object stores (Phase 1)
      if (!db.objectStoreNames.contains(STORE_NOTES)) {
        db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_DRAWINGS)) {
        db.createObjectStore(STORE_DRAWINGS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_RELATIONS)) {
        db.createObjectStore(STORE_RELATIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CONNECTIONS)) {
        db.createObjectStore(STORE_CONNECTIONS, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => {
      _dbReadyPromise = null;
      reject(e.target.error);
    };
  });
  return _dbReadyPromise;
}

function idbReq(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbTxDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function relationStoreId(rel) {
  return String(rel.from || '') + '->' + String(rel.to || '');
}

function connectionStoreId(conn) {
  return String(conn.source || '') + '->' + String(conn.target || '');
}

function normalizeNoteForStore(note) {
  return {
    id: note.id,
    content: note.content || '',
    color: note.color || 'yellow',
    x: Math.round(Number(note.x) || 0),
    y: Math.round(Number(note.y) || 0),
    tags: Array.isArray(note.tags) ? note.tags.slice() : [],
    desc: note.desc || '',
    time: note.time || '',
    tone: note.tone || ''
  };
}

function normalizeDrawingForStore(dw) {
  return {
    id: dw.id,
    title: dw.title || '',
    type: dw.type || 'arc-up',
    from: dw.from || '',
    to: dw.to || '',
    style: dw.style || 'solid',
    color: dw.color || 'blue',
    targets: Array.isArray(dw.targets) ? dw.targets.slice() : [],
    anchor: dw.anchor || '',
    offset: Array.isArray(dw.offset) ? dw.offset.slice() : [0, 0],
    pos: Array.isArray(dw.pos) ? dw.pos.slice() : [100, 100],
    tags: Array.isArray(dw.tags) ? dw.tags.slice() : [],
    time: dw.time || ''
  };
}

function normalizeRelationForStore(rel) {
  return {
    id: relationStoreId(rel),
    from: rel.from,
    to: rel.to,
    type: rel.type || 'default',
    label: rel.label || '',
    color: rel.color || 'blue',
    tags: Array.isArray(rel.tags) ? rel.tags.slice() : [],
    time: rel.time || ''
  };
}

function normalizeConnectionForStore(conn) {
  return {
    id: connectionStoreId(conn),
    source: conn.source,
    target: conn.target
  };
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function entityFingerprint(obj) {
  return stableStringify(obj);
}

async function getAllFromStore(db, storeName) {
  if (!db.objectStoreNames.contains(storeName)) return [];
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  const rows = await idbReq(store.getAll());
  await idbTxDone(tx);
  return Array.isArray(rows) ? rows : [];
}

// フェーズ1: ドラッグ終了時の座標のみ差分更新
async function updateNotePositionInDB(noteId, newX, newY) {
  if (typeof window !== 'undefined' && window.__AETHER_SNAPSHOT__) return;
  try {
    const db = await initDB();
    if (!db.objectStoreNames.contains(STORE_NOTES)) return;
    const tx = db.transaction(STORE_NOTES, 'readwrite');
    const store = tx.objectStore(STORE_NOTES);
    const note = await idbReq(store.get(noteId));
    if (note) {
      note.x = Math.round(newX);
      note.y = Math.round(newY);
      store.put(note);
    } else {
      // 未登録ならメモリ上の note を丸ごと投入
      const mem = (typeof notes !== 'undefined' ? notes : []).find(n => n.id === noteId);
      if (mem) {
        const row = normalizeNoteForStore(mem);
        row.x = Math.round(newX);
        row.y = Math.round(newY);
        store.put(row);
      }
    }
    // legacy DSL ミラーも軽量更新（エディタ表示用に後で rebuild 可）
    await idbTxDone(tx);
    // エディタ座標だけ即時反映（全文 rebuild は重いので座標行のみ置換）
    patchDslInputNotePos(noteId, newX, newY);
    console.log('[Aether IndexedDB] note position updated:', noteId, newX, newY);
  } catch (err) {
    console.warn('[Aether IndexedDB] updateNotePositionInDB failed:', err);
  }
}

function patchDslInputNotePos(noteId, newX, newY) {
  const input = document.getElementById('dsl-input');
  if (!input) return;
  const text = input.value || '';
  const re = new RegExp(
    '(sticky\\s+' + noteId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+"[^"]*"\\s*\\{[\\s\\S]*?pos:\\s*)(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)',
    'm'
  );
  if (re.test(text)) {
    input.value = text.replace(re, '$1' + Math.round(newX) + ' ' + Math.round(newY));
  }
}

// フェーズ2: 旧DB vs 新パース結果の差分同期
async function syncBoardStateToDB(parsedState) {
  if (typeof window !== 'undefined' && window.__AETHER_SNAPSHOT__) return;
  const state = parsedState || {
    notes: typeof notes !== 'undefined' ? notes : [],
    drawings: typeof drawings !== 'undefined' ? drawings : [],
    relations: typeof relations !== 'undefined' ? relations : [],
    connections: typeof connections !== 'undefined' ? connections : []
  };

  const newNotes = (state.notes || []).map(normalizeNoteForStore);
  const newDrawings = (state.drawings || []).map(normalizeDrawingForStore);
  const newRelations = (state.relations || []).map(normalizeRelationForStore);
  const newConnections = (state.connections || []).map(normalizeConnectionForStore);

  const db = await initDB();
  const storeNames = [STORE_NOTES, STORE_DRAWINGS, STORE_RELATIONS, STORE_CONNECTIONS, STORE_NAME]
    .filter(name => db.objectStoreNames.contains(name));

  const oldNotes = storeNames.includes(STORE_NOTES) ? await getAllFromStore(db, STORE_NOTES) : [];
  const oldDrawings = storeNames.includes(STORE_DRAWINGS) ? await getAllFromStore(db, STORE_DRAWINGS) : [];
  const oldRelations = storeNames.includes(STORE_RELATIONS) ? await getAllFromStore(db, STORE_RELATIONS) : [];
  const oldConnections = storeNames.includes(STORE_CONNECTIONS) ? await getAllFromStore(db, STORE_CONNECTIONS) : [];

  const diffPutDelete = (oldRows, newRows, keyFn) => {
    const oldMap = new Map(oldRows.map(r => [keyFn(r), r]));
    const newMap = new Map(newRows.map(r => [keyFn(r), r]));
    const toPut = [];
    const toDelete = [];
    newMap.forEach((row, id) => {
      const prev = oldMap.get(id);
      if (!prev || entityFingerprint(prev) !== entityFingerprint(row)) toPut.push(row);
    });
    oldMap.forEach((_row, id) => {
      if (!newMap.has(id)) toDelete.push(id);
    });
    return { toPut, toDelete };
  };

  const notesDiff = diffPutDelete(oldNotes, newNotes, r => r.id);
  const drawingsDiff = diffPutDelete(oldDrawings, newDrawings, r => r.id);
  const relationsDiff = diffPutDelete(oldRelations, newRelations, r => r.id);
  const connectionsDiff = diffPutDelete(oldConnections, newConnections, r => r.id);

  const tx = db.transaction(storeNames, 'readwrite');
  if (storeNames.includes(STORE_NOTES)) {
    const s = tx.objectStore(STORE_NOTES);
    notesDiff.toPut.forEach(row => s.put(row));
    notesDiff.toDelete.forEach(id => s.delete(id));
  }
  if (storeNames.includes(STORE_DRAWINGS)) {
    const s = tx.objectStore(STORE_DRAWINGS);
    drawingsDiff.toPut.forEach(row => s.put(row));
    drawingsDiff.toDelete.forEach(id => s.delete(id));
  }
  if (storeNames.includes(STORE_RELATIONS)) {
    const s = tx.objectStore(STORE_RELATIONS);
    relationsDiff.toPut.forEach(row => s.put(row));
    relationsDiff.toDelete.forEach(id => s.delete(id));
  }
  if (storeNames.includes(STORE_CONNECTIONS)) {
    const s = tx.objectStore(STORE_CONNECTIONS);
    connectionsDiff.toPut.forEach(row => s.put(row));
    connectionsDiff.toDelete.forEach(id => s.delete(id));
  }
  // legacy 互換: 構造化から再構成した DSL 全文も保持
  if (storeNames.includes(STORE_NAME)) {
    const dsl = buildDSLFromState();
    tx.objectStore(STORE_NAME).put(dsl, 'current_dsl');
    const input = document.getElementById('dsl-input');
    if (input) input.value = dsl;
  }
  await idbTxDone(tx);

  const changed =
    notesDiff.toPut.length + notesDiff.toDelete.length +
    drawingsDiff.toPut.length + drawingsDiff.toDelete.length +
    relationsDiff.toPut.length + relationsDiff.toDelete.length +
    connectionsDiff.toPut.length + connectionsDiff.toDelete.length;
  console.log('[Aether IndexedDB] Diff sync complete. changed records:', changed);
  return changed;
}

// 構造化ストアからメモリ state + DSL を復元
async function loadStructuredStateFromDB() {
  try {
    const db = await initDB();
    if (!db.objectStoreNames.contains(STORE_NOTES)) return null;
    const noteRows = await getAllFromStore(db, STORE_NOTES);
    if (!noteRows.length) return null;

    const drawingRows = db.objectStoreNames.contains(STORE_DRAWINGS)
      ? await getAllFromStore(db, STORE_DRAWINGS) : [];
    const relationRows = db.objectStoreNames.contains(STORE_RELATIONS)
      ? await getAllFromStore(db, STORE_RELATIONS) : [];
    const connectionRows = db.objectStoreNames.contains(STORE_CONNECTIONS)
      ? await getAllFromStore(db, STORE_CONNECTIONS) : [];

    return {
      notes: noteRows.map(n => ({
        id: n.id,
        content: n.content || '',
        color: n.color || 'yellow',
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        tags: Array.isArray(n.tags) ? n.tags : [],
        desc: n.desc || '',
        time: n.time || '',
        tone: n.tone || ''
      })),
      drawings: drawingRows.map(d => ({
        id: d.id,
        title: d.title || '',
        type: d.type || 'arc-up',
        from: d.from || '',
        to: d.to || '',
        style: d.style || 'solid',
        color: d.color || 'blue',
        targets: Array.isArray(d.targets) ? d.targets : [],
        anchor: d.anchor || '',
        offset: Array.isArray(d.offset) ? d.offset : [0, 0],
        pos: Array.isArray(d.pos) ? d.pos : [100, 100],
        tags: Array.isArray(d.tags) ? d.tags : [],
        time: d.time || ''
      })),
      relations: relationRows.map(r => ({
        from: r.from,
        to: r.to,
        type: r.type || 'default',
        label: r.label || '',
        color: r.color || 'blue',
        tags: Array.isArray(r.tags) ? r.tags : [],
        time: r.time || ''
      })),
      connections: connectionRows.map(c => ({
        source: c.source,
        target: c.target
      }))
    };
  } catch (err) {
    console.warn('[Aether IndexedDB] loadStructuredStateFromDB failed:', err);
    return null;
  }
}

// legacy: board_state.current_dsl テキスト読込
async function loadFromDB() {
  try {
    // 構造化ストア優先
    const structured = await loadStructuredStateFromDB();
    if (structured && structured.notes && structured.notes.length) {
      notes = structured.notes;
      drawings = structured.drawings || [];
      relations = structured.relations || [];
      connections = structured.connections || [];
      if (typeof window !== 'undefined') {
        window.notes = notes;
        window.drawings = drawings;
        window.relations = relations;
        window.connections = connections;
      }
      return buildDSLFromState();
    }

    const db = await initDB();
    if (!db.objectStoreNames.contains(STORE_NAME)) return null;
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const dsl = await idbReq(store.get('current_dsl'));
    await idbTxDone(tx);
    return dsl || null;
  } catch (err) {
    console.error('[IndexedDB] Load failed:', err);
    return null;
  }
}

// フル書き込み（互換・フォールバック）。構造化 + legacy の両方へ
async function saveToDB(dslText) {
  try {
    await syncBoardStateToDB();
    // syncBoardStateToDB が legacy も書くが、外部から渡された dslText を優先する場合
    if (typeof dslText === 'string' && dslText.trim()) {
      const db = await initDB();
      if (db.objectStoreNames.contains(STORE_NAME)) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(dslText, 'current_dsl');
        await idbTxDone(tx);
      }
    }
  } catch (err) {
    console.error('[IndexedDB] Save failed:', err);
  }
}

function buildDSLFromState() {
  let dsl = '# Aether DSL Auto-Saved v3.0\n\n';
  notes.forEach(note => {
    dsl += 'sticky ' + note.id + ' "' + note.content + '" {\n';
    dsl += '  pos: ' + Math.round(note.x) + ' ' + Math.round(note.y) + '\n';
    dsl += '  color: "' + note.color + '"\n';
    if (note.tags && note.tags.length > 0) dsl += '  tags: "' + note.tags.join(' ') + '"\n';
    if (note.desc) dsl += '  desc: "' + note.desc + '"\n';
    if (note.time) dsl += '  time: "' + note.time + '"\n';
    if (note.tone) dsl += '  tone: "' + note.tone + '"\n';
    dsl += '}\n\n';
  });
  drawings.forEach(dw => {
    dsl += 'drawing ' + dw.id + ' "' + dw.title + '" {\n';
    dsl += '  type: "' + dw.type + '"\n';
    if (dw.from) dsl += '  from: "' + dw.from + '"\n';
    if (dw.to) dsl += '  to: "' + dw.to + '"\n';
    if (dw.style) dsl += '  style: "' + dw.style + '"\n';
    if (dw.color) dsl += '  color: "' + dw.color + '"\n';
    if (dw.anchor) dsl += '  anchor: "' + dw.anchor + '"\n';
    if (dw.offset) dsl += '  offset: ' + dw.offset[0] + ' ' + dw.offset[1] + '\n';
    if (dw.pos && !dw.anchor) dsl += '  pos: ' + dw.pos[0] + ' ' + dw.pos[1] + '\n';
    if (dw.targets && dw.targets.length > 0) dsl += '  targets: "' + dw.targets.join(' ') + '"\n';
    if (dw.tags && dw.tags.length > 0) dsl += '  tags: "' + dw.tags.join(' ') + '"\n';
    if (dw.time) dsl += '  time: "' + dw.time + '"\n';
    dsl += '}\n\n';
  });
  relations.forEach(rel => {
    dsl += 'relation ' + rel.from + ' -> ' + rel.to + ' {\n';
    dsl += '  type: "' + rel.type + '"\n';
    if (rel.label) dsl += '  label: "' + rel.label + '"\n';
    if (rel.color) dsl += '  color: "' + rel.color + '"\n';
    if (rel.tags && rel.tags.length > 0) dsl += '  tags: "' + rel.tags.join(' ') + '"\n';
    if (rel.time) dsl += '  time: "' + rel.time + '"\n';
    dsl += '}\n\n';
  });
  if (connections.length > 0) {
    connections.forEach(conn => {
      dsl += conn.source + ' -> ' + conn.target + '\n';
    });
  }
  return dsl;
}

// フル同期（debounced）。ドラッグ以外の一括保存フォールバック
function saveCanvasState() {
  const dsl = buildDSLFromState();
  const input = document.getElementById('dsl-input');
  if (input) input.value = dsl;

  if (debounceTimeout) clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    syncBoardStateToDB().then(() => {
      console.log('[Aether IndexedDB] Full/diff autosave completed');
    }).catch(err => {
      console.error('[Aether IndexedDB] Autosave failed:', err);
    });
  }, AUTOSAVE_DEBOUNCE_MS);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isPresentationMode) {
      togglePresentationMode(false);
    }
    if (focusedNoteId) {
      const el = document.getElementById('note-' + focusedNoteId);
      if (el) el.classList.remove('focused');
      focusedNoteId = null;

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
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    fitToView();
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
    if (!focusedNoteId) return;
    e.preventDefault();

    const currentNote = notes.find(n => n.id === focusedNoteId);
    if (!currentNote) return;

    let bestTarget = null;
    let minDistance = Infinity;

    notes.forEach(note => {
      if (note.id === focusedNoteId) return;
      // プレゼン中は現在ステップで見えている付箋だけを対象にする
      if (isPresentationMode && typeof isTimeVisible === 'function' && !isTimeVisible(note.time)) return;

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

async function fetchTextAsset(assetPath) {
  try {
    const res = await fetch(assetPath);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } catch (err) {
    console.warn('[Aether Export] Failed to fetch', assetPath, err);
    return '';
  }
}

async function inlineRemoteImagesInDsl(dslText) {
  const re = /!\[([^\]]*)\]\s*\(([^)]+)\)/g;
  const matches = [...dslText.matchAll(re)];
  let result = dslText;

  const toSvgUtf8DataUrl = (svgText) => {
    const cleanSvg = String(svgText || '').replace(/[\r\n]+/g, ' ').trim();
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(cleanSvg);
  };

  for (const match of matches) {
    const full = match[0];
    const alt = match[1];
    let url = match[2].trim();
    if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1).trim();
    if (!url) continue;

    // 既存 data URI: SVG の base64 だけ utf8 に正規化（jpg/png の base64 はそのまま）
    if (url.startsWith('data:')) {
      if (/^data:image\/svg\+xml;base64,/i.test(url)) {
        try {
          const b64 = url.slice(url.indexOf(',') + 1);
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const text = new TextDecoder('utf-8').decode(bytes);
          result = result.replace(full, '![' + alt + '](<' + toSvgUtf8DataUrl(text) + '>)');
        } catch (err) {
          console.warn('[Aether Export] base64 SVG normalize failed:', err);
        }
      }
      continue;
    }

    if (!(url.startsWith('http://') || url.startsWith('https://'))) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;

      // 拡張子 + Content-Type の両方で SVG 判定（クエリ付き URL / 拡張子なし CDN 対策）
      const pathIsSvg = url.toLowerCase().split('?')[0].endsWith('.svg');
      const typeIsSvg = (res.headers.get('content-type') || '').toLowerCase().includes('image/svg');
      if (pathIsSvg || typeIsSvg) {
        const text = await res.text();
        result = result.replace(full, '![' + alt + '](<' + toSvgUtf8DataUrl(text) + '>)');
        continue;
      }

      // SVG 以外（jpg, png 等）は従来通り Base64 化
      const blob = await res.blob();
      if ((blob.type || '').toLowerCase().includes('image/svg')) {
        const text = await blob.text();
        result = result.replace(full, '![' + alt + '](<' + toSvgUtf8DataUrl(text) + '>)');
        continue;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
      result = result.replace(full, '![' + alt + '](<' + dataUrl + '>)');
    } catch (err) {
      console.warn('[Aether Export] image inline failed:', url, err);
    }
  }
  return result;
}

// UTF-8 → Base64（配布HTML埋め込み用。インラインJS破壊を避ける）
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(String(str || ''));
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// 配布HTML向けに main から起動・巨大DEFAULT・エクスポート本体を除去
function prepareMainJsForSnapshot(mainJs) {
  let safeMain = String(mainJs || '');

  // エクスポート専用以降は配布HTMLに不要
  const cutMarkers = [
    'async function fetchTextAsset',
    'function sanitizeForInlineScript',
    'function utf8ToBase64',
    'function prepareMainJsForSnapshot',
    'async function exportPortableViewer',
    'const DEFAULT_DSL =',
    'window.onload = async'
  ];
  let cutAt = -1;
  for (const marker of cutMarkers) {
    const idx = safeMain.indexOf(marker);
    if (idx >= 0 && (cutAt < 0 || idx < cutAt)) cutAt = idx;
  }
  if (cutAt >= 0) safeMain = safeMain.slice(0, cutAt);

  // IndexedDB 書き込みを無効化
  safeMain = safeMain.replace(/saveCanvasState\(\);/g, '/* saveCanvasState disabled in snapshot */');

  // モジュール読込時の即時 setup は、snapshot では boot 側で行う（DOM 準備後）
  safeMain = safeMain.replace(
    /\/\/ モジュール読込直後にDOMがあれば接続[\s\S]*?setupCanvasInteractions\(\);\s*/,
    '/* deferred setupCanvasInteractions in snapshot boot */\n'
  );

  return safeMain.trim() + '\n';
}

// parser + renderer + main を1本に結合（eval分割で共有変数が切れるのを防ぐ）
function buildSnapshotBundle(parserJs, rendererJs, mainJs) {
  const safeMain = prepareMainJsForSnapshot(mainJs);
  // 共有状態を window に載せる前置き（HTML側の let と二重になっても上書きで揃う）
  const prelude = [
    'window.__AETHER_SNAPSHOT__ = true;',
    'if (typeof window.scale !== "number") window.scale = 1.0;',
    'if (typeof window.panX !== "number") window.panX = 0;',
    'if (typeof window.panY !== "number") window.panY = 0;',
    'if (typeof window.isDragging !== "boolean") window.isDragging = false;',
    'if (typeof window.startX !== "number") window.startX = 0;',
    'if (typeof window.startY !== "number") window.startY = 0;',
    'if (typeof window.activeTag === "undefined") window.activeTag = null;',
    'if (!Array.isArray(window.notes)) window.notes = [];',
    'if (!Array.isArray(window.connections)) window.connections = [];',
    'if (!Array.isArray(window.drawings)) window.drawings = [];',
    'if (!Array.isArray(window.relations)) window.relations = [];',
    // グローバル識別子としても参照できるよう var を同期（eval 1本化と併用）
    'var scale = window.scale, panX = window.panX, panY = window.panY;',
    'var isDragging = window.isDragging, startX = window.startX, startY = window.startY;',
    'var activeTag = window.activeTag;',
    'var notes = window.notes, connections = window.connections, drawings = window.drawings, relations = window.relations;',
    ''
  ].join('\n');

  return [
    prelude,
    String(parserJs || ''),
    '\n',
    String(rendererJs || ''),
    '\n',
    safeMain,
    '\n'
  ].join('\n');
}

// Browser-only portable HTML export (no Python / no API server)
// JS/DSL は Base64 で埋め込み、file:// でも SyntaxError を起こさない
async function exportPortableViewer() {
  let dsl = document.getElementById('dsl-input').value;
  showToast('配布用HTMLを生成中...', 'success');

  try {
    dsl = await inlineRemoteImagesInDsl(dsl);

    // キャッシュで古い JS が混入しないよう bust
    const bust = 't=' + Date.now();
    const [cssText, parserJs, rendererJs, mainJs] = await Promise.all([
      fetchTextAsset('style.css?' + bust),
      fetchTextAsset('aether_parser.js?' + bust),
      fetchTextAsset('aether_renderer.js?' + bust),
      fetchTextAsset('aether_main.js?' + bust)
    ]);

    if (!cssText || !parserJs || !rendererJs || !mainJs) {
      throw new Error('asset_fetch_failed');
    }

    // parser+renderer+main を1本に結合して eval（分割evalのスコープ切断を根絶）
    const bundleJs = buildSnapshotBundle(parserJs, rendererJs, mainJs);

    // 構文チェック（壊れた bundle を配布しない）
    try {
      // eslint-disable-next-line no-new-func
      new Function(bundleJs);
    } catch (syntaxErr) {
      console.error('[Aether Export] snapshot script syntax error:', syntaxErr);
      throw new Error('snapshot_syntax_failed: ' + (syntaxErr && syntaxErr.message ? syntaxErr.message : syntaxErr));
    }

    const b64Css = utf8ToBase64(cssText);
    const b64Bundle = utf8ToBase64(bundleJs);
    const b64Dsl = utf8ToBase64(dsl);

    // ランタイムは極小。巨大コードは Base64 payload から decode+eval（1回のみ）
    const runtimeJs = [
      'window.__AETHER_SNAPSHOT__ = true;',
      'function __aetherB64ToUtf8(b64) {',
      '  var bin = atob(String(b64 || "").replace(/\\s+/g, ""));',
      '  var bytes = new Uint8Array(bin.length);',
      '  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);',
      '  return new TextDecoder("utf-8").decode(bytes);',
      '}',
      'function __aetherReadPayload(id) {',
      '  var el = document.getElementById(id);',
      '  return el ? String(el.textContent || "").replace(/\\s+/g, "") : "";',
      '}',
      'function __aetherBootSnapshot() {',
      '  try {',
      '    var code = __aetherB64ToUtf8(__aetherReadPayload("aether-src-bundle"));',
      '    (0, eval)(code);',
      '    if (typeof setupCanvasInteractions === "function") setupCanvasInteractions();',
      '    if (typeof refreshCanvasRefs === "function") refreshCanvasRefs();',
      '    var initialDSL = __aetherB64ToUtf8(__aetherReadPayload("aether-src-dsl"));',
      '    var input = document.getElementById("dsl-input");',
      '    if (input) input.value = initialDSL;',
      '    if (typeof applyDSL !== "function") throw new Error("applyDSL missing after bundle eval");',
      '    applyDSL();',
      '    var ncount = (typeof notes !== "undefined" && notes && notes.length) || (window.notes && window.notes.length) || 0;',
      '    var domCount = document.querySelectorAll(".sticky-note").length;',
      '    setTimeout(function () {',
      '      if (typeof fitToView === "function") fitToView();',
      '      console.log("[Aether Viewer] fit done. sticky DOM=", document.querySelectorAll(".sticky-note").length);',
      '    }, 80);',
      '    console.log("[Aether Viewer] Portable snapshot loaded. notes=", ncount, "dom=", domCount);',
      '    if (ncount === 0) throw new Error("DSL parsed 0 notes");',
      '  } catch (err) {',
      '    console.error("[Aether Viewer] boot failed:", err);',
      '    var msg = (err && err.message) ? err.message : String(err);',
      '    if (typeof showToast === "function") showToast("表示に失敗: " + msg, "error");',
      '    else alert("Aether 表示に失敗: " + msg);',
      '  }',
      '}',
      'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", __aetherBootSnapshot);',
      'else __aetherBootSnapshot();'
    ].join('\n');

    const htmlText = [
      '<!DOCTYPE html>',
      '<html lang="ja">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>Aether (Snapshot)</title>',
      '  <link rel="preconnect" href="https://fonts.googleapis.com">',
      '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&family=Plus+Jakarta+Sans:wght@300;400;600&display=swap" rel="stylesheet">',
      '  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">',
      '  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"><\/script>',
      '  <style id="aether-embedded-css"></style>',
      '</head>',
      '<body class="light-theme">',
      '  <div class="whiteboard-container" id="canvas-container">',
      '    <div class="tags-filter-bar" id="tags-filter-bar"></div>',
      '    <div class="canvas-transform" id="canvas-transform">',
      '      <svg class="connections-layer" id="svg-layer">',
      '        <defs>',
      '          <marker id="arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6"/></marker>',
      '          <marker id="arrow-purple" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8b5cf6"/></marker>',
      '          <marker id="arrow-green" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981"/></marker>',
      '          <marker id="arrow-pink" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ec4899"/></marker>',
      '          <marker id="arrow-yellow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#eab308"/></marker>',
      '          <marker id="arrow-default" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.4)"/></marker>',
      '          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" /></filter>',
      '        </defs>',
      '      </svg>',
      '      <div id="notes-container"></div>',
      '    </div>',
      '    <div class="time-slider-container" id="time-slider-container">',
      '      <input type="range" id="time-slider" min="0" max="0" value="0" oninput="handleTimeSlider(this.value)">',
      '      <div class="time-slider-labels" id="time-slider-labels"></div>',
      '    </div>',
      '    <div id="presentation-controller">',
      '      <button class="pres-btn" onclick="prevPresentationStep()" title="前のステップへ (Ctrl + ←)">◀ 前へ</button>',
      '      <div class="pres-step-info">',
      '        <span style="font-size: 0.7rem; opacity: 0.7; font-weight: normal; display: block;">PRESENTATION STEP</span>',
      '        <span class="pres-step-name" id="pres-step-name">すべて</span>',
      '      </div>',
      '      <button class="pres-btn" onclick="nextPresentationStep()" title="次のステップへ (Ctrl + →)">次へ ▶</button>',
      '      <button class="pres-btn pres-close-btn" onclick="togglePresentationMode(false)" title="プレゼンモードを終了 (Esc)">✖ 終了</button>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="control-panel" id="control-panel">',
      '    <button class="sidebar-toggle-btn" id="sidebar-toggle-btn" onclick="toggleSidebar()">◀</button>',
      '    <div class="panel-header">',
      '      <div class="panel-title-block">',
      '        <h1>🌌 Aether</h1>',
      '        <p>ポータブル・ビューワー</p>',
      '      </div>',
      '      <div class="panel-toolbar">',
      '        <button class="toolbar-btn" id="pres-mode-btn" onclick="togglePresentationMode()" title="プレゼンモード (P)">🎬</button>',
      '        <button class="toolbar-btn" onclick="zoom(0.1)" title="拡大">＋</button>',
      '        <button class="toolbar-btn" onclick="zoom(-0.1)" title="縮小">－</button>',
      '        <button class="toolbar-btn" onclick="fitToView()" title="全体表示 (F)">⊡</button>',
      '        <button class="toolbar-btn" onclick="resetTransform()" title="リセット">⟲</button>',
      '        <button class="toolbar-btn" id="theme-btn" onclick="toggleTheme()" title="テーマ切り替え">🌙</button>',
      '        <span id="scale-indicator" style="font-size: 0.75rem; color: var(--text-secondary); min-width: 35px; text-align: center;">100%</span>',
      '      </div>',
      '    </div>',
      '    <div class="tabs-header">',
      '      <button class="tab-btn" onclick="switchTab(\'dsl\')">{ } Aether DSL</button>',
      '      <button class="tab-btn active" onclick="switchTab(\'details\')" id="tab-btn-details">📖 詳細</button>',
      '    </div>',
      '    <div class="tab-content" id="tab-dsl">',
      '      <div class="dsl-editor-container">',
      '        <textarea class="dsl-textarea" id="dsl-input" placeholder="Aether DSL"></textarea>',
      '        <button class="btn btn-primary" style="width: 100%;" onclick="applyDSL()">キャンバスに適用</button>',
      '      </div>',
      '    </div>',
      '    <div class="tab-content active" id="tab-details">',
      '      <div id="details-view-container">',
      '        <div class="details-empty-state" style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">',
      '          <span style="font-size: 2.5rem; display: block; margin-bottom: 12px;">📖</span>',
      '          <p style="font-size: 0.85rem;">付箋をクリックすると詳細情報が表示されます。</p>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- payloads: Base64 only (never parsed as JS/HTML source) -->',
      '  <script type="text/plain" id="aether-src-css">' + b64Css + '<\/script>',
      '  <script type="text/plain" id="aether-src-bundle">' + b64Bundle + '<\/script>',
      '  <script type="text/plain" id="aether-src-dsl">' + b64Dsl + '<\/script>',
      '',
      '  <script>',
      '    // inject CSS first',
      '    (function(){',
      '      function b64(s){var bin=atob(String(s||"").replace(/\\s+/g,""));var u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new TextDecoder("utf-8").decode(u);}',
      '      var el=document.getElementById("aether-src-css");',
      '      var st=document.getElementById("aether-embedded-css");',
      '      if(el&&st) st.textContent=b64(el.textContent);',
      '    })();',
      '  <\/script>',
      '  <script>',
      '    // var で宣言し window と eval バンドルから確実に共有する',
      '    var scale = 1.0; var panX = 0; var panY = 0; var isDragging = false; var startX = 0; var startY = 0; var activeTag = null;',
      '    var notes = []; var connections = []; var drawings = []; var relations = [];',
      '    window.scale = scale; window.panX = panX; window.panY = panY;',
      '    window.notes = notes; window.connections = connections; window.drawings = drawings; window.relations = relations;',
      '  <\/script>',
      '  <script>',
      runtimeJs,
      '  <\/script>',
      '</body>',
      '</html>'
    ].join('\n');

    const blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const titleMatch = dsl.match(/sticky\s+\w+\s+"([^"]+)"/);
    const title = titleMatch ? titleMatch[1].replace(/[\\\/:*?"<>|]/g, '_') : 'board';
    a.href = url;
    a.download = 'aether_' + title + '_snapshot.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('配布用HTMLを出力しました！（Base64版）', 'success');
  } catch (err) {
    console.error('[Aether Standalone Export] Failed:', err);
    const isFile = location.protocol === 'file:';
    showToast(
      isFile
        ? '配布用HTML出力にはHTTP起動が必要です（例: npx serve）。閲覧・編集・DnDは file:// でも動作します。'
        : '配布用HTML出力に失敗しました: ' + (err && err.message ? err.message : err),
      'error'
    );
  }
}

function triggerImportDSL() {
  document.getElementById('dsl-file-input').click();
}

function handleImportDSL(event) {
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

function exportDSLToFile() {
  const dsl = document.getElementById('dsl-input').value;
  if (!dsl.trim()) {
    showToast('エクスポートするDSLデータがありません。', 'error');
    return;
  }

  let title = 'AetherBoard';
  const titleMatch = dsl.match(/sticky\s+\w+\s+"([^"]+)"/);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].replace(/[\\\/:*?"<>|]/g, '_');
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

const DEFAULT_DSL = "# Aether DSL Auto-Saved v3.0\n\nsticky Origin_J \"日本人起源論\" {\n  pos: 420 80\n  color: \"blue\"\n  tags: \"全体概要\"\n  desc: \"日本列島の人間集団がどのような系譜や混血プロセスを経て形成されたかを探る学術・文化論。古くは単一起源説から始まり、混血説、二重構造、そして現代ゲノム科学による三重構造モデルへと進化を遂げている。\"\n}\n\nsticky Y_D1a2a \"Y染色体D1a2a系統\" {\n  pos: 100 250\n  color: \"purple\"\n  tags: \"科学・論文説\"\n  desc: \"東アジアの他地域ではほぼ見られない日本列島特有のY染色体系統（約35%）。世界的にはチベットに親縁系統が存在し、縄文男系系譜を引き継ぐ証拠とされる。\\n\\nアインシュタインの方程式：$ E = mc^2 $\\n頻度の正規分布モデル：$$ f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{1}{2}\\left(\\frac{x-\\mu}{\\sigma}\\right)^2} $$\\n\\n![ゲノムDNA解析イメージ](https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=400)\"\n  time: \"1_縄文期\"\n  tone: \"stable\"\n}\n\nsticky Jomon_Single \"単一縄文人起源説\" {\n  pos: 420 250\n  color: \"green\"\n  tags: \"考古学・従来説\"\n  desc: \"日本列島の住民は、外部からの大規模な混血を経ずに、縄文人が直接的に現代日本人へと進化したとする極めて初期の説。近代以降の骨格比較研究やゲノム解析により、現在はこの仮説は否定されている。\"\n  time: \"1_縄文期\"\n  tone: \"tension\"\n}\n\nsticky Dual_Structure \"二重構造モデル (埴原和郎)\" {\n  pos: 740 250\n  color: \"green\"\n  tags: \"考古学・従来説\"\n  desc: \"1991年に人類学者・埴原和郎が提唱した定説。日本人は「東南アジア系祖先から派生した縄文人」と、「北東アジア系祖先から派生し弥生時代に大挙渡来した渡来人」の二重の系統の混血によって形成されたとする。\"\n  time: \"2_弥生期\"\n}\n\nsticky Triple_Structure \"現代ゲノムの三重構造モデル\" {\n  pos: 420 450\n  color: \"purple\"\n  tags: \"科学・論文説\"\n  desc: \"2021年の古代DNA解析によって提唱された最新モデル。従来の「縄文・弥生」の二重構造に加え、古墳時代に大陸から大量の「第3の祖先集団（東アジア系）」が渡来し現代日本人の遺伝的ベースを決定づけたとする説。\\n\\n| 祖先集団 | 推定割合 | 主な流入時期 |\\n|---|---|---|\\n| 縄文系 | 約13% | 縄文時代以前 |\\n| 弥生系 | 約30% | 弥生時代 |\\n| 古墳系 | 約57% | 古墳時代 |\"\n  time: \"3_古墳期\"\n}\n\nsticky SC_Paper_2021 \"2021年ゲノム解析論文\" {\n  pos: 100 450\n  color: \"purple\"\n  tags: \"科学・論文説\"\n  desc: \"金沢大学や理化学研究所などの共同研究チームがサイエンス誌の姉妹紙に発表した画期的な論文。縄文人・弥生人・古墳人の古代ゲノムを解読し、現代日本人のルーツが古墳時代に完成した『三重構造』であることを初めて実証した。\"\n  time: \"3_古墳期\"\n}\n\nsticky YT_Lost_Tribes \"日ユ同祖論 (失われた10支族)\" {\n  pos: 740 650\n  color: \"yellow\"\n  tags: \"YouTube・オカルト説\"\n  desc: \"古代イスラエルの失われた10支族の一部が日本列島に渡来し、大和民族の祖先および皇室のルーツになったとする説。言語や神道儀礼の類似性が指摘されるが、学術的な歴史学やゲノム科学からはオカルト（疑似科学）と分類される。\"\n  time: \"4_現代ネット言説\"\n}\n\nsticky YT_D_Special \"D系統神秘論 (神の遺伝子)\" {\n  pos: 420 650\n  color: \"yellow\"\n  tags: \"YouTube・オカルト説\"\n  desc: \"Y染色体ハプログループD系統（D1a2a）を、「神に選ばれた特別な遺伝子」「超能力や高い霊性の源」などと神秘主義的に解釈するYouTube動画やSNS上の通説。科学的なY染色体の単なる突然変異データを飛躍させ、ナショナリズムに結びつけたものである。\"\n  time: \"4_現代ネット言説\"\n  tone: \"excited\"\n}\n\ndrawing SC_AREA \"現代ゲノム科学検証領域\" {\n  type: \"circle-area\"\n  style: \"solid\"\n  color: \"purple\"\n  offset: 0 0\n  pos: 100 100\n  targets: \"Y_D1a2a SC_Paper_2021 Triple_Structure\"\n  tags: \"科学・論文説\"\n  time: \"3_古墳期\"\n}\n\ndrawing IC_DNA \"DNAゲノムデータ\" {\n  type: \"icon\"\n  style: \"database\"\n  color: \"purple\"\n  anchor: \"SC_Paper_2021\"\n  offset: -120 0\n  tags: \"科学・論文説\"\n  time: \"3_古墳期\"\n}\n\ndrawing IC_YT \"動画メディアの拡散\" {\n  type: \"icon\"\n  style: \"brain\"\n  color: \"yellow\"\n  anchor: \"YT_D_Special\"\n  offset: 140 0\n  tags: \"YouTube・オカルト説\"\n  time: \"4_現代ネット言説\"\n}\n\nrelation Y_D1a2a -> YT_D_Special {\n  type: \"conflict\"\n  label: \"学術的突然変異 vs 神秘主義的解釈\"\n  color: \"red\"\n  tags: \"YouTube・オカルト説\"\n  time: \"4_現代ネット言説\"\n}\n\nrelation YT_Lost_Tribes -> YT_D_Special {\n  type: \"influence\"\n  label: \"古代イスラエル結びつけの補強\"\n  color: \"yellow\"\n  tags: \"YouTube・オカルト説\"\n  time: \"4_現代ネット言説\"\n}\n\nrelation Dual_Structure -> Triple_Structure {\n  type: \"influence\"\n  label: \"ゲノム解析による精緻化\"\n  color: \"green\"\n  tags: \"科学・論文説\"\n  time: \"3_古墳期\"\n}\n\nrelation SC_Paper_2021 -> Triple_Structure {\n  type: \"similarity\"\n  label: \"古墳人DNAからの裏付け\"\n  color: \"purple\"\n  tags: \"科学・論文説\"\n  time: \"3_古墳期\"\n}\n\nrelation Jomon_Single -> Dual_Structure {\n  type: \"conflict\"\n  label: \"混血度合いを巡る対立\"\n  color: \"yellow\"\n  tags: \"考古学・従来説\"\n  time: \"2_弥生期\"\n}\n\nOrigin_J -> Y_D1a2a\nOrigin_J -> Jomon_Single\nOrigin_J -> Dual_Structure\n";

// Boot helpers: structured IndexedDB → legacy DSL → DEFAULT_DSL
async function applyDefaultOrCachedDsl() {
  try {
    // 1) 構造化ストア優先（notes があれば DSL 再構成して適用）
    const structured = await loadStructuredStateFromDB();
    if (structured && structured.notes && structured.notes.length) {
      const dsl = (() => {
        notes = structured.notes;
        drawings = structured.drawings || [];
        relations = structured.relations || [];
        connections = structured.connections || [];
        if (typeof window !== 'undefined') {
          window.notes = notes;
          window.drawings = drawings;
          window.relations = relations;
          window.connections = connections;
        }
        return buildDSLFromState();
      })();
      document.getElementById('dsl-input').value = dsl;
      // applyDSL は再パース＋差分同期する（初回はほぼ no-op 差分）
      applyDSL();
      console.log('[Aether IndexedDB] Loaded structured stores.');
      return;
    }

    // 2) legacy board_state.current_dsl
    const db = await initDB();
    if (db.objectStoreNames.contains(STORE_NAME)) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const legacyDsl = await idbReq(tx.objectStore(STORE_NAME).get('current_dsl'));
      await idbTxDone(tx);
      if (legacyDsl && String(legacyDsl).trim()) {
        document.getElementById('dsl-input').value = legacyDsl;
        applyDSL(); // パース後に構造化ストアへマイグレーション
        console.log('[Aether IndexedDB] Loaded legacy current_dsl and migrated.');
        return;
      }
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
  setupCanvasInteractions();
  setupDragAndDrop();

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
