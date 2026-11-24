import { liberarGrabacion, mostrarGrabacion } from "./admin-grabacion.js";
import { pintarDiagnostico } from "./analisis.js";
import { descargar, solicitar, solicitarTodo } from "./api.js";
import {
  ACTIVIDAD_ETIQUETA,
  MOMENTO_ETIQUETA,
  NIVEL_CLASE,
  NIVEL_ETIQUETA,
  alActivar,
  escaparHtml,
  fecha,
  htmlCargando,
} from "./formato.js";
import { pintarGraficasSesion } from "./graficas.js";
import { alMostrarVista, mostrarAdmin, mostrarPanel } from "./vistas.js";

const ETIQUETA_ESTADO_ANALISIS = {
  disponible: "Disponible",
  pendiente: "Pendiente",
  no_disponible: "No disponible",
  sin_datos: "Sin datos",
};
const FILTROS = ["participante", "momento", "desde", "hasta"];
const SESIONES_POR_PAGINA = 20;

const formularioFiltros = document.getElementById("admin-filtros");
const detalle = document.getElementById("admin-detalle");
const graficasDetalle = document.getElementById("admin-detalle-graficas");
const diagnosticoDetalle = document.getElementById("admin-detalle-diagnostico");
const tituloDetalle = document.getElementById("admin-detalle-titulo");
const metaDetalle = document.getElementById("admin-detalle-meta");
const selectorParticipante = document.getElementById("admin-filtro-participante");
const paginador = document.getElementById("admin-sesiones-paginacion");
const textoPagina = document.getElementById("admin-sesiones-pagina");
const botonAnterior = document.getElementById("admin-sesiones-anterior");
const botonSiguiente = document.getElementById("admin-sesiones-siguiente");

let liberarGraficas = null;
let paginaSesiones = 1;

function consultaFiltros(extra = {}) {
  const parametros = new URLSearchParams(extra);
  FILTROS.forEach((filtro) => {
    const valor = document.getElementById(`admin-filtro-${filtro}`).value;
    if (valor) parametros.set(filtro, valor);
  });
  const consulta = parametros.toString();
  return consulta ? `?${consulta}` : "";
}

function mostrarError(id, mensaje) {
  const elemento = document.getElementById(id);
  elemento.textContent = mensaje;
  elemento.hidden = !mensaje;
}

const textoInterruptor = (activo) => (activo ? "Activada" : "Desactivada");

function filaParticipante(p) {
  const codigo = escaparHtml(p.codigo);
  return `<tr><td><strong>${codigo}</strong></td><td>${p.sesiones}</td><td>${p.sesiones_pre}</td>
    <td>${p.sesiones_post}</td><td>${fecha(p.ultima_sesion)}</td>
    <td><label class="interruptor-admin"><input type="checkbox" data-codigo="${codigo}" ${p.grabacion_habilitada ? "checked" : ""} />
    <span>${textoInterruptor(p.grabacion_habilitada)}</span></label></td></tr>`;
}

async function cargarParticipantes() {
  const tabla = document.getElementById("admin-participantes");
  mostrarError("admin-participantes-error", "");
  try {
    const participantes = await solicitarTodo("/admin/participantes");
    tabla.innerHTML = participantes.map(filaParticipante).join("");
    tabla.querySelectorAll("input[data-codigo]").forEach((casilla) => casilla.addEventListener("change", cambiarGrabacion));
    const elegido = selectorParticipante.value;
    selectorParticipante.innerHTML =
      `<option value="">Todos</option>` +
      participantes.map((p) => `<option value="${escaparHtml(p.codigo)}">${escaparHtml(p.codigo)}</option>`).join("");
    selectorParticipante.value = elegido;
  } catch (err) {
    tabla.innerHTML = "";
    mostrarError("admin-participantes-error", `No se pudo cargar la lista de participantes: ${err.message}`);
  }
}

