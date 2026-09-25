// Índices de MediaPipe Face Mesh (468 puntos + 10 de iris con refineLandmarks).
// Orden EAR: p1 y p4 = comisuras; p2, p3 = párpado superior; p5, p6 = párpado inferior.
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const RIGHT_IRIS_CENTER = 468;
const LEFT_IRIS_CENTER = 473;

// Calibración (EAR adaptativo, Gupta et al. 2023): la línea base es la mediana del EAR
// con los ojos abiertos, robusta frente a los parpadeos que ocurran al calibrar.
const CALIBRATION_MS = 5_000;
const MIN_CALIBRATION_SAMPLES = 30;

// Detección de parpadeo con histéresis: el ojo "se cierra" al bajar del 75 % de la línea
// base y "se abre" al superar el 85 %, para que el ruido cerca del umbral no genere
// parpadeos falsos. Los cierres se filtran por duración (Abdulkader et al. 2023).
const BLINK_CLOSE_RATIO = 0.75;
const BLINK_OPEN_RATIO = 0.85;
const MIN_CLOSURE_MS = 50;
const MAX_BLINK_MS = 500;

// PERCLOS P80: fracción del tiempo con el párpado cerrado al 80 % o más. El EAR de un ojo
// cerrado no llega a 0 con Face Mesh, así que la apertura se normaliza entre el "piso"
// (mediana del EAR mínimo de los parpadeos recientes) y la línea base.
const P80_OPENNESS = 0.2;
const DEFAULT_FLOOR_RATIO = 0.4;
const MIN_BLINKS_FOR_FLOOR = 3;
const FLOOR_BLINK_SAMPLES = 20;

const WINDOW_MS = 60_000;
const MAX_FRAME_GAP_MS = 250;
const FACE_LOST_MS = 1_500;
const METRICS_SEND_INTERVAL_MS = 15_000;
const MIN_OBSERVED_MS = 20_000;

const DETECTOR_TIMEOUT_MS = 20_000;

const BREAK_SECONDS = 20;
// Mismo umbral que PARPADEOS_MIN_BAJO en backend/fatigue.py: decide qué ejercicio sugerir.
const PARPADEOS_MIN_BAJO = 8;
const ALERT_COOLDOWN_MS = 120_000;

// ---------- Elementos ----------
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

// ---------- Estado ----------
let camera = null;
// El detector se crea una sola vez por visita: la solución JS de MediaPipe puede quedar
// colgada si se cierra y se vuelve a crear, así que se reutiliza entre sesiones.
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

let samples = [];        // { t, dt, ear, p80 }
let blinks = [];         // { t, trough }
let closures = [];       // { t, duration }
let longClosures = [];   // { t }
let velocities = [];     // { t, speed }
let recentTroughs = [];

let eyeClosed = false;
let closureStartedAt = null;
let closureTrough = null;
let lastSampleAt = null;
let lastFaceAt = null;
let lastIris = null;
let paused = false;
let eyeListener = null;  // recibe el EAR mientras hay un ejercicio activo (minijuego)
let lastMetrics = null;
let lastAlert = { nivel: null, dismissedAt: 0 };

// ---------- Geometría ----------
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(landmarks, eyeIndices) {
  const [p1, p2, p3, p4, p5, p6] = eyeIndices.map((i) => landmarks[i]);
  return (distance(p2, p6) + distance(p3, p5)) / (2 * distance(p1, p4));
}

// Posición del iris relativa a las comisuras del ojo, en anchos de ojo. Al ser relativa,
// los desplazamientos de la cabeza no se confunden con movimiento ocular.
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

