/**
 * Debug Tools per BrawlLite
 * Strumenti per diagnosticare e risolvere problemi di rendering
 */

// Variabili per riferimenti agli oggetti di gioco
let _app = null;
let _gameState = null;
let _PIXI = null;

// Funzione per inizializzare il debugger con riferimenti corretti
window.initBrawlDebugger = function(appRef, gameStateRef, pixiRef) {
  console.log('Debugger inizializzato con riferimenti esterni');
  _app = appRef;
  _gameState = gameStateRef;
  _PIXI = pixiRef || window.PIXI;
  
  // Inizializza gli strumenti di debug dopo aver ricevuto i riferimenti
  initDebugTools();
  
  return {
    diagnosi: debugBrawlLite,
    ricreaContainers: recreateContainers,
    fixEnergy: fixEnergyPoints
  };
};

// Funzione principale di diagnosi
function debugBrawlLite() {
  console.log('===== DIAGNOSI BRAWLLITE =====');
  
  // Controlla app PixiJS
  if (_app) {
    console.log('✅ app PixiJS trovata');
    console.log('- Tipo renderer:', _app.renderer.type === 0 ? 'WebGL' : 'Canvas');
    console.log('- Dimensioni:', _app.screen.width, 'x', _app.screen.height);
    console.log('- Children in stage:', _app.stage.children.length);
  } else {
    console.error('❌ app PixiJS non trovata');
  }
  
  // Controlla gameState
  if (_gameState) {
    console.log('✅ gameState trovato');
    console.log('- Players:', _gameState.players ? _gameState.players.size : 0);
    console.log('- EnergyPoints:', _gameState.energyPoints ? _gameState.energyPoints.size : 0);
    
    if (_gameState.containers) {
      console.log('✅ containers trovati');
      
      if (_gameState.containers.energy) {
        console.log('✅ energy container trovato');
        console.log('- visible:', _gameState.containers.energy.visible);
        console.log('- children:', _gameState.containers.energy.children.length);
      } else {
        console.error('❌ energy container non trovato');
      }
      
      if (_gameState.containers.players) {
        console.log('✅ players container trovato');
        console.log('- visible:', _gameState.containers.players.visible);
        console.log('- children:', _gameState.containers.players.children.length);
      } else {
        console.error('❌ players container non trovato');
      }
    } else {
      console.error('❌ containers non trovati');
    }
  } else {
    console.error('❌ gameState non trovato');
  }
  
  // Controlla texture
  if (_PIXI) {
    console.log('✅ PIXI trovato');
    
    if (_PIXI.Loader && _PIXI.Loader.shared && _PIXI.Loader.shared.resources) {
      console.log('✅ Loader risorse trovato');
      
      if (_PIXI.Loader.shared.resources.player && _PIXI.Loader.shared.resources.player.texture) {
        console.log('✅ Texture player trovata');
      } else {
        console.error('❌ Texture player non trovata');
      }
      
      if (_PIXI.Loader.shared.resources.energy && _PIXI.Loader.shared.resources.energy.texture) {
        console.log('✅ Texture energy trovata');
      } else {
        console.error('❌ Texture energy non trovata');
      }
    } else {
      console.error('❌ Loader risorse non trovato');
    }
  } else {
    console.error('❌ PIXI non trovato');
  }
  
  // Crea elementi di test
  createTestElements();
  
  console.log('===== FINE DIAGNOSI =====');
}

