// Variabili globali
let app;
let socket;
let playerName = '';
let gameState = {
  players: new Map(),
  energyPoints: new Map(),
  playerId: null,
  containers: null,
  worldContainer: null,
  debug: false,
  keys: {},
  joystick: {
    active: false,
    dx: 0,
    dy: 0
  }
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

// Funzione per inizializzare il renderer PixiJS
function initPixiJS() {
  try {
    console.log("Inizializzazione renderer PixiJS...");
    
    // Controlla se PIXI è disponibile
    if (!window.PIXI) {
      throw new Error("PixiJS non disponibile. Verifica che sia caricato correttamente.");
    }
    
    // Controlla il supporto WebGL
    let renderer = PIXI.autoDetectRenderer();
    let isWebGLSupported = renderer instanceof PIXI.WebGLRenderer;
    renderer.destroy();
    
    // Crea l'applicazione PixiJS
    let pixiApp = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x061639,
      resolution: window.devicePixelRatio || 1,
      antialias: true,
      autoDensity: true,
      powerPreference: "high-performance"
    });
    
    // Aggiungi il canvas al container
    const gameContainer = document.getElementById('game-container');
    if (!gameContainer) {
      throw new Error("Container di gioco non trovato nel DOM");
    }
    gameContainer.innerHTML = '';
    gameContainer.appendChild(pixiApp.view);
    
    // Imposta le dimensioni del canvas
    pixiApp.renderer.resize(window.innerWidth, window.innerHeight);
    
    // Configura gestione del ridimensionamento
    window.addEventListener('resize', () => {
      pixiApp.renderer.resize(window.innerWidth, window.innerHeight);
      
      // Gestisci l'orientamento su mobile
      handleDeviceOrientation();
    });
    
    console.log("PixiJS inizializzato con successo:", 
      isWebGLSupported ? "Rendering WebGL" : "Rendering Canvas");
    
    return pixiApp;
  } catch (error) {
    console.error("Errore nell'inizializzazione di PixiJS:", error);
    showMessage(`Errore nell'inizializzazione del renderer: ${error.message}`, 'error');
    return null;
  }
}

