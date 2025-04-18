/**
 * BrawlLite - Main entry point
 * Inizializza il gioco e gestisce le transizioni tra gli stati
 */

// Attendiamo che il DOM sia caricato
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM caricato, inizializzazione BrawlLite...');
  
  // Preleva il nome utente dal form quando viene inviato
  const loginForm = document.getElementById('login-form');
  
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      
      const usernameInput = document.getElementById('username-input');
      const username = usernameInput ? usernameInput.value.trim() : '';
      
      if (!username) {
        showMessage('Inserisci un nome utente valido', 'error');
        return;
      }
      
      // Nascondi la schermata di login
      const loginScreen = document.getElementById('login-screen');
      if (loginScreen) {
        loginScreen.style.display = 'none';
      }
      
      // Mostra il container del gioco
      const gameContainer = document.getElementById('game-container');
      if (gameContainer) {
        gameContainer.style.display = 'block';
      }
      
      // Inizializza il gioco
      await initGame(username);
    });
  } else {
    console.error('Form di login non trovato nel DOM');
  }
  
  // Mostra un messaggio all'utente
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
  
  /**
   * Inizializza il gioco utilizzando la nuova architettura modulare
   * @param {string} username - Nome utente del giocatore
   */
  async function initGame(username) {
    try {
      console.log(`Inizializzazione gioco per ${username}...`);
      
      // Assicurati che i sistemi necessari siano caricati
      if (!window.GameEngine) {
        throw new Error('GameEngine non trovato. Verifica che i file JS necessari siano caricati.');
      }
      
      // Configurazione del gioco
      const gameConfig = {
        world: {
          width: 3000,
          height: 3000
        },
        renderer: {
          backgroundColor: 0x061639,
          antialias: true
        },
        debug: true
      };
      
      // Inizializza il motore di gioco
      await window.GameEngine.init(gameConfig);
      
      // Carica gli asset di base
      try {
        await window.GameEngine.loadAssets('game-core');
        console.log('Asset base caricati con successo');
      } catch (assetError) {
        console.warn('Errore nel caricamento degli asset, usando fallback:', assetError);
      }
      
      // Imposta il nome utente e l'ID giocatore
      window.GameEngine.gameState.playerName = username;
      window.GameEngine.gameState.playerId = `local_${Math.random().toString(36).substr(2, 9)}`;
      
      // Crea il giocatore
      createLocalPlayer(username);
      
      // Crea punti energia iniziali
      createInitialEnergyPoints(20);
      
      // Inizia il gioco
      window.GameEngine.start();
      
      // Mostra messaggio di successo
      showMessage(`Benvenuto nel gioco, ${username}!`, 'success');
      
      console.log('Gioco inizializzato con successo');
      return true;
    } catch (error) {
      console.error('Errore critico nell\'inizializzazione del gioco:', error);
      showMessage(`Errore: ${error.message}`, 'error');
      return false;
    }
  }
  
  /**
   * Crea il giocatore locale
   * @param {string} username - Nome utente del giocatore
   */
  function createLocalPlayer(username) {
    const gameState = window.GameEngine.gameState;
    const assetManager = window.GameEngine.assetManager;
    
    // Posizione iniziale al centro del mondo
    const initialX = window.GameEngine.worldConfig.width / 2;
    const initialY = window.GameEngine.worldConfig.height / 2;
    
    // Crea container per il giocatore
    const playerContainer = new PIXI.Container();
    playerContainer.x = initialX;
    playerContainer.y = initialY;
    
    // Crea lo sprite del giocatore
    let playerSprite;
    
    // Cerca di usare la texture caricata
    if (assetManager.isLoaded('player')) {
      playerSprite = assetManager.createSprite('player');
      playerSprite.anchor.set(0.5);
      playerSprite.width = 30;
      playerSprite.height = 30;
      playerSprite.tint = 0x00ff88; // Colore verde per il giocatore locale
    } else {
      // Fallback: crea grafica
      console.log('Texture player non disponibile, creazione grafica fallback');
      playerSprite = new PIXI.Graphics();
      playerSprite.beginFill(0x00ff88, 0.8);
      playerSprite.drawCircle(0, 0, 15);
      playerSprite.endFill();
    }
    
    playerContainer.addChild(playerSprite);
    
    // Aggiungi nome utente
    const style = new PIXI.TextStyle({
      fontFamily: 'Arial',
      fontSize: 14,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 3,
      align: 'center'
    });
    
    const nameText = new PIXI.Text(username, style);
    nameText.anchor.set(0.5);
    nameText.y = -30;
    playerContainer.addChild(nameText);
    
    // Aggiungi al container dei giocatori
    gameState.containers.players.addChild(playerContainer);
    
    // Salva nella mappa dei giocatori
    gameState.players.set(gameState.playerId, {
      id: gameState.playerId,
      sprite: playerContainer,
      x: initialX,
      y: initialY,
      size: 30,
      name: username,
      score: 0,
      level: 1,
      isPlayer: true
    });
    
    console.log('Giocatore locale creato:', gameState.playerId);
  }
  
  /**
   * Crea i punti energia iniziali
   * @param {number} count - Numero di punti energia da creare
   */
  function createInitialEnergyPoints(count) {
    const gameState = window.GameEngine.gameState;
    const assetManager = window.GameEngine.assetManager;
    const worldWidth = window.GameEngine.worldConfig.width;
    const worldHeight = window.GameEngine.worldConfig.height;
    
    console.log(`Creazione di ${count} punti energia...`);
    
    for (let i = 0; i < count; i++) {
      // Posizione casuale
      const x = Math.random() * worldWidth;
      const y = Math.random() * worldHeight;
      
      // Crea container per il punto energia
      const energyContainer = new PIXI.Container();
      energyContainer.x = x;
      energyContainer.y = y;
      
      // Crea lo sprite del punto energia
      let energySprite;
      
      // Cerca di usare la texture caricata
      if (assetManager.isLoaded('energy')) {
        energySprite = assetManager.createSprite('energy');
        energySprite.anchor.set(0.5);
        energySprite.width = 15;
        energySprite.height = 15;
        energySprite.tint = 0x00ffff;
      } else {
        // Fallback: crea grafica
        console.log('Texture energia non disponibile, creazione grafica fallback');
        energySprite = new PIXI.Graphics();
        energySprite.beginFill(0x00ffff, 0.8);
        energySprite.drawCircle(0, 0, 7.5);
        energySprite.endFill();
      }
      
      energyContainer.addChild(energySprite);
      
      // Aggiungi effetto glow se disponibile
      try {
        if (PIXI.filters && PIXI.filters.GlowFilter) {
          const glowFilter = new PIXI.filters.GlowFilter({
            distance: 10,
            outerStrength: 1,
            innerStrength: 0.5,
            color: 0x00ffff,
            quality: 0.5
          });
          energyContainer.filters = [glowFilter];
        }
      } catch (filterError) {
        console.warn('Filtri non disponibili, glow non applicato:', filterError);
      }
      
      // Animazione fluttuante se disponibile
      if (window.anime) {
        window.anime({
          targets: energyContainer,
          y: y + 5,
          duration: 1500,
          easing: 'easeInOutSine',
          direction: 'alternate',
          loop: true
        });
      }
      
      // Aggiungi al container
      gameState.containers.energy.addChild(energyContainer);
      
      // Salva nella mappa dei punti energia
      const id = `energy_${i}`;
      gameState.energyPoints.set(id, {
        id: id,
        sprite: energyContainer,
        x: x,
        y: y,
        value: 10,
        isEnergy: true
      });
    }
    
    console.log(`Creati ${count} punti energia`);
  }
});

/**
 * Fornisce retro-compatibilità con il vecchio sistema, 
 * reindirizzando alla versione modulare
 */
window.initGame = async function(username) {
  console.warn('Chiamata a initGame() legacy. Utilizzare il sistema modulare.');
  
  // Nascondi schermata login e mostra il gioco
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('game-container').style.display = 'block';
  
  // Trova la funzione initGame nel contesto DOMContentLoaded
  const event = new Event('submit');
  const usernameInput = document.getElementById('username-input');
  
  if (usernameInput) {
    usernameInput.value = username;
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.dispatchEvent(event);
      return true;
    }
  }
  
  return false;
}; 