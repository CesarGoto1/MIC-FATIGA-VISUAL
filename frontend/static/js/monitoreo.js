const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const RIGHT_IRIS_CENTER = 468;
const LEFT_IRIS_CENTER = 473;

const CALIBRATION_MS = 5_000;
const MIN_CALIBRATION_SAMPLES = 30;

const BLINK_CLOSE_RATIO = 0.75;
const BLINK_OPEN_RATIO = 0.85;
const MIN_CLOSURE_MS = 50;
const MAX_BLINK_MS = 500;

const P80_OPENNESS = 0.2;
const FULL_BLINKS_REQUIRED = 3;
const MAX_VOLUNTARY_BLINK_MS = 1_500;
const CLOSURE_CALIBRATION_TIMEOUT_MS = 20_000;
const DEFAULT_FLOOR_RATIO = 0.4;

const WINDOW_MS = 60_000;
const MAX_FRAME_GAP_MS = 250;
const FACE_LOST_MS = 1_500;
const METRICS_SEND_INTERVAL_MS = WINDOW_MS;
const MAX_UNSENT_MS = 5 * WINDOW_MS;
const MIN_OBSERVED_MS = 20_000;

const DETECTOR_TIMEOUT_MS = 20_000;

const BREAK_SECONDS = 20;
const ALERT_COOLDOWN_MS = 120_000;

const setupSection = document.getElementById("mon-setup");
const liveSection = document.getElementById("mon-live");
const setupForm = document.getElementById("setup-form");
const setupError = document.getElementById("setup-error");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const fileDrop = document.getElementById("file-drop");
const fileInput = document.getElementById("content-file");
const fileDropText = document.getElementById("file-drop-text");
const kssInicialEl = document.getElementById("kss-inicial");
const kssFinalEl = document.getElementById("kss-final");
const finishDialog = document.getElementById("finish-dialog");
const finishForm = document.getElementById("finish-form");
const finishError = document.getElementById("finish-error");
const videoEl = document.getElementById("webcam");
const viewerPdf = document.getElementById("viewer-pdf");
const viewerVideo = document.getElementById("viewer-video");
const viewerEmpty = document.getElementById("viewer-empty");
const statusPill = document.getElementById("mon-status-pill");
const statusText = document.getElementById("mon-status-text");
const timerEl = document.getElementById("mon-timer");
const calibrationOverlay = document.getElementById("cam-calibration");
const calibrationBar = document.getElementById("cam-calibration-bar");
const calibrationText = document.getElementById("cam-calibration-text");
const noFaceOverlay = document.getElementById("cam-noface");
const toastEl = document.getElementById("toast");
const breakOverlay = document.getElementById("break-overlay");
const breakCount = document.getElementById("break-count");

let camera = null;
let faceMesh = null;
let firstResultReceived = false;
let detectorTimeoutHandle = null;
let sesionId = null;
let contentUrl = null;
let sendIntervalHandle = null;
let timerHandle = null;
let breakHandle = null;
let startedAt = null;

let baselineEar = null;
let calibrationSamples = [];
let calibrationStartedAt = null;
let fullClosureEar = null;
let closureCalibration = null;

let samples = [];
let blinks = [];
let longClosures = [];
let velocities = [];

let eyeClosed = false;
let closureStartedAt = null;
let closureTrough = null;
let lastSampleAt = null;
let lastFaceAt = null;
let lastIris = null;
let paused = false;
let eyeListener = null;
let lastSentAt = 0;
let lastAlert = { nivel: null, dismissedAt: 0 };

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(landmarks, eyeIndices) {
  const [p1, p2, p3, p4, p5, p6] = eyeIndices.map((i) => landmarks[i]);
  return (distance(p2, p6) + distance(p3, p5)) / (2 * distance(p1, p4));
}

