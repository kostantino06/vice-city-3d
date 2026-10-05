/* =========================================================================
   VICE CITY 3D — open world in Three.js
   Fisica e logica di gioco collaudate sulla versione 2D, resa tridimensionale.
   ========================================================================= */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ===================== COSTANTI ===================== */
const WORLD = 1000;            // metri per lato
const BLOCK = 80;              // isolato
const ROADW = 17;              // carreggiata
const LANEHALF = ROADW * 0.25; // corsia
const GRID = Math.floor(WORLD / BLOCK); // 12x12 isolati

const CAR_COLORS = [0xd0524c, 0x4f83d0, 0xd9bb4a, 0x59c98c, 0x9563d0, 0xe2e2e2,
                    0x3c4756, 0xe08a3a, 0x2fa5a5, 0xc44fc0];
const PEDS_MAX = 46, CARS_MAX = 26;

/* ===================== UTILS ===================== */
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = a => a[(Math.random() * a.length) | 0];
const dist = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);
const dist2 = (ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; return dx * dx + dz * dz; };
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const TAU = Math.PI * 2;
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function angLerp(a, b, t) { return a + angDiff(a, b) * t; }
function angApproach(a, b, step) { const d = angDiff(a, b); return Math.abs(d) <= step ? b : a + Math.sign(d) * step; }

let isDev = location.search.includes('debug');
const loadfill = document.getElementById('loadfill');
const setLoad = (p, lbl) => { loadfill.style.width = p + '%'; if (lbl) document.querySelector('#loadbar .lbl').textContent = lbl; };

/* ===================== RENDERER / SCENA ===================== */
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,      // non serve: lo SSAO e' disattivato
  logarithmicDepthBuffer: false
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // ombre piu' morbide
renderer.toneMapping = THREE.ACESFilmicToneMapping; // rolloff realistico sulle alte luci
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();

/* ---------- CIELO: cupola con gradiente (tramonto) ---------- */
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0.00, '#16294f');   // zenit
  grd.addColorStop(0.30, '#3f6ba8');
  grd.addColorStop(0.55, '#8fb4dc');
  grd.addColorStop(0.72, '#e8c9a8');
  grd.addColorStop(0.84, '#ffb078');   // bagliore caldo
  grd.addColorStop(1.00, '#c2705f');
  g.fillStyle = grd;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// il gruppo segue la camera: cielo e sole restano "all'infinito"
const skyGroup = new THREE.Group();
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(760, 32, 20),
  new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, depthWrite: false, fog: false })
);
skyGroup.add(skyDome);
scene.add(skyGroup);

const HORIZON = new THREE.Color(0xe9c0a2);
scene.fog = new THREE.Fog(HORIZON.getHex(), 260, 1100);

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.5, 1600);

/* ---------- LUCI: sole basso + rimbalzo freddo ---------- */
const SUN_DIR = new THREE.Vector3(0.62, 0.30, 0.72).normalize();
const sun = new THREE.DirectionalLight(0xffd0a0, 2.7);
sun.position.copy(SUN_DIR).multiplyScalar(160);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; sc.near = 1; sc.far = 420;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// luce di rimbalzo dal lato opposto, fredda: separa i volumi
const fill = new THREE.DirectionalLight(0x9dc0ff, 0.45);
fill.position.set(-0.7, 0.5, -0.6).multiplyScalar(120);
scene.add(fill);
const hemi = new THREE.HemisphereLight(0xa8c8ee, 0x6b5a46, 0.85);
scene.add(hemi);
scene.add(new THREE.AmbientLight(0xffffff, 0.16));

/* =========================================================================
   CICLO GIORNO / NOTTE
   Tre fasi (giorno, tramonto, notte) con transizione fluida. Cambia luce,
   colore del cielo, nebbia, bagliore dei lampioni, finestre accese e fari.
   ========================================================================= */
const TIME_PRESETS = {
  day: {
    label: 'Giorno',
    sun: [0xfff4e0, 3.1], hemi: [0xbcd8f5, 0x6e7a52, 1.0],
    fog: 0xcfdcea, fogNear: 300, fogFar: 1300,
    sky: [[0.00, '#2f6fbd'], [0.42, '#7fb0e0'], [0.72, '#bcd6ea'], [1.00, '#dfe9f0']],
    lamp: 0.0, windows: 0.0, exposure: 1.0, ambient: 0.22
  },
  dusk: {
    label: 'Tramonto',
    sun: [0xffc890, 2.8], hemi: [0xa8c8ee, 0x6b5a46, 0.85],
    fog: 0xe9c0a2, fogNear: 260, fogFar: 1100,
    sky: [[0.00, '#16294f'], [0.30, '#3f6ba8'], [0.55, '#8fb4dc'], [0.72, '#e8c9a8'], [0.84, '#ffb078'], [1.00, '#c2705f']],
    lamp: 1.0, windows: 1.0, exposure: 1.0, ambient: 0.16
  },
  night: {
    label: 'Notte',
    sun: [0x9fb4e0, 0.35], hemi: [0x2a3a5c, 0x14161f, 0.35],
    fog: 0x0d1424, fogNear: 120, fogFar: 520,
    sky: [[0.00, '#04070f'], [0.40, '#0a1226'], [0.75, '#152038'], [1.00, '#243352']],
    lamp: 2.4, windows: 1.6, exposure: 1.25, ambient: 0.10
  }
};
const TIME_ORDER = ['day', 'dusk', 'night'];
let timePhase = 1;                    // parte al tramonto
let timeBlend = { from: 'dusk', to: 'dusk', t: 1 };

// cache delle texture cielo per evitare rigenerarle ogni frame
const skyTexCache = {};
function skyTextureFor(key) {
  if (skyTexCache[key]) return skyTexCache[key];
  const p = TIME_PRESETS[key];
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  for (const [pos, col] of p.sky) grd.addColorStop(pos, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  skyTexCache[key] = t;
  return t;
}

const _cA = new THREE.Color(), _cB = new THREE.Color(), _cOut = new THREE.Color();
function mixHex(a, b, t) {
  _cA.setHex(a); _cB.setHex(b);
  return _cOut.copy(_cA).lerp(_cB, t).getHex();
}

/* applica una fase, eventualmente mescolata con un'altra */
function applyTimePhase(fromKey, toKey, t) {
  const A = TIME_PRESETS[fromKey], B = TIME_PRESETS[toKey];
  const lerpN = (a, b) => a + (b - a) * t;

  sun.color.setHex(mixHex(A.sun[0], B.sun[0], t));
  sun.intensity = lerpN(A.sun[1], B.sun[1], t);
  hemi.color.setHex(mixHex(A.hemi[0], B.hemi[0], t));
  hemi.groundColor.setHex(mixHex(A.hemi[1], B.hemi[1], t));
  hemi.intensity = lerpN(A.hemi[2], B.hemi[2], t);

  scene.fog.color.setHex(mixHex(A.fog, B.fog, t));
  scene.fog.near = lerpN(A.fogNear, B.fogNear, t);
  scene.fog.far = lerpN(A.fogFar, B.fogFar, t);

  renderer.toneMappingExposure = lerpN(A.exposure, B.exposure, t);

  const lamp = lerpN(A.lamp, B.lamp, t);
  const win = lerpN(A.windows, B.windows, t);
  if (MATS.lamp) MATS.lamp.emissiveIntensity = lamp;
  if (MATS.shop) MATS.shop.emissiveIntensity = 0.30 * win;
  // finestre accese: di giorno spente, di notte luminose
  for (const m of facadeCache.values()) m.emissiveIntensity = 0.10 + 0.95 * win;
  // i fari dei veicoli si accendono al calare della luce
  if (MATS.headlight) {
    const on = clamp((lamp - 0.25) / 0.9, 0, 1);
    MATS.headlight.opacity = 0.5 * on;
  }
  M.headlight.emissiveIntensity = 1.5 * (0.25 + 0.75 * clamp((lamp - 0.2) / 1.0, 0, 1));

  nightFactor = clamp((lamp - 0.2) / 1.0, 0, 1);
}

function setTimePhase(idx, instant) {
  idx = (idx + TIME_ORDER.length) % TIME_ORDER.length;
  const from = TIME_ORDER[timePhase];
  const to = TIME_ORDER[idx];
  timePhase = idx;
  if (instant || from === to) {
    applyTimePhase(to, to, 1);
    timeBlend = { from: to, to: to, t: 1 };
    skyDome.material.map = skyTextureFor(to);
    skyDome.material.needsUpdate = true;
    if (to === 'night') { sunDisc.visible = false; }
    else { sunDisc.visible = true; sunDisc.material.color.setHex(to === 'day' ? 0xfff8e0 : 0xfff2cc); }
    showToast('Ora: ' + TIME_PRESETS[to].label, 1.8);
    return;
  }
  timeBlend = { from, to, t: 0 };
  showToast('Cambio ora: ' + TIME_PRESETS[to].label, 1.8);
}

function updateTimeBlend(dt) {
  if (timeBlend.t >= 1) return;
  timeBlend.t = Math.min(1, timeBlend.t + dt * 0.85);
  const e = timeBlend.t * timeBlend.t * (3 - 2 * timeBlend.t);   // ease-in-out
  applyTimePhase(timeBlend.from, timeBlend.to, e);
  // la cupola del cielo usa la texture della fase piu' vicina
  const near = e < 0.5 ? timeBlend.from : timeBlend.to;
  if (skyDome.material.map !== skyTextureFor(near)) {
    skyDome.material.map = skyTextureFor(near);
    skyDome.material.needsUpdate = true;
  }
  sunDisc.visible = near !== 'night';
}

// disco solare
const sunDisc = new THREE.Mesh(
  new THREE.CircleGeometry(42, 32),
  new THREE.MeshBasicMaterial({ color: 0xfff2cc, fog: false, transparent: true, opacity: 0.95 })
);
sunDisc.position.copy(SUN_DIR).multiplyScalar(600);
sunDisc.lookAt(0, 0, 0);
skyGroup.add(sunDisc);

/* ===================== MATERIALI ===================== */
/* Materiali creati altrove e che devono cambiare con l'ora del giorno
   (lampioni, finestre, neon). */
const MATS = {};

/* 0 = giorno pieno, 1 = notte. Usato per fari, bagliori e atmosfera. */
let nightFactor = 0.4;

const M = {
  facade: facadeMaterial,
  road: new THREE.MeshStandardMaterial({ color: 0x33363d, roughness: 0.95 }),
  roadLine: new THREE.MeshBasicMaterial({ color: 0xf0e196 }),
  sidewalk: new THREE.MeshStandardMaterial({ color: 0x8b8f98, roughness: 0.95 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x4a7d43, roughness: 1 }),
  grass2: new THREE.MeshStandardMaterial({ color: 0x568f4a, roughness: 1 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x7fb4e0, roughness: 0.18, metalness: 0.55 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x6a6f78, roughness: 0.9 }),
  roof2: new THREE.MeshStandardMaterial({ color: 0x7c828c, roughness: 0.85 }),
  cornice: new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.8 }),
  plinth: new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.7, metalness: 0.2 }),
  shop: new THREE.MeshStandardMaterial({
    color: 0x101822, roughness: 0.15, metalness: 0.5,
    emissive: 0xffcf8a, emissiveIntensity: 0.30
  }),
  window: new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.3, metalness: 0.4 }),
  // NOTA: le finestre degli edifici usano una facade texture con emissiveMap
  // (vedi facadeMaterial). Qui regoliamo l'intensita' per ora del giorno.
  carBody: new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.32 }),
  carTrim: new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.6, metalness: 0.3 }),
  glassCar: new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.12, metalness: 0.6 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xcfd4da, roughness: 0.25, metalness: 0.85 }),
  headlight: new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe9a0, emissiveIntensity: 1.5 }),
  taillight: new THREE.MeshStandardMaterial({ color: 0xff3322, emissive: 0xff2200, emissiveIntensity: 1.2 }),
  copBody: new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.4, metalness: 0.3 }),
  copDark: new THREE.MeshStandardMaterial({ color: 0x16203a, roughness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 2 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2060ff, emissive: 0x0044ff, emissiveIntensity: 2 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe8b48a, roughness: 0.85 }),
  shirt: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x2b3040, roughness: 0.9 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4f32, roughness: 0.9 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x3f8a45, roughness: 1 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffaa00, emissiveIntensity: 0.6, roughness: 0.4 }),
  green: new THREE.MeshStandardMaterial({ color: 0x7dff9b, emissive: 0x22ff55, emissiveIntensity: 0.6, roughness: 0.4 }),
  purple: new THREE.MeshStandardMaterial({ color: 0xd946ef, emissive: 0xa855f7, emissiveIntensity: 0.9, roughness: 0.3 }),
  metalGun: new THREE.MeshStandardMaterial({ color: 0x1f242c, roughness: 0.35, metalness: 0.85 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x3d271d, roughness: 0.65 }),
  rpgGreen: new THREE.MeshStandardMaterial({ color: 0x3b442b, roughness: 0.75, metalness: 0.25 }),
  taxiYellow: new THREE.MeshPhysicalMaterial({ color: 0xf6ba13, roughness: 0.35, metalness: 0.5, clearcoat: 0.9 }),
  taxiSign: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffc420, emissiveIntensity: 2.2, roughness: 0.2 }),
  gangBlack: new THREE.MeshPhysicalMaterial({ color: 0x181a1f, roughness: 0.45, metalness: 0.6, clearcoat: 0.7 }),
  gangRed: new THREE.MeshStandardMaterial({ color: 0xd92525, roughness: 0.4 }),
  white: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
};

/* Cache di materiali per facciata: evita di creare centinaia di texture.
   Chiave = dimensioni griglia finestre. */
const facadeCache = new Map();
function facadeMaterial(cols, rows) {
  const key = cols + 'x' + rows;
  let m = facadeCache.get(key);
  if (m) return m;
  const f = facadeTexture(cols, rows, (cols * 7919 + rows * 104729) % 2147483647);
  m = new THREE.MeshStandardMaterial({
    map: f.tex,
    emissiveMap: litTexture(f),
    emissive: 0xffffff,
    emissiveIntensity: 0.85,
    roughness: 0.82,
    metalness: 0.05
  });
  // la tinta del muro varia leggermente per palazzo, mantenendo la texture
  m.userData.tint = new THREE.Color().setHSL(rand(0, 1), rand(0.04, 0.14), rand(0.62, 0.82));
  facadeCache.set(key, m);
  return m;
}

/* Fascio di luce davanti ai fari: cheap (texture radiale) ma vende l'idea
   di "guidare al tramonto". */
let headlightTex = null;
function headlightTexture() {
  if (headlightTex) return headlightTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,240,200,.85)');
  grd.addColorStop(0.45, 'rgba(255,235,190,.35)');
  grd.addColorStop(1, 'rgba(255,230,180,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  headlightTex = new THREE.CanvasTexture(c);
  headlightTex.colorSpace = THREE.SRGBColorSpace;
  return headlightTex;
}
const headlightMat = new THREE.MeshBasicMaterial({
  map: headlightTexture(), transparent: true, opacity: 0.5,
  depthWrite: false, blending: THREE.AdditiveBlending
});
// di giorno i fari sono spenti: si accendono con il buio
MATS.headlight = headlightMat;

/* Bagliore caldo proiettato dai lampioni sull'asfalto */
let streetGlowTex = null;
function streetGlowTexture() {
  if (streetGlowTex) return streetGlowTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255, 220, 140, 0.65)');
  grd.addColorStop(0.5, 'rgba(255, 200, 100, 0.22)');
  grd.addColorStop(1, 'rgba(255, 180, 80, 0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  streetGlowTex = new THREE.CanvasTexture(c);
  streetGlowTex.colorSpace = THREE.SRGBColorSpace;
  return streetGlowTex;
}
const streetGlowMat = new THREE.MeshBasicMaterial({
  map: streetGlowTexture(), transparent: true, opacity: 0.55,
  depthWrite: false, blending: THREE.AdditiveBlending
});

/* Insegne Neon Vice City 80s per i palazzi */
const NEON_LABELS = [
  { text: 'OCEAN VIEW', color: '#ff2a8d', glow: '#ff007f' },
  { text: 'CLUB MALIBU', color: '#00f7ff', glow: '#00c3ff' },
  { text: 'HOTEL TROPIC', color: '#ffd000', glow: '#ff9900' },
  { text: 'VICE CASINO', color: '#ff3366', glow: '#ff0033' },
  { text: 'PALM BEACH', color: '#39ff14', glow: '#00e600' },
  { text: 'BAR SURF', color: '#e040fb', glow: '#d500f9' }
];

function makeNeonSignTexture(item) {
  if (item.tex) return item.tex;
  const W = 256, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0d14';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = item.glow;
  g.lineWidth = 4;
  g.strokeRect(4, 4, W - 8, H - 8);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1.5;
  g.strokeRect(6, 6, W - 12, H - 12);
  g.font = '900 24px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = item.glow;
  g.shadowBlur = 12;
  g.fillStyle = item.color;
  g.fillText(item.text, W / 2, H / 2);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.fillText(item.text, W / 2, H / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  item.tex = t;
  return t;
}

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
  cone: new THREE.ConeGeometry(0.5, 1, 10),
};
// piano inclinato: si stende sull'asfalto davanti all'auto
GEO.beam = new THREE.PlaneGeometry(1, 1);
GEO.beam.rotateX(-Math.PI / 2);
GEO.beam.translate(0, 0, 0.5);   // origine sul bordo anteriore

/* Ombra di contatto: disco scuro che "ancora" il personaggio al suolo.
   Costa niente e rende la scena molto più credibile. */
const blobGeo = new THREE.CircleGeometry(0.5, 16);
blobGeo.rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false
});
function makeBlob(r) {
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.scale.set(r, 1, r);
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}
// geometrie condivise per i pedoni
GEO.head = new THREE.SphereGeometry(0.22, 10, 8);
GEO.torso = new THREE.CapsuleGeometry(0.22, 0.42, 4, 8);
GEO.leg = new THREE.CapsuleGeometry(0.09, 0.34, 3, 6);

/* ---------- AMBIENT MAP ----------
   Un cubemap generato dalla cupola del cielo: senza un riflesso d'ambiente
   la clearcoat delle auto resta piatta. Costa una sola cubemap 256px. */
function buildEnvMap() {
  const sc2 = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide })
  );
  sc2.add(dome);
  // un disco chiaro dove sta il sole, per avere un Highlight sulle carrozzerie
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(9, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff4d8 })
  );
  disc.position.set(28, 14, 30);
  disc.lookAt(0, 0, 0);
  sc2.add(disc);
  // e uno scuro per dare contrasto
  const dark = new THREE.Mesh(
    new THREE.CircleGeometry(20, 16),
    new THREE.MeshBasicMaterial({ color: 0x5a5f6b })
  );
  dark.position.set(-30, 4, -24);
  dark.lookAt(0, 0, 0);
  sc2.add(dark);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let tex = null;
  try {
    const rt = pmrem.fromScene(sc2, 0.04);
    tex = rt.texture;
  } catch (e) {
    console.warn('env map non disponibile, si usa l\'illuminazione semplice', e);
  }
  pmrem.dispose();
  dome.geometry.dispose(); dome.material.dispose();
  disc.geometry.dispose(); disc.material.dispose();
  dark.geometry.dispose(); dark.material.dispose();
  return tex;
}
const envMap = buildEnvMap();
if (envMap) scene.environment = envMap;

/* ---------- SEMAFORI ----------
   Non solo estetica: gli incroci con semaforo fanno fermare il traffico,
   e i pedoni attraversano. E' la differenza tra "parco di scatole" e citta. */
const trafficLights = [];
function makeTrafficLight(cx, cz) {
  const g = new THREE.Group();
  // palo
  const pole = new THREE.Mesh(GEO.cyl, M.chrome);
  pole.scale.set(0.16, 4.2, 0.16);
  pole.position.y = 2.1;
  pole.castShadow = true;
  g.add(pole);
  // corpo della lanterna
  const boxL = new THREE.Mesh(GEO.box, M.plinth);
  boxL.scale.set(0.34, 0.95, 0.28);
  boxL.position.set(0, 4.6, 0);
  boxL.castShadow = true;
  g.add(boxL);
  // tre lanterne
  const cols = [0xff2a1a, 0xffcc22, 0x22ff44];
  const lamps = [];
  for (let i = 0; i < 3; i++) {
    const l = new THREE.Mesh(GEO.sphere, new THREE.MeshStandardMaterial({
      color: cols[i], emissive: cols[i], emissiveIntensity: 0.05, roughness: 0.3
    }));
    l.scale.setScalar(0.17);
    l.position.set(0, 4.95 - i * 0.30, -0.15);
    g.add(l);
    lamps.push(l);
  }
  g.position.set(cx, 0, cz);
  const tl = { g, lamps, state: 0, timer: rand(4, 9), x: cx, z: cz };
  trafficLights.push(tl);
  return tl;
}
function updateTrafficLights(dt) {
  for (const tl of trafficLights) {
    tl.timer -= dt;
    if (tl.timer <= 0) {
      tl.state = (tl.state + 1) % 3;
      tl.timer = tl.state === 2 ? rand(4, 8) : rand(3, 6);
    }
    for (let i = 0; i < 3; i++) {
      const on = i === tl.state;
      tl.lamps[i].material.emissiveIntensity = on ? 2.6 : 0.05;
    }
  }
}

/* Un incrocio ha semaforo rosso se il semaforo piu' vicino e' rosso e il
   veicolo e' vicino. Serve a far frenare il traffico in modo credibile. */
function redLightAhead(c) {
  const fx2 = Math.sin(c.a), fz2 = Math.cos(c.a);
  const ax = c.x + fx2 * 7, az = c.z + fz2 * 7;
  for (const tl of trafficLights) {
    if (dist2(ax, az, tl.x, tl.z) > 90) continue;
    if (tl.state !== 0) continue;            // non e' rosso
    return true;
  }
  return false;
}

/* ---------- FOGLIE E CORTECCE ----------
   Foglie alpha-tested: da' volume e un bordo irregolare. Senza, la chioma
   resta una sfera liscia e "plastica". */
function leafTexture(kind) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  const col = kind === 'palm'
    ? ['#3d7f3f', '#478f46', '#2f6a35']
    : ['#37703a', '#427f42', '#2c5c30', '#4d8f4a'];
  // molte piccole foglie sovrapposte: bordo sfrangiato
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.62) * (S / 2 - 6);
    const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
    const rad = 5 + Math.random() * 9;
    g.fillStyle = pick(col);
    g.save();
    g.translate(x, y);
    g.rotate(Math.random() * Math.PI);
    g.beginPath();
    g.ellipse(0, 0, rad, rad * 0.55, 0, 0, TAU);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function barkTexture() {
  const W = 64, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#6a5340';
  g.fillRect(0, 0, W, H);
  // scaglie verticali
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    g.fillStyle = Math.random() < .5 ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.08)';
    g.fillRect(x, y, 1 + Math.random() * 3, 3 + Math.random() * 9);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const leafMatBroad = new THREE.MeshStandardMaterial({
  map: leafTexture('broad'), transparent: true, alphaTest: 0.42,
  side: THREE.DoubleSide, roughness: 0.95
});
const leafMatPalm = new THREE.MeshStandardMaterial({
  map: leafTexture('palm'), transparent: true, alphaTest: 0.42,
  side: THREE.DoubleSide, roughness: 0.9
});
const barkMat = new THREE.MeshStandardMaterial({
  map: barkTexture(), roughness: 1
});

/* ---------- TEXTURE PROCEDURALI ----------
   Asfalto con grana: un colore piatto fa "giocattolo", la grana fa "reale". */
function asphaltTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3e46';
  g.fillRect(0, 0, S, S);
  // macchie d'asfalto
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const v = Math.random();
    g.fillStyle = v < .5 ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.05)';
    g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // crepe
  g.strokeStyle = 'rgba(0,0,0,.22)';
  for (let i = 0; i < 7; i++) {
    g.lineWidth = 0.6 + Math.random();
    g.beginPath();
    let x = Math.random() * S, y = Math.random() * S;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - .5) * 40; y += (Math.random() - .5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 3);
  M.road.map = t;
  M.road.color.setHex(0xffffff);   // il colore lo da' la texture
  M.road.roughness = 0.60;
  M.road.metalness = 0.30;
  M.road.needsUpdate = true;
  return t;
}

/* ALBERI: chioma composta da più lobi sovrapposti. Una sola sfera sembra
   un pallone; 4-6 lobi irregolari danno una silhouette credibile. */
function makeTree(x, z, scale) {
  const g = new THREE.Group();
  const h = rand(3.2, 6.2) * scale;
  // tronco con leggera curva
  const tr = new THREE.Mesh(GEO.cyl, barkMat);
  tr.scale.set(0.30 * scale, h, 0.30 * scale);
  tr.position.y = h / 2;
  tr.rotation.z = rand(-0.06, 0.06);
  tr.castShadow = true;
  g.add(tr);
  // radice/ciuffo alla base
  const base = new THREE.Mesh(GEO.cyl, barkMat);
  base.scale.set(0.5 * scale, 0.35 * scale, 0.5 * scale);
  base.position.y = 0.16 * scale;
  g.add(base);

  // chioma: lobi sovrapposti, leggermente diversi
  const lobes = randInt(4, 6);
  for (let i = 0; i < lobes; i++) {
    const r = rand(1.3, 2.2) * scale;
    const l = new THREE.Mesh(GEO.sphere, leafMatBroad);
    l.scale.set(r, r * rand(0.78, 1.0), r);
    const a = (i / lobes) * TAU + rand(-0.4, 0.4);
    const rr = i === 0 ? 0 : rand(0.5, 1.1) * scale;
    l.position.set(
      Math.cos(a) * rr,
      h + rand(-0.5, 0.9) * scale,
      Math.sin(a) * rr
    );
    l.castShadow = true;
    g.add(l);
  }
  g.position.set(x, 0, z);
  return g;
}

