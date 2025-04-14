// Configurazione PixiJS
let app;
let socket;
let reconnectAttempts = 0;
const msgpack = window.msgpack5();

// Funzione per ottenere variabili d'ambiente
function getEnvVar(name, defaultValue) {
    // Usa direttamente il valore di default senza try/catch per import.meta
    return defaultValue;
}

// Variabili di configurazione
const PLAYER_SPEED = 5;
const INTERPOLATION_FACTOR = 0.3;
const WS_URL = getEnvVar('VITE_WS_URL', 'wss://brawl-legends-backend.onrender.com');
const MAX_ENERGY_POINTS = 30;  // Numero massimo di punti energia sulla mappa
const ENERGY_VALUE = 5;        // Valore di ogni punto energia
const INITIAL_SIZE = 20;       // Dimensione iniziale dei giocatori
const MAX_SIZE = 50;           // Dimensione massima raggiungibile (ridotta da 100)
const LEVEL_THRESHOLDS = [     // Soglie per livelli di evoluzione
    { level: 1, size: INITIAL_SIZE, name: "Novizio" },
    { level: 2, size: 30, name: "Guerriero", ability: "speed" },
    { level: 3, size: 40, name: "Campione", ability: "shield" },
    { level: 4, size: MAX_SIZE, name: "Leggenda", ability: "attack" }
];

// Stato del gioco
const gameState = {
    playerId: crypto.randomUUID(),
    players: new Map(),
    energyPoints: new Map(),  // Punti energia sulla mappa
    scores: new Map(),        // Punteggi dei giocatori
    abilities: {
        cooldowns: {
            speed: 0,
            shield: 0,
            attack: 0
        },
        active: {
            speed: false,
            shield: false
        }
    },
    level: 1,
    keys: {
        w: false,
        a: false,
        s: false,
        d: false
    },
    lastUpdate: Date.now(),
    lastPosition: { x: 0, y: 0 },
    projectiles: []
};

// Inizializza il gioco quando il DOM è completamente caricato
document.addEventListener('DOMContentLoaded', () => {
    // Inizializza PixiJS
    app = new PIXI.Application({
        width: 1280,
        height: 720,
        backgroundColor: 0x0a0a0a,
        resolution: window.devicePixelRatio || 1,
        antialias: true
    });
    document.getElementById('game-container').appendChild(app.view);
    
    // Inizializzazione del gioco quando l'utente inserisce il nome
    document.getElementById('start-button').addEventListener('click', () => {
        const username = document.getElementById('username-input').value.trim();
        if (username) {
            // Nascondi schermata di login
            document.getElementById('login-screen').style.display = 'none';
            // Mostra il contenitore di gioco
            document.getElementById('game-container').style.display = 'block';
            
            // Inizializza il gioco
            initGame(username);
        }
    });
    
    // Configura il ticker di gioco
    app.ticker.add((delta) => {
        updateMovement(delta);
        interpolateOtherPlayers();
        checkEnergyCollection();
        checkPlayerCollisions();
        updateHUD();
    });
});

// Funzione di inizializzazione del gioco
function initGame(username) {
    // Assicurati che app sia inizializzato
    if (!app) {
        console.error("PixiJS non è stato inizializzato correttamente");
        return;
    }
    
    // Crea il player locale
    const player = createPlayerSprite(gameState.playerId, true, INITIAL_SIZE);
    // Imposta il nome personalizzato
    player.children[2].text = username;
    
    // Aggiungi il player al gameState
    gameState.players.set(gameState.playerId, player);
    
    // Inizia la connessione WebSocket
    connectWebSocket();
    
    // Inizializza i punti energia
    initEnergyPoints();
}

// Funzione per creare uno sprite giocatore
function createPlayerSprite(playerId, isLocalPlayer = false, size = INITIAL_SIZE) {
    const container = new PIXI.Container();
    
    // Corpo principale
    const bodyColor = isLocalPlayer ? 0x00ff88 : 0xff4500;
    const body = new PIXI.Graphics();
    body.beginFill(bodyColor);
    body.drawCircle(0, 0, size);
    body.endFill();
    
    // Effetto glow
    const glow = new PIXI.Graphics();
    glow.beginFill(bodyColor, 0.3);
    glow.drawCircle(0, 0, size + 10);
    glow.endFill();
    
    // Nome giocatore (usa le prime 4 cifre dell'ID)
    const playerName = new PIXI.Text(playerId.substring(0, 4), {
        fontFamily: 'Arial',
        fontSize: 12,
        fill: 0xffffff,
        align: 'center'
    });
    playerName.anchor.set(0.5);
    playerName.y = -size - 15;
    
    // Aggiungi tutto al container
    container.addChild(glow);
    container.addChild(body);
    container.addChild(playerName);
    
    // Posizione iniziale casuale (usa valori predefiniti se app.screen non è disponibile)
    const screenWidth = (app && app.screen) ? app.screen.width : 1280;
    const screenHeight = (app && app.screen) ? app.screen.height : 720;
    
    container.x = Math.random() * (screenWidth - 100) + 50;
    container.y = Math.random() * (screenHeight - 100) + 50;
    container.targetX = container.x;
    container.targetY = container.y;
    container.size = size; // Memorizziamo la dimensione corrente
    container.score = 0;   // Punteggio iniziale
    
    // Aggiungi al display solo se app è inizializzato
    if (app && app.stage) {
        app.stage.addChild(container);
        
        // Aggiungi effetto "pulse" per il giocatore locale
        if (isLocalPlayer) {
            app.ticker.add(() => {
                const time = performance.now() / 1000;
                glow.scale.set(1 + Math.sin(time * 2) * 0.1);
            });
        }
    }
    
    return container;
}

