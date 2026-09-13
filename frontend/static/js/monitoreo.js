const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const RIGHT_IRIS_CENTER = 468;
const LEFT_IRIS_CENTER = 473;

const CALIBRATION_SECONDS = 5;
const CLOSURE_RATIO = 0.75;
const PERCLOS_WINDOW_MS = 60_000;
const METRICS_SEND_INTERVAL_MS = 15_000;
const MIN_WINDOW_FOR_METRICS_MS = 20_000;

const videoEl = document.getElementById("webcam");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const momentoSelect = document.getElementById("mon-momento-select");
const nivelSelect = document.getElementById("mon-nivel-select");

let camera = null;
let faceMesh = null;
let sesionId = null;

let baselineEar = null;
let calibrationSamples = [];
let calibrationStartedAt = null;

let earHistory = [];
let wasClosed = false;
let blinkTimestamps = [];
let closureStartedAt = null;
let closureDurations = [];

let lastIrisPoint = null;
let lastIrisTime = null;
let ocularVelocitySamples = [];

let sendIntervalHandle = null;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(landmarks, eyeIndices) {
  const [p1, p2, p3, p4, p5, p6] = eyeIndices.map((i) => landmarks[i]);
  const vertical = distance(p2, p6) + distance(p3, p5);
  const horizontal = distance(p1, p4);
  return vertical / (2 * horizontal);
}

function averageIrisCenter(landmarks) {
  const right = landmarks[RIGHT_IRIS_CENTER];
  const left = landmarks[LEFT_IRIS_CENTER];
  return { x: (right.x + left.x) / 2, y: (right.y + left.y) / 2 };
}

function onFaceMeshResults(results) {
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    return;
  }
  const landmarks = results.multiFaceLandmarks[0];

  const earRight = eyeAspectRatio(landmarks, RIGHT_EYE);
  const earLeft = eyeAspectRatio(landmarks, LEFT_EYE);
  const ear = (earRight + earLeft) / 2;

  const now = Date.now();

  if (baselineEar === null) {
    if (calibrationStartedAt === null) calibrationStartedAt = now;
    calibrationSamples.push(ear);

    const elapsed = (now - calibrationStartedAt) / 1000;
    if (elapsed >= CALIBRATION_SECONDS) {
      baselineEar = calibrationSamples.reduce((a, b) => a + b, 0) / calibrationSamples.length;
      console.info(`Línea base de EAR calibrada: ${baselineEar.toFixed(3)}`);
    }
    return;
  }

  const closureThreshold = baselineEar * CLOSURE_RATIO;
  const closed = ear < closureThreshold;

  if (closed && !wasClosed) {
    blinkTimestamps.push(now);
    closureStartedAt = now;
  }
  if (!closed && wasClosed && closureStartedAt !== null) {
    closureDurations.push({ t: now, duration: now - closureStartedAt });
    closureStartedAt = null;
  }
  wasClosed = closed;

  earHistory.push({ t: now, ear, closed });

  const irisPoint = averageIrisCenter(landmarks);
  if (lastIrisPoint !== null && lastIrisTime !== null) {
    const dt = (now - lastIrisTime) / 1000;
    if (dt > 0) {
      ocularVelocitySamples.push({ t: now, speed: distance(irisPoint, lastIrisPoint) / dt });
    }
  }
  lastIrisPoint = irisPoint;
  lastIrisTime = now;

  const cutoff = now - PERCLOS_WINDOW_MS;
  earHistory = earHistory.filter((s) => s.t >= cutoff);
  blinkTimestamps = blinkTimestamps.filter((t) => t >= cutoff);
  closureDurations = closureDurations.filter((s) => s.t >= cutoff);
  ocularVelocitySamples = ocularVelocitySamples.filter((s) => s.t >= cutoff);

  updateMetricsDisplay(ear);
}

function averageOf(list, key) {
  if (list.length === 0) return 0;
  return list.reduce((a, s) => a + s[key], 0) / list.length;
}

function updateMetricsDisplay(currentEar) {
  document.getElementById("metric-ear").textContent = currentEar.toFixed(3);

  if (earHistory.length === 0) return;

  const closedCount = earHistory.filter((s) => s.closed).length;
  const perclos = (closedCount / earHistory.length) * 100;

  const windowMinutes = Math.min(PERCLOS_WINDOW_MS, Date.now() - earHistory[0].t) / 60_000;
  const parpadeosMin = windowMinutes > 0 ? blinkTimestamps.length / windowMinutes : 0;

  document.getElementById("metric-perclos").textContent = perclos.toFixed(1);
  document.getElementById("metric-parpadeo").textContent = parpadeosMin.toFixed(1);
  document.getElementById("metric-cierre").textContent = averageOf(closureDurations, "duration").toFixed(0);
  document.getElementById("metric-velocidad").textContent = averageOf(ocularVelocitySamples, "speed").toFixed(3);
}

