// Configurazione PixiJS
let app;
let socket;
let reconnectAttempts = 0;
const msgpack = window.msgpack5();

// Configurazione mondo di gioco
const WORLD_CONFIG = {
  width: 3000,
  height: 3000,
  minZoom: 0.5,  // Zoom minimo (più lontano)
  maxZoom: 1.2,  // Zoom massimo (più vicino)
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
    
    // Trova i due snapshot più vicini al tempo di rendering
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
    
    // Se la differenza è troppo grande, applica una correzione graduale
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
    
    // Se la differenza è accettabile, mantieni lo stato corrente
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
  
  // Applica le impostazioni di qualità
  applyQuality(level) {
    if (!this.settings.qualityLevels[level]) {
      console.error(`Livello di qualità non valido: ${level}`);
      return false;
    }
    
    const settings = this.settings.qualityLevels[level];
    this.settings.currentQuality = level;
    
    // Applica le impostazioni di rendering se PIXI è inizializzato
    if (app && app.renderer) {
      console.log(`Applicazione qualità ${level}: resolution=${settings.resolution}`);
      
      // Imposta la risoluzione del renderer
      app.renderer.resolution = settings.resolution;
      
      // Gestisci i filtri in base al livello di qualità
      this.updateFilters(settings.filterLevel);
      
      // Memorizza la densità particelle per futuri effetti
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
  
  // Monitora gli FPS e regola la qualità automaticamente
  monitorPerformance(fps) {
    if (!this.settings.autoAdjust) return;
    
    // Mantieni una storia degli FPS
    this.settings.fpsHistory.push(fps);
    if (this.settings.fpsHistory.length > 30) {
      this.settings.fpsHistory.shift();
    }
    
    // Calcola la media degli FPS
    const avgFps = this.settings.fpsHistory.reduce((sum, val) => sum + val, 0) / this.settings.fpsHistory.length;
    
    // Regola qualità se necessario
    if (this.settings.fpsHistory.length >= 30) {
      if (avgFps < this.settings.fpsLow && this.settings.currentQuality !== 'low') {
        console.log(`Performance bassa (${avgFps.toFixed(1)} FPS): passaggio a qualità bassa`);
        this.applyQuality('low');
      } else if (avgFps > this.settings.fpsTarget * 1.2 && this.settings.currentQuality === 'low') {
        console.log(`Performance buona (${avgFps.toFixed(1)} FPS): passaggio a qualità media`);
        this.applyQuality('medium');
      } else if (avgFps > this.settings.fpsTarget * 1.5 && this.settings.currentQuality === 'medium') {
        console.log(`Performance eccellente (${avgFps.toFixed(1)} FPS): passaggio a qualità alta`);
        this.applyQuality('high');
      }
    }
  },
  
  // Inizializza il gestore qualità
  init() {
    // Rileva e imposta la qualità iniziale
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

// Estensione della classe DynamicCamera con funzionalità avanzate
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
    
    // Usa il minore dei due zoom e applica il fattore di decadimento per più giocatori
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
  
  // Overload di updateZoom per compatibilità
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
    
    // Interpolazione più lenta dello zoom per evitare cambi bruschi
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
  
  // Zoom rapido temporaneo (es. per visione più ampia)
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
  
  // Imposta la posizione e visibilità
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
  
  // Monitora le prestazioni per regolare la qualità
  if (renderQualityManager) {
    renderQualityManager.monitorPerformance(fps);
  }
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
         (window.innerWidth <= 800 && window.innerHeight <= 600);
}

// Modifica la funzione initGame per usare il sistema di qualità
function initGame() {
  console.log("Inizializzazione del gioco");
  
  // Inizializza il gestore qualità prima di tutto
  const qualityLevel = renderQualityManager.init();
  console.log(`Inizializzazione del gioco con qualità: ${qualityLevel}`);
  
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
    if (gameState.contextLost) return; // Salta il rendering se il contesto è perso
    
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
      // Salta punti già raccolti
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
    // Salta punti già raccolti
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
  
  // Se il livello è cambiato
  if (newLevel > gameState.level) {
    gameState.level = newLevel;
    
    // Trova il nome del livello
    const levelInfo = LEVEL_THRESHOLDS.find(t => t.level === newLevel);
    
    // Mostra messaggio di avanzamento
    showMessage(`Hai raggiunto il livello ${newLevel}: ${levelInfo.name}!`, 'success');
    
    // Se il livello ha un'abilità, mostra un messaggio
    if (levelInfo.ability) {
      showMessage(`Hai sbloccato l'abilità: ${getAbilityName(levelInfo.ability)}!`, 'info');
    }
  };
}

// Funzione per ottenere il nome dell'abilità
function getAbilityName(abilityKey) {
  const abilityNames = {
    'speed': 'Velocità',
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
    
    // Velocità e direzione casuale
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
// Create visual effect for energy collection
function createCollectEffect(x, y) {
    // Create particles
    for (let i = 0; i < 10; i++) {
        const particle = new PIXI.Graphics();
        particle.beginFill(0x00ff88, 0.8);
        particle.drawCircle(0, 0, Math.random() * 4 + 2);
        particle.endFill();
        particle.x = x;
        particle.y = y;
        
        // Add to stage
        app.stage.addChild(particle);
        
        // Random direction
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 50 + 20;
        const duration = Math.random() * 0.5 + 0.3;
        
        // Animate
        gsap.to(particle, {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            alpha: 0,
            duration: duration,
            ease: "power2.out",
            onComplete: () => {
                app.stage.removeChild(particle);
            }
        });
    }
    
    // Create flash effect
    const flash = new PIXI.Graphics();
    flash.beginFill(0x00ff88, 0.4);
    flash.drawCircle(0, 0, 20);
    flash.endFill();
    flash.x = x;
    flash.y = y;
    app.stage.addChild(flash);
    
    // Animate flash
    gsap.to(flash, {
        alpha: 0,
        pixi: { scale: 3 },
        duration: 0.4,
        ease: "power2.out",
        onComplete: () => {
            app.stage.removeChild(flash);
        }
    });
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
        
        // Gestione della perdita del contesto WebGL
        if (app.renderer.type === PIXI.RENDERER_TYPE.WEBGL) {
            const gl = app.renderer.gl;
            const canvas = app.view;
            
            // Gestione perdita contesto WebGL
            canvas.addEventListener('webglcontextlost', (event) => {
                event.preventDefault(); // Necessario per permettere il ripristino
                console.warn('Contesto WebGL perso, interrompo il rendering');
                
                // Ferma il game loop
                app.ticker.stop();
                
                // Mostra un messaggio all'utente
                showMessage('Perdita contesto grafico. Tentativo di ripristino in corso...', 'warning');
                
                // Flag per indicare che il contesto è perso
                gameState.contextLost = true;
            }, false);
            
            // Gestione ripristino contesto WebGL
            canvas.addEventListener('webglcontextrestored', () => {
                console.log('Contesto WebGL ripristinato');
                
                // Ricarica le risorse grafiche se necessario
                refreshGameObjects();
                
                // Riavvia il game loop
                app.ticker.start();
                
                // Rimuovi il flag
                gameState.contextLost = false;
                
                // Informa l'utente
                showMessage('Contesto grafico ripristinato', 'success');
            }, false);
            
            // Funzione di fallback al Canvas renderer se WebGL continua a fallire
            let webGLFailCount = 0;
            const maxWebGLFailures = 3;
            
            // Aggiungi un listener per gli errori
            canvas.addEventListener('webglcontextcreationerror', (event) => {
                console.error('Errore nella creazione del contesto WebGL:', event.statusMessage);
                webGLFailCount++;
                
                if (webGLFailCount >= maxWebGLFailures) {
                    console.warn('Troppi fallimenti WebGL, passaggio al renderer Canvas');
                    showMessage('Problemi con il renderer WebGL. Passaggio alla modalità compatibilità.', 'warning');
                    
                    // Ricrea l'app con il renderer Canvas
                    reinitWithCanvasRenderer();
                }
            }, false);
        }
        
        // Verifica le dimensioni e orientamento per dispositivi mobili
        handleDeviceOrientation();
        
        // Aggiungi evento di ridimensionamento per gestire resizing
        setupResizeHandler();
        
        return true;
    } catch (error) {
        console.error("Errore nell'inizializzazione di PixiJS:", error);
        showMessage("Si è verificato un errore durante l'inizializzazione del gioco", "error");
        return false;
    }
}

// Fallback a Canvas renderer se WebGL fallisce
function reinitWithCanvasRenderer() {
    try {
        console.log("Reinizializzazione con Canvas renderer");
        
        // Rimuovi l'app e il canvas esistenti
        if (app) {
            app.destroy(true, {
                children: true,
                texture: true,
                baseTexture: true
            });
        }
        
        // Crea una nuova app con Canvas renderer
        app = new PIXI.Application({
            backgroundColor: 0x1a1a1a,
            resolution: window.devicePixelRatio || 1,
            antialias: true,
            forceCanvas: true, // Forza l'uso del renderer Canvas
        });
        
        // Aggiungi il nuovo canvas al container
        const gameContainer = document.getElementById('game-container');
        gameContainer.innerHTML = ''; // Rimuovi tutto il contenuto precedente
        gameContainer.appendChild(app.view);
        
        // Reimposta le dimensioni
        app.renderer.resize(window.innerWidth, window.innerHeight);
        
        // Ricrea gli oggetti di gioco
        refreshGameObjects();
        
        console.log("Reinizializzazione completata con renderer Canvas");
        
        // Notifica all'utente
        showMessage("Modalità compatibilità attivata", "info");
        
        return true;
    } catch (error) {
        console.error("Errore nella reinizializzazione con Canvas renderer:", error);
        showMessage("Impossibile avviare il gioco in modalità compatibilità", "error");
        return false;
    }
}

// Ricarica gli oggetti di gioco dopo perdita contesto
function refreshGameObjects() {
    // Pulisci lo stage
    app.stage.removeChildren();
    
    // Ricrea lo sfondo
    createBackground();
    
    // Ricrea i punti energia
    if (gameState.energyPoints) {
        gameState.energyPoints.forEach(point => {
            if (point && point.parent) {
                point.parent.removeChild(point);
            }
        });
    }
    gameState.energyPoints = [];
    initEnergyPoints();
    
    // Ricrea i giocatori
    const playerIds = [...gameState.players.keys()];
    playerIds.forEach(id => {
        const oldPlayer = gameState.players.get(id);
        if (oldPlayer) {
            // Salva le proprietà importanti
            const props = {
                x: oldPlayer.x,
                y: oldPlayer.y,
                size: oldPlayer.size || INITIAL_SIZE,
                score: oldPlayer.score || 0,
                name: oldPlayer.children && oldPlayer.children[2] ? oldPlayer.children[2].text : "",
                isLocal: id === gameState.playerId
            };
            
            // Rimuovi il vecchio sprite
            if (oldPlayer.parent) {
                oldPlayer.parent.removeChild(oldPlayer);
            }
            
            // Crea un nuovo sprite
            const newPlayer = createPlayerSprite(id, props.isLocal, props.size);
            if (newPlayer) {
                newPlayer.x = props.x;
                newPlayer.y = props.y;
                newPlayer.targetX = props.x;
                newPlayer.targetY = props.y;
                newPlayer.score = props.score;
                
                if (props.name) {
                    newPlayer.children[2].text = props.name;
                }
                
                gameState.players.set(id, newPlayer);
            }
        }
    });
    
    // Se siamo il giocatore locale e non esiste, ricrealo
    if (!gameState.players.has(gameState.playerId)) {
        const localPlayer = createPlayerSprite(gameState.playerId, true, INITIAL_SIZE);
        if (localPlayer) {
            const screenWidth = app.renderer.width;
            const screenHeight = app.renderer.height;
            
            localPlayer.x = screenWidth / 2;
            localPlayer.y = screenHeight / 2;
            localPlayer.targetX = localPlayer.x;
            localPlayer.targetY = localPlayer.y;
            
            gameState.players.set(gameState.playerId, localPlayer);
            gameState.lastPosition = { x: localPlayer.x, y: localPlayer.y };
        }
    }
    
    console.log("Oggetti di gioco ricaricati");
}

// Aggiorna la funzione di movimento per usare la mappa grande
function updateMovement(delta) {
  // Ottieni il giocatore locale
  const player = gameState.players.get(gameState.playerId);
  if (!player) return;
  
  // Memorizza la posizione precedente per confronto
  const prevPosition = {
    x: player.x,
    y: player.y
  };
  
  // Calcola la velocità in base al delta e alla dimensione
  // Giocatori più grandi si muovono più lentamente
  const sizeSpeedFactor = Math.max(0.5, 1 - (player.size / 300));
  const moveSpeed = PLAYER_SPEED * delta * sizeSpeedFactor;
  
  // Variabile per tracciare se il giocatore si è spostato
  let moved = false;
  
  // Aggiorna movimento basato su tasti
  if (gameState.keys.w) {
    player.y -= moveSpeed;
    moved = true;
  }
  if (gameState.keys.s) {
    player.y += moveSpeed;
    moved = true;
  }
  if (gameState.keys.a) {
    player.x -= moveSpeed;
    moved = true;
  }
  if (gameState.keys.d) {
    player.x += moveSpeed;
    moved = true;
  }
  
  // Supporto per joystick mobile se presente
  if (gameState.joystickData) {
    if (gameState.joystickData.up) {
      player.y -= moveSpeed * gameState.joystickData.strength;
      moved = true;
    }
    if (gameState.joystickData.down) {
      player.y += moveSpeed * gameState.joystickData.strength;
      moved = true;
    }
    if (gameState.joystickData.left) {
      player.x -= moveSpeed * gameState.joystickData.strength;
      moved = true;
    }
    if (gameState.joystickData.right) {
      player.x += moveSpeed * gameState.joystickData.strength;
      moved = true;
    }
  }
  
  // Limita il movimento ai bordi del mondo
  const effectiveRadius = player.size / 2;
  const padding = WORLD_CONFIG.padding;
  
  player.x = Math.max(effectiveRadius + padding, 
               Math.min(player.x, WORLD_CONFIG.width - effectiveRadius - padding));
  player.y = Math.max(effectiveRadius + padding, 
               Math.min(player.y, WORLD_CONFIG.height - effectiveRadius - padding));
  
  // Aggiorna le posizioni target per interpolazione fluida
  player.targetX = player.x;
  player.targetY = player.y;
  
  // Calcola la distanza percorsa
  const dx = player.x - prevPosition.x;
  const dy = player.y - prevPosition.y;
  const distance = Math.sqrt(dx*dx + dy*dy);
  
  // Invia aggiornamenti al server solo se necessario
  const currentTime = Date.now();
  const timeSinceLastUpdate = currentTime - (gameState.lastUpdate || 0);
  
  if ((moved && distance > 1) || timeSinceLastUpdate > 100) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Determina se mandare coordinata assoluta o relativa
      const useAbsolutePosition = timeSinceLastUpdate > 1000;
      
      if (useAbsolutePosition) {
        // Posizione assoluta periodica per risync
        socket.send(msgpack.encode({
          type: 'move',
          id: gameState.playerId,
          x: Math.round(player.x),
          y: Math.round(player.y)
        }));
      } else {
        // Delta di movimento per ottimizzare
        socket.send(msgpack.encode({
          type: 'move',
          id: gameState.playerId,
          dx: Math.round(dx),
          dy: Math.round(dy)
        }));
      }
      
      // Aggiorna ultimo timestamp e posizione
      gameState.lastPosition = { x: player.x, y: player.y };
      gameState.lastUpdate = currentTime;
    }
  }
  
  // Controlla collisioni
  checkEnergyCollisions();
  checkPlayerCollisions();
}

// Funzione per verificare le collisioni con i punti energia
function checkEnergyCollisions() {
  // Ottieni il giocatore locale
  const player = gameState.players.get(gameState.playerId);
  if (!player || !gameState.energyPoints || gameState.energyPoints.size === 0) return;
  
  // Raggio effettivo per collisione
  const playerRadius = player.size / 2;
  
  // Per ogni punto energia, verifica la collisione
  gameState.energyPoints.forEach((point, i) => {
    
    // Calcola distanza
    const dx = player.x - point.x;
    const dy = player.y - point.y;
    const distance = Math.sqrt(dx*dx + dy*dy);
    
    // Se il giocatore tocca il punto energia
    if (distance < playerRadius + 10) { // 10 = raggio del punto energia
      // Rimuovi punto energia visivamente
      if (point.parent) {
        point.parent.removeChild(point);
      }
      
      // Rimuovi dalla mappa
      gameState.energyPoints.delete(i);
      
      // Incrementa punteggio e dimensione
      player.score += 10;
      const newSize = Math.min(player.size + 2, 200); // Limita dimensione massima
      
      // Aggiorna dimensione del player
      updatePlayerSize(player, newSize);
      
      // Effetto particellare
      createCollectEffect(point.x, point.y);
      
      // Invia al server
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(msgpack.encode({
          type: 'collectEnergy',
          id: gameState.playerId,
          score: player.score,
          size: player.size
        }));
      }
      
      // Crea nuovo punto energia in una posizione casuale
      const padding = WORLD_CONFIG.padding + 50;
      const x = padding + Math.random() * (WORLD_CONFIG.width - padding * 2);
      const y = padding + Math.random() * (WORLD_CONFIG.height - padding * 2);
      
      const newPoint = createEnergyPoint(x, y);
      const newId = Date.now() + Math.random().toString(36).substr(2, 9);
      gameState.energyPoints.set(newId, newPoint);
    }
  });
}

// Funzione per aggiornare la dimensione del giocatore
function updatePlayerSize(player, newSize) {
  if (!player) return;
  
  // Memorizza la vecchia dimensione
  const oldSize = player.size;
  
  // Aggiorna la proprietà size
  player.size = newSize;
  
  // Aggiorna il corpo del giocatore
  if (player.children && player.children[0]) {
    // Corpo principale
    const mainCircle = player.children[0];
    mainCircle.clear();
    mainCircle.beginFill(player.isLocal ? 0x00ff88 : 0xff3333, 0.8);
    mainCircle.drawCircle(0, 0, newSize / 2);
    mainCircle.endFill();
  }
  
  // Aggiorna il bordo
  if (player.children && player.children[1]) {
    const border = player.children[1];
    border.clear();
    border.lineStyle(2, 0xffffff, 0.5);
    border.drawCircle(0, 0, newSize / 2 + 1);
  }
  
  // Aggiorna la posizione del nome
  if (player.children && player.children[2]) {
    player.children[2].y = -newSize / 2 - 15;
  }
  
  // Crea effetto level up se è il giocatore locale e la dimensione è aumentata
  if (player.isLocal && newSize > oldSize) {
    createLevelUpEffect(player);
    checkLevelUp(player);
  }
  
  return newSize;
}

// Controlla se il giocatore ha raggiunto un nuovo livello
function checkLevelUp(player) {
  if (!player) return;
  
  // Trova il livello corrispondente alla dimensione attuale
  let newLevel = 1;
  
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (player.size >= LEVEL_THRESHOLDS[i].size) {
      newLevel = LEVEL_THRESHOLDS[i].level;
      break;
    }
  }
  
  // Se il livello è cambiato
  if (newLevel > player.level) {
    player.level = newLevel;
    
    // Trova l'abilità sbloccata a questo livello
    const levelData = LEVEL_THRESHOLDS.find(l => l.level === newLevel);
    
    if (levelData) {
      // Mostra messaggio di level up
      showMessage(`Livello ${newLevel}: ${levelData.name}!`, 'success');
      
      // Se c'è un'abilità, mostra info
      if (levelData.ability) {
        showMessage(`Hai sbloccato l'abilità: ${levelData.ability.toUpperCase()}`, 'info', 3000);
      }
    }
  };
}

