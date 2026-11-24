import { pintarDiagnostico } from "./analisis.js";
import { borrarSesion, solicitar } from "./api.js";
import {
  ACTIVIDAD_ETIQUETA,
  MOMENTO_ETIQUETA,
  NIVEL_CLASE,
  NIVEL_ETIQUETA,
  escaparHtml,
  formatoFecha,
  htmlCargando,
  numero,
} from "./formato.js";
import { liberarGraficasHuerfanas, pintarGraficasSesion } from "./graficas.js";
import { alMostrarVista, mostrarMonitoreo } from "./vistas.js";

const CONSULTA_ANALISIS_MS = 3_000;
const ESPERA_MAXIMA_ANALISIS_MS = 120_000;
const SESIONES_POR_PAGINA = 10;

const METRICAS_COMPARADAS = [
  { clave: "parpadeos_min", etiqueta: "Parpadeos", unidad: "/min", decimales: 1, peorSiSube: false },
  { clave: "parpadeos_incompletos_pct", etiqueta: "Parpadeos incompletos", unidad: "%", decimales: 0, peorSiSube: true },
  { clave: "tiempo_cierre", etiqueta: "Cierre medio", unidad: "ms", decimales: 0, peorSiSube: true },
  { clave: "kss", etiqueta: "Somnolencia (KSS, control)", unidad: "/9", decimales: 1, peorSiSube: true },
];

const lista = document.getElementById("panel-sesiones-lista");
const botonMas = document.getElementById("panel-sesiones-mas");
const errorSesiones = document.getElementById("panel-sesiones-error");

let sesionPorAbrir = null;
let paginaActual = 0;

export function abrirResumenAlVolver(sesionId) {
  sesionPorAbrir = sesionId;
}

function duracion(iniciada, finalizada) {
  if (!finalizada) return "Sin finalizar";
  const ms = new Date(finalizada) - new Date(iniciada);
  const minutos = Math.floor(ms / 60000);
  return minutos <= 0 ? `${Math.round(ms / 1000)} s` : `${minutos} min`;
}

function pintarDatos(resumen) {
  document.getElementById("dato-total").textContent = resumen?.total_sesiones ?? 0;
  document.getElementById("dato-semana").textContent = resumen?.sesiones_semana ?? 0;
  document.getElementById("dato-con-alerta").textContent = resumen?.sesiones_con_fatiga ?? 0;
  document.getElementById("dato-ultima").textContent = resumen?.ultima_sesion
    ? formatoFecha.format(new Date(resumen.ultima_sesion))
    : "–";
}

function htmlTendencia(antes, despues, peorSiSube) {
  if (antes === null || despues === null || antes === despues) return "";
  const sube = despues > antes;
  const empeora = sube === peorSiSube;
  return `<span class="tendencia tendencia--${empeora ? "empeora" : "mejora"}">
    <svg aria-hidden="true"><use href="#${sube ? "i-tendencia-sube" : "i-tendencia-baja"}"/></svg>
    <span class="solo-lector">${empeora ? "empeora" : "mejora"}</span></span>`;
}

function pintarComparacion(resumen) {
  const seccion = document.getElementById("panel-comparacion");
  const pre = resumen?.pre;
  const post = resumen?.post;
  seccion.hidden = !pre || !post;
  if (seccion.hidden) return;

  document.getElementById("panel-comparacion-cuadricula").innerHTML = METRICAS_COMPARADAS.map((m) => {
    const antes = pre[m.clave];
    const despues = post[m.clave];
    return `
      <div class="comparacion__elemento">
        <p class="comparacion__etiqueta">${m.etiqueta}</p>
        <div class="comparacion__valores">
          <div><small>Antes</small><strong>${numero(antes, m.decimales)}</strong></div>
          <span class="comparacion__flecha" aria-hidden="true"><svg><use href="#i-flecha-derecha"/></svg></span>
          <div><small>Después</small><strong>${numero(despues, m.decimales)}${htmlTendencia(antes, despues, m.peorSiSube)}</strong></div>
        </div>
        <p class="comparacion__unidad tenue texto-menor">${m.unidad}</p>
      </div>`;
  }).join("");
}

function crearBoton(texto, clases, accion) {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = `boton ${clases}`;
  boton.textContent = texto;
  boton.addEventListener("click", accion);
  return boton;
}

function crearCuerpo(clase) {
  const cuerpo = document.createElement("div");
  cuerpo.className = clase;
  cuerpo.hidden = true;
  return cuerpo;
}

