// Importa le dipendenze
const { WebSocketServer, WebSocket } = require('ws');
const { createClient } = require('@supabase/supabase-js');
const msgpack = require('@msgpack/msgpack');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Carica variabili d'ambiente
dotenv.config();

// Configurazione
const PORT = process.env.PORT || 8080; // Usa la porta standard di Render
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SYNC_INTERVAL = 500; // ms

// Stato del server
const gameState = {
    players: new Map(),
    energyPoints: [],
    lastSync: Date.now(),
    inactiveThreshold: 30000, // 30 secondi di inattività
    maxPlayers: 50,
    pendingUpdates: new Map() // Per raccogliere aggiornamenti multipli prima del broadcast
};

// Configurazione della validazione
const VALIDATION_CONFIG = {
    maxSpeed: 15, // Velocità massima consentita per movimento in un frame
    minSize: 10,
    maxSize: 500,
    maxDelta: 30, // Massimo delta di movimento consentito
    boundaryPadding: 20 // Padding dai bordi del mondo di gioco
};

// Dimensioni del mondo di gioco (usate per validazione)
const WORLD = {
    width: 3000,
    height: 3000
};

// Inizializza Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Crea il server HTTP (SSL gestito da Render)
const server = http.createServer();

// Crea il server WebSocket
const wss = new WebSocketServer({ server });

// Configura risposta base per HTTP
server.on('request', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Brawl Legends WebSocket Server');
});

// Funzione per validare lo stato dei giocatori
function validatePlayerState(playerId, data) {
    // Ottieni lo stato precedente del giocatore se esiste
    const existingPlayer = gameState.players.get(playerId);
    
    // Struttura di base del giocatore se non esiste
    if (!existingPlayer && data.type === 'join') {
        return {
            id: playerId,
            x: Math.min(Math.max(data.x || WORLD.width/2, VALIDATION_CONFIG.boundaryPadding), 
                    WORLD.width - VALIDATION_CONFIG.boundaryPadding),
            y: Math.min(Math.max(data.y || WORLD.height/2, VALIDATION_CONFIG.boundaryPadding), 
                    WORLD.height - VALIDATION_CONFIG.boundaryPadding),
            size: VALIDATION_CONFIG.minSize,
            score: 0,
            name: data.name || `Player ${playerId.slice(0, 5)}`,
            lastUpdate: Date.now(),
            color: data.color || generateRandomColor()
        };
    }
    
    // Se è un aggiornamento di movimento
    if (existingPlayer && data.type === 'move') {
        // Crea una copia dello stato corrente per modificarlo
        const updatedPlayer = { ...existingPlayer };
        
        // Imposta il timestamp dell'ultimo aggiornamento
        updatedPlayer.lastUpdate = Date.now();
        
        // Caso 1: Se il messaggio contiene coordinate assolute
        if (typeof data.x === 'number' && typeof data.y === 'number') {
            // Calcola la distanza dalla posizione precedente
            const dx = data.x - existingPlayer.x;
            const dy = data.y - existingPlayer.y;
            const distance = Math.sqrt(dx*dx + dy*dy);
            
            // Verifica se il movimento è troppo grande (potenziale cheating)
            const timeDelta = (Date.now() - existingPlayer.lastUpdate) / 1000; // in secondi
            const maxAllowedDistance = VALIDATION_CONFIG.maxSpeed * Math.max(timeDelta, 0.016); // 0.016 = circa 60fps
            
            if (distance > maxAllowedDistance * 1.5) { // Consenti un po' di flessibilità per latenza
                console.warn(`Movimento sospetto rilevato per giocatore ${playerId}. Distanza: ${distance}, Max consentito: ${maxAllowedDistance}`);
                
                // Limita il movimento alla massima distanza consentita
                const ratio = maxAllowedDistance / distance;
                updatedPlayer.x = existingPlayer.x + dx * ratio;
                updatedPlayer.y = existingPlayer.y + dy * ratio;
            } else {
                // Il movimento è ragionevole, accettalo
                updatedPlayer.x = data.x;
                updatedPlayer.y = data.y;
            }
        } 
        // Caso 2: Se il messaggio contiene delta di movimento
        else if (typeof data.dx === 'number' && typeof data.dy === 'number') {
            // Valida i delta di movimento
            const dx = Math.min(Math.max(data.dx, -VALIDATION_CONFIG.maxDelta), VALIDATION_CONFIG.maxDelta);
            const dy = Math.min(Math.max(data.dy, -VALIDATION_CONFIG.maxDelta), VALIDATION_CONFIG.maxDelta);
            
            // Applica il movimento
            updatedPlayer.x = Math.min(Math.max(existingPlayer.x + dx, VALIDATION_CONFIG.boundaryPadding), 
                                  WORLD.width - VALIDATION_CONFIG.boundaryPadding);
            updatedPlayer.y = Math.min(Math.max(existingPlayer.y + dy, VALIDATION_CONFIG.boundaryPadding), 
                                  WORLD.height - VALIDATION_CONFIG.boundaryPadding);
        }
        
        // Aggiorna la dimensione se è stata fornita (ad es. dopo aver mangiato)
        if (typeof data.size === 'number') {
            updatedPlayer.size = Math.min(Math.max(data.size, VALIDATION_CONFIG.minSize), VALIDATION_CONFIG.maxSize);
        }
        
        // Aggiorna lo score se è stato fornito
        if (typeof data.score === 'number' && data.score >= existingPlayer.score) {
            updatedPlayer.score = data.score;
        }
        
        return updatedPlayer;
    }
    
    // Se è un'azione "eat" (un giocatore mangia un altro)
    if (existingPlayer && data.type === 'eat') {
        // Verifica che il giocatore target esista
        const targetPlayer = gameState.players.get(data.targetId);
        if (!targetPlayer) return null;
        
        // Calcola la distanza tra i due giocatori
        const dx = existingPlayer.x - targetPlayer.x;
        const dy = existingPlayer.y - targetPlayer.y;
        const distance = Math.sqrt(dx*dx + dy*dy);
        
        // Verifica che il giocatore sia effettivamente più grande e abbastanza vicino
        if (existingPlayer.size > targetPlayer.size * 1.1 && 
            distance < (existingPlayer.size + targetPlayer.size) / 2) {
            
            // Calcola il nuovo punteggio e dimensione
            const scoreGain = Math.floor(targetPlayer.size / 2);
            const updatedPlayer = { ...existingPlayer };
            updatedPlayer.score += scoreGain;
            updatedPlayer.size = Math.min(Math.sqrt(existingPlayer.size*existingPlayer.size + targetPlayer.size*targetPlayer.size), 
                                      VALIDATION_CONFIG.maxSize);
            updatedPlayer.lastUpdate = Date.now();
            
            return updatedPlayer;
        }
    }
    
    // Se è un heartbeat/ping
    if (existingPlayer && data.type === 'ping') {
        return {
            ...existingPlayer,
            lastUpdate: Date.now()
        };
    }
    
    // Se il tipo di messaggio non è supportato o non è stato validato, ritorna null
    return null;
}