// Funzione per mostrare messaggi all'utente
function showMessage(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`);
  
  // Cerca o crea il container dei messaggi
  let messageContainer = document.getElementById('message-container');
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.id = 'message-container';
    messageContainer.style.position = 'fixed';
    messageContainer.style.top = '10px';
    messageContainer.style.left = '50%';
    messageContainer.style.transform = 'translateX(-50%)';
    messageContainer.style.zIndex = '1000';
    document.body.appendChild(messageContainer);
  }
  
  // Crea l'elemento del messaggio
  const messageElement = document.createElement('div');
  messageElement.textContent = message;
  messageElement.style.padding = '10px 15px';
  messageElement.style.margin = '5px';
  messageElement.style.borderRadius = '5px';
  messageElement.style.fontFamily = 'Arial, sans-serif';
  messageElement.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  
  // Applica stile in base al tipo
  switch (type) {
    case 'error':
      messageElement.style.backgroundColor = '#f44336';
      messageElement.style.color = 'white';
      break;
    case 'success':
      messageElement.style.backgroundColor = '#4CAF50';
      messageElement.style.color = 'white';
      break;
    case 'warning':
      messageElement.style.backgroundColor = '#ff9800';
      messageElement.style.color = 'white';
      break;
    default:
      messageElement.style.backgroundColor = '#2196F3';
      messageElement.style.color = 'white';
  }
  
  // Aggiungi al container e imposta timer per rimozione
  messageContainer.appendChild(messageElement);
  
  // Rimuovi dopo 5 secondi
  setTimeout(() => {
    if (messageElement.parentNode) {
      messageElement.parentNode.removeChild(messageElement);
    }
  }, 5000);
}

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

    // Inizializza i controlli
    initControls();

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

// Funzione per creare un punto energia
function createEnergyPoint(x, y) {
  try {
    // Verifica se i container sono stati inizializzati
    if (!gameState.containers || !gameState.containers.energy) {
      console.warn('Container energy non disponibile, impossibile aggiungere punto energia');
      return null;
    }
    
    // Crea un container per il punto energia
    const container = new PIXI.Container();
    container.x = x;
    container.y = y;
    
    // Prova a utilizzare la texture caricata
    let energySprite;
    if (PIXI.Loader && PIXI.Loader.shared && PIXI.Loader.shared.resources.energy && PIXI.Loader.shared.resources.energy.texture) {
      energySprite = new PIXI.Sprite(PIXI.Loader.shared.resources.energy.texture);
      energySprite.anchor.set(0.5);
      energySprite.width = 15;
      energySprite.height = 15;
      energySprite.tint = 0x00ffff;
    } else {
      // Fallback: crea una grafica
      console.log('Texture energia non disponibile, creazione grafica fallback');
      energySprite = new PIXI.Graphics();
      energySprite.beginFill(0x00ffff, 0.8);
      energySprite.drawCircle(0, 0, 7.5);
      energySprite.endFill();
    }
    
    container.addChild(energySprite);
    
    // Aggiungi un effetto di glow se disponibile
    try {
      if (PIXI.filters && PIXI.filters.GlowFilter) {
        const glowFilter = new PIXI.filters.GlowFilter({
          distance: 10,
          outerStrength: 1,
          innerStrength: 0.5,
          color: 0x00ffff,
          quality: 0.5
        });
        container.filters = [glowFilter];
      }
    } catch (filterError) {
      console.warn('Filtri non disponibili, glow non applicato:', filterError);
    }
    
    // Aggiungi animazione di fluttuazione
    if (window.anime) {
      window.anime({
        targets: container,
        y: y + 5,
        duration: 1500,
        easing: 'easeInOutSine',
        direction: 'alternate',
        loop: true
      });
    }
    
    // Aggiungi al container energia
    gameState.containers.energy.addChild(container);
    
    return container;
  } catch (error) {
    console.error('Errore nella creazione del punto energia:', error);
    return null;
  }
}

// Funzione per gestire l'orientamento del dispositivo
function handleDeviceOrientation() {
  try {
    // Rileva se è un dispositivo mobile
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      // Verifica l'orientamento
      const isPortrait = window.innerHeight > window.innerWidth;
      const orientationMessage = document.getElementById('orientation-message');
      
      // Se in portrait, mostra il messaggio di rotazione
      if (isPortrait) {
        if (!orientationMessage) {
          // Crea messaggio
          const message = document.createElement('div');
          message.id = 'orientation-message';
          message.style.position = 'fixed';
          message.style.top = '0';
          message.style.left = '0';
          message.style.width = '100%';
          message.style.height = '100%';
          message.style.backgroundColor = 'rgba(0,0,0,0.8)';
          message.style.color = 'white';
          message.style.display = 'flex';
          message.style.flexDirection = 'column';
          message.style.justifyContent = 'center';
          message.style.alignItems = 'center';
          message.style.zIndex = '2000';
          message.style.padding = '20px';
          message.style.textAlign = 'center';
          message.style.fontFamily = 'Arial, sans-serif';
          
          // Aggiungi icona di rotazione
          const iconContainer = document.createElement('div');
          iconContainer.innerHTML = `
            <svg width="100" height="100" viewBox="0 0 100 100">
              <path fill="white" d="M70,10L70,90L20,50L70,10Z"></path>
              <rect x="75" y="25" width="15" height="50" fill="white"></rect>
            </svg>
          `;
          message.appendChild(iconContainer);
          
          // Aggiungi testo
          const text = document.createElement('p');
          text.textContent = 'Ruota il dispositivo in orizzontale per una migliore esperienza di gioco';
          text.style.fontSize = '18px';
          text.style.margin = '20px 0';
          message.appendChild(text);
          
          document.body.appendChild(message);
        } else {
          orientationMessage.style.display = 'flex';
        }
      } else {
        // Se in landscape, nascondi il messaggio
        if (orientationMessage) {
          orientationMessage.style.display = 'none';
        }
      }
    }
  } catch (error) {
    console.warn('Errore nella gestione orientamento dispositivo:', error);
  }
}

// Funzione per caricare le texture del gioco
async function loadGameTextures() {
  try {
    console.log('Inizializzazione caricamento texture...');
    
    // Verifica se PIXI.Assets è disponibile (PixiJS v7+)
    if (PIXI.Assets) {
      console.log('Utilizzo PIXI.Assets per caricare le texture (PixiJS v7+)');
      
      try {
        // Carica le texture del giocatore
        const playerTexture = await PIXI.Assets.load('/assets/images/player.png')
          .catch(error => {
            console.warn('Errore caricamento texture player:', error);
            return null;
          });
        
        if (playerTexture) {
          // Memorizza la texture per riferimento globale
          PIXI.Loader = PIXI.Loader || {};
          PIXI.Loader.shared = PIXI.Loader.shared || { resources: {} };
          PIXI.Loader.shared.resources = PIXI.Loader.shared.resources || {};
          PIXI.Loader.shared.resources.player = { texture: playerTexture };
          console.log('Texture player caricata con successo');
        } else {
          console.warn('Fallback: creazione texture player di default');
          // Crea una texture di fallback se il caricamento fallisce
          const graphics = new PIXI.Graphics();
          graphics.beginFill(0x00ff88);
          graphics.drawCircle(0, 0, 15);
          graphics.endFill();
          const fallbackTexture = app.renderer.generateTexture(graphics);
          
          PIXI.Loader = PIXI.Loader || {};
          PIXI.Loader.shared = PIXI.Loader.shared || { resources: {} };
          PIXI.Loader.shared.resources = PIXI.Loader.shared.resources || {};
          PIXI.Loader.shared.resources.player = { texture: fallbackTexture };
        }
        
        // Carica la texture dell'energia
        const energyTexture = await PIXI.Assets.load('/assets/images/energy.png')
          .catch(error => {
            console.warn('Errore caricamento texture energia:', error);
            return null;
          });
        
        if (energyTexture) {
          PIXI.Loader.shared.resources.energy = { texture: energyTexture };
          console.log('Texture energia caricata con successo');
        } else {
          console.warn('Fallback: creazione texture energia di default');
          // Crea texture fallback per l'energia
          const graphics = new PIXI.Graphics();
          graphics.beginFill(0x00ffff);
          graphics.drawCircle(0, 0, 7.5);
          graphics.endFill();
          const fallbackTexture = app.renderer.generateTexture(graphics);
          
          PIXI.Loader.shared.resources.energy = { texture: fallbackTexture };
        }
        
        return true;
      } catch (error) {
        console.error('Errore generale durante il caricamento delle texture:', error);
        throw error;
      }
    } 
    // Fallback per PixiJS v6 e precedenti
    else if (PIXI.Loader) {
      console.log('Utilizzo PIXI.Loader per caricare le texture (PixiJS v6 e precedenti)');
      
      return new Promise((resolve, reject) => {
        // Imposta il loader di PixiJS
        const loader = PIXI.Loader.shared;
        
        // Aggiungi le texture da caricare
        loader.add('player', '/assets/images/player.png')
              .add('energy', '/assets/images/energy.png');
        
        // Gestisci l'errore di caricamento
        loader.onError.add((error, _loader, resource) => {
          console.warn(`Errore caricamento risorsa ${resource.name}:`, error);
          
          // Crea texture fallback
          if (resource.name === 'player') {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(0x00ff88);
            graphics.drawCircle(0, 0, 15);
            graphics.endFill();
            const fallbackTexture = app.renderer.generateTexture(graphics);
            
            // Aggiungi manualmente alla cache dei loader
            PIXI.Loader.shared.resources.player = { texture: fallbackTexture };
          }
          
          if (resource.name === 'energy') {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(0x00ffff);
            graphics.drawCircle(0, 0, 7.5);
            graphics.endFill();
            const fallbackTexture = app.renderer.generateTexture(graphics);
            
            // Aggiungi manualmente alla cache dei loader
            PIXI.Loader.shared.resources.energy = { texture: fallbackTexture };
          }
        });
        
        // Inizia il caricamento
        loader.load((_loader, resources) => {
          console.log('Texture caricate con successo');
          resolve(true);
        });
      });
    } else {
      console.warn('Nessun metodo di caricamento texture disponibile, utilizzo graphics fallback');
      
      // Crea texture fallback per il giocatore
      const playerGraphics = new PIXI.Graphics();
      playerGraphics.beginFill(0x00ff88);
      playerGraphics.drawCircle(0, 0, 15);
      playerGraphics.endFill();
      const playerTexture = app.renderer.generateTexture(playerGraphics);
      
      // Crea texture fallback per l'energia
      const energyGraphics = new PIXI.Graphics();
      energyGraphics.beginFill(0x00ffff);
      energyGraphics.drawCircle(0, 0, 7.5);
      energyGraphics.endFill();
      const energyTexture = app.renderer.generateTexture(energyGraphics);
      
      // Crea struttura compatibile con il resto del codice
      PIXI.Loader = PIXI.Loader || {};
      PIXI.Loader.shared = PIXI.Loader.shared || { resources: {} };
      PIXI.Loader.shared.resources = PIXI.Loader.shared.resources || {};
      PIXI.Loader.shared.resources.player = { texture: playerTexture };
      PIXI.Loader.shared.resources.energy = { texture: energyTexture };
      
      return true;
    }
  } catch (error) {
    console.error('Errore critico nel caricamento delle texture:', error);
    throw error;
  }
}

// Connessione al WebSocket
function connectWebSocket() {
  try {
    // Evita connessioni multiple
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      console.log('WebSocket già connesso, chiusura connessione precedente');
      socket.close();
    }
    
    const host = window.location.hostname;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${host}:8080/ws`;
    
    console.log(`Connessione al WebSocket: ${wsUrl}`);
    socket = new WebSocket(wsUrl);
    
    socket.binaryType = msgpack ? 'arraybuffer' : 'blob';
    
    socket.onopen = () => {
      console.log('WebSocket connesso');
      showMessage('Connesso al server', 'success');
      
      // Invia dati giocatore al server
      if (gameState.players.has(gameState.playerId)) {
        const player = gameState.players.get(gameState.playerId);
        sendPlayerUpdate(player);
      }
    };
    
    socket.onclose = (event) => {
      console.log(`WebSocket disconnesso, codice: ${event.code}`);
      showMessage('Disconnesso dal server', 'warning');
      
      // Riconnessione dopo 5 secondi
      setTimeout(() => {
        if (socket.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }, 5000);
    };
    
    socket.onerror = (error) => {
      console.error('Errore WebSocket:', error);
      showMessage('Errore di connessione al server', 'error');
    };
    
    socket.onmessage = (event) => {
      try {
        // Gestisci i dati in arrivo
        let data;
        
        if (msgpack && event.data instanceof ArrayBuffer) {
          data = msgpack.decode(new Uint8Array(event.data));
        } else {
          data = JSON.parse(event.data);
        }
        
        // Gestisci i diversi tipi di messaggi
        if (data.type === 'worldUpdate') {
          updateWorldState(data.data);
        } else if (data.type === 'playerJoined') {
          handlePlayerJoined(data.data);
        } else if (data.type === 'playerLeft') {
          handlePlayerLeft(data.data);
        } else if (data.type === 'energyUpdate') {
          updateEnergy(data.data);
        }
      } catch (error) {
        console.error('Errore nella gestione del messaggio WebSocket:', error);
      }
    };
    
    return socket;
  } catch (error) {
    console.error('Errore nella connessione WebSocket:', error);
    showMessage('Impossibile connettersi al server', 'error');
    return null;
  }
}

