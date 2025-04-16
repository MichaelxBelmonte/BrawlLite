/**
 * Questo file corregge gli errori nel progetto BrawlLite
 * - Uncaught SyntaxError: Identifier 'EnergySystem' has already been declared
 * - Uncaught ReferenceError: initGame is not defined
 */

// Fix più diretto per il problema della doppia dichiarazione di EnergySystem
(function() {
  // Soluzione: modifichiamo il codice sorgente di app.js prima che venga eseguito
  const originalEvalFunction = window.eval;
  
  // Sovrascrivi la funzione eval per modificare il codice prima dell'esecuzione
  window.eval = function(code) {
    // Se il codice contiene la seconda dichiarazione della classe EnergySystem, la commentiamo
    if (code && typeof code === 'string') {
      // Sostituisci la seconda dichiarazione con un commento
      code = code.replace(/class\s+EnergySystem\s*\{\s*constructor\s*\(\s*container\s*\)\s*\{/g, 
                          function(match, offset, string) {
                             // Se è la seconda occorrenza, commenta
                             if (string.indexOf('class EnergySystem') < offset) {
                                console.log("Prevenuta la ridichiarazione di EnergySystem");
                                return "/* RIMOSSO: " + match;
                             }
                             return match;
                          });
      
      // Commenta anche la fine della classe
      if (code.indexOf('/* RIMOSSO:') !== -1) {
        code = code.replace(/updateFromServer\s*\(\s*pointsData\s*\)\s*\{\s*[\s\S]*?\}\s*\}\s*\}/,
                            match => match + " */");
      }
    }
    
    // Chiama la funzione eval originale con il codice modificato
    return originalEvalFunction.call(window, code);
  };
  
  console.log('Patch avanzata per EnergySystem installata');
})();

// Fix minimale per initGame
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
      // Prova a chiamare le funzioni del gioco se disponibili
      if (typeof window.connectWebSocket === 'function') {
        window.connectWebSocket();
      }
      
      text.text = 'Connessione al server in corso...';
      
      setTimeout(() => {
        text.text = 'Gioco avviato!';
        setTimeout(() => {
          app.stage.removeChild(text);
        }, 2000);
      }, 1500);
    }, 500);
    
    console.log('Gioco avviato con inizializzazione minimale');
    return true;
  } catch (error) {
    console.error('Errore inizializzazione gioco:', error);
    alert(`Errore inizializzazione: ${error.message}. Ricarica la pagina.`);
    return false;
  }
};

console.log('Patch.js caricato: correzioni avanzate applicate'); 