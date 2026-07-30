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

// DSL テキストの export 時正規化（末尾空白・過剰空行のみ除去）
function normalizeDslForExport(dslText) {
  return String(dslText || '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
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

// JS bundle を gzip 圧縮して base64 化（非対応環境は plain フォールバック）
async function gzipUtf8ToBase64(str) {
  const bytes = new TextEncoder().encode(String(str || ''));
  if (typeof CompressionStream === 'undefined') {
    // fallback: uncompressed base64 via existing utf8ToBase64
    return { b64: utf8ToBase64(str), encoding: 'plain' };
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const ab = await new Response(stream).arrayBuffer();
  const u8 = new Uint8Array(ab);
  // base64 encode binary gzip
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return { b64: btoa(binary), encoding: 'gzip' };
}

// 配布HTML内の script / style タグを早期終了させないためのエスケープ
function escapeAsScriptPlain(text) {
  return String(text || '').replace(/<\/script/gi, '<\\/script');
}
function escapeAsStyle(text) {
  return String(text || '').replace(/<\/style/gi, '<\\/style');
}

// 配布用 JS: 文字列を保護し、コメント除去 + 冗長空白のみ圧縮（演算子/正規表現は触らない）
function minifySnapshotJs(src) {
  const held = [];
  const hold = (m) => {
    held.push(m);
    return '\u0000' + (held.length - 1) + '\u0000';
  };
  let s = String(src || '');

  // 文字列を退避してからコメント除去（正規表現リテラルの / は触らない）
  s = s.replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, hold);
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  // // コメント: 行頭または空白の後のみ（URL の http:// は文字列内で既に退避済み）
  s = s.replace(/(^|[\s;{}(),=])\/\/[^\n]*/gm, '$1');
  s = s.replace(/[ \t]+$/gm, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
  return s.trim() + '\n';
}

// CSS 軽量圧縮（url() 内の空白は触らない程度に安全側）
function minifySnapshotCss(src) {
  let s = String(src || '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*([{}:;,>])\s*/g, '$1');
  s = s.replace(/;}/g, '}');
  return s.trim();
}

// 直前トークンから「ここは正規表現リテラル開始の / か」を推定
function isRegexLiteralStart(src, slashIndex) {
  let p = slashIndex - 1;
  while (p >= 0 && /[ \t\r\n]/.test(src[p])) p--;
  if (p < 0) return true;
  const c = src[p];
  // 識別子・数値・) ] の直後の / は除算とみなす
  if (/[)\]\w$]/.test(c)) return false;
  return true;
}

// function <name> { ... } ブロックを文字列から完全削除（入れ子ブレース対応）
// 文字列・コメント・正規表現リテラル内の {} はカウントしない
function stripFunctionByName(src, name) {
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('function\\s+' + safeName + '\\s*\\(');
  let out = String(src || '');
  let match;
  while ((match = re.exec(out)) !== null) {
    let i = match.index;
    let j = i + match[0].length;
    let parenDepth = 1;
    while (j < out.length && parenDepth > 0) {
      const c = out[j];
      if (c === '(') parenDepth++;
      else if (c === ')') parenDepth--;
      j++;
    }
    while (j < out.length && /\s/.test(out[j])) j++;
    if (out[j] !== '{') break;
    let braceDepth = 1;
    let k = j + 1;
    while (k < out.length && braceDepth > 0) {
      const c = out[k];
      // コメントをスキップ
      if (c === '/' && (out[k + 1] === '/' || out[k + 1] === '*')) {
        if (out[k + 1] === '/') {
          const nl = out.indexOf('\n', k);
          k = nl === -1 ? out.length : nl + 1;
        } else {
          const end = out.indexOf('*/', k + 2);
          k = end === -1 ? out.length : end + 2;
        }
        continue;
      }
      // 正規表現リテラル（/pattern/flags）— 文字列内の " 誤認を防ぐ
      if (c === '/' && isRegexLiteralStart(out, k)) {
        k++;
        let inClass = false;
        while (k < out.length) {
          const rc = out[k];
          if (rc === '\\') { k += 2; continue; }
          if (rc === '[') { inClass = true; k++; continue; }
          if (rc === ']' && inClass) { inClass = false; k++; continue; }
          if (rc === '/' && !inClass) {
            k++;
            while (k < out.length && /[a-z]/i.test(out[k])) k++;
            break;
          }
          if (rc === '\n') break;
          k++;
        }
        continue;
      }
      // 文字列・テンプレートをスキップ
      if (c === '"' || c === "'" || c === '`') {
        const quote = c;
        k++;
        while (k < out.length) {
          const qc = out[k];
          if (qc === '\\') { k += 2; continue; }
          if (quote === '`' && qc === '$' && out[k + 1] === '{') {
            // テンプレート ${ ... } は簡易スキップ（ネスト最小）
            k += 2;
            let td = 1;
            while (k < out.length && td > 0) {
              if (out[k] === '{') td++;
              else if (out[k] === '}') td--;
              k++;
            }
            continue;
          }
          if (qc === quote) { k++; break; }
          k++;
        }
        continue;
      }
      if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;
      k++;
    }
    let end = k;
    while (end < out.length && /\s/.test(out[end]) && out[end] !== '\n') end++;
    if (out[end] === '\n') end++;
    out = out.slice(0, i) + out.slice(end);
    // 削除後は re.lastIndex をリセット（global なしだが位置ずれ対策で先頭から再検索）
    re.lastIndex = 0;
  }
  return out;
}

// 配布HTML向けに main から起動・巨大DEFAULTを除去（storage は同梱しない）
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

  // モジュール読込時の即時 setup は、snapshot では boot 側で行う（DOM 準備後）
  // IDB は prelude のスタブ + applyDSL の __AETHER_SNAPSHOT__ ガードで無効化
  safeMain = safeMain.replace(
    /\/\/ モジュール読込直後にDOMがあれば接続[\s\S]*?setupCanvasInteractions\(\);\s*/,
    '/* deferred setupCanvasInteractions in snapshot boot */\n'
  );

  // 配布HTMLでは不要なエディタ専用関数を削除
  for (const fn of ['setupDragAndDrop', 'triggerImportDSL', 'handleImportDSL', 'exportDSLToFile', 'ensureViewGlobals']) {
    safeMain = stripFunctionByName(safeMain, fn);
  }

  // 除去後に残った呼び出し行があれば消す
  safeMain = safeMain.replace(/ensureViewGlobals\s*\(\s*\)\s*;?/g, '');

  return safeMain.trim() + '\n';
}