// Funzione temporanea per inviare aggiornamenti al server
function sendPlayerUpdate(player) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  
  const updateData = {
    type: 'playerUpdate',
    data: {
      id: player.id,
      x: player.x,
      y: player.y,
      size: player.size,
      name: player.name,
      score: player.score
    }
  };
  
  if (msgpack) {
    socket.send(msgpack.encode(updateData));
  } else {
    socket.send(JSON.stringify(updateData));
  }
}

// Funzione per il game loop principale
function gameLoop(delta) {
  try {
    // Aggiorna FPS counter se in modalità debug
    if (gameState.debug && document.getElementById('fps-counter')) {
      const fps = Math.round(app.ticker.FPS);
      document.getElementById('fps-counter').textContent = `FPS: ${fps}`;
    }
    
    // Aggiorna la posizione del giocatore locale
    if (gameState.players.has(gameState.playerId)) {
      const player = gameState.players.get(gameState.playerId);
      const sprite = player.sprite;
      
      if (sprite) {
        // Simulazione di movimento con arrow keys
        // In un'implementazione reale, questo verrebbe gestito da controlli dedicati
        let movX = 0;
        let movY = 0;
        
        // Movimento basato sui tasti premuti
        if (gameState.keys) {
          if (gameState.keys.ArrowLeft || gameState.keys.a) movX -= PLAYER_SPEED;
          if (gameState.keys.ArrowRight || gameState.keys.d) movX += PLAYER_SPEED;
          if (gameState.keys.ArrowUp || gameState.keys.w) movY -= PLAYER_SPEED;
          if (gameState.keys.ArrowDown || gameState.keys.s) movY += PLAYER_SPEED;
        }
        
        // Supporto per joystick virtuale su mobile
        if (gameState.joystick && gameState.joystick.active) {
          const joystickX = gameState.joystick.dx / 50 * PLAYER_SPEED;
          const joystickY = gameState.joystick.dy / 50 * PLAYER_SPEED;
          
          movX += joystickX;
          movY += joystickY;
        }
        
        // Applica il movimento
        if (movX !== 0 || movY !== 0) {
          // Normalizza il movimento diagonale
          if (movX !== 0 && movY !== 0) {
            const length = Math.sqrt(movX * movX + movY * movY);
            movX = movX / length * PLAYER_SPEED;
            movY = movY / length * PLAYER_SPEED;
          }
          
          // Aggiorna la posizione con il delta time per movimento fluido
          const dt = delta / 60; // Normalizza per 60 FPS
          sprite.x += movX * dt;
          sprite.y += movY * dt;
          
          // Limita ai bordi del mondo
          sprite.x = Math.max(0, Math.min(WORLD_CONFIG.width, sprite.x));
          sprite.y = Math.max(0, Math.min(WORLD_CONFIG.height, sprite.y));
          
          // Aggiorna i dati del giocatore
          player.x = sprite.x;
          player.y = sprite.y;
          
          // Centra la camera sul giocatore
          if (gameState.worldContainer) {
            // Calcola la posizione desiderata dello schermo
            const screenX = window.innerWidth / 2 - sprite.x;
            const screenY = window.innerHeight / 2 - sprite.y;
            
            // Applica la posizione con lerp per movimento fluido
            gameState.worldContainer.x = screenX;
            gameState.worldContainer.y = screenY;
          }
          
          // Invia l'aggiornamento al server ogni 100ms
          const now = Date.now();
          if (!player.lastUpdate || now - player.lastUpdate > 100) {
            sendPlayerUpdate(player);
            player.lastUpdate = now;
          }
        }
        
        // Verifica collisioni con punti energia
        gameState.energyPoints.forEach((energyPoint, id) => {
          if (energyPoint && energyPoint.sprite) {
            const dx = player.x - energyPoint.x;
            const dy = player.y - energyPoint.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Se il giocatore tocca il punto energia
            if (distance < player.size / 2) {
              // Aumenta il punteggio e la dimensione
              player.score += energyPoint.value;
              player.size = Math.min(MAX_SIZE, player.size + 1);
              
              // Aggiorna la dimensione dello sprite
              sprite.width = player.size;
              sprite.height = player.size;
              
              // Riposiziona il testo del nome
              if (sprite.children && sprite.children[1]) {
                sprite.children[1].y = -player.size / 2 - 20;
              }
              
              // Rimuovi il punto energia
              if (energyPoint.sprite.parent) {
                energyPoint.sprite.parent.removeChild(energyPoint.sprite);
              }
              gameState.energyPoints.delete(id);
              
              // Crea un nuovo punto energia in una posizione casuale
              const newX = Math.random() * WORLD_CONFIG.width;
              const newY = Math.random() * WORLD_CONFIG.height;
              
              const newEnergySprite = createEnergyPoint(newX, newY);
              if (newEnergySprite) {
                const newId = Date.now();
                gameState.energyPoints.set(newId, {
                  id: newId,
                  sprite: newEnergySprite,
                  x: newX,
                  y: newY,
                  value: ENERGY_VALUE
                });
              }
              
              // Aggiorna l'interfaccia
              if (document.getElementById('score-value')) {
                document.getElementById('score-value').textContent = player.score;
              }
              
              // Mostra un effetto visivo
              showMessage(`+${energyPoint.value} punti`, 'success');
            }
          }
        });
      }
    }
  } catch (error) {
    console.error('Errore nel game loop:', error);
  }
}