// Imposta input da tastiera
window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() in gameState.keys) {
        gameState.keys[e.key.toLowerCase()] = true;
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() in gameState.keys) {
        gameState.keys[e.key.toLowerCase()] = false;
    }
});

// Movimento WASD con predizione lato client
function updateMovement(delta) {
    const player = gameState.players.get(gameState.playerId);
    
    // Verifica che il player esista prima di accedere alle sue proprietà
    if (!player) return;
    
    const prevX = player.x;
    const prevY = player.y;
    
    // Calcola la velocità base (modificata se speed boost è attivo)
    let speed = PLAYER_SPEED;
    if (gameState.abilities.active.speed) {
        speed = PLAYER_SPEED * 2; // Raddoppia la velocità con lo speed boost
    }
    
    // Applica movimento in base ai tasti premuti
    if (gameState.keys.w) player.y -= speed * delta;
    if (gameState.keys.a) player.x -= speed * delta;
    if (gameState.keys.s) player.y += speed * delta;
    if (gameState.keys.d) player.x += speed * delta;
    
    // Limita movimento all'interno dello schermo
    player.x = Math.max(20, Math.min(app.screen.width - 20, player.x));
    player.y = Math.max(20, Math.min(app.screen.height - 20, player.y));
    
    // Invia aggiornamenti solo se la posizione è cambiata
    const now = Date.now();
    if (now - gameState.lastUpdate > 50 && (prevX !== player.x || prevY !== player.y)) {
        gameState.lastUpdate = now;
        if (socket && socket.readyState === WebSocket.OPEN) {
            // Calcola delta rispetto all'ultima posizione
            const deltaX = Math.round(player.x - gameState.lastPosition.x);
            const deltaY = Math.round(player.y - gameState.lastPosition.y);
            
            // Aggiorna l'ultima posizione inviata
            gameState.lastPosition.x = player.x;
            gameState.lastPosition.y = player.y;
            
            // Invia solo i delta per ottimizzare
            socket.send(msgpack.encode({
                type: 'move',
                id: gameState.playerId,
                dx: deltaX,
                dy: deltaY,
                x: Math.round(player.x),  // Invia anche la posizione assoluta per sicurezza
                y: Math.round(player.y)
            }));
        }
    }
}

// Funzione per interpolare il movimento di altri giocatori
function interpolateOtherPlayers() {
    gameState.players.forEach((sprite, id) => {
        if (id !== gameState.playerId && sprite && sprite.targetX !== undefined) {
            sprite.x += (sprite.targetX - sprite.x) * INTERPOLATION_FACTOR;
            sprite.y += (sprite.targetY - sprite.y) * INTERPOLATION_FACTOR;
        }
    });
}

// Funzione per aggiornare l'HUD
function updateHUD() {
    const player = gameState.players.get(gameState.playerId);
    if (player) {
        // Aggiorna livello
        const levelElement = document.getElementById('player-level');
        if (levelElement) {
            levelElement.textContent = `Livello: ${gameState.level}`;
        }
        
        // Aggiorna dimensione
        const sizeElement = document.getElementById('player-size');
        if (sizeElement) {
            sizeElement.textContent = `Dimensione: ${Math.round(player.size)}`;
        }
        
        // Aggiorna punteggio
        const scoreElement = document.getElementById('player-score');
        if (scoreElement) {
            scoreElement.textContent = `Punteggio: ${player.score || 0}`;
        }
    }
    
    // Aggiorna classifica
    updateLeaderboard();
}

// Aggiungi effetto di sfondo
function createBackgroundEffect() {
    // Crea 50 particelle di sfondo
    for (let i = 0; i < 50; i++) {
        const particle = document.createElement('div');
        particle.classList.add('particle');
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.top = `${Math.random() * 100}%`;
        particle.style.opacity = Math.random() * 0.5 + 0.2;
        document.body.appendChild(particle);
        
        // Animazione casuale
        anime({
            targets: particle,
            translateX: anime.random(-100, 100),
            translateY: anime.random(-100, 100),
            scale: [0.1, 0.6],
            opacity: [0.4, 0.2],
            duration: anime.random(5000, 10000),
            easing: 'easeInOutSine',
            complete: () => {
                document.body.removeChild(particle);
                createParticle();
            }
        });
    }
}

// Creiamo particelle singole per sostituire quelle che scompaiono
function createParticle() {
    const particle = document.createElement('div');
    particle.classList.add('particle');
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.top = `${Math.random() * 100}%`;
    particle.style.opacity = Math.random() * 0.5 + 0.2;
    document.body.appendChild(particle);
    
    anime({
        targets: particle,
        translateX: anime.random(-100, 100),
        translateY: anime.random(-100, 100),
        scale: [0.1, 0.6],
        opacity: [0.4, 0.2],
        duration: anime.random(5000, 10000),
        easing: 'easeInOutSine',
        complete: () => {
            document.body.removeChild(particle);
            createParticle();
        }
    });
}

