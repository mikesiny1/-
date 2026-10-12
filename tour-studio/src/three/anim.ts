/** Small, continuous movement that makes a still interior feel lived-in. */
import * as THREE from 'three';

export const timeUniform = { value: 0 };

/** Curtains: a slow breeze that grows towards the hem (local Y spans the panel height). */
export function curtainBreeze(mat: THREE.Material, height = 2.6) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec4 wpos = modelMatrix * vec4(position, 1.0);
        float hem = clamp(0.5 - position.y / ${height.toFixed(2)}, 0.0, 1.0);
        float wave = sin(uTime * 0.8 + position.x * 7.0 + wpos.x * 0.7) * 0.6 + sin(uTime * 1.7 + position.x * 13.0) * 0.4;
        transformed.z += wave * 0.022 * hem * hem;
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'curtain-breeze';
}

/** Leaves: a barely visible sway, out of phase from plant to plant. */
export function leafSway(mat: THREE.Material) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec4 wpos = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float ph = wpos.x * 3.1 + wpos.z * 2.3 + wpos.y * 4.0;
        transformed.z += sin(uTime * 1.1 + ph) * 0.012 * position.y * 4.0;
        transformed.x += cos(uTime * 0.9 + ph) * 0.006 * position.y * 4.0;
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'leaf-sway';
}

/** Dust in the daylight: slowly drifting specks, only visible where light falls. */
export function dustMotes(bounds: { x0: number; z0: number; x1: number; z1: number }[], count = 320) {
  const pos: number[] = [];
  const seed: number[] = [];
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const area = bounds.reduce((a, b) => a + (b.x1 - b.x0) * (b.z1 - b.z0), 0) || 1;
  for (const b of bounds) {
    const n = Math.round((count * (b.x1 - b.x0) * (b.z1 - b.z0)) / area);
    for (let i = 0; i < n; i++) {
      pos.push(b.x0 + rnd() * (b.x1 - b.x0), 0.3 + rnd() * 2.1, b.z0 + rnd() * (b.z1 - b.z0));
      seed.push(rnd() * 100);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,248,235,1)');
  grd.addColorStop(1, 'rgba(255,248,235,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  const mat = new THREE.PointsMaterial({
    size: 0.008,
    map: new THREE.CanvasTexture(c),
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader =
      'uniform float uTime;\nattribute float seed;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed += vec3(sin(uTime * 0.11 + seed) * 0.25, sin(uTime * 0.07 + seed * 1.7) * 0.18, cos(uTime * 0.09 + seed * 0.6) * 0.25);`,
      );
  };
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
