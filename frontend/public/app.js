// Configurazione PixiJS
let app;
let socket;
let reconnectAttempts = 0;
const msgpack = window.msgpack5();

// Configurazione mondo di gioco
const WORLD_CONFIG = {
  width: 3000,
  height: 3000,
  minZoom: 0.5,  // Zoom minimo (piÃ¹ lontano)
  maxZoom: 1.2,  // Zoom massimo (piÃ¹ vicino)
  padding: 50    // Padding dai bordi
};

// Variabili di configurazione
const PLAYER_SPEED = 5;
const INTERPOLATION_FACTOR = 0.3;
const WS_URL = getEnvVar('VITE_WS_URL', 'wss://brawl-legends-backend.onrender.com');
const MAX_ENERGY_POINTS = 30;  // Numero massimo di punti energia sulla mappa
const ENERGY_VALUE = 5;        // Valore di ogni punto energia
const INITIAL_SIZE = 20;       // Dimensione iniziale dei giocatori
const MAX_SIZE = 50;           // Dimensione massima raggiungibile (ridotta da 100)
const LEVEL_THRESHOLDS = [     // Soglie per livelli di evoluzione
    { level: 1, size: INITIAL_SIZE, name: "Novizio" },
    { level: 2, size: 30, name: "Guerriero", ability: "speed" },
    { level: 3, size: 40, name: "Campione", ability: "shield" },
    { level: 4, size: MAX_SIZE, name: "Leggenda", ability: "attack" }
];

// Configurazione mobile
const MOBILE_CONFIG = {
  joystickSize: 120,
  buttonSize: 80,
  controlsOpacity: 0.6,
  inactivityTimeout: 3000 // ms prima che i controlli svaniscano quando inattivi
};

// Classe per la predizione avanzata del movimento
class MovementPredictor {
  constructor() {
    this.buffer = [];
    this.latency = 100; // Latenza simulata in ms
    this.maxSamples = 10; // Massimo numero di snapshot da memorizzare
    this.lastReconciliation = 0; // Timestamp dell'ultima riconciliazione
    
    // Stato attuale predetto
    this.current = null;
    
    // Tolleranza per riconciliazione (quanto deve essere grande la differenza)
    this.reconciliationThreshold = 50;
  }
  
  // Aggiungi un nuovo snapshot al buffer
  addSnapshot(snapshot) {
    if (!snapshot) return;
    
    this.buffer.push({
      ...snapshot,
      timestamp: Date.now()
    });
    
    // Mantieni solo gli ultimi N snapshot
    if (this.buffer.length > this.maxSamples) {
      this.buffer.shift();
    }
  }
  
  // Predici lo stato attuale in base al buffer di snapshot
  predict(currentState) {
    // Se non abbiamo abbastanza dati o uno stato corrente, ritorna quello che abbiamo
    if (this.buffer.length < 2 || !currentState) {
      this.current = currentState;
      return currentState;
    }
    
    const now = Date.now();
    const renderTime = now - this.latency;
    
    // Trova i due snapshot piÃ¹ vicini al tempo di rendering
    let prev = this.buffer[0];
    let next = this.buffer[1];
    
    for (let i = 1; i < this.buffer.length; i++) {
      if (this.buffer[i].timestamp > renderTime) {
        prev = this.buffer[i-1];
        next = this.buffer[i];
        break;
      }
    }
    
    // Se non abbiamo snapshot validi, ritorna lo stato corrente
    if (!prev || !next || prev.timestamp === next.timestamp) {
      this.current = currentState;
      return currentState;
    }
    
    // Calcola il fattore di interpolazione (0-1)
    const t = Math.max(0, Math.min(1, (renderTime - prev.timestamp) / (next.timestamp - prev.timestamp)));
    
    // Interpola tra i due stati
    const predicted = {
      x: prev.x + (next.x - prev.x) * t,
      y: prev.y + (next.y - prev.y) * t
    };
    
    // Aggiorna lo stato corrente
    this.current = predicted;
    return predicted;
  }
  
  // Riconcilia la predizione con lo stato effettivo dal server
  reconcile(serverState) {
    if (!this.current || !serverState) return serverState;
    
    // Calcola la differenza tra lo stato predetto e quello del server
    const dx = serverState.x - this.current.x;
    const dy = serverState.y - this.current.y;
    const distance = Math.sqrt(dx*dx + dy*dy);
    
    // Se la differenza Ã¨ troppo grande, applica una correzione graduale
    if (distance > this.reconciliationThreshold) {
      console.log(`Riconciliazione stato: differenza ${distance.toFixed(2)}px`);
      
      // Applica correzione al 20% per evitare teletrasporti bruschi
      const correctionFactor = 0.2;
      const corrected = {
        x: this.current.x + dx * correctionFactor,
        y: this.current.y + dy * correctionFactor
      };
      
      this.lastReconciliation = Date.now();
      return corrected;
    }
    
    // Se la differenza Ã¨ accettabile, mantieni lo stato corrente
    return this.current;
  }
}

// Sistema di rendering ottimizzato
const renderQualityManager = {
  settings: {
    maxParticles: 500,
    qualityLevels: {
      low: {
        resolution: 0.5,
        antialias: false,
        particleDensity: 0.3,
        maxParticles: 100,
        filterLevel: 0
      },
      medium: {
        resolution: 0.8,
        antialias: true,
        particleDensity: 0.6,
        maxParticles: 300,
        filterLevel: 1
      },
      high: {
        resolution: 1.0,
        antialias: true,
        particleDensity: 1.0,
        maxParticles: 500,
        filterLevel: 2
      }
    },
    autoAdjust: true,
    currentQuality: 'medium',
    fpsTarget: 55,
    fpsLow: 25,
    fpsHistory: []
  },
  
  // Rileva il livello di prestazioni del dispositivo
  detectPerformanceLevel() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) return 'low';
      
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const isOldDevice = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2;
      
      // Valuta il device
      if (isMobile || isOldDevice) {
        return 'medium';
      } else {
        // Info sulla GPU se disponibile
        const gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (gpuInfo) {
          const renderer = gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL);
          if (renderer) {
            // Rileva GPU di bassa potenza
            const lowEndGPUs = ['intel', 'hd graphics', 'intelhd', 'gma', 'mesa'];
            if (lowEndGPUs.some(gpu => renderer.toLowerCase().includes(gpu))) {
              return 'medium';
            }
          }
        }
        
        return 'high';
      }
    } catch (e) {
      console.warn('Errore nel rilevamento prestazioni:', e);
      return 'medium'; // Default
    }
  },
  
  // Applica le impostazioni di qualitÃ 
  applyQuality(level) {
    if (!this.settings.qualityLevels[level]) {
      console.error(`Livello di qualitÃ  non valido: ${level}`);
      return false;
    }
    
    const settings = this.settings.qualityLevels[level];
    this.settings.currentQuality = level;
    
    // Applica le impostazioni di rendering se PIXI Ã¨ inizializzato
    if (app && app.renderer) {
      console.log(`Applicazione qualitÃ  ${level}: resolution=${settings.resolution}`);
      
      // Imposta la risoluzione del renderer
      app.renderer.resolution = settings.resolution;
      
      // Gestisci i filtri in base al livello di qualitÃ 
      this.updateFilters(settings.filterLevel);
      
      // Memorizza la densitÃ  particelle per futuri effetti
      gameState.particleDensity = settings.particleDensity;
      gameState.maxParticles = settings.maxParticles;
    }
    
    return true;
  },
  
  // Aggiorna l'uso di filtri e effetti
  updateFilters(level) {
    // A seconda del livello, abilita o disabilita effetti specifici
    if (level <= 0) {
      // Disabilita tutti gli effetti avanzati
      gameState.useAdvancedEffects = false;
    } else {
      // Abilita effetti in base al livello
      gameState.useAdvancedEffects = true;
    }
  },
  
  // Monitora gli FPS e regola la qualitÃ  automaticamente
  monitorPerformance(fps) {
    if (!this.settings.autoAdjust) return;
    
    // Mantieni una storia degli FPS
    this.settings.fpsHistory.push(fps);
    if (this.settings.fpsHistory.length > 30) {
      this.settings.fpsHistory.shift();
    }
    
    // Calcola la media degli FPS
    const avgFps = this.settings.fpsHistory.reduce((sum, val) => sum + val, 0) / this.settings.fpsHistory.length;
    
    // Regola qualitÃ  se necessario
    if (this.settings.fpsHistory.length >= 30) {
      if (avgFps < this.settings.fpsLow && this.settings.currentQuality !== 'low') {
        console.log(`Performance bassa (${avgFps.toFixed(1)} FPS): passaggio a qualitÃ  bassa`);
        this.applyQuality('low');
      } else if (avgFps > this.settings.fpsTarget * 1.2 && this.settings.currentQuality === 'low') {
        console.log(`Performance buona (${avgFps.toFixed(1)} FPS): passaggio a qualitÃ  media`);
        this.applyQuality('medium');
      } else if (avgFps > this.settings.fpsTarget * 1.5 && this.settings.currentQuality === 'medium') {
        console.log(`Performance eccellente (${avgFps.toFixed(1)} FPS): passaggio a qualitÃ  alta`);
        this.applyQuality('high');
      }
    }
  },
  
  // Inizializza il gestore qualitÃ 
  init() {
    // Rileva e imposta la qualitÃ  iniziale
    const initialQuality = this.detectPerformanceLevel();
    console.log(`Livello prestazioni rilevato: ${initialQuality}`);
    this.applyQuality(initialQuality);
    
    // Aggiungi dati alla configurazione di gioco
    gameState.particleDensity = this.settings.qualityLevels[initialQuality].particleDensity;
    gameState.maxParticles = this.settings.qualityLevels[initialQuality].maxParticles;
    gameState.useAdvancedEffects = initialQuality !== 'low';
    
    return initialQuality;
  },
};

// Estensione della classe DynamicCamera con funzionalitÃ  avanzate
class DynamicCamera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.deadZone = 50;
    this.smoothFactor = 0.1;
    this.zoomSmoothFactor = 0.05;
    this.container = null;
    this.worldContainer = null;
    
    // Configurazione avanzata
    this.advancedConfig = {
      maxPlayersForZoom: 8,
      zoomDecayFactor: 0.93,
      playerWeight: 0.7,
      mapWeight: 0.3,
      smoothTransition: {
        position: 0.08,
        zoom: 0.05
      }
    };
    
    // Limiti della camera
    this.bounds = {
      left: 0,
      top: 0,
      right: WORLD_CONFIG.width,
      bottom: WORLD_CONFIG.height
    };
  }
  
  // Inizializza la camera con i container PIXI.js
  init(app) {
    if (!app || !app.stage) {
      console.error("Impossibile inizializzare la camera: app non disponibile");
      return false;
    }
    
    // Crea un container principale
    this.container = new PIXI.Container();
    app.stage.addChild(this.container);
    
    // Crea un container per il mondo di gioco
    this.worldContainer = new PIXI.Container();
    this.container.addChild(this.worldContainer);
    
    // Container per l'interfaccia (non influenzato dalla camera)
    this.uiContainer = new PIXI.Container();
    app.stage.addChild(this.uiContainer);
    
    // Inizializza al centro del mondo
    this.x = WORLD_CONFIG.width / 2;
    this.y = WORLD_CONFIG.height / 2;
    this.targetX = this.x;
    this.targetY = this.y;
    
    console.log("Camera dinamica avanzata inizializzata");
    return true;
  }
  
  // Calcola lo zoom ottimale basato sulla distribuzione dei giocatori
  calculateOptimalZoom(players) {
    // Se non ci sono sufficienti giocatori, usa la formula semplice
    if (!players || players.size <= 1) {
      return WORLD_CONFIG.maxZoom;
    }
    
    // Raccogli le posizioni di tutti i giocatori
    const playerPositions = Array.from(players.values()).map(p => ({x: p.x, y: p.y}));
    
    // Calcola i confini del gruppo di giocatori
    const bounds = this.calculatePlayersBounds(playerPositions);
    
    // Se i confini non sono validi, usa lo zoom predefinito
    if (bounds.minX === Infinity || bounds.maxX === -Infinity) {
      return WORLD_CONFIG.maxZoom;
    }
    
    // Calcola le dimensioni dei confini
    const screenAspect = window.innerWidth / window.innerHeight;
    const boundsWidth = bounds.maxX - bounds.minX;
    const boundsHeight = bounds.maxY - bounds.minY;
    
    // Evita divisione per zero
    if (boundsWidth === 0 || boundsHeight === 0) {
      return WORLD_CONFIG.maxZoom;
    }
    
    // Calcola lo zoom basato sui confini del gruppo di giocatori e sulla mappa
    const zoomX = (window.innerWidth - 100) / (boundsWidth * this.advancedConfig.playerWeight + WORLD_CONFIG.width * this.advancedConfig.mapWeight);
    const zoomY = (window.innerHeight - 100) / (boundsHeight * this.advancedConfig.playerWeight + WORLD_CONFIG.height * this.advancedConfig.mapWeight);
    
    // Usa il minore dei due zoom e applica il fattore di decadimento per piÃ¹ giocatori
    const baseZoom = Math.min(zoomX, zoomY);
    const adjustedZoom = baseZoom * Math.pow(this.advancedConfig.zoomDecayFactor, Math.min(players.size, this.advancedConfig.maxPlayersForZoom));
    
    // Limita lo zoom ai valori min/max
    return Math.max(WORLD_CONFIG.minZoom, Math.min(WORLD_CONFIG.maxZoom, adjustedZoom));
  }
  
  // Calcola i confini per un gruppo di posizioni
  calculatePlayersBounds(positions) {
    if (!positions || positions.length === 0) {
      return {
        minX: 0,
        maxX: WORLD_CONFIG.width,
        minY: 0,
        maxY: WORLD_CONFIG.height
      };
    }
    
    return positions.reduce((acc, pos) => ({
      minX: Math.min(acc.minX, pos.x),
      maxX: Math.max(acc.maxX, pos.x),
      minY: Math.min(acc.minY, pos.y),
      maxY: Math.max(acc.maxY, pos.y)
    }), {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity
    });
  }
  
  // Aggiorna lo zoom usando l'algoritmo avanzato
  updateAdvancedZoom(players, localPlayer) {
    if (!players || !localPlayer) return;
    
    // Calcola lo zoom ottimale
    const optimalZoom = this.calculateOptimalZoom(players);
    
    // Considera anche la dimensione del giocatore locale
    const sizeZoomFactor = 1 - localPlayer.size / 300 * 0.3;
    
    // Prendi il minore dei due fattori
    this.targetZoom = Math.min(optimalZoom, sizeZoomFactor * WORLD_CONFIG.maxZoom);
  }
  
  // Overload di updateZoom per compatibilitÃ 
  updateZoom(playerCount, playerSize) {
    // Fallback al metodo originale se non ci sono giocatori
    if (!gameState.players || gameState.players.size === 0) {
      // Formula logaritmica per scalare lo zoom con il numero di giocatori
      let newZoom = 1 - Math.log(Math.max(playerCount, 1) + 1) * 0.1;
      
      // Considera anche la dimensione del giocatore
      const sizeZoomFactor = 1 - playerSize / 300 * 0.3;
      
      // Prendi il minore dei due fattori
      newZoom = Math.min(newZoom, sizeZoomFactor);
      
      // Limita lo zoom ai valori min/max
      this.targetZoom = Math.max(WORLD_CONFIG.minZoom, 
                          Math.min(WORLD_CONFIG.maxZoom, newZoom));
    } else {
      // Usa il metodo avanzato se ci sono giocatori
      const localPlayer = gameState.players.get(gameState.playerId);
      this.updateAdvancedZoom(gameState.players, localPlayer);
    }
  }
  
  // Aggiorna la camera con interpolazione fluida
  update(delta) {
    if (!this.worldContainer) return;
    
    // Usa i fattori di smooth dalla configurazione avanzata se disponibili
    const positionSmooth = this.advancedConfig.smoothTransition.position || this.smoothFactor;
    const zoomSmooth = this.advancedConfig.smoothTransition.zoom || this.zoomSmoothFactor;
    
    // Interpolazione fluida della posizione
    this.x += (this.targetX - this.x) * positionSmooth * delta;
    this.y += (this.targetY - this.y) * positionSmooth * delta;
    
    // Interpolazione piÃ¹ lenta dello zoom per evitare cambi bruschi
    this.zoom += (this.targetZoom - this.zoom) * zoomSmooth * delta;
    
    // Applica trasformazioni al container del mondo
    this.worldContainer.position.x = app.renderer.width / 2 - this.x * this.zoom;
    this.worldContainer.position.y = app.renderer.height / 2 - this.y * this.zoom;
    this.worldContainer.scale.set(this.zoom);
  }
  
  // Aggiunge un elemento alla scena di gioco
  addToWorld(element) {
    if (this.worldContainer) {
      this.worldContainer.addChild(element);
      return true;
    }
    return false;
  }
  
  // Aggiunge un elemento all'interfaccia (non influenzato dalla camera)
  addToUI(element) {
    if (this.uiContainer) {
      this.uiContainer.addChild(element);
      return true;
    }
    return false;
  }
  
  // Segue un oggetto (es. il giocatore)
  follow(target) {
    if (!target) return;
    
    this.targetX = target.x;
    this.targetY = target.y;
  }
  
  // Zoom rapido temporaneo (es. per visione piÃ¹ ampia)
  zoomOut(factor) {
    this.targetZoom = Math.max(WORLD_CONFIG.minZoom, this.targetZoom * factor);
  }
  
  // Ripristina lo zoom normale
  resetZoom() {
    // Ripristina lo zoom in base al numero di giocatori
    this.updateZoom(gameState.players ? gameState.players.size : 1, 
                   gameState.players && gameState.playerId ? 
                   (gameState.players.get(gameState.playerId)?.size || INITIAL_SIZE) : 
                   INITIAL_SIZE);
  }
}