// Connessione WebSocket
function connectWebSocket() {
    console.log("Tentativo di connessione WebSocket a:", WS_URL);
    socket = new WebSocket(WS_URL);
    
    socket.binaryType = 'arraybuffer';
    
    socket.onopen = () => {
        console.log('Connessione WebSocket stabilita');
        
        // Assicurati che il giocatore locale sia inizializzato
        if (!gameState.players.has(gameState.playerId)) {
            const localPlayer = createPlayerSprite(gameState.playerId, true);
            gameState.players.set(gameState.playerId, localPlayer);
            gameState.lastPosition = { x: localPlayer.x, y: localPlayer.y };
        }
        
        // Invia il primo messaggio di join con posizione iniziale
        const localPlayer = gameState.players.get(gameState.playerId);
        socket.send(msgpack.encode({
            type: 'join',
            id: gameState.playerId,
            x: Math.round(localPlayer.x),
            y: Math.round(localPlayer.y)
        }));
        
        // Resetta i tentativi di riconnessione
        reconnectAttempts = 0;
    };
    
    socket.onmessage = (event) => {
        try {
            const data = msgpack.decode(new Uint8Array(event.data));
            
            switch(data.type) {
                case 'state':
                    // Aggiorna le posizioni di tutti i giocatori
                    data.players.forEach(player => {
                        if (player.id !== gameState.playerId) {
                            if (!gameState.players.has(player.id)) {
                                // Crea nuovo sprite per giocatori che non esistono ancora
                                gameState.players.set(player.id, createPlayerSprite(player.id));
                            }
                            
                            // Aggiorna la posizione target per l'interpolazione
                            const sprite = gameState.players.get(player.id);
                            sprite.targetX = player.x;
                            sprite.targetY = player.y;
                        }
                    });
                    
                    // Rimuovi giocatori che non sono più presenti
                    const activePlayers = new Set(data.players.map(p => p.id));
                    [...gameState.players.keys()].forEach(id => {
                        if (!activePlayers.has(id) && id !== gameState.playerId) {
                            app.stage.removeChild(gameState.players.get(id));
                            gameState.players.delete(id);
                        }
                    });
                    break;
                    
                case 'join':
                    if (data.id !== gameState.playerId && !gameState.players.has(data.id)) {
                        const newPlayer = createPlayerSprite(data.id);
                        newPlayer.x = data.x;
                        newPlayer.y = data.y;
                        newPlayer.targetX = data.x;
                        newPlayer.targetY = data.y;
                        gameState.players.set(data.id, newPlayer);
                    }
                    break;
                    
                case 'move':
                    if (data.id !== gameState.playerId && gameState.players.has(data.id)) {
                        const sprite = gameState.players.get(data.id);
                        // Usa x,y assoluti se disponibili, altrimenti calcola dai delta
                        if (data.x !== undefined) {
                            sprite.targetX = data.x;
                            sprite.targetY = data.y;
                        } else {
                            sprite.targetX = sprite.targetX + data.dx;
                            sprite.targetY = sprite.targetY + data.dy;
                        }
                    }
                    break;
                    
                case 'leave':
                    if (gameState.players.has(data.id)) {
                        app.stage.removeChild(gameState.players.get(data.id));
                        gameState.players.delete(data.id);
                    }
                    break;
            }
        } catch (error) {
            console.error('Errore nel parsing del messaggio:', error);
        }
    };
    
    socket.onclose = () => {
        console.log('Connessione WebSocket chiusa');
        // Tenta la riconnessione con backoff esponenziale
        const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
        reconnectAttempts++;
        
        setTimeout(() => {
            connectWebSocket();
        }, delay);
    };
    
    socket.onerror = (error) => {
        console.error('Errore WebSocket:', error);
        // Mostra un messaggio più descrittivo
        const errorBox = document.createElement('div');
        errorBox.style.position = 'fixed';
        errorBox.style.top = '10px';
        errorBox.style.left = '50%';
        errorBox.style.transform = 'translateX(-50%)';
        errorBox.style.padding = '10px 20px';
        errorBox.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
        errorBox.style.color = 'white';
        errorBox.style.borderRadius = '5px';
        errorBox.style.zIndex = '1000';
        errorBox.textContent = `Errore di connessione al server: ${WS_URL}. Verifica la console per dettagli.`;
        document.body.appendChild(errorBox);
    };
}

// Aggiorna la classifica dei giocatori
function updateLeaderboard() {
    const leaderboardElement = document.getElementById('leaderboard-list');
    if (!leaderboardElement) return;
    
    // Crea un array di giocatori con punteggi
    const players = [];
    gameState.players.forEach((player, id) => {
        players.push({
            id: id.substring(0, 4), // Usa solo le prime 4 cifre dell'id
            score: player.score || 0,
            isLocal: id === gameState.playerId
        });
    });
    
    // Ordina i giocatori per punteggio
    players.sort((a, b) => b.score - a.score);
    
    // Limita a massimo 5 giocatori
    const topPlayers = players.slice(0, 5);
    
    // Svuota la classifica
    leaderboardElement.innerHTML = '';
    
    // Aggiungi ogni giocatore alla classifica
    topPlayers.forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        if (player.isLocal) {
            item.classList.add('local-player');
        }
        
        item.textContent = `${index + 1}. ${player.id} - ${player.score}`;
        leaderboardElement.appendChild(item);
    });
}

