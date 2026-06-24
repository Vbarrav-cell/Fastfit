// ════════════════════════════════════════════════════════════════
// BASE DE DATOS — SQLite (archivo local, no requiere instalar nada)
// Crea automáticamente fastfit.db la primera vez que arranca el server
// ════════════════════════════════════════════════════════════════
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, "fastfit.db"));
db.pragma("journal_mode = WAL");

// ─── Tablas ───
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    token TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS avatars (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Datos genéricos por usuario (rutinas, comidas, progreso, etc.)
  CREATE TABLE IF NOT EXISTS user_data (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Pesos por grupo muscular (para rangos de fuerza)
  CREATE TABLE IF NOT EXISTS muscle_weights (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Medallas obtenidas
  CREATE TABLE IF NOT EXISTS medals (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Amistades (bidireccional: se guardan 2 filas)
  CREATE TABLE IF NOT EXISTS friendships (
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );

  -- Clanes
  CREATE TABLE IF NOT EXISTS clans (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    owner_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Membresía de clan
  CREATE TABLE IF NOT EXISTS clan_members (
    clan_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (clan_id, user_id)
  );
`);

export default db;