// Stato del gioco
const gameState = {
    playerId: crypto.randomUUID(),
    players: new Map(),
    energyPoints: new Map(),  // Punti energia sulla mappa
    scores: new Map(),        // Punteggi dei giocatori
    abilities: {
        cooldowns: {
            speed: 0,
            shield: 0,
            attack: 0
        },
        active: {
            speed: false,
            shield: false
        }
    },
    level: 1,
    keys: {
        w: false,
        a: false,
        s: false,
        d: false
    },
    lastUpdate: Date.now(),
    lastPosition: { x: 0, y: 0 },
    projectiles: [],
    lastServerMessage: Date.now(),
    pingInterval: null,
    offlineIntervals: [],
    contextLost: false,
    contextLostTime: 0,
    recoveryInterval: null,
    joystickData: {
        up: false,
        down: false,
        left: false,
        right: false,
        strength: 0
    },
    camera: new DynamicCamera()
};

// Inizializza il contatore FPS
function initFpsCounter() {
  // Crea un nuovo testo per il contatore FPS
  const fpsCounter = new PIXI.Text('FPS: 0', {
    fontFamily: 'Arial',
    fontSize: 14,
    fill: 0x00ff00,
    fontWeight: 'bold',
    stroke: 0x000000,
    strokeThickness: 4,
    dropShadow: true,
    dropShadowColor: 0x000000,
    dropShadowBlur: 4,
    dropShadowAngle: Math.PI / 6,
    dropShadowDistance: 2
  });
  
  // Imposta la posizione e visibilitÃ 
  fpsCounter.x = 10;
  fpsCounter.y = 10;
  fpsCounter.alpha = 0.8;
  fpsCounter.zIndex = 1000;
  
  // Aggiungi al gameState
  gameState.fpsCounter = fpsCounter;
  
  return fpsCounter;
}

// Sistema per aggiornare il contatore FPS e monitorare prestazioni
function updateFpsCounter(fps) {
  if (!gameState.fpsCounter) return;
  
  // Aggiorna il testo del contatore FPS
  gameState.fpsCounter.text = `FPS: ${Math.round(fps)}`;
  
  // Colora il testo in base alla performance
  if (fps >= 50) {
    gameState.fpsCounter.style.fill = 0x00ff00;
  } else if (fps >= 30) {
    gameState.fpsCounter.style.fill = 0xffff00;
  } else {
    gameState.fpsCounter.style.fill = 0xff0000;
  }
  
  // Monitora le prestazioni per regolare la qualitÃ 
  if (renderQualityManager) {
    renderQualityManager.monitorPerformance(fps);
  }
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
         (window.innerWidth <= 800 && window.innerHeight <= 600);
}

// Modifica la funzione initGame per usare il sistema di qualitÃ 
function initGame() {
  console.log("Inizializzazione del gioco");
  
  // Inizializza il gestore qualitÃ  prima di tutto
  const qualityLevel = renderQualityManager.init();
  console.log(`Inizializzazione del gioco con qualitÃ : ${qualityLevel}`);
  
  // Inizializza PixiJS con le impostazioni appropriate
  const success = initPixiJS();
  if (!success) {
    console.error("Fallimento nell'inizializzazione di PixiJS");
    showMessage("Impossibile inizializzare il gioco. Prova un browser diverso o controlla la console per dettagli.", "error");
    
    // Torna alla schermata di login dopo un errore
    setTimeout(() => {
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('game-container').style.display = 'none';
    }, 3000);
    
    return;
  }
  
  // Inizializza la camera prima del resto
  if (!gameState.camera.init(app)) {
    console.error("Errore nell'inizializzazione della camera");
    return;
  }
  
  // Inizializza il contatore FPS e aggiungilo all'UI
  initFpsCounter();
  if (gameState.fpsCounter && gameState.camera) {
    gameState.camera.addToUI(gameState.fpsCounter);
  }
  
  // Inizializza sfondo
  createBackground();
  
  // Inizializza punti energia
  initEnergyPoints();
  
  // Inizializza minimappa
  createMinimap();
  
  // Nasconde la schermata di login
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('game-container').style.display = 'block';
  
  // Rileva e configura controlli mobile se necessario
  setupControls();
  
  // Connetti al server
  connectWebSocket();
  
  // Attiva il sistema di recupero automatico
  setupAutomaticRecovery();
  
  // Imposta il loop di gioco principale
  app.ticker.add(delta => {
    if (gameState.contextLost) return; // Salta il rendering se il contesto Ã¨ perso
    
    // Aggiorna movimento
    updateMovement(delta);
    
    // Aggiorna camera
    updateCamera(delta);
    
    // Interpolazione altri giocatori
    interpolateOtherPlayers(delta);
    
    // Aggiorna punti energia
    updateEnergyPoints(delta);
    
    // Aggiorna contatore FPS
    updateFpsCounter(app.ticker.FPS);
    
    // Aggiorna minimappa
    updateMinimap();
  });
  
  // Includi la funzione updateEnergyPoints dal file separato
  // Funzione per aggiornare i punti energia sulla mappa
  function updateEnergyPoints(delta) {
    if (!gameState.energyPoints || !gameState.players || !gameState.playerId) return;
    
    const localPlayer = gameState.players.get(gameState.playerId);
    if (!localPlayer) return;
    
    // Controlla collisioni con i punti energia
    gameState.energyPoints.forEach((point, index) => {
      // Salta punti giÃ  raccolti
      if (!point.visible) return;
      
      // Calcola distanza tra giocatore e punto energia
      const dx = localPlayer.x - point.x;
      const dy = localPlayer.y - point.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // Se il giocatore tocca il punto energia
      if (distance < localPlayer.size + 10) {
        // Nascondi il punto energia
        point.visible = false;
        
        // Aumenta la dimensione del giocatore
        const newSize = Math.min(MAX_SIZE, localPlayer.size + ENERGY_VALUE);
        localPlayer.size = newSize;
        
        // Aggiorna la grafica del giocatore
        if (localPlayer.sprite) {
          localPlayer.sprite.scale.set(newSize / INITIAL_SIZE);
        }
        
        // Crea effetto particellare se abilitato
        if (gameState.useAdvancedEffects) {
          createParticleEffect(point.x, point.y, 0x00ff88, 20);
        }
        
        // Invia aggiornamento al server
        if (socket && socket.readyState === WebSocket.OPEN) {
          const message = {
            type: 'collectEnergy',
            id: gameState.playerId,
            size: newSize,
            pointIndex: index
          };
          socket.send(msgpack.encode(message));
        }
        
        // Controlla se il giocatore ha raggiunto un nuovo livello
        checkLevelUp(newSize);
        
        // Dopo un po' di tempo, ripristina il punto energia in una nuova posizione
        setTimeout(() => {
          if (!gameState.energyPoints || typeof gameState.energyPoints.has !== 'function' || !gameState.energyPoints.has(index)) return;
          
          // Nuova posizione casuale
          const padding = 100;
          const x = padding + Math.random() * (WORLD_CONFIG.width - padding * 2);
          const y = padding + Math.random() * (WORLD_CONFIG.height - padding * 2);
          
          point.x = x;
          point.y = y;
          point.visible = true;
        }, 10000); // 10 secondi
      }
    });
  }
  
  console.log("Gioco inizializzato con successo");
}

// Funzione per aggiornare i punti energia sulla mappa
function updateEnergyPoints(delta) {
  if (!gameState.energyPoints || !gameState.players || !gameState.playerId) return;
  
  const localPlayer = gameState.players.get(gameState.playerId);
  if (!localPlayer) return;
  
  // Controlla collisioni con i punti energia
  gameState.energyPoints.forEach((point, index) => {
    // Salta punti giÃ  raccolti
    if (!point.visible) return;
    
    // Calcola distanza tra giocatore e punto energia
    const dx = localPlayer.x - point.x;
    const dy = localPlayer.y - point.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Se il giocatore tocca il punto energia
    if (distance < localPlayer.size + 10) {
      // Nascondi il punto energia
      point.visible = false;
      
      // Aumenta la dimensione del giocatore
      const newSize = Math.min(MAX_SIZE, localPlayer.size + ENERGY_VALUE);
      localPlayer.size = newSize;
      
      // Aggiorna la grafica del giocatore
      if (localPlayer.sprite) {
        localPlayer.sprite.scale.set(newSize / INITIAL_SIZE);
      }
      
      // Crea effetto particellare se abilitato
      if (gameState.useAdvancedEffects) {
        createParticleEffect(point.x, point.y, 0x00ff88, 20);
      }
      
      // Invia aggiornamento al server
      if (socket && socket.readyState === WebSocket.OPEN) {
        const message = {
          type: 'collectEnergy',
          id: gameState.playerId,
          size: newSize,
          pointIndex: index
        };
        socket.send(msgpack.encode(message));
      }
      
      // Controlla se il giocatore ha raggiunto un nuovo livello
      checkLevelUp(newSize);
      
      // Dopo un po' di tempo, ripristina il punto energia in una nuova posizione
      setTimeout(() => {
        if (!gameState.energyPoints || typeof gameState.energyPoints.has !== 'function' || !gameState.energyPoints.has(index)) return;
        
        // Nuova posizione casuale
        const padding = 100;
        const x = padding + Math.random() * (WORLD_CONFIG.width - padding * 2);
        const y = padding + Math.random() * (WORLD_CONFIG.height - padding * 2);
        
        point.x = x;
        point.y = y;
        point.visible = true;
      }, 10000); // 10 secondi
    }
  });
}

// Funzione per controllare se il giocatore ha raggiunto un nuovo livello
function checkLevelUp(newSize) {
  // Trova il livello corrispondente alla nuova dimensione
  let newLevel = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (newSize >= LEVEL_THRESHOLDS[i].size) {
      newLevel = LEVEL_THRESHOLDS[i].level;
      break;
    }
  }
  
  // Se il livello Ã¨ cambiato
  if (newLevel > gameState.level) {
    gameState.level = newLevel;
    
    // Trova il nome del livello
    const levelInfo = LEVEL_THRESHOLDS.find(t => t.level === newLevel);
    
    // Mostra messaggio di avanzamento
    showMessage(`Hai raggiunto il livello ${newLevel}: ${levelInfo.name}!`, 'success');
    
    // Se il livello ha un'abilitÃ , mostra un messaggio
    if (levelInfo.ability) {
      showMessage(`Hai sbloccato l'abilitÃ : ${getAbilityName(levelInfo.ability)}!`, 'info');
    }
  };
}

// Funzione per ottenere il nome dell'abilitÃ 
function getAbilityName(abilityKey) {
  const abilityNames = {
    'speed': 'VelocitÃ ',
    'shield': 'Scudo',
    'attack': 'Attacco'
  };
  
  return abilityNames[abilityKey] || abilityKey;
}

// Funzione per creare un effetto particellare
function createParticleEffect(x, y, color, count) {
  if (!gameState.useAdvancedEffects) return;
  
  const particleCount = Math.min(count, gameState.maxParticles / 10);
  
  for (let i = 0; i < particleCount; i++) {
    const particle = new PIXI.Graphics();
    particle.beginFill(color, 0.8);
    particle.drawCircle(0, 0, 2 + Math.random() * 3);
    particle.endFill();
    particle.x = x;
    particle.y = y;
    
    // VelocitÃ  e direzione casuale
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 3;
    particle.vx = Math.cos(angle) * speed;
    particle.vy = Math.sin(angle) * speed;
    
    // Durata di vita
    particle.life = 30 + Math.random() * 30;
    
    // Aggiungi alla scena
    gameState.camera.addToWorld(particle);
    
    // Animazione
    gsap.to(particle, {
      alpha: 0,
      duration: particle.life / 60,
      onComplete: () => {
        if (particle.parent) particle.parent.removeChild(particle);
      }
    });
    
    // Aggiorna la posizione della particella ad ogni frame
    app.ticker.add(() => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.life--;
      
      if (particle.life <= 0 && particle.parent) {
        particle.parent.removeChild(particle);
        app.ticker.remove(arguments.callee);
      }
    });
  };
}

// Funzione per aggiornare la camera
  
  console.log("Gioco inizializzato con successo");

// Funzione per aggiornare la camera
function updateCamera(delta) {
  // Se non c'Ã¨ camera o giocatore, non fare nulla
  if (!gameState.camera || !gameState.players.has(gameState.playerId)) return;
  
  const player = gameState.players.get(gameState.playerId);
  
  // Segui il giocatore
  gameState.camera.follow(player);
  
  // Aggiorna lo zoom in base al numero di giocatori e dimensione del player
  gameState.camera.updateZoom(
    gameState.players.size,
    player.size || INITIAL_SIZE
  );
  
  // Aggiorna la camera
  gameState.camera.update(delta);
}

// Funzione per creare la minimappa
function createMinimap() {
  if (!gameState.camera) return;
  
  // Container per la minimappa
  const minimapContainer = new PIXI.Container();
  
  // Dimensione della minimappa
  const minimapSize = 150;
  const padding = 10;
  
  // Sfondo
  const background = new PIXI.Graphics();
  background.beginFill(0x000000, 0.5);
  background.drawRoundedRect(0, 0, minimapSize, minimapSize, 5);
  background.endFill();
  minimapContainer.addChild(background);
  
  // Bordo del mondo
  const worldBorder = new PIXI.Graphics();
  worldBorder.lineStyle(1, 0x00ff88, 0.8);
  worldBorder.drawRect(5, 5, minimapSize - 10, minimapSize - 10);
  minimapContainer.addChild(worldBorder);
  
  // Container per punti dei giocatori
  const playersContainer = new PIXI.Container();
  minimapContainer.addChild(playersContainer);
  
  // Posiziona la minimappa nell'angolo
  minimapContainer.x = app.renderer.width - minimapSize - padding;
  minimapContainer.y = app.renderer.height - minimapSize - padding;
  
  // Memorizza riferimenti nel gameState
  gameState.minimap = {
    container: minimapContainer,
    playersContainer: playersContainer,
    size: minimapSize,
    worldRatio: Math.min(
      (minimapSize - 10) / WORLD_CONFIG.width,
      (minimapSize - 10) / WORLD_CONFIG.height
    )
  };
  
  // Aggiungi la minimappa all'UI (non influenzata dalla camera)
  gameState.camera.addToUI(minimapContainer);
}

