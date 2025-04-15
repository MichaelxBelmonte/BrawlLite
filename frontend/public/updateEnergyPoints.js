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
        if (!gameState.energyPoints[index]) return;
        
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
  }
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
  }
}