// Funzione per creare punti energia in posizioni specifiche
function spawnEnergyPointAt(x, y) {
    // Verifica che l'app e lo stage siano inizializzati
    if (!app || !app.stage) {
        console.warn("Impossibile creare punto energia: app o stage non disponibile");
        return null;
    }
    
    // Crea un nuovo punto energia
    const energyPoint = new PIXI.Graphics();
    energyPoint.beginFill(0x00ff00, 0.7);
    energyPoint.drawCircle(0, 0, 10);
    energyPoint.endFill();
    
    // Aggiungi effetto di brillantezza
    energyPoint.filters = [new PIXI.filters.GlowFilter(15, 2, 1, 0x00ff00, 0.5)];
    
    // Imposta la posizione
    energyPoint.x = x;
    energyPoint.y = y;
    
    // Aggiungi all'app
    app.stage.addChild(energyPoint);
    
    // Aggiungi alla lista di punti energia
    if (!gameState.energyPoints) {
        gameState.energyPoints = [];
    }
    gameState.energyPoints.push(energyPoint);
    
    // Animazione pulsante
    gsap.to(energyPoint.scale, {
        x: 1.2,
        y: 1.2,
        duration: 0.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut"
    });
    
    return energyPoint;
}

// Rileva e correggi automaticamente i problemi di rendering
function setupAutomaticRecovery() {
    // Controllo periodico dello stato del rendering
    const recoveryInterval = setInterval(() => {
        // Se il contesto è perso da troppo tempo, tenta il ripristino forzato
        if (gameState.contextLost) {
            const timeSinceLost = Date.now() - gameState.contextLostTime;
            
            if (timeSinceLost > 5000) { // 5 secondi
                console.warn("Tentativo di recupero forzato del contesto...");
                
                // Tenta di passare al renderer Canvas se non ci siamo già
                if (app && app.renderer.type === PIXI.RENDERER_TYPE.WEBGL) {
                    reinitWithCanvasRenderer();
                } else {
                    // Se siamo già in Canvas o altro, ricrea tutto
                    initGame();
                }
            }
        }
        
        // Verifica anche se l'app è in esecuzione ma ci sono problemi di rendering
        if (app && app.ticker.started) {
            // Se il giocatore locale non è visibile ma dovrebbe esserlo
            const localPlayer = gameState.players.get(gameState.playerId);
            if (localPlayer && !localPlayer.visible && !gameState.contextLost) {
                console.warn("Rilevato problema di visibilità, tentativo di recupero...");
                refreshGameObjects();
            }
        }
    }, 10000); // Controlla ogni 10 secondi
    
    // Memorizza il riferimento per fermare il controllo se necessario
    gameState.recoveryInterval = recoveryInterval;
}