function irisOffset(landmarks, eyeIndices, irisIndex) {
  const inner = landmarks[eyeIndices[0]];
  const outer = landmarks[eyeIndices[3]];
  const width = distance(inner, outer);
  const iris = landmarks[irisIndex];
  return {
    x: (iris.x - (inner.x + outer.x) / 2) / width,
    y: (iris.y - (inner.y + outer.y) / 2) / width,
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function averageOf(list, key) {
  if (list.length === 0) return 0;
  return list.reduce((acc, item) => acc + item[key], 0) / list.length;
}

function onFaceMeshResults(results) {
  if (camera === null) return;
  if (!firstResultReceived) {
    firstResultReceived = true;
    clearTimeout(detectorTimeoutHandle);
    calibrationText.textContent = "Calibrando: mira la pantalla con naturalidad…";
  }
  const now = performance.now();
  const landmarks = results.multiFaceLandmarks?.[0];

  if (!landmarks) {
    lastSampleAt = null;
    lastIris = null;
    if (lastFaceAt === null || now - lastFaceAt > FACE_LOST_MS) setFaceVisible(false);
    return;
  }
  lastFaceAt = now;
  setFaceVisible(true);

  const earRight = eyeAspectRatio(landmarks, RIGHT_EYE);
  const earLeft = eyeAspectRatio(landmarks, LEFT_EYE);
  const ear = (earRight + earLeft) / 2;

  if (baselineEar === null) {
    calibrate(ear, now);
    return;
  }
  if (fullClosureEar === null) {
    calibrateClosure(ear, now);
    return;
  }
  if (eyeListener) {
    eyeListener(Math.max(earRight, earLeft), now);
    return;
  }
  if (paused) {
    lastSampleAt = null;
    lastIris = null;
    return;
  }

  const dt = lastSampleAt === null ? 0 : Math.min(now - lastSampleAt, MAX_FRAME_GAP_MS);
  lastSampleAt = now;

  detectBlink(ear, now);

  samples.push({ t: now, dt, ear, p80: ear <= p80Threshold() });
  Charts.pushEar(now, ear);

  const offsetRight = irisOffset(landmarks, RIGHT_EYE, RIGHT_IRIS_CENTER);
  const offsetLeft = irisOffset(landmarks, LEFT_EYE, LEFT_IRIS_CENTER);
  const iris = { x: (offsetRight.x + offsetLeft.x) / 2, y: (offsetRight.y + offsetLeft.y) / 2 };
  if (lastIris !== null && dt > 0 && !eyeClosed) {
    velocities.push({ t: now, speed: distance(iris, lastIris) / (dt / 1000) });
  }
  lastIris = eyeClosed ? null : iris;

  pruneWindow(now);
  updateLiveMetrics(ear);
}

function calibrate(ear, now) {
  if (calibrationStartedAt === null) calibrationStartedAt = now;
  calibrationSamples.push(ear);

  const progress = Math.min(1, (now - calibrationStartedAt) / CALIBRATION_MS);
  calibrationBar.style.transform = `scaleX(${progress})`;

  if (progress >= 1 && calibrationSamples.length >= MIN_CALIBRATION_SAMPLES) {
    baselineEar = median(calibrationSamples);
    console.info(`Línea base de EAR (mediana): ${baselineEar.toFixed(3)}`);
    calibrationBar.style.transform = "scaleX(0)";
    calibrationText.textContent = `Ahora parpadea ${FULL_BLINKS_REQUIRED} veces cerrando los ojos por completo, sin apretar.`;
  }
}

function calibrateClosure(ear, now) {
  const c = (closureCalibration ??= { startedAt: now, closed: false, since: 0, trough: 0, troughs: [] });

  if (!c.closed && ear < baselineEar * BLINK_CLOSE_RATIO) {
    Object.assign(c, { closed: true, since: now, trough: ear });
  } else if (c.closed) {
    c.trough = Math.min(c.trough, ear);
    if (ear > baselineEar * BLINK_OPEN_RATIO) {
      c.closed = false;
      const duration = now - c.since;
      if (duration >= MIN_CLOSURE_MS && duration <= MAX_VOLUNTARY_BLINK_MS) c.troughs.push(c.trough);
      calibrationBar.style.transform = `scaleX(${Math.min(1, c.troughs.length / FULL_BLINKS_REQUIRED)})`;
    }
  }

  if (c.troughs.length >= FULL_BLINKS_REQUIRED) {
    fullClosureEar = Math.min(median(c.troughs), baselineEar * (BLINK_CLOSE_RATIO - 0.15));
    console.info(`EAR de cierre completo (mediana): ${fullClosureEar.toFixed(3)}`);
    finishCalibration();
  } else if (now - c.startedAt > CLOSURE_CALIBRATION_TIMEOUT_MS) {
    fullClosureEar = baselineEar * DEFAULT_FLOOR_RATIO;
    console.warn("No se detectaron los parpadeos de calibración; se usa el piso de respaldo.");
    finishCalibration();
  }
}

function finishCalibration() {
  calibrationOverlay.hidden = true;
  Charts.startLive({ blinkThreshold: baselineEar * BLINK_CLOSE_RATIO, p80Threshold: p80Threshold() });
  startedAt = Date.now();
  startTimer();
  document.getElementById("side-game-btn").disabled = false;
  setStatus("running", "Monitoreando");
}

function detectBlink(ear, now) {
  if (!eyeClosed && ear < baselineEar * BLINK_CLOSE_RATIO) {
    eyeClosed = true;
    closureStartedAt = now;
    closureTrough = ear;
    return;
  }
  if (!eyeClosed) return;

  closureTrough = Math.min(closureTrough, ear);
  if (ear <= baselineEar * BLINK_OPEN_RATIO) return;

  eyeClosed = false;
  const duration = now - closureStartedAt;
  if (duration < MIN_CLOSURE_MS) return;

  if (duration <= MAX_BLINK_MS) {
    blinks.push({ t: now, duration, complete: closureTrough <= p80Threshold() });
  } else {
    longClosures.push({ t: now });
  }
}

function closedEyeFloor() {
  return fullClosureEar ?? baselineEar * DEFAULT_FLOOR_RATIO;
}

function p80Threshold() {
  const floor = closedEyeFloor();
  return floor + P80_OPENNESS * (baselineEar - floor);
}

function pruneWindow(now) {
  const cutoff = Math.max(Math.min(now - WINDOW_MS, lastSentAt), now - MAX_UNSENT_MS);
  samples = samples.filter((s) => s.t >= cutoff);
  blinks = blinks.filter((b) => b.t >= cutoff);
  longClosures = longClosures.filter((c) => c.t >= cutoff);
  velocities = velocities.filter((v) => v.t >= cutoff);
}

function resetWindow() {
  samples = [];
  blinks = [];
  longClosures = [];
  velocities = [];
  eyeClosed = false;
  lastSampleAt = null;
  lastIris = null;
}

function computeMetrics(desde = -Infinity) {
  const posterior = (item) => item.t > desde;
  const ventana = samples.filter(posterior);
  const observedMs = ventana.reduce((acc, s) => acc + s.dt, 0);
  if (observedMs === 0) return null;

  const closedMs = ventana.reduce((acc, s) => acc + (s.p80 ? s.dt : 0), 0);
  const parpadeos = blinks.filter(posterior);
  const incompletos = parpadeos.filter((b) => !b.complete).length;
  return {
    observedMs,
    ear: averageOf(ventana, "ear"),
    perclos: (closedMs / observedMs) * 100,
    parpadeos_min: parpadeos.length / (observedMs / 60_000),
    parpadeos_incompletos_pct: parpadeos.length ? (incompletos / parpadeos.length) * 100 : null,
    tiempo_cierre: averageOf(parpadeos, "duration"),
    velocidad_ocular: averageOf(velocities.filter(posterior), "speed"),
    cierres_prolongados: longClosures.filter(posterior).length,
  };
}

function updateLiveMetrics(currentEar) {
  document.getElementById("metric-ear").textContent = currentEar.toFixed(3);
  const m = computeMetrics(performance.now() - WINDOW_MS);
  if (!m) return;
  document.getElementById("metric-perclos").textContent = m.perclos.toFixed(1);
  document.getElementById("metric-parpadeo").textContent = m.parpadeos_min.toFixed(1);
  document.getElementById("metric-incompletos").textContent =
    m.parpadeos_incompletos_pct === null ? "--" : m.parpadeos_incompletos_pct.toFixed(0);
  document.getElementById("metric-cierre").textContent = m.tiempo_cierre.toFixed(0);
  document.getElementById("metric-prolongados").textContent = m.cierres_prolongados;
  document.getElementById("metric-velocidad").textContent = m.velocidad_ocular.toFixed(2);
}

async function sendMetrics() {
  if (sesionId === null || paused) return;
  const corte = performance.now();
  const m = computeMetrics(lastSentAt);
  if (!m || m.observedMs < MIN_OBSERVED_MS) return;

  try {
    const result = await apiFetch(`/sessions/${sesionId}/metrics`, {
      method: "POST",
      body: JSON.stringify({
        ear: Math.min(1, m.ear),
        perclos: Math.min(100, m.perclos),
        parpadeos_min: m.parpadeos_min,
        tiempo_cierre: m.tiempo_cierre,
        velocidad_ocular: m.velocidad_ocular,
        cierres_prolongados: m.cierres_prolongados,
        parpadeos_incompletos_pct: m.parpadeos_incompletos_pct,
      }),
    });
    lastSentAt = corte;
    Charts.pushMinute(m);
    showFatigueLevel(result.nivel_fatiga);
    maybeAlert(result.somnolencia ? "somnolencia" : result.nivel_fatiga);
  } catch (err) {
    if (err.status === 409) {
      sesionClosedByServer();
      return;
    }
    console.error("No se pudo guardar la medición:", err.message);
  }
}

function sesionClosedByServer() {
  sesionId = null;
  if (finishDialog.open) finishDialog.close();
  releaseResources();
  showDashboardView();
  alert("La sesión se cerró automáticamente por inactividad. Puedes iniciar una nueva.");
}

const NIVEL_HINT = {
  sin_fatiga: "Tus indicadores están en rango normal.",
  leve: "Parpadeas poco o muchos de tus parpadeos no cierran del todo.",
  moderada: "Parpadeas poco y muchos de tus parpadeos no cierran del todo.",
};

function setStatus(kind, text) {
  statusPill.className = `pill pill--${kind}`;
  statusText.textContent = text;
}

function setFaceVisible(visible) {
  if (noFaceOverlay.hidden === visible) return;
  noFaceOverlay.hidden = visible;
  if (baselineEar === null || paused) return;
  setStatus(visible ? "running" : "warn", visible ? "Monitoreando" : "Sin rostro");
}

function showFatigueLevel(nivel) {
  const card = document.getElementById("metric-fatiga-card");
  card.dataset.nivel = nivel;
  document.getElementById("metric-fatiga").textContent = NIVEL_LABEL[nivel] || nivel;
  document.getElementById("metric-fatiga-hint").textContent = NIVEL_HINT[nivel] || "";
}

const MENSAJES_ALERTA = {
  leve: {
    titulo: "Fatiga visual leve",
    texto: "Parpadea conscientemente y considera una pausa breve para tus ojos.",
  },
  moderada: {
    titulo: "Fatiga visual moderada",
    texto: "Te recomendamos detenerte y descansar la vista unos segundos.",
  },
  somnolencia: {
    titulo: "Signos de somnolencia",
    texto: "Tus ojos se cierran por momentos largos. Si tienes sueño, conviene descansar antes de seguir.",
  },
};

function maybeAlert(nivel) {
  const mensaje = MENSAJES_ALERTA[nivel];
  if (!mensaje) {
    hideToast();
    return;
  }
  const reciente = Date.now() - lastAlert.dismissedAt < ALERT_COOLDOWN_MS;
  if (reciente && lastAlert.nivel === nivel) return;

  lastAlert.nivel = nivel;
  document.getElementById("toast-title").textContent = mensaje.titulo;
  document.getElementById("toast-text").textContent = mensaje.texto;
  toastEl.dataset.nivel = nivel;
  const sugerirJuego = nivel === "leve";
  document.getElementById("toast-game-btn").hidden = !sugerirJuego;
  document.getElementById("toast-break-btn").hidden = sugerirJuego;
  toastEl.hidden = false;
}

function hideToast() {
  toastEl.hidden = true;
}

function startGame() {
  if (baselineEar === null || BlinkGame.active) return;
  hideToast();
  lastAlert.dismissedAt = Date.now();
  paused = true;
  setStatus("idle", "Ejercicio");
  if (!viewerVideo.hidden) viewerVideo.pause();
  eyeListener = BlinkGame.onEye;
  BlinkGame.open(endGame);
}

function endGame() {
  eyeListener = null;
  if (sesionId === null) return;
  resetWindow();
  paused = false;
  setStatus("running", "Monitoreando");
}

function startBreak() {
  hideToast();
  lastAlert.dismissedAt = Date.now();
  paused = true;
  setStatus("idle", "En pausa");
  if (!viewerVideo.hidden) viewerVideo.pause();

  let remaining = BREAK_SECONDS;
  breakCount.textContent = remaining;
  breakOverlay.hidden = false;
  breakHandle = setInterval(() => {
    remaining -= 1;
    breakCount.textContent = remaining;
    if (remaining <= 0) endBreak();
  }, 1000);
}

function endBreak() {
  clearInterval(breakHandle);
  breakHandle = null;
  breakOverlay.hidden = true;
  resetWindow();
  paused = false;
  setStatus("running", "Monitoreando");
}

function startTimer() {
  timerEl.hidden = false;
  const tick = () => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.textContent = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  };
  tick();
  timerHandle = setInterval(tick, 1000);
}

function showContent(actividad, file) {
  viewerPdf.hidden = true;
  viewerVideo.hidden = true;
  viewerEmpty.hidden = true;

  if (actividad === "libre" || !file) {
    viewerEmpty.hidden = false;
    return;
  }
  contentUrl = URL.createObjectURL(file);
  if (actividad === "lectura") {
    viewerPdf.src = contentUrl;
    viewerPdf.hidden = false;
  } else {
    viewerVideo.src = contentUrl;
    viewerVideo.hidden = false;
  }
}

const ACCEPT_BY_ACTIVIDAD = { lectura: "application/pdf", video: "video/*" };

setupForm.addEventListener("change", (e) => {
  if (e.target.name !== "actividad") return;
  const accept = ACCEPT_BY_ACTIVIDAD[e.target.value];
  fileDrop.hidden = !accept;
  fileInput.value = "";
  fileDropText.textContent = e.target.value === "lectura" ? "Selecciona un PDF" : "Selecciona un video";
  if (accept) fileInput.accept = accept;
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) fileDropText.textContent = file.name;
});

