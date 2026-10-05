/* =========================================================================
   VICE AUTO — mini open-world in stile GTA
   Single file, nessuna dipendenza. Avvia index.html nel browser.
   Sezioni: utils | input | mondo | entita' | player | AI | missioni | render
   ========================================================================= */
'use strict';

/* ===================== 1. COSTANTI & UTILS ===================== */
const W = 1280, H = 720;
const WORLD = 4000;            // dimensione della citta
const SP = 400;                // distanza fra due strade
const ROADW = 112;             // larghezza carreggiata
const ROADHW = ROADW / 2;
const SIDEW = 26;              // larghezza marciapiede
const INSET = ROADHW + SIDEW;  // margine dei palazzi dentro l'isolato
const LANE = 26;               // scarto dalla mezzeria (veicoli)
const WALK_LANE = ROADHW + SIDEW / 2 + 5; // centro marciapiede (pedoni)
const MAX_CARS = 44, MAX_PEDS = 66;
const CAR_COLORS = ['#d0524c', '#4f83d0', '#d9bb4a', '#59c98c', '#9563d0', '#e2e2e2',
                    '#3c4756', '#e08a3a', '#2fa5a5', '#c44fc0', '#7f8b52'];
const ROOF_COLORS = ['#5a5f6b', '#6b6257', '#4e5a63', '#6e6a72', '#57585f', '#7a6f60',
                     '#4a5259', '#63605a'];
const PARK_COLORS = ['#3f7a45', '#457f47'];

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (a) => a[(Math.random() * a.length) | 0];
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const TAU = Math.PI * 2;

function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function angLerp(a, b, t) { return a + angDiff(a, b) * t; }
function approachAng(a, b, t) {
  const d = angDiff(a, b);
  return Math.abs(d) <= t ? b : a + Math.sign(d) * t;
}

/* ===================== 2. CANVAS / INPUT ===================== */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * dpr; canvas.height = H * dpr;
ctx.scale(dpr, dpr);

const keys = Object.create(null);
const pressed = Object.create(null);   // tasti premuti solo in questo frame
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  KeyF: 'enter', Space: 'brake', ShiftLeft: 'sprint', ShiftRight: 'sprint'
};
addEventListener('keydown', (e) => {
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' || e.code === 'Space') e.preventDefault();
  if (!e.repeat) {
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyR' && state === 'wasted') respawn();
    if (e.code === 'KeyM') audio.toggle();
    if (e.code === 'KeyH') showHelp = !showHelp;
    if (e.code === 'F3') debug = !debug;
  }
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; pressed[k] = true; }
  if (e.code === 'Enter' || e.code === 'KeyE') keys['act'] = true;
});
addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
  if (e.code === 'Enter' || e.code === 'KeyE') keys['act'] = false;
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function clearPressed() { for (const k in pressed) pressed[k] = false; }

/* ===================== 3. MONDO ===================== */
const world = { blocks: new Map(), parks: [], trees: [], buildings: [] };
const bkey = (i, j) => i + '_' + j;

function genWorld() {
  const n = Math.floor(WORLD / SP);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = i * SP + INSET, y0 = j * SP + INSET;
      const w = SP - INSET * 2, h = SP - INSET * 2;
      if (w < 30 || h < 30) continue;

      if (Math.random() < 0.11) {           // parco
        world.parks.push({ x: x0, y: y0, w, h, c: pick(PARK_COLORS) });
        const k = randInt(6, 13);
        for (let t = 0; t < k; t++)
          world.trees.push({ x: rand(x0 + 18, x0 + w - 18), y: rand(y0 + 18, y0 + h - 18), r: rand(9, 18) });
        continue;
      }

      const blocks = [];
      const cols = randInt(1, 3), rows = randInt(1, 3);
      const cw = w / cols, ch = h / rows;
      for (let a = 0; a < cols; a++) {
        for (let b = 0; b < rows; b++) {
          const gap = rand(5, 16);
          const bx = x0 + a * cw + gap / 2;
          const by = y0 + b * ch + gap / 2;
          const bw = cw - gap, bh = ch - gap;
          if (bw < 24 || bh < 24) continue;
          const r = {
            x: bx, y: by, w: bw, h: bh,
            col: pick(ROOF_COLORS),
            lot: Math.random() < 0.18
          };
          blocks.push(r); world.buildings.push(r);
        }
      }
      if (blocks.length) world.blocks.set(bkey(i, j), blocks);
    }
  }
}

/* Punto casuale VALIDO: sempre dentro una carreggiata, mai dentro un edificio.
   Sceglie una strada (orizzontale o verticale) e una posizione lungo di essa. */
function randRoadPoint(minFrom) {
  const min = minFrom || 0;
  const N = Math.floor(WORLD / SP);
  for (let t = 0; t < 80; t++) {
    const i = randInt(0, N) * SP;          // coordinata della strada
    const along = rand(24, WORLD - 24);    // posizione lungo la strada
    const horiz = Math.random() < .5;      // strada orizzontale o verticale
    // punti laterali scartati: si resta dentro l'asfalto
    const off = rand(-ROADHW + 26, ROADHW - 26);
    const p = horiz ? { x: along, y: i + off } : { x: i + off, y: along };
    p.x = clamp(p.x, 24, WORLD - 24);
    p.y = clamp(p.y, 24, WORLD - 24);
    if (inBuilding(p.x, p.y, 22)) continue;
    if (min && dist(p.x, p.y, player.x, player.y) < min) continue;
    return p;
  }
  // fallback: centro di un incrocio (sempre sicuro)
  const i = randInt(1, N - 1) * SP;
  return { x: i, y: i };
}

/* collisione cerchio-rettangolo con uscita dal blocco */
function collideCircle(o, rad) {
  let hit = false;
  const i0 = Math.floor((o.x - rad) / SP), i1 = Math.floor((o.x + rad) / SP);
  const j0 = Math.floor((o.y - rad) / SP), j1 = Math.floor((o.y + rad) / SP);
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const bs = world.blocks.get(bkey(i, j));
        if (!bs) continue;
        for (const r of bs) {
          const nx = clamp(o.x, r.x, r.x + r.w), ny = clamp(o.y, r.y, r.y + r.h);
          const dx = o.x - nx, dy = o.y - ny, d2 = dx * dx + dy * dy;
          if (d2 >= rad * rad) continue;
          hit = true; moved = true;
          if (d2 > 1e-4) {
            const d = Math.sqrt(d2);
            o.x += (dx / d) * (rad - d + 0.5);
            o.y += (dy / d) * (rad - d + 0.5);
          } else {
            const l = o.x - r.x, rr = r.x + r.w - o.x, t = o.y - r.y, b = r.y + r.h - o.y;
            const m = Math.min(l, rr, t, b);
            if (m === l) o.x = r.x - rad - 0.5;
            else if (m === rr) o.x = r.x + r.w + rad + 0.5;
            else if (m === t) o.y = r.y - rad - 0.5;
            else o.y = r.y + r.h + rad + 0.5;
          }
        }
      }
    }
    if (!moved) break;
  }
  return hit;
}
function inBuilding(x, y, pad) {
  const i = Math.floor(x / SP), j = Math.floor(y / SP);
  const bs = world.blocks.get(bkey(i, j));
  if (!bs) return false;
  for (const r of bs)
    if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
  return false;
}

/* ===================== 4. ENTITA' ===================== */
let cars = [], peds = [], bullets = [], pickups = [], skids = [], fx = [];
let nextId = 1;

function makeCar(x, y, a, kind) {
  const cop = kind === 'cop';
  return {
    id: nextId++, x, y, a, kind: kind || 'civil',
    len: cop ? 46 : 40, wid: cop ? 22 : 20,
    speed: 0, hp: 100, maxhp: 100, burnT: 0,
    color: cop ? '#f2f4f8' : pick(CAR_COLORS),
    driver: null, ni: -1, nj: -1, turn: null,
    skid: 0, wheel: 0, burn: 0, flash: 0, shootCd: 0,
    marked: false, parkAngle: a
  };
}
function makePed(x, y) {
  return {
    id: nextId++, x, y, a: rand(0, TAU), speed: 0,
    skin: pick(['#e8b48a', '#c98b62', '#8d5b3c', '#f0d0b0', '#6f4527', '#d9a06b']),
    shirt: pick(['#4f83d0', '#d0524c', '#59c98c', '#d9bb4a', '#9563d0', '#e2e2e2', '#2fa5a5']),
    ni: -1, nj: -1, turn: null, walk: rand(0, 10), state: 0, down: 0, panic: 0,
    vx: 0, vy: 0
  };
}