// Modifica la funzione initGame per usare il nuovo sistema di recupero
function initGame(username) {
    console.log("Inizializzazione del gioco");
    
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
    
    // Inizializza il contatore FPS
    initFpsCounter();
    
    // Inizializza sfondo
    createBackground();
    
    // Inizializza punti energia
    initEnergyPoints();
    
    // Nasconde la schermata di login
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    // Inizializza controlli
    setupControls();
    
    // Connetti al server
    connectWebSocket();
    
    // Attiva il sistema di recupero automatico
    setupAutomaticRecovery();
    
    // Imposta il loop di gioco principale
    app.ticker.add(delta => {
        if (gameState.contextLost) return; // Salta il rendering se il contesto è perso
        
        updateMovement(delta);
        interpolatePlayers(delta);
        updateEnergyPoints(delta);
        
        // Aggiorna contatore FPS
        updateFpsCounter(app.ticker.FPS);
    });
    
    console.log("Gioco inizializzato con successo");
}

// Aggiorna il gameState per tracciare lo stato del contesto WebGL
gameState.contextLost = false;
gameState.contextLostTime = 0;
gameState.recoveryInterval = null;

// Aggiungi il predictor al gameState
gameState.movementPredictor = new MovementPredictor();

// Modifica la funzione di gestione del messaggio di stato
function handleStateUpdate(data) {
  if (!data.players || !Array.isArray(data.players)) return;
  
  // Ottieni i giocatori attuali
  const currentPlayerIds = new Set(gameState.players.keys());
  
  // Traccia i giocatori aggiornati
  const updatedPlayerIds = new Set();
  
  // Aggiorna o crea tutti i giocatori
  data.players.forEach(playerData => {
    // Aggiungi uno snapshot per i giocatori remoti al predictor
    if (playerData.id !== gameState.playerId && gameState.movementPredictor) {
      gameState.movementPredictor.addSnapshot(playerData);
    }
    
    // Aggiorna o crea il giocatore
    updateOrCreatePlayer(playerData);
    updatedPlayerIds.add(playerData.id);
  });
  
  // Rimuovi giocatori non più presenti (tranne il locale che dovrebbe sempre esserci)
  currentPlayerIds.forEach(id => {
    if (!updatedPlayerIds.has(id) && id !== gameState.playerId) {
      const player = gameState.players.get(id);
      if (player && player.parent) {
        player.parent.removeChild(player);
      }
      gameState.players.delete(id);
    }
  });
  
  // Se non c'è il giocatore locale nel set aggiornato, assicurati che ci sia
  if (!updatedPlayerIds.has(gameState.playerId) && gameState.playerId) {
    const localPlayer = gameState.players.get(gameState.playerId);
    if (!localPlayer) {
      // Ricrea il giocatore locale
      const newLocalPlayer = createPlayerSprite(gameState.playerId, true, INITIAL_SIZE);
      if (newLocalPlayer) {
        const screenWidth = app.renderer.width;
        const screenHeight = app.renderer.height;
        
        newLocalPlayer.x = screenWidth / 2;
        newLocalPlayer.y = screenHeight / 2;
        
        gameState.players.set(gameState.playerId, newLocalPlayer);
        gameState.lastPosition = { x: newLocalPlayer.x, y: newLocalPlayer.y };
      }
    }
  }
  
  // Aggiorna leaderboard
  updateLeaderboard();
}

// Modifica updateOrCreatePlayer per usare il predictor
function updateOrCreatePlayer(playerData) {
  if (!playerData || !playerData.id) return;
  
  let player = gameState.players.get(playerData.id);
  const isLocal = playerData.id === gameState.playerId;
  
  if (!player) {
    // Crea un nuovo sprite per questo giocatore
    player = createPlayerSprite(playerData.id, isLocal, playerData.size || INITIAL_SIZE);
    
    // Aggiungi al gameState
    gameState.players.set(playerData.id, player);
  }
  
  // Aggiorna le proprietà del giocatore
  if (player) {
    if (isLocal) {
      // Per il giocatore locale usiamo la position corrente
      // ma aggiungiamo un po' di correzione se il server è troppo divergente
      const serverX = playerData.x;
      const serverY = playerData.y;
      const localX = player.x;
      const localY = player.y;
      
      // Calcola distanza
      const dx = serverX - localX;
      const dy = serverY - localY;
      const distance = Math.sqrt(dx*dx + dy*dy);
      
      // Se la divergenza è grande, correggila gradualmente
      if (distance > 100) {
        player.x += dx * 0.2;
        player.y += dy * 0.2;
        console.log('Correzione posizione con server:', distance.toFixed(2));
      }
    } else {
      // Per gli altri giocatori, usa il predictor
      if (gameState.movementPredictor) {
        // Riconcilia lo stato solo se playerData contiene posizione
        if (typeof playerData.x === 'number' && typeof playerData.y === 'number') {
          // Predici la posizione
          const predicted = gameState.movementPredictor.predict(playerData);
          
          // Riconcilia con lo stato del server
          const reconciled = gameState.movementPredictor.reconcile(playerData);
          
          // Aggiorna le coordinate target
          player.targetX = reconciled.x;
          player.targetY = reconciled.y;
        }
      } else {
        // Fallback al vecchio metodo
        player.targetX = playerData.x;
        player.targetY = playerData.y;
      }
    }
    
    // Aggiorna dimensione
    if (playerData.size && player.size !== playerData.size) {
      updatePlayerSize(player, playerData.size);
    }
    
    // Aggiorna punteggio
    if (playerData.score !== undefined) {
      player.score = playerData.score;
    }
    
    // Aggiorna nome
    if (playerData.name && player.children && player.children[2]) {
      player.children[2].text = playerData.name;
    }
    
    // Aggiorna colore se fornito
    if (playerData.color && player.children && player.children[0]) {
      player.children[0].tint = playerData.color;
    }
  };
}

// Migliora la funzione di interpolazione per usare il predictor
function interpolateOtherPlayers(delta) {
  gameState.players.forEach((player, id) => {
    // Salta il giocatore locale
    if (id === gameState.playerId) return;
    
    // Se ha coordinate target, interpolale
    if (typeof player.targetX === 'number' && typeof player.targetY === 'number') {
      // Quanto velocemente si muove il giocatore verso il target
      // Giocatori più grandi si muovono più lentamente
      const sizeFactor = Math.max(0.5, 1 - (player.size / 500)); 
      const lerpFactor = 0.1 * sizeFactor * delta;
      
      // Interpolazione lineare
      player.x += (player.targetX - player.x) * lerpFactor;
      player.y += (player.targetY - player.y) * lerpFactor;
      
      // Aggiungi effetto di movimento (scia, ecc) se disponibile
      if (gameState.useAdvancedEffects && player.size > 30) {
        createMovementTrail(player, delta);
      }
    }
  });
}

// Crea un effetto scia per il movimento
function createMovementTrail(player, delta) {
  // Salta se il giocatore non si muove abbastanza
  const dx = player.x - (player.lastX || player.x);
  const dy = player.y - (player.lastY || player.y);
  const distance = Math.sqrt(dx*dx + dy*dy);
  
  // Memorizza l'ultima posizione
  player.lastX = player.x;
  player.lastY = player.y;
  
  // Se il movimento è minimo o non abbiamo particelle, salta
  if (distance < 3 || !gameState.particleDensity) return;
  
  // Crea particelle in base alla dimensione del giocatore e alle performance
  const particleCount = Math.floor(player.size / 20 * gameState.particleDensity);
  
  // Per ogni particella
  for (let i = 0; i < particleCount; i++) {
    // Crea una particella se non sono troppe
    if (app.stage.children.length < gameState.maxParticles) {
      const trail = new PIXI.Graphics();
      
      // Dimensione casuale
      const size = Math.random() * player.size / 8 + 1;
      
      // Colore basato sul giocatore
      const color = player.children[0].tint || 0xffffff;
      
      // Disegna il cerchio
      trail.beginFill(color, 0.3);
      trail.drawCircle(0, 0, size);
      trail.endFill();
      
      // Posizione casuale all'interno del giocatore
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * player.size / 2 * 0.8;
      trail.x = player.x - Math.cos(angle) * radius;
      trail.y = player.y - Math.sin(angle) * radius;
      
      // Aggiungi alle possibili proprietà per l'animazione
      trail.alpha = 0.7;
      
      // Aggiungi alla scena
      if (gameState.camera) {
        gameState.camera.addToWorld(trail);
      } else {
        app.stage.addChild(trail);
      }
      
      // Animazione di dissolvenza
      gsap.to(trail, {
        alpha: 0,
        x: trail.x - dx * Math.random(),
        y: trail.y - dy * Math.random(),
        duration: 0.5 + Math.random() * 0.5,
        onComplete: () => {
          if (trail.parent) {
            trail.parent.removeChild(trail);
          }
        }
      });
    }
  };
}

// Funzione per aggiornare l'HUD
function updateHUD() {
    const player = gameState.players.get(gameState.playerId);
    if (player) {
        // Aggiorna livello
        const levelElement = document.getElementById('player-level');
        if (levelElement) {
            levelElement.textContent = `Livello: ${gameState.level}`;
        }
        
        // Aggiorna dimensione
        const sizeElement = document.getElementById('player-size');
        if (sizeElement) {
            sizeElement.textContent = `Dimensione: ${Math.round(player.size)}`;
        }
        
        // Aggiorna punteggio
        const scoreElement = document.getElementById('player-score');
        if (scoreElement) {
            scoreElement.textContent = `Punteggio: ${player.score || 0}`;
        }
    }
    
    // Aggiorna classifica
    updateLeaderboard();
}

// Aggiungi effetto di sfondo
function createBackgroundEffect() {
    // Crea 50 particelle di sfondo
    for (let i = 0; i < 50; i++) {
        const particle = document.createElement('div');
        particle.classList.add('particle');
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.top = `${Math.random() * 100}%`;
        particle.style.opacity = Math.random() * 0.5 + 0.2;
        document.body.appendChild(particle);
        
        // Animazione casuale
        anime({
            targets: particle,
            translateX: anime.random(-100, 100),
            translateY: anime.random(-100, 100),
            scale: [0.1, 0.6],
            opacity: [0.4, 0.2],
            duration: anime.random(5000, 10000),
            easing: 'easeInOutSine',
            complete: () => {
                document.body.removeChild(particle);
                createParticle();
            }
        });
    };
}

// Creiamo particelle singole per sostituire quelle che scompaiono
function createParticle() {
    const particle = document.createElement('div');
    particle.classList.add('particle');
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.top = `${Math.random() * 100}%`;
    particle.style.opacity = Math.random() * 0.5 + 0.2;
    document.body.appendChild(particle);
    
    anime({
        targets: particle,
        translateX: anime.random(-100, 100),
        translateY: anime.random(-100, 100),
        scale: [0.1, 0.6],
        opacity: [0.4, 0.2],
        duration: anime.random(5000, 10000),
        easing: 'easeInOutSine',
        complete: () => {
            document.body.removeChild(particle);
            createParticle();
        }
    });
}

