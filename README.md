# Vice City 3D

Gioco open-world in stile GTA, scritto in Three.js. Gira nel browser, nessuna installazione.

## Avvio

```
AVVIA_GIOCO.bat
```

Oppure a mano:

```
node server.js
```

Poi apri `http://localhost:8080`. Serve Node solo per il server statico: il gioco in
sè non ha dipendenze da installare, Three.js arriva dal CDN via importmap.

## Comandi

| Tasto | Azione |
|---|---|
| W A S D / frecce | Guida e movimento |
| **V** | Salta (a piedi) |
| **F** | Entra / esci dal veicolo |
| **R** | Ricarica l'arma |
| Click | Spari |
| 1-5 | Cambia arma |
| E | Negozio Armory (vicino all'insegna) |
| Q / E | Stazione radio precedente / successiva |
| T | Ciclo giorno / sera / notte |
| C | Cambia telecamera |
| H | Clacson, sirena sulle ambulanze |
| F5 / Ctrl+S | Salva la partita |
| P / Esc | Pausa |

## Fisica

Non è un modello "a feel". I valori sono scelti e verificati:

- **Salto** con gravità 24 m/s² e spinta 8.2 m/s. Quota massima 1.33m, coerente con
  `v²/2g`. Atterraggio sopra 9 m/s fa danno.
- **Sospensione** a molla smorzata tarata sulla massa: il camion ha molla morbia
  (K=108, 1.66 Hz) e oscilla di più, la moto rigida (K=1182, 5.47 Hz) e smorza subito.
- **Collisioni pesate** per massa, non 50/50. Un camion contro una moto scaglia la
  moto ~11 volte più lontano.
- **Velocità laterale** separata da quella longitudinale, con resistenza aerodinamica.

## Test

I test estraggono le funzioni reali dal gioco e le verificano in Node:

```
node test-fisica2.js     # salto, sospensione, collisioni pesate
node test-munizioni.js   # caricatore, riserva, ricarica
node test-tasti.js       # conflitti fra tasti
node test-fisica.js      # accelerazione, drag, deriva, handbrake
node test-pedoni.js      # comportamento pedoni
node test-salvataggio.js # serialize / load
```

Il motivo per cui stanno in Node e non nel browser: il browser sospende
`requestAnimationFrame` quando la scheda non è in primo piano, e i test temporali
congelerebbero.

## Struttura

- `vice3d.html` — pagina, HUD, overlay
- `game3d.js` — tutto il gioco
- `styles.css` — HUD e menu
- `server.js` — server statico
- `test-*.js` — test

Nota: `three3d.js` è escluso di proposito. Era un placeholder mai usato.