function spawnCar(kind, at) {
  const a = pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
  let x, y;
  if (at) { x = at.x; y = at.y; }
  else {
    for (let t = 0; t < 50; t++) {
      const p = randRoadPoint(620);
      if (inBuilding(p.x, p.y, 60)) continue;
      x = p.x; y = p.y; break;
    }
  }
  const c = makeCar(x, y, a, kind);
  cars.push(c);
  return c;
}
function spawnPed(at) {
  for (let t = 0; t < 40; t++) {
    const p = at || randRoadPoint(520);
    if (!at && inBuilding(p.x, p.y, 40)) continue;
    const q = makePed(p.x, p.y);
    peds.push(q);
    return q;
  }
}

/* ===================== 5. GIOCATORE & CAMERA ===================== */
const player = {
  x: 200, y: 200, a: -Math.PI / 2, vx: 0, vy: 0,
  hp: 100, maxhp: 100, car: null, money: 300, heat: 0, heatCool: 0,
  walkPhase: 0, running: false, wasted: false
};
const cam = { x: 0, y: 0, shake: 0 };

let state = 'menu';            // menu | play | pause | wasted
let time = 0, debug = false, showHelp = true;
let fps = 60, fpsAcc = 0, fpsN = 0, fpsT = 0;
let hint = '', hintT = 0;

function setHint(txt, dur) { hint = txt; hintT = dur || 2.6; }

function enterCar(c) {
  player.car = c; c.driver = player;
  setHint(c.marked ? 'Auto di missione rubata!' : 'Auto rubata! (F per uscire)', 2.2);
}
function exitCar() {
  const c = player.car;
  if (!c) return;
  if (Math.abs(c.speed) > 26) { setHint('Fermati per scendere', 1.6); return; }
  const side = c.a + Math.PI / 2;
  player.x = c.x + Math.cos(side) * 34;
  player.y = c.y + Math.sin(side) * 34;
  player.a = c.a;
  if (inBuilding(player.x, player.y, 16)) { player.x = c.x; player.y = c.y; }
  c.driver = null; player.car = null;
}
function respawn() {
  player.hp = player.maxhp; player.heat = 0; player.heatCool = 0;
  player.car = null; player.wasted = false;
  const p = safeSpot(player.x, player.y);
  player.x = p.x; player.y = p.y;
  cars = cars.filter(c => c.kind !== 'cop');
  state = 'play';
  document.getElementById('wasted').classList.add('hidden');
  setHint('Sei stato dimesso dall\'ospedale', 3);
}