// Connessione WebSocket
function connectWebSocket() {
    console.log("Tentativo di connessione WebSocket a:", WS_URL);
    socket = new WebSocket(WS_URL);
    
    socket.binaryType = 'arraybuffer';
    
    // Imposta un timeout per la connessione
    const connectionTimeout = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
            console.error("Timeout nella connessione WebSocket");
            socket.close();
            
            // Mostra un messaggio all'utente
            showMessage('Impossibile connettersi al server. Riprova più tardi.', 'warning');
            
            // In modalità di sviluppo, offri di continuare in modalità offline
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                if (confirm('Vuoi continuare in modalità offline (solo sviluppo)?')) {
                    enableOfflineMode();
                }
            }
        }
    }, 5000);
    
    socket.onopen = () => {
        console.log('Connessione WebSocket stabilita');
        clearTimeout(connectionTimeout);
        
        // Assicurati che il giocatore locale sia inizializzato
        if (!gameState.players.has(gameState.playerId)) {
            const localPlayer = createPlayerSprite(gameState.playerId, true);
            if (localPlayer) {
                gameState.players.set(gameState.playerId, localPlayer);
                gameState.lastPosition = { x: localPlayer.x, y: localPlayer.y };
            } else {
                console.error("Impossibile creare il giocatore locale");
                return;
            }
        }
        
        // Invia il primo messaggio di join con posizione iniziale
        const localPlayer = gameState.players.get(gameState.playerId);
        sendToServer({
            type: 'join',
            id: gameState.playerId,
            x: Math.round(localPlayer.x),
            y: Math.round(localPlayer.y),
            name: localPlayer.children[2].text || "Player"
        });
        
        // Invia regolarmente un ping per mantenere attiva la connessione
        gameState.pingInterval = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                sendToServer({
                    type: 'ping',
                    id: gameState.playerId,
                    timestamp: Date.now()
                });
            }
        }, 30000); // Ogni 30 secondi
        
        // Resetta i tentativi di riconnessione
        reconnectAttempts = 0;
    };
    
    socket.onmessage = (event) => {
        try {
            const data = msgpack.decode(new Uint8Array(event.data));
            
            // Aggiorna il timestamp dell'ultimo messaggio ricevuto
            gameState.lastServerMessage = Date.now();
            
            switch(data.type) {
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
                    showMessage('Errore: ' + data.message, 'warning');
                    break;
                    
                case 'pong':
                    // Calcola la latenza
                    if (data.timestamp) {
                        const latency = Date.now() - data.timestamp;
                        gameState.latency = latency;
                        // Solo per debug
                        // console.log(`Latenza: ${latency}ms`);
                    }
                    break;
            }
        } catch (error) {
            console.error('Errore nel parsing del messaggio:', error);
        }
    };
    
    socket.onclose = (event) => {
        console.log('Connessione WebSocket chiusa', event.code, event.reason);
        clearInterval(gameState.pingInterval);
        
        // Se è stata chiusa in modo pulito, non riconnettere
        if (event.wasClean) {
            showMessage('Disconnesso dal server', 'info');
        } else {
            // Tenta la riconnessione con backoff esponenziale
            const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
            reconnectAttempts++;
            
            showMessage(`Connessione persa. Riconnessione tra ${Math.round(delay/1000)}s...`, 'warning');
            
            setTimeout(() => {
                if (document.visibilityState !== 'hidden') {
                    connectWebSocket();
                } else {
                    // Se la pagina è in background, rimandiamo la riconnessione
                    document.addEventListener('visibilitychange', function reconnectOnVisible() {
                        if (document.visibilityState === 'visible') {
                            document.removeEventListener('visibilitychange', reconnectOnVisible);
                            connectWebSocket();
                        }
                    });
                }
            }, delay);
        }
    };
    
    socket.onerror = (error) => {
        console.error('Errore WebSocket:', error);
        // Mostra un messaggio più descrittivo
        showMessage(`Errore di connessione al server. Verifica la tua connessione.`, 'warning');
    };
}

// Funzione per inviare dati al server in modo sicuro
function sendToServer(data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.warn('Tentativo di invio dati con socket non aperto');
        return false;
    }
    
    try {
        socket.send(msgpack.encode(data));
        return true;
    } catch (error) {
        console.error('Errore nell\'invio dei dati al server:', error);
        return false;
    };
}

// Gestisce l'aggiornamento dello stato dal server
function handleStateUpdate(data) {
    // Assicurati che il giocatore locale sia sempre presente
    const localPlayerExists = gameState.players.has(gameState.playerId);
    
    // Verifica che i dati dei giocatori siano validi
    if (!data || !data.players || !Array.isArray(data.players)) {
        console.warn('Dati di stato non validi ricevuti dal server');
        return;
    }
    
    // Aggiorna le posizioni di tutti i giocatori
    data.players.forEach(player => {
        if (!player || !player.id) return; // Salta giocatori senza ID
        
        if (player.id !== gameState.playerId) {
            if (!gameState.players.has(player.id)) {
                // Crea nuovo sprite per giocatori che non esistono ancora
                const newPlayer = createPlayerSprite(player.id);
                if (newPlayer) {
                    // Aggiorna il nome se disponibile
                    if (player.name && newPlayer.children && newPlayer.children[2]) {
                        newPlayer.children[2].text = player.name;
                    }
                    
                    gameState.players.set(player.id, newPlayer);
                }
            }
            
            // Aggiorna la posizione target per l'interpolazione
            const sprite = gameState.players.get(player.id);
            if (sprite) {
                sprite.targetX = player.x;
                sprite.targetY = player.y;
                
                // Aggiorna dimensione e punteggio se disponibili
                if (player.size) {
                    updatePlayerSize(sprite, player.size);
                }
                
                if (player.score !== undefined) {
                    sprite.score = player.score;
                }
            }
        }
    });
    
    // Rimuovi giocatori che non sono più presenti
    const activePlayers = new Set(data.players.map(p => p.id));
    [...gameState.players.keys()].forEach(id => {
        if (!activePlayers.has(id) && id !== gameState.playerId) {
            const sprite = gameState.players.get(id);
            // Verifica che app.stage sia disponibile prima di rimuovere
            if (app && app.stage && sprite && sprite.parent) {
                app.stage.removeChild(sprite);
            }
            gameState.players.delete(id);
        }
    });
    
    // Se il giocatore locale è stato rimosso, ricrealo
    if (!localPlayerExists && !activePlayers.has(gameState.playerId)) {
        console.warn('Giocatore locale non trovato, ricreazione...');
        const localPlayer = createPlayerSprite(gameState.playerId, true, INITIAL_SIZE);
        if (localPlayer) {
            gameState.players.set(gameState.playerId, localPlayer);
            gameState.lastPosition = { x: localPlayer.x, y: localPlayer.y };
            
            // Notifica al server la nostra presenza
            sendToServer({
                type: 'join',
                id: gameState.playerId,
                x: Math.round(localPlayer.x),
                y: Math.round(localPlayer.y)
            });
        }
    };
}

// Gestisce l'ingresso di un nuovo giocatore
function handlePlayerJoin(data) {
    // Ignora se siamo noi stessi
    if (data.id === gameState.playerId) return;
    
    // Verifica se il giocatore esiste già
    if (!gameState.players.has(data.id)) {
        const newPlayer = createPlayerSprite(data.id);
        if (newPlayer) {
            newPlayer.x = data.x;
            newPlayer.y = data.y;
            newPlayer.targetX = data.x;
            newPlayer.targetY = data.y;
            
            // Aggiungi nome se presente
            if (data.name) {
                newPlayer.children[2].text = data.name;
            }
            
            gameState.players.set(data.id, newPlayer);
            
            // Mostra un messaggio di benvenuto
            showMessage(`${data.name || 'Nuovo giocatore'} è entrato!`, 'info');
        }
    };
}

// Gestisce il movimento di un giocatore
function handlePlayerMove(data) {
    // Ignora se siamo noi stessi (abbiamo già aggiornato localmente)
    if (data.id === gameState.playerId) return;
    
    if (gameState.players.has(data.id)) {
        const sprite = gameState.players.get(data.id);
        // Usa x,y assoluti se disponibili, altrimenti calcola dai delta
        if (data.x !== undefined) {
            sprite.targetX = data.x;
            sprite.targetY = data.y;
        } else if (data.dx !== undefined && data.dy !== undefined) {
            sprite.targetX = sprite.targetX + data.dx;
            sprite.targetY = sprite.targetY + data.dy;
        }
    };
}

// Gestisce l'uscita di un giocatore
function handlePlayerLeave(data) {
    if (gameState.players.has(data.id)) {
        const sprite = gameState.players.get(data.id);
        // Crea un effetto di scomparsa
        if (app && app.stage && sprite && sprite.parent) {
            gsap.to(sprite, {
                alpha: 0,
                pixi: { scale: 0.5 },
                duration: 0.5,
                onComplete: () => {
                    if (app && app.stage && sprite && sprite.parent) {
                        app.stage.removeChild(sprite);
                    }
                    gameState.players.delete(data.id);
                }
            });
        } else {
            gameState.players.delete(data.id);
        }
        
        // Mostra un messaggio
        const playerName = sprite.children[2].text || 'Un giocatore';
        showMessage(`${playerName} è uscito`, 'info');
    };
}

// Abilita la modalità offline (solo per sviluppo)
function enableOfflineMode() {
    console.log("Attivazione modalità offline per sviluppo");
    
    // Crea un giocatore locale se non esiste
    if (!gameState.players.has(gameState.playerId)) {
        const localPlayer = createPlayerSprite(gameState.playerId, true);
        gameState.players.set(gameState.playerId, localPlayer);
        gameState.lastPosition = { x: localPlayer.x, y: localPlayer.y };
    }
    
    // Crea bot automatici per testing
    for (let i = 0; i < 5; i++) {
        const botId = 'bot-' + i;
        const botPlayer = createPlayerSprite(botId, false);
        botPlayer.x = Math.random() * (app.renderer.width - 100) + 50;
        botPlayer.y = Math.random() * (app.renderer.height - 100) + 50;
        botPlayer.targetX = botPlayer.x;
        botPlayer.targetY = botPlayer.y;
        botPlayer.children[2].text = 'Bot ' + (i + 1);
        gameState.players.set(botId, botPlayer);
        
        // Movimento casuale dei bot
        const botMovementInterval = setInterval(() => {
            const targetX = Math.random() * (app.renderer.width - 100) + 50;
            const targetY = Math.random() * (app.renderer.height - 100) + 50;
            
            // Interpolazione graduale verso la nuova posizione
            gsap.to(botPlayer, {
                targetX: targetX,
                targetY: targetY,
                duration: 2,
                ease: "power1.inOut"
            });
        }, 3000); // Cambia direzione ogni 3 secondi
        
        // Salva l'interval ID per fermarlo se necessario
        if (!gameState.offlineIntervals) gameState.offlineIntervals = [];
        gameState.offlineIntervals.push(botMovementInterval);
    }
    
    // Inizializza i punti energia
    initEnergyPoints();
    
    // Mostra un messaggio
    showMessage('Modalità offline attivata (sviluppo)', 'info');
}

// Aggiorna la classifica dei giocatori
function updateLeaderboard() {
    const leaderboardElement = document.getElementById('leaderboard-list');
    if (!leaderboardElement) return;
    
    // Crea un array di giocatori con punteggi
    const players = [];
    gameState.players.forEach((player, id) => {
        players.push({
            id: id.substring(0, 4), // Usa solo le prime 4 cifre dell'id
            score: player.score || 0,
            isLocal: id === gameState.playerId
        });
    });
    
    // Ordina i giocatori per punteggio
    players.sort((a, b) => b.score - a.score);
    
    // Limita a massimo 5 giocatori
    const topPlayers = players.slice(0, 5);
    
    // Svuota la classifica
    leaderboardElement.innerHTML = '';
    
    // Aggiungi ogni giocatore alla classifica
    topPlayers.forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        if (player.isLocal) {
            item.classList.add('local-player');
        }
        
        item.textContent = `${index + 1}. ${player.id} - ${player.score}`;
        leaderboardElement.appendChild(item);
    });
}

// Inizializza gli effetti di sfondo (se anime.js è disponibile)
if (typeof anime !== 'undefined') {
    createBackgroundEffect();
} else {
    console.log('anime.js non disponibile, effetti di sfondo disabilitati');
}

