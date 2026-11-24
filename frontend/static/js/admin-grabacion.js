import { solicitar, solicitarArchivo, solicitarTodo } from "./api.js";
import { confirmar } from "./dialogos.js";
import { alActivar } from "./formato.js";

const ETIQUETA_TIPO_PARPADEO = { completo: "Completo", incompleto: "Incompleto", prolongado: "Cierre prolongado" };
const MARGEN_RESALTADO_S = 0.3;

const contenedor = document.getElementById("admin-detalle-grabacion");
const estado = document.getElementById("admin-grabacion-estado");
const video = document.getElementById("admin-video");
const listaParpadeos = document.getElementById("admin-parpadeos");
const descarga = document.getElementById("admin-grabacion-descargar");
const botonBorrar = document.getElementById("admin-grabacion-borrar");

let urlVideo = null;
let sesionActual = null;
let alBorrar = null;
let filas = [];
let filaActiva = null;
let videoListo = Promise.resolve();

function tiempoVideo(segundos) {
  const s = Math.max(0, segundos);
  const minutos = Math.floor(s / 60);
  return `${String(minutos).padStart(2, "0")}:${(s - minutos * 60).toFixed(3).padStart(6, "0")}`;
}

function esperarEvento(nombre) {
  return new Promise((resolver) => video.addEventListener(nombre, resolver, { once: true }));
}

async function prepararVideo(url) {
  const metadatos = esperarEvento("loadedmetadata");
  video.src = url;
  await metadatos;
  if (video.duration === Infinity || Number.isNaN(video.duration)) {
    const finBusqueda = esperarEvento("seeked");
    video.currentTime = 1e101;
    await finBusqueda;
    const regreso = esperarEvento("seeked");
    video.currentTime = 0;
    await regreso;
  }
}

function marcarFila(fila) {
  if (fila === filaActiva) return;
  filaActiva?.classList.remove("fila-admin--activa");
  filaActiva = fila;
  if (!fila) return;
  fila.classList.add("fila-admin--activa");
  const lista = fila.closest(".grabacion-admin__lista");
  const caja = lista.getBoundingClientRect();
  const posicion = fila.getBoundingClientRect();
  const cabecera = lista.querySelector("thead")?.offsetHeight ?? 0;
  if (posicion.top < caja.top + cabecera) lista.scrollTop -= caja.top + cabecera - posicion.top;
  else if (posicion.bottom > caja.bottom) lista.scrollTop += posicion.bottom - caja.bottom;
}

async function irAParpadeo(fila) {
  marcarFila(fila);
  await videoListo;
  video.pause();
  video.addEventListener("seeked", () => video.play().catch(() => {}), { once: true });
  video.currentTime = Math.max(0, Number(fila.dataset.inicio));
}

function seguirReproduccion() {
  const t = video.currentTime;
  const actual = filas.find(
    (f) => t >= Number(f.dataset.inicio) - MARGEN_RESALTADO_S && t <= Number(f.dataset.fin) + MARGEN_RESALTADO_S
  );
  if (actual) marcarFila(actual);
}

function filaParpadeo(parpadeo, indice, desfaseMs) {
  const segundos = (parpadeo.inicio_ms - desfaseMs) / 1000;
  const fila = document.createElement("tr");
  fila.className = "fila-admin";
  fila.tabIndex = 0;
  fila.title = "Ver este parpadeo en el video";
  fila.dataset.inicio = segundos;
  fila.dataset.fin = segundos + parpadeo.duracion_ms / 1000;
  fila.innerHTML = `<td>${indice + 1}</td><td>${tiempoVideo(segundos)}</td>
    <td>${ETIQUETA_TIPO_PARPADEO[parpadeo.tipo] || parpadeo.tipo}</td><td>${parpadeo.duracion_ms} ms</td>
    <td>${parpadeo.ear_minimo ?? "–"}</td><td>${parpadeo.umbral_p80 ?? "–"}</td>`;
  alActivar(fila, () => irAParpadeo(fila));
  return fila;
}

export function liberarGrabacion() {
  contenedor.hidden = true;
  video.removeAttribute("src");
  listaParpadeos.replaceChildren();
  filas = [];
  filaActiva = null;
  if (urlVideo) URL.revokeObjectURL(urlVideo);
  urlVideo = null;
  sesionActual = null;
}

export async function mostrarGrabacion(sesion, { alEliminar }) {
  sesionActual = sesion.id;
  alBorrar = alEliminar;
  contenedor.hidden = false;
  estado.hidden = false;
  estado.textContent = "Cargando video…";
  const { desfase_ms: desfaseMs, tipo_mime: tipoMime } = sesion.grabacion;

  try {
    const [archivo, parpadeos] = await Promise.all([
      solicitarArchivo(`/admin/sesiones/${sesion.id}/grabacion`),
      solicitarTodo(`/admin/sesiones/${sesion.id}/parpadeos`),
    ]);
    if (sesionActual !== sesion.id) return;
    urlVideo = URL.createObjectURL(archivo);
    videoListo = prepararVideo(urlVideo);
    descarga.href = urlVideo;
    descarga.download = `sesion_${sesion.id}.${archivo.type.startsWith("video/mp4") ? "mp4" : "webm"}`;
    estado.hidden = true;
    filas = parpadeos.map((p, i) => filaParpadeo(p, i, desfaseMs));
    listaParpadeos.replaceChildren(...filas);
  } catch (err) {
    estado.hidden = false;
    estado.textContent = `No se pudo cargar la grabación: ${err.message}`;
  }
}

async function borrarGrabacion() {
  const id = sesionActual;
  if (id === null) return;
  const acepta = await confirmar(
    "Borrar grabación",
    `¿Borrar definitivamente la grabación de la sesión #${id}? Esta acción no se puede deshacer.`,
    "Borrar"
  );
  if (!acepta) return;
  botonBorrar.disabled = true;
  try {
    await solicitar(`/admin/sesiones/${id}/grabacion`, { method: "DELETE" });
    liberarGrabacion();
    alBorrar?.();
  } catch (err) {
    estado.hidden = false;
    estado.textContent = `No se pudo borrar la grabación: ${err.message}`;
  } finally {
    botonBorrar.disabled = false;
  }
}

botonBorrar.addEventListener("click", borrarGrabacion);
video.addEventListener("timeupdate", seguirReproduccion);

