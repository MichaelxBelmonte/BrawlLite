/**
 * Debug Tools per BrawlLite
 * Strumenti per diagnosticare e risolvere problemi di rendering
 */

// Funzione principale di diagnosi
function debugBrawlLite() {
  console.log('===== DIAGNOSI BRAWLLITE =====');
  
  // Controlla app PixiJS
  if (window.app) {
    console.log('✅ app PixiJS trovata');
    console.log('- Tipo renderer:', app.renderer.type === 0 ? 'WebGL' : 'Canvas');
    console.log('- Dimensioni:', app.screen.width, 'x', app.screen.height);
    console.log('- Children in stage:', app.stage.children.length);
  } else {
    console.error('❌ app PixiJS non trovata');
  }
  
  // Controlla gameState
  if (window.gameState) {
    console.log('✅ gameState trovato');
    console.log('- Players:', gameState.players ? gameState.players.size : 0);
    console.log('- EnergyPoints:', gameState.energyPoints ? gameState.energyPoints.size : 0);
    
    if (gameState.containers) {
      console.log('✅ containers trovati');
      
      if (gameState.containers.energy) {
        console.log('✅ energy container trovato');
        console.log('- visible:', gameState.containers.energy.visible);
        console.log('- children:', gameState.containers.energy.children.length);
      } else {
        console.error('❌ energy container non trovato');
      }
      
      if (gameState.containers.players) {
        console.log('✅ players container trovato');
        console.log('- visible:', gameState.containers.players.visible);
        console.log('- children:', gameState.containers.players.children.length);
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
  if (window.PIXI) {
    console.log('✅ PIXI trovato');
    
    if (PIXI.Loader && PIXI.Loader.shared && PIXI.Loader.shared.resources) {
      console.log('✅ Loader risorse trovato');
      
      if (PIXI.Loader.shared.resources.player && PIXI.Loader.shared.resources.player.texture) {
        console.log('✅ Texture player trovata');
      } else {
        console.error('❌ Texture player non trovata');
      }
      
      if (PIXI.Loader.shared.resources.energy && PIXI.Loader.shared.resources.energy.texture) {
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
  
  if (!window.app || !app.stage) {
    console.error('❌ Impossibile creare elementi test: app o stage non disponibili');
    return;
  }
  
  // Aggiungi un contenitore di test
  const testContainer = new PIXI.Container();
  testContainer.position.set(app.screen.width / 2, app.screen.height / 2);
  app.stage.addChild(testContainer);
  
  // Aggiungi un cerchio rosso come punto di riferimento
  const reference = new PIXI.Graphics();
  reference.beginFill(0xff0000);
  reference.drawCircle(0, 0, 10);
  reference.endFill();
  testContainer.addChild(reference);
  
  // Aggiungi un cerchio verde come "energia"
  const testEnergy = new PIXI.Graphics();
  testEnergy.beginFill(0x00ff00);
  testEnergy.drawCircle(50, 0, 15);
  testEnergy.endFill();
  testContainer.addChild(testEnergy);
  
  // Aggiungi un cerchio blu come "giocatore"
  const testPlayer = new PIXI.Graphics();
  testPlayer.beginFill(0x0000ff);
  testPlayer.drawCircle(-50, 0, 20);
  testPlayer.endFill();
  testContainer.addChild(testPlayer);
  
  console.log('✅ Elementi test creati al centro dello schermo');
  
  // Crea testo informativo
  const testText = new PIXI.Text('TEST RENDERING', {
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
  if (!window.app || !window.gameState) {
    console.error('❌ app o gameState non disponibili');
    return;
  }
  
  console.log('Ricreazione containers...');
  
  // Rimuovi container esistenti
  if (gameState.containers) {
    Object.values(gameState.containers).forEach(container => {
      if (container && container.parent) {
        container.parent.removeChild(container);
      }
    });
  }
  
  // Ricrea i container
  gameState.containers = {
    energy: new PIXI.Container(),
    players: new PIXI.Container(),
    effects: new PIXI.Container(),
    debug: new PIXI.Container()
  };
  
  // Assicurati che siano visibili
  Object.values(gameState.containers).forEach(container => {
    container.visible = true;
    app.stage.addChild(container);
  });
  
  console.log('✅ Container ricreati e aggiunti allo stage');
  
  // Ricrea alcuni elementi energia di test
  for (let i = 0; i < 5; i++) {
    const energy = new PIXI.Graphics();
    energy.beginFill(0x00ff88);
    energy.drawCircle(0, 0, 10);
    energy.endFill();
    energy.position.set(
      Math.random() * app.screen.width,
      Math.random() * app.screen.height
    );
    gameState.containers.energy.addChild(energy);
  }
  
  // Ricrea un giocatore di test
  const player = new PIXI.Graphics();
  player.beginFill(0x3498db);
  player.drawCircle(0, 0, 20);
  player.endFill();
  player.position.set(app.screen.width / 2, app.screen.height / 2);
  gameState.containers.players.addChild(player);
  
  console.log('✅ Oggetti test creati');
}

// Funzione di ripristino fallback per energy points
function fixEnergyPoints() {
  if (!window.app || !window.gameState) {
    console.error('❌ app o gameState non disponibili');
    return;
  }
  
  console.log('Tentativo di ripristino energy points...');
  
  // Pulisci container energia
  if (gameState.containers && gameState.containers.energy) {
    gameState.containers.energy.removeChildren();
  } else {
    gameState.containers = gameState.containers || {};
    gameState.containers.energy = new PIXI.Container();
    app.stage.addChild(gameState.containers.energy);
  }
  
  // Pulisci la mappa energy points
  if (gameState.energyPoints) {
    gameState.energyPoints.clear();
  } else {
    gameState.energyPoints = new Map();
  }
  
  // Crea nuovi energy points semplici
  const pointsCount = 20;
  for (let i = 0; i < pointsCount; i++) {
    const graphics = new PIXI.Graphics();
    graphics.beginFill(0xf1c40f);
    graphics.drawCircle(0, 0, 10);
    graphics.endFill();
    
    const x = Math.random() * app.screen.width;
    const y = Math.random() * app.screen.height;
    graphics.position.set(x, y);
    
    gameState.containers.energy.addChild(graphics);
    gameState.energyPoints.set(i, {
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
    if (window.gameState && gameState.containers) {
      Object.values(gameState.containers).forEach(container => {
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

// Avvia strumenti di debug all'evento DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDebugTools);
} else {
  initDebugTools();
}

// Esponi funzioni a livello globale
window.debugBrawlLite = debugBrawlLite;
window.recreateContainers = recreateContainers;
window.fixEnergyPoints = fixEnergyPoints; 