/* PALMA: tronco segmentato e fronde. È l'albero "da Florida" per eccellenza. */
function makePalm(x, z, scale) {
  const g = new THREE.Group();
  const h = rand(5, 9) * scale;
  const seg = new THREE.CylinderGeometry(0.20 * scale, 0.30 * scale, h, 8);
  const tr = new THREE.Mesh(seg, barkMat);
  tr.position.y = h / 2;
  tr.rotation.z = rand(-0.12, 0.12);
  tr.castShadow = true;
  g.add(tr);
  // anelli del tronco
  for (let i = 1; i < 6; i++) {
    const r = new THREE.Mesh(GEO.cyl, barkMat);
    const yy = (i / 6) * h;
    r.scale.set(lerp(0.60, 0.44, i / 6) * scale, 0.10 * scale, lerp(0.60, 0.44, i / 6) * scale);
    r.position.set(0, yy, 0);
    g.add(r);
  }
  const topX = Math.sin(tr.rotation.z) * h * 0.5;
  // fronde: piani con texture foglia, dispiegati a ventaglio
  const n = randInt(7, 9);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.2, 0.2);
    const frond = new THREE.Mesh(GEO.plane, leafMatPalm);
    frond.scale.set(1.5 * scale, 3.6 * scale, 1);
    // parte dalla corona e si alza, poi ricade
    frond.position.set(topX + Math.cos(a) * 1.2 * scale, h + 0.2, Math.sin(a) * 1.2 * scale);
    frond.rotation.y = -a;
    frond.rotation.x = rand(-0.55, -0.15);
    frond.rotation.z = rand(-0.2, 0.2);
    frond.castShadow = true;
    g.add(frond);
  }
  g.position.set(x, 0, z);
  return g;
}

/* Genero su canvas le texture delle facciate: griglia di finestre, alcune
   accese (per l'emissive map). Dà subito aria di "città vera". */
function facadeTexture(cols, rows, seed) {
  const W = Math.min(1024, Math.max(128, cols * 48));
  const H = Math.min(2048, Math.max(256, rows * 48));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const cw = W / cols, rh = H / rows;
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const lit = [];
  for (let r = 0; r < rows; r++) {
    for (let c2 = 0; c2 < cols; c2++) {
      const on = rnd() < 0.34;
      lit.push(on);
      const x = c2 * cw + cw * 0.18, y = r * rh + rh * 0.16;
      const w = cw * 0.64, h = rh * 0.58;
      // vetro scuro o finestra illuminata
      g.fillStyle = on ? '#ffe6ad' : '#2b3442';
      g.fillRect(x, y, w, h);
      if (on) { g.fillStyle = 'rgba(255,236,190,.45)'; g.fillRect(x, y, w, h * 0.4); }
    }
  }
  // fascia marcapiano
  g.fillStyle = 'rgba(0,0,0,.10)';
  for (let r = 0; r < rows; r++) g.fillRect(0, r * rh, W, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { tex: t, cols, rows, lit };
}

/* finestra accesa -> pixel bianco sulla mappa emissiva */
function litTexture(data) {
  const W = Math.min(1024, Math.max(128, data.cols * 48));
  const H = Math.min(2048, Math.max(256, data.rows * 48));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);
  const cols = data.cols, rows = data.rows;
  const cw = W / cols, rh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c2 = 0; c2 < cols; c2++) {
      if (!data.lit[r * cols + c2]) continue;
      const x = c2 * cw + cw * 0.18, y = r * rh + rh * 0.16;
      g.fillStyle = '#ffca7a';
      g.fillRect(x, y, cw * 0.64, rh * 0.58);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* =========================================================================
   MONDO
   ========================================================================= */
const buildings = [];   // {x,z,w,d,h} per la collisione
const colliders = new Map(); // cella -> rettangoli, per query rapida
const CELL = BLOCK;
const ckey = (i, j) => i + '_' + j;

function addCollider(x, z, w, d) {
  const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
  const k = ckey(i, j);
  if (!colliders.has(k)) colliders.set(k, []);
  colliders.get(k).push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
}
function nearbyColliders(x, z, r, out) {
  out.length = 0;
  const qR = Math.max(r, 22);
  const i0 = Math.floor((x - qR) / CELL), i1 = Math.floor((x + qR) / CELL);
  const j0 = Math.floor((z - qR) / CELL), j1 = Math.floor((z + qR) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const a = colliders.get(ckey(i, j));
    if (a) for (let k = 0; k < a.length; k++) out.push(a[k]);
  }
  return out;
}

function blockCenter(i, j) { return { x: i * BLOCK + BLOCK / 2, z: j * BLOCK + BLOCK / 2 }; }

// larghezza della carreggiata rispetto alla posizione (0 = centro strada, 1 = bordo)
function roadFactor(x, z) {
  const fx = Math.abs(((x + BLOCK / 2) % BLOCK) - BLOCK / 2);
  const fz = Math.abs(((z + BLOCK / 2) % BLOCK) - BLOCK / 2);
  // il gioco avviene sulle strade: bordi degli isolati a distanza BLOCK/2 - ROADW/2
  const lim = BLOCK / 2 - ROADW / 2;
  return Math.min(fx, fz) <= lim;
}
const _colBldg = [];
function inBuilding(x, z, pad) {
  const p = pad || 0;
  nearbyColliders(x, z, p + 0.1, _colBldg);
  for (const b of _colBldg) {
    if (x > b.x0 - p && x < b.x1 + p && z > b.z0 - p && z < b.z1 + p) return true;
  }
  return false;
}

/* spinge un corpo fuori dagli edifici */
const _col = [];
function pushOut(o, rad) {
  let hit = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    nearbyColliders(o.x, o.z, rad, _col);
    for (const b of _col) {
      const nx = clamp(o.x, b.x0, b.x1), nz = clamp(o.z, b.z0, b.z1);
      let dx = o.x - nx, dz = o.z - nz;
      let d2 = dx * dx + dz * dz;
      if (d2 >= rad * rad) continue;
      hit = true; moved = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        o.x += (dx / d) * (rad - d + 0.05);
        o.z += (dz / d) * (rad - d + 0.05);
      } else {
        const l = o.x - b.x0, r = b.x1 - o.x, t = o.z - b.z0, bo = b.z1 - o.z;
        const m = Math.min(l, r, t, bo);
        if (m === l) o.x = b.x0 - rad - 0.05;
        else if (m === r) o.x = b.x1 + rad + 0.05;
        else if (m === t) o.z = b.z0 - rad - 0.05;
        else o.z = b.z1 + rad + 0.05;
      }
    }
    if (!moved) break;
  }
  return hit;
}

/* ---------- generazione città ---------- */
const cityGroup = new THREE.Group();
scene.add(cityGroup);
const bldgGroup = new THREE.Group();
const roadGroup = new THREE.Group();
const propGroup = new THREE.Group();
cityGroup.add(roadGroup, bldgGroup, propGroup);

const up = new THREE.Vector3(0, 1, 0);

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(GEO.box, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

function buildCity() {
  setLoad(12, 'TERRENO');

  // prato di fondo
  const ground = new THREE.Mesh(GEO.plane, M.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(WORLD + 400, WORLD + 400, 1);
  ground.position.set(WORLD / 2, -0.06, WORLD / 2);
  ground.receiveShadow = true;
  cityGroup.add(ground);

  setLoad(25, 'STRADE');

  // strade: piano largo + strisce di mezzeria + traversee
  // texture dell'asfalto: grana + forma piuttosto che colore piatto
  const asphalt = asphaltTexture();
  for (let i = 0; i <= GRID; i++) {
    const p = i * BLOCK;
    const h = new THREE.Mesh(GEO.plane, M.road);
    h.rotation.x = -Math.PI / 2;
    h.scale.set(WORLD, ROADW, 1);
    h.position.set(WORLD / 2, 0.01, p);
    h.receiveShadow = true;
    roadGroup.add(h);
    const v = new THREE.Mesh(GEO.plane, M.road);
    v.rotation.x = -Math.PI / 2;
    v.scale.set(ROADW, WORLD, 1);
    v.position.set(p, 0.012, WORLD / 2);
    v.receiveShadow = true;
    roadGroup.add(v);
  }
  // linee tratteggiate (una mesh, geometrie unite)
  const dashGeo = new THREE.BufferGeometry();
  const dpos = [];
  for (let i = 0; i <= GRID; i++) {
    const p = i * BLOCK;
    for (let t = 0; t < WORLD; t += 11) {
      dpos.push(p, 0.03, t, p, 0.03, t + 5);
      dpos.push(t, 0.03, p, t + 5, 0.03, p);
    }
  }
  dashGeo.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  roadGroup.add(new THREE.LineSegments(dashGeo, new THREE.LineBasicMaterial({ color: 0xe8dc9a })));

  // traversee pedonali agli incroci
  const cwGeo = [];
  for (let i = 0; i <= GRID; i++) for (let j = 0; j <= GRID; j++) {
    const cx = i * BLOCK, cz = j * BLOCK;
    for (let s = -1; s <= 1; s += 2) {
      for (let k = 0; k < 6; k++) {
        const o = -ROADW / 2 + 1.6 + k * 2.6;
        cwGeo.push(cx + o, 0.035, cz + s * (ROADW / 2 - 2.6), cx + o + 1.3, 0.035, cz + s * (ROADW / 2 - 1.3));
        cwGeo.push(cx + s * (ROADW / 2 - 2.6), 0.035, cz + o, cx + s * (ROADW / 2 - 1.3), 0.035, cz + o + 1.3);
      }
    }
  }
  const cwG = new THREE.BufferGeometry();
  cwG.setAttribute('position', new THREE.Float32BufferAttribute(cwGeo, 3));
  cityGroup.add(new THREE.LineSegments(cwG, new THREE.LineBasicMaterial({ color: 0xd8d8d8 })));

  setLoad(40, 'PALAZZI');

  // edifici
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const c = blockCenter(i, j);
      const inset = ROADW / 2 + 5;
      const w = BLOCK - ROADW - 10, d = BLOCK - ROADW - 10;
      const x0 = c.x - w / 2, z0 = c.z - d / 2;

      // marciapiede: deve stare FUORI dall'asfalto.
      // isolato centrato in (c.x,c.z): la carreggiata finisce a BLOCK/2 - ROADW/2.
      const swW = BLOCK - ROADW, swD = BLOCK - ROADW;
      const sw = box(swW, 0.22, swD, M.sidewalk, c.x, 0.11, c.z, roadGroup);
      sw.castShadow = false;

      // parco ogni tanto
      if (Math.random() < 0.11) {
        const gp = box(w, 0.2, d, M.grass, c.x, 0.2, c.z, roadGroup);
        gp.castShadow = false;
        // prato con due toni, per non sembrare un tappeto piatto
        const patch = box(w * rand(0.3, 0.5), 0.05, d * rand(0.3, 0.5), M.grass2, c.x + rand(-8, 8), 0.24, c.z + rand(-8, 8), roadGroup);
        patch.castShadow = false;
        const n = randInt(5, 10);
        for (let k = 0; k < n; k++) {
          const tx = x0 + rand(3, w - 3), tz = z0 + rand(3, d - 3);
          // alterna alberi e palme per varieta'
          const t = Math.random() < 0.35 ? makePalm(tx, tz, rand(0.85, 1.25))
                                         : makeTree(tx, tz, rand(0.8, 1.35));
          propGroup.add(t);
        }
        continue;
      }

      // 1-4 palazzi per isolato
      const n = randInt(1, 4);
      for (let k = 0; k < n; k++) {
        const bw = rand(10, w / n - 1.5), bd = rand(10, d / n - 1.5);
        const bx = x0 + rand(0, w - bw), bz = z0 + rand(0, d - bd);
        const tall = rand(6, 46);
        // una finestra ogni ~2.6m di facciata: griglia fitta e regolare
        const cols = clamp(Math.round(bw / 2.6), 3, 14);
        const rows = clamp(Math.round(tall / 3.2), 4, 30);
        const mat = M.facade(cols, rows).clone();   // clone: tint unico per palazzo
        mat.color = M.facade(cols, rows).userData.tint.clone();
        const b = new THREE.Mesh(GEO.box, mat);
        b.scale.set(bw, tall, bd);
        b.position.set(bx + bw / 2, tall / 2 + 0.2, bz + bd / 2);
        b.castShadow = true; b.receiveShadow = true;
        bldgGroup.add(b);
        // tetto con bordo più scuro: dà volume
        const roof = box(bw + 0.4, 0.55, bd + 0.4, M.roof, bx + bw / 2, tall + 0.45, bz + bd / 2, bldgGroup);
        // dettagli sul tetto: cassoni, serbatoio, scala antincendio
        const rd = randInt(1, 4);
        for (let q = 0; q < rd; q++) {
          const sw2 = rand(1.2, Math.max(1.5, bw * 0.28));
          const sd2 = rand(1.2, Math.max(1.5, bd * 0.28));
          box(sw2, rand(0.5, 1.6), sd2, M.roof2,
            bx + bw / 2 + rand(-bw / 2 + sw2, bw / 2 - sw2),
            tall + 0.75 + 0.3,
            bz + bd / 2 + rand(-bd / 2 + sd2, bd / 2 - sd2), bldgGroup);
        }
        if (tall > 14 && Math.random() < 0.6) {   // scala antincendio
          const sc2 = box(0.5, tall * 0.8, 0.5, M.chrome, bx + bw / 2, tall * 0.4 + 0.6, bz + bd / 2 + bd / 2 + 0.25, bldgGroup);
          sc2.castShadow = false;
        }
        // marcapiano: fascia orizzontale in cima alla facciata
        const cornice = box(bw + 0.7, 0.4, bd + 0.7, M.cornice,
          bx + bw / 2, tall - 0.15, bz + bd / 2, bldgGroup);
        cornice.castShadow = false;
        // zoccolo al piano terra: i negozi hanno una base diversa
        box(bw + 0.3, 1.5, bd + 0.3, M.plinth, bx + bw / 2, 0.95, bz + bd / 2, bldgGroup);
        // vetrine illuminate: una fascia lucente a piano terra
        if (tall > 5) {
          const fx2 = bx + bw / 2, fz2 = bz + bd / 2;
          box(bw * 0.86, 1.1, 0.12, M.shop, fx2, 1.55, fz2 - bd / 2 - 0.02, bldgGroup).castShadow = false;
          box(bw * 0.86, 1.1, 0.12, M.shop, fx2, 1.55, fz2 + bd / 2 + 0.02, bldgGroup).castShadow = false;
          box(0.12, 1.1, bd * 0.86, M.shop, fx2 - bw / 2 - 0.02, 1.55, fz2, bldgGroup).castShadow = false;
          box(0.12, 1.1, bd * 0.86, M.shop, fx2 + bw / 2 + 0.02, 1.55, fz2, bldgGroup).castShadow = false;
        }

        // Insegne Neon luminose Vice City sui palazzi
        if (tall > 10 && Math.random() < 0.45) {
          const signItem = pick(NEON_LABELS);
          const signTex = makeNeonSignTexture(signItem);
          const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true });
          const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.62), signMat);
          const signY = clamp(rand(4, tall - 2), 3.8, 22);
          if (Math.random() < 0.5) {
            signMesh.position.set(bx + bw / 2, signY, bz - 0.08);
            signMesh.rotation.y = Math.PI;
          } else {
            signMesh.position.set(bx + bw / 2, signY, bz + bd + 0.08);
          }
          bldgGroup.add(signMesh);
        }

        addCollider(bx + bw / 2, bz + bd / 2, bw, bd);
        buildings.push({ x: bx + bw / 2, z: bz + bd / 2, w: bw, d: bd, h: tall });
      }
    }
  }

  // alberi ai lati delle strade: rompono il cemento e rendono la citta viva
  for (let i = 0; i <= GRID; i++) {
    for (let t = 18; t < WORLD - 10; t += 62) {
      for (const side of [-1, 1]) {
        if (Math.random() < 0.45) continue;
        const off = ROADW / 2 + 2.6;
        const x = i * BLOCK + off, z = t;
        if (i * BLOCK === 0 && side < 0) continue;
        const px = i * BLOCK + side * off;
        if (inBuilding(px, z, 2)) continue;
        propGroup.add(Math.random() < 0.3
          ? makePalm(px, z, rand(0.75, 1.05))
          : makeTree(px, z, rand(0.62, 0.9)));
      }
    }
  }

  // semafori agli incroci principali (griglia 2x2: non a ogni incrocio)
  for (let i = 1; i < GRID; i += 2) {
    for (let j = 1; j < GRID; j += 2) {
      const cx = i * BLOCK, cz = j * BLOCK;
      makeTrafficLight(cx + ROADW / 2 + 2.2, cz + ROADW / 2 + 2.2);
    }
  }

  // lampioni lungo le strade con braccio curvo e bagliore asfalto
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.13, 5.2, 6);
  const lampGeo = new THREE.BoxGeometry(0.52, 0.24, 1.15);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffd060, emissiveIntensity: 2.8 });
  // globale: serve al ciclo giorno/notte per accendere e spegnere i lampioni
  MATS.lamp = lampMat;
  const streetGlowGeo = new THREE.PlaneGeometry(7.2, 7.2);
  streetGlowGeo.rotateX(-Math.PI / 2);

  for (let i = 0; i <= GRID; i++) {
    for (let t = 12; t < WORLD; t += 26) {
      const x = i * BLOCK, z = t;
      const p = new THREE.Mesh(poleGeo, M.chrome);
      p.position.set(x + ROADW / 2 - 0.6, 2.6, z);
      p.castShadow = true;
      propGroup.add(p);
      // braccio verso la strada
      const arm = new THREE.Mesh(GEO.box, M.chrome);
      arm.scale.set(0.12, 0.12, 0.85);
      arm.position.set(x + ROADW / 2 - 0.95, 5.2, z);
      propGroup.add(arm);
      // lanterna luminosa
      const l = new THREE.Mesh(lampGeo, lampMat);
      l.position.set(x + ROADW / 2 - 1.3, 5.3, z);
      propGroup.add(l);
      // proiezione luminosa a terra
      const glow = new THREE.Mesh(streetGlowGeo, streetGlowMat);
      glow.position.set(x + ROADW / 2 - 1.3, 0.05, z);
      glow.renderOrder = 2;
      propGroup.add(glow);
    }
  }

  setLoad(70, 'DETTAGLI');

  // recinzione alta ai bordi del mondo: rende chiaro dove finisce la citta
  const wm = new THREE.MeshStandardMaterial({ color: 0x5a5f6b, roughness: 1 });
  const fenceH = 26;
  box(WORLD + 40, fenceH, 2, wm, WORLD / 2, fenceH / 2, -6, propGroup);
  box(WORLD + 40, fenceH, 2, wm, WORLD / 2, fenceH / 2, WORLD + 6, propGroup);
  box(2, fenceH, WORLD + 40, wm, -6, fenceH / 2, WORLD / 2, propGroup);
  box(2, fenceH, WORLD + 40, wm, WORLD + 6, fenceH / 2, WORLD / 2, propGroup);
}

function safeSpot() {
  // resta nella zona centrale della citta, lontano dai bordi
  const LO = BLOCK * 2, HI = BLOCK * (GRID - 2);
  let best = null, bd = Infinity;
  for (let t = 0; t < 400; t++) {
    const gi = randInt(2, GRID - 2) * BLOCK;
    const along = rand(LO, HI);
    const horiz = Math.random() < 0.5;
    const off = rand(-ROADW / 2 + 3, ROADW / 2 - 3);
    let x = horiz ? along : gi + off;
    let z = horiz ? gi + off : along;
    x = clamp(x, LO, HI); z = clamp(z, LO, HI);
    if (!onRoad(x, z)) continue;
    if (inBuilding(x, z, 3)) continue;
    if (!best) { best = { x, z }; continue; }
    const d = dist(x, z, WORLD / 2, WORLD / 2);
    if (d < bd) { bd = d; best = { x, z }; }
    if (bd < 50) break;
  }
  return best || { x: WORLD / 2, z: WORLD / 2 };
}

/* =========================================================================
   VEICOLI
   ========================================================================= */
const cars = [];
const carGroup = new THREE.Group();
scene.add(carGroup);

/* RoundedBox non esiste in three base: uso una BoxGeometry con bordi morbidi
   simulati da un secondo strato leggermente più piccolo (aspetto "morbido"). */
/* ---------- TARGHE ----------
   Dettaglio piccolo che rende le auto credibili: ogni veicolo ha una
   targa unica, generata su canvas. Costo: una texture condivisa per
   veicolo, creata solo quando serve. */
const PLATE_LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const PLATE_NUMBERS = '0123456789';
function makeLicensePlateTex(text, isCop) {
  const PW = 256, PH = 64;
  const c = document.createElement('canvas');
  c.width = PW; c.height = PH;
  const g = c.getContext('2d');
  // fondo
  g.fillStyle = isCop ? '#f2f2f0' : '#f5f5ee';
  g.fillRect(0, 0, PW, PH);
  // fascia blu laterale
  g.fillStyle = isCop ? '#101820' : '#1a4a8a';
  g.fillRect(4, 4, 30, PH - 8);
  g.fillStyle = isCop ? '#ffd34d' : '#f5f5f0';
  g.font = 'bold 15px monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(isCop ? 'PD' : 'VC', 19, PH / 2 + 1);
  // testo
  g.fillStyle = '#15171c';
  g.font = 'bold 32px monospace';
  g.fillText(text, PW / 2 + 18, PH / 2 + 2);
  // bordo
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, PW - 3, PH - 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function randomPlate() {
  let s = '';
  for (let i = 0; i < 3; i++) s += PLATE_LETTERS[(Math.random() * PLATE_LETTERS.length) | 0];
  for (let i = 0; i < 3; i++) s += PLATE_NUMBERS[(Math.random() * 10) | 0];
  return s;
}

/* aggiunge la targa al paraurti posteriore (e anteriore per le civili) */
function addPlate(group, isCop) {
  const tex = makeLicensePlateTex(randomPlate(), isCop);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1 });
  // posteriore
  const back = new THREE.Mesh(GEO.box, mat);
  back.scale.set(0.9, 0.22, 0.06);
  back.position.set(0, 0.72, 2.2);
  group.add(back);
  return mat;
}

function buildCarMesh(isCop, forceSport) {
  const g = new THREE.Group();
  const isSport = !isCop && (forceSport !== undefined ? forceSport : Math.random() < 0.35);
  // vernice: clearcoat = lo strato lucido sopra la tinta. E' la differenza
  // tra "una scatola colorata" e "una macchina".
  const bodyMat = isCop ? M.copBody : new THREE.MeshPhysicalMaterial({
    color: pick(CAR_COLORS),
    roughness: 0.38, metalness: 0.55,
    clearcoat: 0.9, clearcoatRoughness: 0.12,
    envMapIntensity: 1.2
  });

  // corpo inferiore
  const body = new THREE.Mesh(GEO.box, bodyMat);
  body.scale.set(2.0, 0.62, 4.3);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);

  // fianchi: striscia più scura per dare volume
  const skirt = new THREE.Mesh(GEO.box, isCop ? M.copDark : M.carTrim);
  skirt.scale.set(2.06, 0.3, 4.0);
  skirt.position.y = 0.5;
  g.add(skirt);

  // cofano: leggermente inclinato, non un cubo piatto
  const hood = new THREE.Mesh(GEO.box, bodyMat);
  hood.scale.set(isSport ? 1.86 : 1.9, 0.28, 1.35);
  hood.position.set(0, isSport ? 0.92 : 0.98, 1.45);
  hood.rotation.x = -0.06;
  hood.castShadow = true;
  g.add(hood);

  // abitacolo: piu' basso e spostato indietro sulla sportiva
  const roof = new THREE.Mesh(GEO.box, bodyMat);
  const rh = isSport ? 0.42 : 0.5;
  roof.scale.set(1.74, rh, isSport ? 1.45 : 1.7);
  roof.position.set(0, 1.44 - (isSport ? 0.06 : 0), isSport ? -0.6 : -0.35);
  roof.castShadow = true;
  g.add(roof);

  // specchietti esterni
  for (const s of [-1, 1]) {
    const mir = new THREE.Mesh(GEO.box, bodyMat);
    mir.scale.set(0.26, 0.14, 0.16);
    mir.position.set(s * 1.02, 1.34, 0.62);
    g.add(mir);
    const stalk = new THREE.Mesh(GEO.box, M.carTrim);
    stalk.scale.set(0.1, 0.05, 0.06);
    stalk.position.set(s * 0.94, 1.32, 0.62);
    g.add(stalk);
  }

  // paraurti anteriore e posteriore
  for (const zz of [1, -1]) {
    const bump = new THREE.Mesh(GEO.box, M.carTrim);
    bump.scale.set(1.94, 0.22, 0.2);
    bump.position.set(0, 0.62, zz * 2.18);
    g.add(bump);
  }

  // spoiler per la sportiva
  if (isSport) {
    const sp = new THREE.Mesh(GEO.box, M.carTrim);
    sp.scale.set(1.6, 0.07, 0.42);
    sp.position.set(0, 1.34, -2.0);
    g.add(sp);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(GEO.box, M.carTrim);
      post.scale.set(0.1, 0.22, 0.1);
      post.position.set(s * 0.66, 1.22, -2.0);
      g.add(post);
    }
  }

  // parabrezza
  const wind = new THREE.Mesh(GEO.box, M.glassCar);
  wind.scale.set(1.62, 0.5, 0.14);
  wind.position.set(0, 1.4, 0.52);
  g.add(wind);
  // lunotto
  const rear = new THREE.Mesh(GEO.box, M.glassCar);
  rear.scale.set(1.6, 0.44, 0.12);
  rear.position.set(0, 1.4, -1.22);
  g.add(rear);
  // finestrini laterali
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(GEO.box, M.glassCar);
    side.scale.set(0.1, 0.42, 1.5);
    side.position.set(s * 0.87, 1.42, -0.35);
    g.add(side);
  }

  // parafanghi: archi sopra le ruote
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const arch = new THREE.Mesh(GEO.box, bodyMat);
    arch.scale.set(0.28, 0.42, 1.1);
    arch.position.set(sx * 1.0, 1.0, sz * 1.42);
    arch.castShadow = true;
    g.add(arch);
  }

  // fari + stop
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(GEO.box, M.headlight);
    hl.scale.set(0.44, 0.22, 0.14);
    hl.position.set(s * 0.62, 0.82, 2.16);
    g.add(hl);
    const tl = new THREE.Mesh(GEO.box, M.taillight);
    tl.scale.set(0.44, 0.2, 0.12);
    tl.position.set(s * 0.62, 0.82, -2.16);
    g.add(tl);
  }
  // griglia
  const grille = new THREE.Mesh(GEO.box, M.chrome);
  grille.scale.set(1.1, 0.2, 0.1);
  grille.position.set(0, 0.7, 2.15);
  g.add(grille);

  // fascio dei fari sull'asfalto
  const beam = new THREE.Mesh(GEO.beam, headlightMat);
  beam.scale.set(7, 1, 15);
  beam.position.set(0, 0.05, 2.1);
  beam.renderOrder = 2;
  g.add(beam);

  // fari + stop
  const tails = [];
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(GEO.box, M.headlight);
    hl.scale.set(0.44, 0.22, 0.14);
    hl.position.set(s * 0.62, 0.82, 2.16);
    g.add(hl);
    // stop: si accendono quando il veicolo frena
    const tl = new THREE.Mesh(GEO.box, M.taillight);
    tl.scale.set(0.44, 0.2, 0.12);
    tl.position.set(s * 0.62, 0.82, -2.16);
    g.add(tl);
    tails.push(tl);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.32, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.34, 12);
  rimGeo.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(wheelGeo, M.tire);
    w.position.set(sx * 0.92, 0.46, sz * 1.42);
    w.castShadow = true;
    g.add(w);
    const rim = new THREE.Mesh(rimGeo, M.chrome);
    rim.position.set(sx * 0.94, 0.46, sz * 1.42);
    g.add(rim);
    wheels.push(w);
  }

  // barra luci per la polizia
  let red = null, blue = null;
  if (isCop) {
    red = new THREE.Mesh(GEO.box, M.red);
    red.scale.set(0.72, 0.22, 0.32);
    red.position.set(-0.38, 1.78, -0.3);
    g.add(red);
    blue = new THREE.Mesh(GEO.box, M.blue);
    blue.scale.set(0.72, 0.22, 0.32);
    blue.position.set(0.38, 1.78, -0.3);
    g.add(blue);
    // telaio nero sulle portiere
    for (const s of [-1, 1]) {
      const door = new THREE.Mesh(GEO.box, M.copDark);
      door.scale.set(0.08, 0.5, 1.9);
      door.position.set(s * 1.02, 0.85, -0.2);
      g.add(door);
    }
    const stripe = new THREE.Mesh(GEO.box, M.copDark);
    stripe.scale.set(2.04, 0.22, 4.05);
    stripe.position.set(0, 0.52, 0);
    g.add(stripe);
  }
  // targa: un dettaglio che rende ogni auto diversa
  const plateMat = addPlate(g, isCop);
  return { g, wheels, tails, red, blue, bodyMat, plateMat };
}