// Inizializza i controlli del gioco
function initControls() {
  try {
    console.log('Inizializzazione controlli...');
    
    // Pulisci eventuali listener precedenti
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    
    // Registra gli eventi tastiera
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    // Inizializza il joystick virtuale su mobile
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      console.log('Dispositivo mobile rilevato, inizializzazione joystick virtuale');
      initVirtualJoystick();
    }
    
    console.log('Controlli inizializzati');
  } catch (error) {
    console.error('Errore inizializzazione controlli:', error);
  }
}

// Gestione eventi tastiera
function handleKeyDown(event) {
  gameState.keys[event.key] = true;
  
  // Previeni lo scrolling della pagina con le frecce
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
    event.preventDefault();
  }
}

function handleKeyUp(event) {
  gameState.keys[event.key] = false;
}

// Inizializza joystick virtuale per dispositivi mobili
function initVirtualJoystick() {
  try {
    // Verifica se l'elemento joystick esiste
    let joystickContainer = document.getElementById('joystick-container');
    
    // Se non esiste, crealo
    if (!joystickContainer) {
      joystickContainer = document.createElement('div');
      joystickContainer.id = 'joystick-container';
      joystickContainer.style.position = 'fixed';
      joystickContainer.style.bottom = '50px';
      joystickContainer.style.left = '50px';
      joystickContainer.style.width = '100px';
      joystickContainer.style.height = '100px';
      joystickContainer.style.borderRadius = '50%';
      joystickContainer.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
      joystickContainer.style.touchAction = 'none';
      joystickContainer.style.zIndex = '1000';
      
      // Crea il pomello del joystick
      const joystickKnob = document.createElement('div');
      joystickKnob.id = 'joystick-knob';
      joystickKnob.style.position = 'absolute';
      joystickKnob.style.top = '50%';
      joystickKnob.style.left = '50%';
      joystickKnob.style.transform = 'translate(-50%, -50%)';
      joystickKnob.style.width = '40px';
      joystickKnob.style.height = '40px';
      joystickKnob.style.borderRadius = '50%';
      joystickKnob.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
      
      joystickContainer.appendChild(joystickKnob);
      document.body.appendChild(joystickContainer);
    }
    
    // Coordinate del centro del joystick
    const center = {
      x: joystickContainer.offsetLeft + joystickContainer.offsetWidth / 2,
      y: joystickContainer.offsetTop + joystickContainer.offsetHeight / 2
    };
    
    // Raggio massimo del joystick
    const maxRadius = joystickContainer.offsetWidth / 2;
    
    // Ottieni il pomello
    const knob = document.getElementById('joystick-knob');
    
    // Handler per touch start
    joystickContainer.addEventListener('touchstart', (event) => {
      event.preventDefault();
      gameState.joystick.active = true;
      updateJoystickPosition(event);
    });
    
    // Handler per touch move
    joystickContainer.addEventListener('touchmove', (event) => {
      event.preventDefault();
      if (gameState.joystick.active) {
        updateJoystickPosition(event);
      }
    });
    
    // Handler per touch end
    joystickContainer.addEventListener('touchend', (event) => {
      event.preventDefault();
      gameState.joystick.active = false;
      gameState.joystick.dx = 0;
      gameState.joystick.dy = 0;
      
      // Riporta il pomello al centro
      knob.style.left = '50%';
      knob.style.top = '50%';
      knob.style.transform = 'translate(-50%, -50%)';
    });
    
    // Funzione per aggiornare la posizione del joystick
    function updateJoystickPosition(event) {
      const touch = event.touches[0];
      
      // Calcola la distanza dal centro
      let dx = touch.clientX - center.x;
      let dy = touch.clientY - center.y;
      
      // Calcola la distanza totale
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Limita la distanza al raggio massimo
      if (distance > maxRadius) {
        const ratio = maxRadius / distance;
        dx *= ratio;
        dy *= ratio;
      }
      
      // Aggiorna la posizione del pomello
      knob.style.left = `calc(50% + ${dx}px)`;
      knob.style.top = `calc(50% + ${dy}px)`;
      
      // Aggiorna i valori del joystick
      gameState.joystick.dx = dx;
      gameState.joystick.dy = dy;
    }
    
    console.log('Joystick virtuale inizializzato');
  } catch (error) {
    console.error('Errore inizializzazione joystick virtuale:', error);
  }
}