function updatePlayer(dt) {
  const c = player.car;
  if (c) {
    driveCar(c, dt);
    // la posizione del giocatore segue l'auto (camera, minimappa, missioni)
    player.x = c.x; player.y = c.y; player.a = c.a;
    player.vx = Math.cos(c.a) * c.speed; player.vy = Math.sin(c.a) * c.speed;
    return;
  }

  const ax = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const ay = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  const len = Math.hypot(ax, ay) || 1;
  const sp = (keys.sprint ? 205 : 128) * (c ? 0 : 1);
  player.running = !!keys.sprint && (ax || ay);

  const tvx = (ax / len) * sp * (ax || ay ? 1 : 0);
  const tvy = (ay / len) * sp * (ax || ay ? 1 : 0);
  player.vx = lerp(player.vx, tvx, 1 - Math.pow(0.0005, dt));
  player.vy = lerp(player.vy, tvy, 1 - Math.pow(0.0005, dt));
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.walkPhase += Math.hypot(player.vx, player.vy) * dt * 0.09;
  if (ax || ay) player.a = approachAng(player.a, Math.atan2(ay, ax), dt * 12);

  const hit = collideCircle(player, 12);
  if (hit && Math.hypot(player.vx, player.vy) > 60) { player.vx *= .3; player.vy *= .3; }

  player.x = clamp(player.x, 20, WORLD - 20);
  player.y = clamp(player.y, 20, WORLD - 20);

  // entra/esci auto
  if (pressed.enter) {
    let best = null, bd = 52;
    for (const o of cars) {
      if (o.driver) continue;
      const d = dist(player.x, player.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) enterCar(best); else setHint('Nessuna auto vicino', 1.4);
  }
}

/* ---------- guida (player) ---------- */
function driveCar(c, dt) {
  const throttle = keys.up ? 1 : 0;
  const brake = keys.down ? 1 : 0;
  const hb = !!keys.brake;

  if (throttle) c.speed += 235 * dt * (c.hp < 35 ? .55 : 1);
  else if (brake) c.speed -= (c.speed > 12 ? 400 : 175) * dt;
  else c.speed *= Math.pow(c.speed > 0 ? 0.06 : 0.25, dt);

  const mag = Math.abs(c.speed);
  const steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const sign = c.speed >= 0 ? 1 : -1;
  let grip = clamp(mag / 150, 0, 1);
  if (hb) { grip = clamp(mag / 90, 0, 1) * 1.55; c.speed *= Math.pow(0.22, dt); }
  c.a += steer * 2.25 * dt * grip * sign;
  if (hb && mag > 60) c.skid = 1;

  const lim = c.burn ? 260 : 235;
  c.speed = clamp(c.speed, -95, lim);
  c.x += Math.cos(c.a) * c.speed * dt;
  c.y += Math.sin(c.a) * c.speed * dt;
  c.wheel += c.speed * dt * 0.08;

  const hit = collideCircle(c, c.len * 0.42);
  if (hit) {
    const imp = Math.abs(c.speed);
    if (imp > 90) {
      damageCar(c, imp * 0.05);
      player.hp = Math.max(0, player.hp - imp * 0.016);
      cam.shake = Math.min(9, cam.shake + imp * 0.025);
      sfx('crash');
    }
    c.speed *= -0.22;
  }
  c.x = clamp(c.x, 30, WORLD - 30);
  c.y = clamp(c.y, 30, WORLD - 30);

  if (Math.abs(c.speed) > 20) skids.push({ x: c.x, y: c.y, a: c.a, life: 7 });

  // schiacciare pedoni
  for (const p of peds) {
    if (p.down > 0) continue;
    // raggio di impatto generoso: colpire un pedone deve essere facile
    const hitR = c.len * .55 + 18;
    if (dist2(c.x, c.y, p.x, p.y) < hitR * hitR && Math.abs(c.speed) > 35) {
      p.down = 1; p.panic = 0;
      // slancio del corpo
      p.vx = Math.cos(c.a) * Math.abs(c.speed) * .45;
      p.vy = Math.sin(c.a) * Math.abs(c.speed) * .45;
      addWanted(0.34, true);
      player.money = Math.max(0, player.money - 5);
      addFx(p.x, p.y, '#b03030', 14);
      fx.push({ t: 'text', x: p.x, y: p.y, life: 1, txt: '-5', col: '#ff6b5e' });
      cam.shake = Math.min(12, cam.shake + 4);
      sfx('hit');
    }
  }

  // collisioni con altri veicoli
  for (const o of cars) {
    if (o === c) continue;
    const dx = o.x - c.x, dy = o.y - c.y;
    const d2 = dx * dx + dy * dy;
    const rr = (c.len + o.len) * .45;
    if (d2 < rr * rr && d2 > 1e-4) {
      const d = Math.sqrt(d2), push = (rr - d) * .5;
      const ux = dx / d, uy = dy / d;
      c.x -= ux * push; c.y -= uy * push;
      o.x += ux * push; o.y += uy * push;
      const rel = Math.abs(c.speed - o.speed * Math.cos(angDiff(o.a, c.a)));
      if (rel > 110) {
        damageCar(c, rel * .04); damageCar(o, rel * .04);
        if (c.driver) player.hp = Math.max(0, player.hp - rel * .008);
        cam.shake = Math.min(10, cam.shake + rel * .025);
        if (o.kind === 'cop') addWanted(.3, true);
        sfx('crash');
      }
      if (c.driver) c.speed *= .82; else c.speed *= .98;
    }
  }
  if (pressed.enter) exitCar();
}

/* ---------- auto nemiche / traffico ---------- */
function snapLane(o, lane, axis) {
  if (axis === 0) o.y = clamp(o.y, Math.round(o.y / SP) * SP - lane, Math.round(o.y / SP) * SP + lane);
  else o.x = clamp(o.x, Math.round(o.x / SP) * SP - lane, Math.round(o.x / SP) * SP + lane);
}
function nodeTurn(o, prev, pTurn, pRev) {
  const r = Math.random();
  if (r < prev) return o.a;
  if (r < pTurn) return o.a + Math.PI / 2;
  if (r < pRev) return o.a - Math.PI / 2;
  return o.a + Math.PI;
}
function trafficDrive(c, dt) {
  const f = Math.cos(c.a), s = Math.sin(c.a);
  let brake = false;
  for (const o of cars) {
    if (o === c) continue;
    const dx = o.x - c.x, dy = o.y - c.y;
    const fwd = dx * f + dy * s, side = Math.abs(-dx * s + dy * f);
    if (fwd > 0 && fwd < c.len + 36 && side < 24) { brake = true; break; }
  }
  const ni = Math.floor((c.x + 10) / SP), nj = Math.floor((c.y + 10) / SP);
  if (ni !== c.ni || nj !== c.nj) {
    c.ni = ni; c.nj = nj;
    if (dist(c.x, c.y, ni * SP, nj * SP) < 130) c.turn = nodeTurn(c, .55, .79, .96);
  }
  let target = c.kind === 'taxi' ? 168 : 148;
  if (brake) target = 30;
  if (c.turn !== null) {
    c.a = approachAng(c.a, c.turn, dt * 2.6);
    if (Math.abs(angDiff(c.a, c.turn)) < .04) {
      c.a = c.turn; c.turn = null;
      const vert = Math.abs(angDiff(c.a, Math.PI / 2)) < .9 || Math.abs(angDiff(c.a, -Math.PI / 2)) < .9;
      snapLane(c, LANE, vert ? 1 : 0);
    }
    target *= .72;
  }
  c.speed = approach(c.speed, target, (brake ? 320 : 190) * dt);
  c.x += Math.cos(c.a) * c.speed * dt;
  c.y += Math.sin(c.a) * c.speed * dt;
  c.wheel += c.speed * dt * .08;
  collideCircle(c, c.len * .42);
  c.x = clamp(c.x, 30, WORLD - 30); c.y = clamp(c.y, 30, WORLD - 30);
  return brake;
}

function copDrive(c, dt) {
  const stars = Math.floor(player.heat);
  const tx = player.x, ty = player.y;
  const ang = Math.atan2(ty - c.y, tx - c.x);
  c.a = approachAng(c.a, ang, dt * (2.1 + stars * .12));
  let target = 168 + stars * 15;
  // evita edifici davanti
  const look = 60 + Math.abs(c.speed) * .35;
  if (inBuilding(c.x + Math.cos(c.a) * look, c.y + Math.sin(c.a) * look, c.len * .4)) {
    const alt = c.a + (Math.random() < .5 ? .85 : -.85);
    c.a = approachAng(c.a, alt, dt * 3.4);
    target = 150;
  }
  c.speed = approach(c.speed, target, 260 * dt);
  c.x += Math.cos(c.a) * c.speed * dt;
  c.y += Math.sin(c.a) * c.speed * dt;
  c.wheel += c.speed * dt * .08;
  const hit = collideCircle(c, c.len * .42);
  if (hit) { c.speed *= -.2; damageCar(c, 6); }
  c.x = clamp(c.x, 30, WORLD - 30); c.y = clamp(c.y, 30, WORLD - 30);

  // la polizia travolge anche il giocatore a piedi
  if (!player.car && dist2(c.x, c.y, player.x, player.y) < 26 * 26 && Math.abs(c.speed) > 70) {
    player.hp = Math.max(0, player.hp - Math.abs(c.speed) * .03);
    player.vx = Math.cos(c.a) * 190; player.vy = Math.sin(c.a) * 190;
    c.speed *= .5;
    addWanted(.3, true);
    cam.shake = Math.min(10, cam.shake + 4);
    sfx('hit');
  }

  // sparata a partire da 3 stelle
  c.flash = Math.max(0, c.flash - dt);
  if (stars >= 3 && !player.car) {
    c.shootCd -= dt;
    if (c.shootCd <= 0 && dist(c.x, c.y, player.x, player.y) < 340) {
      c.shootCd = rand(.7, 1.5);
      bullets.push({ x: c.x, y: c.y, a: ang + rand(-.09, .09), life: 1.3, dmg: 7 });
      c.flash = .12;
    }
  }
  // collisione con auto del giocatore
  if (player.car && dist2(c.x, c.y, player.car.x, player.car.y) < 40 * 40) {
    const p = player.car;
    const rel = Math.abs(c.speed);
    if (rel > 90) {
      player.hp = Math.max(0, player.hp - rel * .022);
      damageCar(p, rel * .04); damageCar(c, rel * .05);
      cam.shake = Math.min(12, cam.shake + 5);
      addWanted(.28, true);
      sfx('crash');
    }
  }
}

function damageCar(c, d) {
  c.hp -= d;
  if (c.hp <= 0) {
    c.hp = 0; c.burn = 1;
    addFx(c.x, c.y, '#ff8a3c', 22);
    if (c.driver) {
      player.hp = Math.max(0, player.hp - 45);
      cam.shake = 14;
      // il giocatore viene buttato fuori
      const cc = player.car; if (cc) cc.driver = null;
      player.car = null;
      player.vx = Math.cos(c.a) * 120; player.vy = Math.sin(c.a) * 120;
    }
    sfx('boom');
  }
}
function addFx(x, y, col, n) {
  for (let i = 0; i < n; i++)
    fx.push({ x, y, col, life: rand(.3, .8), r: rand(2, 7), vx: rand(-90, 90), vy: rand(-90, 90) });
}

/* ---------- pedoni ---------- */
function updatePed(p, dt) {
  if (p.down > 0) { p.down += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .9; p.vy *= .9; return; }

  const d = dist(p.x, p.y, player.x, player.y);
  const carNear = player.car ? dist(p.x, p.y, player.car.x, player.car.y) : 1e9;
  // i pedoni si accorgono dell'auto solo quando e' davvero vicina
  if (d < 130 || carNear < 62) p.panic = 2.2;

  if (p.panic > 0) p.panic -= dt;

  const ni = Math.floor((p.x + 10) / SP), nj = Math.floor((p.y + 10) / SP);
  if (ni !== p.ni || nj !== p.nj) {
    p.ni = ni; p.nj = nj;
    if (dist(p.x, p.y, ni * SP, nj * SP) < 150) p.turn = nodeTurn(p, .5, .85, .97);
  }
  if (p.turn !== null) {
    p.a = approachAng(p.a, p.turn, dt * 3.4);
    if (Math.abs(angDiff(p.a, p.turn)) < .05) {
      p.a = p.turn; p.turn = null;
      const vert = Math.abs(angDiff(p.a, Math.PI / 2)) < .9 || Math.abs(angDiff(p.a, -Math.PI / 2)) < .9;
      snapLane(p, WALK_LANE, vert ? 1 : 0);
    }
  }
  // fugge dal giocatore
  if (p.panic > 0) {
    const away = Math.atan2(p.y - player.y, p.x - player.x);
    p.a = approachAng(p.a, away, dt * 3);
    p.speed = approach(p.speed, 74, 200 * dt);
  } else {
    if (p.state > 0) { p.state -= dt; p.speed = approach(p.speed, 0, 180 * dt); }
    else p.speed = approach(p.speed, 38, 120 * dt);
  }
  p.walk += p.speed * dt * .1;
  p.x += Math.cos(p.a) * p.speed * dt;
  p.y += Math.sin(p.a) * p.speed * dt;
  const before = p.x + p.y;
  collideCircle(p, 9);
  if (Math.abs(p.x + p.y - before) > .01) p.a = -p.a;
  p.x = clamp(p.x, 24, WORLD - 24); p.y = clamp(p.y, 24, WORLD - 24);
  p.panic = Math.max(0, p.panic);
}

/* ---------- proiettili ---------- */
function updateBullets(dt) {
  for (const b of bullets) {
    b.x += Math.cos(b.a) * 760 * dt;
    b.y += Math.sin(b.a) * 760 * dt;
    b.life -= dt;
    if (!player.car && dist2(b.x, b.y, player.x, player.y) < 18 * 18) {
      player.hp = Math.max(0, player.hp - b.dmg); b.life = 0;
      addFx(b.x, b.y, '#ffdd66', 5); cam.shake = Math.min(9, cam.shake + 2.4); sfx('hit');
    }
  }
  bullets = bullets.filter(b => b.life > 0 && b.x > 0 && b.y > 0 && b.x < WORLD && b.y < WORLD);
}

/* ===================== 6. RICERCA / POLIZIA ===================== */
function addWanted(v, violent) {
  if (state !== 'play') return;
  player.heat = clamp(player.heat + v, 0, 5);
  player.heatCool = 0;
  if (violent && player.heat > 0 && Math.random() < .3) setHint('La polizia ti ha visto!', 2);
}

function wantedCopCount() { return Math.min(7, Math.floor(player.heat) * 2); }

function updateWanted(dt) {
  const want = wantedCopCount();

  // declassamento se nessuno ti vede
  if (player.heat > 0) {
    let seen = false;
    for (const c of cars) if (c.kind === 'cop' && dist(c.x, c.y, player.x, player.y) < 460) { seen = true; break; }
    if (!seen) { player.heatCool += dt; if (player.heatCool > 6.5) { player.heat = Math.max(0, player.heat - dt * .34); player.heatCool = 0; } }
    else player.heatCool = 0;
  }

  let copCount = cars.reduce((n, c) => n + (c.kind === 'cop' ? 1 : 0), 0);
  while (copCount < want) {
    let spot = null;
    for (let t = 0; t < 60; t++) {
      const p = randRoadPoint(0);
      const d = dist(p.x, p.y, player.x, player.y);
      if (d > 430 && d < 900 && !inBuilding(p.x, p.y, 60)) { spot = p; break; }
    }
    if (!spot) break;
    const c = spawnCar('cop', spot);
    c.speed = 120;
    copCount++;
    if (copCount === 1) setHint('POLIZIA! Allontanati per far scendere le stelle', 3);
  }
  while (copCount > want) {
    let far = null, fd = -1;
    for (const c of cars) {
      if (c.kind !== 'cop') continue;
      const d = dist(c.x, c.y, player.x, player.y);
      if (d > fd) { fd = d; far = c; }
    }
    if (!far || fd < 620) break;
    cars.splice(cars.indexOf(far), 1);
    copCount--;
  }

  // polizia distrutta
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i];
    if (c.burn && c.burnT === undefined) c.burnT = 0;
    if (c.burn) {
      c.burnT += dt;
      if (Math.random() < .3) addFx(c.x + rand(-10, 10), c.y + rand(-10, 10), '#555', 1);
      if (c.burnT > 12 && !c.driver) { cars.splice(i, 1); continue; }
    }
    if (c.hp <= 0 && c.kind === 'cop' && !c.scored) { c.scored = true; addWanted(.35, true); }
  }

  if (player.hp <= 0 && !player.wasted) {
    player.wasted = true; state = 'wasted';
    document.getElementById('wasted').classList.remove('hidden');
  }
  if (player.heat === 0 && player.hp < player.maxhp && !player.car)
    player.hp = Math.min(player.maxhp, player.hp + dt * 2.2);
}