// Genera un colore casuale
function generateRandomColor() {
    const colors = [
        '#FF5733', '#33FF57', '#3357FF', '#F433FF', '#FF33A1',
        '#33FFF5', '#F5FF33', '#FF8333', '#33FFB5', '#B533FF'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Invio ottimizzato di dati ai client
function sendToClient(client, data) {
    if (client.readyState === WebSocket.OPEN) {
        try {
            // Usa MessagePack per una serializzazione più efficiente
            const encodedData = msgpack.encode(data);
            client.send(encodedData);
            return true;
        } catch (error) {
            console.error('Errore durante l\'invio dei dati al client:', error);
            return false;
        }
    }
    return false;
}

// Broadcast dello stato a tutti i client
function broadcastState() {
    // Converti la mappa dei giocatori in un array
    const playersArray = Array.from(gameState.players.values());
    
    // Rimuovi proprietà non necessarie per ridurre la dimensione dei dati
    const streamlinedPlayers = playersArray.map(player => ({
        id: player.id,
        x: Math.round(player.x),
        y: Math.round(player.y),
        size: Math.round(player.size),
        score: player.score,
        name: player.name,
        color: player.color
    }));
    
    const stateData = {
        type: 'state',
        players: streamlinedPlayers,
        timestamp: Date.now()
    };
    
    // Broadcast a tutti i client
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            sendToClient(client, stateData);
        }
    });
}

