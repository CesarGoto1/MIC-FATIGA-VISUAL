import { kssElegido } from "../kss.js";

const formulario = document.getElementById("preparacion-formulario");
const error = document.getElementById("preparacion-error");
const zonaArchivo = document.getElementById("zona-archivo");
const campoArchivo = document.getElementById("archivo-contenido");
const textoArchivo = document.getElementById("zona-archivo-texto");
const zonaYoutube = document.getElementById("zona-youtube");
const campoYoutube = document.getElementById("enlace-youtube");
const escalaKss = document.getElementById("kss-inicial");

const TIPO_ARCHIVO = { lectura: "application/pdf", video: "video/*" };
const TEXTO_ARCHIVO = { lectura: "Selecciona un PDF", video: "Selecciona un video" };
const PATRON_ID_YOUTUBE = /^[\w-]{11}$/;
const RUTAS_YOUTUBE = ["embed", "shorts", "live", "v"];

function idYoutube(texto) {
  const limpio = texto.trim();
  if (!limpio) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(limpio) ? limpio : `https://${limpio}`);
  } catch {
    return null;
  }
  const dominio = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const [, ruta, valor] = url.pathname.split("/");
  let id = null;
  if (dominio === "youtu.be") id = ruta;
  else if (dominio === "youtube.com" || dominio === "youtube-nocookie.com") {
    if (ruta === "watch") id = url.searchParams.get("v");
    else if (RUTAS_YOUTUBE.includes(ruta)) id = valor;
  }
  return id && PATRON_ID_YOUTUBE.test(id) ? id : null;
}

formulario.addEventListener("change", (e) => {
  if (e.target.name !== "actividad") return;
  const tipo = TIPO_ARCHIVO[e.target.value];
  zonaArchivo.hidden = !tipo;
  zonaYoutube.hidden = e.target.value !== "video";
  campoArchivo.value = "";
  campoYoutube.value = "";
  textoArchivo.textContent = TEXTO_ARCHIVO[e.target.value] || "";
  if (tipo) campoArchivo.accept = tipo;
});

campoArchivo.addEventListener("change", () => {
  const archivo = campoArchivo.files[0];
  if (archivo) {
    textoArchivo.textContent = archivo.name;
    campoYoutube.value = "";
  }
});

campoYoutube.addEventListener("input", () => {
  if (!campoYoutube.value.trim() || !campoArchivo.files.length) return;
  campoArchivo.value = "";
  textoArchivo.textContent = TEXTO_ARCHIVO.video;
});

export function leerPreparacion() {
  const datos = new FormData(formulario);
  const momento = datos.get("momento");
  const actividad = datos.get("actividad");
  const kss = kssElegido(escalaKss);
  const archivo = campoArchivo.files[0] || null;
  const enlace = actividad === "video" ? campoYoutube.value.trim() : "";
  const youtube = idYoutube(enlace);

  if (!momento) return { error: "Indica si estás antes o después de tu jornada de estudio." };
  if (!actividad) return { error: "Elige qué vas a hacer durante la sesión." };
  if (enlace && !youtube) return { error: "El enlace no corresponde a un video de YouTube válido." };
  if (actividad === "video" && !archivo && !youtube) return { error: "Selecciona un video o pega un enlace de YouTube." };
  if (actividad === "lectura" && !archivo) return { error: "Selecciona el archivo que vas a usar." };
  if (!kss) return { error: "Indica tu nivel de somnolencia (KSS)." };
  return { momento, actividad, kss, archivo: youtube ? null : archivo, youtube };
}

export function mostrarErrorPreparacion(mensaje) {
  error.textContent = mensaje;
  error.hidden = !mensaje;
}

export function reiniciarPreparacion() {
  formulario.reset();
  zonaArchivo.hidden = true;
  zonaYoutube.hidden = true;
  mostrarErrorPreparacion("");
}

export function alEnviarPreparacion(accion) {
  formulario.addEventListener("submit", (e) => {
    e.preventDefault();
    accion();
  });
}
