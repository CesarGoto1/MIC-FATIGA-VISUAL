const ESTADO_ANALISIS_LABEL = {
  disponible: "Disponible",
  pendiente: "Pendiente",
  no_disponible: "No disponible",
  sin_datos: "Sin datos",
};

const adminFiltros = document.getElementById("admin-filtros");
const adminDetalle = document.getElementById("admin-detalle");
let liberarGraficasAdmin = null;

function filtrosAdmin() {
  const params = new URLSearchParams();
  const valores = {
    participante: document.getElementById("admin-filtro-participante").value,
    momento: document.getElementById("admin-filtro-momento").value,
    desde: document.getElementById("admin-filtro-desde").value,
    hasta: document.getElementById("admin-filtro-hasta").value,
  };
  Object.entries(valores).forEach(([clave, valor]) => {
    if (valor) params.set(clave, valor);
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

function mostrarErrorAdmin(id, mensaje) {
  const el = document.getElementById(id);
  el.textContent = mensaje;
  el.hidden = !mensaje;
}

function formatFecha(iso) {
  return iso ? dateFormatter.format(new Date(iso)) : "–";
}

async function cargarParticipantes() {
  const tbody = document.getElementById("admin-participantes");
  const select = document.getElementById("admin-filtro-participante");
  mostrarErrorAdmin("admin-participantes-error", "");
  try {
    const participantes = await apiFetch("/admin/participantes");
    tbody.innerHTML = participantes
      .map(
        (p) => `<tr><td><strong>${escapeHtml(p.codigo)}</strong></td><td>${p.sesiones}</td><td>${p.sesiones_pre}</td>
          <td>${p.sesiones_post}</td><td>${formatFecha(p.ultima_sesion)}</td></tr>`
      )
      .join("");
    const actual = select.value;
    select.innerHTML =
      `<option value="">Todos</option>` +
      participantes.map((p) => `<option value="${escapeHtml(p.codigo)}">${escapeHtml(p.codigo)}</option>`).join("");
    select.value = actual;
  } catch (err) {
    tbody.innerHTML = "";
    mostrarErrorAdmin("admin-participantes-error", `No se pudo cargar la lista de participantes: ${err.message}`);
  }
}

function renderFilaSesion(sesion) {
  const row = document.createElement("tr");
  row.className = "admin-row";
  row.tabIndex = 0;
  const nivel = sesion.nivel_fatiga_tramo_final;
  const kss = sesion.kss_inicial !== null ? `${sesion.kss_inicial}${sesion.kss_final !== null ? ` → ${sesion.kss_final}` : ""}` : "–";
  const somnolencia = sesion.somnolencia_tramo_final === null
    ? "–"
    : `${sesion.somnolencia_tramo_final ? "Sí" : "No"} (${sesion.mediciones_con_somnolencia} min)`;
  row.innerHTML = `
    <td>#${sesion.id}</td>
    <td><strong>${escapeHtml(sesion.participante)}</strong></td>
    <td>${formatFecha(sesion.iniciada_en)}</td>
    <td>${escapeHtml(ACTIVIDAD_LABEL[sesion.actividad] || sesion.actividad)}</td>
    <td>${sesion.momento ? `<span class="chip chip--${sesion.momento}">${MOMENTO_LABEL[sesion.momento]}</span>` : "–"}</td>
    <td>${kss}</td>
    <td>${sesion.duracion_min !== null ? `${sesion.duracion_min} min` : "Sin finalizar"}</td>
    <td>${sesion.num_mediciones}</td>
    <td>${nivel ? `<span class="badge ${NIVEL_CLASE[nivel]}">${NIVEL_LABEL[nivel]}</span>` : "–"}</td>
    <td>${somnolencia}</td>
    <td>${ESTADO_ANALISIS_LABEL[sesion.estado_analisis]}</td>`;
  const abrir = () => abrirDetalleSesion(sesion.id);
  row.addEventListener("click", abrir);
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      abrir();
    }
  });
  return row;
}