// Funzioni per la gestione dei messaggi WebSocket

// Aggiorna lo stato del mondo
function updateWorldState(data) {
  try {
    // Aggiorna la posizione dei giocatori
    if (data.players) {
      data.players.forEach(playerData => {
        // Non aggiornare il giocatore locale
        if (playerData.id === gameState.playerId) {
          return;
        }
        
        // Verifica se il giocatore esiste
        if (gameState.players.has(playerData.id)) {
          const player = gameState.players.get(playerData.id);
          
          // Aggiorna i dati del giocatore
          player.x = playerData.x;
          player.y = playerData.y;
          player.size = playerData.size;
          player.score = playerData.score;
          
          // Aggiorna la posizione dello sprite
          if (player.sprite) {
            player.sprite.x = player.x;
            player.sprite.y = player.y;
            
            // Aggiorna la dimensione dello sprite
            player.sprite.width = player.size;
            player.sprite.height = player.size;
            
            // Aggiorna la posizione del nome
            if (player.sprite.children && player.sprite.children[1]) {
              player.sprite.children[1].y = -player.size / 2 - 20;
            }
          }
        } else {
          // Crea un nuovo giocatore
          const sprite = createPlayerSprite(playerData.id, false, playerData.size);
          
          if (sprite) {
            sprite.x = playerData.x;
            sprite.y = playerData.y;
            
            gameState.players.set(playerData.id, {
              id: playerData.id,
              sprite: sprite,
              x: playerData.x,
              y: playerData.y,
              size: playerData.size,
              name: playerData.name || `Player ${playerData.id.substring(0, 4)}`,
              score: playerData.score || 0
            });
          }
        }
      });
    }
    
    // Aggiorna i punti energia
    if (data.energyPoints) {
      // Rimuovi i punti energia che non esistono più
      gameState.energyPoints.forEach((point, id) => {
        if (!data.energyPoints.find(p => p.id === id)) {
          if (point.sprite && point.sprite.parent) {
            point.sprite.parent.removeChild(point.sprite);
          }
          gameState.energyPoints.delete(id);
        }
      });
      
      // Aggiorna o crea i nuovi punti energia
      data.energyPoints.forEach(pointData => {
        if (!gameState.energyPoints.has(pointData.id)) {
          const sprite = createEnergyPoint(pointData.x, pointData.y);
          
          if (sprite) {
            gameState.energyPoints.set(pointData.id, {
              id: pointData.id,
              sprite: sprite,
              x: pointData.x,
              y: pointData.y,
              value: pointData.value || ENERGY_VALUE
            });
          }
        }
      });
    }
  } catch (error) {
    console.error('Errore nell\'aggiornamento dello stato del mondo:', error);
  }
}