// Inizializza gli effetti di sfondo (se anime.js è disponibile)
if (typeof anime !== 'undefined') {
    createBackgroundEffect();
} else {
    console.log('anime.js non disponibile, effetti di sfondo disabilitati');
}

// Carica libreria GSAP
if (typeof gsap === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.11.5/gsap.min.js';
    script.onload = () => {
        console.log('GSAP caricato con successo');
    };
    document.head.appendChild(script);
}

// Avvia il gioco quando tutto è pronto
window.addEventListener('load', () => {
    console.log('Gioco inizializzato...');
    
    // Aggiungi il messaggio iniziale
    const startMessage = document.createElement('div');
    startMessage.id = 'start-message';
    startMessage.innerHTML = `
        <h2>Brawl Legends</h2>
        <p>Raccogli i punti energia gialli per crescere<br>
        Diventa abbastanza grande per mangiare gli altri giocatori!</p>
        <div class="start-button">Inizia a Giocare</div>
    `;
    document.body.appendChild(startMessage);
    
    // Aggiungi evento click al pulsante
    const startButton = startMessage.querySelector('.start-button');
    startButton.addEventListener('click', () => {
        startMessage.style.opacity = '0';
        setTimeout(() => {
            startMessage.remove();
        }, 500);
    });
});

// Effetto visivo di level up
function createLevelUpEffect(x, y, level) {
    // Crea particelle colorate in base al livello
    const colors = [0xffffff, 0x00ffff, 0xffff00, 0xffd700];
    const color = colors[level - 1] || 0xffffff;
    
    for (let i = 0; i < 30; i++) {
        const particle = new PIXI.Graphics();
        particle.beginFill(color);
        particle.drawCircle(0, 0, Math.random() * 4 + 2);
        particle.endFill();
        particle.x = x;
        particle.y = y;
        app.stage.addChild(particle);
        
        // Animazione esplosiva
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 150 + 50;
        const duration = Math.random() * 1 + 0.5;
        
        gsap.to(particle, {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            alpha: 0,
            duration: duration,
            ease: "power2.out",
            onComplete: () => {
                app.stage.removeChild(particle);
            }
        });
    }
    
    // Onda d'urto
    const shockwave = new PIXI.Graphics();
    shockwave.lineStyle(2, color, 1);
    shockwave.drawCircle(0, 0, 10);
    shockwave.x = x;
    shockwave.y = y;
    app.stage.addChild(shockwave);
    
    gsap.to(shockwave, {
        pixi: { scale: 10 },
        alpha: 0,
        duration: 1,
        ease: "power2.out",
        onComplete: () => {
            app.stage.removeChild(shockwave);
        }
    });
}

// Attiva un'abilità speciale
function activateAbility(ability) {
    const now = Date.now();
    const cooldown = gameState.abilities.cooldowns[ability] || 0;
    
    // Controlla se l'abilità è in cooldown
    if (now < cooldown) {
        const remainingSeconds = Math.ceil((cooldown - now) / 1000);
        showMessage(`${getAbilityName(ability)} in ricarica (${remainingSeconds}s)`, 'warning');
        return;
    }
    
    // Esegue l'abilità in base al tipo
    switch(ability) {
        case 'speed':
            activateSpeedBoost();
            break;
        case 'shield':
            activateShield();
            break;
        case 'attack':
            fireAttack();
            break;
    }
}

// Abilità: Boost di velocità
function activateSpeedBoost() {
    const player = gameState.players.get(gameState.playerId);
    if (!player) return;
    
    // Durata e cooldown
    const duration = 3000; // 3 secondi
    const cooldownTime = 10000; // 10 secondi
    
    // Imposta il cooldown
    gameState.abilities.cooldowns.speed = Date.now() + cooldownTime;
    gameState.abilities.active.speed = true;
    
    // Mostra messaggio
    showMessage('Scatto Turbo attivato!', 'ability');
    
    // Crea effetto visivo
    const trail = createSpeedEffect(player);
    
    // Termina dopo la durata
    setTimeout(() => {
        gameState.abilities.active.speed = false;
        showMessage('Scatto Turbo terminato', 'info');
        
        // Rimuovi effetto visivo
        if (trail && trail.parent) {
            app.stage.removeChild(trail);
        }
    }, duration);
}

// Crea effetto visivo per il boost di velocità
function createSpeedEffect(player) {
    const trail = new PIXI.Graphics();
    app.stage.addChildAt(trail, 0); // Sotto il player
    
    // Aggiungi al ticker per aggiornare la scia
    const trailPoints = [];
    const trailLength = 20;
    
    const trailTicker = app.ticker.add(() => {
        // Aggiorna punti della scia
        trailPoints.unshift({ x: player.x, y: player.y });
        
        // Limita lunghezza
        if (trailPoints.length > trailLength) {
            trailPoints.pop();
        }
        
        // Disegna la scia
        trail.clear();
        
        for (let i = 0; i < trailPoints.length - 1; i++) {
            const alpha = 1 - (i / trailLength);
            const width = (trailLength - i) * 0.5;
            
            trail.lineStyle(width, 0x00ffff, alpha * 0.7);
            trail.moveTo(trailPoints[i].x, trailPoints[i].y);
            trail.lineTo(trailPoints[i+1].x, trailPoints[i+1].y);
        }
        
        // Rimuovi ticker se l'abilità non è più attiva
        if (!gameState.abilities.active.speed) {
            app.ticker.remove(trailTicker);
        }
    });
    
    return trail;
}

