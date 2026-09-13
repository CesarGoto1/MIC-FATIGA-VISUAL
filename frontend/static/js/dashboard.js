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

const PARAMETRO_LABEL = {
  perclos: "PERCLOS",
  sebr: "Frecuencia de parpadeo",
  tiempo_cierre: "Tiempo de cierre",
  velocidad_ocular: "Velocidad ocular",
  nivel_subjetivo: "Nivel subjetivo",
};

const SEVERIDAD_CLASE = {
  Leve: "badge--ok",
  Moderada: "badge--leve",
  Alta: "badge--moderada",
  Severa: "badge--moderada",
};

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function renderDiagnosticoDetalle(detalle) {
  const severidad = detalle.severidad_fatiga_final || "";
  const severidadClase = SEVERIDAD_CLASE[severidad] || "";

  const parametrosHtml = Object.entries(detalle.evaluacion_parametros || {})
    .map(([clave, valor]) => `
      <div class="diagnosis-param">
        <p class="diagnosis-param__titulo">${escapeHtml(PARAMETRO_LABEL[clave] || clave)}
          <span class="diagnosis-param__valores">${escapeHtml(valor.valor_inicial)} → ${escapeHtml(valor.valor_final)}</span>
        </p>
        <p class="diagnosis-param__texto">${escapeHtml(valor.interpretacion)}</p>
        <p class="diagnosis-param__texto"><strong>Recomendación:</strong> ${escapeHtml(valor.recomendacion)}</p>
      </div>
    `)
    .join("");

  const recomendacionesHtml = (detalle.recomendaciones_generales || [])
    .map((rec) => `<li>${escapeHtml(rec)}</li>`)
    .join("");

  return `
    <p class="diagnosis-summary">${escapeHtml(detalle.diagnostico_general)}</p>
    ${severidad ? `<span class="badge ${severidadClase}">Severidad: ${escapeHtml(severidad)}</span>` : ""}
    ${parametrosHtml}
    ${recomendacionesHtml ? `<ul class="diagnosis-recs">${recomendacionesHtml}</ul>` : ""}
  `;
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
    if (data.disponible && data.detalle) {
      container.innerHTML = renderDiagnosticoDetalle(data.detalle);
    } else if (data.disponible && data.texto) {
      container.textContent = data.texto;
    } else {
      container.textContent = "El diagnóstico todavía no está disponible para esta sesión.";
    }
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

    const diagBox = document.createElement("div");
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