// parser + renderer + main のみ（storage 除外で ~16KB+Base64 削減）
function buildSnapshotBundle(parserJs, rendererJs, mainJs) {
  const safeMain = prepareMainJsForSnapshot(mainJs);

  // parser 内のエクスポート専用関数は snapshot では不要
  let safeParser = String(parserJs || '');
  for (const fn of ['serializeCanvasToDSL', 'generateDSLFromCanvas']) {
    safeParser = stripFunctionByName(safeParser, fn);
  }

  // 共有状態 + IDB スタブ（表示・UI は維持、永続化のみ無効）
  const prelude = [
    'window.__AETHER_SNAPSHOT__ = true;',
    'if (typeof window.scale !== "number") window.scale = 1.0;',
    'if (typeof window.panX !== "number") window.panX = 0;',
    'if (typeof window.panY !== "number") window.panY = 0;',
    'if (typeof window.isDragging !== "boolean") window.isDragging = false;',
    'if (typeof window.startX !== "number") window.startX = 0;',
    'if (typeof window.startY !== "number") window.startY = 0;',
    'if (typeof window.activeTag === "undefined") window.activeTag = null;',
    'if (typeof window.focusedNoteId === "undefined") window.focusedNoteId = null;',
    'if (typeof window.activeTime === "undefined") window.activeTime = null;',
    'if (!Array.isArray(window.timeSteps)) window.timeSteps = [];',
    'if (typeof window.isPresentationMode !== "boolean") window.isPresentationMode = false;',
    'if (!Array.isArray(window.notes)) window.notes = [];',
    'if (!Array.isArray(window.connections)) window.connections = [];',
    'if (!Array.isArray(window.drawings)) window.drawings = [];',
    'if (!Array.isArray(window.relations)) window.relations = [];',
    // notes 等は再代入されるため free var エイリアスを維持。view 状態は window のみ。
    'var notes = window.notes, connections = window.connections, drawings = window.drawings, relations = window.relations;',
    'function syncBoardStateToDB(){return Promise.resolve();}',
    'function saveCanvasState(){}',
    'function updateNotePositionInDB(){return Promise.resolve();}',
    'function loadFromDB(){return Promise.resolve(null);}',
    'function loadStructuredStateFromDB(){return Promise.resolve(null);}',
    'function buildDSLFromState(){var el=document.getElementById("dsl-input");return el?el.value:"";}',
    'function initDB(){return Promise.reject(new Error("idb-disabled-in-snapshot"));}',
    ''
  ].join('\n');

  const raw = [
    prelude,
    safeParser,
    '\n',
    String(rendererJs || ''),
    '\n',
    safeMain,
    '\n'
  ].join('\n');

  return minifySnapshotJs(raw);
}

