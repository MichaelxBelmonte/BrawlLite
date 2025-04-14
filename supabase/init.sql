-- Abilita le estensioni necessarie
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabella giocatori
CREATE TABLE IF NOT EXISTS "players" (
    "id" UUID PRIMARY KEY,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Tabella partite
CREATE TABLE IF NOT EXISTS "matches" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "status" TEXT NOT NULL,
    "max_players" INTEGER DEFAULT 10,
    "current_players" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Funzione per aggiornare il timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger per aggiornare il timestamp
CREATE TRIGGER update_players_modtime
BEFORE UPDATE ON players
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_matches_modtime
BEFORE UPDATE ON matches
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

-- Abilita RLS (Row Level Security)
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- Crea policy per permettere operazioni sulle tabelle
CREATE POLICY "Allow full access to authenticated users" ON players
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow full access to authenticated users" ON matches
    USING (true)
    WITH CHECK (true);

-- Abilita Realtime per gli aggiornamenti
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE matches; 