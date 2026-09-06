/**
 * Panel principal: resumen de sesiones a partir de GET /users/me/history
 * (RF07). Todo lo que se muestra aquí sale de datos reales ya guardados
 * por el backend — nada se inventa en el cliente.
 */

const NIVEL_ORDEN = { sin_fatiga: 0, leve: 1, moderada: 2 };
const NIVEL_LABEL = { sin_fatiga: "Sin fatiga", leve: "Fatiga leve", moderada: "Fatiga moderada" };
const NIVEL_CLASE = { sin_fatiga: "badge--ok", leve: "badge--leve", moderada: "badge--moderada" };
const MOMENTO_LABEL = { pre: "Pre-jornada", post: "Post-jornada" };

const dateFormatter = new Intl.DateTimeFormat("es-EC", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function peorNivel(mediciones) {
  return mediciones.reduce((peor, m) => {
    if (!m.nivel_fatiga) return peor;
    if (peor === null || NIVEL_ORDEN[m.nivel_fatiga] > NIVEL_ORDEN[peor]) return m.nivel_fatiga;
    return peor;
  }, null);
}

function formatDuracion(iniciada, finalizada) {
  if (!finalizada) return "En curso";
  const ms = new Date(finalizada) - new Date(iniciada);
  const minutos = Math.floor(ms / 60000);
  const segundos = Math.round((ms % 60000) / 1000);
  if (minutos <= 0) return `${segundos}s`;
  return `${minutos} min`;
}

function renderStats(sesiones) {
  const total = sesiones.length;
  const unaSemanaAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const estaSemana = sesiones.filter((s) => new Date(s.iniciada_en).getTime() >= unaSemanaAtras).length;
  const conAlerta = sesiones.filter((s) => {
    const peor = peorNivel(s.mediciones);
    return peor === "leve" || peor === "moderada";
  }).length;
  const ultima = sesiones[0] ? dateFormatter.format(new Date(sesiones[0].iniciada_en)) : "–";

  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-week").textContent = estaSemana;
  document.getElementById("stat-alerts").textContent = conAlerta;
  document.getElementById("stat-last").textContent = ultima;
}

async function toggleDiagnostico(sesionId, container) {
  const isOpen = !container.hidden;
  if (isOpen) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  if (container.dataset.loaded === "true") return;
  container.textContent = "Cargando diagnóstico…";

  try {
    const data = await apiFetch(`/sessions/${sesionId}/diagnosis`);
    container.textContent = data.disponible && data.texto
      ? data.texto
      : "El diagnóstico todavía no está disponible para esta sesión.";
    container.dataset.loaded = "true";
  } catch (err) {
    container.textContent = `No se pudo cargar el diagnóstico: ${err.message}`;
  }
}

function renderSessionRow(sesion) {
  const row = document.createElement("article");
  row.className = "session-row";

  const peor = peorNivel(sesion.mediciones);
  const badgeLabel = peor ? NIVEL_LABEL[peor] : "Sin datos";
  const badgeClase = peor ? NIVEL_CLASE[peor] : "badge--neutral";

  row.innerHTML = `
    <div class="session-row__main">
      <div class="session-row__info">
        <p class="session-row__date">${dateFormatter.format(new Date(sesion.iniciada_en))}</p>
        <p class="session-row__meta">${sesion.actividad}${sesion.momento ? " · " + MOMENTO_LABEL[sesion.momento] : ""} · ${formatDuracion(sesion.iniciada_en, sesion.finalizada_en)} · ${sesion.mediciones.length} mediciones</p>
      </div>
      <span class="badge ${badgeClase}">${badgeLabel}</span>
    </div>
  `;

  if (peor === "leve" || peor === "moderada") {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "session-row__toggle";
    toggle.textContent = "Ver diagnóstico";

    const diagBox = document.createElement("p");
    diagBox.className = "session-row__diagnosis";
    diagBox.hidden = true;

    toggle.addEventListener("click", () => toggleDiagnostico(sesion.id, diagBox));

    row.appendChild(toggle);
    row.appendChild(diagBox);
  }

  return row;
}

async function refreshDashboard() {
  const list = document.getElementById("dash-sessions-list");
  const empty = document.getElementById("dash-sessions-empty");
  const errorEl = document.getElementById("dash-sessions-error");

  errorEl.hidden = true;
  empty.hidden = true;
  list.innerHTML = "";

  let sesiones;
  try {
    sesiones = await apiFetch("/users/me/history");
  } catch (err) {
    errorEl.textContent = `No se pudo cargar tu historial: ${err.message}`;
    errorEl.hidden = false;
    renderStats([]);
    return;
  }

  renderStats(sesiones);

  if (sesiones.length === 0) {
    empty.hidden = false;
    return;
  }

  sesiones.slice(0, 8).forEach((sesion) => list.appendChild(renderSessionRow(sesion)));
}

document.getElementById("dash-start-btn").addEventListener("click", () => {
  showMonitoreoView();
});

document.getElementById("dash-logout-btn").addEventListener("click", () => {
  clearSession();
  location.reload();
});
