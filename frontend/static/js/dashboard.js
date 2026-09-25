const NIVEL_ORDEN = { sin_fatiga: 0, leve: 1, moderada: 2 };
const NIVEL_LABEL = { sin_fatiga: "Sin fatiga", leve: "Fatiga leve", moderada: "Fatiga moderada" };
const NIVEL_CLASE = { sin_fatiga: "badge--ok", leve: "badge--leve", moderada: "badge--moderada" };
const MOMENTO_LABEL = { pre: "Antes de la jornada", post: "Después de la jornada" };
const ACTIVIDAD_LABEL = { lectura: "Lectura PDF", video: "Video", libre: "Solo monitoreo" };

const dateFormatter = new Intl.DateTimeFormat("es-EC", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function peorNivel(mediciones) {
  return mediciones.reduce((peor, m) => {
    if (!m.nivel_fatiga) return peor;
    if (peor === null || NIVEL_ORDEN[m.nivel_fatiga] > NIVEL_ORDEN[peor]) return m.nivel_fatiga;
    return peor;
  }, null);
}

function formatDuracion(iniciada, finalizada) {
  if (!finalizada) return "Sin finalizar";
  const ms = new Date(finalizada) - new Date(iniciada);
  const minutos = Math.floor(ms / 60000);
  if (minutos <= 0) return `${Math.round(ms / 1000)} s`;
  return `${minutos} min`;
}

function promedio(valores) {
  const limpios = valores.filter((v) => v !== null && v !== undefined);
  if (limpios.length === 0) return null;
  return limpios.reduce((a, b) => a + b, 0) / limpios.length;
}

function renderStats(sesiones) {
  const unaSemanaAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const estaSemana = sesiones.filter((s) => new Date(s.iniciada_en).getTime() >= unaSemanaAtras).length;
  const conAlerta = sesiones.filter((s) => {
    const peor = peorNivel(s.mediciones);
    return peor === "leve" || peor === "moderada";
  }).length;

  document.getElementById("stat-total").textContent = sesiones.length;
  document.getElementById("stat-week").textContent = estaSemana;
  document.getElementById("stat-alerts").textContent = conAlerta;
  document.getElementById("stat-last").textContent = sesiones[0]
    ? dateFormatter.format(new Date(sesiones[0].iniciada_en))
    : "–";
}

// ---------- Comparativa antes / después ----------
// Solo descriptiva: promedia las mediciones de las sesiones de cada momento.

const COMPARE_METRICAS = [
  { clave: "perclos", label: "PERCLOS", unidad: "%", decimales: 1, peorSiSube: true },
  { clave: "parpadeos_min", label: "Parpadeos", unidad: "/min", decimales: 1, peorSiSube: false },
  { clave: "tiempo_cierre", label: "Cierre medio", unidad: "ms", decimales: 0, peorSiSube: true },
  { clave: "kss", label: "Somnolencia (KSS)", unidad: "/9", decimales: 1, peorSiSube: true },
];

function resumenPorMomento(sesiones, momento) {
  const delMomento = sesiones.filter((s) => s.momento === momento && s.mediciones.length > 0);
  if (delMomento.length === 0) return null;
  const mediciones = delMomento.flatMap((s) => s.mediciones);
  const resumen = { sesiones: delMomento.length, kss: promedio(delMomento.map((s) => s.kss_inicial)) };
  COMPARE_METRICAS.filter((m) => m.clave !== "kss").forEach(({ clave }) => {
    resumen[clave] = promedio(mediciones.map((m) => m[clave]));
  });
  return resumen;
}

function formatValor(valor, decimales) {
  return valor === null ? "–" : valor.toFixed(decimales);
}

function renderCompare(sesiones) {
  const section = document.getElementById("dash-compare");
  const pre = resumenPorMomento(sesiones, "pre");
  const post = resumenPorMomento(sesiones, "post");
  if (!pre || !post) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  document.getElementById("dash-compare-grid").innerHTML = COMPARE_METRICAS.map((m) => {
    const antes = pre[m.clave];
    const despues = post[m.clave];
    let tendencia = "";
    if (antes !== null && despues !== null && antes !== despues) {
      const empeora = despues > antes === m.peorSiSube;
      tendencia = `<span class="trend trend--${empeora ? "bad" : "good"}">${despues > antes ? "▲" : "▼"}</span>`;
    }
    return `
      <div class="compare__item">
        <p class="compare__label">${m.label}</p>
        <div class="compare__values">
          <div><small>Antes</small><strong>${formatValor(antes, m.decimales)}</strong></div>
          <span class="compare__arrow" aria-hidden="true">→</span>
          <div><small>Después</small><strong>${formatValor(despues, m.decimales)}${tendencia}</strong></div>
        </div>
        <p class="compare__unit muted small">${m.unidad}</p>
      </div>`;
  }).join("");
}

// ---------- Análisis interpretativo (n8n + Gemini) ----------

const PARAMETRO_LABEL = {
  perclos: "PERCLOS",
  parpadeos_min: "Frecuencia de parpadeo",
  sebr: "Frecuencia de parpadeo",
  tiempo_cierre: "Tiempo de cierre",
  velocidad_ocular: "Movimiento ocular",
  kss: "Somnolencia (KSS)",
};

// Misma escala de color que NIVEL_CLASE: el nivel de la IA y el de las reglas se ven igual.
const SEVERIDAD_CLASE = {
  "sin fatiga": "badge--ok",
  leve: "badge--leve",
  moderada: "badge--moderada",
  alta: "badge--alta",
  severa: "badge--alta",
};

function claseSeveridad(nivel) {
  return SEVERIDAD_CLASE[nivel.trim().toLowerCase()] || "badge--neutral";
}

function formatParametro(valor) {
  return typeof valor === "number" ? Number(valor.toFixed(2)) : valor ?? "–";
}

function renderAnalisis(detalle) {
  // Se aceptan también las claves del flujo anterior para no romper sesiones ya guardadas.
  const resumen = detalle.resumen_general ?? detalle.diagnostico_general;
  const nivel = detalle.nivel_fatiga_final ?? detalle.severidad_fatiga_final ?? "";

  // JSONB no conserva el orden de las claves: se ordenan según PARAMETRO_LABEL.
  const orden = Object.keys(PARAMETRO_LABEL);
  const posicion = (clave) => (orden.includes(clave) ? orden.indexOf(clave) : orden.length);
  const parametros = Object.entries(detalle.evaluacion_parametros || {})
    .sort(([a], [b]) => posicion(a) - posicion(b))
    .map(([clave, valor]) => `
      <div class="analysis__param">
        <p class="analysis__param-title">${escapeHtml(PARAMETRO_LABEL[clave] || clave)}
          <span class="analysis__param-values">${escapeHtml(formatParametro(valor.valor_inicial))} → ${escapeHtml(formatParametro(valor.valor_final))}</span>
        </p>
        <p>${escapeHtml(valor.interpretacion)}</p>
        <p class="analysis__rec">${escapeHtml(valor.recomendacion)}</p>
      </div>`)
    .join("");

  const recomendaciones = (detalle.recomendaciones_generales || [])
    .map((rec) => `<li>${escapeHtml(rec)}</li>`)
    .join("");

  return `
    <div class="analysis__head">
      <span class="analysis__tag"><svg aria-hidden="true"><use href="#i-sparkle"/></svg> Análisis generado con IA</span>
      ${nivel ? `<span class="badge ${claseSeveridad(nivel)}">${escapeHtml(nivel)}</span>` : ""}
    </div>
    <p class="analysis__summary">${escapeHtml(resumen)}</p>
    <div class="analysis__params">${parametros}</div>
    ${recomendaciones ? `<h4>Recomendaciones</h4><ul class="analysis__recs">${recomendaciones}</ul>` : ""}
    <p class="analysis__disclaimer">${escapeHtml(detalle.aviso || "Análisis orientativo y preventivo; no reemplaza la evaluación de un profesional de la salud visual.")}</p>
  `;
}

async function toggleAnalisis(sesionId, container, toggle) {
  const abrir = container.hidden;
  container.hidden = !abrir;
  toggle.setAttribute("aria-expanded", String(abrir));
  toggle.textContent = abrir ? "Ocultar análisis" : "Ver análisis";
  if (!abrir || container.dataset.loaded === "true") return;

  container.innerHTML = `<p class="muted">Cargando análisis…</p>`;
  try {
    const data = await apiFetch(`/sessions/${sesionId}/diagnosis`);
    if (data.disponible && data.detalle) {
      container.innerHTML = renderAnalisis(data.detalle);
    } else if (data.disponible && data.texto) {
      container.textContent = data.texto;
    } else {
      container.innerHTML = `<p class="muted">El análisis aún no está disponible para esta sesión.</p>`;
    }
    container.dataset.loaded = "true";
  } catch (err) {
    container.innerHTML = `<p class="notice notice--error">No se pudo cargar el análisis: ${escapeHtml(err.message)}</p>`;
  }
}

function renderSessionRow(sesion) {
  const row = document.createElement("article");
  row.className = "session";

  const peor = peorNivel(sesion.mediciones);
  const badgeLabel = peor ? NIVEL_LABEL[peor] : "Sin datos";
  const badgeClase = peor ? NIVEL_CLASE[peor] : "badge--neutral";

  const meta = [
    ACTIVIDAD_LABEL[sesion.actividad] || sesion.actividad,
    formatDuracion(sesion.iniciada_en, sesion.finalizada_en),
    `${sesion.mediciones.length} mediciones`,
  ];
  const kss =
    sesion.kss_inicial !== null
      ? `<span class="session__kss" title="Escala de somnolencia de Karolinska">KSS ${sesion.kss_inicial}${sesion.kss_final !== null ? ` → ${sesion.kss_final}` : ""}</span>`
      : "";

  row.innerHTML = `
    <div class="session__main">
      <div>
        <p class="session__date">${dateFormatter.format(new Date(sesion.iniciada_en))}
          ${sesion.momento ? `<span class="chip chip--${sesion.momento}">${MOMENTO_LABEL[sesion.momento]}</span>` : ""}
        </p>
        <p class="session__meta muted">${meta.map(escapeHtml).join(" · ")} ${kss}</p>
      </div>
      <span class="badge ${badgeClase}">${badgeLabel}</span>
    </div>
  `;

  if (sesion.estado_analisis !== "sin_datos") {
    const status = document.createElement("div");
    status.className = "analysis-status";
    const box = document.createElement("div");
    box.className = "analysis";
    box.hidden = true;
    row.append(status, box);

    renderEstadoAnalisis(sesion.id, sesion.estado_analisis, status, box);
    if (sesion.estado_analisis === "pendiente") esperarAnalisis(sesion.id, null, status, box);
  }

  return row;
}

// ---------- Estado del análisis: disponible / generándose / no disponible ----------

const ANALISIS_POLL_MS = 3_000;
const ANALISIS_TIMEOUT_MS = 60_000;

function renderEstadoAnalisis(sesionId, estado, status, box, mensaje = "") {
  status.innerHTML = "";
  box.hidden = true;
  box.dataset.loaded = "false";

  if (estado === "disponible") {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn--link";
    toggle.textContent = "Ver análisis";
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => toggleAnalisis(sesionId, box, toggle));
    status.append(toggle);
    return;
  }

  if (estado === "pendiente") {
    status.innerHTML = `<span class="analysis-status__text"><span class="spinner" aria-hidden="true"></span>Generando análisis…</span>`;
    return;
  }

  // no_disponible
  status.innerHTML = `
    <span class="analysis-status__text analysis-status__text--error">
      <svg class="inline-icon" aria-hidden="true"><use href="#i-alert"/></svg>
      ${escapeHtml(mensaje || "Análisis no disponible")}
    </span>`;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "btn btn--ghost btn--sm";
  retry.textContent = "Reintentar";
  retry.addEventListener("click", () => reintentarAnalisis(sesionId, status, box, retry));
  status.append(retry);
}