// Carica libreria GSAP
if (typeof gsap === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.11.5/gsap.min.js';
    script.onload = () => {
        console.log('GSAP caricato con successo');
    };
    document.head.appendChild(script);
}

// Effetto visivo di level up
function createLevelUpEffect(x, y, level) {
    // Crea particelle colorate in base al livello
    const colors = [0xffffff, 0x00ffff, 0xffff00, 0xffd700];
    const color = colors[level - 1] || 0xffffff;
    
    for (let i = 0; i < 30; i++) {
        const particle = new PIXI.Graphics();
        particle.beginFill(color);
        particle.drawCircle(0, 0, Math.random() * 4 + 2);
        particle.endFill();
        particle.x = x;
        particle.y = y;
        app.stage.addChild(particle);
        
        // Animazione esplosiva
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 150 + 50;
        const duration = Math.random() * 1 + 0.5;
        
        gsap.to(particle, {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            alpha: 0,
            duration: duration,
            ease: "power2.out",
            onComplete: () => {
                app.stage.removeChild(particle);
            }
        });
    }
    
    // Onda d'urto
    const shockwave = new PIXI.Graphics();
    shockwave.lineStyle(2, color, 1);
    shockwave.drawCircle(0, 0, 10);
    shockwave.x = x;
    shockwave.y = y;
    app.stage.addChild(shockwave);
    
    gsap.to(shockwave, {
        pixi: { scale: 10 },
        alpha: 0,
        duration: 1,
        ease: "power2.out",
        onComplete: () => {
            app.stage.removeChild(shockwave);
        }
    });
}

// Attiva un'abilità speciale
function activateAbility(ability) {
    const now = Date.now();
    const cooldown = gameState.abilities.cooldowns[ability] || 0;
    
    // Controlla se l'abilità è in cooldown
    if (now < cooldown) {
        const remainingSeconds = Math.ceil((cooldown - now) / 1000);
        showMessage(`${getAbilityName(ability)} in ricarica (${remainingSeconds}s)`, 'warning');
        return;
    }
    
    // Esegue l'abilità in base al tipo
    switch(ability) {
        case 'speed':
            activateSpeedBoost();
            break;
        case 'shield':
            activateShield();
            break;
        case 'attack':
            fireAttack();
            break;
    };
}

// Abilità: Boost di velocità
function activateSpeedBoost() {
    const player = gameState.players.get(gameState.playerId);
    if (!player) return;
    
    // Durata e cooldown
    const duration = 3000; // 3 secondi
    const cooldownTime = 10000; // 10 secondi
    
    // Imposta il cooldown
    gameState.abilities.cooldowns.speed = Date.now() + cooldownTime;
    gameState.abilities.active.speed = true;
    
    // Mostra messaggio
    showMessage('Scatto Turbo attivato!', 'ability');
    
    // Crea effetto visivo
    const trail = createSpeedEffect(player);
    
    // Termina dopo la durata
    setTimeout(() => {
        gameState.abilities.active.speed = false;
        showMessage('Scatto Turbo terminato', 'info');
        
        // Rimuovi effetto visivo
        if (trail && trail.parent) {
            app.stage.removeChild(trail);
        }
    }, duration);
}

// Crea effetto visivo per il boost di velocità
function createSpeedEffect(player) {
    const trail = new PIXI.Graphics();
    app.stage.addChildAt(trail, 0); // Sotto il player
    
    // Aggiungi al ticker per aggiornare la scia
    const trailPoints = [];
    const trailLength = 20;
    
    const trailTicker = app.ticker.add(() => {
        // Aggiorna punti della scia
        trailPoints.unshift({ x: player.x, y: player.y });
        
        // Limita lunghezza
        if (trailPoints.length > trailLength) {
            trailPoints.pop();
        }
        
        // Disegna la scia
        trail.clear();
        
        for (let i = 0; i < trailPoints.length - 1; i++) {
            const alpha = 1 - (i / trailLength);
            const width = (trailLength - i) * 0.5;
            
            trail.lineStyle(width, 0x00ffff, alpha * 0.7);
            trail.moveTo(trailPoints[i].x, trailPoints[i].y);
            trail.lineTo(trailPoints[i+1].x, trailPoints[i+1].y);
        }
        
        // Rimuovi ticker se l'abilità non è più attiva
        if (!gameState.abilities.active.speed) {
            app.ticker.remove(trailTicker);
        }
    });
    
    return trail;
}

// Abilità: Scudo protettivo
function activateShield() {
    const player = gameState.players.get(gameState.playerId);
    if (!player) return;
    
    // Durata e cooldown
    const duration = 5000; // 5 secondi
    const cooldownTime = 15000; // 15 secondi
    
    // Imposta il cooldown
    gameState.abilities.cooldowns.shield = Date.now() + cooldownTime;
    gameState.abilities.active.shield = true;
    
    // Mostra messaggio
    showMessage('Scudo Energetico attivato!', 'ability');
    
    // Crea effetto visivo
    const shield = createShieldEffect(player);
    
    // Termina dopo la durata
    setTimeout(() => {
        gameState.abilities.active.shield = false;
        showMessage('Scudo Energetico terminato', 'info');
        
        // Rimuovi effetto visivo
        if (shield && shield.parent) {
            gsap.to(shield, {
                alpha: 0,
                duration: 0.5,
                onComplete: () => {
                    if (shield.parent) {
                        shield.parent.removeChild(shield);
                    }
                }
            });
        }
    }, duration);
}

// Crea effetto visivo per lo scudo
function createShieldEffect(player) {
    const shield = new PIXI.Graphics();
    shield.beginFill(0x3366ff, 0.2);
    shield.lineStyle(3, 0x3366ff, 0.8);
    shield.drawCircle(0, 0, player.size * 1.5);
    shield.endFill();
    
    player.addChild(shield);
    
    // Animazione pulsante
    gsap.to(shield, {
        alpha: 0.5,
        duration: 0.8,
        repeat: -1,
        yoyo: true
    });
    
    return shield;
}

// Abilità: Attacco a distanza
function fireAttack() {
    const player = gameState.players.get(gameState.playerId);
    if (!player) return;
    
    // Cooldown dell'attacco
    const cooldownTime = 3000; // 3 secondi
    
    // Imposta il cooldown
    gameState.abilities.cooldowns.attack = Date.now() + cooldownTime;
    
    // Mostra messaggio
    showMessage('Raggio Letale!', 'ability');
    
    // Ottieni la direzione in base ai tasti premuti
    let direction = { x: 0, y: 0 };
    
    if (gameState.keys.w) direction.y = -1;
    if (gameState.keys.a) direction.x = -1;
    if (gameState.keys.s) direction.y = 1;
    if (gameState.keys.d) direction.x = 1;
    
    // Normalizza la direzione
    const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    if (length > 0) {
        direction.x /= length;
        direction.y /= length;
    } else {
        // Se non ci sono tasti direzionali premuti, spara verso destra
        direction.x = 1;
    }
    
    // Crea il proiettile
    createProjectile(player, direction);
    
    // Invia al server
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(msgpack.encode({
            type: 'attack',
            id: gameState.playerId,
            x: player.x,
            y: player.y,
            dirX: direction.x,
            dirY: direction.y
        }));
    };
}

// Crea un proiettile
function createProjectile(player, direction) {
    // Crea il proiettile
    const projectile = new PIXI.Graphics();
    projectile.beginFill(0xff3366);
    projectile.drawCircle(0, 0, 8);
    projectile.endFill();
    
    // Aggiungi una scia luminosa
    const trail = new PIXI.Graphics();
    trail.beginFill(0xff3366, 0.3);
    trail.drawCircle(0, 0, 12);
    trail.endFill();
    
    // Crea un container
    const container = new PIXI.Container();
    container.addChild(trail);
    container.addChild(projectile);
    
    // Posiziona il proiettile davanti al giocatore
    container.x = player.x + direction.x * (player.size + 10);
    container.y = player.y + direction.y * (player.size + 10);
    container.vx = direction.x * 10; // Velocità del proiettile
    container.vy = direction.y * 10;
    container.damage = 20; // Danno del proiettile
    container.ownerId = gameState.playerId; // Chi ha sparato
    
    // Aggiungi alla scena
    app.stage.addChild(container);
    
    // Registra nel gameState se necessario
    if (!gameState.projectiles) {
        gameState.projectiles = [];
    }
    gameState.projectiles.push(container);
    
    // Effetto di lancio
    createProjectileLaunchEffect(player, direction);
    
    // Anima il proiettile
    animateProjectile(container);
}

// Effetto visivo per il lancio del proiettile
function createProjectileLaunchEffect(player, direction) {
    const startX = player.x;
    const startY = player.y;
    
    // Flash sul giocatore
    const flash = new PIXI.Graphics();
    flash.beginFill(0xff3366, 0.5);
    flash.drawCircle(0, 0, player.size * 1.2);
    flash.endFill();
    flash.x = startX;
    flash.y = startY;
    app.stage.addChild(flash);
    
    gsap.to(flash, {
        alpha: 0,
        pixi: { scale: 1.5 },
        duration: 0.3,
        onComplete: () => {
            app.stage.removeChild(flash);
        }
    });
}

// Anima un proiettile
function animateProjectile(projectile) {
    // Effetto pulse sulla scia
    gsap.to(projectile.children[0], {
        alpha: 0.1,
        duration: 0.3,
        repeat: -1,
        yoyo: true
    });
    
    // Ticker per il movimento
    const ticker = app.ticker.add(() => {
        // Muovi il proiettile
        projectile.x += projectile.vx;
        projectile.y += projectile.vy;
        
        // Controlla collisioni con altri giocatori
        checkProjectileCollisions(projectile);
        
        // Rimuovi se fuori schermo
        if (projectile.x < -50 || projectile.x > app.screen.width + 50 ||
            projectile.y < -50 || projectile.y > app.screen.height + 50) {
            app.stage.removeChild(projectile);
            app.ticker.remove(ticker);
            
            // Rimuovi dalla lista
            if (gameState.projectiles) {
                const index = gameState.projectiles.indexOf(projectile);
                if (index > -1) {
                    gameState.projectiles.splice(index, 1);
                }
            }
        }
    });
}

// Controlla se un proiettile colpisce altri giocatori
function checkProjectileCollisions(projectile) {
    // Non colpire il proprio giocatore
    gameState.players.forEach((player, id) => {
        if (id !== projectile.ownerId) {
            const dx = projectile.x - player.x;
            const dy = projectile.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Se il proiettile colpisce un giocatore
            if (distance < player.size + 8) {
                // Crea effetto visivo di impatto
                createImpactEffect(projectile.x, projectile.y);
                
                // Rimuovi il proiettile
                app.stage.removeChild(projectile);
                const index = gameState.projectiles.indexOf(projectile);
                if (index > -1) {
                    gameState.projectiles.splice(index, 1);
                }
                
                // Invia hit al server
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(msgpack.encode({
                        type: 'hit',
                        id: projectile.ownerId,
                        targetId: id,
                        damage: projectile.damage
                    }));
                }
            }
        }
    });
}

