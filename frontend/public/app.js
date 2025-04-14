// Configurazione PixiJS
const app = new PIXI.Application({
    width: 1280,
    height: 720,
    backgroundColor: 0x0a0a0a,
    resolution: window.devicePixelRatio || 1,
    antialias: true
});
document.getElementById('game-container').appendChild(app.view);

// Inizializzazione msgpack
const msgpack = window.msgpack5();

// Funzione per ottenere variabili d'ambiente
function getEnvVar(name, defaultValue) {
    try {
        // Tenta di usare import.meta.env se disponibile
        return import.meta.env[name] || defaultValue;
    } catch (e) {
        return defaultValue;
    }
}

// Variabili di configurazione
const PLAYER_SPEED = 5;
const INTERPOLATION_FACTOR = 0.3;
const WS_URL = getEnvVar('VITE_WS_URL', 'wss://brawl-legends-backend.onrender.com');

// Stato del gioco
const gameState = {
    playerId: crypto.randomUUID(),
    players: new Map(),
    keys: {
        w: false,
        a: false,
        s: false,
        d: false
    },
    lastUpdate: Date.now(),
    lastPosition: { x: 0, y: 0 }
};

// Funzione per creare uno sprite giocatore
function createPlayerSprite(playerId, isLocalPlayer = false) {
    const container = new PIXI.Container();
    
    // Corpo principale
    const bodyColor = isLocalPlayer ? 0x00ff88 : 0xff4500;
    const body = new PIXI.Graphics();
    body.beginFill(bodyColor);
    body.drawCircle(0, 0, 20);
    body.endFill();
    
    // Effetto glow
    const glow = new PIXI.Graphics();
    glow.beginFill(bodyColor, 0.3);
    glow.drawCircle(0, 0, 30);
    glow.endFill();
    
    // Nome giocatore (usa le prime 4 cifre dell'ID)
    const playerName = new PIXI.Text(playerId.substring(0, 4), {
        fontFamily: 'Arial',
        fontSize: 12,
        fill: 0xffffff,
        align: 'center'
    });
    playerName.anchor.set(0.5);
    playerName.y = -35;
    
    // Aggiungi tutto al container
    container.addChild(glow);
    container.addChild(body);
    container.addChild(playerName);
    
    // Posizione iniziale casuale
    container.x = Math.random() * (app.screen.width - 100) + 50;
    container.y = Math.random() * (app.screen.height - 100) + 50;
    container.targetX = container.x;
    container.targetY = container.y;
    
    // Aggiungi al display
    app.stage.addChild(container);
    
    // Aggiungi effetto "pulse" per il giocatore locale
    if (isLocalPlayer) {
        app.ticker.add(() => {
            const time = performance.now() / 1000;
            glow.scale.set(1 + Math.sin(time * 2) * 0.1);
        });
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
    
    // Applica movimento in base ai tasti premuti
    if (gameState.keys.w) player.y -= PLAYER_SPEED * delta;
    if (gameState.keys.a) player.x -= PLAYER_SPEED * delta;
    if (gameState.keys.s) player.y += PLAYER_SPEED * delta;
    if (gameState.keys.d) player.x += PLAYER_SPEED * delta;
    
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

// Configura il ticker di gioco prima di inizializzare la connessione
app.ticker.add((delta) => {
    updateMovement(delta);
    interpolateOtherPlayers();
    updateHUD();
});

// Funzione per aggiornare l'HUD
function updateHUD() {
    const player = gameState.players.get(gameState.playerId);
    if (player) {
        document.getElementById('position').textContent = `Posizione: ${Math.round(player.x)},${Math.round(player.y)}`;
    }
    
    // Aggiorna contatore giocatori
    const playerCount = gameState.players.size;
    document.getElementById('player-count').textContent = `Giocatori: ${playerCount}`;
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
let socket;
let reconnectAttempts = 0;

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

// Avvia la connessione WebSocket
connectWebSocket(); 

// Inizializza gli effetti di sfondo (se anime.js è disponibile)
if (typeof anime !== 'undefined') {
    createBackgroundEffect();
} else {
    console.log('anime.js non disponibile, effetti di sfondo disabilitati');
} 