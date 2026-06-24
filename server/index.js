// ════════════════════════════════════════════════════════════════
// SERVIDOR FastFit — Express + SQLite + Proxy a la API de Anthropic
// Arranca con:  node server/index.js   (o npm run dev para todo)
// ════════════════════════════════════════════════════════════════
import express from "express";
import cors from "cors";
import crypto from "crypto";
import https from "https";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";
import db from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Cargar variables del archivo .env (sin dependencias externas) ───
(function loadEnv() {
  const envPath = join(__dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
})();
const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" })); // 8mb para permitir fotos de avatar en base64

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const PORT = process.env.PORT || 3001;

// ─── Helpers de seguridad ───
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(pw, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(test));
}
function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}
// Middleware: verifica el token Bearer y carga req.user
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No autenticado" });
  const user = db.prepare("SELECT id, email, name FROM users WHERE token = ?").get(token);
  if (!user) return res.status(401).json({ error: "Sesión inválida" });
  req.user = user;
  next();
}

// ════════════════════════════════════════════════
// AUTENTICACIÓN
// ════════════════════════════════════════════════
app.post("/api/register", (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Faltan datos" });
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return res.status(409).json({ error: "Email ya registrado" });
  const id = "u_" + crypto.randomBytes(8).toString("hex");
  const token = makeToken();
  db.prepare("INSERT INTO users (id, email, name, password_hash, token, created_at) VALUES (?,?,?,?,?,?)")
    .run(id, email, name || email.split("@")[0], hashPassword(password), token, Date.now());
  res.json({ user: { uid: id, email, name: name || email.split("@")[0] }, token });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!u || !verifyPassword(password, u.password_hash))
    return res.status(401).json({ error: "Credenciales incorrectas" });
  const token = makeToken();
  db.prepare("UPDATE users SET token = ? WHERE id = ?").run(token, u.id);
  res.json({ user: { uid: u.id, email: u.email, name: u.name }, token });
});