// ---------- Procesamiento por fotograma ----------
function onFaceMeshResults(results) {
  // Resultados rezagados de un fotograma enviado antes de cerrar la sesión.
  if (camera === null) return;
  if (!firstResultReceived) {
    firstResultReceived = true;
    clearTimeout(detectorTimeoutHandle);
    calibrationText.textContent = "Calibrando: mira la pantalla con naturalidad…";
  }
  const now = performance.now();
  const landmarks = results.multiFaceLandmarks?.[0];

  if (!landmarks) {
    // Sin rostro no se acumula tiempo observado: el siguiente fotograma empieza de cero.
    lastSampleAt = null;
    lastIris = null;
    if (lastFaceAt === null || now - lastFaceAt > FACE_LOST_MS) setFaceVisible(false);
    return;
  }
  lastFaceAt = now;
  setFaceVisible(true);

  const ear = (eyeAspectRatio(landmarks, RIGHT_EYE) + eyeAspectRatio(landmarks, LEFT_EYE)) / 2;

  if (baselineEar === null) {
    calibrate(ear, now);
    return;
  }
  if (eyeListener) {
    // Durante un ejercicio los parpadeos son voluntarios: van al ejercicio, no a las métricas.
    eyeListener(ear, now);
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

  const floor = closedEyeFloor();
  const p80Threshold = floor + P80_OPENNESS * (baselineEar - floor);
  samples.push({ t: now, dt, ear, p80: ear <= p80Threshold });

  const offsetRight = irisOffset(landmarks, RIGHT_EYE, RIGHT_IRIS_CENTER);
  const offsetLeft = irisOffset(landmarks, LEFT_EYE, LEFT_IRIS_CENTER);
  const iris = { x: (offsetRight.x + offsetLeft.x) / 2, y: (offsetRight.y + offsetLeft.y) / 2 };
  // Durante un cierre el iris no es visible y su posición estimada no es confiable.
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
  calibrationBar.style.width = `${progress * 100}%`;

  if (progress >= 1 && calibrationSamples.length >= MIN_CALIBRATION_SAMPLES) {
    baselineEar = median(calibrationSamples);
    console.info(`Línea base de EAR (mediana): ${baselineEar.toFixed(3)}`);
    calibrationOverlay.hidden = true;
    startedAt = Date.now();
    startTimer();
    document.getElementById("side-game-btn").disabled = false;
    setStatus("running", "Monitoreando");
  }
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
  if (duration < MIN_CLOSURE_MS) return; // ruido de un solo fotograma

  closures.push({ t: now, duration });
  if (duration <= MAX_BLINK_MS) {
    blinks.push({ t: now, trough: closureTrough });
    recentTroughs.push(closureTrough);
    if (recentTroughs.length > FLOOR_BLINK_SAMPLES) recentTroughs.shift();
  } else {
    longClosures.push({ t: now });
  }
}

function closedEyeFloor() {
  const fallback = baselineEar * DEFAULT_FLOOR_RATIO;
  if (recentTroughs.length < MIN_BLINKS_FOR_FLOOR) return fallback;
  // El piso nunca puede quedar por encima del umbral de cierre del parpadeo.
  return Math.min(median(recentTroughs), baselineEar * (BLINK_CLOSE_RATIO - 0.15));
}

function pruneWindow(now) {
  const cutoff = now - WINDOW_MS;
  samples = samples.filter((s) => s.t >= cutoff);
  blinks = blinks.filter((b) => b.t >= cutoff);
  closures = closures.filter((c) => c.t >= cutoff);
  longClosures = longClosures.filter((c) => c.t >= cutoff);
  velocities = velocities.filter((v) => v.t >= cutoff);
}

function resetWindow() {
  samples = [];
  blinks = [];
  closures = [];
  longClosures = [];
  velocities = [];
  eyeClosed = false;
  lastSampleAt = null;
  lastIris = null;
}

// ---------- Métricas de la ventana ----------
function computeMetrics() {
  const observedMs = samples.reduce((acc, s) => acc + s.dt, 0);
  if (observedMs === 0) return null;

  const closedMs = samples.reduce((acc, s) => acc + (s.p80 ? s.dt : 0), 0);
  return {
    observedMs,
    ear: averageOf(samples, "ear"),
    perclos: (closedMs / observedMs) * 100,
    parpadeos_min: blinks.length / (observedMs / 60_000),
    tiempo_cierre: averageOf(closures, "duration"),
    velocidad_ocular: averageOf(velocities, "speed"),
    cierres_prolongados: longClosures.length,
  };
}

function updateLiveMetrics(currentEar) {
  document.getElementById("metric-ear").textContent = currentEar.toFixed(3);
  const m = computeMetrics();
  if (!m) return;
  document.getElementById("metric-perclos").textContent = m.perclos.toFixed(1);
  document.getElementById("metric-parpadeo").textContent = m.parpadeos_min.toFixed(1);
  document.getElementById("metric-cierre").textContent = m.tiempo_cierre.toFixed(0);
  document.getElementById("metric-prolongados").textContent = m.cierres_prolongados;
  document.getElementById("metric-velocidad").textContent = m.velocidad_ocular.toFixed(2);
}

async function sendMetrics() {
  if (sesionId === null || paused) return;
  const m = computeMetrics();
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
      }),
    });
    lastMetrics = m;
    showFatigueLevel(result.nivel_fatiga);
    maybeAlert(result.nivel_fatiga);
  } catch (err) {
    console.error("No se pudo guardar la medición:", err.message);
  }
}