// Funzione per aggiornare la minimappa
function updateMinimap() {
  if (!gameState.minimap || !gameState.minimap.playersContainer) return;
  
  // Pulisci i vecchi punti
  gameState.minimap.playersContainer.removeChildren();
  
  // Disegna un punto per ogni giocatore
  gameState.players.forEach((player, id) => {
    const isLocalPlayer = id === gameState.playerId;
    
    // Crea punto
    const point = new PIXI.Graphics();
    
    // Dimensione basata sulla dimensione del giocatore
    const pointSize = Math.max(3, Math.min(8, player.size / 30));
    
    // Colori diversi per giocatore locale e altri
    point.beginFill(isLocalPlayer ? 0x00ff00 : 0xff3333, 0.8);
    point.drawCircle(0, 0, pointSize);
    point.endFill();
    
    // Posizione proporzionale alla mappa
    point.x = 5 + player.x * gameState.minimap.worldRatio;
    point.y = 5 + player.y * gameState.minimap.worldRatio;
    
    // Aggiungi punto alla minimappa
    gameState.minimap.playersContainer.addChild(point);
    
    // Se Ã¨ il giocatore locale, aggiungi indicatore di direzione
    if (isLocalPlayer) {
      const viewRect = new PIXI.Graphics();
      viewRect.lineStyle(1, 0x00ff00, 0.5);
      
      // Calcola visuale corrente
      const viewWidth = app.renderer.width / gameState.camera.zoom;
      const viewHeight = app.renderer.height / gameState.camera.zoom;
      const viewX = gameState.camera.x - viewWidth/2;
      const viewY = gameState.camera.y - viewHeight/2;
      
      // Disegna rettangolo di visuale sulla minimappa
      viewRect.drawRect(
        5 + viewX * gameState.minimap.worldRatio,
        5 + viewY * gameState.minimap.worldRatio,
        viewWidth * gameState.minimap.worldRatio,
        viewHeight * gameState.minimap.worldRatio
      );
      
      gameState.minimap.playersContainer.addChild(viewRect);
    }
  });
}

/* Rimuovo l'inizializzazione duplicata qui poichÃ© giÃ  definita alla riga ~1600 */
// Aggiungi il predictor al gameState

// Verifica e gestisce l'orientamento del dispositivo mobile
function handleDeviceOrientation() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
        // Verifica dimensioni e orientamento
        const checkOrientation = () => {
            const isLandscape = window.innerWidth > window.innerHeight;
            let orientationMessage = document.getElementById('orientation-message');
            
            if (!orientationMessage) {
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
                message.style.alignItems = 'center';
                message.style.justifyContent = 'center';
                message.style.zIndex = '1000';
                message.style.textAlign = 'center';
                message.style.fontSize = '1.2rem';
                message.style.padding = '20px';
                message.style.boxSizing = 'border-box';
                document.body.appendChild(message);
                orientationMessage = message;
            }
            
            if (!isLandscape) {
                orientationMessage.innerHTML = 'Per una migliore esperienza di gioco,<br>ruota il dispositivo in modalitÃ  orizzontale.';
                orientationMessage.style.display = 'flex';
            } else {
                orientationMessage.style.display = 'none';
            }
        };
        
        // Controlla all'avvio
        checkOrientation();
        
        // Aggiungi listener per il cambio di orientamento
        window.addEventListener('resize', checkOrientation);
        window.addEventListener('orientationchange', checkOrientation);
    };
}

        // Verifica le dimensioni e orientamento per dispositivi mobili
        handleDeviceOrientation();

// Funzione per ottenere variabili d'ambiente
function getEnvVar(name, defaultValue) {
  if (typeof window !== 'undefined' && window.env && window.env[name]) {
    return window.env[name];
  }
  return defaultValue;
}

// Gestione del ridimensionamento
function setupResizeHandler() {
  window.addEventListener('resize', () => {
    if (!app || !app.renderer) return;
    
    // Aggiorna le dimensioni del renderer
    app.renderer.resize(window.innerWidth, window.innerHeight);
    
    // Aggiorna posizione della minimappa
    if (gameState.minimap && gameState.minimap.container) {
      const minimapSize = gameState.minimap.size;
      const padding = 10;
      gameState.minimap.container.x = app.renderer.width - minimapSize - padding;
      gameState.minimap.container.y = app.renderer.height - minimapSize - padding;
    }
    
    // Aggiorna posizione del contatore FPS
    if (gameState.fpsCounter) {
      gameState.fpsCounter.x = 10;
      gameState.fpsCounter.y = 10;
    }
    
    // Verifica orientamento per dispositivi mobili
    if (typeof handleDeviceOrientation === 'function') {
      handleDeviceOrientation();
    }
  });
}

// Configura i controlli (tastiera o touch)
function setupControls() {
  console.log('Inizializzazione controlli di gioco');
  
  // Stato dei tasti per movimento WASD
  const keyState = {};
  
  // Gestione input da tastiera
  function handleKeyDown(e) {
    keyState[e.key.toLowerCase()] = true;
    
    // Gestione abilitÃ  con tasti numerici
    if (e.key >= '1' && e.key <= '3') {
      const abilityIndex = parseInt(e.key) - 1;
      activateAbility(abilityIndex);
    }
  }
  
  function handleKeyUp(e) {
    keyState[e.key.toLowerCase()] = false;
  }
  
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  
  // Gestione input touch/mouse per dispositivi mobili
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  if (isMobile) {
    console.log('Rilevato dispositivo mobile, configurazione controlli touch');
    setupMobileControls();
  } else {
    // Setup keyboard controls per desktop
    setupKeyboardControls();
  }
  
  // Aggiungi handler abilitÃ 
  setupAbilityControls();
  
  // Funzione per pulire gli event listener quando necessario
  function cleanup() {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    // Rimuovi altri listener se necessario
  }
  
  console.log('Controlli inizializzati correttamente');
  return { keyState, cleanup };
}

// Configura controlli da tastiera
function setupKeyboardControls() {
  // Aggiungi event listener per keydown
  window.addEventListener('keydown', (e) => {
    // Previeni il comportamento predefinito solo per i tasti di movimento
    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
    }
    
    switch (e.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        gameState.keys.w = true;
        break;
      case 'a':
      case 'arrowleft':
        gameState.keys.a = true;
        break;
      case 's':
      case 'arrowdown':
        gameState.keys.s = true;
        break;
      case 'd':
      case 'arrowright':
        gameState.keys.d = true;
        break;
      case '1':
        // Attiva velocitÃ 
        if (gameState.abilities && gameState.abilities.cooldowns.speed <= 0) {
          activateAbility('speed');
        }
        break;
      case '2':
        // Attiva scudo
        if (gameState.abilities && gameState.abilities.cooldowns.shield <= 0) {
          activateAbility('shield');
        }
        break;
      case '3':
        // Attiva attacco
        if (gameState.abilities && gameState.abilities.cooldowns.attack <= 0) {
          activateAbility('attack');
        }
        break;
    }
  });
  
  // Aggiungi event listener per keyup
  window.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        gameState.keys.w = false;
        break;
      case 'a':
      case 'arrowleft':
        gameState.keys.a = false;
        break;
      case 's':
      case 'arrowdown':
        gameState.keys.s = false;
        break;
      case 'd':
      case 'arrowright':
        gameState.keys.d = false;
        break;
    }
  });
}

// Funzione di supporto per i controlli mobile
function setupMobileControls() {
  // Crea joystick virtuale
  const joystickContainer = document.createElement('div');
  joystickContainer.id = 'joystick-container';
  joystickContainer.style.position = 'absolute';
  joystickContainer.style.bottom = '20px';
  joystickContainer.style.left = '20px';
  joystickContainer.style.width = '100px';
  joystickContainer.style.height = '100px';
  joystickContainer.style.borderRadius = '50%';
  joystickContainer.style.backgroundColor = 'rgba(0, 255, 136, 0.2)';
  joystickContainer.style.border = '2px solid rgba(0, 255, 136, 0.5)';
  joystickContainer.style.zIndex = '1000';
  
  const joystick = document.createElement('div');
  joystick.id = 'joystick';
  joystick.style.position = 'absolute';
  joystick.style.top = '50%';
  joystick.style.left = '50%';
  joystick.style.transform = 'translate(-50%, -50%)';
  joystick.style.width = '40px';
  joystick.style.height = '40px';
  joystick.style.borderRadius = '50%';
  joystick.style.backgroundColor = 'rgba(0, 255, 136, 0.8)';
  joystick.style.zIndex = '1001';
  
  joystickContainer.appendChild(joystick);
  document.body.appendChild(joystickContainer);
  
  // Implementa la logica del joystick touch
  // Variabili per il joystick
  let isDragging = false;
  const centerX = 50;
  const centerY = 50;
  
  // Calcola la posizione del joystick
  const getJoystickPosition = (e) => {
    const touch = e.touches[0];
    const rect = joystickContainer.getBoundingClientRect();
    
    // Posizione relativa al centro del joystick
    let x = touch.clientX - rect.left;
    let y = touch.clientY - rect.top;
    
    // Calcola distanza dal centro
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Limita la distanza al raggio del joystick
    const maxDistance = 50;
    if (distance > maxDistance) {
      x = centerX + (dx / distance) * maxDistance;
      y = centerY + (dy / distance) * maxDistance;
    }
    
    return { x, y, distance: Math.min(distance, maxDistance) };
  };
  
  // Aggiorna lo stato del joystick e i dati di movimento
  const updateJoystickState = (x, y, normalizedDistance) => {
    // Aggiorna posizione stick
    joystick.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;
    
    // Calcola direzione e intensitÃ 
    const dx = x - centerX;
    const dy = y - centerY;
    
    // Aggiorna stato joystick in gameState
    gameState.joystickData = {
      up: dy < -10,
      down: dy > 10,
      left: dx < -10,
      right: dx > 10,
      strength: normalizedDistance // Da 0 a 1
    };
  };
  
  // Gestione eventi touch
  joystickContainer.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDragging = true;
    const pos = getJoystickPosition(e);
    updateJoystickState(pos.x, pos.y, pos.distance / 50);
  });
  
  joystickContainer.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!isDragging) return;
    
    const pos = getJoystickPosition(e);
    updateJoystickState(pos.x, pos.y, pos.distance / 50);
  });
  
  const resetJoystick = () => {
    isDragging = false;
    joystick.style.transform = 'translate(-50%, -50%)';
    gameState.joystickData = {
      up: false,
      down: false,
      left: false,
      right: false,
      strength: 0
    };
  };
  
  joystickContainer.addEventListener('touchend', resetJoystick);
  joystickContainer.addEventListener('touchcancel', resetJoystick);
}

// Crea joystick virtuale per controlli mobili
function createJoystick(container) {
  // Crea elemento joystick
  const joystick = document.createElement('div');
  joystick.id = 'joystick';
  joystick.style.width = `${MOBILE_CONFIG.joystickSize}px`;
  joystick.style.height = `${MOBILE_CONFIG.joystickSize}px`;
  joystick.style.borderRadius = '50%';
  joystick.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
  joystick.style.position = 'relative';
  joystick.style.border = '2px solid rgba(255, 255, 255, 0.5)';
  joystick.style.boxSizing = 'border-box';
  
  // Crea stick
  const stick = document.createElement('div');
  stick.id = 'stick';
  stick.style.width = `${MOBILE_CONFIG.joystickSize / 2}px`;
  stick.style.height = `${MOBILE_CONFIG.joystickSize / 2}px`;
  stick.style.borderRadius = '50%';
  stick.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
  stick.style.position = 'absolute';
  stick.style.top = '50%';
  stick.style.left = '50%';
  stick.style.transform = 'translate(-50%, -50%)';
  stick.style.transition = 'transform 0.1s ease-out';
  
  // Aggiungi stick al joystick
  joystick.appendChild(stick);
  
  // Aggiungi joystick al container
  container.appendChild(joystick);
  
  // Variabili per il joystick
  let isDragging = false;
  const centerX = MOBILE_CONFIG.joystickSize / 2;
  const centerY = MOBILE_CONFIG.joystickSize / 2;
  let lastX = centerX;
  let lastY = centerY;
  
  // Calcola la posizione del joystick
  const getJoystickPosition = (e) => {
    const touch = e.touches[0];
    const rect = joystick.getBoundingClientRect();
    
    // Posizione relativa al centro del joystick
    let x = touch.clientX - rect.left;
    let y = touch.clientY - rect.top;
    
    // Calcola distanza dal centro
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Limita la distanza al raggio del joystick
    const maxDistance = MOBILE_CONFIG.joystickSize / 2;
    if (distance > maxDistance) {
      x = centerX + (dx / distance) * maxDistance;
      y = centerY + (dy / distance) * maxDistance;
    }
    
    return { x, y, distance: Math.min(distance, maxDistance) };
  };
  
  // Aggiorna lo stato del joystick e i dati di movimento
  const updateJoystickState = (x, y, normalizedDistance) => {
    // Aggiorna posizione stick
    stick.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;
    
    // Calcola direzione e intensitÃ 
    const dx = x - centerX;
    const dy = y - centerY;
    const angle = Math.atan2(dy, dx);
    
    // Aggiorna stato joystick in gameState
    gameState.joystickData = {
      up: dy < -10,
      down: dy > 10,
      left: dx < -10,
      right: dx > 10,
      strength: normalizedDistance // Da 0 a 1
    };
  };
  
  // Gestione eventi touch
  joystick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDragging = true;
    const pos = getJoystickPosition(e);
    updateJoystickState(pos.x, pos.y, pos.distance / (MOBILE_CONFIG.joystickSize / 2));
  });
  
  joystick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!isDragging) return;
    
    const pos = getJoystickPosition(e);
    updateJoystickState(pos.x, pos.y, pos.distance / (MOBILE_CONFIG.joystickSize / 2));
  });
  
  const resetJoystick = () => {
    isDragging = false;
    stick.style.transform = 'translate(-50%, -50%)';
    gameState.joystickData = {
      up: false,
      down: false,
      left: false,
      right: false,
      strength: 0
    };
  };
  
  joystick.addEventListener('touchend', resetJoystick);
  joystick.addEventListener('touchcancel', resetJoystick);
}

// Funzione per attivare le abilitÃ 
function activateAbility(index) {
  const abilities = ['speed', 'shield', 'attack'];
  const abilityName = abilities[index];
  
  if (abilityName && gameState.abilities && gameState.abilities.cooldowns) {
    // Attiva l'abilitÃ  se disponibile e non in cooldown
    if (gameState.abilities.cooldowns[abilityName] <= 0) {
      console.log(`Attivazione abilitÃ : ${abilityName}`);
      // Logica di attivazione specifica per ogni abilitÃ 
      switch(abilityName) {
        case 'speed':
          // Attiva velocitÃ 
          gameState.abilities.active.speed = true;
          gameState.abilities.cooldowns.speed = 10; // 10 secondi di cooldown
          setTimeout(() => {
            gameState.abilities.active.speed = false;
          }, 3000); // 3 secondi di durata
          break;
        case 'shield':
          // Attiva scudo
          gameState.abilities.active.shield = true;
          gameState.abilities.cooldowns.shield = 15; // 15 secondi di cooldown
          setTimeout(() => {
            gameState.abilities.active.shield = false;
          }, 5000); // 5 secondi di durata
          break;
        case 'attack':
          // Attiva attacco
          useAttackAbility();
          gameState.abilities.cooldowns.attack = 8; // 8 secondi di cooldown
          break;
      }
    }
  };
}

// Crea pulsanti abilitÃ  per dispositivi mobili
function createAbilityButtons(container) {
  const abilitiesContainer = document.createElement('div');
  abilitiesContainer.style.position = 'absolute';
  abilitiesContainer.style.bottom = '10px';
  abilitiesContainer.style.right = '10px';
  abilitiesContainer.style.display = 'flex';
  abilitiesContainer.style.gap = '10px';
  
  // AbilitÃ  disponibili
  const abilities = ['speed', 'shield', 'attack'];
  
  // Crea un pulsante per ogni abilitÃ 
  abilities.forEach((ability, index) => {
    const button = document.createElement('div');
    button.id = `ability-${ability}`;
    button.className = 'ability-button';
    button.style.width = `${MOBILE_CONFIG.buttonSize}px`;
    button.style.height = `${MOBILE_CONFIG.buttonSize}px`;
    button.style.borderRadius = '50%';
    button.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    button.style.border = '2px solid rgba(255, 255, 255, 0.5)';
    button.style.boxSizing = 'border-box';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.fontSize = '24px';
    button.style.color = 'white';
    button.style.textShadow = '0 0 3px rgba(0,0,0,0.8)';
    
    // Aggiungi icona o testo
    button.innerHTML = index + 1;
    
    // Aggiungi al container
    abilitiesContainer.appendChild(button);
    
    // Aggiungi event listeners
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (gameState.abilities && gameState.abilities.cooldowns[ability] <= 0) {
        button.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
        activateAbility(ability);
      }
    });
    
    button.addEventListener('touchend', () => {
      button.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    });
  });
  
  // Aggiungi container abilitÃ  al game container
  document.getElementById('game-container').appendChild(abilitiesContainer);
}

