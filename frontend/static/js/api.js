/**
 * Wrapper de fetch que agrega automáticamente el token JWT (RF08) y
 * centraliza el manejo de errores. Nunca envía un "usuario_id" propio:
 * el backend lo deriva del token en cada petición.
 */
const API_BASE = "";

function getToken() {
  return localStorage.getItem("access_token");
}

function setSession(token, usuarioId, nombre) {
  localStorage.setItem("access_token", token);
  localStorage.setItem("usuario_nombre", nombre);
}

function clearSession() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("usuario_nombre");
}

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Un 401 solo significa "sesión expirada" cuando la petición llevaba un
  // token (endpoint protegido). Si no había token (p. ej. /auth/login con
  // credenciales incorrectas), es un error normal que debe mostrarse en el
  // formulario, no una razón para limpiar la sesión y recargar.
  if (response.status === 401 && token) {
    clearSession();
    location.reload();
    throw new Error("Sesión expirada.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}
