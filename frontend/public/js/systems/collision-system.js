/**
 * CollisionSystem - Sistema di rilevamento collisioni ottimizzato
 * Utilizza spatial partitioning per ridurre la complessità delle collisioni da O(n²) a O(n)
 */
class CollisionSystem {
  /**
   * @param {number} worldWidth - Larghezza del mondo di gioco
   * @param {number} worldHeight - Altezza del mondo di gioco
   * @param {number} cellSize - Dimensione di ogni cella della griglia (default: 200)
   */
  constructor(worldWidth, worldHeight, cellSize = 200) {
    // Dimensioni del mondo
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    
    // Configurazione della griglia
    this.cellSize = cellSize;
    this.gridWidth = Math.ceil(worldWidth / cellSize);
    this.gridHeight = Math.ceil(worldHeight / cellSize);
    
    // Inizializza la griglia spaziale vuota
    this.spatialGrid = {};
    
    // Cache entità registrate
    this.entities = {
      players: new Map(),
      energyPoints: new Map(),
      obstacles: new Map()
    };
    
    // Callback di collisione
    this.onCollision = null;
    
    console.log(`Sistema di collisioni inizializzato: griglia ${this.gridWidth}x${this.gridHeight}, celle di ${cellSize}px`);
  }
  
  /**
   * Calcola la chiave della cella in base alle coordinate
   * @param {number} x - Coordinata X
   * @param {number} y - Coordinata Y
   * @returns {string} Chiave della cella
   */
  _getCellKey(x, y) {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);
    return `${gridX},${gridY}`;
  }
  
  /**
   * Ottiene tutte le celle vicine a una posizione
   * @param {number} x - Coordinata X
   * @param {number} y - Coordinata Y
   * @param {number} radius - Raggio di ricerca (opzionale)
   * @returns {Array<string>} Array di chiavi delle celle
   */
  _getNearbyCells(x, y, radius = 0) {
    const cellKeys = [];
    
    // Calcola il numero di celle da controllare in ogni direzione
    const cellRadius = radius > 0 ? Math.ceil(radius / this.cellSize) : 0;
    
    // Posizione centrale nella griglia
    const centerGridX = Math.floor(x / this.cellSize);
    const centerGridY = Math.floor(y / this.cellSize);
    
    // Itera sulle celle nell'area
    for (let gx = centerGridX - cellRadius; gx <= centerGridX + cellRadius; gx++) {
      for (let gy = centerGridY - cellRadius; gy <= centerGridY + cellRadius; gy++) {
        // Verifica che la cella sia all'interno del mondo
        if (gx >= 0 && gx < this.gridWidth && gy >= 0 && gy < this.gridHeight) {
          cellKeys.push(`${gx},${gy}`);
        }
      }
    }
    
    return cellKeys;
  }
  
  /**
   * Resetta la griglia spaziale
   */
  resetGrid() {
    this.spatialGrid = {};
  }
  
  /**
   * Aggiunge un'entità alla griglia spaziale
   * @param {Object} entity - Entità da aggiungere
   * @param {string} type - Tipo di entità ('player', 'energy', 'obstacle')
   */
  addToGrid(entity, type) {
    if (!entity || !entity.id || !entity.x || !entity.y) {
      console.warn('Entità non valida:', entity);
      return;
    }
    
    // Determina il raggio dell'entità
    let radius = 0;
    if (type === 'player') {
      radius = entity.size / 2;
      this.entities.players.set(entity.id, entity);
    } else if (type === 'energy') {
      radius = 7.5; // Raggio standard per i punti energia
      this.entities.energyPoints.set(entity.id, entity);
    } else if (type === 'obstacle') {
      radius = entity.size || 20;
      this.entities.obstacles.set(entity.id, entity);
    }
    
    // Aggiungi l'entità a tutte le celle che copre
    const cellKey = this._getCellKey(entity.x, entity.y);
    
    // Inizializza l'array della cella se necessario
    if (!this.spatialGrid[cellKey]) {
      this.spatialGrid[cellKey] = [];
    }
    
    // Aggiungi l'entità alla cella con il suo tipo
    this.spatialGrid[cellKey].push({
      id: entity.id,
      x: entity.x,
      y: entity.y,
      radius: radius,
      type: type,
      entity: entity
    });
  }
  
  /**
   * Aggiorna la posizione di un'entità nella griglia
   * @param {Object} entity - Entità da aggiornare
   * @param {string} type - Tipo di entità ('player', 'energy', 'obstacle')
   */
  updateEntity(entity, type) {
    if (!entity || !entity.id) return;
    
    // Rimuovi e aggiungi nuovamente l'entità per aggiornare la sua posizione
    this.removeEntity(entity.id, type);
    this.addToGrid(entity, type);
  }
  
  /**
   * Rimuove un'entità dalla griglia
   * @param {string} id - ID dell'entità da rimuovere
   * @param {string} type - Tipo di entità ('player', 'energy', 'obstacle')
   */
  removeEntity(id, type) {
    // Rimuovi dalla cache
    if (type === 'player') {
      this.entities.players.delete(id);
    } else if (type === 'energy') {
      this.entities.energyPoints.delete(id);
    } else if (type === 'obstacle') {
      this.entities.obstacles.delete(id);
    }
    
    // Rimuovi dalla griglia (più costoso, ma necessario)
    for (const cellKey in this.spatialGrid) {
      const cell = this.spatialGrid[cellKey];
      const index = cell.findIndex(item => item.id === id && item.type === type);
      
      if (index !== -1) {
        cell.splice(index, 1);
        
        // Rimuovi la cella se è vuota
        if (cell.length === 0) {
          delete this.spatialGrid[cellKey];
        }
      }
    }
  }
  
  /**
   * Verifica se due entità sono in collisione
   * @param {Object} entity1 - Prima entità
   * @param {Object} entity2 - Seconda entità
   * @returns {boolean} True se le entità sono in collisione
   */
  checkCollision(entity1, entity2) {
    const dx = entity1.x - entity2.x;
    const dy = entity1.y - entity2.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    return distance < (entity1.radius + entity2.radius);
  }
  
  /**
   * Aggiorna la griglia con tutte le entità attuali
   * @param {Map} players - Mappa dei giocatori
   * @param {Map} energyPoints - Mappa dei punti energia
   * @param {Map} obstacles - Mappa degli ostacoli (opzionale)
   */
  update(players, energyPoints, obstacles = null) {
    // Resetta la griglia
    this.resetGrid();
    
    // Aggiungi tutti i giocatori alla griglia
    players.forEach(player => {
      this.addToGrid(player, 'player');
    });
    
    // Aggiungi tutti i punti energia alla griglia
    energyPoints.forEach(point => {
      this.addToGrid(point, 'energy');
    });
    
    // Aggiungi gli ostacoli se presenti
    if (obstacles) {
      obstacles.forEach(obstacle => {
        this.addToGrid(obstacle, 'obstacle');
      });
    }
  }
  
  /**
   * Trova tutte le collisioni per un'entità
   * @param {Object} entity - Entità da controllare
   * @param {string} targetType - Tipo di entità con cui controllare le collisioni
   * @returns {Array} Array di entità in collisione
   */
  findCollisions(entity, targetType) {
    if (!entity || !entity.id) return [];
    
    const collisions = [];
    const entityType = entity.isPlayer ? 'player' : (entity.isEnergy ? 'energy' : 'obstacle');
    const cellKeys = this._getNearbyCells(entity.x, entity.y, entity.size || 50);
    
    // Controlla ogni cella vicina
    for (const cellKey of cellKeys) {
      const cell = this.spatialGrid[cellKey];
      
      if (cell) {
        // Filtra le entità del tipo target
        const targets = cell.filter(item => item.type === targetType && item.id !== entity.id);
        
        // Controlla le collisioni con ogni target
        for (const target of targets) {
          if (this.checkCollision(
            { x: entity.x, y: entity.y, radius: entity.size / 2 },
            { x: target.x, y: target.y, radius: target.radius }
          )) {
            collisions.push(target.entity);
          }
        }
      }
    }
    
    return collisions;
  }
  
  /**
   * Processa tutte le collisioni tra giocatori e punti energia
   * @param {Function} onCollision - Callback da chiamare per ogni collisione (player, energyPoint)
   */
  processCollisions(onCollision) {
    if (!onCollision) return;
    
    this.entities.players.forEach(player => {
      // Trova tutte le collisioni con i punti energia
      const collisions = this.findCollisions(player, 'energy');
      
      // Processa ogni collisione
      for (const energyPoint of collisions) {
        onCollision(player, energyPoint);
      }
    });
  }
  
  /**
   * Disegna la griglia di debug
   * @param {PIXI.Graphics} graphics - Oggetto graphics su cui disegnare
   */
  drawDebugGrid(graphics) {
    if (!graphics) return;
    
    graphics.clear();
    
    // Disegna le linee della griglia
    graphics.lineStyle(1, 0x333333, 0.5);
    
    // Linee verticali
    for (let x = 0; x <= this.worldWidth; x += this.cellSize) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, this.worldHeight);
    }
    
    // Linee orizzontali
    for (let y = 0; y <= this.worldHeight; y += this.cellSize) {
      graphics.moveTo(0, y);
      graphics.lineTo(this.worldWidth, y);
    }
    
    // Evidenzia le celle occupate
    for (const cellKey in this.spatialGrid) {
      const [gridX, gridY] = cellKey.split(',').map(Number);
      const cellX = gridX * this.cellSize;
      const cellY = gridY * this.cellSize;
      
      // Colorazione in base al tipo di entità nella cella
      const cell = this.spatialGrid[cellKey];
      
      // Cella con giocatori
      if (cell.some(item => item.type === 'player')) {
        graphics.beginFill(0xff3333, 0.1);
      } 
      // Cella con punti energia
      else if (cell.some(item => item.type === 'energy')) {
        graphics.beginFill(0x33ffff, 0.1);
      } 
      // Cella con ostacoli
      else if (cell.some(item => item.type === 'obstacle')) {
        graphics.beginFill(0xffcc33, 0.1);
      }
      
      graphics.drawRect(cellX, cellY, this.cellSize, this.cellSize);
      graphics.endFill();
    }
  }
}

// Esporta come singleton
window.CollisionSystem = CollisionSystem; 