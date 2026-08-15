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

  function buildEdge(gl, hexColor, ax, ay, bx, by) {
    const geometry = lineGeometry(gl, ax, ay, bx, by);
    const program = makeProgram(gl, hexColor);
    return new OGL.Mesh(gl, { geometry, program, mode: gl.LINES });
  }

  global.Aether3DCore = {
    colorToHex,
    createRenderer,
    buildNode,
    buildEdge,
  };
})(typeof window !== 'undefined' ? window : globalThis);