// Configura controlli per abilitÃ  con tasti e pulsanti UI
function setupAbilityControls() {
  // Crea pulsanti UI per abilitÃ  anche su desktop
  if (!isMobileDevice()) {
    const abilitiesUI = document.createElement('div');
    abilitiesUI.style.position = 'absolute';
    abilitiesUI.style.bottom = '10px';
    abilitiesUI.style.left = '50%';
    abilitiesUI.style.transform = 'translateX(-50%)';
    abilitiesUI.style.display = 'flex';
    abilitiesUI.style.gap = '10px';
    
    // AbilitÃ  disponibili
    const abilities = [
      { key: 'speed', name: 'VelocitÃ ', hotkey: '1' },
      { key: 'shield', name: 'Scudo', hotkey: '2' },
      { key: 'attack', name: 'Attacco', hotkey: '3' }
    ];
    
    // Crea un pulsante per ogni abilitÃ 
    abilities.forEach((ability) => {
      const button = document.createElement('div');
      button.id = `ability-ui-${ability.key}`;
      button.className = 'ability-ui-button';
      button.style.padding = '5px 15px';
      button.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
      button.style.color = 'white';
      button.style.borderRadius = '5px';
      button.style.cursor = 'pointer';
      button.style.fontSize = '14px';
      button.style.textAlign = 'center';
      button.style.border = '1px solid rgba(255, 255, 255, 0.3)';
      
      // Testo pulsante
      button.innerHTML = `${ability.name} <span style="opacity:0.7">[${ability.hotkey}]</span>`;
      
      // Aggiungi event listeners
      button.addEventListener('click', () => {
        if (gameState.abilities && gameState.abilities.cooldowns[ability.key] <= 0) {
          activateAbility(ability.key);
        }
      });
      
      // Aggiungi al container
      abilitiesUI.appendChild(button);
    });
    
    // Aggiungi al game container
    document.getElementById('game-container').appendChild(abilitiesUI);
  };
}

// Crea pulsanti abilitÃ  per dispositivi mobili
function createAbilityButtons(container) {
  const abilitiesContainer = document.createElement('div');
  abilitiesContainer.style.position = 'absolute';
  abilitiesContainer.style.bottom = '10px';
  abilitiesContainer.style.right = '10px';
  abilitiesContainer.style.display = 'flex';
  abilitiesContainer.style.gap = '10px';
  
  // AbilitÃ  disponibili
  const abilities = ['speed', 'shield', 'attack'];
  
  // Crea un pulsante per ogni abilitÃ 
  abilities.forEach((ability, index) => {
    const button = document.createElement('div');
    button.id = `ability-${ability}`;
    button.className = 'ability-button';
    button.style.width = `${MOBILE_CONFIG.buttonSize}px`;
    button.style.height = `${MOBILE_CONFIG.buttonSize}px`;
    button.style.borderRadius = '50%';
    button.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    button.style.border = '2px solid rgba(255, 255, 255, 0.5)';
    button.style.boxSizing = 'border-box';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.fontSize = '24px';
    button.style.color = 'white';
    button.style.textShadow = '0 0 3px rgba(0,0,0,0.8)';
    
    // Aggiungi icona o testo
    button.innerHTML = index + 1;
    
    // Aggiungi al container
    abilitiesContainer.appendChild(button);
    
    // Aggiungi event listeners
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (gameState.abilities && gameState.abilities.cooldowns[ability] <= 0) {
        button.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
        activateAbility(ability);
      }
    });
    
    button.addEventListener('touchend', () => {
      button.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    });
  });
  
  // Aggiungi container abilitÃ  al game container
  document.getElementById('game-container').appendChild(abilitiesContainer);
}

// Configura controlli per abilitÃ  con tasti e pulsanti UI
function setupAbilityControls() {
  // Crea pulsanti UI per abilitÃ  anche su desktop
  if (!isMobileDevice()) {
    const abilitiesUI = document.createElement('div');
    abilitiesUI.style.position = 'absolute';
    abilitiesUI.style.bottom = '10px';
    abilitiesUI.style.left = '50%';
    abilitiesUI.style.transform = 'translateX(-50%)';
    abilitiesUI.style.display = 'flex';
    abilitiesUI.style.gap = '10px';
    
    // AbilitÃ  disponibili
    const abilities = [
      { key: 'speed', name: 'VelocitÃ ', hotkey: '1' },
      { key: 'shield', name: 'Scudo', hotkey: '2' },
      { key: 'attack', name: 'Attacco', hotkey: '3' }
    ];
    
    // Crea un pulsante per ogni abilitÃ 
    abilities.forEach((ability) => {
      const button = document.createElement('div');
      button.id = `ability-ui-${ability.key}`;
      button.className = 'ability-ui-button';
      button.style.padding = '5px 15px';
      button.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
      button.style.color = 'white';
      button.style.borderRadius = '5px';
      button.style.cursor = 'pointer';
      button.style.fontSize = '14px';
      button.style.textAlign = 'center';
      button.style.border = '1px solid rgba(255, 255, 255, 0.3)';
      
      // Testo pulsante
      button.innerHTML = `${ability.name} <span style="opacity:0.7">[${ability.hotkey}]</span>`;
      
      // Aggiungi event listeners
      button.addEventListener('click', () => {
        if (gameState.abilities && gameState.abilities.cooldowns[ability.key] <= 0) {
          activateAbility(ability.key);
        }
      });
      
      // Aggiungi al container
      abilitiesUI.appendChild(button);
    });
    
    // Aggiungi al game container
    document.getElementById('game-container').appendChild(abilitiesUI);
  };
}

// Miglioramento del caricamento delle texture
function loadGameTextures() {
  return new Promise((resolve, reject) => {
    // Usa path assoluti per evitare problemi di percorso
    const loader = PIXI.Loader.shared;
    
    if (!loader.resources.player || !loader.resources.energy) {
      console.log('Caricamento texture di gioco...');
      loader.add('player', '/assets/images/player.png')
            .add('energy', '/assets/images/energy.png');
      
      loader.onComplete.add(() => {
        console.log('Texture caricate con successo:', Object.keys(loader.resources));
        resolve();
      });
      
      loader.onError.add((error) => {
        console.error('Errore caricamento texture:', error);
        // In caso di errore, creiamo comunque grafica di fallback
        createFallbackTextures();
        resolve();
      });
      
      loader.load();
    } else {
      console.log('Texture giÃ  caricate');
      resolve();
    }
  });
}

// Crea texture fallback se le immagini non possono essere caricate
function createFallbackTextures() {
  console.log('Creazione texture fallback');
  
  // Assicurati che la struttura dati esista
  if (!PIXI.Loader) {
    PIXI.Loader = {};
  }
  
  if (!PIXI.Loader.shared) {
    PIXI.Loader.shared = { resources: {} };
  }
  
  if (!PIXI.Loader.shared.resources) {
    PIXI.Loader.shared.resources = {};
  }
  
  // Crea texture fallback per player
  const playerGraphics = new PIXI.Graphics();
  playerGraphics.beginFill(0x3498db);
  playerGraphics.drawCircle(0, 0, 25);
  playerGraphics.endFill();
  
  // Crea texture fallback per energy point
  const energyGraphics = new PIXI.Graphics();
  energyGraphics.beginFill(0xf1c40f);
  energyGraphics.drawCircle(0, 0, 15);
  energyGraphics.endFill();
  
  // Genera texture da graphics e salva nei resources
  try {
    const playerTexture = app.renderer.generateTexture(playerGraphics);
    const energyTexture = app.renderer.generateTexture(energyGraphics);
    
    PIXI.Loader.shared.resources.player = { texture: playerTexture };
    PIXI.Loader.shared.resources.energy = { texture: energyTexture };
    
    console.log('Texture fallback create con successo');
  } catch (error) {
    console.error('Errore creazione texture fallback:', error);
  }
}

// Migliorare initGame per garantire il caricamento dell'applicazione
async function initGame() {
  try {
    // Inizializza PixiJS se non Ã¨ giÃ  inizializzato
    if (!app) {
      initPixiJS();
    }
    
    console.log('Inizializzazione gioco...');
    
    // Assicurati che le texture siano caricate
    await loadGameTextures();
    
    // Gestione forzata del giocatore e camera
    setupGameState();
    
    // Inizializza il contatore FPS
    initFpsCounter();
    
    // Inizializza la camera
    gameState.camera = new DynamicCamera();
    gameState.camera.init(app);
    
    // Inizializza i controlli
    setupControls();
    
    // Crea contenitore root per oggetti mondo
    if (!gameState.worldContainer) {
      gameState.worldContainer = new PIXI.Container();
      app.stage.addChild(gameState.worldContainer);
    }
    
    // Crea contenitori dedicati per tipo
    if (!gameState.containers) {
      gameState.containers = {
        energy: new PIXI.Container(),
        players: new PIXI.Container(),
        effects: new PIXI.Container(),
        debug: new PIXI.Container()
      };
      
      // Aggiungi i contenitori al mondo
      Object.values(gameState.containers).forEach(container => {
        gameState.worldContainer.addChild(container);
      });
    }
    
    // Inizializza sfere energia
    initEnergyPoints();
    
    // Crea indicatore al centro del mondo per debug
    createDebugIndicators();
    
    // Connetti al WebSocket
    connectWebSocket();
    
    // Aggiungi debug info su schermo
    addDebugInfo();
    
    // Inizia l'aggiornamento
    if (!app.ticker.started) {
      app.ticker.add(gameLoop);
      console.log('Game loop avviato');
    }
  } catch (error) {
    console.error('Errore in initGame:', error);
    showMessage('Errore inizializzazione gioco. Ricarica la pagina.', 'error');
  }
}

// Funzione per creare indicatori di debug
function createDebugIndicators() {
  // Pulisci contenitore debug
  gameState.containers.debug.removeChildren();
  
  // Crea indicatore centro mondo
  const worldCenter = new PIXI.Graphics();
  worldCenter.lineStyle(2, 0xff0000);
  worldCenter.drawCircle(0, 0, 50);
  worldCenter.moveTo(-70, 0);
  worldCenter.lineTo(70, 0);
  worldCenter.moveTo(0, -70);
  worldCenter.lineTo(0, 70);
  worldCenter.x = WORLD_CONFIG.width / 2;
  worldCenter.y = WORLD_CONFIG.height / 2;
  gameState.containers.debug.addChild(worldCenter);
  
  // Crea bordi mondo
  const worldBounds = new PIXI.Graphics();
  worldBounds.lineStyle(3, 0x00ff00);
  worldBounds.drawRect(0, 0, WORLD_CONFIG.width, WORLD_CONFIG.height);
  gameState.containers.debug.addChild(worldBounds);
  
  console.log('Indicatori debug creati');
}

// Aggiungi informazioni di debug su schermo
function addDebugInfo() {
  if (!gameState.debugInfo) {
    gameState.debugInfo = new PIXI.Text('Debug Info', {
      fontFamily: 'Arial',
      fontSize: 12,
      fill: 0xffffff,
      align: 'left'
    });
    gameState.debugInfo.position.set(10, 10);
    gameState.debugInfo.zIndex = 1000;
    app.stage.addChild(gameState.debugInfo);
  }
  
  // Aggiorna info ogni frame
  app.ticker.add(() => {
    if (gameState.debugInfo) {
      const player = gameState.players && gameState.players.get(gameState.playerId);
      const cameraInfo = gameState.camera ? 
        `${Math.round(gameState.camera.x)},${Math.round(gameState.camera.y)} Z:${gameState.camera.zoom.toFixed(2)}` : 'N/A';
      
      gameState.debugInfo.text = 
        `FPS: ${Math.round(app.ticker.FPS)}\n` +
        `Player: ${player ? `${Math.round(player.x)},${Math.round(player.y)}` : 'N/A'}\n` +
        `Camera: ${cameraInfo}\n` +
        `Energy: ${gameState.energyPoints ? gameState.energyPoints.size : 0}\n` +
        `Players: ${gameState.players ? gameState.players.size : 0}\n` +
        `Socket: ${socket && socket.readyState === 1 ? 'Connected' : 'Disconnected'}`;
    }
  });
}

// Miglioramento della function setupGameState
function setupGameState() {
  if (!gameState) {
    gameState = {
      players: new Map(),
      energyPoints: new Map(),
      playerId: null,
      camera: null,
      predictor: new MovementPredictor(),
      lastServerMessage: Date.now(),
      pingInterval: null,
      containers: null,
      worldContainer: null
    };
  }
  
  // Se non c'Ã¨ playerID, creane uno nuovo
  if (!gameState.playerId) {
    gameState.playerId = 'local_' + Math.random().toString(36).substr(2, 9);
    
    // Crea player locale
    const localPlayer = {
      id: gameState.playerId,
      x: WORLD_CONFIG.width / 2,
      y: WORLD_CONFIG.height / 2,
      vx: 0,
      vy: 0,
      size: 30,
      color: 0x3498db,
      name: 'Tu',
      score: 0,
      level: 1
    };
    
    // Aggiungi al map players
    gameState.players.set(gameState.playerId, localPlayer);
    
    // Crea sprite
    const playerSprite = createPlayerSprite(gameState.playerId, true);
    localPlayer.sprite = playerSprite;
    
    console.log('Player locale creato:', localPlayer);
  }
}

// Migliora createEnergyPoint
function createEnergyPoint(x, y) {
  // Ottieni la texture (o usa una grafica fallback)
  let texture;
  
  try {
    // Prova prima la nuova struttura (Assets API)
    if (PIXI.Loader && PIXI.Loader.shared && PIXI.Loader.shared.resources.energy && PIXI.Loader.shared.resources.energy.texture) {
      texture = PIXI.Loader.shared.resources.energy.texture;
    } 
    // Fallback a generazione texture grafica
    else {
      console.warn('Texture energia non trovata, creazione fallback');
      const graphics = new PIXI.Graphics();
      graphics.beginFill(0xf1c40f);
      graphics.drawCircle(0, 0, 15);
      graphics.endFill();
      texture = app.renderer.generateTexture(graphics);
    }
  } catch (error) {
    console.error('Errore accesso texture:', error);
    // Crea grafica di emergenza
    const graphics = new PIXI.Graphics();
    graphics.beginFill(0xf1c40f);
    graphics.drawCircle(0, 0, 15);
    graphics.endFill();
    texture = app.renderer.generateTexture(graphics);
  }
  
  // Crea uno sprite con la texture
  const sprite = new PIXI.Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.x = x;
  sprite.y = y;
  sprite.width = 20;  
  sprite.height = 20;
  
  // Aggiungi effetto glow
  const glowFilter = new PIXI.filters.GlowFilter({
    distance: 15,
    outerStrength: 2,
    innerStrength: 1,
    color: 0xf1c40f
  });
  sprite.filters = [glowFilter];
  
  // Aggiungi al container
  if (gameState.containers && gameState.containers.energy) {
    gameState.containers.energy.addChild(sprite);
    console.log(`Energy point creato a ${x},${y}`);
    } else {
    console.warn('Container energia non disponibile');
  }
  
  return sprite;
}

// Migliora initEnergyPoints
function initEnergyPoints() {
  console.log('Inizializzazione punti energia');
  
  // Svuota energy points esistenti
  if (gameState.energyPoints) {
    gameState.energyPoints.clear();
  } else {
    gameState.energyPoints = new Map();
  }
  
  if (gameState.containers && gameState.containers.energy) {
    gameState.containers.energy.removeChildren();
  }
  
  // Crea nuovi energy points
  const pointsCount = MAX_ENERGY_POINTS;
  for (let i = 0; i < pointsCount; i++) {
    const x = Math.random() * WORLD_CONFIG.width;
    const y = Math.random() * WORLD_CONFIG.height;
    
    const sprite = createEnergyPoint(x, y);
    
    // Salva riferimento
    gameState.energyPoints.set(i, {
      id: i,
      x: x,
      y: y,
      sprite: sprite,
      value: ENERGY_VALUE
    });
  }
  
  console.log(`${pointsCount} punti energia creati`);
}