/* ===================== 7. POPOLAZIONE & OGGETTI ===================== */
let spawnT = 0;
function updatePopulation(dt) {
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnT = .22;
    const camX = cam.x + W / 2, camY = cam.y + H / 2;
    if (cars.filter(c => c.kind !== 'cop').length < MAX_CARS - 3) {
      for (let t = 0; t < 12; t++) {
        const p = randRoadPoint(0);
        const d = dist(p.x, p.y, camX, camY);
        if (d > 780 && d < 1500 && !inBuilding(p.x, p.y, 60)) { spawnCar(null, p); break; }
      }
    }
    if (peds.length < MAX_PEDS) {
      for (let t = 0; t < 12; t++) {
        const p = randRoadPoint(0);
        const d = dist(p.x, p.y, camX, camY);
        if (d > 420 && d < 1100 && !inBuilding(p.x, p.y, 40)) { spawnPed(p.x, p.y); break; }
      }
    }
    if (Math.random() < .06 && peds.length > 8) {
      const p = pick(peds); if (p && p.down <= 0) p.state = rand(1.5, 5);
    }
  }
  // pulizia
  const camX = cam.x + W / 2, camY = cam.y + H / 2;
  cars = cars.filter(c => {
    if (c.burn && c.burnT > 12) return false;
    if (dist(c.x, c.y, camX, camY) > 2600 && c.kind !== 'cop') {
      if (!c.driver && Math.random() < .05) return false;
    }
    return true;
  });
  peds = peds.filter(p => dist(p.x, p.y, camX, camY) < 2400 && (p.down <= 0 || p.down < 40));

  // raccolte
  for (const k of pickups) {
    if (k.got) continue;
    if (dist2(k.x, k.y, player.x, player.y) < 30 * 30) {
      k.got = true; k.respawn = 26;
      player.money += 50;
      fx.push({ t: 'text', x: k.x, y: k.y, life: 1.1, txt: '+$50', col: '#7dff9b' });
      addFx(k.x, k.y, '#ffd34d', 8);
      sfx('coin');
    }
  }
  for (const k of pickups) if (k.got) { k.respawn -= dt; if (k.respawn <= 0) k.got = false; }
}

function makePickups() {
  for (let i = 0; i < 34; i++) {
    const p = randRoadPoint(0);
    pickups.push({ x: p.x, y: p.y, got: false, respawn: 0 });
  }
}

/* ===================== 8. MISSIONI ===================== */
let offer = null;     // incarico disponibile (anello giallo)
let mission = null;   // incarico in corso
let nextOfferT = 0;

function newOffer() {
  const types = ['goto', 'race', 'steal', 'collect', 'evade'];
  const type = pick(types);
  const at = randRoadPoint(700);
  offer = { type, x: at.x, y: at.y, reward: 0 };
  if (type === 'race') {
    offer.pts = Array.from({ length: 5 }, () => randRoadPoint(600));
    offer.reward = 750;
    offer.desc = 'Corra: 5 waypoint in sequenza entro 75 secondi';
  } else if (type === 'collect') {
    offer.pts = Array.from({ length: 6 }, () => randRoadPoint(600));
    offer.reward = 900;
    offer.desc = 'Raccogli 6 buste diaposte sparse in citta\'';
  } else if (type === 'steal') {
    offer.carSpot = randRoadPoint(500);           // dove appare l'auto speciale
    const garage = randRoadPoint(700);             // garage (un solo punto coerente)
    offer.x = garage.x; offer.y = garage.y;
    offer.reward = 650;
    offer.desc = 'Ruba l\'auto speciale e portala al garage';
  } else if (type === 'evade') {
    offer.heat = 2.5;
    offer.reward = 600;
    offer.desc = 'Fai scendere le stelle a 0 entro 90 secondi';
  } else {
    offer.time = 45; offer.reward = 320;
    offer.desc = 'Consegna: raggiungi il punto in 45 secondi';
  }
}

function startOffer() {
  if (!offer) return;
  if (offer.type === 'steal') {
    const c = spawnCar(null, offer.carSpot);
    c.marked = true; c.color = '#ffcf3c';
    mission = { type: 'steal', car: c, tx: offer.x, ty: offer.y, t: 0, reward: offer.reward, desc: offer.desc, stage: 1 };
  } else if (offer.type === 'race') {
    mission = { type: 'race', pts: offer.pts, i: 0, t: 75, reward: offer.reward, desc: offer.desc };
  } else if (offer.type === 'collect') {
    mission = { type: 'collect', pts: offer.pts.map(p => ({ ...p, got: false })), i: 0, t: 0, reward: offer.reward, desc: offer.desc };
  } else if (offer.type === 'evade') {
    mission = { type: 'evade', t: 90, reward: offer.reward, desc: offer.desc };
    addWanted(2.5, false);
  } else {
    mission = { type: 'goto', tx: offer.x, ty: offer.y, t: offer.time, reward: offer.reward, desc: offer.desc };
  }
  offer = null;
  setHint('Missione: ' + mission.desc, 4);
  sfx('accept');
}

