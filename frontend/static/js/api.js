const PREFIJO_API = "/api/v1";
const POR_PAGINA_MAXIMO = 100;
const CLAVES_SESION = ["token_acceso", "usuario_nombre", "codigo_participante", "es_admin"];

export function obtenerToken() {
  return localStorage.getItem("token_acceso");
}

export function guardarToken(token) {
  localStorage.setItem("token_acceso", token);
}

export function guardarPerfil({ nombre, codigo_participante, es_admin }) {
  localStorage.setItem("usuario_nombre", nombre);
  localStorage.setItem("codigo_participante", codigo_participante);
  localStorage.setItem("es_admin", String(es_admin));
}

export function esAdmin() {
  return localStorage.getItem("es_admin") === "true";
}

export function borrarSesion() {
  CLAVES_SESION.forEach((clave) => localStorage.removeItem(clave));
}

function cabeceraAutorizacion() {
  const token = obtenerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function errorDeRespuesta(respuesta) {
  const cuerpo = await respuesta.json().catch(() => ({}));
  const error = new Error(cuerpo.error?.mensaje || `Error ${respuesta.status}`);
  error.estado = respuesta.status;
  error.codigo = cuerpo.error?.codigo;
  error.detalles = cuerpo.error?.detalles || [];
  return error;
}

export async function solicitar(ruta, opciones = {}) {
  const tieneToken = Boolean(obtenerToken());
  const respuesta = await fetch(`${PREFIJO_API}${ruta}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...cabeceraAutorizacion(), ...opciones.headers },
  });

  if (respuesta.status === 401 && tieneToken) {
    borrarSesion();
    location.reload();
    throw new Error("Sesión expirada.");
  }
  if (!respuesta.ok) throw await errorDeRespuesta(respuesta);
  return respuesta.status === 204 ? null : respuesta.json();
}

export async function solicitarTodo(ruta) {
  const separador = ruta.includes("?") ? "&" : "?";
  const elementos = [];
  for (let pagina = 1; ; pagina += 1) {
    const respuesta = await solicitar(`${ruta}${separador}pagina=${pagina}&por_pagina=${POR_PAGINA_MAXIMO}`);
    elementos.push(...respuesta.elementos);
    if (pagina >= respuesta.paginas) return elementos;
  }
}

export async function solicitarArchivo(ruta) {
  const respuesta = await fetch(`${PREFIJO_API}${ruta}`, { headers: cabeceraAutorizacion() });
  if (!respuesta.ok) throw await errorDeRespuesta(respuesta);
  return respuesta.blob();
}

export async function subirBinario(ruta, contenido) {
  const respuesta = await fetch(`${PREFIJO_API}${ruta}`, {
    method: "PUT",
    headers: { ...cabeceraAutorizacion(), "Content-Type": "application/octet-stream" },
    body: contenido,
  });
  if (!respuesta.ok) throw await errorDeRespuesta(respuesta);
}

export async function descargar(ruta, nombreArchivo) {
  const url = URL.createObjectURL(await solicitarArchivo(ruta));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}