// Migliora connectWebSocket
function connectWebSocket() {
  console.log('Connessione al WebSocket:', WS_URL);
  
  try {
    socket = new WebSocket(WS_URL);
    
    socket.onopen = function() {
      console.log('WebSocket connesso');
      showMessage('Connesso al server', 'success');
      
      // Reset tentativi riconnessione
      reconnectAttempts = 0;
      
              // Invia messaggio join
              const localPlayer = gameState.players.get(gameState.playerId);

              // Verifica se il giocatore locale esiste prima di inviare
              if (!localPlayer) {
                console.warn("Giocatore locale non ancora inizializzato in onopen, attendo...");
                // Potremmo ritardare l'invio o usare valori di default
                // Per ora, usiamo valori di default per evitare crash
                const joinMessage = {
                  type: 'join',
                  id: gameState.playerId,
                  name: 'Tu',
                  x: WORLD_CONFIG.width / 2, // Posizione iniziale di default
                  y: WORLD_CONFIG.height / 2,
                  size: INITIAL_SIZE,
                  color: 0x00ff00 // Colore di default
                };
                console.log('Invio messaggio join (con valori default):', joinMessage);
                sendToServer(joinMessage);
              } else {
                // Il giocatore esiste, usa i suoi dati
                const joinMessage = {
                  type: 'join',
                  id: gameState.playerId,
                  name: 'Tu', // Potremmo voler usare playerName qui se disponibile
                  x: localPlayer.x,
                  y: localPlayer.y,
                  size: localPlayer.size,
                  color: localPlayer.color || 0x00ff00 // Usa colore del giocatore o default
                };
                console.log('Invio messaggio join:', joinMessage);
                sendToServer(joinMessage);
              }
      
      // Setup ping per mantenere connessione
      if (gameState.pingInterval) {
        clearInterval(gameState.pingInterval);
      }
      
      gameState.pingInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          sendToServer({ type: 'ping' });
        }
      }, 30000);
    };
    
    socket.onclose = function() {
      console.log('WebSocket disconnesso');
      showMessage('Disconnesso dal server. Riconnessione...', 'error');
      
      // Pulisci ping timer
      if (gameState.pingInterval) {
        clearInterval(gameState.pingInterval);
        gameState.pingInterval = null;
      }
      
      // Riconnetti dopo delay
      setTimeout(() => {
        reconnectAttempts++;
        if (reconnectAttempts < 5) {
          connectWebSocket();
        } else {
          showMessage('Impossibile connettersi al server. Ricarica la pagina.', 'error');
        }
      }, 3000 * Math.min(reconnectAttempts, 3));
    };
    
    socket.onerror = function(error) {
      console.error('Errore WebSocket:', error);
    };
    
          // Rendi la funzione onmessage asincrona per usare await
          socket.onmessage = async function(event) {
            try {
              // Aggiorna timestamp ultimo messaggio
              gameState.lastServerMessage = Date.now();
  
              // const data = JSON.parse(event.data); // RIMOSSO: usiamo msgpack
              // Dobbiamo usare msgpack per decodificare i dati binari dal server
              let data;
              try {
                // Assicurati che msgpack sia disponibile
                if (typeof msgpack === 'undefined') {
                  throw new Error('Libreria msgpack non trovata');
                }
                // Converti il Blob/ArrayBuffer in Uint8Array e decodifica
                let bufferData;
                if (event.data instanceof Blob) {
                  bufferData = await event.data.arrayBuffer();
                } else if (event.data instanceof ArrayBuffer) {
                  bufferData = event.data;
                } else if (event.data instanceof Uint8Array) {
                   bufferData = event.data; // Già Uint8Array
                } else {
                   console.warn('Tipo dati WebSocket non riconosciuto:', typeof event.data);
                   bufferData = event.data; // Prova comunque
                }
                data = msgpack.decode(new Uint8Array(bufferData));
              } catch (decodeError) {
                console.error('Errore decodifica msgpack:', decodeError, 'Dati ricevuti:', event.data);
                return; // Interrompi se non possiamo decodificare
              }
  
              console.log('Messaggio decodificato ricevuto:', data ? data.type : 'N/D', data);
  
              // Gestisci messaggi in base al tipo
              switch (data.type) {
                case 'state':
                  handleStateUpdate(data);
                  break;
                case 'join':
                  handlePlayerJoin(data);
                  break;
                case 'move':
                  handlePlayerMove(data);
                  break;
                case 'leave':
                  handlePlayerLeave(data);
                  break;
                case 'error':
                  console.error('Errore dal server:', data.message);
                  showMessage('Errore: ' + data.message, 'error');
                  break;
              }
            } catch (error) {
              console.error('Errore parsing messaggio WebSocket:', error);
            }
          };
        } catch (error) { // Questo è il blocco catch per il try principale iniziato a riga 5129
          console.error('Errore creazione WebSocket:', error);
          showMessage('Impossibile connettersi al server', 'error');
        } // <-- Ecco la parentesi che devi aggiungere
    } // Questa è la chiusura della funzione connectWebSocket
    
// Miglioramento game loop principale
function gameLoop(delta) {
  // Verifica che il gioco sia inizializzato
  if (!gameState || !gameState.camera) {
    console.warn('Game loop: gameState non inizializzato');
    return;
  }
  
  // Aggiorna movimento
  updateMovement(delta);
  
  // Aggiorna punti energia
  updateEnergyPoints(delta);
  
  // Controlla collisioni
  checkPlayerCollisions();
  checkEnergyCollisions();
  
  // Interpolazione giocatori
  interpolateOtherPlayers(delta);
  
  // Aggiorna la camera
  updateCamera(delta);
  
  // Aggiorna HUD
  updateHUD();
  
  // Aggiorna minimap
  if (typeof updateMinimap === 'function') {
    updateMinimap();
  }
}

// Miglioramento updateCamera
function updateCamera(delta) {
  if (!gameState.camera || !gameState.players) {
    return;
  }
  
  const localPlayer = gameState.players.get(gameState.playerId);
  if (!localPlayer) {
    console.warn('Camera update: giocatore locale non trovato');
    return;
  }
  
  // Calcola dimensioni visibili
  const playerCount = gameState.players.size;
  const playerSize = localPlayer.size || 30;
  
  // Aggiorna posizione camera con smorzamento
  const targetX = localPlayer.x;
  const targetY = localPlayer.y;
  
  if (gameState.camera.target) {
    gameState.camera.target.x = targetX;
    gameState.camera.target.y = targetY;
  } else {
    gameState.camera.follow({ x: targetX, y: targetY });
  }
  
  // Aggiorna zoom camera
  if (playerCount > 1 && typeof gameState.camera.updateAdvancedZoom === 'function') {
    // Se disponibile, usa zoom avanzato che considera altri giocatori
    gameState.camera.updateAdvancedZoom([...gameState.players.values()], localPlayer);
  } else {
    // Altrimenti usa zoom basato solo su dimensione giocatore
    gameState.camera.updateZoom(playerCount, playerSize);
  }
  
  // Aggiorna posizione camera
  gameState.camera.update(delta);
}

// CameraSystem - Gestione avanzata della camera
class CameraSystem {
  constructor(app, worldWidth, worldHeight) {
    this.app = app;
    this.target = null;
    this.container = new PIXI.Container();
    this.zoom = 1.0;
    this.minZoom = WORLD_CONFIG.minZoom || 0.5;
    this.maxZoom = WORLD_CONFIG.maxZoom || 1.2;
    this.worldWidth = worldWidth || WORLD_CONFIG.width;
    this.worldHeight = worldHeight || WORLD_CONFIG.height;
    this.offset = { x: app.screen.width/2, y: app.screen.height/2 };
    this.smoothing = 0.1;
    
    app.stage.addChild(this.container);
  }

  follow(target) {
    this.target = target;
  }

  update(delta = 1) {
    if(!this.target) return;

    // Posizione target con interpolazione
    const targetX = -this.target.x * this.zoom + this.offset.x;
    const targetY = -this.target.y * this.zoom + this.offset.y;
    
    // Applica interpolazione con smoothing
    this.container.position.x += (targetX - this.container.position.x) * this.smoothing * delta;
    this.container.position.y += (targetY - this.container.position.y) * this.smoothing * delta;

    // Aggiornamento zoom
    this.container.scale.set(this.zoom);
  }

  updateZoom(playerCount, playerSize) {
    // Base zoom basato sul conteggio giocatori
    let targetZoom = Math.max(this.minZoom, 1 - (playerCount - 1) * 0.05);
    
    // Adatta zoom in base alla dimensione del giocatore
    const sizeFactorZoom = Math.max(this.minZoom, 1 - (playerSize - 30) / 200);
    targetZoom = Math.min(targetZoom, sizeFactorZoom);
    
    // Limita zoom
    targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, targetZoom));
    
    // Interpolazione zoom
    this.zoom += (targetZoom - this.zoom) * 0.05;
  }
  
  updateAdvancedZoom(players, localPlayer) {
    if (players.length < 2) {
      // Se c'Ã¨ solo il giocatore locale, usa lo zoom semplice
      this.updateZoom(1, localPlayer.size);
      return;
    }
    
    // Calcola i bounds di tutti i giocatori
    const bounds = this.calculatePlayersBounds(players);
    
    // Calcola zoom ottimale basato sulla distribuzione giocatori
    const optimalZoom = this.calculateOptimalZoom(bounds);
    
    // Aggiorna lo zoom con interpolazione
    this.zoom += (optimalZoom - this.zoom) * 0.05;
  }
  
  calculateOptimalZoom(bounds) {
    // Calcola area visibile
    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;
    
    // Calcola aspect ratio
    const screenRatio = screenWidth / screenHeight;
    const boundsRatio = bounds.width / bounds.height;
    
    // Calcola zoom ottimale
    let zoom;
    if (boundsRatio > screenRatio) {
      // Limita per larghezza
      zoom = screenWidth / (bounds.width + WORLD_CONFIG.padding * 2);
    } else {
      // Limita per altezza
      zoom = screenHeight / (bounds.height + WORLD_CONFIG.padding * 2);
    }
    
    // Limita zoom
    return Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
  }
  
  calculatePlayersBounds(players) {
    if (!players || players.length === 0) {
      return { x: 0, y: 0, width: 100, height: 100 };
    }
    
    // Inizializza con il primo giocatore
    let minX = players[0].x;
    let maxX = players[0].x;
    let minY = players[0].y;
    let maxY = players[0].y;
    
    // Trova min/max per tutti i giocatori
    players.forEach(player => {
      minX = Math.min(minX, player.x);
      maxX = Math.max(maxX, player.x);
      minY = Math.min(minY, player.y);
      maxY = Math.max(maxY, player.y);
    });
    
    // Calcola larghezza e altezza
    const width = maxX - minX + 100; // Aggiungi padding
    const height = maxY - minY + 100;
    
    return { x: minX, y: minY, width, height };
  }

  getVisibleBounds() {
    // Calcola il rettangolo visibile nella viewport
    const visibleWidth = this.app.screen.width / this.zoom;
    const visibleHeight = this.app.screen.height / this.zoom;
    
    // Calcola coordinate mondo
    const worldX = -this.container.position.x / this.zoom;
    const worldY = -this.container.position.y / this.zoom;
    
    return {
      x: worldX,
      y: worldY,
      width: visibleWidth,
      height: visibleHeight,
      contains: function(x, y) {
        return x >= this.x && x <= this.x + this.width &&
               y >= this.y && y <= this.y + this.height;
      }
    };
  }

  debugDraw() {
    // Crea grafica debug per visualizzare:
    // - Centro mondo
    // - Bordi visibili
    // - Grid
    
    const debug = new PIXI.Container();
    
    // Centro mondo
    const center = new PIXI.Graphics();
    center.lineStyle(2, 0xFF0000);
    center.drawCircle(this.worldWidth/2, this.worldHeight/2, 50);
    center.moveTo(this.worldWidth/2 - 70, this.worldHeight/2);
    center.lineTo(this.worldWidth/2 + 70, this.worldHeight/2);
    center.moveTo(this.worldWidth/2, this.worldHeight/2 - 70);
    center.lineTo(this.worldWidth/2, this.worldHeight/2 + 70);
    
    // Bordi mondo
    const bounds = new PIXI.Graphics();
    bounds.lineStyle(3, 0x00FF00);
    bounds.drawRect(0, 0, this.worldWidth, this.worldHeight);
    
    // Grid
    const grid = new PIXI.Graphics();
    grid.lineStyle(1, 0x333333, 0.3);
    
    const gridSize = 200;
    for (let x = 0; x <= this.worldWidth; x += gridSize) {
      grid.moveTo(x, 0);
      grid.lineTo(x, this.worldHeight);
    }
    
    for (let y = 0; y <= this.worldHeight; y += gridSize) {
      grid.moveTo(0, y);
      grid.lineTo(this.worldWidth, y);
    }
    
    debug.addChild(grid);
    debug.addChild(bounds);
    debug.addChild(center);
    
    this.container.addChild(debug);
    
    return debug;
  }
}

// Sistema di energy points migliorato
class EnergySystem {
  constructor(container) {
    this.points = new Map();
    this.container = container;
    this.animations = [];
  }
  
  init(count = MAX_ENERGY_POINTS) {
    this.clear();
    
    // Crea nuovi energy points
    console.log(`Inizializzazione ${count} punti energia`);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * WORLD_CONFIG.width;
      const y = Math.random() * WORLD_CONFIG.height;
      this.spawn(i, x, y);
    }
  }
  
  clear() {
    // Rimuovi tutti i punti esistenti
    this.points.forEach(point => {
      if (point.sprite && point.sprite.parent) {
        point.sprite.parent.removeChild(point.sprite);
      }
    });
    
    this.points.clear();
    
    if (this.container) {
      this.container.removeChildren();
    }
  }
  
  spawn(id, x, y, value = ENERGY_VALUE) {
    // Crea sprite con texture o grafica fallback
    let texture;
    if (PIXI.Loader.shared.resources.energy && PIXI.Loader.shared.resources.energy.texture) {
      texture = PIXI.Loader.shared.resources.energy.texture;
    } else {
      // Crea grafica fallback
      const graphics = new PIXI.Graphics();
      graphics.beginFill(0xf1c40f);
      graphics.drawCircle(0, 0, 15);
      graphics.endFill();
      texture = app.renderer.generateTexture(graphics);
    }
    
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.width = 20;
    sprite.height = 20;
    
    // Aggiungi effetto glow
    if (PIXI.filters.GlowFilter) {
      const glowFilter = new PIXI.filters.GlowFilter({
        distance: 15,
        outerStrength: 2,
        innerStrength: 1,
        color: 0xf1c40f
      });
      sprite.filters = [glowFilter];
    }
    
    // Animazione
    sprite.rotation = Math.random() * Math.PI * 2;
    
    // Aggiungi al container
    if (this.container) {
      this.container.addChild(sprite);
    }
    
    // Crea point object
    const point = {
      id,
      x,
      y,
      value,
      sprite
    };
    
    // Salva nel map
    this.points.set(id, point);
    
    console.log(`Energy point ${id} creato a ${x},${y}`);
    return point;
  }
  
  remove(id) {
    const point = this.points.get(id);
    if (point && point.sprite) {
      if (point.sprite.parent) {
        point.sprite.parent.removeChild(point.sprite);
      }
      this.points.delete(id);
      return true;
    }
    return false;
  }
  
  update(delta) {
    // Aggiorna animazioni
    this.points.forEach(point => {
      if (point.sprite) {
        point.sprite.rotation += 0.01 * delta;
        
        // Animazione pulsante
        const time = Date.now() / 1000;
        const scale = 0.9 + Math.sin(time * 2) * 0.1;
        point.sprite.scale.set(scale, scale);
      }
    });
  }
  
  getVisiblePoints(visibleBounds) {
    const result = [];
    this.points.forEach(point => {
      if (visibleBounds.contains(point.x, point.y)) {
        result.push(point);
      }
    });
    return result;
  }
}

// DebugPanel - Monitor performance e debug
class DebugPanel {
  constructor(app) {
    this.app = app;
    this.panel = new PIXI.Container();
    this.text = new PIXI.Text('Debug Info', {
      fontFamily: 'Arial',
      fontSize: 14,
      fill: 0xffffff,
      align: 'left'
    });
    this.panel.addChild(this.text);
    this.panel.position.set(10, 10);
    
    // Stats
    this.stats = {
      fps: 0,
      playerPos: "N/A",
      entitiesCount: 0,
      webSocketStatus: "N/A",
      renderTime: 0,
      updateTime: 0,
      memory: 0
    };
    
    // Mostra pannello
    app.stage.addChild(this.panel);
    
    // Interval per memoria
    this.memoryInterval = setInterval(() => {
      if (window.performance && window.performance.memory) {
        this.stats.memory = window.performance.memory.usedJSHeapSize / (1024 * 1024);
      }
    }, 2000);
  }
  
  update(stats) {
    Object.assign(this.stats, stats);
    
    this.text.text = [
      `FPS: ${this.stats.fps.toFixed(1)}`,
      `Player: ${this.stats.playerPos}`,
      `Entities: ${this.stats.entitiesCount}`,
      `WebSocket: ${this.stats.webSocketStatus}`,
      `Render: ${this.stats.renderTime.toFixed(2)}ms`,
      `Update: ${this.stats.updateTime.toFixed(2)}ms`,
      `Memory: ${this.stats.memory.toFixed(1)}MB`
    ].join('\n');
  }
  