function completeMission(msg) {
  player.money += mission.reward;
  fx.push({ t: 'text', x: player.x, y: player.y - 30, life: 2, txt: '+$' + mission.reward, col: '#ffd34d' });
  setHint(msg + '  +$' + mission.reward, 3.4);
  mission = null;
  nextOfferT = 2.5;
  sfx('accept');
}
function failMission(reason) {
  setHint('Missione fallita: ' + reason, 3);
  mission = null; nextOfferT = 2;
  if (player.car && player.car.marked) { player.car.marked = false; }
}

function updateMissions(dt) {
  nextOfferT -= dt;
  if (!mission && !offer && nextOfferT <= 0) newOffer();
  if (offer) offer.t = (offer.t || 0) + dt;

  // accettamissione camminando/guidando sull'anello
  if (offer && !mission) {
    const d = dist(player.x, player.y, offer.x, offer.y);
    if (d < (player.car ? 70 : 40)) startOffer();
    else if (offer.t > 95) { nextOfferT = 1; offer = null; }
  }
  if (!mission) return;

  const m = mission;
  if (m.t > 0) {
    m.t -= dt;
    if (m.t <= 0) { failMission('tempo scaduto'); return; }
  }

  if (m.type === 'goto') {
    if (dist(player.x, player.y, m.tx, m.ty) < 60)
      completeMission('Consegna completata');
  } else if (m.type === 'race') {
    const p = m.pts[m.i];
    if (dist(player.x, player.y, p.x, p.y) < 80) {
      m.i++;
      if (m.i >= m.pts.length) completeMission('Gara vinta');
    }
  } else if (m.type === 'collect') {
    const p = m.pts[m.i];
    if (!p.got && dist(player.x, player.y, p.x, p.y) < 42) {
      p.got = true; m.i++;
      player.money += 20;
      addFx(p.x, p.y, '#6ec7ff', 8); sfx('coin');
      if (m.i >= m.pts.length) completeMission('Buste raccolte');
    }
  } else if (m.type === 'steal') {
    if (m.car.burn || m.car.hp <= 0) { failMission('auto distrutta'); return; }
    if (player.car === m.car && dist(player.x, player.y, m.tx, m.ty) < 70)
      completeMission('Auto consegnata al garage');
  } else if (m.type === 'evade') {
    if (player.heat <= 0.01) completeMission('Fuggito! Le stelle sono scese');
  }
}

/* bersagli missione da disegnare */
function missionTargets() {
  const out = [];
  if (offer) out.push({ x: offer.x, y: offer.y, col: '#ffd34d', r: 46, txt: '!' });
  const m = mission;
  if (m) {
    if (m.type === 'goto') out.push({ x: m.tx, y: m.ty, col: '#7dff9b', r: 52, txt: 'G' });
    else if (m.type === 'race') { const p = m.pts[m.i]; if (p) out.push({ x: p.x, y: p.y, col: '#7dff9b', r: 52, txt: '' + (m.i + 1) }); }
    else if (m.type === 'collect') { const p = m.pts[m.i]; if (p) out.push({ x: p.x, y: p.y, col: '#6ec7ff', r: 34, txt: '' }); }
    else if (m.type === 'steal') {
      out.push({ x: m.tx, y: m.ty, col: '#7dff9b', r: 52, txt: 'G' });
      if (player.car !== m.car) out.push({ x: m.car.x, y: m.car.y, col: '#ffcf3c', r: 44, txt: 'A' });
    }
  }
  return out;
}

/* ===================== 9. CAMERA & LOOP ===================== */
function updateCamera(dt) {
  const tx = clamp(player.x - W / 2, 0, WORLD - W);
  const ty = clamp(player.y - H / 2, 0, WORLD - H);
  cam.x = lerp(cam.x, tx, 1 - Math.pow(0.0002, dt));
  cam.y = lerp(cam.y, ty, 1 - Math.pow(0.0002, dt));
  cam.shake = Math.max(0, cam.shake - dt * 22);
  if (hintT > 0) hintT -= dt;
}

function update(dt) {
  time += dt;
  if (state === 'play') {
    updatePlayer(dt);
    for (const c of cars) {
      if (c.driver) continue;
      if (c.kind === 'cop') copDrive(c, dt); else trafficDrive(c, dt);
    }
    for (const p of peds) updatePed(p, dt);
    updateBullets(dt);
    updateWanted(dt);
    updatePopulation(dt);
    updateMissions(dt);
  } else {
    // mondo vivo anche in pausa/menu (senza input)
    for (const p of peds) updatePed(p, dt);
    for (const c of cars) if (!c.driver) { if (c.kind === 'cop') copDrive(c, dt); else trafficDrive(c, dt); }
    updatePopulation(dt);
  }
  // effetti
  for (const f of fx) {
    f.life -= dt;
    if (f.t === 'text') f.y -= dt * 26;
    else { f.x += (f.vx || 0) * dt; f.y += (f.vy || 0) * dt; f.vx *= .92; f.vy *= .92; }
  }
  fx = fx.filter(f => f.life > 0);
  for (const s of skids) s.life -= dt;
  skids = skids.filter(s => s.life > 0);
  if (skids.length > 420) skids.splice(0, skids.length - 420);

  updateCamera(dt);
  audioUpdate(dt);
}

/* ===================== 10. RENDER ===================== */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawGround() {
  const x0 = cam.x, y0 = cam.y, x1 = cam.x + W, y1 = cam.y + H;
  ctx.fillStyle = '#3b4a38';
  ctx.fillRect(x0 - 40, y0 - 40, W + 80, H + 80);

  const i0 = Math.floor(x0 / SP) - 1, i1 = Math.ceil(x1 / SP) + 1;
  const j0 = Math.floor(y0 / SP) - 1, j1 = Math.ceil(y1 / SP) + 1;

  // marciapiedi (blocchi vuoti/park)
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const bx = i * SP + ROADHW, by = j * SP + ROADHW, bs = SP - ROADW;
      const park = world.parks.find(p => Math.abs(p.x - (bx + SIDEW)) < 1 && Math.abs(p.y - (by + SIDEW)) < 1);
      if (park) ctx.fillStyle = park.c;
      else ctx.fillStyle = '#7b7f88';
      ctx.fillRect(bx, by, bs, bs);
      if (!park) {
        ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 2;
        for (let t = 0; t < 4; t++) {
          const yy = by + SIDEW + t * ((bs - SIDEW * 2) / 4);
          ctx.beginPath(); ctx.moveTo(bx, yy); ctx.lineTo(bx + bs, yy); ctx.stroke();
        }
      }
    }
  }
  // alberi dei parchi
  for (const t of world.trees) {
    if (t.x < x0 - 40 || t.x > x1 + 40 || t.y < y0 - 40 || t.y > y1 + 40) continue;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.arc(t.x + 4, t.y + 5, t.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2f6b36';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3f8a45';
    ctx.beginPath(); ctx.arc(t.x - 2, t.y - 3, t.r * .6, 0, TAU); ctx.fill();
  }
}