/* Modello moto sportiva PCJ-600 */
function buildMotoMesh() {
  const g = new THREE.Group();
  const bodyColor = pick([0xff2244, 0x22c55e, 0x3b82f6, 0xf59e0b, 0xa855f7, 0xf8fafc, 0x18181b]);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: bodyColor, roughness: 0.3, metalness: 0.65,
    clearcoat: 0.95, clearcoatRoughness: 0.1
  });

  // Telaio principale compatto
  const frame = new THREE.Mesh(GEO.box, M.chrome);
  frame.scale.set(0.38, 0.44, 1.85);
  frame.position.y = 0.58;
  frame.castShadow = true;
  g.add(frame);

  // Serbatoio profilato
  const tank = new THREE.Mesh(GEO.box, bodyMat);
  tank.scale.set(0.48, 0.36, 0.72);
  tank.position.set(0, 0.88, 0.22);
  tank.castShadow = true;
  g.add(tank);

  // Cupolino e sella
  const seat = new THREE.Mesh(GEO.box, M.tire);
  seat.scale.set(0.42, 0.16, 0.76);
  seat.position.set(0, 0.78, -0.46);
  seat.castShadow = true;
  g.add(seat);

  // Manubrio e forcella
  const bar = new THREE.Mesh(GEO.cyl, M.chrome);
  bar.scale.set(0.86, 0.05, 0.05);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.15, 0.56);
  g.add(bar);
  for (const s of [-1, 1]) {
    const grip = new THREE.Mesh(GEO.cyl, M.tire);
    grip.scale.set(0.12, 0.08, 0.08);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(s * 0.43, 1.15, 0.56);
    g.add(grip);
  }

  // Faro anteriore
  const hl = new THREE.Mesh(GEO.cyl, M.headlight);
  hl.scale.set(0.24, 0.14, 0.24);
  hl.rotation.x = Math.PI / 2;
  hl.position.set(0, 0.94, 0.94);
  g.add(hl);

  // Stop posteriore
  const tl = new THREE.Mesh(GEO.box, M.taillight);
  tl.scale.set(0.22, 0.14, 0.1);
  tl.position.set(0, 0.78, -0.92);
  g.add(tl);
  const tails = [tl];

  // Fascio luce fari
  const beam = new THREE.Mesh(GEO.beam, headlightMat);
  beam.scale.set(5.5, 1, 14);
  beam.position.set(0, 0.05, 0.95);
  beam.renderOrder = 2;
  g.add(beam);

  // 2 Ruote da moto (anteriore e posteriore)
  const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.2, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  const rimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 12);
  rimGeo.rotateZ(Math.PI / 2);

  for (const sz of [0.95, -0.85]) {
    const w = new THREE.Mesh(wheelGeo, M.tire);
    w.position.set(0, 0.46, sz);
    w.castShadow = true;
    g.add(w);
    const rim = new THREE.Mesh(rimGeo, M.chrome);
    rim.position.set(0, 0.46, sz);
    g.add(rim);
    wheels.push(w);

    const fork = new THREE.Mesh(GEO.box, M.chrome);
    fork.scale.set(0.26, 0.54, 0.08);
    fork.position.set(0, 0.72, sz);
    g.add(fork);
  }

  // Scarico cromato laterale
  const exhaust = new THREE.Mesh(GEO.cyl, M.chrome);
  exhaust.scale.set(0.08, 0.85, 0.08);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.24, 0.38, -0.38);
  g.add(exhaust);

  return { g, wheels, tails, red: null, blue: null, bodyMat, isMoto: true };
}

/* Modello Ambulanza d'emergenza */
function buildAmbulanceMesh() {
  const g = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.35 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xd92d20, roughness: 0.4 });

  // Chassis furgone
  const body = new THREE.Mesh(GEO.box, whiteMat);
  body.scale.set(2.2, 0.8, 4.8);
  body.position.y = 0.8;
  body.castShadow = true;
  g.add(body);

  // Cabina anteriore
  const cab = new THREE.Mesh(GEO.box, whiteMat);
  cab.scale.set(2.1, 0.9, 1.4);
  cab.position.set(0, 1.6, 1.2);
  cab.castShadow = true;
  g.add(cab);

  // Vano posteriore alto
  const boxBack = new THREE.Mesh(GEO.box, whiteMat);
  boxBack.scale.set(2.18, 1.5, 3.1);
  boxBack.position.set(0, 1.85, -0.8);
  boxBack.castShadow = true;
  g.add(boxBack);

  // Strisce rosse e croci mediche sui lati
  for (const s of [-1, 1]) {
    const stripe = new THREE.Mesh(GEO.box, redMat);
    stripe.scale.set(0.05, 0.35, 4.6);
    stripe.position.set(s * 1.11, 1.3, -0.1);
    g.add(stripe);

    const crossV = new THREE.Mesh(GEO.box, redMat);
    crossV.scale.set(0.06, 0.6, 0.2);
    crossV.position.set(s * 1.11, 2.0, -0.8);
    g.add(crossV);
    const crossH = new THREE.Mesh(GEO.box, redMat);
    crossH.scale.set(0.06, 0.2, 0.6);
    crossH.position.set(s * 1.11, 2.0, -0.8);
    g.add(crossH);
  }

  // Barra lampeggianti sul tetto (rosso e blu)
  const redLight = new THREE.Mesh(GEO.box, M.red);
  redLight.scale.set(0.8, 0.25, 0.35);
  redLight.position.set(-0.45, 2.65, 1.1);
  g.add(redLight);
  const blueLight = new THREE.Mesh(GEO.box, M.blue);
  blueLight.scale.set(0.8, 0.25, 0.35);
  blueLight.position.set(0.45, 2.65, 1.1);
  g.add(blueLight);

  const tails = [];
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(GEO.box, M.headlight);
    hl.scale.set(0.45, 0.25, 0.15);
    hl.position.set(s * 0.75, 0.95, 2.41);
    g.add(hl);
    const tl = new THREE.Mesh(GEO.box, M.taillight);
    tl.scale.set(0.45, 0.25, 0.15);
    tl.position.set(s * 0.75, 0.95, -2.41);
    g.add(tl);
    tails.push(tl);
  }

  const beam = new THREE.Mesh(GEO.beam, headlightMat);
  beam.scale.set(8, 1, 16);
  beam.position.set(0, 0.05, 2.4);
  beam.renderOrder = 2;
  g.add(beam);

  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.38, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(wheelGeo, M.tire);
    w.position.set(sx * 1.02, 0.5, sz * 1.6);
    w.castShadow = true;
    g.add(w);
    wheels.push(w);
  }

  return { g, wheels, tails, red: redLight, blue: blueLight, bodyMat: whiteMat, isAmbulance: true };
}

/* Modello Supercar Cheetah / Infernus */
function buildSupercarMesh() {
  const built = buildCarMesh(false, true);
  built.bodyMat.color.setHex(pick([0xff0044, 0x00e5ff, 0xffbb00, 0xffffff, 0x111827, 0xff5500]));
  built.isSuper = true;
  return built;
}

/* Modello Taxi Giallo Vice City */
function buildTaxiMesh() {
  const built = buildCarMesh(false, false);
  built.bodyMat.color.setHex(0xf5b000);
  built.bodyMat.roughness = 0.35;
  built.bodyMat.metalness = 0.45;
  built.bodyMat.clearcoat = 0.9;
  built.isTaxi = true;

  // Insegna luminosa TAXI sul tetto
  const signGeo = new THREE.BoxGeometry(0.72, 0.22, 0.32);
  const signMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffbe20, emissiveIntensity: 2.4, roughness: 0.2
  });
  const taxiSign = new THREE.Mesh(signGeo, signMat);
  taxiSign.position.set(0, 1.82, -0.35);
  taxiSign.castShadow = true;
  built.g.add(taxiSign);

  // Strisce a scacchi neri e bianchi sulle fiancate
  const checkerMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.8 });
  for (const s of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      if (k % 2 === 0) {
        const blk = new THREE.Mesh(GEO.box, checkerMat);
        blk.scale.set(0.04, 0.12, 0.38);
        blk.position.set(s * 1.02, 0.88, k * 0.45 - 0.2);
        built.g.add(blk);
      }
    }
  }
  return built;
}

/* Modello Moto Chopper Custom (Freeway / Angel) */
function buildChopperMesh() {
  const g = new THREE.Group();
  const chopperColor = pick([0x8b0000, 0x1c1c1c, 0x4a154b, 0x0a2540, 0x996515]);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: chopperColor, roughness: 0.25, metalness: 0.7,
    clearcoat: 0.95, clearcoatRoughness: 0.08
  });

  // Telaio allungato cromato
  const frame = new THREE.Mesh(GEO.box, M.chrome);
  frame.scale.set(0.36, 0.38, 2.2);
  frame.position.y = 0.52;
  frame.castShadow = true;
  g.add(frame);

  // Serbatoio a goccia (teardrop)
  const tank = new THREE.Mesh(GEO.box, bodyMat);
  tank.scale.set(0.44, 0.34, 0.78);
  tank.position.set(0, 0.86, 0.32);
  tank.rotation.x = -0.15;
  tank.castShadow = true;
  g.add(tank);

  // Sella bassa a due livelli
  const seatLow = new THREE.Mesh(GEO.box, M.tire);
  seatLow.scale.set(0.38, 0.14, 0.55);
  seatLow.position.set(0, 0.68, -0.32);
  seatLow.castShadow = true;
  g.add(seatLow);
  const seatHigh = new THREE.Mesh(GEO.box, M.tire);
  seatHigh.scale.set(0.34, 0.2, 0.38);
  seatHigh.position.set(0, 0.82, -0.72);
  seatHigh.castShadow = true;
  g.add(seatHigh);

  // Schienale posteriore alto (Sissy bar)
  const sissyBar = new THREE.Mesh(GEO.cyl, M.chrome);
  sissyBar.scale.set(0.04, 0.85, 0.04);
  sissyBar.rotation.x = -0.18;
  sissyBar.position.set(0, 1.25, -0.92);
  g.add(sissyBar);

  // Forcella allungata e inclinata in avanti (Raked Fork)
  const fork = new THREE.Mesh(GEO.cyl, M.chrome);
  fork.scale.set(0.06, 1.2, 0.06);
  fork.rotation.x = -0.38;
  fork.position.set(0, 0.78, 1.05);
  g.add(fork);

  // Manubrio alto "Ape Hangers"
  const barV = new THREE.Mesh(GEO.cyl, M.chrome);
  barV.scale.set(0.04, 0.65, 0.04);
  barV.position.set(0, 1.45, 0.72);
  g.add(barV);
  const barH = new THREE.Mesh(GEO.cyl, M.chrome);
  barH.scale.set(0.92, 0.05, 0.05);
  barH.rotation.z = Math.PI / 2;
  barH.position.set(0, 1.62, 0.68);
  g.add(barH);
  for (const s of [-1, 1]) {
    const grip = new THREE.Mesh(GEO.cyl, M.tire);
    grip.scale.set(0.12, 0.08, 0.08);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(s * 0.44, 1.62, 0.68);
    g.add(grip);
    const mir = new THREE.Mesh(GEO.sphere, M.chrome);
    mir.scale.set(0.06, 0.06, 0.03);
    mir.position.set(s * 0.48, 1.74, 0.68);
    g.add(mir);
  }

  // Faro anteriore tondo
  const hl = new THREE.Mesh(GEO.cyl, M.headlight);
  hl.scale.set(0.26, 0.16, 0.26);
  hl.rotation.x = Math.PI / 2;
  hl.position.set(0, 0.98, 1.22);
  g.add(hl);

  // Stop posteriore
  const tl = new THREE.Mesh(GEO.box, M.taillight);
  tl.scale.set(0.2, 0.12, 0.08);
  tl.position.set(0, 0.72, -1.05);
  g.add(tl);
  const tails = [tl];

  // Fascio luce
  const beam = new THREE.Mesh(GEO.beam, headlightMat);
  beam.scale.set(6, 1, 15);
  beam.position.set(0, 0.05, 1.25);
  beam.renderOrder = 2;
  g.add(beam);

  // Ruota anteriore grande e sottile
  const wheelFrontGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.16, 16);
  wheelFrontGeo.rotateZ(Math.PI / 2);
  const wf = new THREE.Mesh(wheelFrontGeo, M.tire);
  wf.position.set(0, 0.52, 1.45);
  wf.castShadow = true;
  g.add(wf);

  // Ruota posteriore più larga
  const wheelRearGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.32, 16);
  wheelRearGeo.rotateZ(Math.PI / 2);
  const wr = new THREE.Mesh(wheelRearGeo, M.tire);
  wr.position.set(0, 0.44, -0.92);
  wr.castShadow = true;
  g.add(wr);
  const wheels = [wf, wr];

  for (const [w, r, width] of [[wf, 0.32, 0.18], [wr, 0.26, 0.34]]) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 12), M.chrome);
    rim.rotation.z = Math.PI / 2;
    rim.position.copy(w.position);
    g.add(rim);
  }

  // Doppi scarichi cromati
  for (let dy of [0, 0.12]) {
    const exh = new THREE.Mesh(GEO.cyl, M.chrome);
    exh.scale.set(0.07, 1.25, 0.07);
    exh.rotation.x = Math.PI / 2;
    exh.position.set(0.25, 0.34 + dy, -0.45);
    g.add(exh);
  }

  return { g, wheels, tails, red: null, blue: null, bodyMat, isMoto: true, isChopper: true };
}

/* Modello Furgone Gang Burrito */
function buildGangVanMesh() {
  const g = new THREE.Group();
  const blackMat = new THREE.MeshPhysicalMaterial({
    color: 0x181a1f, roughness: 0.42, metalness: 0.55, clearcoat: 0.7
  });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xd92525, roughness: 0.4 });

  // Chassis grande furgone Burrito
  const body = new THREE.Mesh(GEO.box, blackMat);
  body.scale.set(2.26, 1.5, 4.9);
  body.position.y = 1.35;
  body.castShadow = true;
  g.add(body);

  // Cabina rastremata anteriore
  const front = new THREE.Mesh(GEO.box, blackMat);
  front.scale.set(2.2, 0.82, 1.1);
  front.position.set(0, 0.88, 2.45);
  front.castShadow = true;
  g.add(front);

  // Striscia rossa laterale da gang
  for (const s of [-1, 1]) {
    const stripe = new THREE.Mesh(GEO.box, redMat);
    stripe.scale.set(0.04, 0.28, 4.7);
    stripe.position.set(s * 1.14, 1.45, 0.05);
    g.add(stripe);
  }

  // Spoiler tetto posteriore
  const spoiler = new THREE.Mesh(GEO.box, redMat);
  spoiler.scale.set(2.1, 0.15, 0.42);
  spoiler.position.set(0, 2.18, -2.4);
  g.add(spoiler);

  // Bullbar anteriore cromato massiccio
  const bullbar = new THREE.Mesh(GEO.box, M.chrome);
  bullbar.scale.set(1.9, 0.55, 0.16);
  bullbar.position.set(0, 0.75, 3.05);
  g.add(bullbar);

  // Parabrezza e vetri oscurati
  const wind = new THREE.Mesh(GEO.box, M.glassCar);
  wind.scale.set(1.95, 0.58, 0.1);
  wind.position.set(0, 1.62, 2.05);
  wind.rotation.x = -0.22;
  g.add(wind);

  // Fari anteriori e stop
  const tails = [];
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(GEO.box, M.headlight);
    hl.scale.set(0.42, 0.24, 0.14);
    hl.position.set(s * 0.78, 0.95, 2.98);
    g.add(hl);

    const tl = new THREE.Mesh(GEO.box, M.taillight);
    tl.scale.set(0.35, 0.45, 0.12);
    tl.position.set(s * 0.82, 1.35, -2.46);
    g.add(tl);
    tails.push(tl);
  }

  const beam = new THREE.Mesh(GEO.beam, headlightMat);
  beam.scale.set(7.5, 1, 16);
  beam.position.set(0, 0.05, 3.0);
  beam.renderOrder = 2;
  g.add(beam);

  const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.36, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(wheelGeo, M.tire);
    w.position.set(sx * 1.05, 0.48, sz * 1.6);
    w.castShadow = true;
    g.add(w);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.38, 12), M.chrome);
    rim.rotation.z = Math.PI / 2;
    rim.position.copy(w.position);
    g.add(rim);
    wheels.push(w);
  }

  return { g, wheels, tails, red: null, blue: null, bodyMat: blackMat, isVan: true };
}

function makeCar(x, z, a, isCop, vType) {
  let type = vType;
  if (!type) {
    if (isCop) type = 'cop';
    else {
      const r = Math.random();
      if (r < 0.12) type = 'moto';
      else if (r < 0.22) type = 'chopper';
      else if (r < 0.40) type = 'sport';
      else if (r < 0.58) type = 'taxi';
      else if (r < 0.72) type = 'van';
      else if (r < 0.82) type = 'ambulance';
      else type = 'sedan';
    }
  }

  let built;
  if (type === 'moto') built = buildMotoMesh();
  else if (type === 'chopper') built = buildChopperMesh();
  else if (type === 'taxi') built = buildTaxiMesh();
  else if (type === 'van') built = buildGangVanMesh();
  else if (type === 'ambulance') built = buildAmbulanceMesh();
  else if (type === 'sport') built = buildSupercarMesh();
  else built = buildCarMesh(isCop);

  if (!isCop && type === 'sedan') built.bodyMat.color.setHex(pick(CAR_COLORS));
  carGroup.add(built.g);

  const hpVal = type === 'van' ? 240 : type === 'ambulance' ? 180 : (type === 'moto' || type === 'chopper') ? 75 : 100;
  const c = {
    x, z, a, isCop, type,
    speed: 0,
    hp: hpVal,
    maxhp: hpVal,
    vx: 0, vz: 0,
    mesh: built,
    driver: false,
    ni: -1, nj: -1, turn: null,
    burning: false, burnT: 0,
    flash: 0, shootCd: 0,
    respawn: 0,
    isMoto: type === 'moto' || type === 'chopper',
    isChopper: type === 'chopper',
    isTaxi: type === 'taxi',
    isVan: type === 'van',
    isAmbulance: type === 'ambulance',
    isSuper: type === 'sport',
    // --- dinamica del veicolo ---
    slip: 0,        // velocita' laterale: longitudinale e laterale sono separati
    roll: 0,        // assetto in curva (visuale)
    pitch: 0,       // assetto in accelerazione/frenata (visuale)
    lastSpeed: 0,
    // sospensione: smorza gli urti (bump e collisioni)
    suspY: 0, suspVY: 0,
    mass: isCop ? 1500 : type === 'van' || type === 'ambulance' ? 2400
        : (type === 'moto' || type === 'chopper') ? 220
        : type === 'taxi' ? 1600 : 1350
  };
  cars.push(c);
  return c;
}

function removeCar(c) {
  carGroup.remove(c.mesh.g);
  disposeTree(c.mesh.g);
  const i = cars.indexOf(c);
  if (i >= 0) cars.splice(i, 1);
}
function disposeTree(obj) {
  obj.traverse(o => { if (o.isMesh && o.material && o.material !== M.white && o.material.dispose && o.material.__cloned) o.material.dispose(); });
}

// geometrie condivise per i pedoni (nessun dispose)
function disposeTreeShared(o) { /* le mesh dei pedoni usano materiali globali */ }

/* =========================================================================
   PEDONI
   Ogni pedone e' un insieme di 7 InstancedMesh condivise: cosi' 46 pedoni
   costano 8 draw call invece di ~300, e restano definiti.
   ========================================================================= */
const peds = [];
const pedGroup = new THREE.Group();
scene.add(pedGroup);

const PMAX = 64;
function instGeom(geo, castShadow) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), PMAX);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = !!castShadow;
  m.receiveShadow = false;
  m.frustumCulled = false;     // i pedoni si muovono: niente culling per bbox
  m.count = 0;
  pedGroup.add(m);
  return m;
}
// geometrie condivise dei pedoni (identiche a quelle del protagonista)
const PED_GEO = {
  torso: torsoGeo(1),
  hips: new THREE.BoxGeometry(0.33, 0.22, 0.22),
  head: (() => { const g = new THREE.SphereGeometry(0.15, 10, 8); g.scale(1, 1.1, 1); return g; })(),
  hair: (() => { const g = new THREE.SphereGeometry(0.157, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62); g.scale(1, 1.06, 1.03); return g; })(),
  arm: limb(0.46, 0.068),
  leg: limb(0.6, 0.095),
  shoe: new THREE.BoxGeometry(0.19, 0.11, 0.33)
};
const pedIM = {
  torso: instGeom(PED_GEO.torso, true),
  hips: instGeom(PED_GEO.hips, false),
  head: instGeom(PED_GEO.head, true),
  hair: instGeom(PED_GEO.hair, false),
  armL: instGeom(PED_GEO.arm, false), armR: instGeom(PED_GEO.arm, false),
  legL: instGeom(PED_GEO.leg, false), legR: instGeom(PED_GEO.leg, false),
  shoeL: instGeom(PED_GEO.shoe, false), shoeR: instGeom(PED_GEO.shoe, false),
  blob: (() => {
    const m = new THREE.InstancedMesh(blobGeo, blobMat.clone(), PMAX);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = 0; m.renderOrder = 1;
    pedGroup.add(m);
    return m;
  })()
};

/* matrice ausiliaria: non allocare per pedone per frame */
const _o = new THREE.Object3D();
const _c = new THREE.Color();
function setInst(mesh, i, px, py, pz, rx, ry, sx, sy, sz) {
  _o.position.set(px, py, pz);
  _o.rotation.set(rx, ry, 0);
  _o.scale.set(sx, sy, sz);
  _o.updateMatrix();
  mesh.setMatrixAt(i, _o.matrix);
}

function makePed(x, z) {
  const p = {
    x, z, a: rand(0, TAU), speed: 0,
    walk: rand(0, 10), panic: 0, idle: 0,
    down: 0, vx: 0, vz: 0, ni: -1, nj: -1, turn: null, respawn: 0,
    
    skin: pick(SKINS), hair: pick(HAIRS), shirt: pick(SHIRTS), pants: pick(PANTS)
  };
  peds.push(p);
  return p;
}
function removePed(p) { const i = peds.indexOf(p); if (i >= 0) peds.splice(i, 1); }