  setVisible(visible) {
    this.panel.visible = visible;
  }
  
  destroy() {
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
    }
    
    if (this.panel.parent) {
      this.panel.parent.removeChild(this.panel);
    }
  }
}

// NetworkManager - Gestione connessione con validazione
class NetworkManager {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.queue = [];
    this.connected = false;
    this.lastPing = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.pingInterval = null;
    this.processInterval = null;
    this.handlers = {};
    this.lastSent = {};
  }
  
  connect() {
    console.log(`Connessione a ${this.url}`);
    
    try {
      this.socket = new WebSocket(this.url);
      
      this.socket.onopen = () => {
        console.log('WebSocket connesso');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.lastPing = Date.now();
        
        // Setup ping
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
        }
        
        this.pingInterval = setInterval(() => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.send({ type: 'ping' });
          }
        }, 30000);
        
        // Setup processing queue
        if (this.processInterval) {
          clearInterval(this.processInterval);
        }
        
        this.processInterval = setInterval(() => {
          this.processQueue();
        }, 50); // 20fps
        
        // Trigger handler
        if (this.handlers.onConnect) {
          this.handlers.onConnect();
        }
      };
      
      this.socket.onclose = () => {
        console.log('WebSocket disconnesso');
        this.connected = false;
        
        // Clear intervals
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        
        if (this.processInterval) {
          clearInterval(this.processInterval);
          this.processInterval = null;
        }
        
        // Reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          setTimeout(() => {
            this.reconnectAttempts++;
            this.connect();
          }, 3000 * Math.min(this.reconnectAttempts, 3));
        } else {
          console.error('Troppe reconnessioni fallite');
          
          // Trigger handler
          if (this.handlers.onMaxReconnect) {
            this.handlers.onMaxReconnect();
          }
        }
        
        // Trigger handler
        if (this.handlers.onDisconnect) {
          this.handlers.onDisconnect();
        }
      };
      
      this.socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        
        // Trigger handler
        if (this.handlers.onError) {
          this.handlers.onError(error);
        }
      };
      
      this.socket.onmessage = (event) => {
        this.lastPing = Date.now();
        
        try {
          const data = JSON.parse(event.data);
          
          // Validazione base
          if (!data || !data.type) {
            console.warn('Messaggio invalido ricevuto:', data);
            return;
          }
          
          // Aggiungi alla coda per processing
          this.queue.push(data);
          
          // Process specific types immediatamente
          if (data.type === 'error') {
            if (this.handlers.onError) {
              this.handlers.onError(data);
            }
          }
        } catch (err) {
          console.error('Errore parsing messaggio:', err);
        }
      };
      
    } catch (error) {
      console.error('Errore creazione WebSocket:', error);
      
      // Trigger handler
      if (this.handlers.onError) {
        this.handlers.onError(error);
      }
    }
  }
  
  on(event, handler) {
    this.handlers[event] = handler;
  }
  
  send(data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('Tentativo di invio con WebSocket chiuso');
      return false;
    }
    
    try {
      // Throttling - previeni spam di messaggi
      if (data.type && data.type === 'move') {
        const now = Date.now();
        const lastTime = this.lastSent[data.type] || 0;
        
        // Max 10 move messaggi/secondo
        if (now - lastTime < 100) {
          return false;
        }
        
        this.lastSent[data.type] = now;
      }
      
      this.socket.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Errore invio messaggio:', error);
      return false;
    }
  }
  
  processQueue() {
    const maxProcessPerFrame = 5;
    const processed = [];
    
    // Processa fino a maxProcessPerFrame messaggi
    while (this.queue.length > 0 && processed.length < maxProcessPerFrame) {
      const data = this.queue.shift();
      processed.push(data);
      
      // Trigger handler
      const handler = this.handlers[`on${data.type.charAt(0).toUpperCase() + data.type.slice(1)}`];
      if (handler) {
        handler(data);
      }
    }
    
    return processed.length;
  }
  
  isConnected() {
    return this.connected && this.socket && this.socket.readyState === WebSocket.OPEN;
  }
  
  getStatus() {
    if (!this.socket) return 'Closed';
    
    const states = ['Connecting', 'Open', 'Closing', 'Closed'];
    return states[this.socket.readyState];
  }
  
  disconnect() {
    if (this.socket) {
      this.socket.close();
    }
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    
    this.connected = false;
  }
}

// Chunk Manager per ottimizzazione rendering
class ChunkManager {
  constructor(worldWidth, worldHeight, chunkSize = 800) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.chunkSize = chunkSize;
    this.visibleChunks = new Set();
    this.chunks = new Map();
    
    // Calcola numero di chunks
    this.cols = Math.ceil(worldWidth / chunkSize);
    this.rows = Math.ceil(worldHeight / chunkSize);
    
    console.log(`ChunkManager: ${this.cols}x${this.rows} chunks (${this.chunkSize}px)`);
  }
  
  getChunkKey(x, y) {
    const chunkX = Math.floor(x / this.chunkSize);
    const chunkY = Math.floor(y / this.chunkSize);
    return `${chunkX},${chunkY}`;
  }
  
  getChunkBounds(key) {
    const [chunkX, chunkY] = key.split(',').map(Number);
    return {
      x: chunkX * this.chunkSize,
      y: chunkY * this.chunkSize,
      width: this.chunkSize,
      height: this.chunkSize
    };
  }
  
  updateVisibility(visibleBounds) {
    // Resetta chunks visibili
    this.visibleChunks.clear();
    
    // Calcola range chunk visibili
    const startX = Math.floor(visibleBounds.x / this.chunkSize);
    const startY = Math.floor(visibleBounds.y / this.chunkSize);
    const endX = Math.ceil((visibleBounds.x + visibleBounds.width) / this.chunkSize);
    const endY = Math.ceil((visibleBounds.y + visibleBounds.height) / this.chunkSize);
    
    // Aggiungi chunks visibili
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        if (x >= 0 && x < this.cols && y >= 0 && y < this.rows) {
          this.visibleChunks.add(`${x},${y}`);
        }
      }
    }
    
    return this.visibleChunks;
  }
  
  isChunkVisible(key) {
    return this.visibleChunks.has(key);
  }
  
  isPositionVisible(x, y) {
    return this.isChunkVisible(this.getChunkKey(x, y));
  }
  
  debugDraw(container) {
    const debug = new PIXI.Graphics();
    debug.lineStyle(1, 0xFF00FF, 0.5);
    
    // Disegna grid di chunks
    for (let x = 0; x <= this.worldWidth; x += this.chunkSize) {
      debug.moveTo(x, 0);
      debug.lineTo(x, this.worldHeight);
    }
    
    for (let y = 0; y <= this.worldHeight; y += this.chunkSize) {
      debug.moveTo(0, y);
      debug.lineTo(this.worldWidth, y);
    }
    
    container.addChild(debug);
    
    return debug;
  }
}

// Migliora l'inizializzazione del gioco
async function initGame() {
  try {
    // Inizializza PixiJS se non Ã¨ giÃ  inizializzato
    if (!app) {
      await initPixiJS();
    }
    
    console.log('Inizializzazione gioco avanzata...');
    
    // Carica texture
    await loadGameTextures();
    
    // Inizializza oggetti gioco
    setupGameState();
    
    // Inizializza camera avanzata
    const camera = new CameraSystem(app, WORLD_CONFIG.width, WORLD_CONFIG.height);
    gameState.camera = camera;
    
    // Debug panel
    const debugPanel = new DebugPanel(app);
    gameState.debugPanel = debugPanel;
    
    // Chunk manager
    const chunkManager = new ChunkManager(WORLD_CONFIG.width, WORLD_CONFIG.height);
    gameState.chunkManager = chunkManager;
    
    // Crea container per tipo
    gameState.containers = {
      energy: new PIXI.Container(),
      players: new PIXI.Container(),
      effects: new PIXI.Container(),
      debug: new PIXI.Container()
    };
    
    // Aggiungi container alla camera
    Object.values(gameState.containers).forEach(container => {
      camera.container.addChild(container);
    });
    
    // Energy system
    const energySystem = new EnergySystem(gameState.containers.energy);
    gameState.energySystem = energySystem;
    energySystem.init(MAX_ENERGY_POINTS);
    
    // Network manager
    const networkManager = new NetworkManager(WS_URL);
    gameState.network = networkManager;
    
    // Setup handlers
    setupNetworkHandlers(networkManager);
    
    // Debug visuals
    if (gameState.debug) {
      camera.debugDraw();
      chunkManager.debugDraw(gameState.containers.debug);
    }
    
    // Connect to server
    networkManager.connect();
    
    // Setup controls
    setupControls();
    
    // Followa il giocatore locale
    const localPlayer = gameState.players.get(gameState.playerId);
    if (localPlayer) {
      camera.follow(localPlayer);
    }
    
    // Inizia game loop
    if (!app.ticker.started) {
      app.ticker.add(gameLoop);
      console.log('Game loop avviato');
    }
    
    console.log('Gioco inizializzato con sistema avanzato');
  } catch (error) {
    console.error('Errore inizializzazione gioco:', error);
    showMessage('Errore inizializzazione gioco. Ricarica la pagina.', 'error');
  }
}

// Setup network handlers
function setupNetworkHandlers(network) {
  network.on('onConnect', () => {
    console.log('Connesso al server');
    showMessage('Connesso al server', 'success');
    
    // Invia join
    const localPlayer = gameState.players.get(gameState.playerId);
    if (localPlayer) {
      network.send({
        type: 'join',
        id: gameState.playerId,
        name: localPlayer.name || 'Tu',
        x: localPlayer.x,
        y: localPlayer.y,
        size: localPlayer.size,
        color: localPlayer.color
      });
    }
  });
  
  network.on('onDisconnect', () => {
    showMessage('Disconnesso dal server. Riconnessione...', 'error');
  });
  
  network.on('onMaxReconnect', () => {
    showMessage('Impossibile connettersi al server. Ricarica la pagina.', 'error');
  });
  
  network.on('onError', (error) => {
    console.error('WebSocket error:', error);
    showMessage(error.message || 'Errore connessione', 'error');
  });
  
  network.on('onState', (data) => {
    handleStateUpdate(data);
  });
  
  network.on('onJoin', (data) => {
    handlePlayerJoin(data);
  });
  
  network.on('onMove', (data) => {
    handlePlayerMove(data);
  });
  
  network.on('onLeave', (data) => {
    handlePlayerLeave(data);
  });
}

// Game loop migliorato
function gameLoop(delta) {
  try {
    const updateStart = performance.now();
    
    // Verifica stato inizializzazione
    if (!gameState || !gameState.camera) {
      return;
    }
    
    // Ottimizzazione: update solo se gioco attivo 
    if (document.hidden) {
      return;
    }
    
    // Aggiorna movimento giocatore
    updateMovement(delta);
    
    // Aggiorna energy points
    if (gameState.energySystem) {
      gameState.energySystem.update(delta);
    }
    
    // Update network
    if (gameState.network && gameState.network.isConnected()) {
      gameState.network.processQueue();
    }
    
    // Aggiorna camera
    if (gameState.camera) {
      gameState.camera.update(delta);
      
      // Aggiorna visibilitÃ 
      if (gameState.chunkManager) {
        const visibleBounds = gameState.camera.getVisibleBounds();
        gameState.chunkManager.updateVisibility(visibleBounds);
      }
    }
    
    // Ottimizzazione: applica visibilitÃ 
    optimizeVisibility();
    
    // Controlla collisioni
    checkEnergyCollisions();
    checkPlayerCollisions();
    
    // Interolate altri giocatori
    if (typeof interpolateOtherPlayers === 'function') {
      interpolateOtherPlayers(delta);
    }
    
    // Aggiorna debug panel
    if (gameState.debugPanel) {
      const renderTime = performance.now() - updateStart;
      
      const localPlayer = gameState.players.get(gameState.playerId);
      const playerPos = localPlayer ? 
        `${Math.round(localPlayer.x)},${Math.round(localPlayer.y)}` : 'N/A';
      
      gameState.debugPanel.update({
        fps: app.ticker.FPS,
        playerPos: playerPos,
        entitiesCount: (gameState.players ? gameState.players.size : 0) + 
                       (gameState.energySystem ? gameState.energySystem.points.size : 0),
        webSocketStatus: gameState.network ? gameState.network.getStatus() : 'N/A',
        renderTime: renderTime,
        updateTime: renderTime
      });
    }
  } catch (error) {
    console.error('Error in game loop:', error);
  }
}

// Optimization: applica visibilitÃ  in base a chunks
function optimizeVisibility() {
  if (!gameState.chunkManager) return;
  
  // Ottimizza energy points
  if (gameState.energySystem && gameState.energySystem.points) {
    gameState.energySystem.points.forEach(point => {
      if (point.sprite) {
        point.sprite.visible = gameState.chunkManager.isPositionVisible(point.x, point.y);
      }
    });
  }
  
  // Ottimizza players
  if (gameState.players) {
    gameState.players.forEach(player => {
      // Giocatore locale sempre visibile
      if (player.id === gameState.playerId) {
        if (player.sprite) player.sprite.visible = true;
        return;
      }
      
      // Altri players: visibili solo se nel chunk visibile
      if (player.sprite) {
        player.sprite.visible = gameState.chunkManager.isPositionVisible(player.x, player.y);
      }
    });
  }
}

// ... existing code ...

// Aggiorna loadGameTextures per usare l'API Assets di PixiJS 7+
async function loadGameTextures() {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('Caricamento texture con Assets API...');
      
      // Verifica se PIXI.Assets Ã¨ disponibile (PixiJS 7+)
      if (PIXI.Assets) {
        // Evita doppia inizializzazione per prevenire warning
        try {
          if (!window.assetsInitialized) {
            console.log('Inizializzazione Assets API...');
            PIXI.Assets.init({
              preferWorkers: true,
              basePath: '/'
            });
            window.assetsInitialized = true;
          }
        } catch (initError) {
          console.warn('Errore inizializzazione Assets:', initError);
        }
        
        try {
          // Usa addBundle invece di load diretto
          PIXI.Assets.addBundle('game', {
            player: '/assets/images/player.png',
            energy: '/assets/images/energy.png'
          });
          
          // Carica bundle con gestione errore piÃ¹ robusta
          const textures = await PIXI.Assets.loadBundle('game')
            .catch(e => {
              throw new Error('Errore caricamento texture: ' + e.message);
            });
          
          console.log('Texture caricate con successo:', Object.keys(textures));
          
          // Imposta le texture nel formato che il resto del codice si aspetta
          PIXI.Loader = PIXI.Loader || {};
          PIXI.Loader.shared = {
            resources: {
              player: { texture: textures.player },
              energy: { texture: textures.energy }
            }
          };
          
          resolve(textures);
          return;
        } catch (loadError) {
          console.error('Errore caricamento bundle:', loadError);
          // Prosegui con il fallback
        }
      }
      
      // Fallback alla vecchia API o texture generate
      console.warn('Fallback a texture generate');
      createFallbackTextures();
      resolve();
      
    } catch (error) {
      console.error('Errore caricamento texture:', error);
      console.log('Creazione texture fallback...');
      createFallbackTextures();
      resolve(); // Risolvi comunque la promise per non bloccare l'inizializzazione
    }
  });
}

// ... existing code ...

// Correggi gli event handler per la tastiera con controlli di sicurezza
function setupKeyboardControls() {
  const keyState = {};
  
  function handleKeyDown(e) {
    try {
      // Controllo sicuro con optional chaining
      if (!e || e.repeat) return;
      const key = e.key?.toLowerCase() || e.code?.toLowerCase();
      if (key) {
        keyState[key] = true;
        
        // Gestione dei movimenti
        if (key === 'w' || key === 'arrowup') {
          gameState.moveUp = true;
        } else if (key === 's' || key === 'arrowdown') {
          gameState.moveDown = true;
        } else if (key === 'a' || key === 'arrowleft') {
          gameState.moveLeft = true;
        } else if (key === 'd' || key === 'arrowright') {
          gameState.moveRight = true;
        }
        
        // AbilitÃ 
        if (key === '1' || key === '2' || key === '3') {
          const abilityIndex = parseInt(key) - 1;
          activateAbility(abilityIndex);
        }
      }
    } catch (error) {
      console.error('Errore in handleKeyDown:', error);
    }
  }
  
  function handleKeyUp(e) {
    try {
      // Controllo sicuro con optional chaining
      if (!e) return;
      const key = e.key?.toLowerCase() || e.code?.toLowerCase();
      if (key) {
        keyState[key] = false;
        
        // Gestione dei movimenti
        if (key === 'w' || key === 'arrowup') {
          gameState.moveUp = false;
        } else if (key === 's' || key === 'arrowdown') {
          gameState.moveDown = false;
        } else if (key === 'a' || key === 'arrowleft') {
          gameState.moveLeft = false;
        } else if (key === 'd' || key === 'arrowright') {
          gameState.moveRight = false;
        }
      }
    } catch (error) {
      console.error('Errore in handleKeyUp:', error);
    }
  }
  
  // Aggiunta sicura degli event listener
  try {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    console.log('Controlli da tastiera configurati');
  } catch (error) {
    console.error('Errore configurazione controlli:', error);
  }
  
  return function cleanup() {
    try {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    } catch (error) {
      console.error('Errore rimozione listener:', error);
    }
  };
}