function drawRoads() {
  const x0 = cam.x, y0 = cam.y, x1 = cam.x + W, y1 = cam.y + H;
  const i0 = Math.floor(x0 / SP) - 1, i1 = Math.ceil(x1 / SP) + 1;
  const j0 = Math.floor(y0 / SP) - 1, j1 = Math.ceil(y1 / SP) + 1;

  ctx.fillStyle = '#2e3138';
  for (let i = i0; i <= i1; i++) {
    const rx = i * SP - ROADHW;
    if (rx > x1 || rx + ROADW < x0) continue;
    ctx.fillRect(rx, y0 - ROADHW, ROADW, H + ROADW * 2);
  }
  for (let j = j0; j <= j1; j++) {
    const ry = j * SP - ROADHW;
    if (ry > y1 || ry + ROADW < y0) continue;
    ctx.fillRect(x0 - ROADHW, ry, W + ROADHW * 2, ROADW);
  }
  // strisce tratteggiate
  ctx.strokeStyle = 'rgba(240,225,150,.42)'; ctx.lineWidth = 3;
  ctx.setLineDash([26, 30]);
  for (let i = i0; i <= i1; i++) {
    const rx = i * SP;
    if (rx < x0 - 40 || rx > x1 + 40) continue;
    ctx.beginPath(); ctx.moveTo(rx, y0); ctx.lineTo(rx, y1); ctx.stroke();
  }
  for (let j = j0; j <= j1; j++) {
    const ry = j * SP;
    if (ry < y0 - 40 || ry > y1 + 40) continue;
    ctx.beginPath(); ctx.moveTo(x0, ry); ctx.lineTo(x1, ry); ctx.stroke();
  }
  ctx.setLineDash([]);
  // traversee
  ctx.fillStyle = 'rgba(235,235,235,.4)';
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const cx = i * SP, cy = j * SP;
    if (cx < x0 - 60 || cx > x1 + 60 || cy < y0 - 60 || cy > y1 + 60) continue;
    for (let s = -1; s <= 1; s += 2) for (let k = 0; k < 5; k++) {
      ctx.fillRect(cx + s * (ROADHW + 4) - 2, cy - ROADHW + 8 + k * 20, 4, 12);
      ctx.fillRect(cx - ROADHW + 8 + k * 20, cy + s * (ROADHW + 4) - 2, 12, 4);
    }
  }
}

function drawSkids() {
  ctx.strokeStyle = 'rgba(20,20,22,.5)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (const s of skids) {
    ctx.globalAlpha = clamp(s.life / 7, 0, 1) * .7;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(s.a) * 9, s.y + Math.sin(s.a) * 9); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'butt';
}

function drawBuildings() {
  const x0 = cam.x, y0 = cam.y, x1 = cam.x + W, y1 = cam.y + H;
  const i0 = Math.floor(x0 / SP), i1 = Math.floor(x1 / SP);
  const j0 = Math.floor(y0 / SP), j1 = Math.floor(y1 / SP);
  const sh = 9;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const bs = world.blocks.get(bkey(i, j));
      if (!bs) continue;
      for (const r of bs) {
        if (r.x > x1 || r.x + r.w < x0 || r.y > y1 || r.y + r.h < y0) continue;
        ctx.fillStyle = 'rgba(0,0,0,.32)';
        ctx.fillRect(r.x + sh, r.y + sh, r.w, r.h);
        ctx.fillStyle = r.col;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        // tetto
        ctx.fillStyle = 'rgba(255,255,255,.055)';
        ctx.fillRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
        ctx.fillStyle = 'rgba(0,0,0,.16)';
        ctx.fillRect(r.x + 10, r.y + 10, Math.max(8, r.w * .18), Math.max(8, r.h * .16));
        if (r.lot) {
          ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
          for (let k = 1; k < 4; k++) {
            ctx.beginPath(); ctx.moveTo(r.x + r.w * k / 4, r.y); ctx.lineTo(r.x + r.w * k / 4, r.y + r.h); ctx.stroke();
          }
        }
      }
    }
  }
}

function drawPickups() {
  for (const k of pickups) {
    if (k.x < cam.x - 30 || k.x > cam.x + W + 30 || k.y < cam.y - 30 || k.y > cam.y + H + 30) continue;
    if (k.got) continue;
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(k.x, k.y + 5, 11, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c8a04a'; ctx.fillRect(k.x - 8, k.y - 12, 16, 16);
    ctx.fillStyle = '#e8cf8a'; ctx.fillRect(k.x - 8, k.y - 12, 16, 5);
    ctx.fillStyle = '#8a6a2a'; ctx.fillRect(k.x - 3, k.y - 12, 6, 16);
  }
}

function drawTargets() {
  const t = time * 2.4;
  for (const g of missionTargets()) {
    const pr = g.r + Math.sin(t) * 6;
    ctx.strokeStyle = g.col; ctx.lineWidth = 4;
    ctx.globalAlpha = .9;
    ctx.beginPath(); ctx.arc(g.x, g.y, pr, 0, TAU); ctx.stroke();
    ctx.globalAlpha = .22;
    ctx.fillStyle = g.col; ctx.beginPath(); ctx.arc(g.x, g.y, pr, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (g.txt) {
      ctx.fillStyle = '#0b0d12';
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(g.txt, g.x, g.y);
    }
  }
}

function drawCar(c) {
  const L = c.len, Wd = c.wid;
  ctx.save();
  ctx.translate(c.x, c.y);
  // ombra
  ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(-L / 2 + 5, -Wd / 2 + 6, L, Wd);
  // corpo
  ctx.fillStyle = c.color;
  ctx.fillRect(-L / 2, -Wd / 2, L, Wd);
  // cofano/portacoda
  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.fillRect(-L / 2 + 2, -Wd / 2 + 2, L * .3, Wd - 4);
  ctx.fillRect(L / 2 - L * .26, -Wd / 2 + 2, L * .24, Wd - 4);
  // abitacolo
  ctx.fillStyle = 'rgba(150,205,240,.85)';
  ctx.fillRect(-L * .16, -Wd / 2 + 2, L * .34, Wd - 4);
  // ruote
  ctx.fillStyle = '#15171c';
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    ctx.save();
    ctx.translate(sx * L * .3, sy * (Wd / 2 - 1));
    ctx.fillRect(-6, -3, 12, 6);
    ctx.restore();
  }
  // fari
  ctx.fillStyle = c.kind === 'cop' ? '#9fe4ff' : '#fff3c4';
  ctx.fillRect(L / 2 - 3, -Wd / 2 + 2, 3, 5);
  ctx.fillRect(L / 2 - 3, Wd / 2 - 7, 3, 5);
  ctx.fillStyle = '#c33';
  ctx.fillRect(-L / 2, -Wd / 2 + 2, 3, 4);
  ctx.fillRect(-L / 2, Wd / 2 - 6, 3, 4);

  if (c.kind === 'cop') {
    // barra luminosa
    const on = (time * 6) % 1 < .5;
    ctx.fillStyle = on ? '#ff3b3b' : '#3b8bff';
    ctx.fillRect(-4, -Wd / 2 + 1, 8, Wd / 2 - 1);
    ctx.fillStyle = on ? '#3b8bff' : '#ff3b3b';
    ctx.fillRect(-4, 0, 8, Wd / 2 - 1);
    if (c.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(-L / 2, -Wd / 2, L, Wd); }
    ctx.fillStyle = '#1d3f78';
    ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('POLIZIA', 0, -Wd / 2 - 7);
  }
  if (c.marked) {
    ctx.strokeStyle = '#ffcf3c'; ctx.lineWidth = 3;
    ctx.strokeRect(-L / 2 - 3, -Wd / 2 - 3, L + 6, Wd + 6);
  }
  if (c.hp < c.maxhp * .4) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(-L / 2, -Wd / 2, L * (1 - c.hp / c.maxhp), 3);
  }
  ctx.restore();
}