function readSetup() {
  const data = new FormData(setupForm);
  const momento = data.get("momento");
  const actividad = data.get("actividad");
  const kss = selectedKss(kssInicialEl);
  const file = fileInput.files[0] || null;

  if (!momento) return { error: "Indica si estás antes o después de tu jornada de estudio." };
  if (!actividad) return { error: "Elige qué vas a hacer durante la sesión." };
  if (actividad !== "libre" && !file) return { error: "Selecciona el archivo que vas a usar." };
  if (!kss) return { error: "Indica tu nivel de somnolencia (KSS)." };
  return { momento, actividad, kss, file };
}

function resetMonitoreo() {
  setupForm.reset();
  fileDrop.hidden = true;
  setupError.hidden = true;
  setupSection.hidden = false;
  liveSection.hidden = true;
  stopBtn.hidden = true;
  timerEl.hidden = true;
  setStatus("idle", "Preparando");
}

async function startMonitoring(setup) {
  const session = await apiFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({ actividad: setup.actividad, momento: setup.momento, kss_inicial: setup.kss }),
  });
  sesionId = session.sesion_id;

  baselineEar = null;
  calibrationSamples = [];
  calibrationStartedAt = null;
  fullClosureEar = null;
  closureCalibration = null;
  lastFaceAt = null;
  paused = false;
  lastAlert = { nivel: null, dismissedAt: 0 };
  lastSentAt = 0;
  resetWindow();

  document.getElementById("metric-fatiga-card").dataset.nivel = "";
  document.getElementById("metric-fatiga").textContent = "Esperando datos…";
  document.getElementById("metric-fatiga-hint").textContent = "Se evalúa cada minuto con lo ocurrido en ese minuto.";
  ["metric-perclos", "metric-parpadeo", "metric-incompletos", "metric-cierre", "metric-prolongados", "metric-ear", "metric-velocidad"]
    .forEach((id) => (document.getElementById(id).textContent = "--"));
  calibrationBar.style.transform = "scaleX(0)";
  calibrationOverlay.hidden = false;
  noFaceOverlay.hidden = true;

  setupSection.hidden = true;
  liveSection.hidden = false;
  stopBtn.hidden = false;
  showContent(setup.actividad, setup.file);
  setStatus("calibrating", "Calibrando");

  firstResultReceived = false;
  calibrationText.textContent = "Cargando detector facial…";
  detectorTimeoutHandle = setTimeout(() => {
    calibrationText.textContent = "El detector no responde. Recarga la página (Ctrl + F5) e inténtalo de nuevo.";
  }, DETECTOR_TIMEOUT_MS);

  const detector = getFaceMesh();

  camera = new Camera(videoEl, {
    onFrame: async () => {
      await detector.send({ image: videoEl });
    },
    width: 640,
    height: 480,
  });
  await camera.start();

  sendIntervalHandle = setInterval(sendMetrics, METRICS_SEND_INTERVAL_MS);
}