async function reintentarAnalisis(sesionId, status, box, button) {
  button.disabled = true;
  try {
    // Se recuerda el intento fallido para reconocer cuándo llega uno nuevo.
    const anterior = await apiFetch(`/sessions/${sesionId}/diagnosis`);
    await apiFetch(`/sessions/${sesionId}/diagnosis/retry`, { method: "POST" });
    renderEstadoAnalisis(sesionId, "pendiente", status, box);
    esperarAnalisis(sesionId, anterior.generado_en, status, box);
  } catch (err) {
    renderEstadoAnalisis(sesionId, "no_disponible", status, box, `No se pudo reintentar: ${err.message}`);
  }
}

// Consulta el análisis hasta que aparezca un intento más reciente que `anterior`.
async function esperarAnalisis(sesionId, anterior, status, box) {
  const limite = Date.now() + ANALISIS_TIMEOUT_MS;
  while (Date.now() < limite) {
    await new Promise((resolve) => setTimeout(resolve, ANALISIS_POLL_MS));
    if (!status.isConnected) return; // el panel se volvió a dibujar
    try {
      const data = await apiFetch(`/sessions/${sesionId}/diagnosis`);
      if (data.generado_en && data.generado_en !== anterior) {
        renderEstadoAnalisis(sesionId, data.disponible ? "disponible" : "no_disponible", status, box);
        return;
      }
    } catch {
      /* error de red transitorio: se vuelve a intentar */
    }
  }
  renderEstadoAnalisis(sesionId, "no_disponible", status, box, "El análisis tardó demasiado");
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
  renderCompare(sesiones);

  if (sesiones.length === 0) {
    empty.hidden = false;
    return;
  }

  sesiones.slice(0, 10).forEach((sesion) => list.appendChild(renderSessionRow(sesion)));
}

document.getElementById("dash-start-btn").addEventListener("click", showMonitoreoView);

document.getElementById("dash-logout-btn").addEventListener("click", () => {
  clearSession();
  location.reload();
});