function crearDesplegable({ textoAbrir, textoCerrar, cuerpo, alAbrir, alCerrar }) {
  cuerpo.hidden = true;
  const boton = crearBoton(textoAbrir, "boton--enlace", () => {
    const abrir = cuerpo.hidden;
    cuerpo.hidden = !abrir;
    boton.setAttribute("aria-expanded", String(abrir));
    boton.textContent = abrir ? textoCerrar : textoAbrir;
    if (abrir) alAbrir(cuerpo);
    else alCerrar?.(cuerpo);
  });
  boton.setAttribute("aria-expanded", "false");
  return boton;
}

function crearResumen(sesion) {
  let liberar = null;
  const cuerpo = crearCuerpo("sesion-resumen__cuerpo");
  const boton = crearDesplegable({
    textoAbrir: "Ver resumen y gráficas",
    textoCerrar: "Ocultar resumen",
    cuerpo,
    alAbrir: (contenedor) => (liberar = pintarGraficasSesion(contenedor, sesion)),
    alCerrar: (contenedor) => {
      liberar?.();
      liberar = null;
      contenedor.innerHTML = "";
    },
  });
  const envoltura = document.createElement("div");
  envoltura.className = "sesion-resumen";
  envoltura.append(boton, cuerpo);
  if (sesion.id === sesionPorAbrir) {
    sesionPorAbrir = null;
    queueMicrotask(() => boton.click());
  }
  return envoltura;
}

async function cargarAnalisis(sesionId, contenedor) {
  contenedor.innerHTML = `<p class="tenue">Cargando análisis…</p>`;
  try {
    const diagnostico = await solicitar(`/sesiones/${sesionId}/diagnostico`);
    pintarDiagnostico(contenedor, diagnostico, "El análisis aún no está disponible para esta sesión.");
  } catch (err) {
    contenedor.innerHTML = `<p class="aviso aviso--error">No se pudo cargar el análisis: ${escaparHtml(err.message)}</p>`;
  }
}

function pintarEstadoAnalisis(sesionId, estado, zona, mensaje = "") {
  const { zonaEstado, cuerpo } = zona;
  zonaEstado.replaceChildren();
  cuerpo.hidden = true;
  cuerpo.replaceChildren();

  if (estado === "disponible") {
    zonaEstado.append(
      crearDesplegable({
        textoAbrir: "Ver análisis",
        textoCerrar: "Ocultar análisis",
        cuerpo,
        alAbrir: (contenedor) => {
          if (!contenedor.childElementCount) cargarAnalisis(sesionId, contenedor);
        },
      })
    );
    return;
  }
  if (estado === "pendiente") {
    zonaEstado.innerHTML = htmlCargando("Generando análisis…");
    return;
  }
  zonaEstado.innerHTML = `
    <span class="analisis-estado__texto analisis-estado__texto--error">
      <svg class="icono-en-linea" aria-hidden="true"><use href="#i-alerta"/></svg>
      ${escaparHtml(mensaje || "Análisis no disponible")}
    </span>`;
  zonaEstado.append(
    crearBoton("Reintentar", "boton--sutil boton--compacto", (e) => reintentarAnalisis(sesionId, zona, e.currentTarget))
  );
}

async function reintentarAnalisis(sesionId, zona, boton) {
  boton.disabled = true;
  try {
    const anterior = await solicitar(`/sesiones/${sesionId}/diagnostico`);
    await solicitar(`/sesiones/${sesionId}/diagnostico`, { method: "POST" });
    pintarEstadoAnalisis(sesionId, "pendiente", zona);
    esperarAnalisis(sesionId, anterior.generado_en, zona);
  } catch (err) {
    pintarEstadoAnalisis(sesionId, "no_disponible", zona, `No se pudo reintentar: ${err.message}`);
  }
}

const pausa = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

async function esperarAnalisis(sesionId, generadoAntes, zona) {
  const limite = Date.now() + ESPERA_MAXIMA_ANALISIS_MS;
  while (Date.now() < limite) {
    await pausa(CONSULTA_ANALISIS_MS);
    if (!zona.zonaEstado.isConnected) return;
    try {
      const diagnostico = await solicitar(`/sesiones/${sesionId}/diagnostico`);
      if (diagnostico.generado_en && diagnostico.generado_en !== generadoAntes) {
        pintarEstadoAnalisis(sesionId, diagnostico.disponible ? "disponible" : "no_disponible", zona);
        return;
      }
    } catch (err) {
      console.warn("Consulta del análisis fallida; se reintenta:", err.message);
    }
  }
  pintarEstadoAnalisis(sesionId, "no_disponible", zona, "El análisis tardó demasiado");
}