/* Scrive le trasformazioni dei pedoni nelle InstancedMesh. Chiamata ogni frame. */
function syncPeds() {
  const n = peds.length;
  for (let i = 0; i < n; i++) {
    const p = peds[i];
    const down = p.down > 0;
    // se e' a terra: coricato di lato, appena sollevato
    const fall = down ? clamp(p.down * 3, 0, 1) : 0;
    const yBase = down ? 0.30 : 0;
    const rotZ = down ? Math.PI / 2 * fall : 0;

    // wrapper per la rotazione su Z (coricamento) applicata attorno ai piedi
    const put = (mesh, lx, ly, lz, rx) => {
      // posizione locale ruotata su Z (rotazione semplice 2D)
      const cy = ly * Math.cos(rotZ) - lz * Math.sin(rotZ);
      const cz = ly * Math.sin(rotZ) + lz * Math.cos(rotZ);
      // poi yaw del personaggio
      const wx = p.x + (lx * Math.cos(p.a) + cz * Math.sin(p.a));
      const wz = p.z + (-lx * Math.sin(p.a) + cz * Math.cos(p.a));
      setInst(mesh, i, wx, yBase + cy, wz, rx, p.a, 1, 1, 1);
    };

    // torso e testa
    put(pedIM.hips, 0, 0.93, 0, 0);
    put(pedIM.torso, 0, 1.31, 0, 0);
    put(pedIM.head, 0, 1.78, 0, 0);
    put(pedIM.hair, 0, 1.795, -0.012, 0);

    // gambe: ciclo di camminata (azzera i pedoni fermi)
    const amp = clamp(p.speed / 4.2, 0, 1) * 0.8;
    const sw = Math.sin(p.walk) * amp;
    put(pedIM.legL, -0.105, 0.56, 0, down ? 0 : sw);
    put(pedIM.legR, 0.105, 0.56, 0, down ? 0 : -sw);
    put(pedIM.shoeL, -0.105, 0.20, 0.05, 0);
    put(pedIM.shoeR, 0.105, 0.20, 0.05, 0);
    put(pedIM.armL, -0.255, 1.24, 0, down ? 0 : -sw * 0.62);
    put(pedIM.armR, 0.255, 1.24, 0, down ? 0 : sw * 0.62);

    // ombra di contatto
    setInst(pedIM.blob, i, p.x, 0.03, p.z, 0, 0, 0.62, 1, 0.62);

    // colori individuali
    pedIM.torso.setColorAt(i, _c.setHex(p.shirt));
    pedIM.armL.setColorAt(i, _c.setHex(p.shirt));
    pedIM.armR.setColorAt(i, _c.setHex(p.shirt));
    pedIM.hips.setColorAt(i, _c.setHex(p.pants));
    pedIM.legL.setColorAt(i, _c.setHex(p.pants));
    pedIM.legR.setColorAt(i, _c.setHex(p.pants));
    pedIM.shoeL.setColorAt(i, _c.setHex(0x241c18));
    pedIM.shoeR.setColorAt(i, _c.setHex(0x241c18));
    pedIM.head.setColorAt(i, _c.setHex(p.skin));
    pedIM.hair.setColorAt(i, _c.setHex(p.hair));
  }
  for (const k in pedIM) {
    const m = pedIM[k];
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

/* =========================================================================
   PUNTI DI RACCOLTA / MISSIONI
   ========================================================================= */
const pickups = [];
const pickupGroup = new THREE.Group();
scene.add(pickupGroup);
function makePickups() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({ color: 0xc8a04a, roughness: 0.7 }));
  body.scale.set(0.6, 1.0, 0.45);
  body.position.y = 0.75;
  body.castShadow = true;
  g.add(body);
  const lid = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({ color: 0xe8cf8a, roughness: 0.7 }));
  lid.scale.set(0.66, 0.16, 0.5);
  lid.position.y = 1.3;
  g.add(lid);
  for (let i = 0; i < 26; i++) {
    const p = randRoadPoint(30);
    const inst = g.clone();
    pickupGroup.add(inst);
    pickups.push({ x: p.x, z: p.z, mesh: inst, got: false, respawn: 0 });
  }
}

/* 10 Pacchetti Segreti nascosti in città */
const packages = [];
const packageGroup = new THREE.Group();
scene.add(packageGroup);

function makePackages() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(GEO.cyl, M.gold);
  base.scale.set(0.6, 0.35, 0.6);
  base.position.y = 0.2;
  g.add(base);
  const body = new THREE.Mesh(GEO.box, M.purple);
  body.scale.set(0.42, 0.85, 0.42);
  body.position.y = 0.8;
  body.castShadow = true;
  g.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.07, 8, 20), M.gold);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.35;
  g.add(ring);

  // 10 posizioni nascoste e panoramiche nella città (1000m x 1000m)
  const spots = [
    { x: 120, z: 120 }, { x: 380, z: 240 }, { x: 740, z: 180 },
    { x: 860, z: 420 }, { x: 220, z: 620 }, { x: 500, z: 500 },
    { x: 820, z: 780 }, { x: 160, z: 860 }, { x: 440, z: 880 },
    { x: 680, z: 320 }
  ];

  for (const s of spots) {
    const inst = g.clone();
    inst.position.set(s.x, 0.3, s.z);
    packageGroup.add(inst);
    packages.push({ x: s.x, z: s.z, mesh: inst, got: false });
  }
}

/* =========================================================================
   ARSENALE ARMI
   ========================================================================= */
const WEAPONS = [
  { id: 'fist', name: 'PUGNI', icon: '👊', ammo: Infinity, maxAmmo: Infinity, rate: 0.28, dmg: 40, auto: false, price: 0 },
  { id: 'pistol', name: 'PISTOLA .45', icon: '🔫', ammo: 120, maxAmmo: 999, rate: 0.16, dmg: 35, auto: false, price: 0 },
  { id: 'uzi', name: 'UZI 9MM', icon: '⚡', ammo: 250, maxAmmo: 999, rate: 0.075, dmg: 22, spread: 0.055, auto: true, price: 800 },
  { id: 'shotgun', name: 'POMPA 12G', icon: '💥', ammo: 45, maxAmmo: 200, rate: 0.65, dmg: 18, pellets: 6, spread: 0.12, auto: false, price: 1500 },
  { id: 'rpg', name: 'BAZOOKA RPG', icon: '🚀', ammo: 15, maxAmmo: 50, rate: 1.1, dmg: 240, explosive: true, auto: false, price: 5000 }
];
let currentWeaponIdx = 1; // Inizia con la Pistola .45

/* =========================================================================
   NEGOZIO / ECONOMIA
   I soldi servono a qualcosa: si comprano armi, munizioni, vita e
   riparazioni. Senza questo il denaro è solo un numero che cresce.
   ========================================================================= */
/* armi possedute (indici in WEAPONS). Pugni e pistola sono sempre tuoi. */
let ownedWeapons = new Set([0, 1]);

const SHOP_ITEMS = [
  { id: 'ammo', name: 'MUNIZIONI', icon: '📦', desc: '+90 colpi di riserva (ricarica con R)', price: 150, kind: 'ammo' },
  { id: 'medkit', name: 'KIT MEDICO', icon: '❤️', desc: 'Ripristina tutta la vita', price: 200, kind: 'heal' },
  { id: 'repair', name: 'RIPARAZIONE', icon: '🔧', desc: 'Ripara il veicolo guidato', price: 300, kind: 'repair' },
  { id: 'fuel', name: 'Pieno BENZINA', icon: '⛽', desc: 'Nessun effetto, ma sa di benzina', price: 50, kind: 'noop' }
];

function weaponPrice(idx) { return WEAPONS[idx].price || 0; }

function buyWeapon(idx) {
  const w = WEAPONS[idx];
  if (!w) return false;
  if (ownedWeapons.has(idx)) return false;
  const p = weaponPrice(idx);
  if (player.money < p) {
    showToast('Soldi insufficienti (servono $' + p + ')', 2.2);
    return false;
  }
  player.money -= p;
  ownedWeapons.add(idx);
  // si equipaggia subito
  currentWeaponIdx = idx;
  player.ammo = Math.max(player.ammo, w.ammo);
  if (typeof updateWeaponVisuals === 'function') updateWeaponVisuals();
  showToast('Acquistato: ' + w.name, 2.4);
  sfx('accept');
  return true;
}

function buyItem(id) {
  const it = SHOP_ITEMS.find(i => i.id === id);
  if (!it) return false;
  if (player.money < it.price) {
    showToast('Soldi insufficienti', 2);
    return false;
  }
  switch (it.kind) {
    case 'ammo': {
      // munizioni DI RISERVA: poi si ricarica con R
      const w = WEAPONS[currentWeaponIdx];
      if (w.ammo === Infinity) { showToast('Munizioni illimitate', 1.8); return false; }
      if (player.reserve >= w.maxAmmo) { showToast('Riserva già piena', 1.8); return false; }
      player.reserve = Math.min(w.maxAmmo, player.reserve + 90);
      showToast('+90 munizioni di riserva (R per ricaricare)', 2.2);
      break;
    }
    case 'heal':
      if (player.hp >= player.maxhp) { showToast('Sei già in piena forma', 1.8); return false; }
      player.hp = player.maxhp;
      break;
    case 'repair':
      if (!player.car) { showToast('Serve un veicolo', 1.8); return false; }
      if (player.car.hp >= player.car.maxhp) { showToast('Veicolo già perfetto', 1.8); return false; }
      player.car.hp = player.car.maxhp;
      player.car.burning = false;
      break;
    case 'noop':
      break;
  }
  player.money -= it.price;
  showToast('Acquistato: ' + it.name, 2);
  sfx('coin');
  return true;
}

/* =========================================================================
   PUNTO VENDITA (ARMORY) NEL MONDO
   Un edificio con insegna luminosa: ci si entra da vicino.
   ========================================================================= */
const shopSpots = [];   // { x, z, ring }
function makeShopSpots() {
  // un armory in un isolato centrale, lontano dai bordi
  const c = { x: 5 * BLOCK + BLOCK / 2, z: 5 * BLOCK + BLOCK / 2 };
  // anello luminoso sul pavimento: segna il punto
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.16, 8, 28),
    new THREE.MeshStandardMaterial({ color: 0xffcf3c, emissive: 0xffaa00, emissiveIntensity: 1.6 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(c.x, 0.06, c.z);
  propGroup.add(ring);
  shopSpots.push({ x: c.x, z: c.z, ring });
}

let shopOpen = false;
function openShop() {
  shopOpen = true;
  state = 'shop';
  renderShop();
  document.getElementById('shop').classList.remove('hidden');
}
function closeShop() {
  shopOpen = false;
  state = 'play';
  document.getElementById('shop').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function renderShop() {
  const list = document.getElementById('shopList');
  const moneyEl = document.getElementById('shopMoney');
  if (!list) return;
  moneyEl.textContent = '$' + player.money;
  list.innerHTML = '';

  const addRow = (icon, name, desc, price, owned, onClick) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:9px 12px;' +
      'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);' +
      'border-radius:8px;text-align:left;font-size:13px;color:#dbe4f2';
    const canBuy = !owned && player.money >= price;
    row.innerHTML =
      '<span style="font-size:22px">' + icon + '</span>' +
      '<span style="flex:1"><b style="color:#fff">' + name + '</b><br>' +
      '<small style="color:#8fa0b8">' + desc + '</small></span>' +
      (owned
        ? '<b style="color:#7dff9b">POSSEDUTO</b>'
        : '<b style="color:' + (canBuy ? '#ffd34d' : '#7a8494') + '">$' + price + '</b>');
    if (!owned) {
      const b = document.createElement('button');
      b.textContent = 'ACQUISTA';
      b.style.cssText = 'padding:6px 14px;font-size:12px;letter-spacing:1px';
      b.disabled = !canBuy;
      b.addEventListener('click', () => { onClick(); renderShop(); });
      row.appendChild(b);
    }
    list.appendChild(row);
  };

  for (let i = 0; i < WEAPONS.length; i++) {
    const w = WEAPONS[i];
    if (w.price <= 0) continue;               // pugni e pistola sono gratis
    addRow(w.icon, w.name, 'Arma', w.price, ownedWeapons.has(i), () => buyWeapon(i));
  }
  for (const it of SHOP_ITEMS) {
    addRow(it.icon, it.name, it.desc, it.price, false, () => buyItem(it.id));
  }
}

/* =========================================================================
   GIOCATORE
   ========================================================================= */
const player = {
  x: 60, z: 60, a: -Math.PI / 2, vx: 0, vz: 0,
  hp: 100, maxhp: 100, car: null,
  money: 300, heat: 0, heatCool: 0, wasted: false,
  walkPhase: 0, inCarSince: 0,
  // --- fisica verticale: il giocatore sta a terra, puo' saltare ---
  y: 0,            // altezza sopra il suolo
  vy: 0,           // velocita' verticale
  onGround: true,
  radius: 0.42,    // raggio del corpo per le collisioni
  mass: 80,        // kg: serve alle collisioni con i veicoli
  ammo: 120, maxAmmo: 999, weapon: 'pistol', shootCd: 0,
  // munizioni di riserva e ricarica: senza questo si spara finche' non
  // resta niente e non c'e' piu' nulla da fare
  reserve: 240, reloading: 0
};
const stats = { cars: 0, best: 0, packagesFound: 0 };

/* ---------- PERSONAGGIO ----------
   Un low-poly umano costruito a primitive: proporzioni reali (~1.78m),
   con leve su braccia e gambe per l'animazione.
   I gruppi "pivot" stanno nel punto in cui l'arto si attacca al corpo. */
const SKINS = [0xf0c8a0, 0xe0aa80, 0xc08858, 0x9a6a42, 0x7a4e30, 0xf6d8b8];
const HAIRS = [0x2b1f18, 0x4a3020, 0x1a1a1a, 0x6b4a2a, 0x8a6b3a, 0x302018];
const SHIRTS = [0x4f83d0, 0xd0524c, 0x59c98c, 0xd9bb4a, 0x9563d0, 0x2fa5a5, 0xe8e4dc, 0x33405c];
const PANTS = [0x2b3040, 0x3d4a63, 0x5a4632, 0x22262e, 0x6b6257];

function limb(len, r) {
  return new THREE.CapsuleGeometry(r, len, 3, 7);
}

/* Torso affusolato: cilindro a 8 spigoli, schiacciato in profondità. */
function torsoGeo(s) {
  const g = new THREE.CylinderGeometry(0.20 * s, 0.165 * s, 0.50 * s, 8);
  g.scale(1, 1, 0.62);
  return g;
}

/* Corpo completo. opts = { skin, hair, shirt, pants, shoe }
   Restituisce { group, armL, armR, legL, legR, head } */
function buildHuman(opts) {
  const o = opts || {};
  const skin = o.skin !== undefined ? o.skin : pick(SKINS);
  const hair = o.hair !== undefined ? o.hair : pick(HAIRS);
  const shirt = o.shirt !== undefined ? o.shirt : pick(SHIRTS);
  const pants = o.pants !== undefined ? o.pants : pick(PANTS);
  const shoe = o.shoe !== undefined ? o.shoe : 0x241c18;

  const mSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78 });
  const mHair = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.86 });
  const mShirt = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.82 });
  const mPants = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.88 });
  const mShoe = new THREE.MeshStandardMaterial({ color: shoe, roughness: 0.6, metalness: 0.1 });

  const g = new THREE.Group();

  const add = (geo, mat, x, y, z, parent) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    (parent || g).add(m);
    return m;
  };

  // --- gambe (pivot all'anca) ---
  const legGeo = limb(0.6, 0.095);
  const legL = new THREE.Group(); legL.position.set(-0.105, 0.90, 0); g.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.105, 0.90, 0); g.add(legR);
  add(legGeo, mPants, 0, -0.34, 0, legL);
  add(legGeo, mPants, 0, -0.34, 0, legR);
  // scarpe
  const shoeGeo = new THREE.BoxGeometry(0.19, 0.11, 0.33);
  add(shoeGeo, mShoe, 0, -0.70, 0.05, legL);
  add(shoeGeo, mShoe, 0, -0.70, 0.05, legR);

  // --- bacino + torace ---
  add(new THREE.BoxGeometry(0.33, 0.22, 0.22), mPants, 0, 0.93, 0);
  const torso = new THREE.Group(); torso.position.y = 1.05; g.add(torso);
  add(torsoGeo(1), mShirt, 0, 0.26, 0, torso);
  // spalle
  add(new THREE.BoxGeometry(0.48, 0.13, 0.23), mShirt, 0, 0.47, 0, torso);
  // collo
  add(new THREE.CylinderGeometry(0.075, 0.085, 0.13, 8), mSkin, 0, 0.58, 0, torso);

  // --- braccia (pivot alla spalla) ---
  const armGeo = limb(0.46, 0.068);
  const armL = new THREE.Group(); armL.position.set(-0.255, 0.45, 0); torso.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.255, 0.45, 0); torso.add(armR);
  add(armGeo, mShirt, 0, -0.25, 0, armL);
  add(armGeo, mShirt, 0, -0.25, 0, armR);
  add(new THREE.SphereGeometry(0.072, 8, 6), mSkin, 0, -0.50, 0, armL);
  add(new THREE.SphereGeometry(0.072, 8, 6), mSkin, 0, -0.50, 0, armR);

  // --- testa ---
  const head = new THREE.Group(); head.position.y = 0.63; torso.add(head);
  const headGeo = new THREE.SphereGeometry(0.15, 14, 12);
  headGeo.scale(1, 1.1, 1);
  add(headGeo, mSkin, 0, 0.13, 0, head);
  // capelli: mezza calotta spostata indietro
  const hairGeo = new THREE.SphereGeometry(0.157, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  hairGeo.scale(1, 1.06, 1.03);
  add(hairGeo, mHair, 0, 0.145, -0.012, head);
  // orecchie
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.035, 6, 5), mSkin, s * 0.152, 0.12, 0, head);
  
  let weaponMeshes = null;
  // occhi e armi (solo per il protagonista)
  if (o.face) {
    const eye = new THREE.MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.024, 7, 6), eye);
      e.position.set(s * 0.058, 0.145, 0.132);
      head.add(e);
    }

    // Supporto e modelli 3D per tutte le armi nella mano destra
    const weaponHolder = new THREE.Group();
    weaponHolder.position.set(0, -0.48, 0.12);
    armR.add(weaponHolder);

    // 1. Pistola .45
    const pistolMesh = new THREE.Group();
    const gunBody = new THREE.Mesh(GEO.box, M.metalGun);
    gunBody.scale.set(0.08, 0.12, 0.26);
    gunBody.castShadow = true;
    pistolMesh.add(gunBody);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), M.metalGun);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.04, 0.16);
    pistolMesh.add(barrel);
    weaponHolder.add(pistolMesh);

    // 2. UZI 9mm
    const uziMesh = new THREE.Group();
    const uziBody = new THREE.Mesh(GEO.box, M.metalGun);
    uziBody.scale.set(0.08, 0.14, 0.28);
    uziMesh.add(uziBody);
    const uziMag = new THREE.Mesh(GEO.box, M.carTrim);
    uziMag.scale.set(0.06, 0.22, 0.07);
    uziMag.position.set(0, -0.16, 0.02);
    uziMesh.add(uziMag);
    const uziBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), M.metalGun);
    uziBarrel.rotation.x = Math.PI / 2;
    uziBarrel.position.set(0, 0.04, 0.18);
    uziMesh.add(uziBarrel);
    weaponHolder.add(uziMesh);

    // 3. Fucile a Pompa 12G
    const shotgunMesh = new THREE.Group();
    const sgStock = new THREE.Mesh(GEO.box, M.wood);
    sgStock.scale.set(0.07, 0.12, 0.32);
    sgStock.position.set(0, -0.04, -0.16);
    shotgunMesh.add(sgStock);
    const sgBody = new THREE.Mesh(GEO.box, M.metalGun);
    sgBody.scale.set(0.08, 0.11, 0.26);
    shotgunMesh.add(sgBody);
    const sgPump = new THREE.Mesh(GEO.box, M.carTrim);
    sgPump.scale.set(0.09, 0.09, 0.16);
    sgPump.position.set(0, -0.03, 0.22);
    shotgunMesh.add(sgPump);
    const sgBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.46, 8), M.metalGun);
    sgBarrel.rotation.x = Math.PI / 2;
    sgBarrel.position.set(0, 0.03, 0.34);
    shotgunMesh.add(sgBarrel);
    weaponHolder.add(shotgunMesh);

    // 4. Lanciarazzi RPG
    const rpgMesh = new THREE.Group();
    const rpgTube = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1.15, 10), M.rpgGreen);
    rpgTube.rotation.x = Math.PI / 2;
    rpgMesh.add(rpgTube);
    const rpgCone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.28, 10), M.leaf);
    rpgCone.rotation.x = Math.PI / 2;
    rpgCone.position.set(0, 0, 0.65);
    rpgMesh.add(rpgCone);
    const rpgTip = new THREE.Mesh(GEO.cyl, M.gold);
    rpgTip.scale.set(0.03, 0.08, 0.03);
    rpgTip.rotation.x = Math.PI / 2;
    rpgTip.position.set(0, 0, 0.81);
    rpgMesh.add(rpgTip);
    weaponHolder.add(rpgMesh);

    weaponMeshes = { pistol: pistolMesh, uzi: uziMesh, shotgun: shotgunMesh, rpg: rpgMesh };
  }

  return { group: g, armL, armR, legL, legR, head, torso, weaponMeshes,
           mats: { mSkin, mHair, mShirt, mPants, mShoe } };
}

const hero = buildHuman({ shirt: 0xffcf3c, pants: 0x2f3a52, skin: 0xf0c090, hair: 0x241a14, face: true });
const playerMesh = hero.group;
playerMesh.add(makeBlob(0.55));
let playerLegL = hero.legL, playerLegR = hero.legR;
scene.add(playerMesh);

function updateWeaponVisuals() {
  const w = WEAPONS[currentWeaponIdx];
  if (hero.weaponMeshes) {
    hero.weaponMeshes.pistol.visible = (w.id === 'pistol');
    hero.weaponMeshes.uzi.visible = (w.id === 'uzi');
    hero.weaponMeshes.shotgun.visible = (w.id === 'shotgun');
    hero.weaponMeshes.rpg.visible = (w.id === 'rpg');
  }
  const wicon = document.getElementById('wicon');
  const wname = document.getElementById('wname');
  const wammo = document.getElementById('wammo');
  if (wicon) wicon.textContent = w.icon;
  if (wname) wname.textContent = w.name;
  // HUD munizioni: mostra CARICATORE / RISERVA e l'indicatore di ricarica
  const curW2 = WEAPONS[currentWeaponIdx];
  if (wammo) {
    if (curW2.ammo === Infinity) {
      wammo.textContent = '∞';
    } else {
      wammo.textContent = player.reloading > 0
        ? 'RIC…'
        : player.ammo + '/' + player.reserve;
      wammo.style.color = player.reloading > 0 ? '#ffd34d'
        : (player.ammo === 0 ? '#ff6b5e' : (player.ammo <= curW2.ammo * 0.25 ? '#ffb020' : '#e8ecf4'));
    }
  }

  const dots = document.querySelectorAll('.wdot');
  dots.forEach((d, idx) => {
    if (idx === currentWeaponIdx) d.classList.add('active');
    else d.classList.remove('active');
  });
}

function selectWeapon(idx) {
  if (idx < 0 || idx >= WEAPONS.length) return;
  // non puoi equipaggiare un'arma che non hai comprato
  if (!ownedWeapons.has(idx)) {
    showToast(WEAPONS[idx].name + ' non acquistata', 1.6);
    return;
  }
  if (currentWeaponIdx === idx) return;
  currentWeaponIdx = idx;
  sfx('weapon_switch');
  updateWeaponVisuals();
  showToast('Arma: ' + WEAPONS[currentWeaponIdx].name, 1.2);
}
updateWeaponVisuals();

/* =========================================================================
   CAMERA
   ========================================================================= */
let camMode = 0; // 0 inseguimento, 1 vicina, 2 cinematografica
let camYaw = -Math.PI / 2;
let camPitch = 0.22;
let isRightMouseDown = false, isLeftMouseDown = false;
const camPos = new THREE.Vector3(0, 12, -22);
const camLook = new THREE.Vector3();
let camShake = 0;

