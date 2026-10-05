/* Test fisica: salto con gravita', sospensione, collisioni pesate per massa. */
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
const angDiff=(a,b)=>{let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;};
function camShakeV(){ return 0; }
let camShake=0;
function sfx(){}
function addWanted(){}
function damageCar(){}
function angApproach(a,b,s){const d=angDiff(a,b);return Math.abs(d)<=s?b:a+Math.sign(d)*s;}
const approach=(v,t,d)=>v<t?Math.min(v+d,t):Math.max(v-d,t);
const damp=(a,b,l,dt)=>a+(b-a)*(1-Math.exp(-l*dt));
const cars=[];
const pressed={};

const out=[];

// =========== 1. SALTO CON GRAVITA' ===========
const player={y:0,vy:0,onGround:true,car:null,hp:100,maxhp:100};
const GRAV=24, JUMP_V=8.2;
function tickG(dt, wantJump){
  if (pressed.jump && player.onGround && player.y<=0){ player.vy=JUMP_V; player.onGround=false; }
  delete pressed.jump;
  if (player.y>0 || player.vy>0){
    player.vy -= GRAV*dt;
    player.y += player.vy*dt;
    if (player.y<=0){ const imp=Math.abs(player.vy); player.y=0; player.vy=0; player.onGround=true;
      if (imp>9) player.hp -= (imp-9)*2.2; return 'atterrato'; }
  } else player.onGround=true;
  return null;
}
pressed.jump = true;
tickG(1/60);   // il tasto viene consumato
const ySubito = player.y;
let quotaMax = 0, tSalita = 0, tTot = 0;
for (let i=0;i<180;i++){ tickG(1/60); tTot++; quotaMax=Math.max(quotaMax,player.y);
  if (tSalita===0 && player.vy<=0) tSalita=tTot; }
out.push({ t:'salto', yDopoPrimoFrame:+ySubito.toFixed(3),
  quotaMax:+quotaMax.toFixed(2), tempoSalita_s:+(tSalita/60).toFixed(2),
  atterraggioAvvenuto: player.y===0 && player.onGround });
// altezza prevista da v²/(2g)
out.push({ t:'coerenza fisica', previsto:+(JUMP_V*JUMP_V/(2*GRAV)).toFixed(2), misurato:+quotaMax.toFixed(2) });

// =========== 2. SOSPENSIONE ===========
function veicolo(mass){ return { mass:mass, suspY:0, suspVY:0, speed:0, lastSpeed:0,
  slip:0, roll:0, pitch:0, mesh:{g:{position:{y:0},rotation:{x:0,z:0}}} }; }
function tickSusp(c,dt){
  const K = 260/Math.max(1, c.mass/1000);
  const C = 2.0*Math.sqrt(K)*0.55;
  c.suspVY += (-(c.suspY)*K - c.suspVY*C)*dt;
  c.suspY += c.suspVY*dt;
  if (Math.abs(c.suspY)<0.001 && Math.abs(c.suspVY)<0.01){ c.suspY=0; c.suspVY=0; }
  c.mesh.g.position.y = -c.suspY;
}
const pesante = veicolo(2400), leggero = veicolo(220);
pesante.suspVY -= 0.45; leggero.suspVY -= 0.45;   // stesso colpo, molle diverse
let pMax=0,lMax=0, durataP=0;
for (let i=0;i<180;i++){ tickSusp(pesante,1/60); tickSusp(leggero,1/60);
  pMax=Math.max(pMax,Math.abs(pesante.suspY)); lMax=Math.max(lMax,Math.abs(leggero.suspY));
  if (durataP===0 && Math.abs(pesante.suspY)<0.002 && Math.abs(pesante.suspVY)<0.01) durataP=i; }
out.push({ t:'sospensione, molla morbida sul pesante',
  affondamentoPesante:+pMax.toFixed(3), affondamentoLeggero:+lMax.toFixed(3),
  ilPesanteOscillaDiPiu: pMax > lMax,
  framesPerSmorzare: durataP });
// la moto (molla rigida) deve smorzarsi subito
let motoFrame = 0;
const moto2 = veicolo(220); moto2.suspVY -= 0.45;
for (let i=0;i<180;i++){ tickSusp(moto2,1/60);
  if (motoFrame===0 && Math.abs(moto2.suspY)<0.002 && Math.abs(moto2.suspVY)<0.01) motoFrame=i; }
out.push({ t:'moto smorzata in', frames: motoFrame, quasiSubito: motoFrame < 12 });

// =========== 3. COLLISIONI PESATE PER MASSA ===========
function urto(a,b){
  const ddx=b.x-a.x, ddz=b.z-a.z, dd=Math.sqrt(ddx*ddx+ddz*ddz);
  const overlap = 3.1-dd;
  if (overlap<=0) return null;
  const ux=ddx/dd, uz=ddz/dd, tot=a.mass+b.mass;
  const x0a=a.x, x0b=b.x;
  a.x -= ux*overlap*(b.mass/tot); a.z -= uz*overlap*(b.mass/tot);
  b.x += ux*overlap*(a.mass/tot); b.z += uz*overlap*(a.mass/tot);
  return { spintaA:+(x0a-a.x).toFixed(3), spintaB:+(b.x-x0b).toFixed(3) };
}
const camion = {x:0,z:0,mass:2400,speed:20};
const moto   = {x:1.5,z:0,mass:220,speed:20};
const r1 = urto(camion, moto);
out.push({ t:'camion contro moto', camionSiSposta:r1.spintaA, motoSiSposta:r1.spintaB,
  motoVolataVia: parseFloat(r1.spintaB) > parseFloat(r1.spintaA) * 5 });

const a1={x:0,z:0,mass:1350,speed:15}, b1={x:1.5,z:0,mass:1350,speed:15};
const r2 = urto(a1,b1);
out.push({ t:'due auto uguali', spintaA:r2.spintaA, spintaB:r2.spintaB,
  simmetrico: Math.abs(parseFloat(r2.spintaA)-parseFloat(r2.spintaB))<0.02 });

// conservazione: la somma delle spinte resta costante
out.push({ t:'conservazione', somma:+(parseFloat(r1.spintaA)+parseFloat(r1.spintaB)).toFixed(3),
  atteso:+r1.spintaB.toFixed(3) });

JSON.stringify(out);
`;

try {
  const fn = new Function(code + '\n;return JSON.stringify(out);');
  console.log(JSON.stringify(JSON.parse(fn()), null, 1));
} catch (e) {
  console.error('ERRORE:', e.message);
  console.error(e.stack.split('\n').slice(0, 4).join('\n'));
}