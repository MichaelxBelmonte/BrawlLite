// Test di stress per il server WebSocket
const WebSocket = require('ws');
const { performance } = require('perf_hooks');
const msgpack = require('@msgpack/msgpack');

// Configurazione
const WS_URL = process.env.WS_URL || 'ws://localhost:3000';
const NUM_CLIENTS = 10;
const TEST_DURATION = 30000; // 30 secondi
const MOVE_INTERVAL = 100; // Invia movimento ogni 100ms

// Statistiche
const stats = {
    connections: 0,
    messages: 0,
    errors: 0,
    latencies: [],
    start: performance.now()
};

console.log(`Avvio test di stress con ${NUM_CLIENTS} client per ${TEST_DURATION/1000} secondi`);
console.log(`Connessione a ${WS_URL}`);

// Funzione per creare un client
function createClient(index) {
    const client = {
        id: `test-client-${index}`,
        x: Math.floor(Math.random() * 1200) + 40,
        y: Math.floor(Math.random() * 640) + 40,
        pendingPings: new Map(),
        messagesSent: 0,
        messagesReceived: 0,
        errors: 0
    };
    
    // Crea connessione WebSocket
    client.socket = new WebSocket(WS_URL);
    client.socket.binaryType = 'arraybuffer';
    
    // Gestione eventi
    client.socket.onopen = () => {
        stats.connections++;
        console.log(`Client ${index} connesso`);
        
        // Invia messaggio di join
        const joinMsg = {
            type: 'join',
            id: client.id,
            x: client.x,
            y: client.y
        };
        client.socket.send(msgpack.encode(joinMsg));
        
        // Inizia a inviare movimenti periodicamente
        client.moveInterval = setInterval(() => {
            // Genera movimento casuale
            const dx = Math.floor(Math.random() * 11) - 5;
            const dy = Math.floor(Math.random() * 11) - 5;
            
            client.x = Math.max(20, Math.min(1260, client.x + dx));
            client.y = Math.max(20, Math.min(700, client.y + dy));
            
            // Invia movimento
            const moveMsg = {
                type: 'move',
                id: client.id,
                x: client.x,
                y: client.y,
                dx: dx,
                dy: dy
            };
            
            // Aggiungi timestamp per misurare la latenza
            const pingId = Date.now();
            client.pendingPings.set(pingId, performance.now());
            
            const message = {
                ...moveMsg,
                pingId
            };
            
            client.socket.send(msgpack.encode(message));
            client.messagesSent++;
            stats.messages++;
        }, MOVE_INTERVAL);
    };
    
    client.socket.onmessage = (event) => {
        try {
            const data = msgpack.decode(new Uint8Array(event.data));
            client.messagesReceived++;
            
            // Se è una risposta ping, calcola la latenza
            if (data.pingId && client.pendingPings.has(data.pingId)) {
                const startTime = client.pendingPings.get(data.pingId);
                const latency = performance.now() - startTime;
                stats.latencies.push(latency);
                client.pendingPings.delete(data.pingId);
            }
        } catch (error) {
            client.errors++;
            stats.errors++;
        }
    };
    
    client.socket.onerror = (error) => {
        client.errors++;
        stats.errors++;
        console.error(`Client ${index} errore:`, error.message);
    };
    
    client.socket.onclose = () => {
        console.log(`Client ${index} disconnesso`);
        clearInterval(client.moveInterval);
    };
    
    return client;
}

// Crea i client
const clients = Array.from({ length: NUM_CLIENTS }, (_, i) => createClient(i));

// Funzione per stampare le statistiche
function printStats() {
    const duration = (performance.now() - stats.start) / 1000;
    
    // Calcola statistiche di latenza
    const avgLatency = stats.latencies.length > 0 
        ? stats.latencies.reduce((sum, val) => sum + val, 0) / stats.latencies.length 
        : 0;
    
    const maxLatency = stats.latencies.length > 0 
        ? Math.max(...stats.latencies) 
        : 0;
    
    console.log('\n--- Statistiche Test ---');
    console.log(`Durata: ${duration.toFixed(2)} secondi`);
    console.log(`Client connessi: ${stats.connections}/${NUM_CLIENTS}`);
    console.log(`Messaggi totali: ${stats.messages}`);
    console.log(`Messaggi/secondo: ${(stats.messages / duration).toFixed(2)}`);
    console.log(`Errori: ${stats.errors}`);
    console.log(`Latenza media: ${avgLatency.toFixed(2)} ms`);
    console.log(`Latenza massima: ${maxLatency.toFixed(2)} ms`);
    
    // Statistiche per client
    console.log('\n--- Statistiche per Client ---');
    clients.forEach((client, i) => {
        console.log(`Client ${i}: inviati=${client.messagesSent}, ricevuti=${client.messagesReceived}, errori=${client.errors}`);
    });
}

// Termina il test dopo la durata specificata
setTimeout(() => {
    console.log('\nTermine test...');
    
    // Disconnetti tutti i client
    clients.forEach(client => {
        if (client.socket.readyState === WebSocket.OPEN) {
            client.socket.close();
        }
        clearInterval(client.moveInterval);
    });
    
    // Stampa statistiche finali
    printStats();
    
    process.exit(0);
}, TEST_DURATION); 