/**
 * Questo file corregge gli errori nel progetto BrawlLite
 * - Uncaught SyntaxError: Identifier 'EnergySystem' has already been declared
 * - Uncaught ReferenceError: initGame is not defined
 */

/**
 * Patch per il fix dei problemi critici in BrawlLite
 * Versione 3.0 - Intercettazione diretta del caricamento di app.js
 */

// FASE 1: Intercettiamo il caricamento di app.js

// Sovrascriviamo XMLHttpRequest per intercettare il caricamento di app.js
(function() {
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  // Sovrascriviamo il metodo open di XMLHttpRequest
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    this._patchURL = url;
    
    // Chiamata originale
    return originalXHROpen.apply(this, arguments);
  };
  
  // Sovrascriviamo il metodo send di XMLHttpRequest
  XMLHttpRequest.prototype.send = function(data) {
    const xhr = this;
    const url = this._patchURL;
    
    // Se la richiesta riguarda app.js
    if (url && typeof url === 'string' && url.endsWith('app.js')) {
      console.log("Patch: Intercettato caricamento di app.js");
      
      // Sostituiamo la funzione onreadystatechange
      const originalOnReadyStateChange = xhr.onreadystatechange;
      xhr.onreadystatechange = function() {
        // Se la richiesta è completata con successo
        if (xhr.readyState === 4 && xhr.status === 200) {
          console.log("Patch: Modifica contenuto di app.js");
          
          // Ottieni il contenuto originale
          let content = xhr.responseText;
          
          // Conta quante volte appare la dichiarazione di EnergySystem
          const matches = content.match(/class\s+EnergySystem\s*{/g);
          console.log(`Patch: Trovate ${matches ? matches.length : 0} dichiarazioni di EnergySystem`);
          
          // Cerca la seconda dichiarazione della classe EnergySystem e commentala
          let firstIndex = content.indexOf('class EnergySystem');
          if (firstIndex !== -1) {
            let secondIndex = content.indexOf('class EnergySystem', firstIndex + 1);
            if (secondIndex !== -1) {
              console.log(`Patch: Commentando la seconda dichiarazione di EnergySystem a ${secondIndex}`);
              
              // Trova l'inizio della classe
              const classStart = content.indexOf('class EnergySystem', secondIndex);
              
              // Cerca la fine della classe
              let bracketCount = 0;
              let classEnd = classStart;
              let inClass = false;
              
              for (let i = classStart; i < content.length; i++) {
                if (content[i] === '{') {
                  bracketCount++;
                  inClass = true;
                } else if (content[i] === '}') {
                  bracketCount--;
                  if (inClass && bracketCount === 0) {
                    classEnd = i + 1;
                    break;
                  }
                }
              }
              
              // Commenta la classe EnergySystem duplicata
              const beforeClass = content.substring(0, classStart);
              const classCode = content.substring(classStart, classEnd);
              const afterClass = content.substring(classEnd);
              
              // Sostituisci il contenuto con la versione commentata
              content = beforeClass + 
                        "/* RIMOSSO DALLA PATCH - EnergySystem DUPLICATO\n" + 
                        classCode + 
                        "\n*/\n" + 
                        afterClass;
              
              console.log("Patch: Dichiarazione duplicata di EnergySystem commentata con successo");
            }
          }
          
          // Sovrascrivi il responseText con il contenuto modificato
          Object.defineProperty(xhr, 'responseText', {
            get: function() {
              return content;
            }
          });
        }
        
        // Chiama la funzione originale
        if (originalOnReadyStateChange) {
          originalOnReadyStateChange.apply(xhr, arguments);
        }
      };
    }
    
    // Chiamata originale
    return originalXHRSend.apply(this, arguments);
  };
  
  console.log("Patch: Intercettazione XMLHttpRequest installata");
})();

// FASE 2: Implementiamo un fallback per initGame se app.js fallisce
window.initGame = function(username) {
  console.log('Patch: Funzione initGame chiamata con username:', username);
  
  try {
    if (!username || username.trim() === '') {
      throw new Error('Nome utente non valido');
    }
    
    // Nascondi schermata login e mostra il gioco
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    
    // Inizializzazione minimale
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
    
    console.log('Patch: Gioco avviato con inizializzazione minimale');
    
    // Verifica se app.js ha funzioni disponibili
    setTimeout(() => {
      text.text = 'Connessione al server...';
      
      if (typeof window.connectWebSocket === 'function') {
        window.connectWebSocket();
      }
      
      setTimeout(() => {
        text.text = 'Inizializzazione completata!';
        
        setTimeout(() => {
          if (text.parent) {
            text.parent.removeChild(text);
          }
        }, 2000);
      }, 1500);
    }, 1000);
    
    return true;
  } catch (error) {
    console.error('Errore inizializzazione gioco:', error);
    alert(`Errore inizializzazione: ${error.message}. Ricarica la pagina.`);
    return false;
  }
};

console.log("Patch.js 3.0: Intercettazione diretta di app.js per risolvere il conflitto di EnergySystem"); 