function updateCamera(dt) {
  // rete di sicurezza: se una posizione diventa NaN, la riparo subito
  if (!Number.isFinite(player.x)) player.x = WORLD / 2;
  if (!Number.isFinite(player.z)) player.z = WORLD / 2;
  if (!Number.isFinite(player.a)) player.a = 0;
  if (!Number.isFinite(camPos.x) || !Number.isFinite(camPos.y) || !Number.isFinite(camPos.z)) {
    camPos.set(player.x, 12, player.z - 20);
  }
  if (!Number.isFinite(camLook.x) || !Number.isFinite(camLook.y) || !Number.isFinite(camLook.z)) {
    camLook.set(player.x, 2, player.z);
  }

  const px = player.x, pz = player.z;
  const py = player.car ? (player.car.isMoto ? 0.9 : 1.1) : 1.5;
  const c = player.car;
  const spd = c ? Math.abs(c.speed) : Math.hypot(player.vx, player.vz);

  // In auto: camYaw segue dolcemente l'auto a meno di drag manuale
  if (c && !isRightMouseDown && !isLeftMouseDown) {
    camYaw = angApproach(camYaw, c.a, dt * 3.4);
  }

  let dist_, height;
  if (camMode === 1) { dist_ = c ? 8.5 : 7.2; height = c ? 3.6 : 2.7; }
  else if (camMode === 2) { dist_ = 32; height = 18; }
  else {
    dist_ = (c ? 13 : 11) + Math.min(spd * 0.2, 7);
    height = (c ? 6.5 : 4.8) + Math.min(spd * 0.05, 3);
  }

  const cosP = Math.cos(camPitch), sinP = Math.sin(camPitch);
  const tx = px - Math.sin(camYaw) * dist_ * cosP;
  const tz = pz - Math.cos(camYaw) * dist_ * cosP;
  const ty = py + height + sinP * dist_;

  const lam = camMode === 0 ? 8 : 10;
  camPos.x = damp(camPos.x, tx, lam, dt);
  camPos.y = damp(camPos.y, ty, lam, dt);
  camPos.z = damp(camPos.z, tz, lam, dt);

  const lx = px + Math.sin(camYaw) * 6;
  const lz = pz + Math.cos(camYaw) * 6;
  const ly = py + 0.6;

  camLook.x = damp(camLook.x, lx, 10, dt);
  camLook.y = damp(camLook.y, ly, 10, dt);
  camLook.z = damp(camLook.z, lz, 10, dt);

  camera.position.copy(camPos);
  // evita che la camera finisca dentro un palazzo:
  // campiona il segmento player->camera e accorcia se trova un muro
  if (inBuilding(camPos.x, camPos.z, 1.5)) {
    let ok = false;
    for (let t = 0.95; t >= 0.15; t -= 0.1) {
      const sx = lerp(px, camPos.x, t), sz = lerp(pz, camPos.z, t);
      if (!inBuilding(sx, sz, 1.5)) {
        camera.position.x = sx; camera.position.z = sz;
        camera.position.y = lerp(py + 6, camPos.y, t);
        ok = true; break;
      }
    }
    if (!ok) { camera.position.x = px; camera.position.z = pz; camera.position.y = py + 9; }
  }
  if (camShake > 0) {
    camera.position.x += rand(-camShake, camShake);
    camera.position.y += rand(-camShake, camShake);
    camShake = Math.max(0, camShake - dt * 22);
  }
  camera.lookAt(camLook);
  // la luce segue il giocatore per mantenere le ombre nitide
  sun.position.set(px + 90, 150, pz + 60);
  sun.target.position.set(px, 0, pz);
  sun.target.updateMatrixWorld();
  // cielo e disco solare restano "all'infinito"
  skyGroup.position.copy(camera.position);
  skyDome.position.set(0, 0, 0);
  sunDisc.lookAt(camera.position);
}

/* =========================================================================
   PUNTI DI STRADA
   ========================================================================= */
/* Distanza dalla carreggiata piu' vicina, e la via su cui si trova il punto. */
function onRoad(x, z) {
  const fx = Math.abs(((x + BLOCK / 2) % BLOCK) - BLOCK / 2);
  const fz = Math.abs(((z + BLOCK / 2) % BLOCK) - BLOCK / 2);
  const lim = BLOCK / 2 - ROADW / 2;
  return fx <= lim || fz <= lim;
}
/* Piu' vicino punto sicuro sull'asfalto. */
function snapToRoad(x, z) {
  const fx = Math.abs(((x + BLOCK / 2) % BLOCK) - BLOCK / 2);
  const fz = Math.abs(((z + BLOCK / 2) % BLOCK) - BLOCK / 2);
  const lim = BLOCK / 2 - ROADW / 2;
  let nx = x, nz = z;
  if (fx > fz) {
    // correggi la coordinata che e' piu' lontana dalla strada
    const gi = Math.round(x / BLOCK) * BLOCK;
    nx = gi + Math.sign(x - gi || 1) * (lim - 2.5);
  } else {
    const gj = Math.round(z / BLOCK) * BLOCK;
    nz = gj + Math.sign(z - gj || 1) * (lim - 2.5);
  }
  return { x: clamp(nx, 4, WORLD - 4), z: clamp(nz, 4, WORLD - 4) };
}

function randRoadPoint(minFromPlayer) {
  const min = minFromPlayer || 0;
  for (let t = 0; t < 80; t++) {
    const gi = randInt(0, GRID) * BLOCK;
    const along = rand(8, WORLD - 8);
    const horiz = Math.random() < 0.5;
    const off = rand(-ROADW / 2 + 3, ROADW / 2 - 3);
    let x = horiz ? along : gi + off;
    let z = horiz ? gi + off : along;
    x = clamp(x, 6, WORLD - 6); z = clamp(z, 6, WORLD - 6);
    if (!onRoad(x, z)) continue;
    if (inBuilding(x, z, 2.4)) continue;
    if (min && dist(x, z, player.x, player.z) < min) continue;
    return { x, z };
  }
  return { x: WORLD / 2, z: WORLD / 2 };
}
function snapLane(o, lane) {
  // riporta il veicolo nella corsia corretta
  const fx = Math.abs(((o.x + BLOCK / 2) % BLOCK) - BLOCK / 2);
  const fz = Math.abs(((o.z + BLOCK / 2) % BLOCK) - BLOCK / 2);
  if (Math.abs(fz) < BLOCK / 2 - ROADW / 2 + 0.01) {
    // siamo su una strada orizzontale: correggi z
    const gi = Math.round(o.z / BLOCK) * BLOCK;
    o.z = clamp(o.z, gi - ROADW / 2 + lane, gi + ROADW / 2 - lane);
  } else {
    const gi = Math.round(o.x / BLOCK) * BLOCK;
    o.x = clamp(o.x, gi - ROADW / 2 + lane, gi + ROADW / 2 - lane);
  }
}

/* =========================================================================
   FISICA VEICOLI
   ========================================================================= */
/* Normalizza l'input a 0/1. Senza questo, `input.right - input.left` con tasti
   non premuti vale undefined - undefined = NaN, che avvelena l'angolo
   dell'auto e poi la camera (che usa sin/cos di quell'angolo). */
function axis(name) { return keys[name] ? 1 : 0; }

function driveCar(c, dt) {
  const throttle = axis('up');
  const brake = axis('down');
  const hb = axis('brake') > 0;
  const steer = axis('right') - axis('left');

  const accel = (c.isSuper ? 38 : c.isMoto ? 35 : c.isChopper ? 33 : c.isTaxi ? 28 : c.isVan ? 22 : c.isAmbulance ? 20 : 26) * dt * (c.hp < 35 ? 0.6 : 1);
  const maxS = c.isSuper ? 42 : c.isMoto ? 37 : c.isChopper ? 35 : c.isTaxi ? 32 : c.isVan ? 26 : c.isAmbulance ? 23 : 30;
  const steerRate = c.isMoto ? 3.1 : c.isChopper ? 2.7 : c.isSuper ? 2.6 : c.isTaxi ? 2.4 : (c.isVan || c.isAmbulance) ? 1.8 : 2.3;

  if (throttle) c.speed += accel;
  else if (brake) c.speed -= (c.speed > 1.4 ? 46 : 17) * dt;
  // Resistenza aerodinamica: la velocita' si stabilizza dolcemente invece di
  // saturare di colpo. Il motore a vuoto continua pero' a spingere piano.
  else {
    const drag = 0.55 * dt * (c.speed / Math.max(maxS, 1));
    c.speed -= c.speed * Math.abs(drag) + (c.speed > 0 ? 0.35 : -0.35) * dt;
  }
  // freni: decadono in modo morbido quando rilasci il pedale
  if (!throttle && !brake) c.speed *= Math.pow(0.985, dt);

  // segnala la frenata (accende gli stop)
  const prevSpeed = c.speed;
  c.brakingT = (brake || c.speed < prevSpeed - 12 * dt) ? 0.15 : Math.max(0, (c.brakingT || 0) - dt);

  const mag = Math.abs(c.speed);
  const sign = c.speed >= 0 ? 1 : -1;
  let grip = clamp(mag / 3.2, 0, 1);
  if (hb) { grip = clamp(mag / 1.8, 0, 1) * 1.5; c.speed *= Math.pow(0.3, dt); }
  c.a += steer * steerRate * dt * grip * sign;

  // Fumo particellare da derapata con freno a mano o curva stretta veloce
  if ((hb && mag > 2.8) || (Math.abs(steer) > 0.45 && mag > 9)) {
    const rearOff = (c.isMoto || c.isChopper) ? -0.85 : (c.isVan || c.isAmbulance) ? -1.6 : -1.3;
    const rx = c.x - Math.sin(c.a) * rearOff;
    const rz = c.z - Math.cos(c.a) * rearOff;
    spawnParticles(rx + rand(-0.35, 0.35), 0.22, rz + rand(-0.35, 0.35), 0xe2e8f0, 2);
  }

  // Piega dinamica della moto in curva
  if (c.isMoto && c.mesh && c.mesh.g) {
    c.mesh.g.rotation.z = damp(c.mesh.g.rotation.z, -steer * (c.isChopper ? 0.25 : 0.35) * clamp(mag / 6, 0, 1), 10, dt);
  } else if (c.mesh && c.mesh.g) {
    // Auto: roll in curva e pitch in accelerazione/frenata.
    // Piccoli angoli, ma l'occhio li legge subito come "peso".
    const targetRoll = clamp(-c.slip * 0.035 - steer * mag * 0.006, -0.16, 0.16);
    const dSpeed = (c.speed - (c.lastSpeed || 0)) / Math.max(dt, 1e-4);
    const targetPitch = clamp(-dSpeed * 0.0016, -0.09, 0.09);
    c.roll = damp(c.roll || 0, targetRoll, 9, dt);
    c.pitch = damp(c.pitch || 0, targetPitch, 7, dt);
    c.lastSpeed = c.speed;
    c.mesh.g.rotation.z = c.roll;
    c.mesh.g.rotation.x = c.pitch;
    // sospensione: molla_smorzata che assorbe colpi e dossi
    c.mesh.g.position.y = -(c.suspY || 0);
  }

  // rete di sicurezza: se l'angolo si corrompe, si ripristina
  if (!Number.isFinite(c.a)) c.a = 0;

  c.speed = clamp(c.speed, -12, maxS);
  const mag2 = Math.abs(c.speed);
  // grip: tiene la macchina, si perde con freno a mano e curva spinta
  let gripK = hb ? 1.05 : 7.2;
  gripK -= Math.abs(steer) * clamp(mag2 / 9, 0, 1) * 2.6;
  gripK = Math.max(0.7, gripK);
  c.slip *= Math.exp(-gripK * dt);
  // la curva genera slittamento laterale
  c.slip -= steer * mag2 * (hb ? 0.62 : 0.34) * dt;
  c.slip = clamp(c.slip, -13, 13);
  if (mag2 < 0.4) c.slip *= 0.5;

  const fwdX = Math.sin(c.a), fwdZ = Math.cos(c.a);
  const rgtX = Math.cos(c.a), rgtZ = -Math.sin(c.a);
  const dx = (fwdX * c.speed + rgtX * c.slip) * dt;
  const dz = (fwdZ * c.speed + rgtZ * c.slip) * dt;
  c.x += dx; c.z += dz;
  c.vx = dx / dt; c.vz = dz / dt;

  const hitRadius = (c.isMoto || c.isChopper) ? 1.0 : (c.isVan || c.isAmbulance) ? 2.2 : 1.9;
  const hit = pushOut(c, hitRadius);
  if (hit) {
    const imp = Math.abs(c.speed);
    if (imp > 3.2) {
      damageCar(c, imp * (c.isAmbulance ? 0.25 : c.isMoto ? 0.8 : 0.5));
      player.hp = Math.max(0, player.hp - imp * (c.isMoto ? 0.65 : 0.42));
      camShake = Math.min(0.9, camShake + imp * 0.05);
      sfx('crash');
    }
    // il colpo scuote la sospensione: il veicolo si "affonda" e rimbalza.
    // NOTA: l'ampiezza non dipende dalla massa (un impatto e' un impatto);
    // e' la MOLLA ad essere piu' morbida sul pesante, quindi oscilla di piu'.
    c.suspVY -= Math.min(0.5, imp * 0.055);
    c.speed *= -0.22;
    c.slip *= 0.3;          // contro un muro la macchina perde la derapata
    c.vx *= -0.2; c.vz *= -0.2;
  }
  c.x = clamp(c.x, 5, WORLD - 5); c.z = clamp(c.z, 5, WORLD - 5);
  if (!Number.isFinite(c.x)) { c.x = WORLD / 2; c.speed = 0; }
  if (!Number.isFinite(c.z)) { c.z = WORLD / 2; c.speed = 0; }
  if (!Number.isFinite(c.speed)) c.speed = 0;

  /* --- sospensione: molla smorzata sul corpo.
     K e' tarata sulla massa: piu' pesante = piu' rigida e lenta. */
  const SUSP_K = 260 / Math.max(1, c.mass / 1000);   // rigidita'
  const SUSP_C = 2.0 * Math.sqrt(SUSP_K) * 0.55;   // smorzamento
  // restituisce il corpo alla posizione di riposo
  c.suspVY += (-(c.suspY || 0) * SUSP_K - (c.suspVY || 0) * SUSP_C) * dt;
  c.suspY = (c.suspY || 0) + c.suspVY * dt;
  if (Math.abs(c.suspY) < 0.001 && Math.abs(c.suspVY) < 0.01) { c.suspY = 0; c.suspVY = 0; }

  // pedoni
  for (const p of peds) {
    if (p.down > 0) continue;
    if (dist2(c.x, c.z, p.x, p.z) < 6.2 * 6.2 && Math.abs(c.speed) > 3) {
      p.down = 1;
      p.vx = Math.sin(c.a) * Math.abs(c.speed) * 0.9;
      p.vz = Math.cos(c.a) * Math.abs(c.speed) * 0.9;
      addWanted(0.34, true);
      spawnParticles(p.x, 1.0, p.z, 0xb03030, 12);
      addFloater('-$5', p.x, 2.2, p.z, '#ff6b5e');
      player.money = Math.max(0, player.money - 5);
      camShake = Math.min(0.8, camShake + 0.3);
      sfx('hit');
    }
  }
  // contro altri veicoli
  for (const o of cars) {
    if (o === c) continue;
    const ddx = o.x - c.x, ddz = o.z - c.z;
    const dd = ddx * ddx + ddz * ddz;
    const rr = 3.1;
    if (dd < rr * rr && dd > 1e-4) {
      const dl = Math.sqrt(dd);
      const ux = ddx / dl, uz = ddz / dl;
      /* Risoluzione pesata dalla massa: il veicolo piu' leggero viene
         spinto molto di piu'. Una moto contro un camion non e' uno scontro
         equipollente, e questo e' quello che si vede. */
      const m1 = c.mass || 1350, m2 = o.mass || 1350;
      const tot = m1 + m2;
      const overlap = rr - dl;
      c.x -= ux * overlap * (m2 / tot); c.z -= uz * overlap * (m2 / tot);
      o.x += ux * overlap * (m1 / tot); o.z += uz * overlap * (m1 / tot);

      const rel = Math.abs(c.speed - o.speed * Math.cos(angDiff(o.a, c.a)));
      if (rel > 7) {
        // i danni seguono l'energia: l'urto colpisce piu' il mezzo leggero
        const lighter = m1 < m2 ? c : o;
        const heavier = m1 < m2 ? o : c;
        const lightPct = heavier.mass / tot;   // >0.5 se il leggero prende piu'
        damageCar(c, rel * 0.35 * lightPct);
        damageCar(o, rel * 0.35 * lightPct);
        player.hp = Math.max(0, player.hp - rel * 0.2);
        camShake = Math.min(0.9, camShake + rel * 0.05);
        if (o.isCop) addWanted(0.3, true);
        sfx('crash');
        // scossone anche sulla sospensione dell'altro veicolo
        lighter.suspVY -= Math.min(0.45, rel * 0.05);
      }
      // perdite di velocita' proporzionali: il pesante rallenta poco
      const heavyC = clamp(m2 / tot, 0.25, 0.75);   // quanto c'era dall'altro
      c.speed *= (0.72 + 0.26 * heavyC);
      o.speed *= (0.72 + 0.26 * (1 - heavyC));
    }
  }
  // rotazione ruote
  for (const w of c.mesh.wheels) w.rotation.x -= c.speed * dt * 2.2;
}

function damageCar(c, d) {
  c.hp -= d;
  if (c.hp <= 0 && !c.burning) {
    c.hp = 0; c.burning = true; c.burnT = 0;
    spawnParticles(c.x, 1.0, c.z, 0xff8a3c, 16);
    if (c.driver) {
      player.hp = Math.max(0, player.hp - 42);
      camShake = 1.2;
      exitCar(true);
    }
    if (c.isCop) addWanted(0.35, true);
    sfx('boom');
  }
}

function trafficDrive(c, dt) {
  const fx = Math.sin(c.a), fz = Math.cos(c.a);
  let brake = false;
  for (const o of cars) {
    if (o === c) continue;
    const dx = o.x - c.x, dz = o.z - c.z;
    const fwd = dx * fx + dz * fz;
    const side = Math.abs(-dx * fz + dz * fx);
    if (fwd > 0 && fwd < 9 && side < 2.6) { brake = true; break; }
  }
  const ni = Math.floor((c.x + 1) / BLOCK), nj = Math.floor((c.z + 1) / BLOCK);
  if (ni !== c.ni || nj !== c.nj) {
    c.ni = ni; c.nj = nj;
    if (dist(c.x, c.z, ni * BLOCK, nj * BLOCK) < 16) c.turn = pickTurn(c.a);
  }
  let target = 17;
  if (brake) target = 3;
  // semaforo rosso: frena prima dell'incrocio
  if (!brake && redLightAhead(c)) target = 0;
  if (c.turn !== null) {
    c.a = angApproach(c.a, c.turn, dt * 2.6);
    if (Math.abs(angDiff(c.a, c.turn)) < 0.05) { c.a = c.turn; c.turn = null; snapLane(c, 4); }
    target *= 0.7;
  }
  c.speed = approach(c.speed, target, (brake ? 40 : 20) * dt);
  c.brakingT = (brake || target < 2) ? 0.15 : Math.max(0, (c.brakingT || 0) - dt);
  c.x += Math.sin(c.a) * c.speed * dt;
  c.z += Math.cos(c.a) * c.speed * dt;
  c.vx = Math.sin(c.a) * c.speed; c.vz = Math.cos(c.a) * c.speed;
  pushOut(c, 1.9);
  // integrita' numerica: un NaN qui si propaga a tutto il mondo
  if (!Number.isFinite(c.x)) { c.x = WORLD / 2; c.speed = 0; }
  if (!Number.isFinite(c.z)) { c.z = WORLD / 2; c.speed = 0; }
  if (!Number.isFinite(c.a)) c.a = 0;
  for (const w of c.mesh.wheels) w.rotation.x -= c.speed * dt * 2.2;
}
function pickTurn(a) {
  const r = Math.random();
  if (r < 0.55) return a;
  if (r < 0.78) return a + Math.PI / 2;
  if (r < 0.96) return a - Math.PI / 2;
  return a + Math.PI;
}

function copDrive(c, dt) {
  const stars = Math.floor(player.heat);
  const ang = Math.atan2(player.x - c.x, player.z - c.z);
  c.a = angApproach(c.a, ang, dt * (2.2 + stars * 0.13));
  let target = 19 + stars * 1.8;
  // la polizia ignora i semafori: insegue a tutti i costi
  // evita edifici davanti
  const look = 7 + Math.abs(c.speed) * 0.9;
  if (inBuilding(c.x + Math.sin(c.a) * look, c.z + Math.cos(c.a) * look, 2)) {
    c.a = angApproach(c.a, c.a + (Math.random() < 0.5 ? 0.9 : -0.9), dt * 3.4);
    target = 17;
  }
  c.speed = approach(c.speed, target, 28 * dt);
  c.x += Math.sin(c.a) * c.speed * dt;
  c.z += Math.cos(c.a) * c.speed * dt;
  c.vx = Math.sin(c.a) * c.speed; c.vz = Math.cos(c.a) * c.speed;
  if (pushOut(c, 1.9)) { c.speed *= -0.2; damageCar(c, 3); }
  if (!Number.isFinite(c.x)) { c.x = WORLD / 2; c.speed = 0; }
  if (!Number.isFinite(c.z)) { c.z = WORLD / 2; c.speed = 0; }
  if (!Number.isFinite(c.a)) c.a = 0;

  // contro il giocatore
  const pc = player.car;
  if (pc && dist2(c.x, c.z, pc.x, pc.z) < 3.4 * 3.4) {
    const rel = Math.abs(c.speed);
    if (rel > 9) {
      player.hp = Math.max(0, player.hp - rel * 0.4);
      damageCar(pc, rel * 0.4); damageCar(c, rel * 0.5);
      camShake = Math.min(1, camShake + 0.4);
      addWanted(0.28, true);
      sfx('crash');
    }
  } else if (!pc && dist2(c.x, c.z, player.x, player.z) < 2.6 * 2.6 && Math.abs(c.speed) > 6) {
    player.hp = Math.max(0, player.hp - Math.abs(c.speed) * 0.7);
    player.vx = Math.sin(c.a) * 16; player.vz = Math.cos(c.a) * 16;
    c.speed *= 0.5;
    addWanted(0.3, true);
    camShake = 0.5;
    sfx('hit');
  }

  c.flash = Math.max(0, c.flash - dt);
  if (stars >= 3 && !pc) {
    c.shootCd -= dt;
    if (c.shootCd <= 0 && dist(c.x, c.z, player.x, player.z) < 45) {
      c.shootCd = rand(0.8, 1.6);
      bullets.push({ x: c.x, z: c.z, a: ang + rand(-0.1, 0.1), life: 1.6, dmg: 7 });
      c.flash = 0.12;
    }
  }
}

/* =========================================================================
   PARTICELLE / FLOATERS
   ========================================================================= */
const particles = [];
const floaters = [];
const fxGroup = new THREE.Group();
scene.add(fxGroup);
const bulletGroup = new THREE.Group();
scene.add(bulletGroup);
let bullets = [];

function spawnParticles(x, y, z, col, n) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: col }));
    m.scale.setScalar(rand(0.12, 0.3));
    m.position.set(x, y, z);
    fxGroup.add(m);
    particles.push({
      m, life: rand(0.35, 0.9),
      vx: rand(-7, 7), vy: rand(2, 9), vz: rand(-7, 7)
    });
  }
}
function addFloater(txt, x, y, z, col) {
  floaters.push({ txt, x, y, z, life: 1.3, col });
}

/* =========================================================================
   MISSIONI
   ========================================================================= */
let offer = null, mission = null, nextOfferT = 0, offerT = 0;
const markers = [];
const markerGroup = new THREE.Group();
scene.add(markerGroup);

function makeMarkerMesh(colorMat) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.22, 8, 32), colorMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.3;
  g.add(ring);
  const cyl = new THREE.Mesh(GEO.cyl, colorMat);
  cyl.scale.set(4.4, 0.06, 4.4);
  cyl.position.y = 0.22;
  g.add(cyl);
  return g;
}
const markerOffer = makeMarkerMesh(M.gold);
const markerGo = makeMarkerMesh(M.green);
const markerBlue = makeMarkerMesh(M.blue);
markerGroup.add(markerOffer, markerGo, markerBlue);
markerOffer.visible = markerGo.visible = markerBlue.visible = false;

function newOffer() {
  const type = pick(['goto', 'race', 'steal', 'collect', 'evade', 'taxi']);
  const at = randRoadPoint(70);
  offer = { type, x: at.x, z: at.z };
  if (type === 'race') {
    offer.pts = Array.from({ length: 5 }, () => randRoadPoint(60));
    offer.reward = 900; offer.desc = 'Corsa: 5 checkpoint in sequenza entro 90 secondi';
  } else if (type === 'collect') {
    offer.pts = Array.from({ length: 6 }, () => randRoadPoint(60));
    offer.reward = 1100; offer.desc = 'Raccogli 6 punti in città';
  } else if (type === 'steal') {
    offer.carSpot = randRoadPoint(50);
    const g = randRoadPoint(70);
    offer.x = g.x; offer.z = g.z;
    offer.reward = 800; offer.desc = 'Ruba l\'auto speciale (dorata) e portala al garage';
  } else if (type === 'evade') {
    offer.reward = 750; offer.desc = 'Fai scendere le stelle di ricercato a 0 entro 90 secondi';
  } else if (type === 'taxi') {
    offer.pickup = randRoadPoint(50);
    offer.dest = randRoadPoint(80);
    offer.reward = 650;
    offer.desc = 'Servizio Taxi: prendi a bordo il cliente e portalo a destinazione in 65s';
  } else {
    offer.time = 50; offer.reward = 400;
    offer.desc = 'Consegna rapida: raggiungi il punto verde entro 50 secondi';
  }
  markerOffer.position.set(offer.x, 0, offer.z);
  markerOffer.visible = true;
}
function clearOfferVis() { markerOffer.visible = false; }

function startOffer() {
  if (!offer) return;
  if (offer.type === 'steal') {
    const c = makeCar(offer.carSpot.x, offer.carSpot.z, pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), false);
    c.mesh.bodyMat.color.setHex(0xffcf3c);
    c.isSpecial = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.18, 8, 28), M.gold);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    c.mesh.g.add(ring);
    mission = { type: 'steal', car: c, tx: offer.x, tz: offer.z, t: 0, reward: offer.reward, desc: offer.desc };
  } else if (offer.type === 'race') {
    mission = { type: 'race', pts: offer.pts, i: 0, t: 90, reward: offer.reward, desc: offer.desc };
  } else if (offer.type === 'collect') {
    mission = { type: 'collect', pts: offer.pts.map(p => ({ ...p, got: false })), i: 0, t: 0, reward: offer.reward, desc: offer.desc };
  } else if (offer.type === 'evade') {
    mission = { type: 'evade', t: 90, reward: offer.reward, desc: offer.desc };
    addWanted(2.5, false);
  } else if (offer.type === 'taxi') {
    mission = {
      type: 'taxi', step: 0,
      px: offer.pickup.x, pz: offer.pickup.z,
      tx: offer.dest.x, tz: offer.dest.z,
      t: 65, reward: offer.reward, desc: offer.desc
    };
  } else {
    mission = { type: 'goto', tx: offer.x, tz: offer.z, t: offer.time, reward: offer.reward, desc: offer.desc };
  }
  clearOfferVis();
  showToast('Missione: ' + mission.desc, 4);
  sfx('accept');
}
function completeMission(msg) {
  player.money += mission.reward;
  addFloater('+$' + mission.reward, player.x, 3, player.z, '#ffd34d');
  showToast(msg + '  +$' + mission.reward, 3.5);
  mission = null; nextOfferT = 2.5;
  markerGo.visible = markerBlue.visible = false;
  sfx('accept');
}
function failMission(reason) {
  showToast('Missione fallita: ' + reason, 3);
  mission = null; nextOfferT = 2;
  markerGo.visible = markerBlue.visible = false;
}