// Abilità: Scudo protettivo
function activateShield() {
    const player = gameState.players.get(gameState.playerId);
    if (!player) return;
    
    // Durata e cooldown
    const duration = 5000; // 5 secondi
    const cooldownTime = 15000; // 15 secondi
    
    // Imposta il cooldown
    gameState.abilities.cooldowns.shield = Date.now() + cooldownTime;
    gameState.abilities.active.shield = true;
    
    // Mostra messaggio
    showMessage('Scudo Energetico attivato!', 'ability');
    
    // Crea effetto visivo
    const shield = createShieldEffect(player);
    
    // Termina dopo la durata
    setTimeout(() => {
        gameState.abilities.active.shield = false;
        showMessage('Scudo Energetico terminato', 'info');
        
        // Rimuovi effetto visivo
        if (shield && shield.parent) {
            gsap.to(shield, {
                alpha: 0,
                duration: 0.5,
                onComplete: () => {
                    if (shield.parent) {
                        shield.parent.removeChild(shield);
                    }
                }
            });
        }
    }, duration);
}

// Crea effetto visivo per lo scudo
function createShieldEffect(player) {
    const shield = new PIXI.Graphics();
    shield.beginFill(0x3366ff, 0.2);
    shield.lineStyle(3, 0x3366ff, 0.8);
    shield.drawCircle(0, 0, player.size * 1.5);
    shield.endFill();
    
    player.addChild(shield);
    
    // Animazione pulsante
    gsap.to(shield, {
        alpha: 0.5,
        duration: 0.8,
        repeat: -1,
        yoyo: true
    });
    
    return shield;
}

// Abilità: Attacco a distanza
function fireAttack() {
    const player = gameState.players.get(gameState.playerId);
    if (!player) return;
    
    // Cooldown dell'attacco
    const cooldownTime = 3000; // 3 secondi
    
    // Imposta il cooldown
    gameState.abilities.cooldowns.attack = Date.now() + cooldownTime;
    
    // Mostra messaggio
    showMessage('Raggio Letale!', 'ability');
    
    // Ottieni la direzione in base ai tasti premuti
    let direction = { x: 0, y: 0 };
    
    if (gameState.keys.w) direction.y = -1;
    if (gameState.keys.a) direction.x = -1;
    if (gameState.keys.s) direction.y = 1;
    if (gameState.keys.d) direction.x = 1;
    
    // Normalizza la direzione
    const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    if (length > 0) {
        direction.x /= length;
        direction.y /= length;
    } else {
        // Se non ci sono tasti direzionali premuti, spara verso destra
        direction.x = 1;
    }
    
    // Crea il proiettile
    createProjectile(player, direction);
    
    // Invia al server
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(msgpack.encode({
            type: 'attack',
            id: gameState.playerId,
            x: player.x,
            y: player.y,
            dirX: direction.x,
            dirY: direction.y
        }));
    }
}

// Crea un proiettile
function createProjectile(player, direction) {
    // Crea il proiettile
    const projectile = new PIXI.Graphics();
    projectile.beginFill(0xff3366);
    projectile.drawCircle(0, 0, 8);
    projectile.endFill();
    
    // Aggiungi una scia luminosa
    const trail = new PIXI.Graphics();
    trail.beginFill(0xff3366, 0.3);
    trail.drawCircle(0, 0, 12);
    trail.endFill();
    
    // Crea un container
    const container = new PIXI.Container();
    container.addChild(trail);
    container.addChild(projectile);
    
    // Posiziona il proiettile davanti al giocatore
    container.x = player.x + direction.x * (player.size + 10);
    container.y = player.y + direction.y * (player.size + 10);
    container.vx = direction.x * 10; // Velocità del proiettile
    container.vy = direction.y * 10;
    container.damage = 20; // Danno del proiettile
    container.ownerId = gameState.playerId; // Chi ha sparato
    
    // Aggiungi alla scena
    app.stage.addChild(container);
    
    // Registra nel gameState se necessario
    if (!gameState.projectiles) {
        gameState.projectiles = [];
    }
    gameState.projectiles.push(container);
    
    // Effetto di lancio
    createProjectileLaunchEffect(player, direction);
    
    // Anima il proiettile
    animateProjectile(container);
}

// Effetto visivo per il lancio del proiettile
function createProjectileLaunchEffect(player, direction) {
    const startX = player.x;
    const startY = player.y;
    
    // Flash sul giocatore
    const flash = new PIXI.Graphics();
    flash.beginFill(0xff3366, 0.5);
    flash.drawCircle(0, 0, player.size * 1.2);
    flash.endFill();
    flash.x = startX;
    flash.y = startY;
    app.stage.addChild(flash);
    
    gsap.to(flash, {
        alpha: 0,
        pixi: { scale: 1.5 },
        duration: 0.3,
        onComplete: () => {
            app.stage.removeChild(flash);
        }
    });
}

