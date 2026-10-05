/* Test dei pedoni: attraversamento alle strisce e nessun blocco.
   Estrae le funzioni reali dal sorgente di game3d.js. */
const fs = require('fs');
const src = fs.readFileSync('./game3d.js', 'utf8');

function extract(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('non trovata: ' + name);
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (ch === '{') { d++; started = true; }
    else if (ch === '}') { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error('graffe: ' + name);
}

const BLOCK = 80, ROADW = 17, WORLD = 1000;
const code = `
const BLOCK=80, ROADW=17, WORLD=1000;   // valori reali da game3d.js
const PED_KERB_LIM = BLOCK / 2 - ROADW / 2;   // = 31.5, come nel sorgente
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const dist=(ax,az,bx,bz)=>Math.hypot(bx-ax,bz-az);
const dist2=(ax,az,bx,bz)=>{const dx=bx-ax,dz=bz-az;return dx*dx+dz*dz;};
const angDiff=(a,b)=>{let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;};
const rand=(a,b)=>a+Math.random()*(b-a);
const approach=(v,t,d)=>v<t?Math.min(v+d,t):Math.max(v-d,t);
function angApproach(a,b,step){const d=angDiff(a,b);return Math.abs(d)<=step?b:a+Math.sign(d)*step;}
function pickTurn(a){const r=Math.random();if(r<0.55)return a;if(r<0.79)return a+Math.PI/2;if(r<0.96)return a-Math.PI/2;return a+Math.PI;}
const pushOut=()=>false;
// replica fedele di snapLane dal sorgente
function snapLane(o, lane) {
  const fx = Math.abs(((o.x + BLOCK/2) % BLOCK) - BLOCK/2);
  const fz = Math.abs(((o.z + BLOCK/2) % BLOCK) - BLOCK/2);
  if (Math.abs(fz) < BLOCK/2 - ROADW/2 + 0.01) {
    const gi = Math.round(o.z / BLOCK) * BLOCK;
    o.z = clamp(o.z, gi - ROADW/2 + lane, gi + ROADW/2 - lane);
  } else {
    const gi = Math.round(o.x / BLOCK) * BLOCK;
    o.x = clamp(o.x, gi - ROADW/2 + lane, gi + ROADW/2 - lane);
  }
}
const cars=[];
const player={x:9999,z:9999,car:null};   // lontano: i pedoni non scappano
${extract('pedRoadInfo')}
${extract('trafficComing')}
${extract('updatePed')}

const out=[];

// 1. semantica di pedRoadInfo
const sem = i => ({ onRoad:i.onRoad, kerb:+i.kerbDist.toFixed(1) });
out.push({ t:'centro strada', ...sem(pedRoadInfo(0, 0)) });
out.push({ t:'bordo strada', ...sem(pedRoadInfo(31, 0)) });
out.push({ t:'marciapiede', ...sem(pedRoadInfo(36, 0)) });
out.push({ t:'isolato', ...sem(pedRoadInfo(40, 40)) });

// 2. un pedone deve camminare avanti (non restare fermo)
const mk = (x,z,a) => ({ x, z, a, speed:0, walk:0, panic:0, idle:0, down:0,
  vx:0, vz:0, ni:-1, nj:-1, turn:null, respawn:0, skin:0,hair:0,shirt:0,pants:0 });
const p = mk(36, 20, 0);      // sul marciapiede
let percorso = 0, lastX = p.x, lastZ = p.z, rallenti = 0;
for (let i = 0; i < 3600; i++) {   // 60 secondi
  updatePed(p, 1/60);
  percorso += Math.hypot(p.x - lastX, p.z - lastZ);
  lastX = p.x; lastZ = p.z;
  if (p.speed < 2) rallenti++;
}
out.push({ t:'60s cammino', percorso:+percorso.toFixed(0),
           frameRallentato: rallenti,
           neiLimiti: p.x>4 && p.x<WORLD-4 && p.z>4 && p.z<WORLD-4,
           velMedia: +(percorso/60).toFixed(2) });

// 3. nessun NaN
const nan = [p.x,p.z,p.a,p.speed].some(v=>!Number.isFinite(v));

// 4. trafficComing
cars.length = 0;
cars.push({ x:100, z:0, a:0, speed:20, burning:false });   // corre verso +Z
out.push({ t:'auto in avvicinamento', rilevata: trafficComing(100, 25, 40) });
out.push({ t:'auto in allontanamento', rilevata: trafficComing(100, -25, 40) });
`;

try {
  const fn = new Function(code + '\n;return JSON.stringify({ out: out, nan: nan });');
  console.log(fn());
} catch (e) {
  console.error('ERRORE:', e.message);
  console.error(e.stack.split('\n').slice(0, 4).join('\n'));
}