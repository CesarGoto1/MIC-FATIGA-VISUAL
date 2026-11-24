import { escaparHtml } from "./formato.js";

const PARAMETRO_ETIQUETA = {
  parpadeos_min: "Frecuencia de parpadeo",
  sebr: "Frecuencia de parpadeo",
  parpadeos_incompletos_pct: "Parpadeos incompletos",
  tiempo_cierre: "Tiempo de cierre",
  velocidad_ocular: "Movimiento ocular",
  perclos: "PERCLOS (control de somnolencia)",
  kss: "Somnolencia (KSS, control)",
};

const SEVERIDAD_CLASE = {
  "sin fatiga": "insignia--exito",
  leve: "insignia--leve",
  moderada: "insignia--moderada",
  alta: "insignia--alta",
  severa: "insignia--alta",
};

const AVISO_PREDETERMINADO =
  "Análisis orientativo y preventivo; no reemplaza la evaluación de un profesional de la salud visual.";

function claseSeveridad(nivel) {
  return SEVERIDAD_CLASE[nivel.trim().toLowerCase()] || "insignia--neutral";
}

function valorParametro(valor) {
  return escaparHtml(typeof valor === "number" ? Number(valor.toFixed(2)) : valor ?? "–");
}

function bloqueParametro([clave, valor]) {
  return `
    <div class="analisis__parametro">
      <p class="analisis__parametro-titulo">${escaparHtml(PARAMETRO_ETIQUETA[clave] || clave)}
        <span class="analisis__parametro-valores">${valorParametro(valor.valor_inicial)} → ${valorParametro(valor.valor_final)}</span>
      </p>
      <p>${escaparHtml(valor.interpretacion)}</p>
      <p class="analisis__recomendacion">${escaparHtml(valor.recomendacion)}</p>
    </div>`;
}

function htmlAnalisis(detalle) {
  const resumen = detalle.resumen_general ?? detalle.diagnostico_general;
  const nivel = detalle.nivel_fatiga_final ?? detalle.severidad_fatiga_final ?? "";
  const orden = Object.keys(PARAMETRO_ETIQUETA);
  const posicion = (clave) => (orden.includes(clave) ? orden.indexOf(clave) : orden.length);
  const parametros = Object.entries(detalle.evaluacion_parametros || {})
    .sort(([a], [b]) => posicion(a) - posicion(b))
    .map(bloqueParametro)
    .join("");
  const recomendaciones = (detalle.recomendaciones_generales || []).map((r) => `<li>${escaparHtml(r)}</li>`).join("");

  return `
    <div class="analisis__cabecera">
      <span class="analisis__sello"><svg aria-hidden="true"><use href="#i-destello"/></svg> Análisis generado con IA</span>
      ${nivel ? `<span class="insignia ${claseSeveridad(nivel)}">${escaparHtml(nivel)}</span>` : ""}
    </div>
    <p class="analisis__resumen">${escaparHtml(resumen)}</p>
    <div class="analisis__parametros">${parametros}</div>
    ${recomendaciones ? `<h3>Recomendaciones</h3><ul class="analisis__recomendaciones">${recomendaciones}</ul>` : ""}
    <p class="analisis__descargo">${escaparHtml(detalle.aviso || AVISO_PREDETERMINADO)}</p>
  `;
}

export function pintarDiagnostico(contenedor, diagnostico, textoSinAnalisis) {
  if (diagnostico.disponible && diagnostico.detalle) {
    contenedor.innerHTML = htmlAnalisis(diagnostico.detalle);
  } else if (diagnostico.disponible && diagnostico.texto) {
    contenedor.textContent = diagnostico.texto;
  } else {
    contenedor.innerHTML = `<p class="tenue">${escaparHtml(textoSinAnalisis)}</p>`;
  }
}
