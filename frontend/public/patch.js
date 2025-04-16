/**
 * Questo file corregge gli errori nel progetto BrawlLite
 * - Uncaught SyntaxError: Identifier 'EnergySystem' has already been declared
 * - Uncaught ReferenceError: initGame is not defined
 */

// Fix per il problema della classe EnergySystem duplicata
// Viene eseguito prima che venga caricato app.js
(function() {
  // Verifica se app.js è già caricato
  const originalEnergySystem = window.EnergySystem;
  
  // Override della definizione delle classi duplicate
  Object.defineProperty(window, 'EnergySystem', {
    get: function() {
      return originalEnergySystem || function() { 
        console.log('EnergySystem proxy creato');
        this.init = function() { console.log('EnergySystem.init chiamato'); };
      };
    },
    set: function(newValue) {
      if (!originalEnergySystem) {
        Object.defineProperty(window, 'EnergySystem', {
          value: newValue,
          writable: false,
          configurable: true
        });
      } else {
        console.log('Tentativo di ridefinire EnergySystem ignorato');
      }
    },
    configurable: true
  });
  
  console.log('Patch per EnergySystem installata');
})();

// Fix per initGame non definito
window.initGame = function(username) {
  console.log('Funzione initGame chiamata con username:', username);
  
  // Metodo semplificato per inizializzare il gioco
  try {
    if (!username || username.trim() === '') {
      throw new Error('Nome utente non valido');
    }
    
    // Nascondi schermata login e mostra il gioco
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    // Inizializza PIXI
    if (typeof initPixiJS === 'function') {
      const success = initPixiJS();
      if (!success) {
        throw new Error('Inizializzazione PIXI fallita');
      }
    } else {
      throw new Error('initPixiJS non disponibile');
    }
    
    // Inizializza background
    if (typeof createBackground === 'function') {
      createBackground();
    }
    
    // Inizializza energia
    if (typeof initEnergyPoints === 'function') {
      initEnergyPoints();
    }
    
    // Inizializza controlli
    if (typeof setupControls === 'function') {
      setupControls();
    }
    
    // Collega al server
    if (typeof connectWebSocket === 'function') {
      connectWebSocket();
    }
    
    // Imposta nome giocatore
    window.playerName = username;
    
    console.log('Gioco inizializzato con successo');
    return true;
  } catch (error) {
    console.error('Errore inizializzazione gioco:', error);
    alert(`Errore inizializzazione: ${error.message}. Ricarica la pagina.`);
    return false;
  }
};

console.log('Patch.js caricato: correzioni applicate'); 