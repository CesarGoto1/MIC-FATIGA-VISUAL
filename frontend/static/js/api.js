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