// Crea elementi di test per verificare il rendering
function createTestElements() {
  console.log('Creazione elementi test...');
  
  if (!_app || !_app.stage) {
    console.error('❌ Impossibile creare elementi test: app o stage non disponibili');
    return;
  }
  
  // Aggiungi un contenitore di test
  const testContainer = new _PIXI.Container();
  testContainer.position.set(_app.screen.width / 2, _app.screen.height / 2);
  _app.stage.addChild(testContainer);
  
  // Aggiungi un cerchio rosso come punto di riferimento
  const reference = new _PIXI.Graphics();
  reference.beginFill(0xff0000);
  reference.drawCircle(0, 0, 10);
  reference.endFill();
  testContainer.addChild(reference);
  
  // Aggiungi un cerchio verde come "energia"
  const testEnergy = new _PIXI.Graphics();
  testEnergy.beginFill(0x00ff00);
  testEnergy.drawCircle(50, 0, 15);
  testEnergy.endFill();
  testContainer.addChild(testEnergy);
  
  // Aggiungi un cerchio blu come "giocatore"
  const testPlayer = new _PIXI.Graphics();
  testPlayer.beginFill(0x0000ff);
  testPlayer.drawCircle(-50, 0, 20);
  testPlayer.endFill();
  testContainer.addChild(testPlayer);
  
  console.log('✅ Elementi test creati al centro dello schermo');
  
  // Crea testo informativo
  const testText = new _PIXI.Text('TEST RENDERING', {
    fontFamily: 'Arial',
    fontSize: 16,
    fill: 0xffffff,
    align: 'center'
  });
  testText.anchor.set(0.5);
  testText.y = -50;
  testContainer.addChild(testText);
  
  return testContainer;
}

// Funzione per ricreare container e inizializzare nuovi oggetti
function recreateContainers() {
  if (!_app || !_gameState) {
    console.error('❌ app o gameState non disponibili');
    return;
  }
  
  console.log('Ricreazione containers...');
  
  // Rimuovi container esistenti
  if (_gameState.containers) {
    Object.values(_gameState.containers).forEach(container => {
      if (container && container.parent) {
        container.parent.removeChild(container);
      }
    });
  }
  
  // Ricrea i container
  _gameState.containers = {
    energy: new _PIXI.Container(),
    players: new _PIXI.Container(),
    effects: new _PIXI.Container(),
    debug: new _PIXI.Container()
  };
  
  // Assicurati che siano visibili
  Object.values(_gameState.containers).forEach(container => {
    container.visible = true;
    _app.stage.addChild(container);
  });
  
  console.log('✅ Container ricreati e aggiunti allo stage');
  
  // Ricrea alcuni elementi energia di test
  for (let i = 0; i < 5; i++) {
    const energy = new _PIXI.Graphics();
    energy.beginFill(0x00ff88);
    energy.drawCircle(0, 0, 10);
    energy.endFill();
    energy.position.set(
      Math.random() * _app.screen.width,
      Math.random() * _app.screen.height
    );
    _gameState.containers.energy.addChild(energy);
  }
  
  // Ricrea un giocatore di test
  const player = new _PIXI.Graphics();
  player.beginFill(0x3498db);
  player.drawCircle(0, 0, 20);
  player.endFill();
  player.position.set(_app.screen.width / 2, _app.screen.height / 2);
  _gameState.containers.players.addChild(player);
  
  console.log('✅ Oggetti test creati');
}

// Funzione di ripristino fallback per energy points
function fixEnergyPoints() {
  if (!_app || !_gameState) {
    console.error('❌ app o gameState non disponibili');
    return;
  }
  
  console.log('Tentativo di ripristino energy points...');
  
  // Pulisci container energia
  if (_gameState.containers && _gameState.containers.energy) {
    _gameState.containers.energy.removeChildren();
  } else {
    _gameState.containers = _gameState.containers || {};
    _gameState.containers.energy = new _PIXI.Container();
    _app.stage.addChild(_gameState.containers.energy);
  }
  
  // Pulisci la mappa energy points
  if (_gameState.energyPoints) {
    _gameState.energyPoints.clear();
  } else {
    _gameState.energyPoints = new Map();
  }
  
  // Crea nuovi energy points semplici
  const pointsCount = 20;
  for (let i = 0; i < pointsCount; i++) {
    const graphics = new _PIXI.Graphics();
    graphics.beginFill(0xf1c40f);
    graphics.drawCircle(0, 0, 10);
    graphics.endFill();
    
    const x = Math.random() * _app.screen.width;
    const y = Math.random() * _app.screen.height;
    graphics.position.set(x, y);
    
    _gameState.containers.energy.addChild(graphics);
    _gameState.energyPoints.set(i, {
      id: i,
      x: x,
      y: y,
      sprite: graphics
    });
  }
  
  console.log(`✅ Creati ${pointsCount} nuovi energy points`);
}

