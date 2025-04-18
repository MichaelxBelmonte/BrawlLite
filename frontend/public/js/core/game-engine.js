/**
 * GameEngine - Motore di gioco principale
 * Gestisce l'inizializzazione, l'aggiornamento e i sistemi del gioco
 */
class GameEngine {
  constructor() {
    // Core engine
    this.app = null;
    this.initialized = false;
    this.running = false;
    this.lastFrameTime = 0;
    this.deltaTime = 0;
    
    // Systems
    this.assetManager = null;
    this.collisionSystem = null;
    
    // Game state
    this.gameState = {
      players: new Map(),
      energyPoints: new Map(),
      obstacles: new Map(),
      playerId: null,
      worldContainer: null,
      containers: null,
      debug: false,
      keys: {},
      joystick: {
        active: false,
        dx: 0,
        dy: 0
      }
    };
    
    // Settings
    this.worldConfig = {
      width: 3000,
      height: 3000,
      minZoom: 0.5,
      maxZoom: 1.2,
      padding: 50
    };
    
    // Modules
    this.modules = {};
    
    // Rendering
    this.renderer = null;
    
    // Comunicazione
    this.networkManager = null;
    
    // Debug
    this.fpsCounter = null;
    this.debugGraphics = null;
    
    console.log('GameEngine creato');
  }
  