// Anima un proiettile
function animateProjectile(projectile) {
    // Effetto pulse sulla scia
    gsap.to(projectile.children[0], {
        alpha: 0.1,
        duration: 0.3,
        repeat: -1,
        yoyo: true
    });
    
    // Ticker per il movimento
    const ticker = app.ticker.add(() => {
        // Muovi il proiettile
        projectile.x += projectile.vx;
        projectile.y += projectile.vy;
        
        // Controlla collisioni con altri giocatori
        checkProjectileCollisions(projectile);
        
        // Rimuovi se fuori schermo
        if (projectile.x < -50 || projectile.x > app.screen.width + 50 ||
            projectile.y < -50 || projectile.y > app.screen.height + 50) {
            app.stage.removeChild(projectile);
            app.ticker.remove(ticker);
            
            // Rimuovi dalla lista
            if (gameState.projectiles) {
                const index = gameState.projectiles.indexOf(projectile);
                if (index > -1) {
                    gameState.projectiles.splice(index, 1);
                }
            }
        }
    });
}

// Controlla se un proiettile colpisce altri giocatori
function checkProjectileCollisions(projectile) {
    // Non colpire il proprio giocatore
    gameState.players.forEach((player, id) => {
        if (id !== projectile.ownerId) {
            const dx = projectile.x - player.x;
            const dy = projectile.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Se il proiettile colpisce un giocatore
            if (distance < player.size + 8) {
                // Crea effetto visivo di impatto
                createImpactEffect(projectile.x, projectile.y);
                
                // Rimuovi il proiettile
                app.stage.removeChild(projectile);
                const index = gameState.projectiles.indexOf(projectile);
                if (index > -1) {
                    gameState.projectiles.splice(index, 1);
                }
                
                // Invia hit al server
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(msgpack.encode({
                        type: 'hit',
                        id: projectile.ownerId,
                        targetId: id,
                        damage: projectile.damage
                    }));
                }
            }
        }
    });
}

// Crea effetto di impatto
function createImpactEffect(x, y) {
    // Flash circolare
    const impact = new PIXI.Graphics();
    impact.beginFill(0xff3366, 0.7);
    impact.drawCircle(0, 0, 15);
    impact.endFill();
    impact.x = x;
    impact.y = y;
    app.stage.addChild(impact);
    
    // Particelle di impatto
    for (let i = 0; i < 10; i++) {
        const particle = new PIXI.Graphics();
        particle.beginFill(0xff3366);
        particle.drawCircle(0, 0, Math.random() * 3 + 1);
        particle.endFill();
        particle.x = x;
        particle.y = y;
        app.stage.addChild(particle);
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 30 + 10;
        const duration = Math.random() * 0.5 + 0.2;
        
        gsap.to(particle, {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            alpha: 0,
            duration: duration,
            onComplete: () => {
                app.stage.removeChild(particle);
            }
        });
    }
    
    // Anima e rimuovi il flash
    gsap.to(impact, {
        alpha: 0,
        pixi: { scale: 3 },
        duration: 0.4,
        onComplete: () => {
            app.stage.removeChild(impact);
        }
    });
}

// Mostra un messaggio a schermo
function showMessage(text, type = 'info') {
    const message = document.createElement('div');
    message.className = `game-message ${type}`;
    message.textContent = text;
    
    document.body.appendChild(message);
    
    // Animazione
    gsap.fromTo(message, 
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.3 }
    );
    
    // Rimuovi dopo un po'
    setTimeout(() => {
        gsap.to(message, {
            y: -20, opacity: 0, duration: 0.3,
            onComplete: () => message.remove()
        });
    }, 2000);
}

// Funzione per inizializzare i punti energia
function initEnergyPoints() {
    // Verifica che app sia inizializzato
    if (!app || !app.stage) {
        console.error("PixiJS non è stato inizializzato correttamente");
        return;
    }
    
    // Crea punti energia iniziali
    for (let i = 0; i < MAX_ENERGY_POINTS; i++) {
        spawnEnergyPoint();
    }
    
    // Imposta un timer per generare nuovi punti energia
    setInterval(() => {
        if (gameState.energyPoints.size < MAX_ENERGY_POINTS) {
            spawnEnergyPoint();
        }
    }, 2000);
}

// Crea un nuovo punto energia
function spawnEnergyPoint() {
    // Verifica che app sia inizializzato
    if (!app || !app.stage || !app.screen) {
        console.error("PixiJS non è stato inizializzato correttamente");
        return null;
    }
    
    const id = crypto.randomUUID();
    const x = Math.random() * (app.screen.width - 100) + 50;
    const y = Math.random() * (app.screen.height - 100) + 50;
    
    // Crea lo sprite del punto energia
    const energyPoint = new PIXI.Graphics();
    energyPoint.beginFill(0x00ffff);
    energyPoint.drawCircle(0, 0, 8);
    energyPoint.endFill();
    
    // Aggiungi un effetto glow
    const glow = new PIXI.Graphics();
    glow.beginFill(0x00ffff, 0.3);
    glow.drawCircle(0, 0, 12);
    glow.endFill();
    
    // Crea un container
    const container = new PIXI.Container();
    container.addChild(glow);
    container.addChild(energyPoint);
    container.x = x;
    container.y = y;
    container.value = ENERGY_VALUE;
    
    // Aggiungi al gioco
    app.stage.addChild(container);
    gameState.energyPoints.set(id, container);
    
    // Aggiungi animazione pulse
    gsap.to(container.scale, {
        x: 1.2,
        y: 1.2,
        duration: 0.8,
        repeat: -1,
        yoyo: true
    });
    
    return container;
}

