/**
 * AssetManager - Gestione centralizzata degli asset di gioco 
 * Utilizza PixiJS Assets API per caricamento efficiente con caching, fallback e progressione
 */
class AssetManager {
  constructor() {
    this.manifest = null;
    this.textures = {};
    this.sprites = {};
    this.sounds = {};
    this.initialized = false;
    this.app = null;
    this.onProgress = null;
    
    // Versione corrente del manifest
    this.version = "1.0.0";
    
    // Percorsi personalizzabili
    this.basePath = './';
  }

  /**
   * Inizializza l'asset manager
   * @param {PIXI.Application} app - L'istanza dell'applicazione PixiJS
   * @returns {Promise} Promise che si risolve quando l'inizializzazione è completata
   */
  async init(app) {
    try {
      this.app = app;
      
      console.log('AssetManager: Inizializzazione...');
      
      // In caso di errore nel caricamento del manifest, ne creiamo uno di default
      const defaultManifest = {
        "bundles": [
          {
            "name": "game-core",
            "assets": [
              {
                "name": "player",
                "src": "./assets/images/player.png",
                "fallback": {
                  "type": "circle",
                  "color": "0x00ff88",
                  "radius": 15
                }
              },
              {
                "name": "energy",
                "src": "./assets/images/energy.png",
                "fallback": {
                  "type": "circle",
                  "color": "0x00ffff",
                  "radius": 7.5
                }
              }
            ]
          }
        ],
        "version": this.version
      };
      
      try {
        // Carica il manifest degli asset
        const response = await fetch('./assets/asset-manifest.json');
        if (!response.ok) {
          throw new Error(`Impossibile caricare il manifest degli asset: ${response.status} ${response.statusText}`);
        }
        
        this.manifest = await response.json();
        console.log('Asset manifest caricato:', this.manifest.version);
      } catch (manifestError) {
        console.warn('AssetManager: Errore nel caricamento del manifest, uso fallback:', manifestError);
        this.manifest = defaultManifest;
      }
      
      // Configura i bundle nel sistema di asset di PixiJS
      if (PIXI.Assets) {
        // Per PixiJS v7+
        await this._setupAssetsV7();
      } else if (PIXI.Loader) {
        // Per PixiJS v6 e precedenti
        await this._setupAssetsLegacy();
      } else {
        console.warn('AssetManager: API di caricamento PIXI non trovata, solo fallback disponibili');
      }
      
      this.initialized = true;
      console.log('AssetManager: Inizializzazione completata');
      return true;
    } catch (error) {
      console.error('AssetManager: Errore nell\'inizializzazione:', error);
      this.initialized = true; // Consentiamo comunque l'uso con fallback
      return false;
    }
  }