function currentMetrics() {
  if (earHistory.length === 0) return null;
  if (Date.now() - earHistory[0].t < MIN_WINDOW_FOR_METRICS_MS) return null;

  const closedCount = earHistory.filter((s) => s.closed).length;
  const perclos = (closedCount / earHistory.length) * 100;
  const avgEar = earHistory.reduce((a, s) => a + s.ear, 0) / earHistory.length;

  const windowMinutes = Math.min(PERCLOS_WINDOW_MS, Date.now() - earHistory[0].t) / 60_000;
  const parpadeosMin = windowMinutes > 0 ? blinkTimestamps.length / windowMinutes : 0;

  return {
    ear: avgEar,
    perclos,
    parpadeos_min: parpadeosMin,
    tiempo_cierre: averageOf(closureDurations, "duration"),
    velocidad_ocular: averageOf(ocularVelocitySamples, "speed"),
    nivel_subjetivo: Number(nivelSelect.value),
  };
}

const MENSAJES_ALERTA = {
  leve: "Fatiga visual leve detectada. Considera tomar un descanso breve.",
  moderada: "Fatiga visual moderada. Te recomendamos detener la sesión y descansar los ojos.",
};

function actualizarAlertaFatiga(nivelFatiga) {
  const alertaEl = document.getElementById("fatiga-alerta");

  alertaEl.classList.remove("alerta-leve", "alerta-moderada");

  const mensaje = MENSAJES_ALERTA[nivelFatiga];
  if (!mensaje) {
    alertaEl.hidden = true;
    alertaEl.textContent = "";
    return;
  }

  alertaEl.textContent = mensaje;
  alertaEl.classList.add(`alerta-${nivelFatiga}`);
  alertaEl.hidden = false;
}

async function sendMetrics() {
  const metrics = currentMetrics();
  if (!metrics || sesionId === null) return;

  try {
    const result = await apiFetch(`/sessions/${sesionId}/metrics`, {
      method: "POST",
      body: JSON.stringify({ actividad: "lectura", ...metrics }),
    });
    document.getElementById("metric-fatiga").textContent =
      NIVEL_LABEL[result.nivel_fatiga] || result.nivel_fatiga;
    const fatigaCard = document.getElementById("metric-fatiga-card");
    fatigaCard.classList.remove("stat-card--ok", "stat-card--leve", "stat-card--moderada");
    const clase = { sin_fatiga: "stat-card--ok", leve: "stat-card--leve", moderada: "stat-card--moderada" }[result.nivel_fatiga];
    if (clase) fatigaCard.classList.add(clase);
    actualizarAlertaFatiga(result.nivel_fatiga);
  } catch (err) {
    console.error("No se pudo guardar la métrica:", err.message);
  }
}

async function startMonitoring() {
  const momento = momentoSelect.value || null;
  const session = await apiFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({ actividad: "lectura", momento }),
  });
  sesionId = session.sesion_id;
  momentoSelect.disabled = true;

  baselineEar = null;
  calibrationSamples = [];
  calibrationStartedAt = null;
  earHistory = [];
  blinkTimestamps = [];
  wasClosed = false;
  closureStartedAt = null;
  closureDurations = [];
  lastIrisPoint = null;
  lastIrisTime = null;
  ocularVelocitySamples = [];
  actualizarAlertaFatiga(null);

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

  camera = new Camera(videoEl, {
    onFrame: async () => {
      await faceMesh.send({ image: videoEl });
    },
    width: 640,
    height: 480,
  });
  await camera.start();

  sendIntervalHandle = setInterval(sendMetrics, METRICS_SEND_INTERVAL_MS);

  startBtn.hidden = true;
  stopBtn.hidden = false;
}

async function stopMonitoring() {
  if (sendIntervalHandle) clearInterval(sendIntervalHandle);
  await sendMetrics();

  if (camera) camera.stop();
  if (faceMesh) faceMesh.close();

  if (sesionId !== null) {
    try {
      await apiFetch(`/sessions/${sesionId}/finish`, { method: "PUT" });
    } catch (err) {
      console.error("No se pudo finalizar la sesión:", err.message);
    }
  }
  sesionId = null;
  actualizarAlertaFatiga(null);
  momentoSelect.disabled = false;
  momentoSelect.value = "";
  nivelSelect.value = "3";

  startBtn.hidden = false;
  stopBtn.hidden = true;
}

startBtn.addEventListener("click", () => {
  startMonitoring().catch((err) => {
    console.error(err);
    alert(`No se pudo iniciar el monitoreo: ${err.message}`);
  });
});

stopBtn.addEventListener("click", () => {
  stopMonitoring().catch((err) => console.error(err));
});

document.getElementById("mon-back-btn").addEventListener("click", async () => {
  if (!stopBtn.hidden) {
    await stopMonitoring().catch((err) => console.error(err));
  }
  showDashboardView();
});
