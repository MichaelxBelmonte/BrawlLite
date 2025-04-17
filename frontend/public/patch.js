/**
 * Questo file corregge gli errori nel progetto BrawlLite
 * - Uncaught SyntaxError: Identifier 'EnergySystem' has already been declared
 * - Uncaught ReferenceError: initGame is not defined
 */

/**
 * Patch per il fix dei problemi critici in BrawlLite
 * Versione 2.0 - Correzione definitiva
 */

// SOLUZIONE DIRETTA: eliminiamo completamente la classe EnergySystem
// e implementiamo una versione unica che sarà accessibile globalmente
window.EnergySystem = class {
  constructor(container) {
    console.log('EnergySystem unificato creato');
    this.container = container;
    this.points = new Map();
    this.maxPoints = 30; // MAX_ENERGY_POINTS
    this.initialized = false;
    this.animations = [];
  }
  
  // Inizializza il sistema con un numero specificato di punti
  init(maxPoints = 30) {
    if (this.initialized) {
      console.log('EnergySystem già inizializzato');
      return;
    }
    
    console.log(`Inizializzazione sistema energia con ${maxPoints} punti`);
    
    // Pulisci punti esistenti
    this.clear();
    
    // Genera punti energia iniziali
    this.generateInitialPoints(maxPoints);
    
    this.initialized = true;
  }
  
  // Pulisce tutti i punti
  clear() {
    this.points.forEach(point => {
      if (point.sprite && point.sprite.parent) {
        point.sprite.parent.removeChild(point.sprite);
      }
    });
    
    this.points.clear();
    
    if (this.container) {
      // Mantieni solo i figli che non sono punti energia
      const nonEnergyChildren = [];
      for (let i = 0; i < this.container.children.length; i++) {
        const child = this.container.children[i];
        if (!child._isEnergyPoint) {
          nonEnergyChildren.push(child);
        }
      }
      
      this.container.removeChildren();
      
      // Riaggiungi i figli che non sono punti energia
      for (let i = 0; i < nonEnergyChildren.length; i++) {
        this.container.addChild(nonEnergyChildren[i]);
      }
    }
  }
  
  // Genera punti iniziali
  generateInitialPoints(count) {
    // Crea nuovi punti energia in posizioni casuali
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 3000; // WORLD_CONFIG.width
      const y = Math.random() * 3000; // WORLD_CONFIG.height
      this.addPoint(x, y);
    }
    
    console.log(`Generati ${this.points.size} punti energia`);
  }
  
  // Aggiunge un punto energia alla posizione specificata
  addPoint(x, y) {
    const id = `energy-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    let sprite;
    
    // Prova a usare la funzione originale se disponibile
    if (typeof window.createEnergyPoint === 'function') {
      sprite = window.createEnergyPoint(x, y);
    } else {
      // Fallback: crea una versione semplice del punto energia
      sprite = this._createEnergyPointFallback(x, y);
    }
    
    if (sprite) {
      // Marca lo sprite come punto energia
      sprite._isEnergyPoint = true;
      
      // Aggiungi al container se esiste
      if (this.container && !sprite.parent) {
        this.container.addChild(sprite);
      }
      
      this.points.set(id, { id, x, y, sprite });
      return id;
    }
    
    return null;
  }
  
  // Crea un punto energia semplice (fallback)
  _createEnergyPointFallback(x, y) {
    if (!window.PIXI) return null;
    
    // Crea una grafica circolare gialla
    const graphics = new PIXI.Graphics();
    graphics.beginFill(0xf1c40f);
    graphics.drawCircle(0, 0, 10);
    graphics.endFill();
    
    const sprite = new PIXI.Sprite(window.app?.renderer?.generateTexture?.(graphics) || null);
    if (!sprite.texture) {
      // Se non abbiamo potuto generare una texture, usa la grafica direttamente
      sprite.addChild(graphics);
    }
    
    sprite.anchor.set(0.5);
    sprite.x = x;
    sprite.y = y;
    sprite.width = 20;
    sprite.height = 20;
    
    return sprite;
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
    // Aggiorna animazioni dei punti esistenti
    this.points.forEach(point => {
      if (point.sprite) {
        point.sprite.rotation += 0.01 * delta;
        
        // Animazione pulsante
        const time = Date.now() / 1000;
        const scale = 0.9 + Math.sin(time * 2) * 0.1;
        point.sprite.scale.set(scale, scale);
      }
    });
    
    // Aggiungi nuovi punti se ce ne sono meno del massimo
    if (this.points.size < this.maxPoints) {
      // Aggiungi punti se ce ne sono meno del massimo
      const pointsToAdd = Math.min(3, this.maxPoints - this.points.size);
      
      for (let i = 0; i < pointsToAdd; i++) {
        const x = Math.random() * 3000; // WORLD_CONFIG.width
        const y = Math.random() * 3000; // WORLD_CONFIG.height
        this.addPoint(x, y);
      }
    }
  }
  
  // Gestisce la raccolta di un punto energia
  collectPoint(id, playerId) {
    const point = this.points.get(id);
    if (point) {
      // Crea effetto di raccolta se disponibile
      if (typeof window.createCollectEffect === 'function') {
        window.createCollectEffect(point.x, point.y);
      }
      
      // Rimuovi il punto
      this.removePoint(id);
      
      // Aggiorna score e dimensione del giocatore se disponibile
      if (typeof window.updatePlayerScore === 'function') {
        window.updatePlayerScore(playerId, 5); // ENERGY_VALUE
      }
      
      // Aggiungi nuovo punto in una posizione casuale
      const x = Math.random() * 3000; // WORLD_CONFIG.width
      const y = Math.random() * 3000; // WORLD_CONFIG.height
      this.addPoint(x, y);
    }
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
      console.error('pointsData non è un array:', pointsData);
      return;
    }
    
    try {
      // Mappatura degli ID dei punti dal server
      const serverPointIds = new Set(pointsData.map(p => p.id));
      
      // Rimuovi i punti che non sono più nel server
      this.points.forEach((point, id) => {
        if (!serverPointIds.has(id)) {
          this.removePoint(id);
        }
      });
      
      // Aggiungi o aggiorna punti dal server
      pointsData.forEach(pointData => {
        if (!this.points.has(pointData.id)) {
          this.addPoint(pointData.x, pointData.y);
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
    } catch (error) {
      console.error('Errore aggiornamento punti dal server:', error);
    }
  }
};

// Fix minimale per initGame - versione migliorata
window.initGame = function(username) {
  console.log('Funzione initGame chiamata con username:', username);
  
  try {
    if (!username || username.trim() === '') {
      throw new Error('Nome utente non valido');
    }
    
    // Nascondi schermata login e mostra il gioco
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    // Versione minimale che non dipende da altre funzioni
    const container = document.getElementById('game-container');
    const canvas = document.getElementById('game-canvas');
    
    if (!window.PIXI) {
      throw new Error('PIXI.js non caricato correttamente');
    }
    
    // Crea un'applicazione PIXI base
    window.app = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      view: canvas,
      backgroundColor: 0x0a0a0a,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    });
    
    // Imposta nome giocatore
    window.playerName = username;
    
    // Mostra messaggio iniziale
    const style = new PIXI.TextStyle({
      fontFamily: 'Arial',
      fontSize: 24,
      fill: '#00ff88',
      align: 'center'
    });
    
    const text = new PIXI.Text('Caricamento gioco in corso...', style);
    text.anchor.set(0.5);
    text.x = app.screen.width / 2;
    text.y = app.screen.height / 2;
    app.stage.addChild(text);
    
    // Prova a inizializzare il gioco in modo asincrono
    setTimeout(() => {
      text.text = 'Caricamento componenti di gioco...';
      
      // Aspetta che app.js sia completamente caricato
      setTimeout(() => {
        // Prova a chiamare le funzioni del gioco se disponibili
        if (typeof window.connectWebSocket === 'function') {
          window.connectWebSocket();
        }
        
        // Assicurati che il sistema energia sia inizializzato
        if (window.app.stage) {
          // Crea un container per l'energia se non esiste
          if (!window.energyContainer) {
            window.energyContainer = new PIXI.Container();
            window.app.stage.addChild(window.energyContainer);
          }
          
          // Inizializza il sistema energia
          if (!window.energySystem) {
            window.energySystem = new window.EnergySystem(window.energyContainer);
            window.energySystem.init(30); // MAX_ENERGY_POINTS
          }
        }
        
        text.text = 'Gioco avviato!';
        setTimeout(() => {
          app.stage.removeChild(text);
        }, 2000);
      }, 2000);
    }, 500);
    
    console.log('Gioco avviato con inizializzazione minimale');
    return true;
  } catch (error) {
    console.error('Errore inizializzazione gioco:', error);
    alert(`Errore inizializzazione: ${error.message}. Ricarica la pagina.`);
    return false;
  }
};

console.log('Patch.js 2.0: Soluzione definitiva per EnergySystem e initGame applicata'); 