function updateMissions(dt) {
  nextOfferT -= dt;
  if (!mission && !offer && nextOfferT <= 0) newOffer();
  if (offer) offerT += dt;

  if (offer && !mission) {
    const d = dist(player.x, player.z, offer.x, offer.z);
    if (d < 7) startOffer();
    else if (offerT > 120) { nextOfferT = 1; offer = null; clearOfferVis(); }
  }
  if (!mission) return;
  const m = mission;
  if (m.t > 0) { m.t -= dt; if (m.t <= 0) { failMission('tempo scaduto'); return; } }

  if (m.type === 'goto') {
    markerGo.position.set(m.tx, 0, m.tz); markerGo.visible = true;
    if (dist(player.x, player.z, m.tx, m.tz) < 6) completeMission('Consegna completata');
  } else if (m.type === 'race') {
    const p = m.pts[m.i];
    if (p) { markerGo.position.set(p.x, 0, p.z); markerGo.visible = true; }
    if (p && dist(player.x, player.z, p.x, p.z) < 8.5) {
      m.i++;
      if (m.i >= m.pts.length) completeMission('Gara vinta');
    }
  } else if (m.type === 'collect') {
    const p = m.pts[m.i];
    if (p && !p.got) {
      markerBlue.position.set(p.x, 0, p.z); markerBlue.visible = true;
      if (dist(player.x, player.z, p.x, p.z) < 4.5) {
        p.got = true; m.i++;
        player.money += 25;
        spawnParticles(p.x, 1, p.z, 0x6ec7ff, 8);
        sfx('coin');
        if (m.i >= m.pts.length) completeMission('Punti raccolti');
      }
    } else markerBlue.visible = false;
  } else if (m.type === 'steal') {
    markerGo.position.set(m.tx, 0, m.tz); markerGo.visible = true;
    if (m.car.burning) { failMission('auto distrutta'); return; }
    if (player.car === m.car && dist(player.x, player.z, m.tx, m.tz) < 7) completeMission('Auto consegnata');
  } else if (m.type === 'evade') {
    if (player.heat <= 0.01) completeMission('Fuggito! Stelle scese');
  } else if (m.type === 'taxi') {
    if (m.step === 0) {
      markerGo.position.set(m.px, 0, m.pz);
      markerGo.visible = true;
      if (player.car && dist(player.x, player.z, m.px, m.pz) < 7.5) {
        m.step = 1;
        markerGo.position.set(m.tx, 0, m.tz);
        showToast('Passeggero a bordo! Portalo a destinazione in fretta!', 3);
        sfx('accept');
      }
    } else {
      markerGo.position.set(m.tx, 0, m.tz);
      markerGo.visible = true;
      if (player.car && player.car.burning) { failMission('veicolo distrutto'); return; }
      if (player.car && dist(player.x, player.z, m.tx, m.tz) < 7.5) {
        const fareRate = player.car.isTaxi ? 14 : 9;
        const bonus = Math.floor(Math.max(0, m.t) * fareRate);
        player.money += bonus;
        const taxiMsg = player.car.isTaxi ? `🚕 Corsa Taxi Ufficiale! Tariffa + mancia: +$${bonus}` : `Corsa completata! Mancia extra: +$${bonus}`;
        completeMission(taxiMsg);
      }
    }
  }
}

/* =========================================================================
   POLIZIA / RICERCA
   ========================================================================= */
let starsShown = 0;
function addWanted(v, violent) {
  if (state !== 'play') return;
  player.heat = clamp(player.heat + v, 0, 5);
  player.heatCool = 0;
  if (violent && player.heat > 0 && Math.random() < 0.3) showToast('La polizia ti ha visto!', 2);
}
function wantedCount() { return Math.min(6, Math.floor(player.heat) * 2); }

function updateWanted(dt) {
  const want = wantedCount();
  let copN = 0;
  for (const c of cars) if (c.isCop) copN++;

  if (player.heat > 0) {
    let seen = false;
    for (const c of cars) if (c.isCop && dist(c.x, c.z, player.x, player.z) < 60) { seen = true; break; }
    if (!seen) { player.heatCool += dt; if (player.heatCool > 6.5) { player.heat = Math.max(0, player.heat - dt * 0.34); player.heatCool = 0; } }
    else player.heatCool = 0;
  }

  while (copN < want) {
    const p = randRoadPoint(0);
    const d = dist(p.x, p.z, player.x, player.z);
    if (d < 55 || d > 120 || inBuilding(p.x, p.z, 2)) { if (copN > 20) break; continue; }
    const c = makeCar(p.x, p.z, Math.atan2(player.x - p.x, player.z - p.z), true);
    c.speed = 12;
    copN++;
    if (copN === 1) showToast('POLIZIA! Allontanati per far scendere le stelle', 3);
    break;
  }
  while (copN > want) {
    let far = null, fd = -1;
    for (const c of cars) {
      if (!c.isCop) continue;
      const d = dist(c.x, c.z, player.x, player.z);
      if (d > fd) { fd = d; far = c; }
    }
    if (!far || fd < 80) break;
    removeCar(far); copN--;
  }

  if (player.hp <= 0 && !player.wasted) {
    player.wasted = true; state = 'wasted';
    if (player.car) {
      player.car.driver = false;
      player.car = null;
    }
    if (mission) failMission('sei finito all\'ospedale');
    document.getElementById('wasted').classList.remove('hidden');
    sfx('boom');
  }
  if (player.heat === 0 && !player.car) player.hp = Math.min(player.maxhp, player.hp + dt * 3);
}

/* =========================================================================
   POPOLAZIONE
   ========================================================================= */
function updateSpawning(dt) {
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnT = 0.3;
    let civN = 0;
    for (const c of cars) if (!c.isCop) civN++;
    if (civN < CARS_MAX) {
      const p = randRoadPoint(0);
      const d = dist(p.x, p.z, player.x, player.z);
      if (d > 90 && d < 220 && !inBuilding(p.x, p.z, 2)) {
        const c = makeCar(p.x, p.z, pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), false);
        civN++;
      }
    }
    if (peds.length < PEDS_MAX) {
      const p = randRoadPoint(0);
      const d = dist(p.x, p.z, player.x, player.z);
      if (d > 45 && d < 150 && !inBuilding(p.x, p.z, 1.5)) makePed(p.x, p.z);
    }
  }
  // pulizia
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i];
    const d = dist(c.x, c.z, player.x, player.z);
    if (c.burning) {
      c.burnT += dt;
      if (Math.random() < 0.3) spawnParticles(c.x, 1.2, c.z, 0x444444, 1);
      if (c.burnT > 14 && !c.driver) { removeCar(c); continue; }
    }
    if (d > 340 && !c.isCop && !c.driver && !c.isSpecial) {
      c.respawn -= dt;
      if (c.respawn < 0) { removeCar(c); continue; }
    }
  }
  for (let i = peds.length - 1; i >= 0; i--) {
    const p = peds[i];
    const d = dist(p.x, p.z, player.x, player.z);
    if (d > 220 || (p.down > 0 && p.down > 6)) removePed(p);
  }
  for (const k of pickups) {
    if (k.got) {
      k.respawn -= dt;
      if (k.respawn <= 0) { k.got = false; k.mesh.visible = true; }
      continue;
    }
    k.mesh.rotation.y += dt * 0.6;
    if (dist2(k.x, k.z, player.x, player.z) < 3.4 * 3.4) {
      k.got = true; k.respawn = 30; k.mesh.visible = false;
      player.money += 50;
      for (const w of WEAPONS) {
        if (w.ammo !== Infinity) w.ammo = Math.min(w.maxAmmo, w.ammo + Math.round(w.maxAmmo * 0.25));
      }
      updateWeaponVisuals();
      addFloater('+$50 & Munizioni!', k.x, 2.4, k.z, '#7dff9b');
      sfx('coin');
    }
  }

  // Raccolta dei 10 Pacchetti Segreti
  for (const pkg of packages) {
    if (pkg.got) continue;
    pkg.mesh.rotation.y += dt * 2.2;
    pkg.mesh.position.y = 0.3 + Math.sin(time * 3 + pkg.x) * 0.15;
    if (dist2(pkg.x, pkg.z, player.x, player.z) < 3.4 * 3.4) {
      pkg.got = true;
      pkg.mesh.visible = false;
      stats.packagesFound++;
      player.money += 500;
      for (const w of WEAPONS) {
        if (w.ammo !== Infinity) w.ammo = Math.min(w.maxAmmo, w.ammo + Math.round(w.maxAmmo * 0.45));
      }
      updateWeaponVisuals();
      spawnParticles(pkg.x, 1.2, pkg.z, 0xd946ef, 15);
      addFloater('+$500 & MUNIZIONI!', pkg.x, 2.6, pkg.z, '#d946ef');
      sfx('coin');
      if (stats.packagesFound >= 10) {
        player.money += 10000;
        player.hp = player.maxhp = 150;
        for (const w of WEAPONS) {
          if (w.ammo !== Infinity) w.ammo = w.maxAmmo;
        }
        updateWeaponVisuals();
        showToast('🎉 TUTTI I 10 PACCHETTI TROVATI! +$10.000 & ARMI AL MASSIMO!', 6);
      } else {
        showToast(`🏆 PACCHETTO SEGRETO ${stats.packagesFound}/10! (+$500 & Munizioni)`, 3.5);
      }
    }
  }
}

/* =========================================================================
   PEDONI AI
   ========================================================================= */
/* Distanza dall'ASFALTO, per un pedone.
   onRoad  : true se il punto e' su una carreggiata
   kerbDist: 0 = centro dell'asfalto, >0 = verso il bordo, -N = N metri
             sul marciapiede (fuori dall'asfalto)
   La griglia ha strade a ogni multiplo di BLOCK, larghezza ROADW. */
const PED_KERB_LIM = BLOCK / 2 - ROADW / 2;
function pedRoadInfo(x, z) {
  const fx = Math.abs(((x + BLOCK / 2) % BLOCK) - BLOCK / 2);
  const fz = Math.abs(((z + BLOCK / 2) % BLOCK) - BLOCK / 2);
  // distanza con segno rispetto al bordo di ciascuna carreggiata
  const dx = fx - PED_KERB_LIM;   // >0 = oltre il bordo (marciapiede)
  const dz = fz - PED_KERB_LIM;
  // siamo su strada se almeno una delle due coordinate e' dentro l'asfalto
  const onRoad = (dx <= 0) || (dz <= 0);
  // distanza all'asfalto piu' vicino, con segno
  const kerbDist = Math.min(dx, dz);
  return { onRoad, kerbDist, fx, fz };
}

/* Un veicolo si avvicina? (per decidere se attraversare) */
function trafficComing(px, pz, maxD) {
  for (const c of cars) {
    if (c.burning) continue;
    if (dist2(c.x, c.z, px, pz) > maxD * maxD) continue;
    // sta davvero venendo verso il punto di attraversamento?
    const dx = px - c.x, dz = pz - c.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.001) return true;
    if ((dx / d) * Math.sin(c.a) + (dz / d) * Math.cos(c.a) > 0.25 && Math.abs(c.speed) > 1.5) return true;
  }
  return false;
}

function updatePed(p, dt) {
  if (p.down > 0) {
    p.down += dt;
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.vx *= Math.pow(0.06, dt); p.vz *= Math.pow(0.06, dt);
    p.walk += dt * 0.5;
    return;
  }
  const d = dist(p.x, p.z, player.x, player.z);
  const carNear = player.car ? dist(p.x, p.z, player.car.x, player.car.z) : 1e9;
  if (d < 18 || carNear < 8) p.panic = 2.2;

  const ni = Math.floor((p.x + 1) / BLOCK), nj = Math.floor((p.z + 1) / BLOCK);
  if (ni !== p.ni || nj !== p.nj) {
    p.ni = ni; p.nj = nj;
    if (dist(p.x, p.z, ni * BLOCK, nj * BLOCK) < 18) p.turn = pickTurn(p.a);
  }
  if (p.turn !== null) {
    p.a = angApproach(p.a, p.turn, dt * 3.4);
    if (Math.abs(angDiff(p.a, p.turn)) < 0.06) { p.a = p.turn; p.turn = null; }
  }

  /* Pedone: comportamento semplice e robusto.
   - cammina sul marciapiede lungo la direzione di marcia
   - rallenta se un'auto si avvicina troppo (look before you leap)
   Niente macchina a stati per l'attraversamento: la logica era fragile. */
  const info = pedRoadInfo(p.x, p.z);
  const autoVicina = trafficComing(p.x + Math.sin(p.a) * 6, p.z + Math.cos(p.a) * 6, 10);
  if (autoVicina && p.panic <= 0) p.speed = Math.min(p.speed, 1.2);

  if (p.panic > 0) {
    const away = Math.atan2(p.z - player.z, p.x - player.x);
    p.a = angApproach(p.a, away, dt * 3);
    p.speed = approach(p.speed, 8.5, 30 * dt);
    p.panic -= dt;
  } else if (p.idle > 0) {
    p.idle -= dt;
    p.speed = approach(p.speed, 0, 20 * dt);
  } else {
    if (Math.random() < 0.002) p.idle = rand(1, 4);
    p.speed = approach(p.speed, p.crossing ? 5.2 : 4.2, 14 * dt);
  }
  p.x += Math.sin(p.a) * p.speed * dt;
  p.z += Math.cos(p.a) * p.speed * dt;
  const before = p.x + p.z;
  pushOut(p, 0.55);
  if (Math.abs(p.x + p.z - before) > 0.01) p.a = -p.a;
  p.x = clamp(p.x, 4, WORLD - 4); p.z = clamp(p.z, 4, WORLD - 4);
  p.walk += p.speed * dt * 2.4;
}

/* =========================================================================
   PROIETTILI & COMBATTIMENTO
   ========================================================================= */
/* =========================================================================
   PROIETTILI & COMBATTIMENTO MULTI-ARMA
   ========================================================================= */
const bulletGeo = new THREE.BoxGeometry(0.08, 0.08, 1.4);

function spawnBullet(originX, originY, originZ, ang, dmg, life, speed) {
  const bMesh = new THREE.Mesh(bulletGeo, M.gold);
  bMesh.position.set(originX, originY, originZ);
  bMesh.rotation.y = ang;
  bulletGroup.add(bMesh);

  bullets.push({
    x: originX,
    z: originZ,
    a: ang,
    life: life || 1.4,
    dmg: dmg || 35,
    speed: speed || 120,
    isPlayer: true,
    mesh: bMesh
  });
}

/* Sistema Missili RPG Esplosivi */
const rockets = [];
const rocketGroup = new THREE.Group();
scene.add(rocketGroup);

const rocketGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 8);
rocketGeo.rotateX(Math.PI / 2);
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x4a5830, roughness: 0.5, metalness: 0.3 });

function fireRocket(x, y, z, ang, pitch) {
  const mesh = new THREE.Mesh(rocketGeo, rocketMat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ang;
  const p = pitch || 0;
  mesh.rotation.x = -p;
  rocketGroup.add(mesh);
  const speed = 55;
  const vy = Math.sin(p) * speed;
  rockets.push({ x, y, z, a: ang, vy, pitch: p, life: 2.5, mesh });
}

/* Onda d'urto: anello che si espande sull'asfalto. Da' il "peso" visivo
   che le sole particelle non rendono. */
const shockwaves = [];
let shockGeo = null, shockMatBase = null;
function initShockwave() {
  if (shockGeo) return;
  shockGeo = new THREE.RingGeometry(0.6, 1, 40);
  shockGeo.rotateX(-Math.PI / 2);
  shockMatBase = new THREE.MeshBasicMaterial({
    color: 0xffd8a0, transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
  });
}
function spawnShockwave(x, z, maxR) {
  initShockwave();
  const m = new THREE.Mesh(shockGeo, shockMatBase.clone());
  m.position.set(x, 0.16, z);
  m.scale.setScalar(0.4);
  m.renderOrder = 3;
  fxGroup.add(m);
  shockwaves.push({ mesh: m, life: 0.55, max: 0.55, maxR: maxR || 12 });
}
function updateShockwaves(dt) {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.life -= dt;
    const t = 1 - s.life / s.max;                 // 0 -> 1
    const r = s.maxR * (0.25 + 0.75 * Math.pow(t, 0.6));
    s.mesh.scale.setScalar(r);
    s.mesh.material.opacity = 0.85 * (1 - t) * (1 - t);
    if (s.life <= 0) {
      fxGroup.remove(s.mesh);
      s.mesh.material.dispose();
      shockwaves.splice(i, 1);
    }
  }
}

function createExplosion(x, y, z) {
  sfx('rpg_explode');
  camShake = Math.min(1.0, camShake + 0.85);
  spawnShockwave(x, z, 13);

  // 40 particelle di fuoco e fumo
  for (let k = 0; k < 38; k++) {
    const col = pick([0xff2200, 0xff6600, 0xffcc00, 0x444444, 0x222222]);
    spawnParticles(x + rand(-0.5, 0.5), y + rand(0, 1.5), z + rand(-0.5, 0.5), col, 2);
  }

  // Danni ad area (raggio 12 metri)
  const RADIUS = 12;
  // Danni veicoli
  for (const c of cars) {
    const d = dist(x, z, c.x, c.z);
    if (d < RADIUS) {
      const mult = (1 - d / RADIUS);
      if (c === player.car) {
        if (d < RADIUS * 0.5) damageCar(c, 90 * mult);
        continue;
      }
      damageCar(c, 240 * mult);
      // Spinta esplosiva
      const pushAng = Math.atan2(c.x - x, c.z - z);
      c.vx += Math.sin(pushAng) * 28 * mult;
      c.vz += Math.cos(pushAng) * 28 * mult;
      c.speed += 15 * mult;
      if (c.isCop) addWanted(0.5, true);
    }
  }
  // Danni pedoni
  for (const p of peds) {
    if (p.down > 0) continue;
    const d = dist(x, z, p.x, p.z);
    if (d < RADIUS) {
      const mult = (1 - d / RADIUS);
      p.down = 1;
      const pushAng = Math.atan2(p.x - x, p.z - z);
      p.vx = Math.sin(pushAng) * 18 * mult;
      p.vz = Math.cos(pushAng) * 18 * mult;
      spawnParticles(p.x, 1.2, p.z, 0xb03030, 8);
      addWanted(0.3, true);
      player.money += 25;
      addFloater('+$25', p.x, 2.4, p.z, '#7dff9b');
    }
  }
  // Se il giocatore stesso e' troppo vicino a piedi
  const pDist = dist(x, z, player.x, player.z);
  if (pDist < RADIUS * 0.7 && !player.car) {
    player.hp = Math.max(0, player.hp - (1 - pDist / (RADIUS * 0.7)) * 60);
  }
}

function updateRockets(dt) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    const speed = 55;
    r.x += Math.sin(r.a) * speed * dt;
    r.z += Math.cos(r.a) * speed * dt;
    r.y += (r.vy || 0) * dt;
    r.life -= dt;
    r.mesh.position.set(r.x, r.y, r.z);

    // Scia di fumo particellare dietro il missile
    spawnParticles(r.x - Math.sin(r.a) * 0.4, r.y, r.z - Math.cos(r.a) * 0.4, 0xdddddd, 1);

    let explode = false;
    // Impatto suolo o palazzi
    if (r.y <= 0.25) explode = true;
    if (!explode && inBuilding(r.x, r.z, 0.6)) explode = true;

    // Impatto veicoli
    if (!explode) {
      for (const c of cars) {
        if (c === player.car) continue;
        if (dist2(r.x, r.z, c.x, c.z) < 2.5 * 2.5) { explode = true; break; }
      }
    }

    // Impatto pedoni
    if (!explode) {
      for (const p of peds) {
        if (p.down > 0) continue;
        if (dist2(r.x, r.z, p.x, p.z) < 1.6 * 1.6) { explode = true; break; }
      }
    }

    if (explode || r.life <= 0 || r.x < 0 || r.z < 0 || r.x > WORLD || r.z > WORLD) {
      createExplosion(r.x, Math.max(0.3, r.y), r.z);
      rocketGroup.remove(r.mesh);
      rockets.splice(i, 1);
    }
  }
}

/* Ricarica il caricatore dalle munizioni di riserva. */
function tryReload() {
  if (state !== 'play') return;
  const w = WEAPONS[currentWeaponIdx];
  if (w.ammo === Infinity) { showToast('Munizioni illimitate', 1.4); return; }
  if (player.reloading > 0) return;              // gia' in corso
  if (player.ammo >= w.ammo) return;             // caricatore pieno
  if (player.reserve <= 0) { showToast('Niente munizioni di riserva', 1.8); return; }
  player.reloading = w.id === 'rpg' ? 2.2 : (w.id === 'shotgun' ? 1.8 : 1.3);
  sfx('reload');
  showToast('Ricarica...', 0.9);
}

function shootPlayer() {
  if (state !== 'play' || player.hp <= 0) return;
  if (player.shootCd > 0) return;
  if (player.reloading > 0) return;              // non si spara durante la ricarica
  const w = WEAPONS[currentWeaponIdx];

  // Pugni (Melee)
  if (w.id === 'fist') {
    player.shootCd = w.rate;
    sfx('punch');
    if (!player.car) {
      hero.armR.rotation.x = Math.PI / 2 + 0.6;
    }
    // Check ped colpito davanti
    let hitAny = false;
    for (const p of peds) {
      if (p.down > 0) continue;
      const d = dist(player.x, player.z, p.x, p.z);
      if (d < 2.8) {
        const pedAng = Math.atan2(p.x - player.x, p.z - player.z);
        if (Math.cos(angDiff(player.a, pedAng)) > 0.4) {
          p.down = 1;
          p.vx = Math.sin(player.a) * 7.5;
          p.vz = Math.cos(player.a) * 7.5;
          spawnParticles(p.x, 1.2, p.z, 0xb03030, 6);
          sfx('hit');
          addWanted(0.15, true);
          player.money += 15;
          addFloater('+$15', p.x, 2.2, p.z, '#7dff9b');
          hitAny = true;
          break;
        }
      }
    }
    // Check auto colpita
    if (!hitAny) {
      for (const c of cars) {
        if (c === player.car) continue;
        const d = dist(player.x, player.z, c.x, c.z);
        if (d < 3.2) {
          damageCar(c, 8);
          spawnParticles(player.x + Math.sin(player.a) * 1.5, 0.8, player.z + Math.cos(player.a) * 1.5, 0xffbb44, 4);
          sfx('hit');
          break;
        }
      }
    }
    return;
  }

  /* Controllo munizioni: si consuma il CARICATORE (player.ammo), non
     l'arma. Prima il codice faceva w.ammo-- e consumava la definizione
     dell'arma, cosi' il giocatore aveva munizioni infinite e l'arma
     si degradava nel tempo. */
  if (w.ammo !== Infinity) {
    if (player.ammo <= 0) {
      if (player.reserve > 0 && player.reloading <= 0) {
        tryReload();
      } else {
        showToast(player.reserve > 0 ? 'Caricatore vuoto: ricarica (R)' : 'Munizioni esaurite!', 1.4);
        sfx('hit');
        player.shootCd = 0.35;
      }
      return;
    }
    player.ammo--;
  }

  player.shootCd = w.rate;
  updateWeaponVisuals();

  // Calcola origine e direzione dello sparo
  const baseAng = player.car ? (player.car.a + rand(-0.05, 0.05)) : camYaw;
  const originX = player.car ? player.car.x + Math.sin(baseAng) * 2.2 : player.x + Math.sin(baseAng) * 0.9;
  const originZ = player.car ? player.car.z + Math.cos(baseAng) * 2.2 : player.z + Math.cos(baseAng) * 0.9;
  const originY = player.car ? 1.2 : 1.4;

  // Animazione rinculo braccio
  if (!player.car) {
    hero.armR.rotation.x = Math.PI / 2 + 0.3;
    player.a = camYaw;
  }

  // Flash sul mirino
  const ch = document.getElementById('crosshair');
  if (ch) {
    ch.classList.add('hit');
    setTimeout(() => ch.classList.remove('hit'), 110);
  }

  // 1. RPG: spara missile con inclinazione 3D verso il mirino
  if (w.id === 'rpg') {
    sfx('rpg_launch');
    camShake = Math.min(0.6, camShake + 0.28);
    spawnParticles(originX, originY, originZ, 0xaaaaaa, 6);
    const pitch = player.car ? 0 : clamp(-camPitch + 0.20, -0.5, 0.5);
    fireRocket(originX, originY, originZ, baseAng, pitch);
    return;
  }

  // 2. Shotgun: rosa di 6 pallettoni
  if (w.id === 'shotgun') {
    sfx('shotgun');
    camShake = Math.min(0.7, camShake + 0.32);
    spawnParticles(originX, originY, originZ, 0xffaa22, 10);
    spawnParticles(originX, originY, originZ, 0xdddddd, 6);
    for (let k = 0; k < w.pellets; k++) {
      const spread = rand(-w.spread, w.spread);
      spawnBullet(originX, originY, originZ, baseAng + spread, w.dmg, 0.75, 115);
    }
    return;
  }

  // 3. Pistola o UZI
  sfx('gun');
  camShake = Math.min(0.4, camShake + (w.id === 'uzi' ? 0.08 : 0.14));
  spawnParticles(originX, originY, originZ, 0xffe066, 4);
  const ang = baseAng + (w.spread ? rand(-w.spread, w.spread) : 0);
  spawnBullet(originX, originY, originZ, ang, w.dmg, 1.4, w.speed || 120);
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    const speed = b.speed || (b.isPlayer ? 120 : 95);
    b.x += Math.sin(b.a) * speed * dt;
    b.z += Math.cos(b.a) * speed * dt;
    b.life -= dt;

    if (!b.mesh) {
      b.mesh = new THREE.Mesh(bulletGeo, b.isPlayer ? M.gold : M.headlight);
      bulletGroup.add(b.mesh);
    }
    b.mesh.position.set(b.x, 1.25, b.z);
    b.mesh.rotation.y = b.a;

    let dead = false;

    if (!b.isPlayer) {
      // Proiettile nemico / polizia verso giocatore
      if (!player.car && dist2(b.x, b.z, player.x, player.z) < 1.6 * 1.6) {
        player.hp = Math.max(0, player.hp - b.dmg);
        spawnParticles(b.x, 1.2, b.z, 0xffdd66, 5);
        camShake = Math.min(0.7, camShake + 0.2);
        dead = true;
        sfx('hit');
      }
    } else {
      // Proiettile del giocatore contro pedoni e veicoli
      // 1. Pedoni
      for (const p of peds) {
        if (p.down > 0) continue;
        if (dist2(b.x, b.z, p.x, p.z) < 1.6 * 1.6) {
          p.down = 1;
          p.vx = Math.sin(b.a) * 9;
          p.vz = Math.cos(b.a) * 9;
          spawnParticles(p.x, 1.1, p.z, 0xb03030, 10);
          addWanted(0.25, true);
          player.money += 20;
          addFloater('+$20', p.x, 2.2, p.z, '#7dff9b');
          sfx('hit');
          dead = true;
          break;
        }
      }
      // 2. Veicoli
      if (!dead) {
        for (const c of cars) {
          if (c === player.car) continue;
          const hitR = (c.isMoto || c.isChopper) ? 1.5 : (c.isVan || c.isAmbulance) ? 3.0 : 2.8;
          if (dist2(b.x, b.z, c.x, c.z) < hitR * hitR) {
            damageCar(c, b.dmg || 24);
            spawnParticles(b.x, 1.2, b.z, 0xffaa33, 6);
            if (c.isCop) addWanted(0.3, true);
            sfx('crash');
            dead = true;
            break;
          }
        }
      }
    }

    // 3. Impatto contro palazzi / muri
    if (!dead && inBuilding(b.x, b.z, 0.6)) {
      spawnParticles(b.x, 1.2, b.z, 0x999999, 3);
      dead = true;
    }

    if (dead || b.life <= 0 || b.x < 0 || b.z < 0 || b.x > WORLD || b.z > WORLD) {
      if (b.mesh) {
        bulletGroup.remove(b.mesh);
        b.mesh = null;
      }
      bullets.splice(i, 1);
    }
  }
}