// Gestisci l'ingresso di un nuovo giocatore
function handlePlayerJoined(playerData) {
  try {
    // Verifica se il giocatore esiste già
    if (gameState.players.has(playerData.id)) {
      return;
    }
    
    // Crea lo sprite per il nuovo giocatore
    const sprite = createPlayerSprite(playerData.id, false, playerData.size || INITIAL_SIZE);
    
    if (sprite) {
      sprite.x = playerData.x || WORLD_CONFIG.width / 2;
      sprite.y = playerData.y || WORLD_CONFIG.height / 2;
      
      gameState.players.set(playerData.id, {
        id: playerData.id,
        sprite: sprite,
        x: sprite.x,
        y: sprite.y,
        size: playerData.size || INITIAL_SIZE,
        name: playerData.name || `Player ${playerData.id.substring(0, 4)}`,
        score: playerData.score || 0
      });
      
      // Mostra un messaggio
      showMessage(`${playerData.name || 'Un nuovo giocatore'} è entrato!`, 'info');
    }
  } catch (error) {
    console.error('Errore nella gestione del nuovo giocatore:', error);
  }
}

// Gestisci l'uscita di un giocatore
function handlePlayerLeft(playerData) {
  try {
    // Verifica se il giocatore esiste
    if (!gameState.players.has(playerData.id)) {
      return;
    }
    
    // Recupera i dati del giocatore
    const player = gameState.players.get(playerData.id);
    
    // Rimuovi lo sprite
    if (player.sprite && player.sprite.parent) {
      player.sprite.parent.removeChild(player.sprite);
    }
    
    // Rimuovi il giocatore dalla mappa
    gameState.players.delete(playerData.id);
    
    // Mostra un messaggio
    showMessage(`${player.name || 'Un giocatore'} è uscito!`, 'info');
  } catch (error) {
    console.error('Errore nella gestione dell\'uscita del giocatore:', error);
  }
}

// Aggiorna i punti energia
function updateEnergy(energyData) {
  try {
    // Rimuovi i punti energia che non esistono più
    gameState.energyPoints.forEach((point, id) => {
      if (!energyData.find(p => p.id === id)) {
        if (point.sprite && point.sprite.parent) {
          point.sprite.parent.removeChild(point.sprite);
        }
        gameState.energyPoints.delete(id);
      }
    });
    
    // Aggiorna o crea i nuovi punti energia
    energyData.forEach(pointData => {
      if (!gameState.energyPoints.has(pointData.id)) {
        const sprite = createEnergyPoint(pointData.x, pointData.y);
        
        if (sprite) {
          gameState.energyPoints.set(pointData.id, {
            id: pointData.id,
            sprite: sprite,
            x: pointData.x,
            y: pointData.y,
            value: pointData.value || ENERGY_VALUE
          });
        }
      }
    });
  } catch (error) {
    console.error('Errore nell\'aggiornamento dei punti energia:', error);
  }
}