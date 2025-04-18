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
  }

  /**
   * Inizializza l'asset manager
   * @param {PIXI.Application} app - L'istanza dell'applicazione PixiJS
   * @returns {Promise} Promise che si risolve quando l'inizializzazione è completata
   */
  async init(app) {
    try {
      this.app = app;
      
      // Carica il manifest degli asset
      const response = await fetch('/assets/asset-manifest.json');
      if (!response.ok) {
        throw new Error(`Impossibile caricare il manifest degli asset: ${response.status} ${response.statusText}`);
      }
      
      this.manifest = await response.json();
      console.log('Asset manifest caricato:', this.manifest);
      
      // Configura i bundle nel sistema di asset di PixiJS
      if (PIXI.Assets) {
        // Per PixiJS v7+
        await this._setupAssetsV7();
      } else if (PIXI.Loader) {
        // Per PixiJS v6 e precedenti
        await this._setupAssetsLegacy();
      } else {
        throw new Error('API di caricamento asset PixiJS non trovata');
      }
      
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('Errore nell\'inizializzazione dell\'asset manager:', error);
      throw error;
    }
  }

  /**
   * Configura gli asset usando l'API Assets di PixiJS v7+
   * @private
   */
  async _setupAssetsV7() {
    try {
      // Registra tutti i bundle dal manifest
      for (const bundle of this.manifest.bundles) {
        // Prepara gli asset per la registrazione
        const assetsToAdd = {};
        
        for (const asset of bundle.assets) {
          assetsToAdd[asset.name] = asset.src;
        }
        
        // Registra il bundle
        PIXI.Assets.addBundle(bundle.name, assetsToAdd);
        console.log(`Bundle "${bundle.name}" registrato con ${bundle.assets.length} asset`);
      }
      
      return true;
    } catch (error) {
      console.error('Errore nella configurazione degli asset con PixiJS v7:', error);
      throw error;
    }
  }

  /**
   * Configura gli asset usando PIXI.Loader (API legacy)
   * @private
   */
  async _setupAssetsLegacy() {
    return new Promise((resolve, reject) => {
      try {
        const loader = PIXI.Loader.shared;
        
        // Aggiungi tutti gli asset al loader
        for (const bundle of this.manifest.bundles) {
          for (const asset of bundle.assets) {
            loader.add(asset.name, asset.src);
          }
        }
        
        // Configura gli eventi
        loader.onError.add((error, _loader, resource) => {
          console.warn(`Errore caricamento risorsa "${resource.name}":`, error);
        });
        
        loader.onProgress.add((loader) => {
          const progress = loader.progress / 100;
          if (this.onProgress) this.onProgress(progress);
        });
        
        // Non caricare ancora - avverrà quando loadBundle() viene chiamato
        resolve(true);
      } catch (error) {
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
        throw new Error('AssetManager non inizializzato. Chiamare init() prima di loadBundle()');
      }
      
      this.onProgress = progressCallback;
      
      // Trova il bundle nel manifest
      const bundle = this.manifest.bundles.find(b => b.name === bundleName);
      if (!bundle) {
        throw new Error(`Bundle "${bundleName}" non trovato nel manifest`);
      }
      
      console.log(`Caricamento bundle "${bundleName}" iniziato...`);
      
      if (PIXI.Assets) {
        // PixiJS v7+
        const assets = await PIXI.Assets.loadBundle(bundleName, (progress) => {
          if (progressCallback) progressCallback(progress);
        });
        
        // Memorizza gli asset per accesso facile
        for (const [name, asset] of Object.entries(assets)) {
          this.textures[name] = asset;
        }
        
        console.log(`Bundle "${bundleName}" caricato con successo`);
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
                console.warn(`Asset "${name}" non trovato nelle risorse caricate`);
              }
            }
            
            console.log(`Bundle "${bundleName}" caricato con successo`);
            resolve(loadedAssets);
          });
        });
      } else {
        throw new Error('API di caricamento asset PixiJS non trovata');
      }
    } catch (error) {
      console.error(`Errore nel caricamento del bundle "${bundleName}":`, error);
      
      // Genera asset di fallback
      return this._generateFallbacks(bundleName);
    }
  }

  /**
   * Genera asset di fallback quando il caricamento fallisce
   * @param {string} bundleName - Il nome del bundle per cui generare fallback
   * @private
   */
  _generateFallbacks(bundleName) {
    console.warn(`Generazione fallback per bundle "${bundleName}"`);
    const fallbackAssets = {};
    
    try {
      const bundle = this.manifest.bundles.find(b => b.name === bundleName);
      if (!bundle) return fallbackAssets;
      
      for (const asset of bundle.assets) {
        if (asset.fallback) {
          console.log(`Generazione fallback per "${asset.name}"`);
          
          // Crea grafica di fallback
          const graphics = new PIXI.Graphics();
          
          if (asset.fallback.type === 'circle') {
            graphics.beginFill(parseInt(asset.fallback.color));
            graphics.drawCircle(0, 0, asset.fallback.radius);
            graphics.endFill();
          } else if (asset.fallback.type === 'rect') {
            graphics.beginFill(parseInt(asset.fallback.color));
            graphics.drawRect(0, 0, asset.fallback.width, asset.fallback.height);
            graphics.endFill();
          }
          
          // Genera texture dalla grafica
          const texture = this.app.renderer.generateTexture(graphics);
          this.textures[asset.name] = texture;
          fallbackAssets[asset.name] = texture;
        }
      }
      
      return fallbackAssets;
    } catch (error) {
      console.error('Errore nella generazione dei fallback:', error);
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
      console.warn(`Texture "${name}" non trovata`);
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
      console.warn(`Impossibile creare sprite: texture "${textureName}" non trovata`);
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
    
    console.log('Tutti gli asset sono stati scaricati');
  }
}

// Esporta come singleton
window.AssetManager = new AssetManager(); 