function drawPed(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(3, 5, 9, 5, 0, 0, TAU); ctx.fill();
  if (p.down > 0) {
    ctx.rotate(p.a);
    ctx.fillStyle = p.shirt; ctx.fillRect(-9, -5, 18, 10);
    ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(-9, 0, 4.5, 0, TAU); ctx.fill();
    ctx.restore(); return;
  }
  ctx.rotate(p.a);
  // gambe
  const sw = Math.sin(p.walk) * 3.4;
  ctx.strokeStyle = '#2c3040'; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(sw, 9); ctx.moveTo(0, 2); ctx.lineTo(-sw, 9); ctx.stroke();
  // corpo
  ctx.fillStyle = p.shirt;
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
  // testa
  ctx.fillStyle = p.skin;
  ctx.beginPath(); ctx.arc(2.5, 0, 4.4, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  const c = player.car;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(4, 6, 11, 6, 0, 0, TAU); ctx.fill();
  ctx.rotate(player.a);
  const sw = Math.sin(player.walkPhase) * 4;
  ctx.strokeStyle = '#2a3550'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -2.5); ctx.lineTo(sw, 10); ctx.moveTo(0, 2.5); ctx.lineTo(-sw, 10); ctx.stroke();
  ctx.fillStyle = c ? '#2a3550' : '#e8f24a';
  ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffd9b0';
  ctx.beginPath(); ctx.arc(3, 0, 5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#1b2030';
  ctx.beginPath(); ctx.arc(5.5, 0, 2.2, 0, TAU); ctx.fill();
  ctx.restore();

  if (!c && showHelp) {
    let near = null, bd = 52;
    for (const o of cars) {
      if (o.driver) continue;
      const d = dist(player.x, player.y, o.x, o.y);
      if (d < bd) { bd = d; near = o; }
    }
    if (near) {
      const sy = near.y - near.len * .5 - 26;
      bubble('F', near.x, sy, 'rubare auto');
    }
  }
}

function bubble(key, x, y, label) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px system-ui';
  const tw = ctx.measureText(label).width;
  const w = tw + 34;
  ctx.fillStyle = 'rgba(8,10,14,.82)';
  rr(x - w / 2, y - 13, w, 26, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#ffd34d'; ctx.fillRect(x - w / 2 + 5, y - 9, 18, 18);
  ctx.fillStyle = '#12151c'; ctx.font = 'bold 12px system-ui';
  ctx.fillText(key, x - w / 2 + 14, y + 1);
  ctx.fillStyle = '#dbe4f2'; ctx.font = 'bold 13px system-ui';
  ctx.fillText(label, x - w / 2 + 29 + tw / 2, y + 1);
}

function drawBullets() {
  ctx.strokeStyle = '#ffe37a'; ctx.lineWidth = 2.5;
  for (const b of bullets) {
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(b.a) * 16, b.y - Math.sin(b.a) * 16);
    ctx.stroke();
  }
}

function drawFx() {
  for (const f of fx) {
    ctx.globalAlpha = clamp(f.life * 2, 0, 1);
    if (f.t === 'text') {
      ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText(f.txt, f.x, f.y);
      ctx.fillStyle = f.col; ctx.fillText(f.txt, f.x, f.y);
    } else {
      ctx.fillStyle = f.col;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * clamp(f.life * 2, 0, 1), 0, TAU); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/* ---------- HUD ---------- */
function bar(x, y, w, h, v, col, bg) {
  ctx.fillStyle = bg || 'rgba(0,0,0,.55)';
  rr(x, y, w, h, 4); ctx.fill();
  ctx.fillStyle = col;
  rr(x + 2, y + 2, (w - 4) * clamp(v, 0, 1), h - 4, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.stroke();
}

function stars(n) {
  const full = Math.floor(n), half = n - full >= .5;
  ctx.font = '26px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < full ? (time % 1 < .5 ? '#ffd34d' : '#ffb020') : (i === full && half ? '#8a6b20' : 'rgba(255,255,255,.16)');
    ctx.fillText('\u2605', 24 + i * 27, 52);
  }
}

function drawHUD() {
  ctx.save();
  ctx.textBaseline = 'top';

  // pannello alto-sinistra
  ctx.fillStyle = 'rgba(8,10,15,.55)';
  rr(14, 14, 250, 92, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1; ctx.stroke();

  ctx.font = 'bold 12px system-ui'; ctx.fillStyle = '#8fa0b8';
  ctx.fillText('VITA', 24, 22);
  bar(24, 38, 150, 12, player.hp / player.maxhp, player.hp > 30 ? '#4ad06a' : '#ff4d4d');
  ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'right';
  ctx.fillStyle = '#7dff9b'; ctx.fillText('$' + player.money, 252, 34);
  ctx.textAlign = 'left';

  stars(player.heat);

  // pannello missione
  const M = mission || offer;
  if (M) {
    const desc = mission ? M.desc : 'Incarico disponibile — ' + M.desc;
    const timeTxt = (mission && M.t > 0) ? '  ⏱ ' + Math.ceil(M.t) + 's' : '';
    ctx.fillStyle = 'rgba(8,10,15,.55)';
    rr(W - 336, 14, 322, 66, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.stroke();
    ctx.fillStyle = mission ? '#ffd34d' : '#7dff9b';
    ctx.font = 'bold 12px system-ui';
    ctx.fillText(mission ? 'MISSIONE IN CORSO' : 'NUOVO INCARICO', W - 322, 22);
    ctx.fillStyle = '#e6ecf6'; ctx.font = '14px system-ui';
    wrapText(desc, W - 322, 40, 292, 17);
    if (timeTxt) {
      ctx.fillStyle = (M.t < 10 ? '#ff6b5e' : '#cfe0f5');
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'right'; ctx.fillText(timeTxt.trim(), W - 28, 22); ctx.textAlign = 'left';
    }
  }

  // contatore auto rubate
  ctx.fillStyle = 'rgba(8,10,15,.45)';
  rr(W / 2 - 96, 14, 192, 26, 8); ctx.fill();
  ctx.fillStyle = '#9fb0c8'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('AUTO RUBATE: ' + stats.cars, W / 2, 22);
  ctx.textAlign = 'left';

  // velocita'
  if (player.car) {
    const kmh = Math.round(Math.abs(player.car.speed) * 0.42);
    ctx.fillStyle = 'rgba(8,10,15,.5)';
    rr(W - 168, H - 108, 150, 92, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.stroke();
    ctx.font = 'bold 34px system-ui'; ctx.fillStyle = '#e8ecf4'; ctx.textAlign = 'center';
    ctx.fillText(kmh + '', W - 93, H - 96);
    ctx.font = 'bold 12px system-ui'; ctx.fillStyle = '#8fa0b8';
    ctx.fillText('KM/H', W - 93, H - 60);
    const dmg = 1 - player.car.hp / player.car.maxhp;
    ctx.fillStyle = '#8fa0b8'; ctx.fillText('DANNO', W - 93, H - 44);
    bar(W - 158, H - 34, 130, 10, dmg, dmg > .7 ? '#ff4d4d' : '#ffb020');
    ctx.textAlign = 'left';
  }

  // hint centrale
  if (hintT > 0) {
    ctx.globalAlpha = clamp(hintT, 0, 1);
    ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center';
    const tw = ctx.measureText(hint).width;
    ctx.fillStyle = 'rgba(8,10,15,.7)';
    rr(W / 2 - tw / 2 - 18, H - 190, tw + 36, 34, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.stroke();
    ctx.fillStyle = '#ffd34d'; ctx.fillText(hint, W / 2, H - 183);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  drawMinimap();

  if (debug) {
    ctx.font = 'bold 12px ui-monospace, monospace'; ctx.fillStyle = '#9fff9f';
    ctx.fillText('fps ' + fps + '  cars ' + cars.length + '  peds ' + peds.length +
      '  fx ' + fx.length + '  heat ' + player.heat.toFixed(2), 24, H - 40);
  }
  if (showHelp && state === 'play') {
    ctx.font = '12px system-ui'; ctx.fillStyle = 'rgba(190,205,225,.6)';
    ctx.fillText('H: aiuto  M: audio  F3: debug', 24, H - 26);
  }
  ctx.restore();
}

function wrapText(txt, x, y, maxw, lh) {
  const words = txt.split(' ');
  let line = '', yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxw && line) {
      ctx.fillText(line, x, yy); yy += lh; line = w;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}

function drawMinimap() {
  const size = 190, pad = 16, sc = size / WORLD;
  const ox = W - size - pad, oy = H - size - pad;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = 'rgba(6,8,12,.72)';
  rr(0, 0, size, size, 8); ctx.fill();
  ctx.save();
  rr(0, 0, size, size, 8); ctx.clip();
  ctx.fillStyle = '#2b3138';
  ctx.strokeStyle = '#4c545f'; ctx.lineWidth = Math.max(1.4, ROADW * sc);
  ctx.beginPath();
  for (let i = 0; i * SP <= WORLD; i += 1) {
    ctx.moveTo(i * SP * sc, 0); ctx.lineTo(i * SP * sc, size);
    ctx.moveTo(0, i * SP * sc); ctx.lineTo(size, i * SP * sc);
  }
  ctx.stroke();
  // parchi
  ctx.fillStyle = '#2f5c34';
  for (const p of world.parks) ctx.fillRect(p.x * sc, p.y * sc, p.w * sc, p.h * sc);

  // rettangolo vista
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
  ctx.strokeRect(cam.x * sc, cam.y * sc, W * sc, H * sc);

  for (const c of cars) {
    if (c.kind === 'cop') { ctx.fillStyle = '#4d8dff'; }
    else if (c.marked) ctx.fillStyle = '#ffd34d';
    else continue;
    ctx.fillRect(c.x * sc - 1.5, c.y * sc - 1.5, 3.5, 3.5);
  }
  for (const g of missionTargets()) {
    ctx.fillStyle = g.col;
    ctx.beginPath(); ctx.arc(g.x * sc, g.y * sc, 3, 0, TAU); ctx.fill();
  }
  for (const k of pickups) {
    if (k.got) continue;
    ctx.fillStyle = 'rgba(255,211,77,.75)';
    ctx.fillRect(k.x * sc - 1, k.y * sc - 1, 2, 2);
  }
  // giocatore
  ctx.translate(player.x * sc, player.y * sc);
  ctx.rotate(player.a);
  ctx.fillStyle = '#7dff9b';
  ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3.5, 3.2); ctx.lineTo(-3.5, -3.2); ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1;
  rr(0, 0, size, size, 8); ctx.stroke();
  ctx.fillStyle = '#8fa0b8'; ctx.font = 'bold 10px system-ui';
  ctx.fillText('VICE CITY', 7, 5);
  ctx.restore();
}

/* ---------- render principale ---------- */
function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  const sh = cam.shake;
  const ox = sh ? rand(-sh, sh) : 0, oy = sh ? rand(-sh, sh) : 0;
  ctx.translate(-cam.x + ox, -cam.y + oy);

  drawGround();
  drawRoads();
  drawSkids();
  drawPickups();
  drawBuildings();
  drawTargets();

  // ordinamento per profondita'
  const ents = [];
  for (const c of cars) ents.push({ y: c.y, f: () => drawCar(c) });
  for (const p of peds) ents.push({ y: p.y, f: () => drawPed(p) });
  ents.push({ y: player.y, f: drawPlayer });
  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) e.f();

  drawBullets();
  drawFx();
  ctx.restore();

  drawHUD();
}

/* ===================== 11. AUDIO ===================== */
const audio = {
  ctx: null, on: true, eng: null, engGain: null, sir: null, sirGain: null,
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.eng = c.createOscillator(); this.eng.type = 'sawtooth';
      this.engGain = c.createGain(); this.engGain.gain.value = 0;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      this.eng.connect(f); f.connect(this.engGain); this.engGain.connect(c.destination);
      this.eng.start();

      this.sir = c.createOscillator(); this.sir.type = 'triangle';
      this.sirGain = c.createGain(); this.sirGain.gain.value = 0;
      this.sir.connect(this.sirGain); this.sirGain.connect(c.destination);
      this.sir.start();
    } catch (e) { this.ctx = null; }
  },
  toggle() { this.on = !this.on; if (!this.on) { if (this.engGain) this.engGain.gain.value = 0; if (this.sirGain) this.sirGain.gain.value = 0; } setHint('Audio: ' + (this.on ? 'ON' : 'OFF'), 1.4); },
  blip(freq, dur, type, vol) {
    if (!this.ctx || !this.on) return;
    try {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || .07, c.currentTime);
      g.gain.exponentialRampToValueAtTime(.0005, c.currentTime + (dur || .12));
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + (dur || .12) + .02);
    } catch (e) { }
  }
};
function sfx(kind) {
  switch (kind) {
    case 'coin': audio.blip(880, .09, 'triangle', .08); setTimeout(() => audio.blip(1320, .1, 'triangle', .06), 70); break;
    case 'accept': audio.blip(523, .12, 'square', .06); setTimeout(() => audio.blip(784, .16, 'square', .06), 110); break;
    case 'hit': audio.blip(160, .1, 'sawtooth', .08); break;
    case 'crash': audio.blip(120, .16, 'sawtooth', .1); audio.blip(70, .22, 'square', .06); break;
    case 'boom': audio.blip(60, .5, 'sawtooth', .12); break;
  }
}
function audioUpdate() {
  if (!audio.ctx || !audio.on) return;
  try {
    const c = player.car;
    const target = c && state === 'play' ? .028 + Math.min(.02, Math.abs(c.speed) / 9000) : 0;
    audio.engGain.gain.value = lerp(audio.engGain.gain.value, target, .1);
    audio.eng.frequency.value = 42 + (c ? Math.abs(c.speed) * .5 : 0);
    let near = false;
    for (const o of cars) if (o.kind === 'cop' && dist(o.x, o.y, player.x, player.y) < 430) { near = true; break; }
    audio.sirGain.gain.value = lerp(audio.sirGain.gain.value, near && player.heat > 0 ? .03 : 0, .08);
    audio.sir.frequency.value = (time % .8 < .4) ? 720 : 980;
  } catch (e) { }
}