// ... existing code ...

// Migliora createEnergyPoint per una gestione piÃ¹ robusta degli errori
function createEnergyPoint(x, y) {
  // Ottieni la texture (o usa una grafica fallback)
  let texture;
  
  try {
    // Prova prima la nuova struttura (Assets API)
    if (PIXI.Loader && PIXI.Loader.shared && PIXI.Loader.shared.resources.energy && PIXI.Loader.shared.resources.energy.texture) {
      texture = PIXI.Loader.shared.resources.energy.texture;
    } 
    // Fallback a generazione texture grafica
    else {
      console.warn('Texture energia non trovata, creazione fallback');
      const graphics = new PIXI.Graphics();
      graphics.beginFill(0xf1c40f);
      graphics.drawCircle(0, 0, 15);
      graphics.endFill();
      texture = app.renderer.generateTexture(graphics);
    }
  } catch (error) {
    console.error('Errore accesso texture:', error);
    // Crea grafica di emergenza
    const graphics = new PIXI.Graphics();
    graphics.beginFill(0xf1c40f);
    graphics.drawCircle(0, 0, 15);
    graphics.endFill();
    texture = app.renderer.generateTexture(graphics);
  }
  
  // Crea uno sprite con la texture
  try {
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.width = 20;  
    sprite.height = 20;
    
    // Aggiungi effetto glow se filtri sono disponibili
    try {
      if (PIXI.filters && PIXI.filters.GlowFilter) {
        const glowFilter = new PIXI.filters.GlowFilter({
          distance: 15,
          outerStrength: 2,
          innerStrength: 1,
          color: 0xf1c40f
        });
        sprite.filters = [glowFilter];
      }
    } catch (e) {
      console.warn('Filtri non disponibili per effetto glow');
    }
    
    // Aggiungi al container
    if (gameState.containers && gameState.containers.energy) {
      gameState.containers.energy.addChild(sprite);
      console.log(`Energy point creato a ${x},${y}`);
    } else {
      console.warn('Container energia non disponibile');
    }
    
    return sprite;
  } catch (spriteError) {
    console.error('Errore creazione sprite:', spriteError);
    return null;
  }
}

// ... existing code ...

// Migliora l'inizializzazione del gioco con gestione errori piÃ¹ robusta
async function initGame() {
  try {
    // Inizializza PixiJS se non Ã¨ giÃ  inizializzato
    if (!app) {
      console.log('Inizializzazione PixiJS...');
      await initPixiJS();
    }
    
    console.log('Inizializzazione gioco avanzata...');
    
    // Carica texture con gestione errori
    try {
      await loadGameTextures();
    } catch (textureError) {
      console.error('Errore caricamento texture, continuando con fallback:', textureError);
      // Continua comunque, utilizzeremo texture generate
    }
    
    // Verifica se anime.js Ã¨ disponibile
    let animeAvailable = false;
    try {
      animeAvailable = typeof anime !== 'undefined';
      console.log('Anime.js ' + (animeAvailable ? 'disponibile' : 'non disponibile'));
    } catch (e) {
      console.warn('Anime.js non disponibile, effetti animati ridotti');
    }
    
    // Inizializza oggetti gioco
    setupGameState();
    
    // Inizializza camera avanzata
    const camera = new CameraSystem(app, WORLD_CONFIG.width, WORLD_CONFIG.height);
    gameState.camera = camera;
    
    // Debug panel
    const debugPanel = new DebugPanel(app);
    gameState.debugPanel = debugPanel;
    
    // Chunk manager
    const chunkManager = new ChunkManager(WORLD_CONFIG.width, WORLD_CONFIG.height);
    gameState.chunkManager = chunkManager;
    
    // Crea container per tipo
    gameState.containers = {
      energy: new PIXI.Container(),
      players: new PIXI.Container(),
      effects: new PIXI.Container(),
      debug: new PIXI.Container()
    };
    
    // Aggiungi container alla camera
    Object.values(gameState.containers).forEach(container => {
      camera.container.addChild(container);
    });
    
    // Energy system
    const energySystem = new EnergySystem(gameState.containers.energy);
    gameState.energySystem = energySystem;
    energySystem.init(MAX_ENERGY_POINTS);
    
    // Network manager
    const networkManager = new NetworkManager(WS_URL);
    gameState.network = networkManager;
    
    // Setup handlers
    setupNetworkHandlers(networkManager);
    
    // Debug visuals
    if (gameState.debug) {
      camera.debugDraw();
      chunkManager.debugDraw(gameState.containers.debug);
    }
    
    // Connect to server
    networkManager.connect();
    
    // Setup controls - assicurati che venga chiamato solo una volta
    if (!gameState.controlsInitialized) {
      setupControls();
      gameState.controlsInitialized = true;
    }
    
    // Followa il giocatore locale
    const localPlayer = gameState.players.get(gameState.playerId);
    if (localPlayer) {
      camera.follow(localPlayer);
    }
    
    // Inizia game loop (evita duplicati)
    if (!app.ticker.started) {
      app.ticker.add(gameLoop);
      console.log('Game loop avviato');
    }
    
    console.log('Gioco inizializzato con sistema avanzato');
  } catch (error) {
    console.error('Errore inizializzazione gioco:', error);
    showMessage('Errore inizializzazione gioco. Ricarica la pagina.', 'error');
  }
}

// ... existing code ...

// Aggiorna loadGameTextures per gestire meglio l'API PIXI.Assets e i percorsi delle texture
async function loadGameTextures() {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('Caricamento texture con Assets API...');
      
      // Verifica se PIXI.Assets Ã¨ disponibile (PixiJS 7+)
      if (PIXI.Assets) {
        // Evita doppia inizializzazione per prevenire warning
        try {
          if (!window.assetsInitialized) {
            console.log('Inizializzazione Assets API...');
            PIXI.Assets.init({
              preferWorkers: true
            });
            window.assetsInitialized = true;
          }
        } catch (initError) {
          console.warn('Errore inizializzazione Assets:', initError);
        }
        
        try {
          // Controlliamo se il bundle Ã¨ giÃ  stato registrato
          const bundleName = 'gameAssets' + Date.now(); // Nome unico per evitare conflitti
          
          console.log('Registrazione nuovo bundle:', bundleName);
          
          // Utilizza path relativi alla root pubblica
          PIXI.Assets.addBundle(bundleName, {
            player: './player.png', // path relativo
            energy: './energy.png'  // path relativo
          });
          
          console.log('Tentativo caricamento texture...');
          
          // Tenta di caricare - se fallisce, usa fallback senza errori
          try {
            const textures = await PIXI.Assets.loadBundle(bundleName);
            console.log('Texture caricate con successo:', Object.keys(textures));
            
            // Imposta le texture nel formato che il resto del codice si aspetta
            PIXI.Loader = PIXI.Loader || {};
            PIXI.Loader.shared = {
              resources: {
                player: { texture: textures.player },
                energy: { texture: textures.energy }
              }
            };
            
            resolve(textures);
            return;
          } catch (loadError) {
            console.warn('Fallback a texture generate per errore:', loadError.message);
            // Continua con il fallback
          }
        } catch (loadError) {
          console.error('Errore caricamento bundle:', loadError);
          // Prosegui con il fallback
        }
      }
      
      // Fallback alla vecchia API o texture generate
      console.warn('Fallback a texture generate');
      createFallbackTextures();
      resolve();
      
    } catch (error) {
      console.error('Errore caricamento texture:', error);
      console.log('Creazione texture fallback...');
      createFallbackTextures();
      resolve(); // Risolvi comunque la promise per non bloccare l'inizializzazione
    }
  });
}

// ... existing code ...

// Funzione di protezione per gli event handler della tastiera
function safeKeyCode(e) {
  if (!e) return '';
  if (typeof e.key === 'string') return e.key.toLowerCase();
  if (typeof e.code === 'string') return e.code.toLowerCase();
  return '';
}

// Sostituisce handleKeyDown in modo sicuro
function handleKeyDown(e) {
  try {
    if (!e || e.repeat) return;
    const key = safeKeyCode(e);
    
    if (key === 'w' || key === 'arrowup' || key === 'keyw') {
      if (gameState) gameState.moveUp = true;
    } else if (key === 's' || key === 'arrowdown' || key === 'keys') {
      if (gameState) gameState.moveDown = true;
    } else if (key === 'a' || key === 'arrowleft' || key === 'keya') {
      if (gameState) gameState.moveLeft = true;
    } else if (key === 'd' || key === 'arrowright' || key === 'keyd') {
      if (gameState) gameState.moveRight = true;
    }
    
    // AbilitÃ  (1-3)
    if (key === '1' || key === '2' || key === '3' || key === 'digit1' || key === 'digit2' || key === 'digit3') {
      const abilityIndex = parseInt(key.replace('digit', '')) - 1;
      if (typeof activateAbility === 'function') {
        activateAbility(abilityIndex);
      }
    }
  } catch (error) {
    console.error('Errore in handleKeyDown:', error);
  }
}

// Sostituisce handleKeyUp in modo sicuro
function handleKeyUp(e) {
  try {
    if (!e) return;
    const key = safeKeyCode(e);
    
    if (key === 'w' || key === 'arrowup' || key === 'keyw') {
      if (gameState) gameState.moveUp = false;
    } else if (key === 's' || key === 'arrowdown' || key === 'keys') {
      if (gameState) gameState.moveDown = false;
    } else if (key === 'a' || key === 'arrowleft' || key === 'keya') {
      if (gameState) gameState.moveLeft = false;
    } else if (key === 'd' || key === 'arrowright' || key === 'keyd') {
      if (gameState) gameState.moveRight = false;
    }
  } catch (error) {
    console.error('Errore in handleKeyUp:', error);
  }
}

// Funzione helper per verificare i tipi in modo sicuro
function safeType(value, expectedType) {
  if (value === undefined || value === null) return false;
  return typeof value === expectedType;
}

// ... existing code ...

// Classe per gestire il caricamento e la gestione degli asset
class AssetManager {
  constructor() {
    this.textures = {};
    this.initialized = false;
    this.fallbackCreated = false;
    this.loadingPromise = null;
  }
  
  // Inizializza l'asset manager
  init() {
    if (this.initialized) return Promise.resolve();
    console.log('Inizializzazione AssetManager');
    
    // Determina la base URL in base all'ambiente
    this.baseUrl = this._getBaseUrl();
    console.log(`Base URL per assets: ${this.baseUrl}`);
    
    this.initialized = true;
    return this.loadTextures();
  }
  
  // Ottiene la base URL appropriata per l'ambiente (local/vercel)
  _getBaseUrl() {
    // Se su Vercel, aggiusta i percorsi
    if (window.location.hostname.includes('vercel.app')) {
      return '/';
    }
    
    // In locale o altri ambienti
    return '/';
  }
  
  // Carica tutte le texture necessarie
  loadTextures() {
    // Se Ã¨ giÃ  in corso un caricamento, ritorna quella Promise
    if (this.loadingPromise) return this.loadingPromise;
    
    this.loadingPromise = new Promise(async (resolve) => {
      try {
        console.log('Caricamento texture di gioco...');
        
        // Se PIXI.Assets Ã¨ disponibile (PixiJS 7+)
        if (PIXI.Assets) {
          try {
            // Inizializza Assets API
            PIXI.Assets.init({
              preferWorkers: true
            });
            
            // Definisci le risorse da caricare con percorsi assoluti
            PIXI.Assets.addBundle('game', {
              player: `${this.baseUrl}assets/images/player.png`,
              energy: `${this.baseUrl}assets/images/energy.png`,
              shield: `${this.baseUrl}assets/images/shield.png`,
              attack: `${this.baseUrl}assets/images/attack.png`,
              speed: `${this.baseUrl}assets/images/speed.png`
            });
            
            // Carica il bundle
            console.log('Caricamento assets con Assets API...');
            const loadedAssets = await PIXI.Assets.loadBundle('game');
            
            // Salva le texture caricate
            this.textures = loadedAssets;
            console.log('Texture caricate con successo', Object.keys(this.textures));
            
            // CompatibilitÃ  con vecchio loader
            PIXI.Loader = PIXI.Loader || {};
            PIXI.Loader.shared = {
              resources: {
                player: { texture: loadedAssets.player },
                energy: { texture: loadedAssets.energy },
                shield: { texture: loadedAssets.shield },
                attack: { texture: loadedAssets.attack },
                speed: { texture: loadedAssets.speed }
              }
            };
            
            resolve(this.textures);
            return;
          } catch (error) {
            console.error('Errore caricamento Assets API:', error);
            console.log('Fallback a metodo alternativo');
          }
        }
        
        // Fallback se PIXI.Assets non Ã¨ disponibile o fallisce
        this._createFallbackTextures();
        resolve(this.textures);
      } catch (error) {
        console.error('Errore critico caricamento texture:', error);
        this._createFallbackTextures();
        resolve(this.textures);
      }
    });
    
    return this.loadingPromise;
  }
  
  // Crea texture di fallback se il caricamento fallisce
  _createFallbackTextures() {
    console.log("Creazione texture fallback");
    try {
        // Verifica se PIXI è disponibile
        if (!window.PIXI) {
            console.warn("PIXI non disponibile per fallback");
            this.textures = { player: { width: 20, height: 20 }, energy: { width: 10, height: 10 } };
            return;
        }

        // Verifica se app e renderer sono disponibili
        const renderer = window.app ? window.app.renderer : null;
        if (!renderer) {
            console.warn("Renderer non disponibile per fallback, creo grafica semplice");
            this.textures = { player: { width: 20, height: 20 }, energy: { width: 10, height: 10 } };
            return;
        }

        // Crea grafica fallback per il giocatore (cerchio bianco)
        const playerGraphics = new PIXI.Graphics();
        playerGraphics.beginFill(0xffffff);
        playerGraphics.drawCircle(0, 0, 15); // Dimensione base
        playerGraphics.endFill();
        this.textures.player = renderer.generateTexture(playerGraphics);

        // Crea grafica fallback per l'energia (cerchio giallo)
        const energyGraphics = new PIXI.Graphics();
        energyGraphics.beginFill(0xf1c40f);
        energyGraphics.drawCircle(0, 0, 10); // Dimensione base
        energyGraphics.endFill();
        this.textures.energy = renderer.generateTexture(energyGraphics);

        console.log("Texture fallback create con successo");

    } catch (error) {
        console.error("Errore critico creazione texture fallback:", error);
        // Imposta textures placeholder per evitare errori successivi
        this.textures = {
            player: { width: 20, height: 20 },
            energy: { width: 10, height: 10 }
        };
    }
}
  
  // Ottiene una texture per nome
  getTexture(name) {
    // Verifica che la texture esista
    if (this.textures[name]) {
      return this.textures[name];
    }
    
    // Verifica nella vecchia struttura
    if (PIXI.Loader && PIXI.Loader.shared && 
        PIXI.Loader.shared.resources && 
        PIXI.Loader.shared.resources[name] && 
        PIXI.Loader.shared.resources[name].texture) {
      return PIXI.Loader.shared.resources[name].texture;
    }
    
    console.warn(`Texture "${name}" non trovata, creazione fallback`);
    
    // Genera una texture di emergenza
    const graphics = new PIXI.Graphics();
    graphics.beginFill(0xff00ff); // Colore magenta per identificare texture mancanti
    graphics.drawCircle(0, 0, 20);
    graphics.endFill();
    
    return app.renderer.generateTexture(graphics);
  }
}

// Istanza globale dell'asset manager
const assetManager = new AssetManager();

// ... existing code ...

// Sostituisci la funzione loadGameTextures con una chiamata all'asset manager
async function loadGameTextures() {
  return assetManager.init();
}

// ... existing code ...

