// ════════════════════════════════════════════════════════════════
// CLIENTE API — habla con el servidor real (server/index.js)
// El token de sesión se guarda en localStorage solo para recordar el login.
// TODOS los datos viven en la base de datos del servidor.
// ════════════════════════════════════════════════════════════════

const TOKEN_KEY = "ff_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch("/api" + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || data.error || `Error ${res.status}`);
  return data;
}

// ─── Auth ───
export const apiRegister = (email, password, name) =>
  api("/register", { method: "POST", body: { email, password, name } });
export const apiLogin = (email, password) =>
  api("/login", { method: "POST", body: { email, password } });
export const apiLogout = () => api("/logout", { method: "POST" }).catch(() => {});

// ─── Datos del usuario ───
export const getProfile = () => api("/profile");
export const putProfile = (data) => api("/profile", { method: "PUT", body: data });
export const getAvatar = () => api("/avatar");
export const putAvatar = (data) => api("/avatar", { method: "PUT", body: data });
export const getData = (key) => api(`/data/${key}`);
export const putData = (key, data) => api(`/data/${key}`, { method: "PUT", body: data });
export const getMuscleWeights = () => api("/muscle-weights");
export const putMuscleWeights = (data) => api("/muscle-weights", { method: "PUT", body: data });
export const getMedals = () => api("/medals");
export const putMedals = (data) => api("/medals", { method: "PUT", body: data });

// ─── Social ───
export const searchUsers = (q) => api(`/users/search?q=${encodeURIComponent(q)}`);
export const getFriends = () => api("/friends");
export const addFriend = (id) => api(`/friends/${id}`, { method: "POST" });
export const removeFriend = (id) => api(`/friends/${id}`, { method: "DELETE" });
export const getClan = () => api("/clan");
export const getClans = () => api("/clans");
export const createClan = (name) => api("/clans", { method: "POST", body: { name } });
export const joinClan = (id) => api(`/clans/${id}/join`, { method: "POST" });
export const leaveClan = () => api("/clan/leave", { method: "POST" });

// ─── IA (proxy a Anthropic) ───
export async function callAI(messages, system = "", max_tokens = 2000) {
  const data = await api("/claude", { method: "POST", body: { messages, system, max_tokens } });
  if (data.error) throw new Error(data.error.message || String(data.error));
  return data.content?.map((b) => b.text || "").join("") || "";
}

export function parseJSON(raw) {
  let s = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("No JSON");
  return JSON.parse(s.substring(a, b + 1));
}