async function cambiarGrabacion(e) {
  const casilla = e.currentTarget;
  casilla.disabled = true;
  mostrarError("admin-participantes-error", "");
  try {
    const participante = await solicitar(`/admin/participantes/${casilla.dataset.codigo}`, {
      method: "PATCH",
      body: JSON.stringify({ grabacion_habilitada: casilla.checked }),
    });
    casilla.checked = participante.grabacion_habilitada;
  } catch (err) {
    casilla.checked = !casilla.checked;
    mostrarError("admin-participantes-error", `No se pudo cambiar la grabación: ${err.message}`);
  } finally {
    casilla.nextElementSibling.textContent = textoInterruptor(casilla.checked);
    casilla.disabled = false;
  }
}

function textoKss({ kss_inicial: inicial, kss_final: final }) {
  if (inicial === null) return "–";
  return final !== null ? `${inicial} → ${final}` : `${inicial}`;
}

function textoSomnolencia(sesion) {
  if (sesion.somnolencia_tramo_final === null) return "–";
  return `${sesion.somnolencia_tramo_final ? "Sí" : "No"} (${sesion.mediciones_con_somnolencia} min)`;
}

function textoGrabacion(sesion) {
  if (sesion.tiene_grabacion) return "Sí";
  return sesion.grabacion_consentida === false ? "Rechazada" : "–";
}

function filaSesion(sesion) {
  const fila = document.createElement("tr");
  fila.className = "fila-admin";
  fila.tabIndex = 0;
  const nivel = sesion.nivel_fatiga_tramo_final;
  const momento = sesion.momento
    ? `<span class="distintivo distintivo--${sesion.momento}">${MOMENTO_ETIQUETA[sesion.momento]}</span>`
    : "–";
  fila.innerHTML = `
    <td>#${sesion.id}</td>
    <td><strong>${escaparHtml(sesion.participante)}</strong></td>
    <td>${fecha(sesion.iniciada_en)}</td>
    <td>${escaparHtml(ACTIVIDAD_ETIQUETA[sesion.actividad] || sesion.actividad)}</td>
    <td>${momento}</td>
    <td>${textoKss(sesion)}</td>
    <td>${sesion.duracion_min !== null ? `${sesion.duracion_min} min` : "Sin finalizar"}</td>
    <td>${sesion.num_mediciones}</td>
    <td>${sesion.parpadeos_completos}</td>
    <td>${sesion.parpadeos_incompletos}</td>
    <td>${textoGrabacion(sesion)}</td>
    <td>${nivel ? `<span class="insignia ${NIVEL_CLASE[nivel]}">${NIVEL_ETIQUETA[nivel]}</span>` : "–"}</td>
    <td>${textoSomnolencia(sesion)}</td>
    <td>${ETIQUETA_ESTADO_ANALISIS[sesion.estado_analisis]}</td>`;
  alActivar(fila, () => abrirDetalle(sesion.id));
  return fila;
}

function pintarPaginador({ pagina, paginas, total }) {
  paginador.hidden = paginas <= 1;
  textoPagina.textContent = `Página ${pagina} de ${paginas} · ${total} sesiones`;
  botonAnterior.disabled = pagina <= 1;
  botonSiguiente.disabled = pagina >= paginas;
}

async function cargarSesiones(pagina = paginaSesiones) {
  const tabla = document.getElementById("admin-sesiones");
  const vacio = document.getElementById("admin-sesiones-vacio");
  mostrarError("admin-sesiones-error", "");
  vacio.hidden = true;
  paginador.hidden = true;
  tabla.replaceChildren();
  try {
    const respuesta = await solicitar(
      `/admin/sesiones${consultaFiltros({ pagina, por_pagina: SESIONES_POR_PAGINA })}`
    );
    if (respuesta.elementos.length === 0 && pagina > 1) {
      cargarSesiones(Math.max(respuesta.paginas, 1));
      return;
    }
    paginaSesiones = respuesta.pagina;
    tabla.replaceChildren(...respuesta.elementos.map(filaSesion));
    vacio.hidden = respuesta.total > 0;
    pintarPaginador(respuesta);
  } catch (err) {
    mostrarError("admin-sesiones-error", `No se pudieron cargar las sesiones: ${err.message}`);
  }
}