function crearFilaSesion(sesion) {
  const fila = document.createElement("article");
  fila.className = "sesion";
  const nivel = sesion.nivel_fatiga;
  const meta = [
    ACTIVIDAD_ETIQUETA[sesion.actividad] || sesion.actividad,
    duracion(sesion.iniciada_en, sesion.finalizada_en),
    `${sesion.mediciones.length} mediciones`,
  ];
  const kssFinal = sesion.kss_final !== null ? ` → ${sesion.kss_final}` : "";
  const kss = sesion.kss_inicial !== null
    ? `<span class="sesion__kss" title="Escala de somnolencia de Karolinska">KSS ${sesion.kss_inicial}${kssFinal}</span>`
    : "";
  const momento = sesion.momento
    ? `<span class="distintivo distintivo--${sesion.momento}">${MOMENTO_ETIQUETA[sesion.momento]}</span>`
    : "";

  fila.innerHTML = `
    <div class="sesion__principal">
      <div>
        <p class="sesion__fecha">${formatoFecha.format(new Date(sesion.iniciada_en))} ${momento}</p>
        <p class="sesion__meta tenue">${meta.map(escaparHtml).join(" · ")} ${kss}</p>
      </div>
      <span class="insignia ${nivel ? NIVEL_CLASE[nivel] : "insignia--neutral"}">${nivel ? NIVEL_ETIQUETA[nivel] : "Sin datos"}</span>
    </div>
  `;

  if (sesion.mediciones.length > 0) fila.append(crearResumen(sesion));
  if (sesion.estado_analisis !== "sin_datos") {
    const zona = { zonaEstado: document.createElement("div"), cuerpo: crearCuerpo("analisis") };
    zona.zonaEstado.className = "analisis-estado";
    fila.append(zona.zonaEstado, zona.cuerpo);
    pintarEstadoAnalisis(sesion.id, sesion.estado_analisis, zona);
    if (sesion.estado_analisis === "pendiente") esperarAnalisis(sesion.id, null, zona);
  }
  return fila;
}

const paginaDeSesiones = (pagina) =>
  solicitar(`/usuarios/yo/sesiones?pagina=${pagina}&por_pagina=${SESIONES_POR_PAGINA}`);

function agregarSesiones(pagina) {
  pagina.elementos.forEach((sesion) => lista.append(crearFilaSesion(sesion)));
  paginaActual = pagina.pagina;
  botonMas.hidden = pagina.pagina >= pagina.paginas;
}

async function actualizarPanel() {
  const vacio = document.getElementById("panel-sesiones-vacio");

  errorSesiones.hidden = true;
  vacio.hidden = true;
  botonMas.hidden = true;
  lista.innerHTML = htmlCargando("Cargando tus sesiones…", "p");
  lista.setAttribute("aria-busy", "true");

  let pagina;
  let resumen;
  try {
    pagina = await paginaDeSesiones(1);
    resumen = await solicitar("/usuarios/yo/resumen");
  } catch (err) {
    errorSesiones.textContent = `No se pudo cargar tu historial: ${err.message}`;
    errorSesiones.hidden = false;
  }
  lista.innerHTML = "";
  lista.removeAttribute("aria-busy");
  liberarGraficasHuerfanas();
  pintarDatos(resumen);
  pintarComparacion(resumen);
  if (!pagina) return;

  vacio.hidden = pagina.total > 0;
  agregarSesiones(pagina);
}

async function cargarMasSesiones() {
  botonMas.disabled = true;
  errorSesiones.hidden = true;
  try {
    agregarSesiones(await paginaDeSesiones(paginaActual + 1));
  } catch (err) {
    errorSesiones.textContent = `No se pudieron cargar más sesiones: ${err.message}`;
    errorSesiones.hidden = false;
  } finally {
    botonMas.disabled = false;
  }
}

botonMas.addEventListener("click", cargarMasSesiones);
document.getElementById("panel-boton-iniciar").addEventListener("click", mostrarMonitoreo);
document.getElementById("panel-boton-salir").addEventListener("click", () => {
  borrarSesion();
  location.reload();
});

alMostrarVista("panel", actualizarPanel);