// Crea effetto di impatto
function createImpactEffect(x, y) {
    // Flash circolare
    const impact = new PIXI.Graphics();
    impact.beginFill(0xff3366, 0.7);
    impact.drawCircle(0, 0, 15);
    impact.endFill();
    impact.x = x;
    impact.y = y;
    app.stage.addChild(impact);
    
    // Particelle di impatto
    for (let i = 0; i < 10; i++) {
        const particle = new PIXI.Graphics();
        particle.beginFill(0xff3366);
        particle.drawCircle(0, 0, Math.random() * 3 + 1);
        particle.endFill();
        particle.x = x;
        particle.y = y;
        app.stage.addChild(particle);
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 30 + 10;
        const duration = Math.random() * 0.5 + 0.2;
        
        gsap.to(particle, {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            alpha: 0,
            duration: duration,
            onComplete: () => {
                app.stage.removeChild(particle);
            }
        });
    }
    
    // Anima e rimuovi il flash
    gsap.to(impact, {
        alpha: 0,
        pixi: { scale: 3 },
        duration: 0.4,
        onComplete: () => {
            app.stage.removeChild(impact);
        }
    });
}

// Mostra un messaggio a schermo
function showMessage(text, type = 'info') {
    const message = document.createElement('div');
    message.className = `game-message ${type}`;
    message.textContent = text;
    
    document.body.appendChild(message);
    
    // Animazione con GSAP se disponibile
    if (typeof gsap !== 'undefined') {
        gsap.fromTo(message, 
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.3 }
        );
        
        // Rimuovi dopo un po'
        setTimeout(() => {
            gsap.to(message, {
                y: -20, opacity: 0, duration: 0.3,
                onComplete: () => message.remove()
            });
        }, 2000);
    } else {
        // Fallback senza GSAP
        message.style.opacity = '0';
        message.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            message.style.opacity = '1';
            message.style.transform = 'translateY(0)';
            message.style.transition = 'all 0.3s ease';
        }, 10);
        
        // Rimuovi dopo un po'
        setTimeout(() => {
            message.style.opacity = '0';
            message.style.transform = 'translateY(-20px)';
            
            setTimeout(() => message.remove(), 300);
        }, 2000);
    };
}

// Funzione per inizializzare i punti energia
function initEnergyPoints() {
    // Verifica che app sia inizializzato
    if (!app || !app.stage) {
        console.error("PixiJS non è stato inizializzato correttamente");
        return;
    }
    
    // Crea punti energia iniziali
    for (let i = 0; i < MAX_ENERGY_POINTS; i++) {
        spawnEnergyPoint();
    }
    
    // Imposta un timer per generare nuovi punti energia
    setInterval(() => {
        if (gameState.energyPoints.size < MAX_ENERGY_POINTS) {
            spawnEnergyPoint();
        }
    }, 2000);
}

// Crea un nuovo punto energia
function spawnEnergyPoint() {
    // Verifica che app sia inizializzato
    if (!app || !app.stage || !app.screen) {
        console.error("PixiJS non è stato inizializzato correttamente");
        return null;
    }
    
    const id = crypto.randomUUID();
    const x = Math.random() * (app.screen.width - 100) + 50;
    const y = Math.random() * (app.screen.height - 100) + 50;
    
    // Crea lo sprite del punto energia
    const energyPoint = new PIXI.Graphics();
    energyPoint.beginFill(0x00ffff);
    energyPoint.drawCircle(0, 0, 8);
    energyPoint.endFill();
    
    // Aggiungi un effetto glow
    const glow = new PIXI.Graphics();
    glow.beginFill(0x00ffff, 0.3);
    glow.drawCircle(0, 0, 12);
    glow.endFill();
    
    // Crea un container
    const container = new PIXI.Container();
    container.addChild(glow);
    container.addChild(energyPoint);
    container.x = x;
    container.y = y;
    container.value = ENERGY_VALUE;
    
    // Aggiungi al gioco
    app.stage.addChild(container);
    gameState.energyPoints.set(id, container);
    
    // Aggiungi animazione pulse
    gsap.to(container.scale, {
        x: 1.2,
        y: 1.2,
        duration: 0.8,
        repeat: -1,
        yoyo: true
    });
    
    return container;
}

// Restituisce il nome dell'abilità
function getAbilityName(ability) {
    switch(ability) {
        case 'speed': return 'Scatto Turbo';
        case 'shield': return 'Scudo Energetico';
        case 'attack': return 'Raggio Letale';
        default: return ability;
    };
}

// Restituisce il tasto per attivare l'abilità
function getAbilityKey(ability) {
    switch(ability) {
        case 'speed': return 'q';
        case 'shield': return 'e';
        case 'attack': return 'spazio';
        default: return '?';
    };
}

// Restituisce il livello minimo per l'abilità
function getAbilityMinLevel(ability) {
    const threshold = LEVEL_THRESHOLDS.find(t => t.ability === ability);
    return threshold ? threshold.level : 999;
}

// Aggiorna l'aspetto del giocatore in base al livello
function updatePlayerAppearance(player, oldLevel, newLevel) {
    // Rimuove vecchi elementi visivi
    while (player.children.length > 3) { // Mantiene corpo, glow e nome
        player.removeChildAt(3);
    }
    
    // Aggiunge elementi visivi in base al livello
    if (newLevel >= 2) {
        // Livello 2: Aura speciale
        const aura = new PIXI.Graphics();
        aura.beginFill(0x00ffff, 0.2);
        aura.drawCircle(0, 0, player.size + 15);
        aura.endFill();
        player.addChildAt(aura, 0); // Sotto a tutto
        
        // Animazione pulsante
        gsap.to(aura, {
            alpha: 0.4,
            duration: 1,
            yoyo: true,
            repeat: -1
        });
    }
    
    if (newLevel >= 3) {
        // Livello 3: Particelle orbitanti
        for (let i = 0; i < 3; i++) {
            const orbit = Math.random() * 20 + player.size + 5;
            const particle = new PIXI.Graphics();
            particle.beginFill(0xffff00);
            particle.drawCircle(0, 0, 3);
            particle.endFill();
            particle.x = orbit;
            particle.y = 0;
            player.addChild(particle);
            
            // Orbita attorno al giocatore
            gsap.to(particle, {
                duration: Math.random() * 3 + 2,
                repeat: -1,
                ease: "none",
                onUpdate: function() {
                    const angle = this.progress() * Math.PI * 2 + (i * Math.PI * 2 / 3);
                    particle.x = Math.cos(angle) * orbit;
                    particle.y = Math.sin(angle) * orbit;
                }
            });
        }
    }
    
    if (newLevel >= 4) {
        // Livello 4: Corona/effetto speciale
        const crown = new PIXI.Graphics();
        crown.beginFill(0xffd700);
        
        // Disegna una corona stilizzata
        crown.moveTo(-15, -player.size - 10);
        crown.lineTo(-10, -player.size - 20);
        crown.lineTo(-5, -player.size - 10);
        crown.lineTo(0, -player.size - 20);
        crown.lineTo(5, -player.size - 10);
        crown.lineTo(10, -player.size - 20);
        crown.lineTo(15, -player.size - 10);
        crown.lineTo(15, -player.size - 5);
        crown.lineTo(-15, -player.size - 5);
        crown.closePath();
        
        crown.endFill();
        player.addChild(crown);
    }
    
    // Animazione di level up
    gsap.to(player.scale, {
        x: player.scale.x * 1.2,
        y: player.scale.y * 1.2,
        duration: 0.3,
        yoyo: true,
        repeat: 1
    });
    
    // Effetto particellare di level up
    createLevelUpEffect(player.x, player.y, newLevel);
}

// Aggiorna la dimensione di un giocatore
function updatePlayerSize(player, newSize) {
    player.size = newSize;
    
    // Aggiorna dimensione visiva
    // Nota: in una implementazione reale, dovremmo ricreare la grafica 
    // invece di usare scale, per semplicità usiamo scale qui
    const scaleRatio = newSize / INITIAL_SIZE;
    player.scale.set(scaleRatio);
    
    // Aggiorna la posizione del nome
    const nameText = player.children[2]; // Assume che il nome sia il terzo figlio
    if (nameText) {
        nameText.y = -newSize - 15;
    };
}

// Crea effetto visivo per la raccolta di energia
function createCollectEffect(x, y) {
    // Crea particelle
    for (let i = 0; i < 8; i++) {
        const particle = new PIXI.Graphics();
        particle.beginFill(0xffff00);
        particle.drawCircle(0, 0, 3);
        particle.endFill();
        particle.x = x;
        particle.y = y;
        app.stage.addChild(particle);
        
        // Anima particelle in direzioni casuali
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 40 + 20;
        const duration = Math.random() * 500 + 500;
        
        gsap.to(particle, {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            alpha: 0,
            duration: duration / 1000,
            onComplete: () => {
                app.stage.removeChild(particle);
            }
        });
    };
}

// Controlla se un giocatore può mangiare un altro
function checkPlayerCollisions() {
    const player = gameState.players.get(gameState.playerId);
    if (!player) return;
    
    gameState.players.forEach((otherPlayer, id) => {
        // Salta il nostro giocatore
        if (id === gameState.playerId) return;
        
        // Calcola distanza
        const dx = player.x - otherPlayer.x;
        const dy = player.y - otherPlayer.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Un giocatore può mangiare un altro se è almeno 30% più grande
        if (distance < player.size && player.size > otherPlayer.size * 1.3) {
            eatPlayer(player, otherPlayer, id);
        }
    });
}

// Funzione per "mangiare" un altro giocatore
function eatPlayer(player, otherPlayer, otherId) {
    // Incrementa punteggio in base alle dimensioni dell'avversario
    const scoreGain = Math.round(otherPlayer.size * 0.5);
    player.score += scoreGain;
    
    // Incrementa dimensione
    const newSize = Math.min(player.size + Math.round(otherPlayer.size * 0.2), MAX_SIZE);
    updatePlayerSize(player, newSize);
    
    // Crea effetto visivo
    createEatEffect(otherPlayer.x, otherPlayer.y);
    
    // Invia messaggio al server
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(msgpack.encode({
            type: 'eat',
            id: gameState.playerId,
            target: otherId,
            score: player.score,
            size: player.size
        }));
    };
}

// Crea effetto visivo per mangiare un giocatore
function createEatEffect(x, y) {
    // Simile all'effetto di raccolta energia ma più grande
    for (let i = 0; i < 15; i++) {
        const particle = new PIXI.Graphics();
        particle.beginFill(0xff6600);
        particle.drawCircle(0, 0, 5);
        particle.endFill();
        particle.x = x;
        particle.y = y;
        app.stage.addChild(particle);
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 60 + 30;
        const duration = Math.random() * 700 + 300;
        
        gsap.to(particle, {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            alpha: 0,
            duration: duration / 1000,
            onComplete: () => {
                app.stage.removeChild(particle);
            }
        });
    };
}

// Funzione per controllare se un giocatore ha raccolto energia
function checkEnergyCollection() {
    const player = gameState.players.get(gameState.playerId);
    if (!player) return;
    
    gameState.energyPoints.forEach((energyPoint, id) => {
        // Calcola distanza
        const dx = player.x - energyPoint.x;
        const dy = player.y - energyPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Se il giocatore tocca l'energia, la raccoglie
        if (distance < player.size) {
            collectEnergy(player, energyPoint, id);
        }
    });
}