function cerrarDetalle() {
  liberarGraficas?.();
  liberarGraficas = null;
  graficasDetalle.replaceChildren();
  liberarGrabacion();
  detalle.hidden = true;
  detalle.dataset.sesionId = "";
}

function textoMeta(sesion) {
  return [
    fecha(sesion.iniciada_en),
    ACTIVIDAD_ETIQUETA[sesion.actividad] || sesion.actividad,
    sesion.momento ? MOMENTO_ETIQUETA[sesion.momento] : null,
    `${sesion.num_mediciones} mediciones`,
    `${sesion.parpadeos_completos} parpadeos completos`,
    `${sesion.parpadeos_incompletos} incompletos`,
    `${sesion.cierres_prolongados_total} cierres prolongados`,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function abrirDetalle(sesionId) {
  cerrarDetalle();
  detalle.hidden = false;
  detalle.dataset.sesionId = sesionId;
  tituloDetalle.textContent = `Sesión #${sesionId}`;
  metaDetalle.textContent = "";
  graficasDetalle.innerHTML = htmlCargando("Cargando sesión…", "p");
  diagnosticoDetalle.replaceChildren();
  detalle.scrollIntoView({ behavior: "smooth", block: "start" });

  let sesion;
  try {
    sesion = await solicitar(`/admin/sesiones/${sesionId}`);
  } catch (err) {
    graficasDetalle.innerHTML = `<p class="aviso aviso--error">No se pudo cargar la sesión: ${escaparHtml(err.message)}</p>`;
    return;
  }

  tituloDetalle.textContent = `Sesión #${sesion.id} · ${sesion.participante}`;
  metaDetalle.textContent = textoMeta(sesion);
  if (sesion.mediciones.length > 0) {
    liberarGraficas = pintarGraficasSesion(graficasDetalle, sesion);
  } else {
    graficasDetalle.innerHTML = `<p class="tenue">Esta sesión no tiene mediciones.</p>`;
  }
  if (sesion.grabacion) mostrarGrabacion(sesion, { alEliminar: () => cargarSesiones() });
  pintarDiagnostico(
    diagnosticoDetalle,
    sesion.diagnostico,
    `Diagnóstico: ${ETIQUETA_ESTADO_ANALISIS[sesion.estado_analisis].toLowerCase()}.`
  );
}

async function exportarCsv(boton, ruta, nombreArchivo) {
  boton.disabled = true;
  mostrarError("admin-sesiones-error", "");
  try {
    await descargar(ruta, nombreArchivo);
  } catch (err) {
    mostrarError("admin-sesiones-error", `No se pudo exportar: ${err.message}`);
  } finally {
    boton.disabled = false;
  }
}

function actualizarAdmin() {
  cerrarDetalle();
  cargarParticipantes();
  cargarSesiones(1);
}

formularioFiltros.addEventListener("submit", (e) => {
  e.preventDefault();
  cerrarDetalle();
  cargarSesiones(1);
});

botonAnterior.addEventListener("click", () => cargarSesiones(paginaSesiones - 1));
botonSiguiente.addEventListener("click", () => cargarSesiones(paginaSesiones + 1));

["sesiones", "mediciones", "parpadeos"].forEach((tabla) => {
  document.getElementById(`admin-exportar-${tabla}`).addEventListener("click", (e) =>
    exportarCsv(e.currentTarget, `/admin/exportaciones/${tabla}.csv${consultaFiltros()}`, `${tabla}.csv`)
  );
});

document.getElementById("admin-detalle-exportar-parpadeos").addEventListener("click", (e) => {
  const id = detalle.dataset.sesionId;
  if (id) exportarCsv(e.currentTarget, `/admin/exportaciones/parpadeos.csv?sesion_id=${id}`, `parpadeos_sesion_${id}.csv`);
});
document.getElementById("admin-detalle-cerrar").addEventListener("click", cerrarDetalle);
document.getElementById("admin-boton-volver").addEventListener("click", () => {
  cerrarDetalle();
  mostrarPanel();
});
document.getElementById("panel-boton-admin").addEventListener("click", mostrarAdmin);

alMostrarVista("admin", actualizarAdmin);