function getFaceMesh() {
  if (faceMesh === null) {
    faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults(onFaceMeshResults);
  }
  return faceMesh;
}

function releaseResources() {
  clearInterval(sendIntervalHandle);
  clearInterval(timerHandle);
  clearInterval(breakHandle);
  sendIntervalHandle = timerHandle = breakHandle = null;
  breakOverlay.hidden = true;
  hideToast();
  BlinkGame.close();
  Charts.stopLive();
  eyeListener = null;
  document.getElementById("side-game-btn").disabled = true;

  if (camera) camera.stop();
  clearTimeout(detectorTimeoutHandle);
  camera = null;
  videoEl.srcObject?.getTracks().forEach((track) => track.stop());
  videoEl.srcObject = null;

  viewerVideo.pause();
  viewerVideo.removeAttribute("src");
  viewerPdf.removeAttribute("src");
  if (contentUrl) URL.revokeObjectURL(contentUrl);
  contentUrl = null;
}

async function finishMonitoring(kssFinal) {
  await sendMetrics();
  if (sesionId === null) return;
  try {
    await apiFetch(`/sessions/${sesionId}/finish`, {
      method: "PUT",
      body: JSON.stringify({ kss_final: kssFinal }),
    });
  } catch (err) {
    if (err.status !== 409) throw err;
    sesionClosedByServer();
    return;
  }
  abrirResumenAlVolver(sesionId);
  sesionId = null;
  releaseResources();
  showDashboardView();
}

setupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const setup = readSetup();
  if (setup.error) {
    setupError.textContent = setup.error;
    setupError.hidden = false;
    return;
  }
  setupError.hidden = true;
  startBtn.disabled = true;
  try {
    await startMonitoring(setup);
  } catch (err) {
    console.error(err);
    sesionId = null;
    releaseResources();
    resetMonitoreo();
    setupError.textContent = `No se pudo iniciar el monitoreo: ${err.message}`;
    setupError.hidden = false;
  } finally {
    startBtn.disabled = false;
  }
});

function askToFinish() {
  finishForm.reset();
  finishError.hidden = true;
  finishDialog.showModal();
}

stopBtn.addEventListener("click", askToFinish);

document.getElementById("finish-cancel-btn").addEventListener("click", () => finishDialog.close());

finishForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const kss = selectedKss(kssFinalEl);
  if (!kss) {
    finishError.textContent = "Selecciona tu nivel de somnolencia para terminar.";
    finishError.hidden = false;
    return;
  }
  const confirmBtn = document.getElementById("finish-confirm-btn");
  confirmBtn.disabled = true;
  try {
    await finishMonitoring(kss);
    finishDialog.close();
  } catch (err) {
    finishError.textContent = `No se pudo finalizar la sesión: ${err.message}`;
    finishError.hidden = false;
  } finally {
    confirmBtn.disabled = false;
  }
});

document.getElementById("toast-close-btn").addEventListener("click", () => {
  hideToast();
  lastAlert.dismissedAt = Date.now();
});
document.getElementById("toast-break-btn").addEventListener("click", startBreak);
document.getElementById("toast-game-btn").addEventListener("click", startGame);
document.getElementById("side-game-btn").addEventListener("click", startGame);
document.getElementById("break-skip-btn").addEventListener("click", endBreak);

document.getElementById("mon-back-btn").addEventListener("click", () => {
  if (sesionId !== null) askToFinish();
  else showDashboardView();
});

window.addEventListener("beforeunload", (e) => {
  if (sesionId !== null) e.preventDefault();
});