// Migliora createEnergyPoint per usare l'asset manager
function createEnergyPoint(x, y) {
  try {
    // Ottieni la texture usando l'assetManager
    const texture = assetManager.getTexture('energy');
    
    // Crea lo sprite con la texture
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.width = 30;  // Dimensione aumentata per migliorare visibilitÃ 
    sprite.height = 30;
    
    // Aggiungi effetto pulse per migliorare visibilitÃ 
    const pulseAnimation = () => {
    gsap.to(sprite.scale, {
        x: 1.2,
        y: 1.2,
      duration: 0.8,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut"
      });
    };
    
    pulseAnimation();
    
    // Aggiungi effetto glow se disponibile
    try {
      if (PIXI.filters && PIXI.filters.GlowFilter) {
        const glowFilter = new PIXI.filters.GlowFilter({
          distance: 15,
          outerStrength: 2,
          innerStrength: 1,
          color: 0xffff00
        });
        sprite.filters = [glowFilter];
      }
    } catch (e) {
      console.warn('Filter non disponibili:', e);
    }
    
    // Aggiungi al container
    if (gameState.containers && gameState.containers.energy) {
      gameState.containers.energy.addChild(sprite);
      console.log(`Energy point creato a ${x},${y}`);
    } else {
      console.warn('Container energia non disponibile, aggiunta alla stage principale');
      app.stage.addChild(sprite);
    }
    
    return sprite;
  } catch (error) {
    console.error('Errore createEnergyPoint:', error);
    return null;
  }
}

// ... existing code ...

// Migliora createPlayer per usare l'asset manager
function createPlayer(id, x, y, size, username, isCurrentPlayer = false) {
  try {
    // Ottieni la texture usando l'assetManager
    const texture = assetManager.getTexture('player');
    
    // Crea container per il giocatore
    const container = new PIXI.Container();
    container.x = x;
    container.y = y;
    
    // Crea sprite del giocatore
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = size;
    sprite.height = size;
    
    // Se Ã¨ il giocatore corrente, aggiungi un evidenziatore
    if (isCurrentPlayer) {
      const highlight = new PIXI.Graphics();
      highlight.beginFill(0x00ff88, 0.3);
      highlight.drawCircle(0, 0, size * 0.6);
      highlight.endFill();
      container.addChild(highlight);
      
      // Aggiunge un'animazione pulse sull'evidenziatore
      gsap.to(highlight.scale, {
        x: 1.2,
        y: 1.2,
        duration: 1,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut"
    });
    }
    
    // Aggiungi lo sprite al container
    container.addChild(sprite);
    
    // Aggiungi testo per il nome utente
    const nameText = new PIXI.Text(username, {
      fontFamily: 'Arial',
      fontSize: 14,
      fill: isCurrentPlayer ? 0x00ff88 : 0xffffff,
      align: 'center',
      dropShadow: true,
      dropShadowColor: '#000000',
      dropShadowBlur: 4,
      dropShadowDistance: 1
    });
    nameText.anchor.set(0.5);
    nameText.y = -size / 2 - 15;
    container.addChild(nameText);
    
    // Aggiungi al container players
    if (gameState.containers && gameState.containers.players) {
      gameState.containers.players.addChild(container);
    } else {
      console.warn('Container players non disponibile, aggiunta alla stage principale');
      app.stage.addChild(container);
    }
    
    return container;
  } catch (error) {
    console.error('Errore createPlayer:', error);
    return null;
  }
}

// ... existing code ...

// Migliora initGame per utilizzare l'AssetManager
async function initGame() {
  try {
    console.log('Inizializzazione gioco...');
    
    // Inizializza PixiJS se non Ã¨ giÃ  inizializzato
    if (!app) {
      await initPixiJS();
    }
    
    // Inizializza asset manager e carica texture
    await assetManager.init();
    
    // Inizializza oggetti gioco
    setupGameState();
    
    // Assicurati che i container esistano prima di tutto
    gameState.containers = {
      background: new PIXI.Container(),
      energy: new PIXI.Container(),
      players: new PIXI.Container(),
      effects: new PIXI.Container(),
      ui: new PIXI.Container(),
      debug: new PIXI.Container()
    };
    
    // Aggiungi container alla stage in ordine corretto
    app.stage.addChild(gameState.containers.background);
    app.stage.addChild(gameState.containers.energy);
    app.stage.addChild(gameState.containers.players);
    app.stage.addChild(gameState.containers.effects);
    app.stage.addChild(gameState.containers.ui);
    
    if (gameState.debug) {
      app.stage.addChild(gameState.containers.debug);
    }
    
    // Inizializza camera avanzata
    const camera = new DynamicCamera(app, WORLD_CONFIG.width, WORLD_CONFIG.height);
    gameState.camera = camera;
    
    // Adatta il renderer in base alle performance
    const qualityManager = new RenderQualityManager(app);
    gameState.qualityManager = qualityManager;
    qualityManager.init();
    
    // Energy system
    const energySystem = new EnergySystem(gameState.containers.energy);
    gameState.energySystem = energySystem;
    energySystem.init(MAX_ENERGY_POINTS);
    
    // Connetti al server
    connectWebSocket();
    
    // Setup controlli di gioco
    const controls = setupControls();
    gameState.controls = controls;
    
    // Crea debug logger se in modalitÃ  debug
    if (gameState.debug) {
      createDebugPanel();
    }
    
    // Setup event handlers
    handleDeviceOrientation();
    
    console.log('Gioco inizializzato con successo');
    return true;
  } catch (error) {
    console.error('Errore critico inizializzazione gioco:', error);
    showMessage(`Errore inizializzazione: ${error.message}`, 'error');
    return false;
  }
}

// ... existing code ...

// Nuova implementazione dell'EnergySystem (commentata per evitare duplicazione)
/* RIMOSSO AUTOMATICAMENTE - EnergySystem Ã¨ giÃ  dichiarato in precedenza

class EnergySystem {
  constructor(container) {
    this.container = container;
    this.points = new Map();
    this.maxPoints = MAX_ENERGY_POINTS;
    this.initialized = false;
    
    console.log('EnergySystem creato');
  }
  
  // Inizializza il sistema con un numero specificato di punti
  init(maxPoints = MAX_ENERGY_POINTS) {
    if (this.initialized) {
      console.log('EnergySystem giÃ  inizializzato');
      return;
    }
    
    this.maxPoints = maxPoints;
    console.log(`Inizializzazione sistema energia con ${maxPoints} punti`);
    
    // Genera punti energia iniziali
    this.generateInitialPoints();
    
    this.initialized = true;
  }
  
  // Genera punti energia iniziali
  generateInitialPoints() {
    // Pulisci punti esistenti se necessario
    this.clearPoints();
    
    // Crea nuovi punti energia in posizioni casuali
    for (let i = 0; i < this.maxPoints; i++) {
      const x = Math.random() * WORLD_CONFIG.width;
      const y = Math.random() * WORLD_CONFIG.height;
      this.addPoint(x, y);
    }
    
    console.log(`Generati ${this.points.size} punti energia`);
  }
  
  // Aggiunge un punto energia alla posizione specificata
  addPoint(x, y) {
    const id = `energy-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const sprite = createEnergyPoint(x, y);
    
    if (sprite) {
      this.points.set(id, { id, x, y, sprite });
      return id;
    }
    
    return null;
  }
  
  // Rimuove un punto energia
  removePoint(id) {
    const point = this.points.get(id);
    if (point && point.sprite) {
      if (point.sprite.parent) {
        point.sprite.parent.removeChild(point.sprite);
      }
      this.points.delete(id);
      return true;
    }
    return false;
  }
  
  // Aggiorna tutti i punti energia
  update(delta) {
    if (this.points.size < this.maxPoints) {
      // Aggiungi punti se ce ne sono meno del massimo
      const pointsToAdd = Math.min(3, this.maxPoints - this.points.size);
      
      for (let i = 0; i < pointsToAdd; i++) {
        const x = Math.random() * WORLD_CONFIG.width;
        const y = Math.random() * WORLD_CONFIG.height;
        this.addPoint(x, y);
      }
    }
  }
  
  // Gestisce la raccolta di un punto energia
  collectPoint(id, playerId) {
    const point = this.points.get(id);
    if (point) {
      // Crea effetto di raccolta
      createCollectEffect(point.x, point.y);
      
      // Rimuovi il punto
      this.removePoint(id);
      
      // Aggiorna score e dimensione del giocatore
      updatePlayerScore(playerId, ENERGY_VALUE);
      
      // Aggiungi nuovo punto in una posizione casuale
      const x = Math.random() * WORLD_CONFIG.width;
      const y = Math.random() * WORLD_CONFIG.height;
      this.addPoint(x, y);
    }
  }
  
  // Elimina tutti i punti energia
  clearPoints() {
    this.points.forEach(point => {
      if (point.sprite && point.sprite.parent) {
        point.sprite.parent.removeChild(point.sprite);
      }
    });
    
    this.points.clear();
  }
  
  // Converte i punti in un array per l'invio al server
  getPointsArray() {
    const pointsArray = [];
    this.points.forEach(point => {
      pointsArray.push({
        id: point.id,
        x: point.x,
        y: point.y
      });
    });
    return pointsArray;
  }
  
  // Aggiorna i punti dal server
  updateFromServer(pointsData) {
    if (!Array.isArray(pointsData)) {
      console.error('pointsData non Ã¨ un array:', pointsData);
      return;
    }
    
    try {
      // Mappatura degli ID dei punti dal server
      const serverPointIds = new Set(pointsData.map(p => p.id));
      
      // Rimuovi i punti che non sono piÃ¹ nel server
      this.points.forEach((point, id) => {
        if (!serverPointIds.has(id)) {
          this.removePoint(id);
        }
      });
      
      // Aggiungi o aggiorna punti dal server
      pointsData.forEach(pointData => {
        if (!this.points.has(pointData.id)) {
          // Aggiungi nuovo punto
          const sprite = createEnergyPoint(pointData.x, pointData.y);
          if (sprite) {
            this.points.set(pointData.id, {
              id: pointData.id,
              x: pointData.x,
              y: pointData.y,
              sprite
            });
          }
        } else {
          // Aggiorna posizione del punto esistente
          const point = this.points.get(pointData.id);
          point.x = pointData.x;
          point.y = pointData.y;
          
          if (point.sprite) {
            point.sprite.x = pointData.x;
            point.sprite.y = pointData.y;
          }
        }
      });
      
      console.log(`Punti energia aggiornati dal server: ${this.points.size}`);
    } catch (error) {
      console.error('Errore aggiornamento punti dal server:', error);
    }
  }
}

*/
// ... existing code ...

// Aggiungi questa riga per assicurare che initGame sia disponibile globalmente
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
    initPixiJS(); // Questa ora dovrebbe creare window.app

    // Verifica se app è stato creato correttamente
    if (!window.app) {
      throw new Error('Applicazione PixiJS non creata correttamente da initPixiJS');
    }

    // Inizializza gameState se non esiste
    if (!window.gameState) {
      window.gameState = {
        players: new Map(),
        energyPoints: new Map(),
        camera: null,
        containers: null,
        worldContainer: null,
        debug: false
      };
    }

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
    connectWebSocket();

    // Gestisci orientamento dispositivo
    handleDeviceOrientation();
    
    // Inizia il game loop
    if (!app.ticker.started) {
      app.ticker.add(gameLoop);
    }

    // Inizializza debugger se disponibile
    if (window.initBrawlDebugger) {
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

// Trova la funzione initGame e aggiungi l'inizializzazione del debugger alla fine
async function initGame() {
  try {
    // ... codice esistente ...
    
    // Inizia l'aggiornamento
    if (!app.ticker.started) {
      app.ticker.add(gameLoop);
      console.log('Game loop avviato');
    }

    // Inizializza debugger se disponibile
    if (window.initBrawlDebugger) {
      console.log('Inizializzazione strumenti di debug...');
      window.initBrawlDebugger(app, gameState, PIXI);
    }
  } catch (error) {
    console.error('Errore in initGame:', error);
    showMessage('Errore inizializzazione gioco. Ricarica la pagina.', 'error');
  }
}

// Funzione per inizializzare PixiJS
function initPixiJS() {
    console.log("Inizializzazione PixiJS");
    try {
        // Verifica se PIXI è disponibile
        if (typeof PIXI === 'undefined') {
            console.error("PIXI non è definito");
            showMessage("Impossibile inizializzare il gioco. Ricarica la pagina o prova un browser diverso.", "error");
            return false;
        }
        
        // Opzioni per l'app PixiJS
        const appOptions = {
            backgroundColor: 0x1a1a1a,
            resolution: window.devicePixelRatio || 1,
            antialias: true,
            autoDensity: true,
            powerPreference: 'high-performance',
            // Non specificare il renderer, lasciamo che PixiJS scelga quello migliore
        };
        
        // Crea l'app PixiJS
        app = new PIXI.Application(appOptions);
        
        // Rimuovi qualsiasi canvas precedente
        const existingCanvas = document.querySelector('#game-container canvas');
        if (existingCanvas) {
            existingCanvas.remove();
        }
        
        // Aggiungi il nuovo canvas al container
        const gameContainer = document.getElementById('game-container');
        gameContainer.appendChild(app.view);
        
        // Imposta le dimensioni
        app.renderer.resize(window.innerWidth, window.innerHeight);
        
        // Registra il tipo di renderer utilizzato
        console.log(`Utilizzando renderer: ${app.renderer.type === PIXI.RENDERER_TYPE.WEBGL ? 'WebGL' : 'Canvas'}`);
        
        return true;
    } catch (error) {
        console.error("Errore nell'inizializzazione di PixiJS:", error);
        showMessage("Si è verificato un errore durante l'inizializzazione del gioco", "error");
        return false;
    }
}

// Mostra un messaggio a schermo
function showMessage(text, type = 'info') {
    const message = document.createElement('div');
    message.className = `message ${type}`;
    message.textContent = text;
    
    const container = document.getElementById('message-container');
    if (container) {
        container.appendChild(message);
        
        // Rimuovi dopo un po'
        setTimeout(() => {
            message.classList.add('fade-out');
            setTimeout(() => {
                if (message.parentNode) {
                    message.parentNode.removeChild(message);
                }
            }, 300);
        }, 3000);
    } else {
        console.warn('Container messaggi non trovato');
    }
}

// Funzione di gameloop base
function gameLoop(delta) {
    // Aggiorna posizione e stato degli elementi di gioco
    if (gameState.players && gameState.playerId) {
        const localPlayer = gameState.players.get(gameState.playerId);
        if (localPlayer && localPlayer.sprite) {
            // Logica di aggiornamento del giocatore
        }
    }
    
    // Aggiorna le sfere di energia
    if (gameState.energyPoints) {
        gameState.energyPoints.forEach(point => {
            if (point && point.sprite) {
                // Logica di aggiornamento delle sfere energia
            }
        });
    }
}

// Funzione per gestire l'orientamento del dispositivo
function handleDeviceOrientation() {
    // Verifica se è un dispositivo mobile
    if (isMobileDevice()) {
        const checkOrientation = () => {
            const isPortrait = window.innerHeight > window.innerWidth;
            const orientationMessage = document.getElementById('orientation-message');
            
            if (isPortrait) {
                // Crea messaggio se non esiste
                if (!orientationMessage) {
                    const message = document.createElement('div');
                    message.id = 'orientation-message';
                    message.innerHTML = `
                        <div class="orientation-content">
                            <div class="device-icon">📱</div>
                            <div class="message-text">Ruota il dispositivo in orizzontale per una migliore esperienza di gioco</div>
                        </div>
                    `;
                    message.style.position = 'fixed';
                    message.style.top = '0';
                    message.style.left = '0';
                    message.style.width = '100%';
                    message.style.height = '100%';
                    message.style.display = 'flex';
                    message.style.alignItems = 'center';
                    message.style.justifyContent = 'center';
                    message.style.backgroundColor = 'rgba(0,0,0,0.8)';
                    message.style.zIndex = '9999';
                    message.style.color = 'white';
                    message.style.fontFamily = 'Arial, sans-serif';
                    message.style.textAlign = 'center';
                    message.style.padding = '20px';
                    
                    document.body.appendChild(message);
                }
            } else {
                // Rimuovi messaggio se esiste
                if (orientationMessage) {
                    orientationMessage.remove();
                }
            }
        };
        
        // Controlla subito orientamento
        checkOrientation();
        
        // Aggiungi listener per il resize
        window.addEventListener('resize', checkOrientation);
    }
}

// Funzione per controllare se il dispositivo è mobile
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
}

// ... existing code ...