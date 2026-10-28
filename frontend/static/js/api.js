const API_BASE = "";

function getToken() {
  return localStorage.getItem("access_token");
}

function setSession(token, usuarioId, nombre) {
  localStorage.setItem("access_token", token);
  localStorage.setItem("usuario_nombre", nombre);
}

function setPerfil({ nombre, codigo_participante, es_admin }) {
  localStorage.setItem("usuario_nombre", nombre);
  localStorage.setItem("codigo_participante", codigo_participante);
  localStorage.setItem("es_admin", String(es_admin));
}

function esAdmin() {
  return localStorage.getItem("es_admin") === "true";
}

function clearSession() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("usuario_nombre");
  localStorage.removeItem("codigo_participante");
  localStorage.removeItem("es_admin");
}

async function apiDownload(path, filename) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${response.status}`);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
    const error = new Error(body.detail || `Error ${response.status}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}
