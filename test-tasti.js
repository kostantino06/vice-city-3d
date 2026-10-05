/* Verifica i conflitti fra tasti: ogni tasto deve fare UNA cosa sola.
   Esegue il codice reale dei gestori ricostruendo la catena di if. */
const fs = require('fs');
const src = fs.readFileSync('./game3d.js', 'utf8');

//estrae il blocco keydown del gioco reale
const i = src.indexOf("addEventListener('keydown'");
if (i < 0) throw new Error('keydown non trovato');
let d = 0, started = false, end = -1;
for (let k = i; k < src.length; k++) {
  const ch = src[k];
  if (ch === '{') { d++; started = true; }
  else if (ch === '}') { d--; if (started && d === 0) { end = k + 1; break; } }
}
/* Estrae SOLO il corpo del gestore: dal `{` che segue la firma
   addEventListener(..., { fino alla sua chiusura. Prendere tutto il blocco
   si portererebbe dentro anche il codice aggiunto dopo il listener. */
const bodyStart = src.indexOf('{', src.indexOf("addEventListener('keydown'"));
let dd = 0, st = false, bodyEnd = -1;
for (let k = bodyStart; k < src.length; k++) {
  const ch = src[k];
  if (ch === '{') { dd++; st = true; }
  else if (ch === '}') { dd--; if (st && dd === 0) { bodyEnd = k + 1; break; } }
}
if (bodyEnd < 0) throw new Error('corpo keydown non chiuso');
// Neutralizza i ${...} del blocco reale: verrebbero valutati come
// interpolazione del template literal che lo contiene.
const keydown = src.slice(bodyStart, bodyEnd).replace(/\$\{/g, '$\\{');

const code = `
const KM = {
  KeyW:'up',ArrowUp:'up',KeyS:'down',ArrowDown:'down',
  KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',
  Space:'brake',ShiftLeft:'boost',ShiftRight:'boost',
  KeyJ:'shoot',ControlLeft:'shoot',ControlRight:'shoot',
  KeyV:'jump',AltLeft:'jump',AltRight:'jump'
};
let state='play', shopOpen=false, isDev=false, camMode=0, timePhase=0;
let currentWeaponIdx=1;
const keys={}, pressed={};
let player={car:null, reloading:0, ammo:7, reserve:40};
const WEAPONS=[{id:'fist',name:'PUGNI',ammo:Infinity},{id:'pistol',name:'PISTOLA',ammo:12}];
const shopSpots=[], dist=()=>99;
// traccia tutto quello che i gestori provocano
let log=[];
function record(x){ log.push(x); }
function tryReload(){ record('ricarica'); player.reloading=1.3; }
function showToast(t){ record('toast:'+t); }
/* audio e' un OGGETTO nel gioco reale: prevStation / nextStation / toggle.
   Va dichiarato come const-oggetto, non come funzione. */
const audio = {
  prevStation(){ record('radio-prev'); },
  nextStation(){ record('radio-next'); },
  toggle(){ record('audio-toggle'); },
  init(){}, ctx:null, nextStepTime:0, currentTime:0, state:'running', resume(){}
};
function openShop(){ shopOpen=true; record('negozio-aperto'); }
function closeShop(){ shopOpen=false; record('negozio-chiuso'); }
function togglePause(){ state = state==='pause' ? 'play' : 'pause'; record('pausa'); }
function shootPlayer(){ record('sparo'); }
function respawn(){ record('respawn'); }
function saveGame(){ record('salva'); }
function start(){ record('start'); }
function selectWeapon(i){ currentWeaponIdx=i; record('arma'+i); }
function setTimePhase(p){ timePhase=p; record('fase'+p); }
function sfx(){}

function press(code){
  log=[];
  const e = {
    code, preventDefault(){}, ctrlKey:false, metaKey:false, shiftKey:false,
    target:{tagName:'CANVAS'}
  };
  ${keydown}
  /* fine corpo reale */
  const k = KM[e.code];
  if (k) { keys[k]=true; pressed[k]=true; }
  return log;
}

const out=[];

// 1. V = solo salto, NON radio
out.push({ tasto:'V', effetti: press('KeyV'), atteso:['ricarica?'].slice(0,0) });

// 2. Q = solo radio
out.push({ tasto:'Q', effetti: press('KeyQ') });

// 3. R durante il gioco = ricarica, niente respawn
out.push({ tasto:'R (in gioco)', effetti: press('KeyR'), stato: state });

// 4. R a schermo WASTED = respawn
state='wasted';
out.push({ tasto:'R (wasted)', effetti: press('KeyR'), stato: state });
state='play';

// 5. Spazio a piedi = sparo
player.car=null;
out.push({ tasto:'Spazio (a piedi)', effetti: press('Space') });

// 6. Spazio in auto = nessuno sparo
player.car={x:0,z:0,a:0};
out.push({ tasto:'Spazio (in auto)', effetti: press('Space') });
player.car=null;

// 7. E lontano dal negozio = solo radio
out.push({ tasto:'E (lontano)', effetti: press('KeyE'), negozio: shopOpen });

// 8. E vicino al negozio = apre, e NON cambia radio
shopSpots.length=0; shopSpots.push({x:0,z:0}); player.x=0; player.z=0;
out.push({ tasto:'E (vicino)', effetti: press('KeyE'), negozio: shopOpen });

// 9. Escape col negozio aperto = chiude solo, niente pausa
shopOpen=true;
out.push({ tasto:'Escape (negozio aperto)', effetti: press('Escape'), stato: state, negozio: shopOpen });

// 10. Escape senza negozio = pausa
shopOpen=false;
out.push({ tasto:'Escape (normale)', effetti: press('Escape'), stato: state });

// 11. Invio nel menu = start
state='menu';
out.push({ tasto:'Invio (menu)', effetti: press('Enter') });
state='play';

return JSON.stringify(out);
`;

try {
  const fn = new Function(code);
  console.log(JSON.stringify(JSON.parse(fn()), null, 1));
} catch (e) {
  // lascia il codice generato su disco: node --check lo puo' validare
  fs.writeFileSync('./_generato.js', code);
  console.error('ERRORE:', e.message);
  console.error(e.stack.split('\n').slice(0, 5).join('\n'));
}