async function cargarSesionesAdmin() {
  const tbody = document.getElementById("admin-sesiones");
  const empty = document.getElementById("admin-sesiones-empty");
  mostrarErrorAdmin("admin-sesiones-error", "");
  empty.hidden = true;
  tbody.innerHTML = "";
  try {
    const sesiones = await apiFetch(`/admin/sesiones${filtrosAdmin()}`);
    sesiones.forEach((s) => tbody.append(renderFilaSesion(s)));
    empty.hidden = sesiones.length > 0;
  } catch (err) {
    mostrarErrorAdmin("admin-sesiones-error", `No se pudieron cargar las sesiones: ${err.message}`);
  }
}

function cerrarDetalleSesion() {
  liberarGraficasAdmin?.();
  liberarGraficasAdmin = null;
  document.getElementById("admin-detalle-graficas").innerHTML = "";
  adminDetalle.hidden = true;
}

async function abrirDetalleSesion(sesionId) {
  cerrarDetalleSesion();
  const graficas = document.getElementById("admin-detalle-graficas");
  const diagnostico = document.getElementById("admin-detalle-diagnostico");
  adminDetalle.hidden = false;
  document.getElementById("admin-detalle-titulo").textContent = `Sesión #${sesionId}`;
  document.getElementById("admin-detalle-meta").textContent = "";
  graficas.innerHTML = `<p class="analysis-status__text"><span class="spinner" aria-hidden="true"></span>Cargando sesión…</p>`;
  diagnostico.innerHTML = "";
  adminDetalle.scrollIntoView({ behavior: "smooth", block: "start" });

  let sesion;
  try {
    sesion = await apiFetch(`/admin/sesiones/${sesionId}`);
  } catch (err) {
    graficas.innerHTML = `<p class="notice notice--error">No se pudo cargar la sesión: ${escapeHtml(err.message)}</p>`;
    return;
  }

  document.getElementById("admin-detalle-titulo").textContent = `Sesión #${sesion.id} · ${sesion.participante}`;
  document.getElementById("admin-detalle-meta").textContent = [
    formatFecha(sesion.iniciada_en),
    ACTIVIDAD_LABEL[sesion.actividad] || sesion.actividad,
    sesion.momento ? MOMENTO_LABEL[sesion.momento] : null,
    `${sesion.num_mediciones} mediciones`,
  ]
    .filter(Boolean)
    .join(" · ");

  if (sesion.mediciones.length > 0) {
    liberarGraficasAdmin = Charts.renderSession(graficas, sesion);
  } else {
    graficas.innerHTML = `<p class="muted">Esta sesión no tiene mediciones.</p>`;
  }

  const diag = sesion.diagnostico;
  if (diag.disponible && diag.detalle) {
    diagnostico.innerHTML = renderAnalisis(diag.detalle);
  } else if (diag.disponible && diag.texto) {
    diagnostico.textContent = diag.texto;
  } else {
    diagnostico.innerHTML = `<p class="muted">Diagnóstico: ${ESTADO_ANALISIS_LABEL[sesion.estado_analisis].toLowerCase()}.</p>`;
  }
}

async function exportarCsv(boton, ruta, nombre) {
  boton.disabled = true;
  mostrarErrorAdmin("admin-sesiones-error", "");
  try {
    await apiDownload(`${ruta}${filtrosAdmin()}`, nombre);
  } catch (err) {
    mostrarErrorAdmin("admin-sesiones-error", `No se pudo exportar: ${err.message}`);
  } finally {
    boton.disabled = false;
  }
}

function refreshAdmin() {
  cerrarDetalleSesion();
  cargarParticipantes();
  cargarSesionesAdmin();
}

adminFiltros.addEventListener("submit", (e) => {
  e.preventDefault();
  cerrarDetalleSesion();
  cargarSesionesAdmin();
});

document.getElementById("admin-export-sesiones").addEventListener("click", (e) =>
  exportarCsv(e.currentTarget, "/admin/export/sesiones.csv", "sesiones.csv")
);
document.getElementById("admin-export-mediciones").addEventListener("click", (e) =>
  exportarCsv(e.currentTarget, "/admin/export/mediciones.csv", "mediciones.csv")
);
document.getElementById("admin-detalle-cerrar").addEventListener("click", cerrarDetalleSesion);
document.getElementById("admin-back-btn").addEventListener("click", () => {
  cerrarDetalleSesion();
  showDashboardView();
});
document.getElementById("dash-admin-btn").addEventListener("click", showAdminView);