/* ===================== 12. STATS & AVVIO ===================== */
const stats = { cars: 0, missions: 0, best: 0 };

function loadBest() { try { stats.best = +(localStorage.getItem('viceauto_best') || 0); } catch (e) { } }
function saveBest() { try { localStorage.setItem('viceauto_best', stats.best); } catch (e) { } }

// statistiche furto auto (rilevato in driveCar / enterCar)
const origEnter = enterCar;
enterCar = function (c) { stats.cars++; if (stats.cars > stats.best) { stats.best = stats.cars; saveBest(); } origEnter(c); };

function togglePause() {
  if (state === 'play') { state = 'pause'; document.getElementById('pause').classList.remove('hidden'); }
  else if (state === 'pause') { state = 'play'; document.getElementById('pause').classList.add('hidden'); }
}

// punto di partenza: sempre su una strada e mai dentro un edificio
function safeSpot(nearX, nearY) {
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 400; t++) {
    const p = randRoadPoint(0);
    if (inBuilding(p.x, p.y, 30)) continue;
    const score = nearX === undefined ? Math.random()
      : dist(p.x, p.y, nearX, nearY) + Math.random() * 120;
    if (score < bestScore) { bestScore = score; best = p; }
    if (nearX === undefined) break;
    if (bestScore < 30) break;
  }
  return best || { x: 60, y: 60 };
}

function reset() {
  genWorld();
  cars = []; peds = []; bullets = []; skids = []; fx = [];
  pickups = [];
  makePickups();
  const start = safeSpot();
  for (let i = 0; i < 22; i++) spawnCar(null, randRoadPoint(0));
  for (let i = 0; i < 40; i++) { const p = randRoadPoint(0); spawnPed(p.x, p.y); }
  // auto parcheggiata vicino al giocatore, cosi' si puo' iniziare subito
  spawnCar(null, { x: start.x + 34, y: start.y + 20 });
  player.x = start.x; player.y = start.y; player.hp = 100; player.money = 300;
  player.heat = 0; player.car = null; player.vx = 0; player.vy = 0; player.a = -Math.PI / 2;
  offer = null; mission = null; nextOfferT = 1.5;
  cam.x = clamp(player.x - W / 2, 0, WORLD - W); cam.y = clamp(player.y - H / 2, 0, WORLD - H);
}

document.getElementById('playBtn').addEventListener('click', start);
document.getElementById('resumeBtn').addEventListener('click', togglePause);
document.getElementById('respawnBtn').addEventListener('click', respawn);
document.getElementById('start').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') return; start(); });

function start() {
  if (state === 'play') return;
  audio.init();
  if (state === 'menu') {
    loadBest();
    reset();
    document.getElementById('start').classList.add('hidden');
    state = 'play';
    setHint('Benvenuto a Vice City! Sal sull\'anello giallo per una missione.', 4.5);
  } else if (state === 'pause') {
    state = 'play';
    document.getElementById('pause').classList.add('hidden');
  }
}
addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && state !== 'play' && state !== 'pause') start();
});

/* controlli touch */
if ('ontouchstart' in window) {
  const t = document.getElementById('touch');
  t.classList.remove('hidden');
  for (const b of t.querySelectorAll('.tbtn')) {
    const code = b.dataset.key;
    const map = KEYMAP[code];
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (map) { keys[map] = true; pressed[map] = true; }
    });
    const off = (e) => { e.preventDefault(); if (map) keys[map] = false; };
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  }
}

/* ---------- loop principale ---------- */
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > .05) dt = .05;           // evita esplosioni al cambio tab

  fpsAcc += dt; fpsN++;
  if (fpsAcc > .5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

  if (state !== 'pause') update(dt);
  if (state !== 'menu') render();
  clearPressed();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);