/* =========================================================================
   INPUT
   ========================================================================= */
const keys = {};
const pressed = {};
const KM = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'brake', ShiftLeft: 'boost', ShiftRight: 'boost',
  KeyJ: 'shoot', ControlLeft: 'shoot', ControlRight: 'shoot',
  // salto: solo a piedi (in auto lo Spazio e' il freno a mano).
  // V e non Q: Q e' gia' della radio (tasti 1-5/ESC occupati).
  KeyV: 'jump', AltLeft: 'jump', AltRight: 'jump'
};

addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!e.repeat) {
    // Escape col negozio aperto chiude SOLO il negozio: senza questo return,
    // lo stesso tasto chiudeva il negozio e metteva in pausa.
    if (e.code === 'Escape' && shopOpen) { closeShop(); e.preventDefault(); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    // F: entra o esce dal veicolo
    if (e.code === 'KeyF') {
      if (player.car) exitCar();
      else {
        const c = nearestEnterableCar();
        if (c) enterCar(c);
        else showToast('Avvicinati a un veicolo per salirci', 1.6);
      }
    }
    // R: ricarica. Se non parte (gia' pieno, o senza riserva) mostra lo stato,
    // altrimenti tryReload ha gia' mostrato il proprio avviso.
    if (e.code === 'KeyR' && state === 'play') {
      tryReload();
      const w = WEAPONS[currentWeaponIdx];
      if (player.reloading <= 0 && w.ammo !== Infinity) {
        showToast(`${w.name}: caricatore ${player.ammo}/${w.ammo}, riserva ${player.reserve}`, 1.6);
      }
    }
    // Tasto E: apri il negozio dell'armory quando sei vicino
    if (e.code === 'KeyE' && !shopOpen) {
      let near = false;
      for (const s of shopSpots) if (dist(player.x, player.z, s.x, s.z) < 6) near = true;
      if (near) { openShop(); e.preventDefault(); }
    }
    // Tasti 1-5 per selezione armi (Pugni, Pistola, UZI, Pompa, RPG)
    if (e.code === 'Digit1' || e.code === 'Numpad1') selectWeapon(0);
    if (e.code === 'Digit2' || e.code === 'Numpad2') selectWeapon(1);
    if (e.code === 'Digit3' || e.code === 'Numpad3') selectWeapon(2);
    if (e.code === 'Digit4' || e.code === 'Numpad4') selectWeapon(3);
    if (e.code === 'Digit5' || e.code === 'Numpad5') selectWeapon(4);

    // Spara con tasto J, Ctrl o Spazio (a piedi)
    if (e.code === 'KeyJ' || e.code === 'ControlLeft' || e.code === 'ControlRight' || (e.code === 'Space' && !player.car)) {
      shootPlayer();
    }
    // Radio 80s: Q / E.  E non cambia stazione se ha appena aperto il negozio:
    // altrimenti ogni tocco su E skipperebbe la radio mentre cerchi l'Armory.
    if (e.code === 'KeyQ') audio.prevStation();
    if (e.code === 'KeyE' && !shopOpen) audio.nextStation();
    // Clacson / Sirena
    if (e.code === 'KeyH') {
      sfx('horn');
      if (player.car && player.car.isAmbulance) {
        showToast('🚑 Sirena d\'emergenza attivata!', 1.5);
      }
    }
    if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
    if (e.code === 'KeyT') setTimePhase(timePhase + 1);   // giorno -> sera -> notte
    if (e.code === 'KeyS' && (e.ctrlKey || e.metaKey)) { saveGame(); e.preventDefault(); }
    if (e.code === 'F5' && !e.shiftKey) { saveGame(); e.preventDefault(); }
    if (e.code === 'KeyM') audio.toggle();
    // Schermata WASTED: R (riavvia) torna al gioco, Spazio/Invio respawnano
    if (state === 'wasted' && (e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter')) {
      respawn();
      return;
    }
    if (e.code === 'F3') {
      isDev = !isDev;
      document.getElementById('fpsbox').style.display = isDev ? 'block' : 'none';
    }
    if (e.code === 'Enter' && state === 'menu') start();
  }
  const k = KM[e.code];
  if (k) { keys[k] = true; pressed[k] = true; }
});

addEventListener('keyup', e => { const k = KM[e.code]; if (k) keys[k] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; isLeftMouseDown = false; isRightMouseDown = false; });
function clearPressed() { for (const k in pressed) pressed[k] = false; }

/* Selezione arma con rotellina del mouse */
addEventListener('wheel', e => {
  if (state !== 'play') return;
  if (e.deltaY > 0) {
    selectWeapon((currentWeaponIdx + 1) % WEAPONS.length);
  } else if (e.deltaY < 0) {
    selectWeapon((currentWeaponIdx - 1 + WEAPONS.length) % WEAPONS.length);
  }
});

/* Click su box armi o slot numerati sull'HUD */
document.getElementById('weaponbox')?.addEventListener('click', e => {
  const targetDot = e.target.closest('.wdot');
  if (targetDot) {
    const idx = parseInt(targetDot.dataset.w, 10);
    if (!isNaN(idx)) selectWeapon(idx);
  } else {
    selectWeapon((currentWeaponIdx + 1) % WEAPONS.length);
  }
});

/* Controlli Mouse: Mira, Spara e Ruota Visuale */
addEventListener('mousedown', e => {
  if (state !== 'play') return;
  // Ignora se l'utente sta cliccando su controlli dell'interfaccia (radio, armi, bottoni)
  if (e.target && e.target.closest('button, .panelbox, .overlay, .rctrlbtn, #weaponbox, #radiobox')) return;
  if (e.button === 0) {
    isLeftMouseDown = true;
    shootPlayer();
  } else if (e.button === 2) {
    isRightMouseDown = true;
  }
});

addEventListener('mouseup', e => {
  if (e.button === 0) isLeftMouseDown = false;
  if (e.button === 2) isRightMouseDown = false;
});

addEventListener('contextmenu', e => e.preventDefault());

addEventListener('mousemove', e => {
  if (state !== 'play') return;
  if (isRightMouseDown || isLeftMouseDown || document.pointerLockElement) {
    camYaw -= (e.movementX || 0) * 0.0038;
    camPitch = clamp(camPitch + (e.movementY || 0) * 0.003, 0.04, 0.85);
  }
});

/* =========================================================================
   AUDIO & RADIO 80s SYNTHWAVE
   ========================================================================= */
const STATIONS = [
  {
    name: 'FLASH FM', genre: '80s Synthpop Dance', bpm: 122,
    bass: [110, 110, 130.8, 110, 87.3, 87.3, 110, 87.3, 130.8, 130.8, 164.8, 130.8, 98, 98, 123.5, 98],
    leads: [440, 523.2, 659.2, 523.2, 349.2, 440, 523.2, 440, 523.2, 659.2, 784, 659.2, 392, 493.9, 587.3, 493.9]
  },
  {
    name: 'WAVE 103', genre: 'Dark Wave & Post-Punk', bpm: 130,
    bass: [73.4, 73.4, 87.3, 73.4, 58.3, 58.3, 73.4, 58.3, 87.3, 87.3, 110, 87.3, 65.4, 65.4, 82.4, 65.4],
    leads: [293.7, 349.2, 440, 349.2, 233.1, 293.7, 349.2, 293.7, 349.2, 440, 523.2, 440, 261.6, 329.6, 392, 329.6]
  },
  {
    name: 'V-ROCK', genre: '80s Glam Heavy Metal', bpm: 142,
    bass: [82.4, 82.4, 123.5, 82.4, 65.4, 65.4, 98, 65.4, 73.4, 73.4, 110, 73.4, 61.7, 61.7, 92.5, 61.7],
    leads: [329.6, 392, 493.9, 587.3, 261.6, 329.6, 392, 523.2, 293.7, 370, 440, 587.3, 246.9, 293.7, 370, 493.9]
  },
  {
    name: 'RADIO SPENTA', genre: 'Silenzio / Suoni Città', bpm: 0
  }
];

const audio = {
  ctx: null, on: true, eng: null, engGain: null, sir: null, sirGain: null,
  radioGain: null, stationIndex: 0, nextStepTime: 0, curStep: 0,
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      if (c.state === 'suspended') c.resume();

      // Motore auto
      this.eng = c.createOscillator(); this.eng.type = 'sawtooth';
      this.engGain = c.createGain(); this.engGain.gain.value = 0;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
      this.eng.connect(f); f.connect(this.engGain); this.engGain.connect(c.destination);
      this.eng.start();

      // Sirena polizia
      this.sir = c.createOscillator(); this.sir.type = 'triangle';
      this.sirGain = c.createGain(); this.sirGain.gain.value = 0;
      this.sir.connect(this.sirGain); this.sirGain.connect(c.destination);
      this.sir.start();

      // Master Radio Synthesizer
      this.radioGain = c.createGain();
      this.radioGain.gain.value = 0.12;
      this.radioGain.connect(c.destination);
      this.nextStepTime = c.currentTime + 0.1;
    } catch (e) { this.ctx = null; }
  },
  toggle() {
    this.on = !this.on;
    if (!this.on) {
      if (this.engGain) this.engGain.gain.value = 0;
      if (this.sirGain) this.sirGain.gain.value = 0;
      if (this.radioGain) this.radioGain.gain.value = 0;
    } else {
      if (this.radioGain) this.radioGain.gain.value = this.stationIndex === 3 ? 0 : 0.12;
    }
    showToast('Audio: ' + (this.on ? 'ON' : 'OFF'), 1.5);
  },
  nextStation() {
    this.stationIndex = (this.stationIndex + 1) % STATIONS.length;
    this.onStationChanged();
  },
  prevStation() {
    this.stationIndex = (this.stationIndex - 1 + STATIONS.length) % STATIONS.length;
    this.onStationChanged();
  },
  onStationChanged() {
    const st = STATIONS[this.stationIndex];
    if (this.radioGain && this.ctx) {
      this.radioGain.gain.setTargetAtTime(this.stationIndex === 3 || !this.on ? 0 : 0.12, this.ctx.currentTime, 0.05);
    }
    sfx('radio_tune');
    showToast('📻 ' + st.name + (st.bpm ? ' — ' + st.genre : ''), 2.5);
    const rs = document.getElementById('radiostation');
    const rt = document.getElementById('radiotrack');
    if (rs) rs.textContent = st.name;
    if (rt) rt.textContent = st.genre;
  },
  noiseBurst(dur, vol, freq, fEnd, startTime, dest) {
    if (!this.ctx || !this.on) return;
    try {
      const c = this.ctx, t = startTime !== undefined ? startTime : c.currentTime;
      const bSize = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, bSize, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bSize; i++) d[i] = Math.random() * 2 - 1;
      const s = c.createBufferSource();
      s.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(freq || 1200, t);
      if (fEnd) f.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(vol || 0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(dest || c.destination);
      s.start(t); s.stop(t + dur);
    } catch (e) {}
  },
  blip(f, dur, type, vol) {
    if (!this.ctx || !this.on) return;
    try {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(vol || .07, c.currentTime);
      g.gain.exponentialRampToValueAtTime(.0005, c.currentTime + (dur || .12));
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + (dur || .12) + .02);
    } catch (e) { }
  }
};

function sfx(kind) {
  if (state === 'pause' || !audio.ctx || !audio.on) return;
  const c = audio.ctx;
  if (c.state === 'suspended') c.resume();
  const t = c.currentTime;
  switch (kind) {
    case 'coin':
      audio.blip(880, .09, 'triangle', .08);
      setTimeout(() => audio.blip(1320, .1, 'triangle', .06), 70);
      break;
    case 'accept':
      audio.blip(523, .12, 'square', .06);
      setTimeout(() => audio.blip(784, .16, 'square', .06), 110);
      break;
    case 'hit':
      audio.blip(160, .1, 'sawtooth', .08);
      break;
    case 'crash':
      audio.blip(120, .16, 'sawtooth', .1);
      audio.blip(70, .22, 'square', .06);
      break;
    case 'boom':
      audio.blip(55, .5, 'sawtooth', .16);
      audio.noiseBurst(0.4, 0.2, 400);
      break;
    case 'gun': {
      try {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(320, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        g.gain.setValueAtTime(0.24, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + 0.14);
        audio.noiseBurst(0.12, 0.22, 1200);
      } catch (e) {}
      break;
    }
    case 'shotgun': {
      try {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(32, t + 0.22);
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + 0.25);
        audio.noiseBurst(0.24, 0.35, 750, 120);
      } catch (e) {}
      break;
    }
    case 'rpg_launch': {
      try {
        audio.noiseBurst(0.35, 0.28, 450, 1300);
        audio.blip(130, 0.28, 'sawtooth', 0.12);
      } catch (e) {}
      break;
    }
    case 'rpg_explode': {
      try {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(95, t);
        o.frequency.exponentialRampToValueAtTime(18, t + 0.65);
        g.gain.setValueAtTime(0.48, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + 0.75);
        audio.noiseBurst(0.7, 0.45, 320, 40);
      } catch (e) {}
      break;
    }
    case 'punch': {
      audio.blip(95, 0.1, 'sawtooth', 0.16);
      audio.noiseBurst(0.09, 0.2, 550, 110);
      break;
    }
    case 'weapon_switch': {
      audio.blip(620, 0.04, 'square', 0.08);
      setTimeout(() => audio.blip(880, 0.05, 'square', 0.06), 45);
      break;
    }
    case 'radio_tune':
      audio.noiseBurst(0.2, 0.1, 2200, 400);
      break;
    case 'horn':
      audio.blip(440, .25, 'sawtooth', .09);
      audio.blip(554, .25, 'sawtooth', .09);
      break;
  }
}

function updateAudio() {
  if (!audio.ctx || !audio.on) return;
  try {
    const c = player.car;
    const target = c && state === 'play' ? (c.isSuper ? .045 : c.isMoto ? .04 : .03) + Math.min(.02, Math.abs(c.speed) / 1400) : 0;
    audio.engGain.gain.value = lerp(audio.engGain.gain.value, target, .1);
    const baseFreq = c ? (c.isMoto ? 65 : c.isSuper ? 50 : 40) : 40;
    audio.eng.frequency.value = baseFreq + (c ? Math.abs(c.speed) * (c.isMoto ? 3.5 : 2.2) : 0);

    let near = false;
    for (const o of cars) if (o.isCop && dist(o.x, o.z, player.x, player.z) < 55) { near = true; break; }
    audio.sirGain.gain.value = lerp(audio.sirGain.gain.value, near && player.heat > 0 ? .035 : 0, .08);
    audio.sir.frequency.value = (time % .8 < .4) ? 700 : 960;

    // --- Sequencer Radio Synthwave 80s ---
    const st = STATIONS[audio.stationIndex];
    if (st && st.bpm > 0 && state === 'play') {
      const stepDur = (60 / st.bpm) / 4;
      const actx = audio.ctx;
      if (audio.nextStepTime < actx.currentTime) audio.nextStepTime = actx.currentTime;
      while (audio.nextStepTime < actx.currentTime + 0.15) {
        const t = Math.max(audio.nextStepTime, actx.currentTime);
        const s = audio.curStep % 16;

        // Cassa drum 80s su 0, 4, 8, 12
        if (s % 4 === 0) {
          const ko = actx.createOscillator(), kg = actx.createGain();
          ko.frequency.setValueAtTime(130, t);
          ko.frequency.exponentialRampToValueAtTime(38, t + 0.09);
          kg.gain.setValueAtTime(0.35, t);
          kg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
          ko.connect(kg); kg.connect(audio.radioGain);
          ko.start(t); ko.stop(t + 0.11);
        }

        // Rullante LinnDrum su 4, 12
        if (s === 4 || s === 12) {
          audio.noiseBurst(0.12, 0.18, 1600, null, t, audio.radioGain);
        }

        // Hi-hat su ogni ottavo
        if (s % 2 === 0) {
          audio.noiseBurst(0.04, 0.06, 6000, null, t, audio.radioGain);
        }

        // Synth Bass 80s
        const bFreq = st.bass[s];
        if (bFreq) {
          const bo = actx.createOscillator(), bg = actx.createGain();
          bo.type = 'sawtooth';
          bo.frequency.setValueAtTime(bFreq, t);
          const bf = actx.createBiquadFilter();
          bf.type = 'lowpass';
          bf.frequency.setValueAtTime(900, t);
          bf.frequency.exponentialRampToValueAtTime(250, t + stepDur * 0.9);
          bg.gain.setValueAtTime(0.2, t);
          bg.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.95);
          bo.connect(bf); bf.connect(bg); bg.connect(audio.radioGain);
          bo.start(t); bo.stop(t + stepDur);
        }

        // Lead / Chords Synthwave
        const lFreq = st.leads[s];
        if (lFreq && s % 2 === 0) {
          const lo = actx.createOscillator(), lg = actx.createGain();
          lo.type = 'square';
          lo.frequency.setValueAtTime(lFreq, t);
          lg.gain.setValueAtTime(0.08, t);
          lg.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 1.8);
          lo.connect(lg); lg.connect(audio.radioGain);
          lo.start(t); lo.stop(t + stepDur * 1.9);
        }

        audio.curStep++;
        audio.nextStepTime += stepDur;
      }
    }
  } catch (e) { }
}

/* =========================================================================
   HUD (DOM)
   ========================================================================= */
const $ = id => document.getElementById(id);
const el = {
  hpfill: $('hpfill'), money: $('money'), stars: $('stars'),
  carsstolen: $('carsstolen'), msnhead: $('msnhead'), msndesc: $('msndesc'), msntime: $('msntime'),
  speedo: $('speedo'), kmh: $('kmh'), dmgfill: $('dmgfill'),
  hintbox: $('hintbox'), toast: $('toast'), fpsbox: $('fpsbox'),
  wammo: $('wammo'), pkcount: $('pkcount'),
  radiostation: $('radiostation'), radiotrack: $('radiotrack')
};

// Listener bottoni radio su HUD
$('radioPrev')?.addEventListener('click', () => audio.prevStation());
$('radioNext')?.addEventListener('click', () => audio.nextStation());

let hintT = 0, toastT = 0;
function showToast(txt, dur) {
  el.toast.textContent = txt; toastT = dur || 2.6;
  el.toast.style.opacity = '1';
}

/* =========================================================================
   SALVATAGGIO
   Senza questo, chiudere il browser significa perdere soldi, armi e
   missioni. Salva in localStorage in modo automatico e manuale.
   ========================================================================= */
const SAVE_KEY = 'vicecity3d_save_v1';
const SAVE_VERSION = 1;

function serializeGame() {
  return {
    v: SAVE_VERSION,
    t: Date.now(),
    player: {
      x: player.x, z: player.z, a: player.a,
      hp: player.hp, money: player.money,
      ammo: player.ammo, weapon: player.weapon, reserve: player.reserve
    },
    stats: {
      cars: stats.cars, best: stats.best, packagesFound: stats.packagesFound,
      missions: stats.missions || 0
    },
    // stato della missione in corso (per riprenderla)
    mission: mission ? {
      type: mission.type, reward: mission.reward, desc: mission.desc,
      t: mission.t, i: mission.i,
      tx: mission.tx, tz: mission.tz,
      pts: mission.pts ? mission.pts.map(p => ({ x: p.x, z: p.z, got: !!p.got })) : null
    } : null,
    offer: offer ? { type: offer.type, x: offer.x, z: offer.z } : null,
    weaponIdx: currentWeaponIdx,
    ownedWeapons: [...ownedWeapons],
    timePhase: timePhase
  };
}

function saveGame(silent) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serializeGame()));
    if (!silent) showToast('Partita salvata', 1.8);
    return true;
  } catch (e) {
    if (!silent) showToast('Salvataggio non riuscito', 2);
    return false;
  }
}

function hasSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    return !!(d && d.v === SAVE_VERSION && d.player);
  } catch (e) { return false; }
}

function deleteSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
}

function loadGame() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
  if (!d || d.v !== SAVE_VERSION || !d.player) return false;
  try {
    // posizione e stato del giocatore
    player.x = d.player.x; player.z = d.player.z; player.a = d.player.a;
    player.hp = d.player.hp != null ? d.player.hp : player.maxhp;
    player.money = d.player.money != null ? d.player.money : 300;
    player.ammo = d.player.ammo != null ? d.player.ammo : 120;
    player.reserve = d.player.reserve != null ? d.player.reserve : 240;
    player.reloading = 0;
    if (d.player.weapon) player.weapon = d.player.weapon;
    // statistiche
    stats.cars = d.stats && d.stats.cars || 0;
    stats.best = d.stats && d.stats.best || 0;
    stats.packagesFound = d.stats && d.stats.packagesFound || 0;
    stats.missions = d.stats && d.stats.missions || 0;
    // arma equipaggiata
    if (d.weaponIdx != null && WEAPONS[d.weaponIdx]) {
      currentWeaponIdx = d.weaponIdx;
      if (typeof updateWeaponVisuals === 'function') updateWeaponVisuals();
    }
    // armi possedute
    if (Array.isArray(d.ownedWeapons) && d.ownedWeapons.length) {
      ownedWeapons = new Set(d.ownedWeapons);
      if (!ownedWeapons.has(0)) ownedWeapons.add(0);
      if (!ownedWeapons.has(1)) ownedWeapons.add(1);
    }
    // ora del giorno
    if (d.timePhase != null && TIME_ORDER[d.timePhase]) setTimePhase(d.timePhase, true);
    // missione in corso: la riprendiamo com'era
    if (d.mission) {
      const m = d.mission;
      mission = {
        type: m.type, reward: m.reward || 300, desc: m.desc || 'Missione',
        t: m.t || 0, i: m.i || 0, tx: m.tx, tz: m.tz,
        pts: m.pts ? m.pts.map(p => ({ x: p.x, z: p.z, got: !!p.got })) : null
      };
      // le missioni che richiedono un veicolo ripartono da capo: non
      // serializziamo il riferimento all'auto per non rompere nulla
      if (mission.type === 'steal' || mission.type === 'passeggero' || mission.type === 'taxi') mission = null;
      markerGo.visible = false; markerBlue.visible = false;
    } else if (d.offer) {
      offer = { type: d.offer.type, x: d.offer.x, z: d.offer.z };
      // ricostruisco i dati mancanti in base al tipo
      offer.reward = 400; offer.desc = 'Incarico ripreso dal salvataggio';
      if (offer.type === 'race' || offer.type === 'collect') offer.pts = [];
      if (offer.type === 'steal') { offer.carSpot = { x: offer.x + 12, z: offer.z + 12 }; offer.x += 24; offer.z += 24; }
      markerOffer.position.set(offer.x, 0, offer.z);
      markerOffer.visible = true;
    }
    return true;
  } catch (e) {
    console.warn('salvataggio illeggibile, si riparte da zero', e);
    return false;
  }
}

