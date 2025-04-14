# Brawl Legends

Un gioco multiplayer in tempo reale per 10 giocatori con architettura distribuita.

## Tecnologie

- **Frontend**: Vercel con PixiJS
- **Backend**: Render con WebSocket
- **Database**: Supabase con Realtime

## Struttura del Progetto

```
/
├─ frontend/
│  └─ public/
│     ├─ index.html
│     ├─ style.css
│     └─ app.js
├─ backend/
│  ├─ server.js
│  ├─ Dockerfile
│  ├─ package.json
│  └─ tests/
│     └─ stress-test.js
└─ supabase/
   └─ init.sql
```

## Setup Locale

1. **Clona il repository**:
   ```bash
   git clone https://github.com/MichaelxBelmonte/BrawlLite.git
   cd BrawlLite
   ```

2. **Setup Backend**:
   ```bash
   cd backend
   npm install
   # Crea un file .env basato su .env.example e configura le variabili
   cp ../.env.example .env
   # Avvia il server in modalità sviluppo
   npm run dev
   ```

3. **Setup Frontend**:
   ```bash
   # Avvia un server locale per servire i file statici
   npx http-server frontend/public -p 8080
   ```

4. **Configurazione Supabase**:
   - Crea un nuovo progetto su [Supabase](https://supabase.com)
   - Esegui lo script SQL in `supabase/init.sql` nella console SQL di Supabase
   - Copia l'URL e la chiave anonima del progetto nel file `.env`
   - Abilita Realtime per il progetto

## Deploy

### Frontend (Vercel)

1. Collega il repository GitHub al tuo account Vercel
2. Configura le variabili d'ambiente:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_KEY`
   - `VITE_WS_URL`
3. Imposta la directory di build su `frontend`

### Backend (Render)

1. Crea un nuovo Web Service su Render
2. Collega il repository GitHub
3. Seleziona `Docker` come ambiente di runtime
4. Imposta la directory di build su `backend`
5. Configura le variabili d'ambiente:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `PORT`

## Test

Per eseguire i test di stress sul server WebSocket:

```bash
cd backend
npm run test:stress
```

## Funzionalità

- Movimento fluido con tasti WASD
- Sincronizzazione in tempo reale tra giocatori
- Predizione lato client e interpolazione (30%)
- Ottimizzazione della rete con compressione delta
- Serializzazione efficiente con MessagePack

## Vercel Deployment

Vercel Configuration:
- Root Directory: `frontend`
- Output Directory: `public`

## Licenza

MIT 