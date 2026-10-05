/* Test deterministico della fisica di guida (Node, senza browser).
   Estrae driveCar + le sue dipendenze dal sorgente reale di game3d.js,
   così si testa il codice che gira davvero, non una copia. */
const fs = require('fs');
const src = fs.readFileSync('./game3d.js', 'utf8');

//estrae una funzione per nome (con bilanciamento graffe)
function extract(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('funzione non trovata: ' + name);
  let d = 0, started = false;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (ch === '{') { d++; started = true; }
    else if (ch === '}') { d--; if (started && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error('graffe non bilanciate: ' + name);
}

// ambiente minimo
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; return dx * dx + dz * dz; };
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const WORLD = 1000;
const keys = {};
const axis = (n) => keys[n] ? 1 : 0;

const cars = [], peds = [];
let camShake = 0;
const player = { hp: 100, money: 300, heat: 0, car: null };
const noop = () => {};
const scene = {
  addWanted: noop, spawnParticles: noop, sfx: noop, addFloater: noop,
  damageCar: noop, pushOut: (o) => { o.pushHits = (o.pushHits || 0); return false; }
};

// iniettiamo le funzioni estratte nel contesto
const parts = ['driveCar'].map(extract);
const code = `
const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
const dist2 = (ax,az,bx,bz)=>{const dx=bx-ax,dz=bz-az;return dx*dx+dz*dz;};
const angDiff=(a,b)=>{let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;};
const rand=(a,b)=>a+Math.random()*(b-a);
const damp=(a,b,l,dt)=>a+(b-a)*(1-Math.exp(-l*dt));
const WORLD=1000;
const keys={};
const axis=(n)=>keys[n]?1:0;
const cars=[], peds=[];
let camShake=0;
const player={hp:100,money:300,heat:0,car:null,mx:100};
const addWanted=()=>{}, spawnParticles=()=>{}, sfx=()=>{}, addFloater=()=>{};
const damageCar=()=>{};
const pushOut=(o)=>false;
const redLightAhead=()=>false;
${parts.join('\n')}
${extract('driveCar')}
// ---- test ----
function mkCar(){
  return {
    x:500,z:500,a:0,speed:0,slip:0,roll:0,pitch:0,lastSpeed:0,
    hp:100,maxhp:100,isCop:false,type:'sedan',
    isMoto:false,isChopper:false,isTaxi:false,isVan:false,isAmbulance:false,isSuper:false,
    // mesh.g.position serve alla sospensione (driveCar scrive y = -suspY),
    // sospY/suspVY/mass servono alla molla: senza questi il test falliva.
    suspY:0,suspVY:0,mass:1350,
    driver:null,mesh:{g:{position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0}},wheels:[]}
  };
}
const out=[];
const c=mkCar();
cars.push(c);

// 1. accelerazione: 4 secondi di gas, deve stabilizzarsi vicino alla max
c.speed=0;
keys.up=true;
for(let i=0;i<240;i++) driveCar(c,1/60);
out.push({t:'gas 4s', v:+c.speed.toFixed(1), slip:+c.slip.toFixed(3)});

// 1b. rilascio del gas: deve perdere velocita' gradualmente, non di colpo
for(const k in keys) keys[k]=false;
const vPrima = c.speed;
for(let i=0;i<30;i++) driveCar(c,1/60);
out.push({t:'rilascio 0.5s', da:+vPrima.toFixed(1), a:+c.speed.toFixed(1)});

// riprendi per il resto del test
c.speed=25;
for(const k in keys) keys[k] = false;
g_keys_up();
function g_keys_up(){ keys.up = true; }
for(let i=0;i<30;i++) driveCar(c,1/60);
out.push({t:'rettilineo', v:+c.speed.toFixed(1), slip:+c.slip.toFixed(3), roll:+c.roll.toFixed(3)});

// 2. curva a destra: deve comparire derapata
keys.right=true;
for(let i=0;i<45;i++) driveCar(c,1/60);
out.push({t:'curva', v:+c.speed.toFixed(1), slip:+c.slip.toFixed(2), roll:+c.roll.toFixed(3), a:+c.a.toFixed(2)});

// 3. Frenata a mano: derapata piu' accentuata
keys.brake=true;
for(let i=0;i<40;i++) driveCar(c,1/60);
out.push({t:'handbrake', v:+c.speed.toFixed(1), slip:+c.slip.toFixed(2)});

for(const k in keys) keys[k]=false;

// 4. Frenata forte: il roll/pitch devono essere piccoli e non superare i limiti
const c2=mkCar();
c2.speed=30;
for(let i=0;i<30;i++) driveCar(c2,1/60);
keys.down=true;
for(let i=0;i<30;i++) driveCar(c2,1/60);
out.push({t:'frenata', v:+c2.speed.toFixed(1), pitch:+c2.pitch.toFixed(3), slip:+c2.slip.toFixed(2)});
for(const k in keys) keys[k]=false;
`;

try {
  const fn = new Function(code + '\n;return JSON.stringify({ out:out, nan:[c.x,c.z,c.a,c.speed,c.slip,c.roll].some(v=>!Number.isFinite(v)) });');
  const res = fn();
  console.log(res);
} catch (e) {
  console.error('ERRORE:', e.message);
  console.error(e.stack.split('\n').slice(0, 5).join('\n'));
}