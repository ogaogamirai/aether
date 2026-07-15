// Aether Portable Export v4.0

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

// 配布HTML向けに combined main から起動・巨大DEFAULTを除去
function prepareMainJsForSnapshot(mainJs) {
  let safeMain = String(mainJs || '');

  // 配布HTMLに不要な起動処理・巨大 DEFAULT を除去
  const cutMarkers = [
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

// parser + renderer + combinedMain を1本に結合（eval分割で共有変数が切れるのを防ぐ）
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
    const [cssText, parserJs, rendererJs, storageJs, mainJs] = await Promise.all([
      fetchTextAsset('style.css?' + bust),
      fetchTextAsset('aether_parser.js?' + bust),
      fetchTextAsset('aether_renderer.js?' + bust),
      fetchTextAsset('aether_storage.js?' + bust),
      fetchTextAsset('aether_main.js?' + bust)
    ]);

    if (!cssText || !parserJs || !rendererJs || !storageJs || !mainJs) {
      throw new Error('asset_fetch_failed');
    }

    // storage + main を結合してから snapshot bundle 化（分割evalのスコープ切断を根絶）
    const combinedMain = String(storageJs || '') + '\n' + String(mainJs || '');
    const bundleJs = buildSnapshotBundle(parserJs, rendererJs, combinedMain);

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
      '          <marker id="arrow-default" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker>',
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
    const title = titleMatch ? titleMatch[1].replace(/[\\\/: *?"<>|]/g, '_') : 'board';
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