// Raccogli energia e aggiorna il punteggio
function collectEnergy(player, energyPoint, energyId) {
    // Aggiorna punteggio
    player.score += energyPoint.value;
    gameState.scores.set(gameState.playerId, player.score);
    
    // Aumenta dimensione del giocatore (con limite massimo)
    const newSize = Math.min(player.size + 1, MAX_SIZE);
    updatePlayerSize(player, newSize);
    
    // Controlla se il giocatore è salito di livello
    checkLevelUp(player);
    
    // Rimuovi il punto energia
    app.stage.removeChild(energyPoint);
    gameState.energyPoints.delete(energyId);
    
    // Crea un effetto visivo per la raccolta
    createCollectEffect(energyPoint.x, energyPoint.y);
    
    // Invia l'aggiornamento al server
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(msgpack.encode({
            type: 'score',
            id: gameState.playerId,
            score: player.score,
            size: player.size,
            level: gameState.level
        }));
    };
}

// Mostra un messaggio di level up
function showLevelUpMessage(rank, ability) {
    const message = document.createElement('div');
    message.className = 'level-up-message';
    message.innerHTML = `
        <div class="level-title">Livello Aumentato!</div>
        <div class="level-rank">Sei diventato: ${rank}</div>
        ${ability ? `<div class="level-ability">Nuova abilità: ${getAbilityName(ability)}</div>` : ''}
        ${ability ? `<div class="level-key">Premi [${getAbilityKey(ability)}] per usarla</div>` : ''}
    `;
    
    document.body.appendChild(message);
    
    // Animazione di comparsa e scomparsa
    gsap.fromTo(message, 
        { y: -50, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, ease: "back.out" }
    );
    
    setTimeout(() => {
        gsap.to(message, {
            y: 50, opacity: 0, duration: 0.5, ease: "back.in",
            onComplete: () => message.remove()
        });
    }, 3000);
}

// Sblocca una nuova abilità
function unlockAbility(ability) {
    // Aggiunge l'event listener per il tasto corrispondente
    if (!window[`${ability}KeyHandler`]) {
        window[`${ability}KeyHandler`] = true;
        
        window.addEventListener('keydown', (e) => {
            const key = getAbilityKey(ability);
            if (e.key.toLowerCase() === key && gameState.level >= getAbilityMinLevel(ability)) {
                activateAbility(ability);
            }
        });
    };
}

// Controlla se il giocatore è salito di livello
function checkLevelUp(player) {
    // Trova il livello corrispondente alla dimensione attuale
    let newLevel = 1;
    for (const threshold of LEVEL_THRESHOLDS) {
        if (player.size >= threshold.size) {
            newLevel = threshold.level;
        } else {
            break;
        }
    }
    
    // Se è salito di livello
    if (newLevel > gameState.level) {
        const oldLevel = gameState.level;
        gameState.level = newLevel;
        
        // Trova informazioni sul nuovo livello
        const levelInfo = LEVEL_THRESHOLDS.find(t => t.level === newLevel);
        
        // Mostra messaggio di level up
        showLevelUpMessage(levelInfo.name, levelInfo.ability);
        
        // Sblocca nuove abilità
        if (levelInfo.ability) {
            unlockAbility(levelInfo.ability);
        }
        
        // Aggiorna visivamente il giocatore
        updatePlayerAppearance(player, oldLevel, newLevel);
    };
}

// Funzione per aggiornare tutti gli oggetti di gioco dopo ripristino del contesto
function refreshGameObjects() {
    // Ricrea tutti gli oggetti necessari dopo un ripristino del contesto WebGL
    if (!app || !app.stage) return;
    
    // Pulisci gli stage vecchi
    app.stage.removeChildren();
    
    // Ricrea tutti i giocatori
    gameState.players.forEach((oldPlayer, id) => {
        const isLocalPlayer = (id === gameState.playerId);
        const newPlayer = createPlayerSprite(id, isLocalPlayer, oldPlayer.size);
        
        if (newPlayer) {
            // Trasferisci proprietà importanti
            newPlayer.x = oldPlayer.x;
            newPlayer.y = oldPlayer.y;
            newPlayer.targetX = oldPlayer.targetX;
            newPlayer.targetY = oldPlayer.targetY;
            newPlayer.score = oldPlayer.score;
            
            // Aggiorna il riferimento nel gameState
            gameState.players.set(id, newPlayer);
        }
    });
    
    // Ricrea i punti energia
    const oldEnergyPoints = Array.from(gameState.energyPoints.entries());
    gameState.energyPoints.clear();
    
    oldEnergyPoints.forEach(([id, oldPoint]) => {
        const newPoint = spawnEnergyPointAt(oldPoint.x, oldPoint.y);
        if (newPoint) {
            gameState.energyPoints.set(id, newPoint);
        }
    });
    
    // Ricrea i proiettili attivi
    if (gameState.projectiles && gameState.projectiles.length > 0) {
        const oldProjectiles = [...gameState.projectiles];
        gameState.projectiles = [];
        
        oldProjectiles.forEach(oldProj => {
            if (oldProj.ownerId) {
                const owner = gameState.players.get(oldProj.ownerId);
                if (owner) {
                    const direction = {
                        x: oldProj.vx / 10, // Normalizza la velocità
                        y: oldProj.vy / 10
                    };
                    createProjectile(owner, direction);
                }
            }
        });
    }
    
    // Aggiorna tutti gli effetti visivi di abilità attive
    if (gameState.abilities.active.speed && gameState.playerId) {
        const player = gameState.players.get(gameState.playerId);
        if (player) {
            createSpeedEffect(player);
        }
    }
    
    if (gameState.abilities.active.shield && gameState.playerId) {
        const player = gameState.players.get(gameState.playerId);
        if (player) {
            createShieldEffect(player);
        }
    };
}

// Funzione per creare un punto energia in una posizione specifica (per il ripristino)
function spawnEnergyPointAt(x, y) {
    // Verifica che app sia inizializzato
    if (!app || !app.stage) {
        console.error("PixiJS non è stato inizializzato correttamente");
        return null;
    }
    
    const id = crypto.randomUUID();
    
    // Crea lo sprite del punto energia
    const energyPoint = new PIXI.Graphics();
    energyPoint.beginFill(0x00ffff);
    energyPoint.drawCircle(0, 0, 8);
    energyPoint.endFill();
    
    // Aggiungi un effetto glow
    const glow = new PIXI.Graphics();
    glow.beginFill(0x00ffff, 0.3);
    glow.drawCircle(0, 0, 12);
    glow.endFill();
    
    // Crea un container
    const container = new PIXI.Container();
    container.addChild(glow);
    container.addChild(energyPoint);
    container.x = x;
    container.y = y;
    container.value = ENERGY_VALUE;
    
    // Aggiungi al gioco
    app.stage.addChild(container);
    
    // Aggiungi animazione pulse
    if (typeof gsap !== 'undefined') {
        gsap.to(container.scale, {
            x: 1.2,
            y: 1.2,
            duration: 0.8,
            repeat: -1,
            yoyo: true
        });
    }
    
    return container;
}

// Rileva e correggi automaticamente i problemi di rendering
function setupAutomaticRecovery() {
    // Controllo periodico dello stato del rendering
    const recoveryInterval = setInterval(() => {
        // Se il contesto è perso da troppo tempo, tenta il ripristino forzato
        if (gameState.contextLost) {
            const timeSinceLost = Date.now() - gameState.contextLostTime;
            
            if (timeSinceLost > 5000) { // 5 secondi
                console.warn("Tentativo di recupero forzato del contesto...");
                
                // Tenta di passare al renderer Canvas se non ci siamo già
                if (app && app.renderer.type === PIXI.RENDERER_TYPE.WEBGL) {
                    reinitWithCanvasRenderer();
                } else {
                    // Se siamo già in Canvas o altro, ricrea tutto
                    initGame();
                }
            }
        }
        
        // Verifica anche se l'app è in esecuzione ma ci sono problemi di rendering
        if (app && app.ticker.started) {
            // Se il giocatore locale non è visibile ma dovrebbe esserlo
            const localPlayer = gameState.players.get(gameState.playerId);
            if (localPlayer && !localPlayer.visible && !gameState.contextLost) {
                console.warn("Rilevato problema di visibilità, tentativo di recupero...");
                refreshGameObjects();
            }
        }
    }, 10000); // Controlla ogni 10 secondi
    
    // Memorizza il riferimento per fermare il controllo se necessario
    gameState.recoveryInterval = recoveryInterval;
}

// Modifica la funzione initGame per usare il nuovo sistema di recupero
function initGame() {
    console.log("Inizializzazione del gioco");
    
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
    
    // Inizializza il contatore FPS
    initFpsCounter();
    
    // Inizializza sfondo
    createBackground();
    
    // Inizializza punti energia
    initEnergyPoints();
    
    // Nasconde la schermata di login
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    // Inizializza controlli
    setupControls();
    
    // Connetti al server
    connectWebSocket();
    
    // Attiva il sistema di recupero automatico
    setupAutomaticRecovery();
    
    // Imposta il loop di gioco principale
    app.ticker.add(delta => {
        if (gameState.contextLost) return; // Salta il rendering se il contesto è perso
        
        updateMovement(delta);
        interpolatePlayers(delta);
        updateEnergyPoints(delta);
        
        // Aggiorna contatore FPS
        updateFpsCounter(app.ticker.FPS);
    });
    
    console.log("Gioco inizializzato con successo");
}

// Aggiorna il gameState per tracciare lo stato del contesto WebGL
gameState.contextLost = false;
gameState.contextLostTime = 0;
gameState.recoveryInterval = null;

// Modifica la funzione createBackground per supportare la mappa più grande
function createBackground() {
  // Rimuovi lo sfondo esistente
  if (gameState.background) {
    if (gameState.background.parent) {
      gameState.background.parent.removeChild(gameState.background);
    }
    gameState.background = null;
  }
  
  // Crea un nuovo container per lo sfondo
  const background = new PIXI.Container();
  
  // Crea lo sfondo principale
  const mainBg = new PIXI.Graphics();
  mainBg.beginFill(0x0a0a0a);
  mainBg.drawRect(0, 0, WORLD_CONFIG.width, WORLD_CONFIG.height);
  mainBg.endFill();
  background.addChild(mainBg);
  
  // Aggiungi una griglia per migliorare la percezione di profondità
  const grid = new PIXI.Graphics();
  grid.lineStyle(1, 0x222222, 0.3);
  
  // Linee orizzontali
  for (let y = 0; y <= WORLD_CONFIG.height; y += 100) {
    grid.moveTo(0, y);
    grid.lineTo(WORLD_CONFIG.width, y);
  }
  
  // Linee verticali
  for (let x = 0; x <= WORLD_CONFIG.width; x += 100) {
    grid.moveTo(x, 0);
    grid.lineTo(x, WORLD_CONFIG.height);
  }
  
  background.addChild(grid);
  
  // Aggiungi bordo al mondo
  const border = new PIXI.Graphics();
  border.lineStyle(5, 0x00ff88, 0.5);
  border.drawRect(0, 0, WORLD_CONFIG.width, WORLD_CONFIG.height);
  background.addChild(border);
  
  // Aggiungi particelle decorative casuali sullo sfondo
  const particles = new PIXI.Container();
  background.addChild(particles);
  
  for (let i = 0; i < 200; i++) {
    const particle = new PIXI.Graphics();
    const size = Math.random() * 3 + 1;
    const alpha = Math.random() * 0.3 + 0.1;
    
    particle.beginFill(0x00ffff, alpha);
    particle.drawCircle(0, 0, size);
    particle.endFill();
    
    particle.x = Math.random() * WORLD_CONFIG.width;
    particle.y = Math.random() * WORLD_CONFIG.height;
    
    particles.addChild(particle);
    
    // Animazione particelle
    gsap.to(particle, {
      alpha: 0.1,
      duration: 2 + Math.random() * 4,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut"
    });
  }
  
  // Memorizza lo sfondo nel gameState
  gameState.background = background;
  
  // Aggiungi lo sfondo al mondo della camera
  gameState.camera.addToWorld(background);
  
  return background;
}

