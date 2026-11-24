import { NIVEL_ETIQUETA, numero, promedio } from "./formato.js";

const SEGUNDOS_EAR_EN_VIVO = 30;
const REDIBUJO_EN_VIVO_MS = 100;

const UMBRAL_PARPADEOS_MIN = 8;
const UMBRAL_INCOMPLETOS_PCT = 40;
const UMBRAL_PERCLOS_SOMNOLENCIA = 15;

const registradas = new Set();

function variableCss(nombre) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

function paleta() {
  return {
    serie: variableCss("--serie-grafica"),
    superficie: variableCss("--superficie"),
    cuadricula: variableCss("--borde"),
    texto: variableCss("--texto"),
    texto2: variableCss("--texto-2"),
    texto3: variableCss("--texto-3"),
    fuente: variableCss("--fuente"),
  };
}

const lineasReferencia = {
  id: "lineasReferencia",
  afterDatasetsDraw(grafica, _argumentos, opciones) {
    const lineas = opciones.lineas || [];
    if (!lineas.length) return;
    const { ctx, chartArea: area, scales } = grafica;
    const c = paleta();
    ctx.save();
    lineas.forEach(({ valor, etiqueta, alineacion = "izquierda" }) => {
      const y = scales.y.getPixelForValue(valor);
      if (y < area.top || y > area.bottom) return;
      ctx.strokeStyle = c.texto3;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(area.left, y);
      ctx.lineTo(area.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `600 10px ${c.fuente}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const ancho = ctx.measureText(etiqueta).width;
      const x = alineacion === "derecha" ? area.right - ancho - 8 : area.left + 2;
      ctx.fillStyle = c.superficie;
      ctx.fillRect(x, y - 15, ancho + 6, 13);
      ctx.fillStyle = c.texto2;
      ctx.fillText(etiqueta, x + 3, y - 3);
    });
    ctx.restore();
  },
};

const cursorVertical = {
  id: "cursorVertical",
  afterDatasetsDraw(grafica) {
    const activos = grafica.tooltip?.getActiveElements?.() || [];
    if (!activos.length) return;
    const { ctx, chartArea: area } = grafica;
    const x = activos[0].element.x;
    ctx.save();
    ctx.strokeStyle = paleta().cuadricula;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function opcionesBase({ yMin, yMax, lineas = [], textoEmergente }) {
  const c = paleta();
  const letra = { size: 10, family: c.fuente };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: 4, right: 4 } },
    scales: {
      x: {
        type: "linear",
        grid: { display: false },
        border: { color: c.cuadricula },
        ticks: { color: c.texto3, font: letra, maxTicksLimit: 6, precision: 0 },
      },
      y: {
        min: yMin,
        suggestedMax: yMax,
        beginAtZero: yMin === undefined,
        grid: { color: c.cuadricula, drawTicks: false },
        border: { display: false },
        ticks: { color: c.texto3, font: letra, maxTicksLimit: 4, padding: 6 },
      },
    },
    plugins: {
      legend: { display: false },
      lineasReferencia: { lineas },
      tooltip: {
        backgroundColor: c.superficie,
        borderColor: c.cuadricula,
        borderWidth: 1,
        titleColor: c.texto,
        bodyColor: c.texto2,
        titleFont: { family: c.fuente, weight: "700" },
        bodyFont: { family: c.fuente },
        padding: 10,
        displayColors: false,
        callbacks: textoEmergente,
      },
    },
  };
}

function serieDeLinea(puntos, { radioPunto = 4 } = {}) {
  const c = paleta();
  return {
    data: puntos,
    borderColor: c.serie,
    backgroundColor: c.serie,
    borderWidth: 2,
    pointRadius: radioPunto,
    pointHoverRadius: radioPunto + 2,
    pointHitRadius: 12,
    pointBorderColor: c.superficie,
    pointBorderWidth: 2,
    tension: 0.25,
  };
}

function crear(lienzo, configuracion) {
  const grafica = new Chart(lienzo, { type: "line", plugins: [lineasReferencia, cursorVertical], ...configuracion });
  registradas.add(grafica);
  return grafica;
}

function destruir(grafica) {
  if (!grafica) return;
  registradas.delete(grafica);
  grafica.destroy();
}

function recolorear() {
  const c = paleta();
  registradas.forEach((grafica) => {
    grafica.data.datasets.forEach((serie) => {
      serie.borderColor = c.serie;
      serie.backgroundColor = c.serie;
      serie.pointBorderColor = c.superficie;
    });
    const { x, y } = grafica.options.scales;
    x.border.color = c.cuadricula;
    x.ticks.color = c.texto3;
    y.grid.color = c.cuadricula;
    y.ticks.color = c.texto3;
    Object.assign(grafica.options.plugins.tooltip, {
      backgroundColor: c.superficie,
      borderColor: c.cuadricula,
      titleColor: c.texto,
      bodyColor: c.texto2,
    });
    grafica.update("none");
  });
}

new MutationObserver(recolorear).observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolorear);

function lineasEar({ umbralParpadeo, umbralP80 }) {
  return [
    { valor: umbralParpadeo, etiqueta: "Parpadeo", alineacion: "derecha" },
    { valor: umbralP80, etiqueta: "Cierre 80 %" },
  ];
}

const textoPorMinuto = (formatear) => ({
  title: (elementos) => `Minuto ${elementos[0].parsed.x}`,
  label: formatear,
});

let graficaEar = null;
let inicioEar = 0;
let earPendiente = false;
let temporizadorEar = null;
const graficasPorMinuto = {};

function graficaPorMinuto(clave, unidad, decimales, umbral, etiquetaUmbral) {
  const opciones = opcionesBase({
    yMax: umbral * 1.5,
    lineas: [{ valor: umbral, etiqueta: etiquetaUmbral }],
    textoEmergente: textoPorMinuto((elemento) => `${numero(elemento.parsed.y, decimales)} ${unidad}`),
  });
  opciones.scales.x.min = 1;
  opciones.scales.x.ticks.callback = (v) => `${v}′`;
  return crear(document.getElementById(`grafica-${clave}-vivo`), { data: { datasets: [serieDeLinea([])] }, options: opciones });
}

export function iniciarGraficasEnVivo(umbrales) {
  detenerGraficasEnVivo();
  inicioEar = performance.now();

  const opciones = opcionesBase({ yMin: 0, yMax: 0.4, lineas: lineasEar(umbrales) });
  opciones.scales.x.ticks.callback = (v) => `${Math.round(v)} s`;
  opciones.plugins.tooltip.enabled = false;
  opciones.interaction = { mode: "nearest", intersect: true };
  graficaEar = crear(document.getElementById("grafica-ear-vivo"), {
    data: { datasets: [{ ...serieDeLinea([], { radioPunto: 0 }), tension: 0, pointHitRadius: 0 }] },
    options: opciones,
  });

  graficasPorMinuto.parpadeos = graficaPorMinuto("parpadeos", "parpadeos/min", 1, UMBRAL_PARPADEOS_MIN, "Bajo: < 8");
  graficasPorMinuto.incompletos = graficaPorMinuto("incompletos", "% incompletos", 0, UMBRAL_INCOMPLETOS_PCT, "Alto: ≥ 40 %");

  temporizadorEar = setInterval(() => {
    if (!earPendiente || !graficaEar) return;
    earPendiente = false;
    graficaEar.update("none");
  }, REDIBUJO_EN_VIVO_MS);
}

export function agregarEar(ahora, ear) {
  if (!graficaEar) return;
  const datos = graficaEar.data.datasets[0].data;
  const t = (ahora - inicioEar) / 1000;
  datos.push({ x: t, y: ear });
  while (datos.length && datos[0].x < t - SEGUNDOS_EAR_EN_VIVO) datos.shift();
  graficaEar.options.scales.x.min = Math.max(0, t - SEGUNDOS_EAR_EN_VIVO);
  graficaEar.options.scales.x.max = Math.max(SEGUNDOS_EAR_EN_VIVO, t);
  earPendiente = true;
}

export function actualizarUmbralesEar(umbrales) {
  if (!graficaEar) return;
  graficaEar.options.plugins.lineasReferencia.lineas = lineasEar(umbrales);
  graficaEar.options.scales.y.suggestedMax = Math.max(0.4, umbrales.umbralParpadeo / 0.6);
  earPendiente = true;
}

export function agregarMinuto(metricas) {
  const agregar = (grafica, y) => {
    if (!grafica) return;
    const datos = grafica.data.datasets[0].data;
    datos.push({ x: datos.length + 1, y });
    grafica.options.scales.x.max = Math.max(5, datos.length);
    grafica.update("none");
  };
  agregar(graficasPorMinuto.parpadeos, metricas.parpadeos_min);
  agregar(graficasPorMinuto.incompletos, metricas.parpadeos_incompletos_pct);
}

export function detenerGraficasEnVivo() {
  clearInterval(temporizadorEar);
  temporizadorEar = null;
  destruir(graficaEar);
  graficaEar = null;
  Object.keys(graficasPorMinuto).forEach((clave) => {
    destruir(graficasPorMinuto[clave]);
    delete graficasPorMinuto[clave];
  });
}

const METRICAS_RESUMEN = [
  { clave: "parpadeos_min", titulo: "Parpadeos por minuto", unidad: "/min", decimales: 1, umbral: UMBRAL_PARPADEOS_MIN, etiqueta: "Bajo: < 8" },
  { clave: "parpadeos_incompletos_pct", titulo: "Parpadeos incompletos", unidad: "%", decimales: 0, umbral: UMBRAL_INCOMPLETOS_PCT, etiqueta: "Alto: ≥ 40 %", yMax: 100 },
  { clave: "tiempo_cierre", titulo: "Duración media del parpadeo", unidad: "ms", decimales: 0 },
  { clave: "perclos", titulo: "PERCLOS (control de somnolencia)", unidad: "%", decimales: 1, umbral: UMBRAL_PERCLOS_SOMNOLENCIA, etiqueta: "Somnolencia: ≥ 15 %" },
];

function datosResumen(mediciones) {
  const conNivel = mediciones.filter((m) => m.nivel_fatiga);
  const conFatiga = conNivel.filter((m) => m.nivel_fatiga !== "sin_fatiga").length;
  return [
    { etiqueta: "Parpadeos", valor: numero(promedio(mediciones.map((m) => m.parpadeos_min)), 1), unidad: "/min promedio" },
    { etiqueta: "Incompletos", valor: numero(promedio(mediciones.map((m) => m.parpadeos_incompletos_pct)), 0), unidad: "% promedio" },
    { etiqueta: "Minutos con fatiga", valor: `${conFatiga}/${conNivel.length}`, unidad: "leve o moderada" },
    { etiqueta: "Somnolencia", valor: `${mediciones.filter((m) => m.somnolencia).length}`, unidad: "minutos con signos" },
  ];
}

function filaMedicion(m, i) {
  const nivel = `${NIVEL_ETIQUETA[m.nivel_fatiga] || "–"}${m.somnolencia ? " · somnolencia" : ""}`;
  return `<tr><td>${i + 1}</td><td>${numero(m.parpadeos_min, 1)}</td><td>${numero(m.parpadeos_incompletos_pct, 0)}</td>
    <td>${numero(m.tiempo_cierre, 0)}</td><td>${numero(m.perclos, 1)}</td><td>${nivel}</td></tr>`;
}

export function pintarGraficasSesion(contenedor, sesion) {
  const { mediciones } = sesion;
  const idLienzo = (i) => `grafica-sesion-${sesion.id}-${i}`;
  const datos = datosResumen(mediciones)
    .map((d) => `<div class="sesion-dato"><small>${d.etiqueta}</small><strong>${d.valor}</strong><span>${d.unidad}</span></div>`)
    .join("");
  const figuras = METRICAS_RESUMEN.map(
    (m, i) => `
      <figure class="sesion-grafica">
        <figcaption>${m.titulo} <span>(${m.unidad})</span></figcaption>
        <div class="sesion-grafica__lienzo"><canvas id="${idLienzo(i)}" role="img" aria-label="${m.titulo} por minuto"></canvas></div>
      </figure>`
  ).join("");

  contenedor.innerHTML = `
    <div class="sesion-datos">${datos}</div>
    <div class="sesion-graficas">${figuras}</div>
    <details class="sesion-tabla">
      <summary>Ver los datos en tabla</summary>
      <div class="tabla-desplazable">
        <table>
          <thead><tr><th>Min.</th><th>Parpadeos/min</th><th>Incompletos %</th><th>Cierre ms</th><th>PERCLOS %</th><th>Nivel</th></tr></thead>
          <tbody>${mediciones.map(filaMedicion).join("")}</tbody>
        </table>
      </div>
    </details>`;

  const graficas = METRICAS_RESUMEN.map((m, i) => {
    const puntos = mediciones.map((medicion, indice) => ({ x: indice + 1, y: medicion[m.clave] ?? null }));
    const opciones = opcionesBase({
      yMax: m.yMax ?? (m.umbral ? m.umbral * 1.5 : undefined),
      lineas: m.umbral ? [{ valor: m.umbral, etiqueta: m.etiqueta }] : [],
      textoEmergente: textoPorMinuto((elemento) => {
        const nivel = NIVEL_ETIQUETA[mediciones[elemento.dataIndex].nivel_fatiga];
        return [`${numero(elemento.parsed.y, m.decimales)} ${m.unidad}`, ...(nivel ? [nivel] : [])];
      }),
    });
    if (m.yMax) opciones.scales.y.max = m.yMax;
    opciones.scales.x.min = 1;
    opciones.scales.x.max = Math.max(2, mediciones.length);
    opciones.scales.x.ticks.callback = (v) => `${v}′`;
    return crear(contenedor.querySelector(`#${idLienzo(i)}`), {
      data: { datasets: [{ ...serieDeLinea(puntos, { radioPunto: mediciones.length > 30 ? 0 : 4 }), spanGaps: true }] },
      options: opciones,
    });
  });

  return () => graficas.forEach(destruir);
}

export function liberarGraficasHuerfanas() {
  registradas.forEach((grafica) => {
    if (!grafica.canvas?.isConnected) destruir(grafica);
  });
}