/* Salvataggio automatico: quando il gioco e' in pausa o si esce. */
let autoSaveT = 0;
function autoSaveTick(dt) {
  if (state !== 'play') return;
  autoSaveT += dt;
  if (autoSaveT > 20) {          // ogni 20 secondi di gioco
    autoSaveT = 0;
    saveGame(true);
  }
}
addEventListener('beforeunload', () => { if (state === 'play') saveGame(true); });
addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'play') saveGame(true);
});
function updateHUD(dt) {
  el.hpfill.style.width = (player.hp / player.maxhp * 100) + '%';
  el.hpfill.style.background = player.hp > 30 ? '#4ad06a' : '#ff4d4d';
  el.money.textContent = '$' + player.money;
  const curW = WEAPONS[currentWeaponIdx];
  if (el.wammo) el.wammo.textContent = curW.ammo === Infinity ? '∞' : curW.ammo;
  if (el.pkcount) el.pkcount.textContent = stats.packagesFound + ' / 10';

  const st = Math.floor(player.heat);
  let s = '';
  for (let i = 0; i < 5; i++) s += i < st ? '<b>★</b>' : '☆';
  if (el.stars.dataset.st !== String(st)) { el.stars.innerHTML = s; el.stars.dataset.st = st; }
  el.carsstolen.textContent = stats.cars;

  if (player.car) {
    el.speedo.style.display = '';
    el.kmh.textContent = Math.round(Math.abs(player.car.speed) * 9.5);
    const dmg = 1 - player.car.hp / player.car.maxhp;
    el.dmgfill.style.width = (dmg * 100) + '%';
    el.dmgfill.style.background = dmg > 0.7 ? '#ff4d4d' : '#ffb020';
  } else el.speedo.style.display = 'none';

  if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.style.opacity = '0'; }
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) el.hintbox.style.opacity = '0'; }

  if (mission) {
    el.msnhead.className = 'h';
    el.msnhead.textContent = 'MISSIONE IN CORSO';
    el.msndesc.textContent = mission.desc;
    el.msntime.textContent = mission.t > 0 ? '⏱ ' + Math.ceil(mission.t) + 's' : '';
  } else if (offer) {
    el.msnhead.className = 'h offer';
    el.msnhead.textContent = 'NUOVO INCARICO';
    el.msndesc.textContent = 'Vai sull\'anello dorato — ' + offer.desc;
    el.msntime.textContent = '';
  } else {
    el.msnhead.textContent = '';
    el.msndesc.textContent = '';
    el.msntime.textContent = '';
  }
}

/* ---------- minimappa ---------- */
const mm = document.getElementById('mm');
const mctx = mm.getContext('2d');
const MMS = 190, MMSC = MMS / WORLD;
function drawMinimap() {
  mctx.clearRect(0, 0, MMS, MMS);
  mctx.fillStyle = '#2f4a2e';
  mctx.fillRect(0, 0, MMS, MMS);
  // strade
  mctx.fillStyle = '#4a5058';
  for (let i = 0; i <= GRID; i++) {
    mctx.fillRect(i * BLOCK * MMSC - ROADW / 2 * MMSC, 0, ROADW * MMSC, MMS);
    mctx.fillRect(0, i * BLOCK * MMSC - ROADW / 2 * MMSC, MMS, ROADW * MMSC);
  }
  // riquadro inquadratura
  const vw = 40 * MMSC * 2.2, vh = 40 * MMSC * 2.2;
  mctx.strokeStyle = 'rgba(255,255,255,.32)';
  mctx.lineWidth = 1;
  mctx.strokeRect(player.x * MMSC - vw / 2, player.z * MMSC - vh / 2, vw, vh);

  function dot(x, z, r) {
    mctx.beginPath(); mctx.arc(x * MMSC, z * MMSC, r, 0, TAU); mctx.fill();
  }
  // obiettivi
  if (offer) { mctx.fillStyle = '#ffd34d'; dot(offer.x, offer.z, 3.2); }
  if (mission) {
    const m = mission;
    let t = null;
    if (m.type === 'goto') t = { x: m.tx, z: m.tz };
    else if (m.type === 'race') t = m.pts[m.i];
    else if (m.type === 'collect') t = m.pts[m.i];
    else if (m.type === 'steal') t = { x: m.tx, z: m.tz };
    else if (m.type === 'taxi') t = m.step === 0 ? { x: m.px, z: m.pz } : { x: m.tx, z: m.tz };
    if (t) { mctx.fillStyle = '#7dff9b'; dot(t.x, t.z, 3.5); }
  }
  // polizia
  mctx.fillStyle = '#4d8dff';
  for (const c of cars) if (c.isCop) dot(c.x, c.z, 2);
  // auto speciale
  if (mission && mission.type === 'steal' && player.car !== mission.car) {
    mctx.fillStyle = '#ffd34d'; dot(mission.car.x, mission.car.z, 2.8);
  }
  // pacchetti segreti (pallini fucsia)
  mctx.fillStyle = '#f0abfc';
  for (const pkg of packages) if (!pkg.got) dot(pkg.x, pkg.z, 1.4);
  // buste denaro
  mctx.fillStyle = 'rgba(255,211,77,.6)';
  for (const k of pickups) if (!k.got) dot(k.x, k.z, 1);

  // giocatore (orientamento corretto in base all'angolo di marcia)
  mctx.save();
  mctx.translate(player.x * MMSC, player.z * MMSC);
  const curA = player.car ? player.car.a : player.a;
  mctx.rotate(Math.PI / 2 - curA);
  mctx.fillStyle = '#7dff9b';
  mctx.beginPath();
  mctx.moveTo(6.5, 0);
  mctx.lineTo(-4, 3.8);
  mctx.lineTo(-4, -3.8);
  mctx.closePath();
  mctx.fill();
  mctx.restore();

  mctx.strokeStyle = 'rgba(255,255,255,.16)';
  mctx.strokeRect(0.5, 0.5, MMS - 1, MMS - 1);
}

/* =========================================================================
   LOOP
   ========================================================================= */
let state = 'menu';
let time = 0, spawnT = 0;
let last = performance.now(), fpsT = 0, fpsN = 0;

/* distanza dall'auto piu' vicina che si puo' rubare */
function nearestEnterableCar() {
  let best = null, bd = 7;
  for (const c of cars) {
    if (c.driver || c.burning || c.hp <= 0) continue;
    const d = dist(player.x, player.z, c.x, c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function enterCar(c) {
  if (!c) return;
  player.car = c;
  c.driver = true;
  c.speed = 0;
  player.x = c.x; player.z = c.z; player.a = c.a;
  camYaw = c.a; // allinea subito la camera dietro il veicolo
  camPos.set(c.x - Math.sin(c.a) * 12, 12, c.z - Math.cos(c.a) * 12);
  camLook.set(c.x, 2, c.z);
  stats.cars++;

  let desc = 'Auto rubata! (F per scendere)';
  if (c.isChopper) desc = '🏍️ Chopper Custom! Manubrio alto e scarichi rombanti! (F per scendere)';
  else if (c.isMoto) desc = '🏍️ Moto PCJ-600 rubata! Agile e velocissima! (F per scendere)';
  else if (c.isSuper) desc = '🏎️ Supercar Cheetah! Velocità massima! (F per scendere)';
  else if (c.isTaxi) desc = '🚕 Taxi Vice City! Cerca passeggeri o sfreccia nel traffico! (F per scendere)';
  else if (c.isVan) desc = '🚐 Furgone Gang Burrito! Blindato e potente! (F per scendere)';
  else if (c.isAmbulance) desc = '🚑 Ambulanza d\'emergenza! Premi H per sirena!';

  showToast(desc, 2.8);
  sfx('accept');
}

function updatePlayer(dt) {
  if (player.shootCd > 0) player.shootCd -= dt;

  /* --- ricarica --- */
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      const w = WEAPONS[currentWeaponIdx];
      const need = w.ammo - player.ammo;
      const take = Math.min(need, player.reserve);
      player.ammo += take;
      player.reserve -= take;
      if (typeof updateWeaponVisuals === 'function') updateWeaponVisuals();
    }
  }

  /* --- gravita' e salto (a piedi) ---
     Accelerazione 24 m/s^2 invece dei 9.81 della Terra: e' un gioco, e con
     la gravita' realistica il salto sembra lentissimo. */
  if (!player.car) {
    const GRAV = 24, JUMP_V = 8.2;
    if (player.y > 0 || player.vy > 0) {
      player.vy -= GRAV * dt;
      player.y += player.vy * dt;
      if (player.y <= 0) {
        // atterraggio: assorbimento elastico e piccolo scossone
        const impact = Math.abs(player.vy);
        player.y = 0;
        player.vy = 0;
        player.onGround = true;
        if (impact > 9) {
          const dmg = (impact - 9) * 2.2;
          player.hp = Math.max(0, player.hp - dmg);
          camShake = Math.min(1, camShake + impact * 0.045);
          sfx('crash');
          if (player.hp <= 0) { /* gestito dal loop */ }
        } else if (impact > 2) {
          camShake = Math.min(0.4, camShake + impact * 0.012);
        }
      }
    } else {
      player.onGround = true;
    }
    /* Spinta del salto. Il flag va consumato QUI e non solo in frame():
       clearPressed() sta nel loop di rendering, quindi se update() gira
       senza frame() (test, pausa parziale) pressed.jump resterebbe true e
       il personaggio rimbalzerebbe da solo all'infinito. */
    if (pressed.jump) {
      pressed.jump = false;
      if (player.onGround && player.y <= 0) {
        player.vy = JUMP_V;
        player.onGround = false;
        sfx('punch');
      }
    }
  } else {
    // in auto la quota segue il veicolo
    player.y = 0; player.vy = 0; player.onGround = true;
  }

  if (player.car) {
    const c = player.car;
    driveCar(c, dt);
    player.x = c.x; player.z = c.z; player.a = c.a;
    player.vx = Math.sin(c.a) * c.speed; player.vz = Math.cos(c.a) * c.speed;
    // Drive-by in auto tenendo premuto Click sinistro o Ctrl/J
    if (isLeftMouseDown || keys.shoot) {
      shootPlayer();
    }
    return;
  }

  // Sparo a piedi: con Click Sinistro, Ctrl, J o tasto Spazio
  if (isLeftMouseDown || keys.shoot || (keys.brake && !player.car)) {
    shootPlayer();
  }

  // ---------- movimento a piedi relativo alla telecamera ----------
  const fwdX = Math.sin(camYaw), fwdZ = Math.cos(camYaw);
  const rightX = Math.cos(camYaw), rightZ = -Math.sin(camYaw);

  let ax = 0, az = 0;
  if (keys.up) { ax += fwdX; az += fwdZ; }
  if (keys.down) { ax -= fwdX; az -= fwdZ; }
  if (keys.right) { ax += rightX; az += rightZ; }
  if (keys.left) { ax -= rightX; az -= rightZ; }

  const mag = Math.hypot(ax, az);
  const sprint = !!keys.boost;
  const targetSpeed = sprint ? 13 : 7.2;

  let tvx = 0, tvz = 0;
  if (mag > 0) {
    tvx = (ax / mag) * targetSpeed;
    tvz = (az / mag) * targetSpeed;
    // Tommy guarda nella direzione di marcia
    player.a = angApproach(player.a, Math.atan2(ax, az), dt * 14);
    player.walkPhase += targetSpeed * dt * 1.6;
  } else {
    player.walkPhase += dt * 0.6;
  }

  // Se sta mirando col tasto destro o sparando col sinistro, orienta Tommy verso la camera
  if (isLeftMouseDown || isRightMouseDown || player.shootCd > 0) {
    player.a = angApproach(player.a, camYaw, dt * 22);
  }

  player.vx = damp(player.vx, tvx, 12, dt);
  player.vz = damp(player.vz, tvz, 12, dt);

  player.x += player.vx * dt;
  player.z += player.vz * dt;
  if (pushOut(player, 0.7)) {
    player.vx *= 0.3; player.vz *= 0.3;
  }
  player.x = clamp(player.x, 4, WORLD - 4);
  player.z = clamp(player.z, 4, WORLD - 4);
}

function exitCar(forced) {
  const c = player.car;
  if (!c) return;
  if (!forced && Math.abs(c.speed) > 3) { showToast('Fermati per scendere', 1.5); return; }
  const side = c.a + Math.PI / 2;
  const offset = c.isMoto ? 1.6 : 3.2;
  player.x = c.x + Math.sin(side) * offset;
  player.z = c.z + Math.cos(side) * offset;
  player.a = c.a;
  if (inBuilding(player.x, player.z, 1)) { player.x = c.x; player.z = c.z; }
  c.driver = false;
  if (c.isMoto) {
    hero.torso.rotation.x = 0; hero.torso.rotation.z = 0;
    hero.armL.rotation.x = 0; hero.armR.rotation.x = 0;
    hero.legL.rotation.x = 0; hero.legR.rotation.x = 0;
  }
  player.car = null;
  camYaw = player.a;
}

function respawn() {
  player.hp = player.maxhp;
  player.heat = 0;
  player.heatCool = 0;
  player.car = null;
  player.wasted = false;
  player.money = Math.max(0, player.money - 150);

  // Ricarica un minimo di munizioni per ogni arma
  for (const w of WEAPONS) {
    if (w.ammo !== Infinity) w.ammo = Math.max(w.ammo, Math.round(w.maxAmmo * 0.35));
  }
  updateWeaponVisuals();

  // Ripristina postura Tommy
  hero.torso.rotation.x = 0; hero.torso.rotation.z = 0;
  hero.armL.rotation.x = 0; hero.armR.rotation.x = 0;
  hero.legL.rotation.x = 0; hero.legR.rotation.x = 0;

  const p = randRoadPoint(0);
  player.x = p.x; player.z = p.z;
  player.vx = 0; player.vz = 0;
  camYaw = player.a;
  camPos.set(player.x - Math.sin(camYaw) * 12, 10, player.z - Math.cos(camYaw) * 12);
  camLook.set(player.x, 2, player.z);

  for (const c of [...cars]) if (c.isCop) removeCar(c);
  state = 'play';
  document.getElementById('wasted').classList.add('hidden');
  showToast('Dimesso dall\'ospedale (-$150). Armi rifornite!', 3.5);
}

function update(dt) {
  time += dt;
  if (state === 'play') {
    updatePlayer(dt);
    for (const c of cars) {
      if (c.driver) continue;
      if (c.isCop) copDrive(c, dt); else trafficDrive(c, dt);
    }
    for (const p of peds) updatePed(p, dt);
    updateBullets(dt);
    updateRockets(dt);
    updateWanted(dt);
    updateSpawning(dt);
    updateMissions(dt);
  }
  // aggiorna le mesh
  autoSaveTick(dt);
  updateTimeBlend(dt);
  updateTrafficLights(dt);
  for (const c of cars) {
    c.mesh.g.position.set(c.x, 0, c.z);
    c.mesh.g.rotation.y = c.a;
    // stop rossi quando frena o rallenta: un dettaglio che si nota subito
    if (c.mesh.tails) {
      const braking = (c.brakingT || 0) > 0;
      for (const t of c.mesh.tails) t.material.emissiveIntensity = braking ? 4 : 1.0;
    }
    if (c.isCop) {
      const on = (time * 6) % 1 < 0.5;
      c.mesh.red.visible = on; c.mesh.blue.visible = !on;
      if (c.flash > 0) c.mesh.red.material.emissiveIntensity = 4;
    }
  }
  for (const p of peds) { /* le trasformazioni sono in syncPeds() */ }
  const isAimingOrShooting = isLeftMouseDown || isRightMouseDown || player.shootCd > 0;
  if (player.car && player.car.isMoto) {
    playerMesh.visible = true;
    playerMesh.position.set(player.car.x, player.car.isChopper ? 0.38 : 0.46, player.car.z);
    playerMesh.rotation.y = player.car.a;
    hero.torso.rotation.x = player.car.isChopper ? 0.06 : 0.35;
    hero.torso.rotation.z = player.car.mesh.g.rotation.z;
    if (player.car.isChopper) {
      hero.armL.rotation.x = 1.35; hero.armR.rotation.x = 1.35;
      hero.legL.rotation.x = 0.85; hero.legR.rotation.x = 0.85;
    } else {
      hero.armL.rotation.x = 1.0; hero.armR.rotation.x = 1.0;
      hero.legL.rotation.x = 0.65; hero.legR.rotation.x = 0.65;
    }
  } else if (!player.car) {
    playerMesh.visible = true;
    hero.torso.rotation.x = 0;
    playerMesh.position.set(player.x, player.y, player.z);
    playerMesh.rotation.y = player.a;
    const sp = Math.hypot(player.vx, player.vz);
    const amp = clamp(sp / 8, 0, 1);
    const sw = Math.sin(player.walkPhase) * amp * 0.75;
    playerLegL.rotation.x = sw;
    playerLegR.rotation.x = -sw;
    if (isAimingOrShooting) {
      hero.armR.rotation.x = Math.PI / 2 + (player.shootCd > 0.08 ? 0.25 : 0);
      hero.armL.rotation.x = Math.PI / 2 - 0.2;
    } else {
      hero.armL.rotation.x = -sw * 0.62;
      hero.armR.rotation.x = sw * 0.4 + 0.2;
    }
    playerMesh.position.y = Math.abs(Math.sin(player.walkPhase)) * amp * 0.045;
    hero.torso.rotation.z = Math.sin(player.walkPhase) * amp * 0.035;
  } else {
    playerMesh.visible = false;
  }
  // marcatori pulsanti
  const pulse = 1 + Math.sin(time * 3) * 0.08;
  for (const m of [markerOffer, markerGo, markerBlue]) {
    if (m.visible) { m.scale.set(pulse, 1, pulse); m.rotation.y += dt * 0.8; }
  }
  // onde d'urto
  updateShockwaves(dt);
  // particelle
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { fxGroup.remove(p.m); p.m.material.dispose(); particles.splice(i, 1); continue; }
    p.vy -= 22 * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    p.m.material.opacity = clamp(p.life * 2, 0, 1);
    p.m.material.transparent = true;
  }
  // floaters (HUD 2D semplice: proiettati)
  drawFloaters(dt);
  camShake = Math.max(0, camShake);
  updateCamera(dt);
  updateAudio();
}

function drawFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    f.y += dt * 2.2;
    if (f.life <= 0) floaters.splice(i, 1);
  }
}
function render() {
  if (composer) composer.render();
  else renderer.render(scene, camera);
}
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
  if (bloomPass) bloomPass.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

/* =========================================================================
   POST-PROCESSING
   Il salto di realismo piu' grande a parita' di geometria:
     - BLOOM  : le sorgenti luminose (finestre accese, fari, neon) sfavillano
     - GRADE  : color grading + vignettatura + grana + aberrazione cromatica
   ========================================================================= */
let composer = null, bloomPass = null;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.88 },
    uGrain: { value: 0.022 },
    uSat: { value: 1.22 },
    uContrast: { value: 1.10 },
    uLift: { value: new THREE.Vector3(0.012, 0.005, 0.022) },  // ombre verso il viola/blu synthwave
    uGain: { value: new THREE.Vector3(1.08, 1.02, 0.96) },     // luci calde dorate al tramonto
    uAberr: { value: 0.0018 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uSat, uContrast, uAberr;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      // aberrazione cromatica radiale, cresce verso i bordi (come un obiettivo)
      float k = uAberr * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv - d * k).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + d * k).b;

      // lift / gain: color grading in stile pellicola
      col = col * uGain + uLift;

      // contrasto attorno a 0.5 (non 0: mantiene le ombre leggibili)
      col = (col - 0.5) * uContrast + 0.5;

      // saturazione
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);

      // vignettatura
      float vig = 1.0 - uVignette * r2 * 0.85;
      col *= clamp(vig, 0.0, 1.0);

      // grana animata: rompe il banding e aggiunge "presa video"
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `
};

function buildComposer() {
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    // BLOOM: esalta fari delle auto, insegne neon e lampioni
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      0.46,   // strength
      0.65,   // radius
      0.82    // threshold
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
    composer.gradePass = grade;

    composer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(Math.min(devicePixelRatio, 2));
    return true;
  } catch (e) {
    console.warn('post-processing non disponibile, si renderizza diretto', e);
    composer = null;
    return false;
  }
}

/* ---- floating text in 3D (sprite) ---- */
const floatGroup = new THREE.Group();
scene.add(floatGroup);

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    if (isDev) {
      let cop = 0, civ = 0;
      for (const c of cars) c.isCop ? cop++ : civ++;
      el.fpsbox.textContent = 'fps ' + Math.round(fpsN / fpsT) + ' | cars ' + civ + '+' + cop +
        ' peds ' + peds.length + ' heat ' + player.heat.toFixed(2) + ' | draw ' + renderer.info.render.calls;
    }
    fpsT = 0; fpsN = 0;
  }
  if (state !== 'pause') update(dt);
  if (composer && composer.gradePass) composer.gradePass.uniforms.uTime.value = time;
  if (state !== 'menu') { render(); drawMinimap(); updateHUD(dt); }
  clearPressed();
}

/* =========================================================================
   AVVIO
   ========================================================================= */
function start() {
  if (state === 'play') return;
  audio.init();
  if (state === 'menu') {
    state = 'play';
    const sEl = document.getElementById('start');
    if (sEl) sEl.classList.add('hidden');
    showToast('Benvenuto a Vice City! Click per sparare, Q/E per la Radio 80s.', 4.5);
  } else if (state === 'pause') {
    state = 'play';
    const pEl = document.getElementById('pause');
    if (pEl) pEl.classList.add('hidden');
    if (audio.ctx && audio.ctx.state === 'suspended') {
      audio.ctx.resume();
    }
    if (audio.ctx && audio.nextStepTime < audio.ctx.currentTime) {
      audio.nextStepTime = audio.ctx.currentTime;
    }
  }
}
function togglePause() {
  if (state === 'play') {
    state = 'pause';
    const pEl = document.getElementById('pause');
    if (pEl) pEl.classList.remove('hidden');
    if (audio.ctx && audio.ctx.state === 'running') {
      audio.ctx.suspend();
    }
  } else if (state === 'pause') {
    start();
  }
}
document.getElementById('playBtn').addEventListener('click', () => {
  if (state !== 'menu') return;
  start();
});
document.getElementById('resumeBtn').addEventListener('click', togglePause);
document.getElementById('respawnBtn').addEventListener('click', respawn);

/* --- salvataggio: pulsanti del menu e della pausa --- */
(function setupSaveButtons() {
  const contBtn = document.getElementById('continueBtn');
  const newBtn = document.getElementById('newGameBtn');
  const saveBtn = document.getElementById('saveBtn');
  const wrap = document.getElementById('saveActions');
  if (wrap && hasSave()) wrap.style.display = 'flex';
  if (contBtn) contBtn.addEventListener('click', () => {
    if (state !== 'menu') return;
    if (!loadGame()) { showToast('Salvataggio illeggibile', 2.5); return; }
    // riposiziona la camera sul giocatore caricato
    camPos.set(player.x, 12, player.z - 20);
    camLook.set(player.x, 2, player.z);
    if (typeof updateWeaponVisuals === 'function') updateWeaponVisuals();
    start();
    showToast('Partita ripresa: $' + player.money, 2.6);
  });
  if (newBtn) newBtn.addEventListener('click', () => {
    if (state !== 'menu') return;
    deleteSave();
    if (wrap) wrap.style.display = 'none';
    start();
    showToast('Nuova partita', 1.8);
  });
  if (saveBtn) saveBtn.addEventListener('click', () => {
    saveGame();
    togglePause();
  });
  const shopClose = document.getElementById('shopCloseBtn');
  if (shopClose) shopClose.addEventListener('click', () => closeShop());
})();

/* generazione asincrona per non bloccare la pagina */
async function boot() {
  setLoad(5, 'AVVIO');
  await new Promise(r => setTimeout(r, 30));
  buildCity();
  makeShopSpots();
  setLoad(85, 'POPOLAZIONE');
  await new Promise(r => setTimeout(r, 20));

  // auto iniziali con varie tipologie (moto, berline, supercar, ambulanze)
  for (let i = 0; i < 14; i++) {
    const p = randRoadPoint(0);
    makeCar(p.x, p.z, pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), false);
  }
  for (let i = 0; i < 24; i++) {
    const p = randRoadPoint(0);
    makePed(p.x, p.z);
  }
  // veicoli vicino al giocatore: un'auto, una moto e una supercar
  const s = safeSpot();
  player.x = s.x; player.z = s.z;
  makeCar(s.x + 6, s.z + 4, 0, false, 'sedan');
  makeCar(s.x + 14, s.z + 2, 0, false, 'moto');
  makeCar(s.x - 12, s.z + 4, 0, false, 'sport');
  makeCar(s.x + 22, s.z + 4, 0, false, 'taxi');
  makeCar(s.x - 20, s.z + 2, 0, false, 'chopper');
  makeCar(s.x + 30, s.z + 4, 0, false, 'van');
  makeCar(s.x - 28, s.z + 4, 0, false, 'ambulance');

  setLoad(95, 'PRONTO');
  makePickups();
  makePackages();
  // scena iniziale
  camYaw = player.a;
  camPos.set(player.x - Math.sin(camYaw) * 12, 10, player.z - Math.cos(camYaw) * 12);
  camLook.set(player.x, 2, player.z);
  nextOfferT = 1.5;
  await new Promise(r => setTimeout(r, 60));
  setLoad(100, 'PRONTO');
  document.getElementById('loadbar').style.display = 'none';
  buildComposer();
  // registra i materiali sensibili all'ora del giorno e applica la fase iniziale
  MATS.shop = M.shop;
  setTimePhase(timePhase, true);
  // espone tutto per il debug in console
  window.GAME = { scene, camera, renderer, cars, peds, player, packages, audio, keys, stats, world: { colliders, buildings }, THREE, inBuilding, onRoad, snapToRoad, driveCar, makeCar, damageCar, update: (dt) => update(dt), trafficLights, saveGame, loadGame, hasSave, deleteSave, setTimePhase };
  requestAnimationFrame(frame);
}
boot();