// Restituisce il nome dell'abilità
function getAbilityName(ability) {
    switch(ability) {
        case 'speed': return 'Scatto Turbo';
        case 'shield': return 'Scudo Energetico';
        case 'attack': return 'Raggio Letale';
        default: return ability;
    }
}

// Restituisce il tasto per attivare l'abilità
function getAbilityKey(ability) {
    switch(ability) {
        case 'speed': return 'q';
        case 'shield': return 'e';
        case 'attack': return 'spazio';
        default: return '?';
    }
}

// Restituisce il livello minimo per l'abilità
function getAbilityMinLevel(ability) {
    const threshold = LEVEL_THRESHOLDS.find(t => t.ability === ability);
    return threshold ? threshold.level : 999;
}

// Aggiorna l'aspetto del giocatore in base al livello
function updatePlayerAppearance(player, oldLevel, newLevel) {
    // Rimuove vecchi elementi visivi
    while (player.children.length > 3) { // Mantiene corpo, glow e nome
        player.removeChildAt(3);
    }
    
    // Aggiunge elementi visivi in base al livello
    if (newLevel >= 2) {
        // Livello 2: Aura speciale
        const aura = new PIXI.Graphics();
        aura.beginFill(0x00ffff, 0.2);
        aura.drawCircle(0, 0, player.size + 15);
        aura.endFill();
        player.addChildAt(aura, 0); // Sotto a tutto
        
        // Animazione pulsante
        gsap.to(aura, {
            alpha: 0.4,
            duration: 1,
            yoyo: true,
            repeat: -1
        });
    }
    
    if (newLevel >= 3) {
        // Livello 3: Particelle orbitanti
        for (let i = 0; i < 3; i++) {
            const orbit = Math.random() * 20 + player.size + 5;
            const particle = new PIXI.Graphics();
            particle.beginFill(0xffff00);
            particle.drawCircle(0, 0, 3);
            particle.endFill();
            particle.x = orbit;
            particle.y = 0;
            player.addChild(particle);
            
            // Orbita attorno al giocatore
            gsap.to(particle, {
                duration: Math.random() * 3 + 2,
                repeat: -1,
                ease: "none",
                onUpdate: function() {
                    const angle = this.progress() * Math.PI * 2 + (i * Math.PI * 2 / 3);
                    particle.x = Math.cos(angle) * orbit;
                    particle.y = Math.sin(angle) * orbit;
                }
            });
        }
    }
    
    if (newLevel >= 4) {
        // Livello 4: Corona/effetto speciale
        const crown = new PIXI.Graphics();
        crown.beginFill(0xffd700);
        
        // Disegna una corona stilizzata
        crown.moveTo(-15, -player.size - 10);
        crown.lineTo(-10, -player.size - 20);
        crown.lineTo(-5, -player.size - 10);
        crown.lineTo(0, -player.size - 20);
        crown.lineTo(5, -player.size - 10);
        crown.lineTo(10, -player.size - 20);
        crown.lineTo(15, -player.size - 10);
        crown.lineTo(15, -player.size - 5);
        crown.lineTo(-15, -player.size - 5);
        crown.closePath();
        
        crown.endFill();
        player.addChild(crown);
    }
    
    // Animazione di level up
    gsap.to(player.scale, {
        x: player.scale.x * 1.2,
        y: player.scale.y * 1.2,
        duration: 0.3,
        yoyo: true,
        repeat: 1
    });
    
    // Effetto particellare di level up
    createLevelUpEffect(player.x, player.y, newLevel);
}

// Aggiorna la dimensione di un giocatore
function updatePlayerSize(player, newSize) {
    player.size = newSize;
    
    // Aggiorna dimensione visiva
    // Nota: in una implementazione reale, dovremmo ricreare la grafica 
    // invece di usare scale, per semplicità usiamo scale qui
    const scaleRatio = newSize / INITIAL_SIZE;
    player.scale.set(scaleRatio);
    
    // Aggiorna la posizione del nome
    const nameText = player.children[2]; // Assume che il nome sia il terzo figlio
    if (nameText) {
        nameText.y = -newSize - 15;
    }
}

// Crea effetto visivo per la raccolta di energia
function createCollectEffect(x, y) {
    // Crea particelle
    for (let i = 0; i < 8; i++) {
        const particle = new PIXI.Graphics();
        particle.beginFill(0xffff00);
        particle.drawCircle(0, 0, 3);
        particle.endFill();
        particle.x = x;
        particle.y = y;
        app.stage.addChild(particle);
        
        // Anima particelle in direzioni casuali
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 40 + 20;
        const duration = Math.random() * 500 + 500;
        
        gsap.to(particle, {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            alpha: 0,
            duration: duration / 1000,
            onComplete: () => {
                app.stage.removeChild(particle);
            }
        });
    }
}

// Controlla se un giocatore può mangiare un altro
function checkPlayerCollisions() {
    const player = gameState.players.get(gameState.playerId);
    if (!player) return;
    
    gameState.players.forEach((otherPlayer, id) => {
        // Salta il nostro giocatore
        if (id === gameState.playerId) return;
        
        // Calcola distanza
        const dx = player.x - otherPlayer.x;
        const dy = player.y - otherPlayer.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Un giocatore può mangiare un altro se è almeno 30% più grande
        if (distance < player.size && player.size > otherPlayer.size * 1.3) {
            eatPlayer(player, otherPlayer, id);
        }
    });
}