// Aggiungi pulsante di debug all'interfaccia
function addDebugButton() {
  // Rimuovi pulsante esistente se presente
  const existingButton = document.getElementById('debug-button');
  if (existingButton) {
    existingButton.remove();
  }
  
  // Crea container per pulsanti
  const debugPanel = document.createElement('div');
  debugPanel.id = 'debug-panel';
  debugPanel.style.position = 'fixed';
  debugPanel.style.bottom = '10px';
  debugPanel.style.left = '10px';
  debugPanel.style.zIndex = '9999';
  debugPanel.style.display = 'flex';
  debugPanel.style.flexDirection = 'column';
  debugPanel.style.gap = '5px';
  
  // Stile comune per i pulsanti
  const buttonStyle = `
    padding: 8px;
    background-color: #e74c3c;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
    font-family: Arial, sans-serif;
  `;
  
  // Pulsante diagnosi
  const diagnosisButton = document.createElement('button');
  diagnosisButton.textContent = '🔍 Diagnosi';
  diagnosisButton.style = buttonStyle;
  diagnosisButton.addEventListener('click', debugBrawlLite);
  debugPanel.appendChild(diagnosisButton);
  
  // Pulsante ricreare containers
  const containersButton = document.createElement('button');
  containersButton.textContent = '🔄 Ricrea Containers';
  containersButton.style = buttonStyle;
  containersButton.addEventListener('click', recreateContainers);
  debugPanel.appendChild(containersButton);
  
  // Pulsante fix energy points
  const fixEnergyButton = document.createElement('button');
  fixEnergyButton.textContent = '⚡ Fix Energy Points';
  fixEnergyButton.style = buttonStyle;
  fixEnergyButton.addEventListener('click', fixEnergyPoints);
  debugPanel.appendChild(fixEnergyButton);
  
  // Pulsante toggle visibilità
  const toggleButton = document.createElement('button');
  toggleButton.textContent = '👁️ Toggle Visibilità';
  toggleButton.style = buttonStyle;
  toggleButton.addEventListener('click', () => {
    if (_gameState && _gameState.containers) {
      Object.values(_gameState.containers).forEach(container => {
        container.visible = !container.visible;
      });
      console.log('Visibilità containers toggled');
    }
  });
  debugPanel.appendChild(toggleButton);
  
  document.body.appendChild(debugPanel);
  console.log('Pulsante debug aggiunto');
}

// Inizializza strumenti debug
function initDebugTools() {
  console.log('Inizializzazione strumenti debug...');
  addDebugButton();
}

// Creiamo un messaggio di aiuto per il sviluppatore
console.log('BrawlLite Debugger caricato! Per inizializzare, aggiungi questo codice al tuo app.js:');
console.log('// Aggiungi alla fine del metodo initGame:');
console.log('if (window.initBrawlDebugger) {');
console.log('  window.initBrawlDebugger(app, gameState, PIXI);');
console.log('}');