app.post("/api/logout", auth, (req, res) => {
  db.prepare("UPDATE users SET token = NULL WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
// DATOS DEL USUARIO (perfil, rutinas, comidas, etc.)
// ════════════════════════════════════════════════
// Perfil
app.get("/api/profile", auth, (req, res) => {
  const row = db.prepare("SELECT data FROM profiles WHERE user_id = ?").get(req.user.id);
  res.json(row ? JSON.parse(row.data) : null);
});
app.put("/api/profile", auth, (req, res) => {
  db.prepare("INSERT INTO profiles (user_id, data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data")
    .run(req.user.id, JSON.stringify(req.body));
  res.json({ ok: true });
});

// Avatar
app.get("/api/avatar", auth, (req, res) => {
  const row = db.prepare("SELECT data FROM avatars WHERE user_id = ?").get(req.user.id);
  res.json(row ? JSON.parse(row.data) : null);
});
app.put("/api/avatar", auth, (req, res) => {
  db.prepare("INSERT INTO avatars (user_id, data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data")
    .run(req.user.id, JSON.stringify(req.body));
  res.json({ ok: true });
});

// Datos genéricos: workout_plans, meal_plans, progress_logs, completed_workouts, mental_surveys
app.get("/api/data/:key", auth, (req, res) => {
  const row = db.prepare("SELECT data FROM user_data WHERE user_id = ? AND key = ?").get(req.user.id, req.params.key);
  res.json(row ? JSON.parse(row.data) : null);
});
app.put("/api/data/:key", auth, (req, res) => {
  db.prepare("INSERT INTO user_data (user_id, key, data) VALUES (?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET data = excluded.data")
    .run(req.user.id, req.params.key, JSON.stringify(req.body));
  res.json({ ok: true });
});

// Pesos por músculo (rangos de fuerza)
app.get("/api/muscle-weights", auth, (req, res) => {
  const row = db.prepare("SELECT data FROM muscle_weights WHERE user_id = ?").get(req.user.id);
  res.json(row ? JSON.parse(row.data) : {});
});
app.put("/api/muscle-weights", auth, (req, res) => {
  db.prepare("INSERT INTO muscle_weights (user_id, data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data")
    .run(req.user.id, JSON.stringify(req.body));
  res.json({ ok: true });
});

// Medallas
app.get("/api/medals", auth, (req, res) => {
  const row = db.prepare("SELECT data FROM medals WHERE user_id = ?").get(req.user.id);
  res.json(row ? JSON.parse(row.data) : {});
});
app.put("/api/medals", auth, (req, res) => {
  db.prepare("INSERT INTO medals (user_id, data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data")
    .run(req.user.id, JSON.stringify(req.body));
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
// SOCIAL — Amigos
// ════════════════════════════════════════════════
// Construye el perfil público de un usuario (avatar, nivel, rangos, clan)
function publicProfile(userId) {
  const u = db.prepare("SELECT id, name FROM users WHERE id = ?").get(userId);
  if (!u) return null;
  const av = db.prepare("SELECT data FROM avatars WHERE user_id = ?").get(userId);
  const mw = db.prepare("SELECT data FROM muscle_weights WHERE user_id = ?").get(userId);
  const prof = db.prepare("SELECT data FROM profiles WHERE user_id = ?").get(userId);
  const medals = db.prepare("SELECT data FROM medals WHERE user_id = ?").get(userId);
  const clanRow = db.prepare(`
    SELECT c.name FROM clan_members cm JOIN clans c ON c.id = cm.clan_id WHERE cm.user_id = ?
  `).get(userId);
  const cw = db.prepare("SELECT data FROM user_data WHERE user_id = ? AND key = 'completed_workouts'").get(userId);
  const workouts = cw ? JSON.parse(cw.data).length : 0;
  const medalCount = medals ? Object.keys(JSON.parse(medals.data)).length : 0;
  return {
    id: u.id,
    name: u.name,
    avatar: av ? JSON.parse(av.data) : null,
    profile: prof ? JSON.parse(prof.data) : null,
    muscle_weights: mw ? JSON.parse(mw.data) : {},
    clan: clanRow ? clanRow.name : null,
    level: Math.max(1, Math.floor(workouts / 2) + medalCount), // nivel simple
    medals: medalCount,
  };
}

// Buscar usuarios por nombre o email (para añadir amigos)
app.get("/api/users/search", auth, (req, res) => {
  const q = `%${(req.query.q || "").toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT id, name, email FROM users
    WHERE id != ? AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ?)
    LIMIT 20
  `).all(req.user.id, q, q);
  res.json(rows.map(r => ({ id: r.id, name: r.name })));
});

// Lista de amigos (con su perfil público)
app.get("/api/friends", auth, (req, res) => {
  const rows = db.prepare("SELECT friend_id FROM friendships WHERE user_id = ?").all(req.user.id);
  res.json(rows.map(r => publicProfile(r.friend_id)).filter(Boolean));
});

// Añadir amigo (crea amistad bidireccional)
app.post("/api/friends/:friendId", auth, (req, res) => {
  const fid = req.params.friendId;
  const friend = db.prepare("SELECT id FROM users WHERE id = ?").get(fid);
  if (!friend) return res.status(404).json({ error: "Usuario no encontrado" });
  const now = Date.now();
  const ins = db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?,?,?)");
  ins.run(req.user.id, fid, now);
  ins.run(fid, req.user.id, now);
  res.json({ ok: true });
});

// Eliminar amigo
app.delete("/api/friends/:friendId", auth, (req, res) => {
  const fid = req.params.friendId;
  db.prepare("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?").run(req.user.id, fid);
  db.prepare("DELETE FROM friendships WHERE user_id = ? AND friend_id = ?").run(fid, req.user.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
// SOCIAL — Clanes
// ════════════════════════════════════════════════
// Mi clan actual (con miembros y sus perfiles)
app.get("/api/clan", auth, (req, res) => {
  const member = db.prepare(`
    SELECT c.* FROM clan_members cm JOIN clans c ON c.id = cm.clan_id WHERE cm.user_id = ?
  `).get(req.user.id);
  if (!member) return res.json(null);
  const members = db.prepare("SELECT user_id FROM clan_members WHERE clan_id = ?").all(member.id);
  res.json({
    id: member.id,
    name: member.name,
    owner_id: member.owner_id,
    members: members.map(m => publicProfile(m.user_id)).filter(Boolean),
  });
});

// Listar clanes disponibles
app.get("/api/clans", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, COUNT(cm.user_id) as count
    FROM clans c LEFT JOIN clan_members cm ON cm.clan_id = c.id
    GROUP BY c.id ORDER BY count DESC LIMIT 30
  `).all();
  res.json(rows);
});

// Crear clan
app.post("/api/clans", auth, (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Nombre requerido" });
  const exists = db.prepare("SELECT id FROM clans WHERE LOWER(name) = LOWER(?)").get(name);
  if (exists) return res.status(409).json({ error: "Ese clan ya existe" });
  // salir de cualquier clan previo
  db.prepare("DELETE FROM clan_members WHERE user_id = ?").run(req.user.id);
  const id = "c_" + crypto.randomBytes(6).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO clans (id, name, owner_id, created_at) VALUES (?,?,?,?)").run(id, name, req.user.id, now);
  db.prepare("INSERT INTO clan_members (clan_id, user_id, joined_at) VALUES (?,?,?)").run(id, req.user.id, now);
  res.json({ id, name });
});

// Unirse a un clan
app.post("/api/clans/:clanId/join", auth, (req, res) => {
  const clan = db.prepare("SELECT id FROM clans WHERE id = ?").get(req.params.clanId);
  if (!clan) return res.status(404).json({ error: "Clan no encontrado" });
  db.prepare("DELETE FROM clan_members WHERE user_id = ?").run(req.user.id); // salir del anterior
  db.prepare("INSERT OR IGNORE INTO clan_members (clan_id, user_id, joined_at) VALUES (?,?,?)")
    .run(clan.id, req.user.id, Date.now());
  res.json({ ok: true });
});

// Salir del clan
app.post("/api/clan/leave", auth, (req, res) => {
  db.prepare("DELETE FROM clan_members WHERE user_id = ?").run(req.user.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
// PROXY A LA API DE ANTHROPIC (la IA real)
// ════════════════════════════════════════════════
app.post("/api/claude", auth, (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: { message: "Falta ANTHROPIC_API_KEY en el archivo .env" } });
  }
  const body = JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: req.body.max_tokens || 2000,
    system: req.body.system || "",
    messages: req.body.messages || [],
  });
  const options = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(body),
    },
  };
  const apiReq = https.request(options, (apiRes) => {
    let data = "";
    apiRes.on("data", (chunk) => (data += chunk));
    apiRes.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        // Si la API de Anthropic devolvió un error, lo registramos y reenviamos con detalle
        if (apiRes.statusCode >= 400) {
          console.error("Error de la API de Anthropic:", apiRes.statusCode, data);
        }
        res.status(apiRes.statusCode).json(parsed);
      } catch {
        console.error("Respuesta no-JSON de la API:", apiRes.statusCode, data.slice(0, 300));
        res.status(500).json({ error: { message: "Respuesta invalida de la API (codigo " + apiRes.statusCode + ")" } });
      }
    });
  });
  apiReq.on("error", (err) => {
    console.error("Error de conexion con Anthropic:", err.message);
    res.status(500).json({ error: { message: "No se pudo conectar con la API: " + err.message } });
  });
  apiReq.write(body);
  apiReq.end();
});

// ════════════════════════════════════════════════
// Servir el frontend compilado (en producción)
// ════════════════════════════════════════════════
const distPath = join(__dirname, "..", "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) return res.status(404).json({ error: "Not found" });
    res.sendFile(join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`\n  🚀  Servidor FastFit corriendo en http://localhost:${PORT}`);
  console.log(`  🔑  API Key de Anthropic: ${API_KEY ? "✅ detectada" : "❌ FALTA (ponла en .env)"}`);
  console.log(`  💾  Base de datos: server/fastfit.db\n`);
});
