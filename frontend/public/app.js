// Variabili globali
let app;
let socket;
let gameState = {
  players: new Map(),
  energyPoints: new Map(),
  playerId: null,
  containers: null,
  worldContainer: null,
  debug: false
};
let msgpack = window.msgpack5 ? window.msgpack5() : null;

// Configurazione del mondo
const WORLD_CONFIG = {
  width: 3000,
  height: 3000,
  minZoom: 0.5,
  maxZoom: 1.2,
  padding: 50
};

// Configurazione del giocatore
const INITIAL_SIZE = 30;
const PLAYER_SPEED = 5;
const MAX_SIZE = 200;
const ENERGY_VALUE = 10;
const MAX_ENERGY_POINTS = 100;

// ... existing code ...

window.initGame = async function initGame(username) {
  try {
    if (!username || typeof username !== 'string' || username.trim() === '') {
      throw new Error('Nome utente non valido');
    }
    
    console.log(`Inizializzazione gioco per ${username}...`);
    
    // Nascondi schermata login e mostra il gioco
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    // Inizializza il renderer PRIMA di caricare le texture
    const appInstance = initPixiJS(); 
    
    // Verifica se app è stato creato correttamente
    if (!appInstance || !window.app) {
      throw new Error('Applicazione PixiJS non creata correttamente');
    }
    
    // Esplicita assegnazione globale
    window.app = appInstance;
    app = appInstance;

    // Inizializza gameState
    window.gameState = gameState;
    
    // Imposta il nome del giocatore
    playerName = username;
    gameState.playerId = `local_${Math.random().toString(36).substr(2, 9)}`;

    // PUNTO CRITICO 1: Crea i container PRIMA DI TUTTO
    console.log('Creazione container principali...');
    
    // Crea un container principale per tutto il mondo
    gameState.worldContainer = new PIXI.Container();
    app.stage.addChild(gameState.worldContainer);
    
    // Crea i container specifici nell'ordine corretto
    gameState.containers = {
      background: new PIXI.Container(),
      energy: new PIXI.Container(),
      players: new PIXI.Container(),
      effects: new PIXI.Container(),
      ui: new PIXI.Container(),
      debug: new PIXI.Container()
    };
    
    // PUNTO CRITICO 2: Aggiungi i container al mondo
    Object.values(gameState.containers).forEach(container => {
      gameState.worldContainer.addChild(container);
    });
    
    console.log('Container creati e aggiunti al mondo:', Object.keys(gameState.containers).join(', '));

    // Carica le texture (con fallback)
    try {
      console.log('Caricamento texture...');
      await loadGameTextures();
    } catch (textureError) {
      console.error('Errore caricamento texture:', textureError);
      // Il fallback dovrebbe essere già gestito nella funzione loadGameTextures
    }

    // PUNTO CRITICO 3: Crea il giocatore locale
    try {
      const initialX = WORLD_CONFIG.width / 2;
      const initialY = WORLD_CONFIG.height / 2;
      
      // Crea il giocatore locale
      const localPlayerSprite = createPlayerSprite(gameState.playerId, true, INITIAL_SIZE);
      
      if (localPlayerSprite) {
        localPlayerSprite.x = initialX;
        localPlayerSprite.y = initialY;
        gameState.players.set(gameState.playerId, {
          id: gameState.playerId,
          sprite: localPlayerSprite,
          x: initialX,
          y: initialY,
          size: INITIAL_SIZE,
          name: username,
          score: 0,
          level: 1
        });
        console.log('Giocatore locale creato e aggiunto a gameState');
      }
    } catch (playerError) {
      console.error('Errore creazione giocatore:', playerError);
    }

    // PUNTO CRITICO 4: Crea punti energia
    try {
      console.log('Inizializzazione punti energia...');
      // Pulisci container energia per sicurezza
      gameState.containers.energy.removeChildren();
      gameState.energyPoints.clear();
      
      // Crea nuovi punti energia
      const pointsCount = 20;
      for (let i = 0; i < pointsCount; i++) {
        const x = Math.random() * WORLD_CONFIG.width;
        const y = Math.random() * WORLD_CONFIG.height;
        
        const energySprite = createEnergyPoint(x, y);
        if (energySprite) {
          gameState.energyPoints.set(i, {
            id: i,
            sprite: energySprite,
            x: x,
            y: y,
            value: 10
          });
        }
      }
      console.log(`Creati ${gameState.energyPoints.size} punti energia`);
    } catch (energyError) {
      console.error('Errore creazione punti energia:', energyError);
    }

    // Connetti al WebSocket
    try {
      connectWebSocket();
    } catch (wsError) {
      console.error('Errore connessione WebSocket:', wsError);
    }

    // Gestisci orientamento dispositivo
    handleDeviceOrientation();
    
    // Inizia il game loop
    if (app && app.ticker && !app.ticker.started) {
      app.ticker.add(gameLoop);
      console.log('Game loop avviato');
    }

    // Inizializza debugger se disponibile
    if (window.initBrawlDebugger) {
      console.log('Inizializzazione strumenti di debug...');
      window.initBrawlDebugger(app, gameState, PIXI);
    }

    console.log('Gioco inizializzato con successo');
    return true;
  } catch (error) {
    console.error('Errore critico inizializzazione gioco:', error);
    showMessage(`Errore inizializzazione: ${error.message}`, 'error');
    return false;
  }
};