// Aggiungi questa funzione dopo l'addEventListener load per migliorare l'auto-rilevamento
// Prova a cercare le variabili nel DOM
function findInWindowScope() {
  // Cerca prima come variabili globali
  if (window.app) {
    console.log('app trovato nello scope globale');
    _app = window.app;
  }
  
  if (window.gameState) {
    console.log('gameState trovato nello scope globale');
    _gameState = window.gameState;
  }
  
  if (window.PIXI) {
    console.log('PIXI trovato nello scope globale');
    _PIXI = window.PIXI;
  }
  
  // Se ancora non trovati, cerca nei frame
  if (!_app || !_gameState) {
    try {
      // Cerca in iframes
      for (let i = 0; i < window.frames.length; i++) {
        const frame = window.frames[i];
        if (frame.app && !_app) {
          console.log('app trovato in frame[' + i + ']');
          _app = frame.app;
        }
        if (frame.gameState && !_gameState) {
          console.log('gameState trovato in frame[' + i + ']');
          _gameState = frame.gameState;
        }
        if (frame.PIXI && !_PIXI) {
          console.log('PIXI trovato in frame[' + i + ']');
          _PIXI = frame.PIXI;
        }
      }
    } catch (e) {
      console.error('Errore cercando nei frame:', e);
    }
  }
  
  // Cerca utilizzando eval come ultimo tentativo
  if (!_app) {
    try {
      const appScript = document.querySelector('script:not([src])');
      if (appScript) {
        const appContent = appScript.textContent;
        if (appContent && appContent.includes('app = new PIXI.Application')) {
          console.log('Tentativo di acquisizione app tramite script injection');
          
          // Crea una funzione ausiliaria per catturare app
          const captureScript = document.createElement('script');
          captureScript.textContent = `
            window.__debugCaptureApp = function() {
              if (window.app) {
                console.log('Catturato app tramite script');
                window.__capturedApp = app;
                window.__capturedGameState = gameState;
                return true;
              }
              return false;
            };
            // Esegui subito
            window.__debugCaptureApp();
            // Esegui anche dopo un breve ritardo
            setTimeout(window.__debugCaptureApp, 500);
            setTimeout(window.__debugCaptureApp, 1000);
          `;
          document.head.appendChild(captureScript);
          
          // Schedule un controllo dopo un breve periodo
          setTimeout(() => {
            if (window.__capturedApp) {
              _app = window.__capturedApp;
              _gameState = window.__capturedGameState;
              console.log('Acquisite variabili app e gameState');
              initDebugTools();
            }
          }, 1200);
        }
      }
    } catch (e) {
      console.error('Errore tentativo script injection:', e);
    }
  }
  
  // Verifica risultato
  if (_app && _gameState) {
    console.log('✅ Acquisiti riferimenti app e gameState - debug pronto');
    return true;
  } else {
    console.error('❌ Non è stato possibile trovare app o gameState');
    return false;
  }
}

// Esegui il finder durante il load
window.addEventListener('load', function() {
  console.log('DOM caricato, ricerca app e gameState');
  // Prova il rilevamento avanzato
  if (findInWindowScope()) {
    console.log('Debug inizializzato tramite rilevamento automatico');
    initDebugTools();
  } else {
    // Aggiungi una finestra di aiuto se non trovati automaticamente
    const helpBox = document.createElement('div');
    helpBox.style.position = 'fixed';
    helpBox.style.bottom = '10px';
    helpBox.style.right = '10px';
    helpBox.style.backgroundColor = 'rgba(0,0,0,0.8)';
    helpBox.style.color = '#fff';
    helpBox.style.padding = '10px';
    helpBox.style.borderRadius = '5px';
    helpBox.style.zIndex = '9999';
    helpBox.style.maxWidth = '300px';
    helpBox.style.fontSize = '12px';
    helpBox.innerHTML = `
      <p><strong>Debug non inizializzato</strong></p>
      <p>Aggiungi questo codice alla fine di initGame in app.js:</p>
      <code>if(window.initBrawlDebugger)window.initBrawlDebugger(app,gameState,PIXI);</code>
      <p>Oppure esegui questo comando nella console:</p>
      <code>window.initBrawlDebugger(app,gameState,PIXI);</code>
      <button id="hide-debug-help" style="margin-top:10px;padding:5px;background:#f55;border:none;color:white;border-radius:3px;">Chiudi</button>
    `;
    document.body.appendChild(helpBox);
    
    document.getElementById('hide-debug-help').addEventListener('click', function() {
      helpBox.style.display = 'none';
    });
  }
  
  // Esegui un secondo tentativo dopo un ritardo
  setTimeout(() => {
    if (!_app || !_gameState) {
      console.log('Secondo tentativo di rilevamento...');
      if (findInWindowScope() && !document.getElementById('debug-panel')) {
        console.log('Debug inizializzato al secondo tentativo');
        initDebugTools();
      }
    }
  }, 2000);
}); 