// Importa le dipendenze
const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');
const msgpack = require('@msgpack/msgpack');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');

// Carica variabili d'ambiente
dotenv.config();

// Configurazione
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SYNC_INTERVAL = 500; // ms

// Stato del server
const gameState = {
    players: new Map(),
    lastSync: Date.now()
};

// Inizializza Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Crea il server HTTP
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Brawl Legends WebSocket Server');
});

// Crea il server WebSocket
const wss = new WebSocketServer({ server });

// Gestione delle connessioni WebSocket
wss.on('connection', (ws) => {
    console.log('Nuova connessione stabilita');
    
    let playerId = null;
    
    ws.on('message', async (message) => {
        try {
            const data = msgpack.decode(new Uint8Array(message));
            
            switch (data.type) {
                case 'join':
                    playerId = data.id;
                    
                    // Aggiungi il giocatore allo stato
                    gameState.players.set(playerId, {
                        id: playerId,
                        x: data.x,
                        y: data.y,
                        lastSeen: Date.now()
                    });
                    
                    // Annuncia il nuovo giocatore a tutti gli altri
                    broadcastToAll({
                        type: 'join',
                        id: playerId,
                        x: data.x,
                        y: data.y
                    }, [playerId]);
                    
                    // Invia lo stato corrente al nuovo giocatore
                    const currentState = {
                        type: 'state',
                        players: Array.from(gameState.players.values())
                    };
                    ws.send(msgpack.encode(currentState));
                    
                    // Salva il nuovo giocatore su Supabase
                    try {
                        await supabase
                            .from('players')
                            .upsert({
                                id: playerId,
                                x: data.x,
                                y: data.y
                            });
                    } catch (error) {
                        console.error('Errore durante il salvataggio su Supabase:', error);
                    }
                    break;
                    
                case 'move':
                    if (playerId && gameState.players.has(playerId)) {
                        const player = gameState.players.get(playerId);
                        
                        // Aggiorna la posizione con coordinate assolute
                        player.x = data.x;
                        player.y = data.y;
                        player.lastSeen = Date.now();
                        
                        // Invia aggiornamento di movimento a tutti gli altri
                        broadcastToAll({
                            type: 'move',
                            id: playerId,
                            x: data.x,
                            y: data.y,
                            dx: data.dx,
                            dy: data.dy
                        }, [playerId]);
                    }
                    break;
            }
        } catch (error) {
            console.error('Errore nel processing del messaggio:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Connessione chiusa');
        
        if (playerId && gameState.players.has(playerId)) {
            // Rimuovi il giocatore
            gameState.players.delete(playerId);
            
            // Notifica tutti gli altri della disconnessione
            broadcastToAll({
                type: 'leave',
                id: playerId
            });
            
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

// Funzione per inviare messaggi a tutti i client eccetto gli esclusi
function broadcastToAll(message, excludeIds = []) {
    const encodedMessage = msgpack.encode(message);
    
    wss.clients.forEach((client) => {
        if (client.readyState === ws.OPEN) {
            client.send(encodedMessage);
        }
    });
}

// Sincronizza con Supabase ogni SYNC_INTERVAL
async function syncWithSupabase() {
    if (gameState.players.size > 0) {
        try {
            const updates = Array.from(gameState.players.values()).map(player => ({
                id: player.id,
                x: player.x,
                y: player.y
            }));
            
            // Utilizza UPSERT per inserire o aggiornare in modo efficiente
            const { error } = await supabase
                .from('players')
                .upsert(updates);
            
            if (error) {
                console.error('Errore durante la sincronizzazione con Supabase:', error);
            } else {
                console.log(`Sincronizzati ${updates.length} giocatori con Supabase`);
            }
        } catch (error) {
            console.error('Errore durante la sincronizzazione con Supabase:', error);
        }
    }
    
    // Rimuovi giocatori inattivi (più di 30 secondi)
    const now = Date.now();
    const inactiveThreshold = now - 30000;
    
    for (const [id, player] of gameState.players.entries()) {
        if (player.lastSeen < inactiveThreshold) {
            gameState.players.delete(id);
            
            // Notifica tutti della disconnessione
            broadcastToAll({
                type: 'leave',
                id
            });
            
            // Rimuovi da Supabase
            try {
                await supabase
                    .from('players')
                    .delete()
                    .eq('id', id);
            } catch (error) {
                console.error('Errore durante la rimozione da Supabase:', error);
            }
        }
    }
    
    // Programma la prossima sincronizzazione
    setTimeout(syncWithSupabase, SYNC_INTERVAL);
}

// Avvia il server
server.listen(PORT, () => {
    console.log(`Server WebSocket in ascolto sulla porta ${PORT}`);
    
    // Avvia sincronizzazione con Supabase
    syncWithSupabase();
}); 