// Funzione per "mangiare" un altro giocatore
function eatPlayer(player, otherPlayer, otherId) {
    // Incrementa punteggio in base alle dimensioni dell'avversario
    const scoreGain = Math.round(otherPlayer.size * 0.5);
    player.score += scoreGain;
    
    // Incrementa dimensione
    const newSize = Math.min(player.size + Math.round(otherPlayer.size * 0.2), MAX_SIZE);
    updatePlayerSize(player, newSize);
    
    // Crea effetto visivo
    createEatEffect(otherPlayer.x, otherPlayer.y);
    
    // Invia messaggio al server
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(msgpack.encode({
            type: 'eat',
            id: gameState.playerId,
            target: otherId,
            score: player.score,
            size: player.size
        }));
    }
}

// Crea effetto visivo per mangiare un giocatore
function createEatEffect(x, y) {
    // Simile all'effetto di raccolta energia ma più grande
    for (let i = 0; i < 15; i++) {
        const particle = new PIXI.Graphics();
        particle.beginFill(0xff6600);
        particle.drawCircle(0, 0, 5);
        particle.endFill();
        particle.x = x;
        particle.y = y;
        app.stage.addChild(particle);
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * 60 + 30;
        const duration = Math.random() * 700 + 300;
        
        gsap.to(particle, {
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance,
            alpha: 0,
            duration: duration / 1000,
            onComplete: () => {
                app.stage.removeChild(particle);
            }
        });
    }
}

// Funzione per controllare se un giocatore ha raccolto energia
function checkEnergyCollection() {
    const player = gameState.players.get(gameState.playerId);
    if (!player) return;
    
    gameState.energyPoints.forEach((energyPoint, id) => {
        // Calcola distanza
        const dx = player.x - energyPoint.x;
        const dy = player.y - energyPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Se il giocatore tocca l'energia, la raccoglie
        if (distance < player.size) {
            collectEnergy(player, energyPoint, id);
        }
    });
}

// Raccogli energia e aggiorna il punteggio
function collectEnergy(player, energyPoint, energyId) {
    // Aggiorna punteggio
    player.score += energyPoint.value;
    gameState.scores.set(gameState.playerId, player.score);
    
    // Aumenta dimensione del giocatore (con limite massimo)
    const newSize = Math.min(player.size + 1, MAX_SIZE);
    updatePlayerSize(player, newSize);
    
    // Controlla se il giocatore è salito di livello
    checkLevelUp(player);
    
    // Rimuovi il punto energia
    app.stage.removeChild(energyPoint);
    gameState.energyPoints.delete(energyId);
    
    // Crea un effetto visivo per la raccolta
    createCollectEffect(energyPoint.x, energyPoint.y);
    
    // Invia l'aggiornamento al server
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(msgpack.encode({
            type: 'score',
            id: gameState.playerId,
            score: player.score,
            size: player.size,
            level: gameState.level
        }));
    }
}

// Mostra un messaggio di level up
function showLevelUpMessage(rank, ability) {
    const message = document.createElement('div');
    message.className = 'level-up-message';
    message.innerHTML = `
        <div class="level-title">Livello Aumentato!</div>
        <div class="level-rank">Sei diventato: ${rank}</div>
        ${ability ? `<div class="level-ability">Nuova abilità: ${getAbilityName(ability)}</div>` : ''}
        ${ability ? `<div class="level-key">Premi [${getAbilityKey(ability)}] per usarla</div>` : ''}
    `;
    
    document.body.appendChild(message);
    
    // Animazione di comparsa e scomparsa
    gsap.fromTo(message, 
        { y: -50, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, ease: "back.out" }
    );
    
    setTimeout(() => {
        gsap.to(message, {
            y: 50, opacity: 0, duration: 0.5, ease: "back.in",
            onComplete: () => message.remove()
        });
    }, 3000);
}

// Sblocca una nuova abilità
function unlockAbility(ability) {
    // Aggiunge l'event listener per il tasto corrispondente
    if (!window[`${ability}KeyHandler`]) {
        window[`${ability}KeyHandler`] = true;
        
        window.addEventListener('keydown', (e) => {
            const key = getAbilityKey(ability);
            if (e.key.toLowerCase() === key && gameState.level >= getAbilityMinLevel(ability)) {
                activateAbility(ability);
            }
        });
    }
}

// Controlla se il giocatore è salito di livello
function checkLevelUp(player) {
    // Trova il livello corrispondente alla dimensione attuale
    let newLevel = 1;
    for (const threshold of LEVEL_THRESHOLDS) {
        if (player.size >= threshold.size) {
            newLevel = threshold.level;
        } else {
            break;
        }
    }
    
    // Se è salito di livello
    if (newLevel > gameState.level) {
        const oldLevel = gameState.level;
        gameState.level = newLevel;
        
        // Trova informazioni sul nuovo livello
        const levelInfo = LEVEL_THRESHOLDS.find(t => t.level === newLevel);
        
        // Mostra messaggio di level up
        showLevelUpMessage(levelInfo.name, levelInfo.ability);
        
        // Sblocca nuove abilità
        if (levelInfo.ability) {
            unlockAbility(levelInfo.ability);
        }
        
        // Aggiorna visivamente il giocatore
        updatePlayerAppearance(player, oldLevel, newLevel);
    }
} 