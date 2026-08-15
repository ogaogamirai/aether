// Aether3D Core — Phase 1 OGL レンダラ（ノード + エッジ + Orbit）
// 依存: vendor/ogl.min.js（OGL グローバル）
(function (global) {
  'use strict';
  const OGL = global.OGL;

  const COLOR_MAP = {
    yellow: '#f6c453', blue: '#4a90d9', red: '#e05a5a', green: '#5aa86b',
    purple: '#9a6bd9', orange: '#e09a4a', pink: '#e07ab0', cyan: '#5ac8d9',
    gray: '#8a8a8a', grey: '#8a8a8a', white: '#eeeeee', black: '#333333',
  };

  function colorToHex(c) {
    if (!c) return '#f6c453';
    const s = String(c).trim();
    if (s[0] === '#') return s;
    return COLOR_MAP[s.toLowerCase()] || '#f6c453';
  }

  const VERTEX = [
    'attribute vec3 position;',
    'attribute vec3 normal;',
    'uniform mat4 modelViewMatrix;',
    'uniform mat4 projectionMatrix;',
    'uniform mat3 normalMatrix;',
    'varying vec3 vNormal;',
    'void main() {',
    '  vNormal = normalize(normalMatrix * normal);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n');

  const FRAGMENT = [
    'precision highp float;',
    'varying vec3 vNormal;',
    'uniform vec3 uColor;',
    'void main() {',
    '  float light = 0.55 + 0.45 * abs(normalize(vNormal).z);',
    '  gl_FragColor = vec4(uColor * light, 1.0);',
    '}',
  ].join('\n');

  function createRenderer(canvas, width, height) {
    const renderer = new OGL.Renderer({ canvas, width, height, antialias: true });
    const gl = renderer.gl;
    const camera = new OGL.Camera(gl, { fov: 45, near: 0.1, far: 8000 });
    camera.position.set(0, 0, 900);
    camera.lookAt(new OGL.Vec3(0, 0, 0));
    const scene = new OGL.Transform();
    return { renderer, gl, camera, scene };
  }

  function makeProgram(gl, hexColor) {
    return new OGL.Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      cullFace: false,
      uniforms: {
        uColor: { value: new OGL.Color(hexColor) },
      },
    });
  }

  // 正多角形ジオメトリ（z=0 平面・fan）
  function polygonGeometry(gl, sides, radius) {
    const pos = [0, 0, 0];
    const nor = [0, 0, 1];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      pos.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      nor.push(0, 0, 1);
    }
    const idx = [];
    for (let i = 0; i < sides; i++) {
      idx.push(0, i + 1, ((i + 1) % sides) + 1);
    }
    return new OGL.Geometry(gl, {
      position: { size: 3, data: new Float32Array(pos) },
      normal: { size: 3, data: new Float32Array(nor) },
      index: { data: new Uint16Array(idx) },
    });
  }

  // 菱形（4頂点）ジオメトリ
  function diamondGeometry(gl, w, h) {
    const pos = [0, h, 0, w, 0, 0, 0, -h, 0, -w, 0, 0];
    const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    const idx = [0, 1, 2, 0, 2, 3];
    return new OGL.Geometry(gl, {
      position: { size: 3, data: new Float32Array(pos) },
      normal: { size: 3, data: new Float32Array(nor) },
      index: { data: new Uint16Array(idx) },
    });
  }

  // 2点ラインジオメトリ
  function lineGeometry(gl, ax, ay, bx, by) {
    const pos = [ax, ay, 0, bx, by, 0];
    const nor = [0, 0, 1, 0, 0, 1];
    const idx = [0, 1];
    return new OGL.Geometry(gl, {
      position: { size: 3, data: new Float32Array(pos) },
      normal: { size: 3, data: new Float32Array(nor) },
      index: { data: new Uint16Array(idx) },
    });
  }

  function nodeGeometry(gl, shape, size) {
    switch (shape) {
      case 'circle': return polygonGeometry(gl, 24, size);
      case 'hexagon': return polygonGeometry(gl, 6, size);
      case 'diamond': return diamondGeometry(gl, size, size);
      case 'square':
      default: return new OGL.Box(gl, { width: size, height: size, depth: size * 0.35 });
    }
  }

  function buildNode(gl, shape, hexColor, x, y, size) {
    const geometry = nodeGeometry(gl, shape, size);
    const program = makeProgram(gl, hexColor);
    const mesh = new OGL.Mesh(gl, { geometry, program });
    mesh.position.set(x, y, 0);
    mesh.userData = { isNode: true };
    return mesh;
  }

  const EDGE_VERTEX = [
    'precision highp float;',
    'attribute vec3 position;',
    'uniform mat4 modelViewMatrix;',
    'uniform mat4 projectionMatrix;',
    'void main() {',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n');

  const EDGE_FRAGMENT = [
    'precision highp float;',
    'uniform vec3 uColor;',
    'void main() {',
    '  gl_FragColor = vec4(uColor, 1.0);',
    '}',
  ].join('\n');

  function buildEdge(gl, hexColor, ax, ay, bx, by) {
    const thickness = 5;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * thickness, ny = (dx / len) * thickness;
    const pos = [
      ax + nx, ay + ny, 0,
      bx + nx, by + ny, 0,
      bx - nx, by - ny, 0,
      ax - nx, ay - ny, 0,
    ];
    const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    const idx = [0, 1, 2, 0, 2, 3];
    const geometry = new OGL.Geometry(gl, {
      position: { size: 3, data: new Float32Array(pos) },
      normal: { size: 3, data: new Float32Array(nor) },
      index: { data: new Uint16Array(idx) },
    });
    const program = new OGL.Program(gl, {
      vertex: EDGE_VERTEX,
      fragment: EDGE_FRAGMENT,
      cullFace: false,
      uniforms: {
        uColor: { value: new OGL.Color(hexColor) },
      },
    });
    return new OGL.Mesh(gl, { geometry, program });
  }

  const SURFACE_VERTEX = [
    'precision highp float;',
    'attribute vec3 position;',
    'uniform mat4 modelViewMatrix;',
    'uniform mat4 projectionMatrix;',
    'uniform mat3 normalMatrix;',
    'uniform float uAmp;',
    'uniform float uFreq;',
    'uniform float uPhase;',
    'uniform float uBend;',
    'varying vec3 vNormal;',
    'varying vec3 vWorld;',
    'void main() {',
    '  vec3 p = position;',
    '  float h = uAmp * sin(p.x * uFreq + uPhase) * cos(p.y * uFreq);',
    '  p.z += h;',
    '  p.z += uBend * (p.x * p.x + p.y * p.y);',
    '  float eps = 0.01;',
    '  float hx = uAmp * (sin((p.x + eps) * uFreq + uPhase) * cos(p.y * uFreq) - h) / eps;',
    '  float hy = uAmp * (sin(p.x * uFreq + uPhase) * cos((p.y + eps) * uFreq) - h) / eps;',
    '  float bx = 2.0 * uBend * p.x;',
    '  float by = 2.0 * uBend * p.y;',
    '  vNormal = normalize(normalMatrix * vec3(-hx - bx, -hy - by, 1.0));',
    '  vWorld = p;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '}',
  ].join('\n');

  const SURFACE_FRAGMENT = [
    'precision highp float;',
    'varying vec3 vNormal;',
    'varying vec3 vWorld;',
    'uniform vec3 uColor;',
    'void main() {',
    '  float light = 0.45 + 0.55 * abs(normalize(vNormal).z);',
    '  gl_FragColor = vec4(uColor * light, 1.0);',
    '}',
  ].join('\n');

  function buildSurface(gl, opts) {
    const width = opts.width || 400;
    const height = opts.height || 400;
    const segments = opts.segments || 64;
    const geometry = new OGL.Plane(gl, { width, height, widthSegments: segments, heightSegments: segments });
    const program = new OGL.Program(gl, {
      vertex: SURFACE_VERTEX,
      fragment: SURFACE_FRAGMENT,
      cullFace: false,
      uniforms: {
        uColor: { value: new OGL.Color(opts.color || '#5ac8d9') },
        uAmp: { value: opts.amp || 60 },
        uFreq: { value: opts.freq || 0.03 },
        uPhase: { value: 0 },
        uBend: { value: 0 },
      },
    });
    const mesh = new OGL.Mesh(gl, { geometry, program });
    mesh.userData = { isSurface: true, opts };
    return mesh;
  }

  function updateSurface(mesh, params) {
    const u = mesh.program.uniforms;
    if (params.amp !== undefined) u.uAmp.value = params.amp;
    if (params.freq !== undefined) u.uFreq.value = params.freq;
    if (params.phase !== undefined) u.uPhase.value = params.phase;
    if (params.bend !== undefined) u.uBend.value = params.bend;
  }

  const PARTICLE_VERTEX = [
    'precision highp float;',
    'attribute vec3 position;',
    'attribute vec3 aStart;',
    'attribute vec3 aEnd;',
    'uniform float uTime;',
    'uniform float uSpeed;',
    'uniform mat4 modelViewMatrix;',
    'uniform mat4 projectionMatrix;',
    'varying float vAlpha;',
    'void main() {',
    '  float progress = fract(position.x + uTime * uSpeed);',
    '  vec3 p = mix(aStart, aEnd, progress);',
    '  vAlpha = sin(progress * 3.14159);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
    '  gl_PointSize = 8.0;',
    '}',
  ].join('\n');

  const PARTICLE_FRAGMENT = [
    'precision highp float;',
    'varying float vAlpha;',
    'uniform vec3 uColor;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  float d = length(uv);',
    '  if (d > 0.5) discard;',
    '  float alpha = (1.0 - d * 2.0) * vAlpha;',
    '  gl_FragColor = vec4(uColor, alpha);',
    '}',
  ].join('\n');

  // edges: [ [ax,ay], [bx,by] ] の配列
  function buildFlowParticles(gl, edges, opts) {
    const perEdge = (opts && opts.perEdge) || 20;
    const positions = [];
    const starts = [];
    const ends = [];
    edges.forEach(([a, b]) => {
      for (let i = 0; i < perEdge; i++) {
        positions.push(i / perEdge, 0, 0);
        starts.push(a[0], a[1], 0);
        ends.push(b[0], b[1], 0);
      }
    });
    const geometry = new OGL.Geometry(gl, {
      position: { size: 3, data: new Float32Array(positions) },
      aStart: { size: 3, data: new Float32Array(starts) },
      aEnd: { size: 3, data: new Float32Array(ends) },
    });
    const program = new OGL.Program(gl, {
      vertex: PARTICLE_VERTEX,
      fragment: PARTICLE_FRAGMENT,
      transparent: true,
      depthTest: false,
      uniforms: {
        uColor: { value: new OGL.Color((opts && opts.color) || '#ffcc55') },
        uTime: { value: 0 },
        uSpeed: { value: (opts && opts.speed) || 0.12 },
      },
    });
    const mesh = new OGL.Mesh(gl, { geometry, program, mode: gl.POINTS });
    mesh.userData = { isFlow: true };
    return mesh;
  }

  function updateFlow(mesh, time) {
    mesh.program.uniforms.uTime.value = time;
  }

  global.Aether3DCore = {
    colorToHex,
    createRenderer,
    buildNode,
    buildEdge,
    buildSurface,
    updateSurface,
    buildFlowParticles,
    updateFlow,
  };
})(typeof window !== 'undefined' ? window : globalThis);
