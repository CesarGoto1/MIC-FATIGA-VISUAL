const Charts = (() => {
  const LIVE_EAR_SECONDS = 30;
  const LIVE_REDRAW_MS = 100;

  const UMBRAL_PARPADEOS_MIN = 8;
  const UMBRAL_INCOMPLETOS_PCT = 40;
  const UMBRAL_PERCLOS_SOMNOLENCIA = 15;

  const NIVEL_TEXTO = { sin_fatiga: "Sin fatiga", leve: "Fatiga visual leve", moderada: "Fatiga visual moderada" };

  const registry = new Set();

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function palette() {
    return {
      series: cssVar("--chart-series"),
      surface: cssVar("--surface"),
      grid: cssVar("--border"),
      ink: cssVar("--ink"),
      ink2: cssVar("--ink-2"),
      ink3: cssVar("--ink-3"),
      font: cssVar("--font"),
    };
  }

  const referenceLines = {
    id: "referenceLines",
    afterDatasetsDraw(chart, _args, options) {
      const lines = options.lines || [];
      if (!lines.length) return;
      const { ctx, chartArea, scales } = chart;
      const c = palette();
      ctx.save();
      lines.forEach(({ value, label, align = "left" }) => {
        const y = scales.y.getPixelForValue(value);
        if (y < chartArea.top || y > chartArea.bottom) return;
        ctx.strokeStyle = c.ink3;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `600 10px ${c.font}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        const width = ctx.measureText(label).width;
        const x = align === "right" ? chartArea.right - width - 8 : chartArea.left + 2;
        ctx.fillStyle = c.surface;
        ctx.fillRect(x, y - 15, width + 6, 13);
        ctx.fillStyle = c.ink2;
        ctx.fillText(label, x + 3, y - 3);
      });
      ctx.restore();
    },
  };

  const crosshair = {
    id: "crosshair",
    afterDatasetsDraw(chart) {
      const active = chart.tooltip?.getActiveElements?.() || [];
      if (!active.length) return;
      const { ctx, chartArea } = chart;
      const x = active[0].element.x;
      ctx.save();
      ctx.strokeStyle = palette().grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  function baseOptions({ yMin, yMax, yTitle, lines = [], tooltipLabel }) {
    const c = palette();
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
          border: { color: c.grid },
          ticks: { color: c.ink3, font: { size: 10, family: c.font }, maxTicksLimit: 6, precision: 0 },
        },
        y: {
          min: yMin,
          suggestedMax: yMax,
          beginAtZero: yMin === undefined,
          grid: { color: c.grid, drawTicks: false },
          border: { display: false },
          ticks: { color: c.ink3, font: { size: 10, family: c.font }, maxTicksLimit: 4, padding: 6 },
          title: yTitle ? { display: true, text: yTitle, color: c.ink3, font: { size: 10, family: c.font } } : undefined,
        },
      },
      plugins: {
        legend: { display: false },
        referenceLines: { lines },
        tooltip: {
          backgroundColor: c.surface,
          borderColor: c.grid,
          borderWidth: 1,
          titleColor: c.ink,
          bodyColor: c.ink2,
          titleFont: { family: c.font, weight: "700" },
          bodyFont: { family: c.font },
          padding: 10,
          displayColors: false,
          callbacks: tooltipLabel,
        },
      },
    };
  }

  function lineDataset(points, { pointRadius = 4 } = {}) {
    const c = palette();
    return {
      data: points,
      borderColor: c.series,
      backgroundColor: c.series,
      borderWidth: 2,
      pointRadius,
      pointHoverRadius: pointRadius + 2,
      pointHitRadius: 12,
      pointBorderColor: c.surface,
      pointBorderWidth: 2,
      tension: 0.25,
    };
  }

  function create(canvas, config) {
    const chart = new Chart(canvas, { type: "line", plugins: [referenceLines, crosshair], ...config });
    registry.add(chart);
    return chart;
  }

  function destroy(chart) {
    if (!chart) return;
    registry.delete(chart);
    chart.destroy();
  }

  function recolor() {
    const c = palette();
    registry.forEach((chart) => {
      chart.data.datasets.forEach((ds) => {
        ds.borderColor = c.series;
        ds.backgroundColor = c.series;
        ds.pointBorderColor = c.surface;
      });
      const { x, y } = chart.options.scales;
      x.border.color = c.grid;
      x.ticks.color = c.ink3;
      y.grid.color = c.grid;
      y.ticks.color = c.ink3;
      if (y.title) y.title.color = c.ink3;
      Object.assign(chart.options.plugins.tooltip, {
        backgroundColor: c.surface,
        borderColor: c.grid,
        titleColor: c.ink,
        bodyColor: c.ink2,
      });
      chart.update("none");
    });
  }

  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolor);

  const fmt = (valor, decimales) => (valor === null || valor === undefined ? "–" : Number(valor).toFixed(decimales));

  let earChart = null;
  let earStart = 0;
  let earDirty = false;
  let earTimer = null;
  const minuteCharts = {};

  function startLive({ blinkThreshold, p80Threshold }) {
    stopLive();
    earStart = performance.now();

    earChart = create(document.getElementById("live-ear-chart"), {
      data: { datasets: [{ ...lineDataset([], { pointRadius: 0 }), tension: 0, pointHitRadius: 0 }] },
      options: (() => {
        const o = baseOptions({
          yMin: 0,
          yMax: 0.4,
          lines: [
            { value: blinkThreshold, label: "Parpadeo", align: "right" },
            { value: p80Threshold, label: "Cierre 80 %" },
          ],
        });
        o.scales.x.ticks.callback = (v) => `${Math.round(v)} s`;
        o.plugins.tooltip.enabled = false;
        o.interaction = { mode: "nearest", intersect: true };
        return o;
      })(),
    });

    const minuto = (titulo, unidad, decimales, umbral, etiquetaUmbral) =>
      create(document.getElementById(`live-${titulo}-chart`), {
        data: { datasets: [lineDataset([])] },
        options: (() => {
          const o = baseOptions({
            yMax: umbral * 1.5,
            lines: [{ value: umbral, label: etiquetaUmbral }],
            tooltipLabel: {
              title: (items) => `Minuto ${items[0].parsed.x}`,
              label: (item) => `${fmt(item.parsed.y, decimales)} ${unidad}`,
            },
          });
          o.scales.x.min = 1;
          o.scales.x.ticks.callback = (v) => `${v}′`;
          return o;
        })(),
      });

    minuteCharts.parpadeos = minuto("parpadeos", "parpadeos/min", 1, UMBRAL_PARPADEOS_MIN, "Bajo: < 8");
    minuteCharts.incompletos = minuto("incompletos", "% incompletos", 0, UMBRAL_INCOMPLETOS_PCT, "Alto: ≥ 40 %");

    earTimer = setInterval(() => {
      if (!earDirty || !earChart) return;
      earDirty = false;
      earChart.update("none");
    }, LIVE_REDRAW_MS);
  }

  function pushEar(now, ear) {
    if (!earChart) return;
    const data = earChart.data.datasets[0].data;
    const t = (now - earStart) / 1000;
    data.push({ x: t, y: ear });
    while (data.length && data[0].x < t - LIVE_EAR_SECONDS) data.shift();
    earChart.options.scales.x.min = Math.max(0, t - LIVE_EAR_SECONDS);
    earChart.options.scales.x.max = Math.max(LIVE_EAR_SECONDS, t);
    earDirty = true;
  }

  function setEarThresholds({ blinkThreshold, p80Threshold }) {
    if (!earChart) return;
    earChart.options.plugins.referenceLines.lines = [
      { value: blinkThreshold, label: "Parpadeo", align: "right" },
      { value: p80Threshold, label: "Cierre 80 %" },
    ];
    earChart.options.scales.y.suggestedMax = Math.max(0.4, blinkThreshold / 0.6);
    earDirty = true;
  }

  function pushMinute(metrics) {
    const add = (chart, y) => {
      if (!chart) return;
      const data = chart.data.datasets[0].data;
      data.push({ x: data.length + 1, y });
      chart.options.scales.x.max = Math.max(5, data.length);
      chart.update("none");
    };
    add(minuteCharts.parpadeos, metrics.parpadeos_min);
    add(minuteCharts.incompletos, metrics.parpadeos_incompletos_pct);
  }

  function stopLive() {
    clearInterval(earTimer);
    earTimer = null;
    destroy(earChart);
    earChart = null;
    Object.keys(minuteCharts).forEach((k) => {
      destroy(minuteCharts[k]);
      delete minuteCharts[k];
    });
  }

  const RESUMEN_METRICAS = [
    { clave: "parpadeos_min", titulo: "Parpadeos por minuto", unidad: "/min", decimales: 1, umbral: UMBRAL_PARPADEOS_MIN, etiqueta: "Bajo: < 8" },
    { clave: "parpadeos_incompletos_pct", titulo: "Parpadeos incompletos", unidad: "%", decimales: 0, umbral: UMBRAL_INCOMPLETOS_PCT, etiqueta: "Alto: ≥ 40 %", yMax: 100 },
    { clave: "tiempo_cierre", titulo: "Duración media del parpadeo", unidad: "ms", decimales: 0 },
    { clave: "perclos", titulo: "PERCLOS (control de somnolencia)", unidad: "%", decimales: 1, umbral: UMBRAL_PERCLOS_SOMNOLENCIA, etiqueta: "Somnolencia: ≥ 15 %" },
  ];

  function promedio(valores) {
    const v = valores.filter((x) => x !== null && x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }

  function resumenNumeros(mediciones) {
    const conNivel = mediciones.filter((m) => m.nivel_fatiga);
    const conFatiga = conNivel.filter((m) => m.nivel_fatiga !== "sin_fatiga").length;
    return [
      { label: "Parpadeos", valor: fmt(promedio(mediciones.map((m) => m.parpadeos_min)), 1), unidad: "/min promedio" },
      { label: "Incompletos", valor: fmt(promedio(mediciones.map((m) => m.parpadeos_incompletos_pct)), 0), unidad: "% promedio" },
      { label: "Minutos con fatiga", valor: `${conFatiga}/${conNivel.length}`, unidad: "leve o moderada" },
      { label: "Somnolencia", valor: `${mediciones.filter((m) => m.somnolencia).length}`, unidad: "minutos con signos" },
    ];
  }

  function renderSession(container, sesion) {
    const mediciones = sesion.mediciones;
    const tiles = resumenNumeros(mediciones)
      .map((t) => `<div class="session-stat"><small>${t.label}</small><strong>${t.valor}</strong><span>${t.unidad}</span></div>`)
      .join("");
    const plots = RESUMEN_METRICAS.map(
      (m, i) => `
        <figure class="session-plot">
          <figcaption>${m.titulo} <span>(${m.unidad})</span></figcaption>
          <div class="session-plot__canvas"><canvas id="sc-${sesion.id}-${i}" role="img" aria-label="${m.titulo} por minuto"></canvas></div>
        </figure>`
    ).join("");
    const filas = mediciones
      .map(
        (m, i) => `<tr><td>${i + 1}</td><td>${fmt(m.parpadeos_min, 1)}</td><td>${fmt(m.parpadeos_incompletos_pct, 0)}</td>
          <td>${fmt(m.tiempo_cierre, 0)}</td><td>${fmt(m.perclos, 1)}</td><td>${NIVEL_TEXTO[m.nivel_fatiga] || "–"}${m.somnolencia ? " · somnolencia" : ""}</td></tr>`
      )
      .join("");

    container.innerHTML = `
      <div class="session-stats">${tiles}</div>
      <div class="session-plots">${plots}</div>
      <details class="session-table">
        <summary>Ver los datos en tabla</summary>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Min.</th><th>Parpadeos/min</th><th>Incompletos %</th><th>Cierre ms</th><th>PERCLOS %</th><th>Nivel</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </details>`;

    const charts = RESUMEN_METRICAS.map((m, i) => {
      const points = mediciones.map((med, idx) => ({ x: idx + 1, y: med[m.clave] ?? null }));
      const o = baseOptions({
        yMax: m.yMax ?? (m.umbral ? m.umbral * 1.5 : undefined),
        lines: m.umbral ? [{ value: m.umbral, label: m.etiqueta }] : [],
        tooltipLabel: {
          title: (items) => `Minuto ${items[0].parsed.x}`,
          label: (item) => {
            const med = mediciones[item.dataIndex];
            const nivel = NIVEL_TEXTO[med.nivel_fatiga];
            return [`${fmt(item.parsed.y, m.decimales)} ${m.unidad}`, ...(nivel ? [nivel] : [])];
          },
        },
      });
      if (m.yMax) o.scales.y.max = m.yMax;
      o.scales.x.min = 1;
      o.scales.x.max = Math.max(2, mediciones.length);
      o.scales.x.ticks.callback = (v) => `${v}′`;
      return create(container.querySelector(`#sc-${sesion.id}-${i}`), {
        data: { datasets: [{ ...lineDataset(points, { pointRadius: mediciones.length > 30 ? 0 : 4 }), spanGaps: true }] },
        options: o,
      });
    });

    return () => charts.forEach(destroy);
  }

  function releaseDetached() {
    registry.forEach((chart) => {
      if (!chart.canvas?.isConnected) destroy(chart);
    });
  }

  return { startLive, pushEar, setEarThresholds, pushMinute, stopLive, renderSession, releaseDetached };
})();
