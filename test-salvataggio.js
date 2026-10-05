/* Test del salvataggio senza browser: simula localStorage ed esegue le
   funzioni reali estratte da game3d.js. */
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
// --- stub di localStorage ---
const _store = {};
const localStorage = {
  getItem: k => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: k => { delete _store[k]; }
};
// --- stato di gioco finto ma fedele ---
const SAVE_KEY = 'vicecity3d_save_v1';
const SAVE_VERSION = 1;
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const rand=(a,b)=>a+Math.random()*(b-a);
let toasts = [];
function showToast(t){ toasts.push(t); }
let markerGo={visible:false}, markerBlue={visible:false}, markerOffer={position:{set(){}}, visible:false};
const WEAPONS=[{name:'A'},{name:'B'}];
function updateWeaponVisuals(){}
const TIME_ORDER=['day','dusk','night'];
function setTimePhase(i){ timePhase=i; }
const player={x:10,z:20,a:1,hp:75,maxhp:100,car:null,money:300,heat:0,
  walkPhase:0,inCarSince:0,ammo:120,maxAmmo:999,weapon:'pistol',shootCd:0};
const stats={cars:0,best:0,packagesFound:0,missions:0};
let ownedWeapons = new Set([0,1]);   // armi possedute (usata da serializeGame)
// missioni: dichiarate PRIMA delle funzioni per evitare TDZ
let mission=null, offer=null, currentWeaponIdx=1, timePhase=1;
const TIME_ORDER2=['day','dusk','night'];

${extract('serializeGame')}
${extract('saveGame')}
${extract('hasSave')}
${extract('deleteSave')}
${extract('loadGame')}

// ---- test ----
const out=[];
deleteSave();
out.push({ t:'all inizio, no salvataggio', esiste: hasSave() });

// salvo con valori noti
player.money=4242; stats.cars=7; stats.packagesFound=3; player.x=111; player.z=222;
stats.missions = 2;
let errSave2 = null;
try { saveGame(true); } catch(e) { errSave2 = e.message; }
out.push({ t:'primaSalvataggio', err: errSave2 });
out.push({ t:'dopo salvataggio', esiste: hasSave(), byte: (_store[SAVE_KEY]||'').length });

// leggo il contenuto grezzo
let d = null, errSave = null;
try { d = JSON.parse(_store[SAVE_KEY]); } catch (e) { errSave = e.message; }
out.push({ t:'primaDop', store: _store[SAVE_KEY] ? 'presente' : 'VUOTO', err: errSave });
out.push({ t:'contenuto', versione:d&&d.v, soldi:d&&d.player&&d.player.money, auto:d&&d.stats&&d.stats.cars,
           pacchetti:d&&d.stats&&d.stats.packagesFound, x:d&&d.player&&d.player.x, z:d&&d.player&&d.player.z });

// azzero e ricarico
player.money=0; stats.cars=0; stats.packagesFound=0; player.x=0; player.z=0;
const ok = loadGame();
out.push({ t:'dopo caricamento', ok:ok, soldi:player.money, auto:stats.cars,
           pacchetti:stats.packagesFound, x:player.x, z:player.z });

// armi possedute vengono salvate
ownedWeapons = new Set([0,1,2]);
saveGame(true);
const rawArmi = _store[SAVE_KEY];
out.push({ t:'armi salvate', presente: !!rawArmi,
           valore: rawArmi ? JSON.parse(rawArmi).ownedWeapons : null });

// missione in corso: deve riprendersi
player.money=999;
mission={type:'goto',reward:700,desc:'Consegna',t:30,tx:300,tz:400};
saveGame(true);
mission=null;
loadGame();
out.push({ t:'missione ripresa', tipo: mission && mission.type, reward: mission && mission.reward,
           tx: mission && mission.tx, tz: mission && mission.tz });

// missione con veicolo: non deve riprendersi (romperebbe i riferimenti)
mission={type:'steal',reward:800,desc:'Furto',t:0,car:{x:1,z:2}};
saveGame(true);
mission=null;
loadGame();
out.push({ t:'missione steal azzerata', missioneNulla: mission === null });

// salvataggio corrotto: non deve far crashare
localStorage.setItem(SAVE_KEY, '{rotta');
out.push({ t:'file corrotto, hasSave', esiste: hasSave() });
let crashed=false;
try { loadGame(); } catch(e) { crashed=true; }
out.push({ t:'file corrotto, loadGame non crasha', ok: !crashed });

JSON.stringify(out);
`;

try {
  const fn = new Function(code + '\n;return JSON.stringify(out);');
  console.log(fn());
} catch (e) {
  console.error('ERRORE:', e.message);
  console.error(e.stack.split('\n').slice(0, 4).join('\n'));
}