// ---------- Interfaz ----------
const NIVEL_HINT = {
  sin_fatiga: "Tus indicadores están en rango normal.",
  leve: "Parpadeas poco o tus ojos se cierran más de lo habitual.",
  moderada: "Tus ojos muestran signos claros de cansancio.",
};

function setStatus(kind, text) {
  statusPill.className = `pill pill--${kind}`;
  statusText.textContent = text;
}

function setFaceVisible(visible) {
  if (noFaceOverlay.hidden === visible) return; // sin cambios: evita tocar el DOM en cada fotograma
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
};

function maybeAlert(nivel) {
  const mensaje = MENSAJES_ALERTA[nivel];
  if (!mensaje) {
    hideToast();
    return;
  }
  // No se repite el mismo aviso inmediatamente después de cerrarlo (evita saturar al usuario).
  const reciente = Date.now() - lastAlert.dismissedAt < ALERT_COOLDOWN_MS;
  if (reciente && lastAlert.nivel === nivel) return;

  lastAlert.nivel = nivel;
  document.getElementById("toast-title").textContent = mensaje.titulo;
  document.getElementById("toast-text").textContent = mensaje.texto;
  toastEl.dataset.nivel = nivel;
  // Parpadeo bajo -> ejercicio de parpadeo. PERCLOS alto indica somnolencia: ahí se
  // sugiere descansar, no un ejercicio.
  const sugerirJuego = lastMetrics !== null && lastMetrics.parpadeos_min < PARPADEOS_MIN_BAJO && nivel === "leve";
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
  if (sesionId === null) return; // la sesión se cerró mientras el juego estaba abierto
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
  // Se reinicia la ventana para que las mediciones posteriores reflejen el estado tras la pausa.
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
  // El archivo se abre desde memoria local (blob:), nunca se sube al servidor.
  contentUrl = URL.createObjectURL(file);
  if (actividad === "lectura") {
    viewerPdf.src = contentUrl;
    viewerPdf.hidden = false;
  } else {
    viewerVideo.src = contentUrl;
    viewerVideo.hidden = false;
  }
}

// ---------- Preparación ----------
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
  recentTroughs = [];
  lastFaceAt = null;
  paused = false;
  lastAlert = { nivel: null, dismissedAt: 0 };
  lastMetrics = null;
  resetWindow();

  document.getElementById("metric-fatiga-card").dataset.nivel = "";
  document.getElementById("metric-fatiga").textContent = "Esperando datos…";
  document.getElementById("metric-fatiga-hint").textContent = "Se evalúa cada 15 s con la ventana del último minuto.";
  ["metric-perclos", "metric-parpadeo", "metric-cierre", "metric-prolongados", "metric-ear", "metric-velocidad"]
    .forEach((id) => (document.getElementById(id).textContent = "--"));
  calibrationBar.style.width = "0%";
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
  await apiFetch(`/sessions/${sesionId}/finish`, {
    method: "PUT",
    body: JSON.stringify({ kss_final: kssFinal }),
  });
  sesionId = null;
  releaseResources();
  showDashboardView();
}

// ---------- Eventos ----------
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
  // Una sesión en curso se cierra con la KSS final; si aún no empezó, se vuelve directo.
  if (sesionId !== null) askToFinish();
  else showDashboardView();
});

window.addEventListener("beforeunload", (e) => {
  if (sesionId !== null) e.preventDefault();
});