// Browser-only portable HTML export (no Python / no API server)
// JS/DSL は Base64 で埋め込み、file:// でも SyntaxError を起こさない
async function exportPortableViewer() {
  let dsl = document.getElementById('dsl-input').value;
  showToast('配布用HTMLを生成中...', 'success');

  try {
    dsl = await inlineRemoteImagesInDsl(dsl);
    dsl = normalizeDslForExport(dsl);

    // キャッシュで古い JS が混入しないよう bust
    // 配布ビューアは表示・UI のみ。IndexedDB(storage) は同梱しない（サイズ削減）
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

    const bundleJs = buildSnapshotBundle(parserJs, rendererJs, mainJs);
    const cssMin = minifySnapshotCss(cssText);

    // 構文チェック（壊れた bundle を配布しない）
    try {
      // eslint-disable-next-line no-new-func
      new Function(bundleJs);
    } catch (syntaxErr) {
      console.error('[Aether Export] snapshot script syntax error:', syntaxErr);
      throw new Error('snapshot_syntax_failed: ' + (syntaxErr && syntaxErr.message ? syntaxErr.message : syntaxErr));
    }

    const packed = await gzipUtf8ToBase64(bundleJs);
    const escapedDsl = escapeAsScriptPlain(dsl);
    const styleContent = escapeAsStyle(cssMin);

    // ランタイムは極小。JS bundle を Base64 デコード（gzip なら展開）して eval（1回のみ）
    // DSL・CSS は HTML 内にそのまま埋め込み（Base64 税を回避）
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
      'async function __aetherBootSnapshot() {',
      '  try {',
      '    var b64 = __aetherReadPayload("aether-src-bundle");',
      '    var encoding = document.getElementById("aether-src-bundle").getAttribute("data-encoding") || "plain";',
      '    var code;',
      '    if (encoding === "gzip") {',
      '      if (typeof DecompressionStream === "undefined") throw new Error("gzip payload requires DecompressionStream");',
      '      var bytes = Uint8Array.from(atob(b64), function(c) { return c.charCodeAt(0); });',
      '      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));',
      '      code = await new Response(stream).text();',
      '    } else {',
      '      code = __aetherB64ToUtf8(b64);',
      '    }',
      '    (0, eval)(code);',
      '    if (typeof setupCanvasInteractions === "function") setupCanvasInteractions();',
      '    if (typeof refreshCanvasRefs === "function") refreshCanvasRefs();',
      '    var dslEl = document.getElementById("aether-src-dsl");',
      '    var initialDSL = dslEl ? String(dslEl.textContent || "") : "";',
      '    var input = document.getElementById("dsl-input");',
      '    if (input) input.value = initialDSL;',
      '    if (typeof applyDSL !== "function") throw new Error("applyDSL missing after bundle eval");',
      '    applyDSL();',
      '    if (typeof initResponsiveView === "function") initResponsiveView();',
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
      '  <style id="aether-embedded-css">' + styleContent + '</style>',
      '</head>',
      '<body class="light-theme">',
      '  <div id="view-mode-bar" class="view-mode-bar" role="toolbar" aria-label="表示切替">',
      '    <span class="view-mode-label">表示</span>',
      '    <button type="button" class="view-mode-btn" data-view-mode="auto" onclick="setViewMode(\'auto\')" title="画面幅に応じて自動切替">自動</button>',
      '    <button type="button" class="view-mode-btn" data-view-mode="canvas" onclick="setViewMode(\'canvas\')" title="2Dキャンバス表示">PC</button>',
      '    <button type="button" class="view-mode-btn" data-view-mode="list" onclick="setViewMode(\'list\')" title="カード型リスト表示">リスト</button>',
      '  </div>',
      '  <div id="mobile-list-view" class="mobile-list-view" aria-label="モバイルリストビュー">',
      '    <div id="mobile-overview-panel" class="mobile-overview-panel"></div>',
      '    <div id="mobile-list-scroll" class="mobile-list-scroll"></div>',
      '    <nav id="mobile-bottom-nav" class="mobile-bottom-nav" aria-label="モバイルナビ"></nav>',
      '  </div>',
      '  <div id="mobile-detail-backdrop" class="mobile-detail-backdrop" hidden onclick="closeMobileDetail()"></div>',
      '  <div id="mobile-detail-sheet" class="mobile-detail-sheet" hidden role="dialog" aria-modal="true" aria-labelledby="mobile-detail-title">',
      '    <header class="mobile-detail-header">',
      '      <button type="button" class="mobile-detail-close" onclick="closeMobileDetail()">✕ 一覧へ戻る</button>',
      '      <span id="mobile-detail-position" class="mobile-detail-position">1 / 1</span>',
      '      <h2 id="mobile-detail-title" class="mobile-detail-title"></h2>',
      '    </header>',
      '    <div id="mobile-detail-body" class="mobile-detail-body"></div>',
      '    <footer class="mobile-detail-footer">',
      '      <button type="button" class="mobile-nav-btn" onclick="mobileDetailNavigate(-1)">◀ 前の付箋</button>',
      '      <button type="button" class="mobile-nav-btn mobile-nav-btn-primary" onclick="mobileDetailNavigate(1)">次の付箋 ▶</button>',
      '    </footer>',
      '  </div>',
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
      '    <div id="legend-panel" class="legend-panel" aria-label="ガイド（凡例とショートカット）">',
      '      <div class="legend-header">',
      '        <span class="legend-title">ガイド</span>',
      '        <button type="button" class="legend-close-btn" onclick="toggleLegend(false)" title="ガイドを閉じる">✖</button>',
      '      </div>',
      '      <div class="legend-body">',
      '        <div class="legend-section">',
      '          <div class="legend-section-title">ショートカット</div>',
      '          <div class="legend-row legend-shortcut"><kbd class="legend-kbd">F</kbd><span>全体表示</span></div>',
      '          <div class="legend-row legend-shortcut"><kbd class="legend-kbd">P</kbd><span>プレゼン ON/OFF</span></div>',
      '          <div class="legend-row legend-shortcut"><kbd class="legend-kbd">Ctrl</kbd><span class="legend-plus">+</span><kbd class="legend-kbd">←</kbd><kbd class="legend-kbd">→</kbd><span>プレゼン step 前後</span></div>',
      '          <div class="legend-row legend-shortcut"><kbd class="legend-kbd">Ctrl</kbd><span class="legend-plus">+</span><kbd class="legend-kbd">↑</kbd><kbd class="legend-kbd">↓</kbd><span>ズーム</span></div>',
      '          <div class="legend-row legend-shortcut"><kbd class="legend-kbd">↑</kbd><kbd class="legend-kbd">↓</kbd><kbd class="legend-kbd">←</kbd><kbd class="legend-kbd">→</kbd><span>選択付箋を移動</span></div>',
      '          <div class="legend-row legend-shortcut"><kbd class="legend-kbd">Esc</kbd><span>プレゼン終了 / 選択解除</span></div>',
      '        </div>',
      '        <div class="legend-section">',
      '          <div class="legend-section-title">ノードカラー</div>',
      '          <div class="legend-row"><span class="legend-swatch sticky-swatch yellow"></span><span>yellow</span></div>',
      '          <div class="legend-row"><span class="legend-swatch sticky-swatch blue"></span><span>blue</span></div>',
      '          <div class="legend-row"><span class="legend-swatch sticky-swatch green"></span><span>green</span></div>',
      '          <div class="legend-row"><span class="legend-swatch sticky-swatch pink"></span><span>pink</span></div>',
      '          <div class="legend-row"><span class="legend-swatch sticky-swatch purple"></span><span>purple</span></div>',
      '        </div>',
      '        <div class="legend-section">',
      '          <div class="legend-section-title">エッジの種類</div>',
      '          <div class="legend-row"><span class="legend-edge default"></span><span>default（実線矢印）</span></div>',
      '          <div class="legend-row"><span class="legend-edge influence"></span><span>influence（破線矢印）</span></div>',
      '          <div class="legend-row"><span class="legend-edge similarity"></span><span>similarity（二重線）</span></div>',
      '          <div class="legend-row"><span class="legend-edge conflict"></span><span>conflict（ジグザグ）</span></div>',
      '        </div>',
      '        <div class="legend-section">',
      '          <div class="legend-section-title">トーン（脈動）</div>',
      '          <div class="legend-row"><span class="legend-tone stable"></span><span>stable（静かな青）</span></div>',
      '          <div class="legend-row"><span class="legend-tone tension"></span><span>tension（緊迫の赤）</span></div>',
      '          <div class="legend-row"><span class="legend-tone excited"></span><span>excited（熱狂の橙）</span></div>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <button type="button" id="legend-open-btn" class="legend-open-btn" onclick="toggleLegend(true)" title="ガイドを表示" style="display:none;">📋 ガイド</button>',
      '  </div>',
      '',
      '  <div class="control-panel" id="control-panel">',
      '    <button class="sidebar-toggle-btn" id="sidebar-toggle-btn" onclick="toggleSidebar()">◀</button>',
      '    <div class="panel-header">',
      '      <div class="panel-title-block">',
      '        <h1 title="ポータブル・ビューワー">🌌 Aether</h1>',
      '      </div>',
      '      <div class="panel-toolbar">',
      '        <button class="toolbar-btn" id="pres-mode-btn" onclick="togglePresentationMode()" title="プレゼンモード (P)">🎬</button>',
      '        <button class="toolbar-btn" onclick="zoom(0.1)" title="拡大">＋</button>',
      '        <button class="toolbar-btn" onclick="zoom(-0.1)" title="縮小">－</button>',
      '        <button class="toolbar-btn" onclick="fitToView()" title="全体表示 (F)">⊡</button>',
      '        <button class="toolbar-btn" onclick="resetTransform()" title="リセット">⟲</button>',
      '        <button class="toolbar-btn" id="theme-btn" onclick="toggleTheme()" title="テーマ切り替え">🌙</button>',
      '        <span id="scale-indicator" class="scale-indicator">100%</span>',
      '      </div>',
      '    </div>',
      '    <div class="tabs-header">',
      '      <button class="tab-btn" onclick="switchTab(\'dsl\')">{ } Aether DSL</button>',
      '      <button class="tab-btn active" onclick="switchTab(\'details\')" id="tab-btn-details">📖 詳細</button>',
      '    </div>',
      '    <div class="tab-content" id="tab-dsl">',
      '      <div class="dsl-editor-container">',
      '        <textarea class="dsl-textarea" id="dsl-input" placeholder="Aether DSL"></textarea>',
      '        <div class="dsl-actions"><div class="dsl-actions-toolbar">',
      '          <button type="button" class="toolbar-btn" onclick="applyDSL()" title="DSLをキャンバスに適用">↓</button>',
      '        </div></div>',
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
      '  <!-- payloads: JS bundle as Base64/gzip; DSL as plain text; CSS embedded directly -->',
      '  <script type="text/plain" id="aether-src-bundle" data-encoding="' + packed.encoding + '">' + packed.b64 + '<\/script>',
      '  <script type="text/plain" id="aether-src-dsl">' + escapedDsl + '<\/script>',
      '',
      '  <script>',
      '    // notes 等は再代入共有。view/presentation は window のみ（free var 禁止）',
      '    window.scale = 1.0; window.panX = 0; window.panY = 0;',
      '    window.isDragging = false; window.startX = 0; window.startY = 0; window.activeTag = null;',
      '    window.focusedNoteId = null; window.activeTime = null; window.timeSteps = []; window.isPresentationMode = false;',
      '    var notes = []; var connections = []; var drawings = []; var relations = [];',
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
    showToast('配布用HTMLを出力しました！（軽量版・JS ' + (packed.encoding === 'gzip' ? 'gzip圧縮' : 'Base64') + '）', 'success');
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

// 読込確認用（DevTools で window.__AETHER_EXPORT_BUILD__ を確認）
window.__AETHER_EXPORT_BUILD__ = 'L2.1-mobile-ux-overhaul-v4.0.16';