  /**
   * Inizializza il motore di gioco
   * @param {Object} config - Configurazione del gioco
   * @returns {Promise} Promise che si risolve quando l'inizializzazione è completata
   */
  async init(config = {}) {
    try {
      console.log('Inizializzazione GameEngine...');
      
      // Unione della configurazione
      this.worldConfig = {
        ...this.worldConfig,
        ...config.world
      };
      
      // Esposizione globale per compatibilità
      window.gameState = this.gameState;
      
      // Inizializza PixiJS
      this.app = this._initPixiJS(config.renderer);
      
      // Esposizione globale per compatibilità
      window.app = this.app;
      
      // Crea container principali
      this._setupContainers();
      
      // Inizializza l'asset manager
      this.assetManager = window.AssetManager;
      await this.assetManager.init(this.app);
      
      // Inizializza sistema di collisioni
      this.collisionSystem = new window.CollisionSystem(
        this.worldConfig.width,
        this.worldConfig.height,
        200 // Dimensione celle
      );
      
      // Imposta il loop di gioco
      this.app.ticker.add(this._gameLoop.bind(this));
      
      // Inizializza controlli
      this._setupControls();
      
      // Gestione del ridimensionamento
      window.addEventListener('resize', this._handleResize.bind(this));
      
      // Gestione dell'orientamento
      this._handleDeviceOrientation();
      
      // Setup debug
      if (config.debug) {
        this._setupDebug();
      }
      
      this.initialized = true;
      console.log('GameEngine inizializzato con successo');
      
      return true;
    } catch (error) {
      console.error('Errore nell\'inizializzazione del GameEngine:', error);
      this._showError(`Errore inizializzazione: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Inizializza il renderer PixiJS
   * @param {Object} config - Configurazione del renderer
   * @returns {PIXI.Application} Istanza dell'applicazione PixiJS
   * @private
   */
  _initPixiJS(config = {}) {
    try {
      console.log('Inizializzazione renderer PixiJS...');
      
      // Controlla se PIXI è disponibile
      if (!window.PIXI) {
        throw new Error('PixiJS non disponibile. Verifica che sia caricato correttamente.');
      }
      
      // Configurazione del renderer
      const rendererOptions = {
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x061639,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        ...config
      };
      
      // Controllo del supporto WebGL
      let isWebGLSupported = false;
      try {
        // PixiJS v6+
        if (PIXI.utils && PIXI.utils.isWebGLSupported) {
          isWebGLSupported = PIXI.utils.isWebGLSupported();
        } else {
          // PixiJS v7+
          isWebGLSupported = true; // Fallback sicuro
        }
      } catch (e) {
        console.warn('Impossibile verificare il supporto WebGL:', e);
        isWebGLSupported = true; // Assumiamo supporto
      }
      
      // Aggiusta opzioni in base al supporto
      if (isWebGLSupported) {
        rendererOptions.forceCanvas = false;
        rendererOptions.antialias = true;
      } else {
        rendererOptions.forceCanvas = true;
      }
      
      console.log('Creazione applicazione PixiJS con opzioni:', rendererOptions);
      
      // Crea l'applicazione
      const pixiApp = new PIXI.Application(rendererOptions);
      
      // Aggiungi al DOM
      const gameContainer = document.getElementById('game-container');
      if (!gameContainer) {
        throw new Error('Container di gioco non trovato nel DOM');
      }
      
      gameContainer.innerHTML = '';
      gameContainer.appendChild(pixiApp.view);
      
      console.log('Renderer PixiJS inizializzato:', 
        isWebGLSupported ? 'WebGL' : 'Canvas');
      
      return pixiApp;
    } catch (error) {
      console.error('Errore nell\'inizializzazione di PixiJS:', error);
      throw error;
    }
  }
  
  /**
   * Configura i container per il rendering
   * @private
   */
  _setupContainers() {
    console.log('Configurazione container di rendering...');
    
    // Container principale per il mondo
    this.gameState.worldContainer = new PIXI.Container();
    this.app.stage.addChild(this.gameState.worldContainer);
    
    // Container specifici nell'ordine corretto di rendering
    this.gameState.containers = {
      background: new PIXI.Container(),
      grid: new PIXI.Container(),
      obstacles: new PIXI.Container(),
      energy: new PIXI.Container(),
      players: new PIXI.Container(),
      effects: new PIXI.Container(),
      ui: new PIXI.Container(),
      debug: new PIXI.Container()
    };
    
    // Aggiungi i container nel mondo in ordine
    Object.values(this.gameState.containers).forEach(container => {
      this.gameState.worldContainer.addChild(container);
    });
    
    console.log('Container configurati correttamente');
  }
  
  /**
   * Configura i controlli di input
   * @private
   */
  _setupControls() {
    console.log('Configurazione controlli...');
    
    // Pulisci eventuali listener preesistenti
    window.removeEventListener('keydown', this._handleKeyDown);
    window.removeEventListener('keyup', this._handleKeyUp);
    
    // Funzioni di gestione tastiera con bind a this
    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleKeyUp = this._handleKeyUp.bind(this);
    
    // Aggiungi listener
    window.addEventListener('keydown', this._handleKeyDown);
    window.addEventListener('keyup', this._handleKeyUp);
    
    // Controlli touch su mobile
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      console.log('Dispositivo mobile rilevato, inizializzazione controlli touch');
      this._setupTouchControls();
    }
    
    console.log('Controlli configurati correttamente');
  }
  
  /**
   * Gestore eventi keydown
   * @param {KeyboardEvent} event - Evento tastiera
   * @private
   */
  _handleKeyDown(event) {
    this.gameState.keys[event.key] = true;
    
    // Previeni lo scrolling con tasti freccia
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
      event.preventDefault();
    }
    
    // Debug toggle con F3
    if (event.key === 'F3') {
      this.gameState.debug = !this.gameState.debug;
      console.log(`Debug mode: ${this.gameState.debug ? 'ON' : 'OFF'}`);
      
      // Mostra/nascondi container debug
      this.gameState.containers.debug.visible = this.gameState.debug;
    }
  }
  
  /**
   * Gestore eventi keyup
   * @param {KeyboardEvent} event - Evento tastiera
   * @private
   */
  _handleKeyUp(event) {
    this.gameState.keys[event.key] = false;
  }
  
  /**
   * Configura controlli touch per dispositivi mobili
   * @private
   */
  _setupTouchControls() {
    // Implementazione base di joystick virtuale
    // In un'implementazione completa, usare una libreria dedicata
  }
  
  /**
   * Gestisce il ridimensionamento della finestra
   * @private
   */
  _handleResize() {
    if (!this.app || !this.app.renderer) return;
    
    // Aggiorna dimensioni renderer
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
    
    // Verifica orientamento dispositivo
    this._handleDeviceOrientation();
    
    console.log(`Finestra ridimensionata: ${window.innerWidth}x${window.innerHeight}`);
  }
  
  /**
   * Gestisce l'orientamento del dispositivo
   * @private
   */
  _handleDeviceOrientation() {
    // Rileva se è un dispositivo mobile
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      const isPortrait = window.innerHeight > window.innerWidth;
      const orientationMessage = document.getElementById('orientation-message');
      
      if (isPortrait) {
        if (!orientationMessage) {
          // Crea messaggio orientamento
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
          message.style.textAlign = 'center';
          
          message.innerHTML = `
            <div>
              <svg width="100" height="100" viewBox="0 0 100 100">
                <path fill="white" d="M70,10L70,90L20,50L70,10Z"></path>
                <rect x="75" y="25" width="15" height="50" fill="white"></rect>
              </svg>
            </div>
            <p style="margin-top: 20px; font-size: 18px;">
              Ruota il dispositivo in orizzontale per una migliore esperienza di gioco
            </p>
          `;
          
          document.body.appendChild(message);
        } else {
          orientationMessage.style.display = 'flex';
        }
      } else if (orientationMessage) {
        orientationMessage.style.display = 'none';
      }
    }
  }
  
  /**
   * Configura strumenti di debug
   * @private
   */
  _setupDebug() {
    // FPS counter
    this.fpsCounter = document.createElement('div');
    this.fpsCounter.id = 'fps-counter';
    this.fpsCounter.style.position = 'fixed';
    this.fpsCounter.style.top = '10px';
    this.fpsCounter.style.right = '10px';
    this.fpsCounter.style.backgroundColor = 'rgba(0,0,0,0.5)';
    this.fpsCounter.style.color = 'white';
    this.fpsCounter.style.padding = '5px';
    this.fpsCounter.style.fontFamily = 'monospace';
    this.fpsCounter.style.zIndex = '1000';
    document.body.appendChild(this.fpsCounter);
    
    // Graphics per debug
    this.debugGraphics = new PIXI.Graphics();
    this.gameState.containers.debug.addChild(this.debugGraphics);
    this.gameState.containers.debug.visible = this.gameState.debug;
    
    console.log('Debug tools configurati');
  }
  
  /**
   * Registra un modulo di gioco
   * @param {string} name - Nome del modulo
   * @param {Object} module - Istanza del modulo
   */
  registerModule(name, module) {
    if (this.modules[name]) {
      console.warn(`Modulo "${name}" già registrato, sovrascrittura`);
    }
    
    this.modules[name] = module;
    
    // Se il modulo ha un metodo init, chiamalo
    if (module.init && typeof module.init === 'function') {
      module.init(this);
    }
    
    console.log(`Modulo "${name}" registrato con successo`);
  }
  
  /**
   * Ottiene un modulo registrato
   * @param {string} name - Nome del modulo
   * @returns {Object} Istanza del modulo
   */
  getModule(name) {
    return this.modules[name];
  }
  
  /**
   * Carica gli asset del gioco
   * @param {string} bundleName - Nome del bundle da caricare
   * @returns {Promise} Promise che si risolve quando gli asset sono caricati
   */
  async loadAssets(bundleName) {
    try {
      if (!this.assetManager) {
        throw new Error('AssetManager non inizializzato');
      }
      
      console.log(`Caricamento assets "${bundleName}"...`);
      
      // Mostra un indicatore di progresso
      const progressBar = this._createProgressBar();
      
      // Callback progresso
      const onProgress = (progress) => {
        progressBar.inner.style.width = `${progress * 100}%`;
      };
      
      // Carica gli asset
      const assets = await this.assetManager.loadBundle(bundleName, onProgress);
      
      // Rimuovi progress bar
      if (progressBar.container.parentNode) {
        progressBar.container.parentNode.removeChild(progressBar.container);
      }
      
      console.log(`Assets "${bundleName}" caricati:`, Object.keys(assets));
      
      return assets;
    } catch (error) {
      console.error(`Errore caricamento assets "${bundleName}":`, error);
      this._showError(`Errore caricamento risorse: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Crea una barra di progresso
   * @returns {Object} Container e barra interna
   * @private
   */
  _createProgressBar() {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '50%';
    container.style.left = '50%';
    container.style.transform = 'translate(-50%, -50%)';
    container.style.width = '300px';
    container.style.height = '20px';
    container.style.backgroundColor = 'rgba(0,0,0,0.5)';
    container.style.borderRadius = '10px';
    container.style.overflow = 'hidden';
    container.style.zIndex = '1500';
    
    const inner = document.createElement('div');
    inner.style.width = '0%';
    inner.style.height = '100%';
    inner.style.backgroundColor = '#00ff88';
    inner.style.transition = 'width 0.3s';
    
    container.appendChild(inner);
    document.body.appendChild(container);
    
    return { container, inner };
  }
  
  /**
   * Mostra un messaggio di errore
   * @param {string} message - Messaggio di errore
   * @private
   */
  _showError(message) {
    console.error(message);
    
    const errorContainer = document.createElement('div');
    errorContainer.style.position = 'fixed';
    errorContainer.style.top = '10px';
    errorContainer.style.left = '50%';
    errorContainer.style.transform = 'translateX(-50%)';
    errorContainer.style.backgroundColor = '#f44336';
    errorContainer.style.color = 'white';
    errorContainer.style.padding = '10px 20px';
    errorContainer.style.borderRadius = '5px';
    errorContainer.style.zIndex = '2000';
    errorContainer.textContent = message;
    
    document.body.appendChild(errorContainer);
    
    setTimeout(() => {
      if (errorContainer.parentNode) {
        errorContainer.parentNode.removeChild(errorContainer);
      }
    }, 5000);
  }
  
  /**
   * Game loop principale
   * @param {number} deltaTime - Delta time in ms
   * @private
   */
  _gameLoop(delta) {
    if (!this.initialized || !this.running) return;
    
    // Calcola delta time normalizzato
    this.deltaTime = delta / 60; // Normalizza per 60 FPS
    
    // Aggiorna FPS counter
    if (this.gameState.debug && this.fpsCounter) {
      this.fpsCounter.textContent = `FPS: ${Math.round(this.app.ticker.FPS)}`;
    }
    
    // Aggiorna tutti i moduli registrati
    for (const name in this.modules) {
      const module = this.modules[name];
      if (module.update && typeof module.update === 'function') {
        module.update(this.deltaTime);
      }
    }
    
    // Aggiorna il sistema di collisioni
    if (this.collisionSystem) {
      this.collisionSystem.update(
        this.gameState.players,
        this.gameState.energyPoints,
        this.gameState.obstacles
      );
      
      // Processa collisioni
      this.collisionSystem.processCollisions(this._handleCollision.bind(this));
      
      // Disegna debug grid
      if (this.gameState.debug && this.debugGraphics) {
        this.collisionSystem.drawDebugGrid(this.debugGraphics);
      }
    }
  }
  
  /**
   * Gestisce una collisione tra entità
   * @param {Object} player - Giocatore
   * @param {Object} entity - Entità con cui collide
   * @private
   */
  _handleCollision(player, entity) {
    // Logica di collisione base
    console.log(`Collisione: ${player.id} con ${entity.id}`);
  }
  
  /**
   * Avvia il gioco
   */
  start() {
    if (!this.initialized) {
      console.error('GameEngine non inizializzato. Chiamare init() prima di start()');
      return false;
    }
    
    console.log('Avvio gioco...');
    
    // Avvia il ticker se non è già attivo
    if (this.app && this.app.ticker && !this.app.ticker.started) {
      this.app.ticker.start();
    }
    
    this.running = true;
    
    console.log('Gioco avviato con successo');
    return true;
  }
  
  /**
   * Mette in pausa il gioco
   */
  pause() {
    if (!this.running) return;
    
    this.running = false;
    console.log('Gioco in pausa');
  }
  
  /**
   * Riprende il gioco dalla pausa
   */
  resume() {
    if (this.running) return;
    
    this.running = true;
    console.log('Gioco ripreso');
  }
  
  /**
   * Ferma il gioco e rilascia le risorse
   */
  stop() {
    this.running = false;
    
    // Ferma il ticker
    if (this.app && this.app.ticker) {
      this.app.ticker.stop();
    }
    
    console.log('Gioco fermato');
  }
  
  /**
   * Rilascia tutte le risorse
   */
  destroy() {
    this.stop();
    
    // Rimuovi eventi
    window.removeEventListener('keydown', this._handleKeyDown);
    window.removeEventListener('keyup', this._handleKeyUp);
    window.removeEventListener('resize', this._handleResize);
    
    // Rimuovi elementi UI
    if (this.fpsCounter && this.fpsCounter.parentNode) {
      this.fpsCounter.parentNode.removeChild(this.fpsCounter);
    }
    
    // Distruggi app PixiJS
    if (this.app) {
      this.app.destroy(true, {
        children: true,
        texture: true,
        baseTexture: true
      });
    }
    
    // Scarica assets
    if (this.assetManager) {
      this.assetManager.unloadAll();
    }
    
    console.log('GameEngine distrutto e risorse rilasciate');
  }
}

// Esporta come singleton
window.GameEngine = new GameEngine(); 