// Modifica initEnergyPoints per distribuire i punti energia sulla mappa grande
function initEnergyPoints() {
  // Rimuovi punti energia esistenti
  if (gameState.energyPoints) {
    gameState.energyPoints.forEach(point => {
      if (point.parent) point.parent.removeChild(point);
    });
  }
  
  gameState.energyPoints = new Map();
  
  // Numero di punti proporzionale alla dimensione della mappa
  const pointsCount = Math.floor(WORLD_CONFIG.width * WORLD_CONFIG.height / 20000);
  
  for (let i = 0; i < pointsCount; i++) {
    const padding = 100;
    const x = padding + Math.random() * (WORLD_CONFIG.width - padding * 2);
    const y = padding + Math.random() * (WORLD_CONFIG.height - padding * 2);
    
    const energyPoint = createEnergyPoint(x, y);
    gameState.energyPoints.set(i, energyPoint);
  }
  
  console.log(`Creati ${pointsCount} punti energia sulla mappa`);
}

// Funzione per creare un singolo punto energia
function createEnergyPoint(x, y) {
  const energyPoint = new PIXI.Graphics();
  energyPoint.beginFill(0x00ff88, 0.7);
  energyPoint.drawCircle(0, 0, 10);
  energyPoint.endFill();
  
  // Aggiungi effetto glow
  if (PIXI.filters && PIXI.filters.GlowFilter) {
    energyPoint.filters = [new PIXI.filters.GlowFilter(15, 2, 1, 0x00ff88, 0.5)];
  }
  
  energyPoint.x = x;
  energyPoint.y = y;
  
  // Animazione pulsante
  gsap.to(energyPoint.scale, {
    x: 1.2,
    y: 1.2,
    duration: 0.8,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut"
  });
  
  // Aggiungi al mondo
  gameState.camera.addToWorld(energyPoint);
  
  return energyPoint;
}

// Funzione per creare lo sprite di un giocatore
function createPlayerSprite(id, isLocal, size = INITIAL_SIZE) {
  // Crea un container per il giocatore
  const container = new PIXI.Container();
  container.id = id;
  container.isLocal = isLocal;
  container.size = size;
  
  // Posizione iniziale casuale
  container.x = Math.random() * (WORLD_CONFIG.width - 200) + 100;
  container.y = Math.random() * (WORLD_CONFIG.height - 200) + 100;
  
  // Crea lo sprite del giocatore
  const sprite = new PIXI.Graphics();
  sprite.beginFill(isLocal ? 0x00ff88 : 0x3498db);
  sprite.drawCircle(0, 0, size);
  sprite.endFill();
  container.addChild(sprite);
  container.sprite = sprite;
  
  // Aggiungi un bordo per il giocatore locale
  if (isLocal) {
    const border = new PIXI.Graphics();
    border.lineStyle(2, 0xffffff, 0.8);
    border.drawCircle(0, 0, size + 2);
    container.addChild(border);
  }
  
  // Aggiungi il nome del giocatore
  const nameText = new PIXI.Text(isLocal ? 'Tu' : `Giocatore ${id ? id.substring(0, 4) : 'Sconosciuto'}`, {
    fontFamily: 'Arial',
    fontSize: 14,
    fill: 0xffffff,
    align: 'center',
    stroke: 0x000000,
    strokeThickness: 4
  });
  nameText.anchor.set(0.5);
  nameText.y = -size - 15;
  container.addChild(nameText);
  
  // Aggiungi al mondo di gioco usando la camera
  if (gameState.camera) {
    gameState.camera.addToWorld(container);
  } else {
    console.error("Camera non inizializzata, impossibile aggiungere il giocatore");
    if (app && app.stage) {
      app.stage.addChild(container);
    }
  }
  
  return container;
}

// Modifica initGame per inizializzare la camera
function initGame() {
  console.log("Inizializzazione del gioco");
  
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
  
  // Inizializza controlli
  setupControls();
  
  // Connetti al server
  connectWebSocket();
  
  // Attiva il sistema di recupero automatico
  setupAutomaticRecovery();
  
  // Imposta il loop di gioco principale
  app.ticker.add(delta => {
    if (gameState.contextLost) return; // Salta il rendering se il contesto è perso
    
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
      // Salta punti già raccolti
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
    // Salta punti già raccolti
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
  
  // Se il livello è cambiato
  if (newLevel > gameState.level) {
    gameState.level = newLevel;
    
    // Trova il nome del livello
    const levelInfo = LEVEL_THRESHOLDS.find(t => t.level === newLevel);
    
    // Mostra messaggio di avanzamento
    showMessage(`Hai raggiunto il livello ${newLevel}: ${levelInfo.name}!`, 'success');
    
    // Se il livello ha un'abilità, mostra un messaggio
    if (levelInfo.ability) {
      showMessage(`Hai sbloccato l'abilità: ${getAbilityName(levelInfo.ability)}!`, 'info');
    }
  };
}

// Funzione per ottenere il nome dell'abilità
function getAbilityName(abilityKey) {
  const abilityNames = {
    'speed': 'Velocità',
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
    
    // Velocità e direzione casuale
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
// Initialize game when document is ready
document.addEventListener('DOMContentLoaded', () => {
    initGame();
});

// Funzione per aggiornare la camera
function updateCamera(delta) {
  // Se non c'è camera o giocatore, non fare nulla
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
    
    // Se è il giocatore locale, aggiungi indicatore di direzione
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

/* Rimuovo l'inizializzazione duplicata qui poiché già definita alla riga ~1600 */
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
                orientationMessage.innerHTML = 'Per una migliore esperienza di gioco,<br>ruota il dispositivo in modalità orizzontale.';
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
    
    // Gestione abilità con tasti numerici
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
  
  // Aggiungi handler abilità
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
        // Attiva velocità
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
    
    // Calcola direzione e intensità
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
    
    // Calcola direzione e intensità
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

// Funzione per attivare le abilità
function activateAbility(index) {
  const abilities = ['speed', 'shield', 'attack'];
  const abilityName = abilities[index];
  
  if (abilityName && gameState.abilities && gameState.abilities.cooldowns) {
    // Attiva l'abilità se disponibile e non in cooldown
    if (gameState.abilities.cooldowns[abilityName] <= 0) {
      console.log(`Attivazione abilità: ${abilityName}`);
      // Logica di attivazione specifica per ogni abilità
      switch(abilityName) {
        case 'speed':
          // Attiva velocità
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

// Crea pulsanti abilità per dispositivi mobili
function createAbilityButtons(container) {
  const abilitiesContainer = document.createElement('div');
  abilitiesContainer.style.position = 'absolute';
  abilitiesContainer.style.bottom = '10px';
  abilitiesContainer.style.right = '10px';
  abilitiesContainer.style.display = 'flex';
  abilitiesContainer.style.gap = '10px';
  
  // Abilità disponibili
  const abilities = ['speed', 'shield', 'attack'];
  
  // Crea un pulsante per ogni abilità
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
  
  // Aggiungi container abilità al game container
  document.getElementById('game-container').appendChild(abilitiesContainer);
}

// Configura controlli per abilità con tasti e pulsanti UI
function setupAbilityControls() {
  // Crea pulsanti UI per abilità anche su desktop
  if (!isMobileDevice()) {
    const abilitiesUI = document.createElement('div');
    abilitiesUI.style.position = 'absolute';
    abilitiesUI.style.bottom = '10px';
    abilitiesUI.style.left = '50%';
    abilitiesUI.style.transform = 'translateX(-50%)';
    abilitiesUI.style.display = 'flex';
    abilitiesUI.style.gap = '10px';
    
    // Abilità disponibili
    const abilities = [
      { key: 'speed', name: 'Velocità', hotkey: '1' },
      { key: 'shield', name: 'Scudo', hotkey: '2' },
      { key: 'attack', name: 'Attacco', hotkey: '3' }
    ];
    
    // Crea un pulsante per ogni abilità
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

// Crea pulsanti abilità per dispositivi mobili
function createAbilityButtons(container) {
  const abilitiesContainer = document.createElement('div');
  abilitiesContainer.style.position = 'absolute';
  abilitiesContainer.style.bottom = '10px';
  abilitiesContainer.style.right = '10px';
  abilitiesContainer.style.display = 'flex';
  abilitiesContainer.style.gap = '10px';
  
  // Abilità disponibili
  const abilities = ['speed', 'shield', 'attack'];
  
  // Crea un pulsante per ogni abilità
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
  
  // Aggiungi container abilità al game container
  document.getElementById('game-container').appendChild(abilitiesContainer);
}

// Configura controlli per abilità con tasti e pulsanti UI
function setupAbilityControls() {
  // Crea pulsanti UI per abilità anche su desktop
  if (!isMobileDevice()) {
    const abilitiesUI = document.createElement('div');
    abilitiesUI.style.position = 'absolute';
    abilitiesUI.style.bottom = '10px';
    abilitiesUI.style.left = '50%';
    abilitiesUI.style.transform = 'translateX(-50%)';
    abilitiesUI.style.display = 'flex';
    abilitiesUI.style.gap = '10px';
    
    // Abilità disponibili
    const abilities = [
      { key: 'speed', name: 'Velocità', hotkey: '1' },
      { key: 'shield', name: 'Scudo', hotkey: '2' },
      { key: 'attack', name: 'Attacco', hotkey: '3' }
    ];
    
    // Crea un pulsante per ogni abilità
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
      console.log('Texture già caricate');
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
    // Inizializza PixiJS se non è già inizializzato
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
  
  // Se non c'è playerID, creane uno nuovo
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
      const joinMessage = {
        type: 'join',
        id: gameState.playerId,
        name: 'Tu',
        x: gameState.players.get(gameState.playerId).x,
        y: gameState.players.get(gameState.playerId).y,
        size: gameState.players.get(gameState.playerId).size,
        color: gameState.players.get(gameState.playerId).color
      };
      
      // Diagnostica
      console.log('Invio messaggio join:', joinMessage);
      
      sendToServer(joinMessage);
      
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
    
    socket.onmessage = function(event) {
      try {
        // Aggiorna timestamp ultimo messaggio
        gameState.lastServerMessage = Date.now();
        
        const data = JSON.parse(event.data);
        console.log('Messaggio ricevuto:', data.type);
        
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
  } catch (error) {
    console.error('Errore creazione WebSocket:', error);
    showMessage('Impossibile connettersi al server', 'error');
  }
}

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
      // Se c'è solo il giocatore locale, usa lo zoom semplice
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
    // Inizializza PixiJS se non è già inizializzato
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
      
      // Aggiorna visibilità
      if (gameState.chunkManager) {
        const visibleBounds = gameState.camera.getVisibleBounds();
        gameState.chunkManager.updateVisibility(visibleBounds);
      }
    }
    
    // Ottimizzazione: applica visibilità
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

// Optimization: applica visibilità in base a chunks
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
      
      // Verifica se PIXI.Assets è disponibile (PixiJS 7+)
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
          
          // Carica bundle con gestione errore più robusta
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
        
        // Abilità
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

// Migliora createEnergyPoint per una gestione più robusta degli errori
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

// Migliora l'inizializzazione del gioco con gestione errori più robusta
async function initGame() {
  try {
    // Inizializza PixiJS se non è già inizializzato
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
    
    // Verifica se anime.js è disponibile
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