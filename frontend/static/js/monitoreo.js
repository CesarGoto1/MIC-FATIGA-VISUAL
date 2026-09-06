/**
 * Captura de video (WebRTC) + MediaPipe FaceMesh + cálculo de EAR/PERCLOS
 * /frecuencia de parpadeo, TODO en el cliente (RNF01, Privacidad por
 * diseño). Solo se envían al backend los números ya calculados —
 * nunca video ni imágenes.
 *
 * Referencias de la RSL:
 *  - EAR estándar de 6 puntos por ojo: Abdulkader et al. (2023).
 *  - Línea base adaptativa por usuario (AEAR) en vez de umbral fijo:
 *    Gupta et al. (2023).
 */

// Índices de landmarks de MediaPipe FaceMesh para el contorno de cada ojo
// (formato estándar de 6 puntos usado para el cálculo de EAR).
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE = [362, 385, 387, 263, 373, 380];

const CALIBRATION_SECONDS = 5;   // duración de la línea base personalizada (AEAR)
const CLOSURE_RATIO = 0.75;      // el ojo se considera "cerrado" bajo este % de la línea base
const PERCLOS_WINDOW_MS = 60_000; // ventana móvil de 1 minuto para PERCLOS y parpadeo/min
const METRICS_SEND_INTERVAL_MS = 15_000; // cada cuánto se envían métricas al backend
// Ventana mínima de datos reales antes de confiar en parpadeos_min. Recién
// iniciada la sesión casi no ha pasado tiempo, así que 0 parpadeos todavía
// no significa "parpadeo bajo" (backend/fatigue.py lo clasificaría como
// "leve" de entrada) — solo significa que aún no hay suficiente muestra.
const MIN_WINDOW_FOR_METRICS_MS = 20_000;

const videoEl = document.getElementById("webcam");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const momentoSelect = document.getElementById("mon-momento-select");

let camera = null;
let faceMesh = null;
let sesionId = null;

let baselineEar = null;
let calibrationSamples = [];
let calibrationStartedAt = null;

let earHistory = []; // { t: timestampMs, ear: number, closed: boolean }
let wasClosed = false;
let blinkTimestamps = [];

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

function onFaceMeshResults(results) {
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    return; // sin rostro detectado en este fotograma
  }
  const landmarks = results.multiFaceLandmarks[0];

  const earRight = eyeAspectRatio(landmarks, RIGHT_EYE);
  const earLeft = eyeAspectRatio(landmarks, LEFT_EYE);
  const ear = (earRight + earLeft) / 2;

  const now = Date.now();

  // --- Fase 1: calibración de línea base personalizada (AEAR) ---
  if (baselineEar === null) {
    if (calibrationStartedAt === null) calibrationStartedAt = now;
    calibrationSamples.push(ear);

    const elapsed = (now - calibrationStartedAt) / 1000;
    if (elapsed >= CALIBRATION_SECONDS) {
      baselineEar = calibrationSamples.reduce((a, b) => a + b, 0) / calibrationSamples.length;
      console.info(`Línea base de EAR calibrada: ${baselineEar.toFixed(3)}`);
    }
    return; // no se registran métricas todavía durante la calibración
  }

  // --- Fase 2: monitoreo normal ---
  const closureThreshold = baselineEar * CLOSURE_RATIO;
  const closed = ear < closureThreshold;

  if (closed && !wasClosed) {
    blinkTimestamps.push(now);
  }
  wasClosed = closed;

  earHistory.push({ t: now, ear, closed });

  // Descarta muestras fuera de la ventana móvil de PERCLOS/parpadeo.
  const cutoff = now - PERCLOS_WINDOW_MS;
  earHistory = earHistory.filter((s) => s.t >= cutoff);
  blinkTimestamps = blinkTimestamps.filter((t) => t >= cutoff);

  updateMetricsDisplay(ear);
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
}

function currentMetrics() {
  if (earHistory.length === 0) return null;
  if (Date.now() - earHistory[0].t < MIN_WINDOW_FOR_METRICS_MS) return null;

  const closedCount = earHistory.filter((s) => s.closed).length;
  const perclos = (closedCount / earHistory.length) * 100;
  const avgEar = earHistory.reduce((a, s) => a + s.ear, 0) / earHistory.length;

  const windowMinutes = Math.min(PERCLOS_WINDOW_MS, Date.now() - earHistory[0].t) / 60_000;
  const parpadeosMin = windowMinutes > 0 ? blinkTimestamps.length / windowMinutes : 0;

  return { ear: avgEar, perclos, parpadeos_min: parpadeosMin };
}

// RF06: mensajes y clase CSS de la alerta visual para cada nivel de fatiga
// que devuelve el backend (backend/fatigue.py es la fuente única de verdad).
const MENSAJES_ALERTA = {
  leve: "Fatiga visual leve detectada. Considera tomar un descanso breve.",
  moderada: "Fatiga visual moderada. Te recomendamos detener la sesión y descansar los ojos.",
};

function actualizarAlertaFatiga(nivelFatiga) {
  const alertaEl = document.getElementById("fatiga-alerta");

  alertaEl.classList.remove("alerta-leve", "alerta-moderada");

  const mensaje = MENSAJES_ALERTA[nivelFatiga];
  if (!mensaje) {
    // "sin_fatiga" (o nivel desconocido): no hay nada que alertar.
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
    // NIVEL_LABEL/NIVEL_CLASE vienen de dashboard.js: mismas etiquetas y
    // colores que las insignias de "Sesiones recientes" en el panel.
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
  // 1. Crear la sesión en el backend (RF07: momento pre/post opcional
  // para la validación experimental de la jornada de estudio).
  const momento = momentoSelect.value || null;
  const session = await apiFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({ actividad: "lectura", momento }),
  });
  sesionId = session.sesion_id;
  momentoSelect.disabled = true;

  // 2. Reiniciar el estado de calibración y métricas.
  baselineEar = null;
  calibrationSamples = [];
  calibrationStartedAt = null;
  earHistory = [];
  blinkTimestamps = [];
  wasClosed = false;
  actualizarAlertaFatiga(null); // limpia cualquier alerta de una sesión anterior

  // 3. Inicializar MediaPipe FaceMesh.
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

  // 4. Iniciar la cámara y alimentar cada fotograma a FaceMesh.
  camera = new Camera(videoEl, {
    onFrame: async () => {
      await faceMesh.send({ image: videoEl });
    },
    width: 640,
    height: 480,
  });
  await camera.start();

  // 5. Enviar métricas al backend periódicamente.
  sendIntervalHandle = setInterval(sendMetrics, METRICS_SEND_INTERVAL_MS);

  startBtn.hidden = true;
  stopBtn.hidden = false;
}

async function stopMonitoring() {
  if (sendIntervalHandle) clearInterval(sendIntervalHandle);
  await sendMetrics(); // último envío antes de cerrar

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
  // Si hay una sesión activa, la finaliza antes de volver al panel para no
  // dejar una sesión "en curso" huérfana.
  if (!stopBtn.hidden) {
    await stopMonitoring().catch((err) => console.error(err));
  }
  showDashboardView();
});
