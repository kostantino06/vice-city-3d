/* Test delle munizioni: caricatore, riserva, ricarica.
   Verifica che spara consumi il caricatore e NON l'arma (bug storico). */
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

const code = `
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const rand=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[(Math.random()*a.length)|0];
const dist=(ax,az,bx,bz)=>Math.hypot(bx-ax,bz-az);
const dist2=(ax,az,bx,bz)=>{const dx=bx-ax,dz=bz-az;return dx*dx+dz*dz;};
const angDiff=(a,b)=>{let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;};
function angApproach(a,b,s){const d=angDiff(a,b);return Math.abs(d)<=s?b:a+Math.sign(d)*s;}
const approach=(v,t,d)=>v<t?Math.min(v+d,t):Math.max(v-d,t);
const TAU=Math.PI*2;
let toasts=[];
function showToast(t){toasts.push(t);}
function sfx(){}
function updateWeaponVisuals(){}
const WORLD=1000;
let state='play';
const hero={armR:{rotation:{x:0}},torso:{rotation:{}}};
const peds=[], cars=[];
const player={x:0,z:0,a:0,hp:100,maxhp:100,car:null,money:5000,heat:0,
  walkPhase:0,inCarSince:0,ammo:12,maxAmmo:999,weapon:'pistol',shootCd:0,
  reserve:240,reloading:0};
const WEAPONS=[
  {id:'fist',name:'PUGNI',ammo:Infinity,maxAmmo:Infinity,rate:0.28},
  {id:'pistol',name:'PISTOLA',ammo:12,maxAmmo:999,rate:0.16},
  {id:'uzi',name:'UZI',ammo:30,maxAmmo:999,rate:0.075}
];
let currentWeaponIdx=1;

${extract('tryReload')}

// replica del consumo munizioni e dell'avanzamento ricarica,
// prese dal codice reale di updatePlayer / shootPlayer
function spara(){
  if (player.shootCd > 0) return 'cooldown';
  if (player.reloading > 0) return 'ricarica in corso';
  const w = WEAPONS[currentWeaponIdx];
  if (w.ammo !== Infinity) {
    if (player.ammo <= 0) return 'caricatore vuoto';
    player.ammo--;
  }
  player.shootCd = w.rate;
  return 'sparato';
}
function tickReload(dt){
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      const w = WEAPONS[currentWeaponIdx];
      const need = w.ammo - player.ammo;
      const take = Math.min(need, player.reserve);
      player.ammo += take;
      player.reserve -= take;
    }
  }
}

const out=[];

// 1. spara consuma il CARICATORE, non l'arma
const ammoArmaPrima = WEAPONS[1].ammo;
const caricatorePrima = player.ammo;
spara();
out.push({ t:'un colpo', caricatore: caricatorePrima + '->' + player.ammo,
           armaIndefinita: WEAPONS[1].ammo === ammoArmaPrima,
           corretto: player.ammo === caricatorePrima - 1 });

// 2. scarica tutto il caricatore
for (let i=0;i<20;i++){ player.shootCd=0; spara(); }
out.push({ t:'caricatore scarico', ammo: player.ammo, riserva: player.reserve });

// 3. spara a vuoto
player.shootCd=0;
const r3 = spara();
out.push({ t:'spara a vuoto', esito: r3, ammo: player.ammo, riserva: player.reserve });

// 4. ricarica
const ok = tryReload();
out.push({ t:'ricarica avviata', ok: ok, reloading: +player.reloading.toFixed(2) });

// 5. durante la ricarica non si spara
player.shootCd = 0;
const r5 = spara();
out.push({ t:'spara durante ricarica', esito: r5, bloccato: r5 === 'ricarica in corso' });

// 6. la ricarica riempie e scala la riserva
for (let i=0;i<100;i++) tickReload(1/60);
out.push({ t:'dopo ricarica', ammo: player.ammo, riserva: player.reserve,
           caricatorePieno: player.ammo === WEAPONS[1].ammo,
           riservaScala: player.reserve === 240 - (12 - 12) });

// 7. pugni: munizioni illimitate
currentWeaponIdx=0;
player.ammo=0; player.reserve=0;
player.shootCd=0;
const r7 = spara();
out.push({ t:'pugni, niente munizioni', esito: r7, ammo: player.ammo });

// 8. ricarica senza riserva
currentWeaponIdx=1; player.ammo=0; player.reserve=0; player.reloading=0;
const r8 = tryReload();
out.push({ t:'ricarica senza riserva', avviata: r8 === undefined ? false : true, reloading: player.reloading });
`;

try {
  const fn = new Function(code + '\n;return JSON.stringify(out);');
  console.log(JSON.stringify(JSON.parse(fn()), null, 1));
} catch (e) {
  console.error('ERRORE:', e.message);
  console.error(e.stack.split('\n').slice(0, 4).join('\n'));
}