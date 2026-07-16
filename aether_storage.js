// Aether Structured IndexedDB Storage v4.0

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

function allocUniqueId(used, base) {
  const root = String(base || 'item') || 'item';
  if (!used.has(root)) {
    used.add(root);
    return root;
  }
  let i = 2;
  let next = root + '_' + i;
  while (used.has(next)) {
    i += 1;
    next = root + '_' + i;
  }
  used.add(next);
  return next;
}

// IndexedDB keyPath 衝突を避ける。配列順は維持し、後勝ちではなく後続をリネーム。
function dedupeCanvasState(raw) {
  const state = {
    notes: Array.isArray(raw && raw.notes) ? raw.notes : [],
    drawings: Array.isArray(raw && raw.drawings) ? raw.drawings : [],
    relations: Array.isArray(raw && raw.relations) ? raw.relations : [],
    connections: Array.isArray(raw && raw.connections) ? raw.connections : []
  };
  const renames = [];
  const usedNotes = new Set();
  const usedDrawings = new Set();
  const usedRelations = new Set();
  const usedConnections = new Set();

  state.notes.forEach((note) => {
    const prev = String(note.id || '');
    const next = allocUniqueId(usedNotes, prev);
    if (next !== prev) {
      note.id = next;
      renames.push({ kind: 'sticky', from: prev, to: next });
    }
  });

  state.drawings.forEach((dw) => {
    const prev = String(dw.id || '');
    const next = allocUniqueId(usedDrawings, prev);
    if (next !== prev) {
      dw.id = next;
      renames.push({ kind: 'drawing', from: prev, to: next });
    }
  });

  state.relations.forEach((rel) => {
    const base = relationStoreId(rel);
    let key = base;
    if (usedRelations.has(key)) {
      let i = 2;
      key = base + '#' + i;
      while (usedRelations.has(key)) {
        i += 1;
        key = base + '#' + i;
      }
      renames.push({ kind: 'relation', from: base, to: key });
    }
    usedRelations.add(key);
    rel._storeId = key;
  });

  state.connections.forEach((conn) => {
    const base = connectionStoreId(conn);
    let key = base;
    if (usedConnections.has(key)) {
      let i = 2;
      key = base + '#' + i;
      while (usedConnections.has(key)) {
        i += 1;
        key = base + '#' + i;
      }
      renames.push({ kind: 'connection', from: base, to: key });
    }
    usedConnections.add(key);
    conn._storeId = key;
  });

  return { state, renames };
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
    tone: note.tone || '',
    role: note.role || '',
    confidence: note.confidence || ''
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
    id: rel._storeId || relationStoreId(rel),
    from: rel.from,
    to: rel.to,
    type: rel.type || 'default',
    label: rel.label || '',
    color: rel.color || 'blue',
    tags: Array.isArray(rel.tags) ? rel.tags.slice() : [],
    time: rel.time || '',
    weight: rel.weight !== undefined && rel.weight !== null ? String(rel.weight) : '',
    flow: rel.flow || ''
  };
}

function normalizeConnectionForStore(conn) {
  return {
    id: conn._storeId || connectionStoreId(conn),
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
  if (typeof isAetherLiveMode === 'function' && isAetherLiveMode()) return;
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
    await idbTxDone(tx);
    // エディタ座標だけ即時反映（全文 rebuild は重いので座標行のみ置換）
    patchDslInputNotePos(noteId, newX, newY);
    // 起動は legacy current_dsl 優先のため、ドラッグ後も全文ミラーを同期
    const input = document.getElementById('dsl-input');
    if (input && input.value && db.objectStoreNames.contains(STORE_NAME)) {
      const txLegacy = db.transaction(STORE_NAME, 'readwrite');
      txLegacy.objectStore(STORE_NAME).put(input.value, 'current_dsl');
      await idbTxDone(txLegacy);
    }
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
  // LIVE中は監視ファイルが正本のため、input を buildDSL で上書きしない
  if (storeNames.includes(STORE_NAME)) {
    const live = typeof isAetherLiveMode === 'function' && isAetherLiveMode();
    const input = document.getElementById('dsl-input');
    const dsl = live && input && input.value
      ? input.value
      : buildDSLFromState();
    tx.objectStore(STORE_NAME).put(dsl, 'current_dsl');
    if (!live && input) input.value = dsl;
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
        tone: n.tone || '',
        role: n.role || '',
        confidence: n.confidence || ''
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
        time: r.time || '',
        weight: r.weight || '',
        flow: r.flow || ''
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

// legacy: board_state.current_dsl テキスト読込（順序保持のため legacy 優先）
async function loadFromDB() {
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains(STORE_NAME)) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const dsl = await idbReq(store.get('current_dsl'));
      await idbTxDone(tx);
      if (dsl && String(dsl).trim()) return dsl;
    }

    const structured = await loadStructuredStateFromDB();
    if (structured && structured.notes && structured.notes.length) {
      notes = structured.notes;
      drawings = structured.drawings || [];
      relations = structured.relations || [];
      connections = structured.connections || [];
      syncCanvasGlobals();
      return buildDSLFromState();
    }
    return null;
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
    if (note.role) dsl += '  role: "' + note.role + '"\n';
    if (note.confidence) dsl += '  confidence: "' + note.confidence + '"\n';
    dsl += '}\n\n';
  });
  drawings.forEach(dw => {
    if (dw.type === 'callout') {
      dsl += 'callout ' + dw.id + ' "' + dw.title + '" {\n';
      if (dw.anchor) dsl += '  anchor: "' + dw.anchor + '"\n';
      if (dw.offset) dsl += '  offset: ' + dw.offset[0] + ' ' + dw.offset[1] + '\n';
      if (dw.color) dsl += '  color: "' + dw.color + '"\n';
      if (dw.tags && dw.tags.length > 0) dsl += '  tags: "' + dw.tags.join(' ') + '"\n';
      if (dw.time) dsl += '  time: "' + dw.time + '"\n';
      dsl += '}\n\n';
      return;
    }
    if (dw.type === 'path') {
      dsl += 'path ' + dw.id + ' "' + dw.title + '" {\n';
      if (dw.targets && dw.targets.length > 0) dsl += '  nodes: "' + dw.targets.join(' ') + '"\n';
      if (dw.style) dsl += '  style: "' + dw.style + '"\n';
      if (dw.color) dsl += '  color: "' + dw.color + '"\n';
      if (dw.tags && dw.tags.length > 0) dsl += '  tags: "' + dw.tags.join(' ') + '"\n';
      if (dw.time) dsl += '  time: "' + dw.time + '"\n';
      dsl += '}\n\n';
      return;
    }
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
    if (rel.weight !== undefined && rel.weight !== null && String(rel.weight) !== '') {
      dsl += '  weight: ' + rel.weight + '\n';
    }
    if (rel.flow) dsl += '  flow: "' + rel.flow + '"\n';
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
  if (typeof isAetherLiveMode === 'function' && isAetherLiveMode()) return;
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
