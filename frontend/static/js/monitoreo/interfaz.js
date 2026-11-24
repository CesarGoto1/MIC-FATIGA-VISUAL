import { NIVEL_ETIQUETA } from "../formato.js";
import { PARPADEOS_COMPLETOS_REQUERIDOS } from "./parametros.js";

const indicador = document.getElementById("mon-estado-indicador");
const textoEstado = document.getElementById("mon-estado-texto");
const cronometro = document.getElementById("mon-cronometro");
const capaCalibracion = document.getElementById("camara-calibracion");
const barraCalibracion = document.getElementById("camara-calibracion-barra");
const textoCalibracion = document.getElementById("camara-calibracion-texto");
const capaSinRostro = document.getElementById("camara-sin-rostro");
const indicadorGrabando = document.getElementById("mon-grabando");
const botonJuegoLateral = document.getElementById("lateral-boton-juego");
const tarjetaNivel = document.getElementById("tarjeta-nivel-fatiga");
const textoNivel = document.getElementById("metrica-fatiga");
const pistaNivel = document.getElementById("metrica-fatiga-pista");

const METRICAS = ["perclos", "parpadeo", "incompletos", "cierre", "prolongados", "ear", "velocidad"];
const PISTA_INICIAL = "Se evalúa cada minuto con lo ocurrido en ese minuto.";
const PISTA_NIVEL = {
  sin_fatiga: "Tus indicadores están en rango normal.",
  leve: "Parpadeas poco o muchos de tus parpadeos no cierran del todo.",
  moderada: "Parpadeas poco y muchos de tus parpadeos no cierran del todo.",
};

let temporizadorCronometro = null;

export function ponerEstado(tipo, texto) {
  indicador.className = `indicador indicador--${tipo}`;
  textoEstado.textContent = texto;
}

export const ponerMonitoreando = () => ponerEstado("activo", "Monitoreando");

export function mostrarRostro(visible) {
  if (capaSinRostro.hidden === visible) return false;
  capaSinRostro.hidden = visible;
  return true;
}

export function prepararCalibracion() {
  barraCalibracion.style.transform = "scaleX(0)";
  capaCalibracion.hidden = false;
  capaSinRostro.hidden = true;
  textoCalibracion.textContent = "Cargando detector facial…";
}

export const progresoCalibracion = (fraccion) => (barraCalibracion.style.transform = `scaleX(${fraccion})`);
export const textoDeCalibracion = (texto) => (textoCalibracion.textContent = texto);

export function pedirParpadeosDeCalibracion() {
  progresoCalibracion(0);
  textoDeCalibracion(`Ahora parpadea ${PARPADEOS_COMPLETOS_REQUERIDOS} veces cerrando los ojos por completo, sin apretar.`);
}

export function terminarCalibracion() {
  capaCalibracion.hidden = true;
  botonJuegoLateral.disabled = false;
  ponerMonitoreando();
}

export function reiniciarMetricas() {
  tarjetaNivel.dataset.nivel = "";
  textoNivel.textContent = "Esperando datos…";
  pistaNivel.textContent = PISTA_INICIAL;
  METRICAS.forEach((nombre) => (document.getElementById(`metrica-${nombre}`).textContent = "--"));
}

export function pintarMetricas(earActual, m) {
  document.getElementById("metrica-ear").textContent = earActual.toFixed(3);
  if (!m) return;
  document.getElementById("metrica-perclos").textContent = m.perclos.toFixed(1);
  document.getElementById("metrica-parpadeo").textContent = m.parpadeos_min.toFixed(1);
  document.getElementById("metrica-incompletos").textContent =
    m.parpadeos_incompletos_pct === null ? "--" : m.parpadeos_incompletos_pct.toFixed(0);
  document.getElementById("metrica-cierre").textContent = m.tiempo_cierre.toFixed(0);
  document.getElementById("metrica-prolongados").textContent = m.cierres_prolongados;
  document.getElementById("metrica-velocidad").textContent = m.velocidad_ocular.toFixed(2);
}

export function mostrarNivel(nivel) {
  tarjetaNivel.dataset.nivel = nivel;
  textoNivel.textContent = NIVEL_ETIQUETA[nivel] || nivel;
  pistaNivel.textContent = PISTA_NIVEL[nivel] || "";
}

export const mostrarGrabando = (visible) => (indicadorGrabando.hidden = !visible);

export function iniciarCronometro(inicio) {
  cronometro.hidden = false;
  const marcar = () => {
    const segundos = Math.floor((Date.now() - inicio) / 1000);
    cronometro.textContent = `${String(Math.floor(segundos / 60)).padStart(2, "0")}:${String(segundos % 60).padStart(2, "0")}`;
  };
  marcar();
  temporizadorCronometro = setInterval(marcar, 1000);
}

export function detenerInterfaz() {
  clearInterval(temporizadorCronometro);
  temporizadorCronometro = null;
  botonJuegoLateral.disabled = true;
  mostrarGrabando(false);
}

export function ocultarCronometro() {
  cronometro.hidden = true;
}