// Gestione delle connessioni WebSocket
wss.on('connection', (ws) => {
    console.log('Nuova connessione stabilita');
    
    let playerId = null;
    
    ws.on('message', async (message) => {
        try {
            const data = msgpack.decode(new Uint8Array(message));
            
            // Usa l'ID del client o quello specificato nel messaggio
            const playerId = data.id || uuidv4();
            
            // Valida lo stato
            const validatedState = validatePlayerState(playerId, data);
            
            if (validatedState) {
                // Aggiorna lo stato nel gameState
                gameState.players.set(playerId, validatedState);
                
                // Gestione specifici tipi di messaggi
                switch (data.type) {
                    case 'join':
                        // Notifica a tutti i client che un nuovo giocatore è entrato
                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                sendToClient(client, {
                                    type: 'join',
                                    player: validatedState
                                });
                            }
                        });
                        
                        // Invia lo stato completo al nuovo giocatore
                        sendToClient(ws, {
                            type: 'welcome',
                            playerId: playerId,
                            players: Array.from(gameState.players.values()),
                            timestamp: Date.now()
                        });
                        break;
                        
                    case 'eat':
                        // Rimuovi il giocatore mangiato
                        gameState.players.delete(data.targetId);
                        
                        // Notifica a tutti che un giocatore è stato mangiato
                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                sendToClient(client, {
                                    type: 'playerEaten',
                                    eatenId: data.targetId,
                                    eaterId: playerId,
                                    eaterSize: validatedState.size,
                                    eaterScore: validatedState.score
                                });
                            }
                        });
                        break;
                        
                    case 'move':
                        // Aggiungi agli aggiornamenti pendenti invece di fare broadcast immediato
                        gameState.pendingUpdates.set(playerId, validatedState);
                        break;
                }
            } else {
                console.warn(`Stato non valido ricevuto da ${playerId}:`, data);
            }
        } catch (error) {
            console.error('Errore nell\'elaborazione del messaggio:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Connessione chiusa');
        
        if (playerId && gameState.players.has(playerId)) {
            // Rimuovi il giocatore
            gameState.players.delete(playerId);
            
            // Notifica tutti gli altri della disconnessione
            broadcastState();
            
            // Rimuovi giocatore da Supabase
            try {
                supabase
                    .from('players')
                    .delete()
                    .eq('id', playerId);
            } catch (error) {
                console.error('Errore durante la rimozione da Supabase:', error);
            }
        }
    });
});

// Funzione per sincronizzare con Supabase
async function syncWithSupabase() {
    try {
        // Ottieni giocatori attivi ordinati per punteggio
        const activePlayers = Array.from(gameState.players.values())
            .filter(player => Date.now() - player.lastUpdate < gameState.inactiveThreshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, 100); // Limita a 100 giocatori
        
        // Aggiona la classifica
        if (activePlayers.length > 0) {
            const { error } = await supabase
                .from('leaderboard')
                .upsert(
                    activePlayers.map(player => ({
                        player_id: player.id,
                        name: player.name,
                        score: player.score,
                        size: player.size,
                        last_update: new Date(player.lastUpdate).toISOString()
                    })),
                    { onConflict: 'player_id' }
                );
            
            if (error) {
                console.error('Errore nella sincronizzazione con Supabase:', error);
            }
        }
        
        // Rimuovi giocatori inattivi
        const now = Date.now();
        gameState.players.forEach((player, id) => {
            if (now - player.lastUpdate > gameState.inactiveThreshold) {
                console.log(`Rimozione giocatore inattivo: ${id}`);
                gameState.players.delete(id);
                
                // Notifica tutti i client
                broadcastState();
                
                // Rimuovi da Supabase
                try {
                    supabase
                        .from('players')
                        .delete()
                        .eq('id', id);
                } catch (error) {
                    console.error('Errore durante la rimozione da Supabase:', error);
                }
            }
        });
        
    } catch (error) {
        console.error('Errore durante la sincronizzazione con Supabase:', error);
    }
}

// Imposta timer per inviare aggiornamenti in batch
setInterval(() => {
    if (gameState.pendingUpdates.size > 0) {
        // Crea un array di aggiornamenti
        const updates = Array.from(gameState.pendingUpdates.values()).map(player => ({
            id: player.id,
            x: Math.round(player.x),
            y: Math.round(player.y),
            size: Math.round(player.size),
            score: player.score
        }));
        
        // Svuota gli aggiornamenti pendenti
        gameState.pendingUpdates.clear();
        
        // Broadcast degli aggiornamenti
        broadcastState();
    }
}, 50); // Aggiorna i client ogni 50ms (20 volte al secondo)

// Imposta timer per sincronizzazione con Supabase
setInterval(syncWithSupabase, 5000);

// Avvia il server
server.listen(PORT, () => {
    console.log(`🚀 Server WebSocket in ascolto sulla porta ${PORT} (SSL gestito da Render)`);
    
    // Avvia sincronizzazione con Supabase
    syncWithSupabase();
}); 