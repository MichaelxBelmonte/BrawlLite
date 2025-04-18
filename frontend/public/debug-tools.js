/**
 * Debug Tools per BrawlLite
 * Strumenti per diagnosticare e risolvere problemi di rendering
 */

// Variabili per riferimenti agli oggetti di gioco
let _app = null;
let _gameState = null;
let _PIXI = null;
let _gameEngine = null;

// Funzione per inizializzare il debugger con riferimenti corretti
window.initBrawlDebugger = function(appRef, gameStateRef, pixiRef, gameEngineRef = null) {
  console.log('Debugger inizializzato con riferimenti esterni');
  _app = appRef;
  _gameState = gameStateRef;
  _PIXI = pixiRef || window.PIXI;
  _gameEngine = gameEngineRef || window.GameEngine;
  
  // Inizializza gli strumenti di debug dopo aver ricevuto i riferimenti
  initDebugTools();
  
  return {
    diagnosi: debugBrawlLite,
    ricreaContainers: recreateContainers,
    fixEnergy: fixEnergyPoints,
    fixAssets: fixAssetLoading
  };
};

// Funzione principale di diagnosi
function debugBrawlLite() {
  console.log('===== DIAGNOSI BRAWLLITE =====');
  
  // Controlla GameEngine (nuova architettura)
  if (_gameEngine) {
    console.log('✅ GameEngine trovato (nuova architettura)');
    console.log('- Inizializzato:', _gameEngine.initialized);
    console.log('- In esecuzione:', _gameEngine.running);
    
    if (_gameEngine.app) {
      _app = _gameEngine.app; // Aggiorna il riferimento all'app
      console.log('- app PixiJS nel GameEngine trovata');
    }
    
    if (_gameEngine.gameState) {
      _gameState = _gameEngine.gameState; // Aggiorna il riferimento al gameState
      console.log('- gameState nel GameEngine trovato');
    }
    
    // Controlla AssetManager
    if (window.AssetManager) {
      console.log('✅ AssetManager trovato');
      console.log('- Inizializzato:', window.AssetManager.initialized);
      console.log('- Texture caricate:', Object.keys(window.AssetManager.textures).length);
    } else {
      console.error('❌ AssetManager non trovato');
    }
  } else {
    console.log('❓ GameEngine non trovato (usando riferimenti diretti)');
  }
  
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
  
  // Controlla texture - supportando sia gestione diretta che AssetManager
  if (_PIXI) {
    console.log('✅ PIXI trovato');
    
    // Verifica texture tramite AssetManager
    if (window.AssetManager && window.AssetManager.initialized) {
      console.log('Verifica texture tramite AssetManager:');
      
      if (window.AssetManager.isLoaded('player')) {
        console.log('✅ Texture player trovata tramite AssetManager');
      } else {
        console.error('❌ Texture player non trovata tramite AssetManager');
      }
      
      if (window.AssetManager.isLoaded('energy')) {
        console.log('✅ Texture energy trovata tramite AssetManager');
      } else {
        console.error('❌ Texture energy non trovata tramite AssetManager');
      }
    }
    // Verifica anche tramite PIXI Loader (per retrocompatibilità)
    else if (_PIXI.Loader && _PIXI.Loader.shared && _PIXI.Loader.shared.resources) {
      console.log('Verifica texture tramite PIXI.Loader:');
      
      if (_PIXI.Loader.shared.resources.player && _PIXI.Loader.shared.resources.player.texture) {
        console.log('✅ Texture player trovata tramite Loader');
      } else {
        console.error('❌ Texture player non trovata tramite Loader');
      }
      
      if (_PIXI.Loader.shared.resources.energy && _PIXI.Loader.shared.resources.energy.texture) {
        console.log('✅ Texture energy trovata tramite Loader');
      } else {
        console.error('❌ Texture energy non trovata tramite Loader');
      }
    } else {
      console.error('❌ Nessun sistema di gestione texture trovato');
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
  
  // Crea worldContainer se non esiste
  if (!_gameState.worldContainer) {
    _gameState.worldContainer = new _PIXI.Container();
    _app.stage.addChild(_gameState.worldContainer);
    console.log('✅ worldContainer ricreato');
  }
  
  // Ricrea i container
  _gameState.containers = {
    background: new _PIXI.Container(),
    grid: new _PIXI.Container(),
    obstacles: new _PIXI.Container(),
    energy: new _PIXI.Container(),
    players: new _PIXI.Container(),
    effects: new _PIXI.Container(),
    ui: new _PIXI.Container(),
    debug: new _PIXI.Container()
  };
  
  // Aggiungi i container al worldContainer
  Object.values(_gameState.containers).forEach(container => {
    container.visible = true;
    _gameState.worldContainer.addChild(container);
  });
  
  console.log('✅ Container ricreati e aggiunti al worldContainer');
  
  // Ricrea alcuni elementi energia di test
  for (let i = 0; i < 5; i++) {
    const energy = new _PIXI.Graphics();
    energy.beginFill(0x00ff88);
    energy.drawCircle(0, 0, 10);
    energy.endFill();
    energy.position.set(
      Math.random() * 500 - 250,
      Math.random() * 500 - 250
    );
    _gameState.containers.energy.addChild(energy);
  }
  
  // Posiziona worldContainer al centro
  _gameState.worldContainer.position.set(_app.screen.width / 2, _app.screen.height / 2);
  
  console.log('✅ Elementi di test creati');
  return true;
}

// Funzione per ricreare e fissare i punti energia
function fixEnergyPoints() {
  if (!_app || !_gameState) {
    console.error('❌ app o gameState non disponibili');
    return;
  }
  
  console.log('Fixing energy points...');
  
  // Ottieni container energia
  const energyContainer = _gameState.containers && _gameState.containers.energy;
  if (!energyContainer) {
    console.error('❌ Container energia non trovato');
    return;
  }
  
  // Pulisci container energia
  energyContainer.removeChildren();
  
  // Ricrea mappe se non esistono
  if (!_gameState.energyPoints) {
    _gameState.energyPoints = new Map();
  }
  
  // Svuota mappa energia
  _gameState.energyPoints.clear();
  
  // Crea nuovi punti energia
  const energyCount = 20;
  
  console.log(`Creazione ${energyCount} nuovi punti energia...`);
  
  // Scegli texture in base all'architettura disponibile
  let energyTexture = null;
  
  // Prova tramite AssetManager
  if (window.AssetManager && window.AssetManager.getTexture('energy')) {
    energyTexture = window.AssetManager.getTexture('energy');
    console.log('✅ Usando texture da AssetManager');
  }
  // Prova tramite PIXI Loader
  else if (_PIXI.Loader && _PIXI.Loader.shared && _PIXI.Loader.shared.resources.energy) {
    energyTexture = _PIXI.Loader.shared.resources.energy.texture;
    console.log('✅ Usando texture da PIXI Loader');
  }
  
  // Crea punti energia
  for (let i = 0; i < energyCount; i++) {
    // Posizione casuale
    const x = Math.random() * 1000 - 500;
    const y = Math.random() * 1000 - 500;
    
    // Crea container per punto energia
    const energyPointContainer = new _PIXI.Container();
    energyPointContainer.position.set(x, y);
    
    // Crea sprite o grafica in base alla texture disponibile
    let energySprite;
    
    if (energyTexture) {
      energySprite = new _PIXI.Sprite(energyTexture);
      energySprite.anchor.set(0.5);
      energySprite.width = 15;
      energySprite.height = 15;
    } else {
      // Fallback: crea grafica
      energySprite = new _PIXI.Graphics();
      energySprite.beginFill(0x00ffff);
      energySprite.drawCircle(0, 0, 7.5);
      energySprite.endFill();
    }
    
    energyPointContainer.addChild(energySprite);
    energyContainer.addChild(energyPointContainer);
    
    // Salva nella mappa energyPoints
    const id = `energy_${i}`;
    _gameState.energyPoints.set(id, {
      id: id,
      sprite: energyPointContainer,
      x: x,
      y: y,
      value: 10,
      isEnergy: true
    });
  }
  
  console.log(`✅ ${energyCount} punti energia creati con successo`);
  return true;
}

// Funzione per reimpostare il sistema di caricamento asset
function fixAssetLoading() {
  console.log('Fixing asset loading...');
  
  // Verifica se AssetManager è disponibile
  if (!window.AssetManager) {
    console.error('❌ AssetManager non trovato');
    return false;
  }
  
  // Ricarica gli asset di gioco
  if (_gameEngine && _gameEngine.loadAssets) {
    console.log('Ricaricamento bundle game-core tramite GameEngine...');
    
    _gameEngine.loadAssets('game-core')
      .then(assets => {
        console.log('✅ Bundle ricaricato con successo:', Object.keys(assets));
        return true;
      })
      .catch(error => {
        console.error('❌ Errore nel ricaricamento bundle:', error);
        return false;
      });
  } else {
    console.log('Ricaricamento bundle game-core tramite AssetManager diretto...');
    
    window.AssetManager.loadBundle('game-core')
      .then(assets => {
        console.log('✅ Bundle ricaricato con successo:', Object.keys(assets));
        return true;
      })
      .catch(error => {
        console.error('❌ Errore nel ricaricamento bundle:', error);
        return false;
      });
  }
  
  return true;
}

// Aggiungi pulsante debug all'interfaccia
function addDebugButton() {
  const existingButton = document.getElementById('debug-button');
  if (existingButton) return; // Evita duplicati
  
  const button = document.createElement('button');
  button.id = 'debug-button';
  button.textContent = 'Debug';
  button.style.position = 'fixed';
  button.style.bottom = '10px';
  button.style.right = '10px';
  button.style.zIndex = '9999';
  button.style.padding = '8px 16px';
  button.style.backgroundColor = '#f44336';
  button.style.color = 'white';
  button.style.border = 'none';
  button.style.borderRadius = '4px';
  button.style.cursor = 'pointer';
  button.style.fontWeight = 'bold';
  
  button.addEventListener('click', () => {
    console.clear();
    console.log('========== DEBUG ==========');
    
    // Auto-trova riferimenti se non inizializzati esternamente
    if (!_app || !_gameState) {
      findInWindowScope();
    }
    
    debugBrawlLite();
    
    // Aggiungi menu debug
    addDebugMenu();
  });
  
  document.body.appendChild(button);
}

// Aggiungi menu di debug con opzioni
function addDebugMenu() {
  // Rimuovi menu esistente
  const existingMenu = document.getElementById('debug-menu');
  if (existingMenu) {
    existingMenu.remove();
  }
  
  // Crea menu
  const menu = document.createElement('div');
  menu.id = 'debug-menu';
  menu.style.position = 'fixed';
  menu.style.top = '50%';
  menu.style.left = '50%';
  menu.style.transform = 'translate(-50%, -50%)';
  menu.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
  menu.style.color = 'white';
  menu.style.padding = '20px';
  menu.style.borderRadius = '5px';
  menu.style.zIndex = '10000';
  menu.style.minWidth = '300px';
  
  menu.innerHTML = `
    <h3 style="margin-top: 0; text-align: center;">BrawlLite Debugger</h3>
    <div style="margin-bottom: 15px;">
      <button id="debug-diagnosi">Diagnosi Completa</button>
      <button id="debug-containers">Ricrea Containers</button>
    </div>
    <div style="margin-bottom: 15px;">
      <button id="debug-fix-energy">Fix Energy Points</button>
      <button id="debug-fix-assets">Fix Asset Loading</button>
    </div>
    <div style="text-align: right;">
      <button id="debug-close">Chiudi</button>
    </div>
  `;
  
  document.body.appendChild(menu);
  
  // Stile pulsanti
  Array.from(menu.querySelectorAll('button')).forEach(button => {
    button.style.margin = '5px';
    button.style.padding = '8px 12px';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.backgroundColor = '#4CAF50';
    button.style.color = 'white';
  });
  
  // Eventi pulsanti
  document.getElementById('debug-diagnosi').addEventListener('click', debugBrawlLite);
  document.getElementById('debug-containers').addEventListener('click', recreateContainers);
  document.getElementById('debug-fix-energy').addEventListener('click', fixEnergyPoints);
  document.getElementById('debug-fix-assets').addEventListener('click', fixAssetLoading);
  document.getElementById('debug-close').addEventListener('click', () => {
    menu.remove();
  });
}

// Inizializza strumenti di debug
function initDebugTools() {
  console.log('BrawlLite Debugger caricato! Per inizializzare, aggiungi questo codice al tuo app.js:');
  console.log('// Aggiungi alla fine del metodo initGame:');
  console.log('if (window.initBrawlDebugger) {');
  console.log('  window.initBrawlDebugger(app, gameState, PIXI);');
  console.log('}');
  
  // Aggiungi pulsante debug
  addDebugButton();
}

// Cerca app e gameState nello scope globale
function findInWindowScope() {
  console.log('Ricerca riferimenti globali...');
  
  // Cerca PIXI
  if (window.PIXI) {
    console.log('PIXI trovato nello scope globale');
    _PIXI = window.PIXI;
  }
  
  // Cerca GameEngine (architettura modulare)
  if (window.GameEngine) {
    console.log('GameEngine trovato nello scope globale');
    _gameEngine = window.GameEngine;
    
    if (_gameEngine.app) {
      console.log('app trovata nel GameEngine');
      _app = _gameEngine.app;
    }
    
    if (_gameEngine.gameState) {
      console.log('gameState trovato nel GameEngine');
      _gameState = _gameEngine.gameState;
      return true;
    }
  }
  
  // Cerca app e gameState direttamente nello scope globale
  if (window.app) {
    console.log('app trovata nello scope globale');
    _app = window.app;
  }
  
  if (window.gameState) {
    console.log('gameState trovato nello scope globale');
    _gameState = window.gameState;
    return true;
  }
  
  console.error('❌ Non è stato possibile trovare app o gameState');
  return false;
}

// Cerca automaticamente riferimenti all'avvio del DOM
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM caricato, ricerca app e gameState');
  findInWindowScope();
  
  // Prova una seconda volta dopo un po' (per dare tempo al caricamento)
  setTimeout(() => {
    console.log('Secondo tentativo di rilevamento...');
    if (!_app || !_gameState) {
      findInWindowScope();
    }
  }, 2000);
});

// Auto-inizializzazione al caricamento
initDebugTools(); 