// Crea uno sprite per un giocatore
function createPlayerSprite(id, isLocal = false, size = INITIAL_SIZE) {
  try {
    console.log(`Creazione player sprite per ${id}, locale: ${isLocal}, dimensione: ${size}`);
    
    // Crea un container per il giocatore
    const container = new PIXI.Container();
    container.playerId = id;
    container.isLocal = isLocal;
    
    // Cerca di utilizzare la texture caricata
    let bodySprite;
    if (PIXI.Loader && PIXI.Loader.shared && PIXI.Loader.shared.resources.player && PIXI.Loader.shared.resources.player.texture) {
      bodySprite = new PIXI.Sprite(PIXI.Loader.shared.resources.player.texture);
      bodySprite.anchor.set(0.5);
      bodySprite.width = size;
      bodySprite.height = size;
      
      // Tint diverso per giocatore locale vs altri
      bodySprite.tint = isLocal ? 0x00ff88 : 0xff3333;
    } else {
      // Fallback: crea una grafica
      console.log('Texture player non disponibile, creazione grafica fallback');
      bodySprite = new PIXI.Graphics();
      bodySprite.beginFill(isLocal ? 0x00ff88 : 0xff3333, 0.8);
      bodySprite.drawCircle(0, 0, size / 2);
      bodySprite.endFill();
    }
    
    container.addChild(bodySprite);
    
    // Aggiungi il nome del giocatore
    const style = new PIXI.TextStyle({
      fontFamily: 'Arial',
      fontSize: 14,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 3,
      align: 'center'
    });
    
    const nameText = new PIXI.Text(isLocal ? 'Tu' : `Player ${id.substring(0, 4)}`, style);
    nameText.anchor.set(0.5);
    nameText.y = -size / 2 - 20; // Posiziona sopra lo sprite
    container.addChild(nameText);
    
    // Aggiungi al container dei giocatori
    if (gameState.containers && gameState.containers.players) {
      gameState.containers.players.addChild(container);
      console.log(`Player sprite aggiunto al container per ${id}`);
    } else {
      console.warn('Container players non disponibile, impossibile aggiungere lo sprite');
      // Se il container non è disponibile, aggiungi direttamente allo stage
      if (app && app.stage) {
        app.stage.addChild(container);
      }
    }
    
    return container;
  } catch (error) {
    console.error('Errore nella creazione dello sprite del giocatore:', error);
    return null;
  }
}