  /**
   * Configura gli asset usando l'API Assets di PixiJS v7+
   * @private
   */
  async _setupAssetsV7() {
    try {
      console.log('AssetManager: Configurazione con PIXI.Assets (v7+)');
      
      // Inizializza PIXI.Assets se necessario
      if (!window.assetsInitialized && PIXI.Assets.init) {
        try {
          PIXI.Assets.init({
            basePath: this.basePath
          });
          window.assetsInitialized = true;
          console.log('AssetManager: PIXI.Assets inizializzato');
        } catch (initError) {
          console.warn('AssetManager: Errore inizializzazione PIXI.Assets:', initError);
        }
      }
      
      // Registra tutti i bundle dal manifest
      for (const bundle of this.manifest.bundles) {
        // Prepara gli asset per la registrazione
        const assetsToAdd = {};
        
        for (const asset of bundle.assets) {
          // Utilizzo percorsi relativi o personalizzati
          assetsToAdd[asset.name] = asset.src.startsWith('./') ? 
            asset.src : 
            this.basePath + asset.src.replace(/^\//, '');
        }
        
        // Registra il bundle
        PIXI.Assets.addBundle(bundle.name, assetsToAdd);
        console.log(`AssetManager: Bundle "${bundle.name}" registrato con ${bundle.assets.length} asset`);
      }
      
      return true;
    } catch (error) {
      console.error('AssetManager: Errore nella configurazione degli asset con PixiJS v7:', error);
      return false;
    }
  }

  /**
   * Configura gli asset usando PIXI.Loader (API legacy)
   * @private
   */
  async _setupAssetsLegacy() {
    return new Promise((resolve, reject) => {
      try {
        console.log('AssetManager: Configurazione con PIXI.Loader (legacy)');
        
        const loader = PIXI.Loader.shared;
        
        // Aggiungi tutti gli asset al loader
        for (const bundle of this.manifest.bundles) {
          for (const asset of bundle.assets) {
            const src = asset.src.startsWith('./') ? 
              asset.src : 
              this.basePath + asset.src.replace(/^\//, '');
            
            loader.add(asset.name, src);
          }
        }
        
        // Configura gli eventi
        loader.onError.add((error, _loader, resource) => {
          console.warn(`AssetManager: Errore caricamento risorsa "${resource.name}":`, error);
        });
        
        loader.onProgress.add((loader) => {
          const progress = loader.progress / 100;
          if (this.onProgress) this.onProgress(progress);
        });
        
        // Non caricare ancora - avverrà quando loadBundle() viene chiamato
        resolve(true);
      } catch (error) {
        console.error('AssetManager: Errore setup legacy:', error);
        reject(error);
      }
    });
  }

  /**
   * Carica un bundle specifico di asset
   * @param {string} bundleName - Il nome del bundle da caricare
   * @param {Function} progressCallback - Callback per monitorare il progresso (0-1)
   * @returns {Promise} Promise che si risolve con gli asset caricati
   */
  async loadBundle(bundleName, progressCallback = null) {
    try {
      if (!this.initialized) {
        console.warn('AssetManager: Non inizializzato. Chiamare init() prima di loadBundle()');
        return this._generateFallbacks(bundleName);
      }
      
      this.onProgress = progressCallback;
      
      // Trova il bundle nel manifest
      const bundle = this.manifest.bundles.find(b => b.name === bundleName);
      if (!bundle) {
        console.warn(`AssetManager: Bundle "${bundleName}" non trovato nel manifest`);
        return this._generateFallbacks(bundleName);
      }
      
      console.log(`AssetManager: Caricamento bundle "${bundleName}" iniziato...`);
      
      try {
        if (PIXI.Assets) {
          // PixiJS v7+
          const assets = await PIXI.Assets.loadBundle(bundleName, (progress) => {
            if (progressCallback) progressCallback(progress);
          });
          
          // Memorizza gli asset per accesso facile
          for (const [name, asset] of Object.entries(assets)) {
            this.textures[name] = asset;
          }
          
          console.log(`AssetManager: Bundle "${bundleName}" caricato con successo`);
          return assets;
        } else if (PIXI.Loader) {
          // PixiJS v6 e precedenti
          return new Promise((resolve, reject) => {
            const loader = PIXI.Loader.shared;
            
            // Filtra solo gli asset di questo bundle
            const assetNames = bundle.assets.map(a => a.name);
            
            loader.load((_loader, resources) => {
              const loadedAssets = {};
              
              // Estrai solo gli asset di questo bundle
              for (const name of assetNames) {
                if (resources[name]) {
                  if (resources[name].texture) {
                    this.textures[name] = resources[name].texture;
                    loadedAssets[name] = resources[name].texture;
                  } else if (resources[name].spritesheet) {
                    this.sprites[name] = resources[name].spritesheet;
                    loadedAssets[name] = resources[name].spritesheet;
                  }
                } else {
                  console.warn(`AssetManager: Asset "${name}" non trovato nelle risorse caricate`);
                }
              }
              
              console.log(`AssetManager: Bundle "${bundleName}" caricato con successo`);
              resolve(loadedAssets);
            });
          });
        } else {
          throw new Error('AssetManager: API di caricamento asset PIXI non trovata');
        }
      } catch (error) {
        console.error(`AssetManager: Errore nel caricamento del bundle "${bundleName}":`, error);
        return this._generateFallbacks(bundleName);
      }
    } catch (error) {
      console.error(`AssetManager: Errore generico nel caricamento del bundle "${bundleName}":`, error);
      return this._generateFallbacks(bundleName);
    }
  }

  /**
   * Genera asset di fallback quando il caricamento fallisce
   * @param {string} bundleName - Il nome del bundle per cui generare fallback
   * @private
   */
  _generateFallbacks(bundleName) {
    console.warn(`AssetManager: Generazione fallback per bundle "${bundleName}"`);
    const fallbackAssets = {};
    
    try {
      // Trova il bundle appropriato o usa un fallback vuoto
      const bundle = this.manifest.bundles.find(b => b.name === bundleName) || { assets: [] };
      
      // Genera fallback per ogni asset nel bundle
      for (const asset of bundle.assets) {
        if (asset.fallback) {
          console.log(`AssetManager: Generazione fallback per "${asset.name}"`);
          
          // Crea grafica di fallback
          const graphics = new PIXI.Graphics();
          
          // Genera grafica in base al tipo di fallback
          if (asset.fallback.type === 'circle') {
            graphics.beginFill(parseInt(asset.fallback.color));
            graphics.drawCircle(0, 0, asset.fallback.radius);
            graphics.endFill();
          } else if (asset.fallback.type === 'rect') {
            graphics.beginFill(parseInt(asset.fallback.color));
            graphics.drawRect(0, 0, asset.fallback.width, asset.fallback.height);
            graphics.endFill();
          } else if (asset.fallback.type === 'sprite' && asset.fallback.text) {
            // Crea un testo come texture (utile per pulsanti)
            const textStyle = new PIXI.TextStyle({
              fontFamily: 'Arial',
              fontSize: 24,
              fill: 0xffffff,
              align: 'center'
            });
            const text = new PIXI.Text(asset.fallback.text, textStyle);
            text.anchor.set(0.5);
            text.x = asset.fallback.width / 2;
            text.y = asset.fallback.height / 2;
            
            graphics.beginFill(parseInt(asset.fallback.color));
            graphics.drawRect(0, 0, asset.fallback.width, asset.fallback.height);
            graphics.endFill();
            
            // Per asset più complessi come spritesheet, usiamo approcci specifici
            if (asset.type === 'spritesheet' && asset.data) {
              // Genera una texture semplice per spritesheet
              const { frames, rows, columns } = asset.data;
              const frameWidth = asset.fallback.width / columns;
              const frameHeight = asset.fallback.height / rows;
              
              // Dividi in riquadri per simulare i frame
              for (let i = 0; i < frames; i++) {
                const col = i % columns;
                const row = Math.floor(i / columns);
                graphics.lineStyle(1, 0xffffff);
                graphics.drawRect(
                  col * frameWidth, 
                  row * frameHeight, 
                  frameWidth, 
                  frameHeight
                );
              }
            }
          }
          
          // Genera texture dalla grafica
          const texture = this.app.renderer.generateTexture(graphics);
          this.textures[asset.name] = texture;
          fallbackAssets[asset.name] = texture;
        } else {
          console.warn(`AssetManager: Asset "${asset.name}" non ha configurazione fallback`);
        }
      }
      
      return fallbackAssets;
    } catch (error) {
      console.error('AssetManager: Errore nella generazione dei fallback:', error);
      return fallbackAssets;
    }
  }

  /**
   * Ottiene una texture dal suo nome
   * @param {string} name - Il nome della texture
   * @returns {PIXI.Texture} La texture richiesta
   */
  getTexture(name) {
    if (!this.textures[name]) {
      console.warn(`AssetManager: Texture "${name}" non trovata`);
      return null;
    }
    return this.textures[name];
  }

  /**
   * Crea un nuovo sprite da una texture
   * @param {string} textureName - Il nome della texture
   * @returns {PIXI.Sprite} Lo sprite creato
   */
  createSprite(textureName) {
    const texture = this.getTexture(textureName);
    if (!texture) {
      console.warn(`AssetManager: Impossibile creare sprite: texture "${textureName}" non trovata`);
      return null;
    }
    return new PIXI.Sprite(texture);
  }

  /**
   * Verifica se un asset è stato caricato
   * @param {string} name - Il nome dell'asset
   * @returns {boolean} True se l'asset è stato caricato
   */
  isLoaded(name) {
    return !!(this.textures[name] || this.sprites[name] || this.sounds[name]);
  }

  /**
   * Scarica tutti gli asset per liberare memoria
   */
  unloadAll() {
    if (PIXI.Assets) {
      // PixiJS v7+
      PIXI.Assets.unloadBundle(Object.keys(this.textures));
    }
    
    // Pulisci le cache
    this.textures = {};
    this.sprites = {};
    this.sounds = {};
    
    console.log('AssetManager: Tutti gli asset sono stati scaricati');
  }
}

// Esporta come singleton
window.AssetManager = new AssetManager(); 