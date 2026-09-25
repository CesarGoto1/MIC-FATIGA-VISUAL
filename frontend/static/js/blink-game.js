// Minijuego "Ojo saltarín": un ojo con patas salta cada vez que el usuario parpadea y
// además cierra su párpado a la vez que él, como retroalimentación inmediata de que la
// cámara está detectando el parpadeo.
//
// Objetivo preventivo: convertir el parpadeo completo en un hábito mediante gamificación.
// Los obstáculos aparecen al ritmo del parpadeo espontáneo en reposo (15-20/min), de modo
// que jugar equivale a practicar esa frecuencia. No hay "game over": chocar solo resta,
// para que el ejercicio no genere estrés ni carga visual adicional.
//
// Depende de monitoreo.js: baselineEar, closedEyeFloor() y las constantes de parpadeo.

const BlinkGame = (() => {
  const DURATION_MS = 60_000;
  const MIN_GAP_MS = 2_600; // 23 obstáculos/min como máximo
  const MAX_GAP_MS = 4_000; // 15 obstáculos/min como mínimo
  const TRAVEL_MS = 2_400;  // tiempo que tarda un obstáculo en cruzar hasta la gota
  const AIRTIME_MS = 950;   // mayor que un parpadeo, para ver el salto al reabrir los ojos
  const COUNTDOWN_MS = 3_000;
  const HIT_FLASH_MS = 700;
  const HINT_MS = 1_800;
  const MAX_FRAME_MS = 50;

  const overlay = document.getElementById("game-overlay");
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const introEl = document.getElementById("game-intro");
  const hudEl = document.getElementById("game-hud");
  const summaryEl = document.getElementById("game-summary");
  const hintEl = document.getElementById("game-hint");

  let phase = "closed"; // closed | intro | countdown | running | summary
  let onExit = null;
  let rafHandle = null;
  let colors = {};
  let size = { w: 0, h: 0 };

  let phaseStartedAt = 0;
  let lastFrameAt = 0;
  let gameClock = 0;       // tiempo de juego (ms), avanza con el dt limitado de cada fotograma
  let nextObstacleAt = 0;  // en tiempo de juego: con FPS bajos los obstáculos no se amontonan
  let obstacles = [];
  let jumpStartedAt = null;
  let hitAt = null;
  let hintTimer = null;
  let stats = null;

  // Detector propio (mismos umbrales con histéresis que el monitoreo).
  let eyeClosed = false;
  let closureStartedAt = null;
  let closureTrough = null;

  // ---------- Ciclo de vida ----------

  function open(exitCallback) {
    onExit = exitCallback;
    readColors();
    overlay.hidden = false;
    resizeCanvas();
    showPhase("intro");
    draw(performance.now());
  }

  function close() {
    if (phase === "closed") return;
    cancelAnimationFrame(rafHandle);
    clearTimeout(hintTimer);
    rafHandle = null;
    phase = "closed";
    overlay.hidden = true;
    const callback = onExit;
    onExit = null;
    if (callback) callback();
  }

  function begin() {
    stats = { blinks: 0, complete: 0, obstacles: 0, cleared: 0, hits: 0 };
    obstacles = [];
    jumpStartedAt = null;
    hitAt = null;
    eyeClosed = false;
    updateHud();
    document.getElementById("game-hud-time").textContent = `${DURATION_MS / 1000}s`;
    showPhase("countdown");
    phaseStartedAt = lastFrameAt = performance.now();
    rafHandle = requestAnimationFrame(loop);
  }

  function showPhase(next) {
    phase = next;
    introEl.hidden = next !== "intro";
    hudEl.hidden = next !== "running" && next !== "countdown";
    summaryEl.hidden = next !== "summary";
    hintEl.hidden = true;
  }

  // ---------- Entrada: parpadeos ----------

  function onEye(ear, now) {
    if (!eyeClosed && ear < baselineEar * BLINK_CLOSE_RATIO) {
      eyeClosed = true;
      closureStartedAt = now;
      closureTrough = ear;
      // El salto se dispara al iniciar el cierre para que el juego responda sin retraso.
      if (phase === "running") jump(now);
      return;
    }
    if (!eyeClosed) return;

    closureTrough = Math.min(closureTrough, ear);
    if (ear <= baselineEar * BLINK_OPEN_RATIO) return;

    eyeClosed = false;
    const duration = now - closureStartedAt;
    if (duration < MIN_CLOSURE_MS || duration > MAX_BLINK_MS || phase !== "running") return;

    // Parpadeo completo: el párpado llegó a cubrir al menos el 80 % de la apertura.
    const floor = closedEyeFloor();
    const complete = closureTrough <= floor + P80_OPENNESS * (baselineEar - floor);
    stats.blinks += 1;
    if (complete) stats.complete += 1;
    else showHint("Cierra los ojos por completo al parpadear");
    updateHud();
  }

  function jump(now) {
    if (jumpStartedAt !== null && now - jumpStartedAt < AIRTIME_MS) return; // sin doble salto
    jumpStartedAt = now;
  }

  function showHint(text) {
    hintEl.textContent = text;
    hintEl.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hintEl.hidden = true), HINT_MS);
  }

  // ---------- Bucle del juego ----------

  function loop(now) {
    const dt = Math.min(now - lastFrameAt, MAX_FRAME_MS);
    lastFrameAt = now;

    if (phase === "countdown" && now - phaseStartedAt >= COUNTDOWN_MS) {
      showPhase("running");
      phaseStartedAt = now;
      gameClock = 0;
      nextObstacleAt = 1_200;
      updateHud();
    }

    if (phase === "running") {
      update(now, dt);
      if (now - phaseStartedAt >= DURATION_MS) {
        finish();
        return;
      }
      updateTimer(now);
    }

    draw(now);
    rafHandle = requestAnimationFrame(loop);
  }

  function geometry() {
    const ground = size.h * 0.78;
    const radius = Math.max(16, size.h * 0.07);
    return { ground, radius, legs: radius * 0.75, eyeX: size.w * 0.2 };
  }

  // Altura del salto (0 = apoyado en el suelo).
  function jumpHeight(now) {
    if (jumpStartedAt === null) return 0;
    const t = (now - jumpStartedAt) / AIRTIME_MS;
    if (t >= 1) {
      jumpStartedAt = null;
      return 0;
    }
    return 4 * size.h * 0.36 * t * (1 - t);
  }

  function update(now, dt) {
    const { ground, radius, eyeX } = geometry();
    const speed = (size.w - eyeX) / TRAVEL_MS;
    gameClock += dt;

    if (gameClock >= nextObstacleAt) {
      const height = size.h * (0.1 + Math.random() * 0.06);
      obstacles.push({ x: size.w + 10, w: Math.max(18, size.w * 0.025), h: height, hit: false, done: false });
      stats.obstacles += 1;
      nextObstacleAt = gameClock + MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
    }

    const body = characterHitbox(eyeX, ground - jumpHeight(now), radius, geometry().legs);
    obstacles.forEach((o) => {
      o.x -= speed * dt;
      if (!o.hit && collides(body, { x: o.x, y: ground - o.h, w: o.w, h: o.h })) {
        o.hit = true;
        stats.hits += 1;
        hitAt = now;
        updateHud();
      }
      if (!o.done && o.x + o.w < eyeX - radius) {
        o.done = true;
        if (!o.hit) stats.cleared += 1;
        updateHud();
      }
    });
    obstacles = obstacles.filter((o) => o.x + o.w > -20);
  }

  // Zona de choque con la misma forma que el dibujo: círculo del ojo + rectángulo de las patas.
  function characterHitbox(x, feetY, r, legs) {
    const cy = feetY - legs - r;
    return {
      circle: { x, y: cy, r },
      legs: { x: x - r * 0.75, y: cy + r * 0.8, w: r * 1.5, h: feetY - (cy + r * 0.8) },
    };
  }

  function collides(body, rect) {
    const { circle, legs } = body;
    // Distancia del centro del círculo al punto más cercano del rectángulo.
    const nearestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w));
    const nearestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h));
    const touchesCircle = Math.hypot(circle.x - nearestX, circle.y - nearestY) < circle.r;
    const touchesLegs =
      legs.x < rect.x + rect.w && legs.x + legs.w > rect.x &&
      legs.y < rect.y + rect.h && legs.y + legs.h > rect.y;
    return touchesCircle || touchesLegs;
  }

  function finish() {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
    showPhase("summary");

    const minutos = DURATION_MS / 60_000;
    const pctCompletos = stats.blinks ? Math.round((stats.complete / stats.blinks) * 100) : 0;
    document.getElementById("game-sum-cleared").textContent = `${stats.cleared} de ${stats.obstacles}`;
    document.getElementById("game-sum-rate").textContent = `${Math.round(stats.blinks / minutos)} /min`;
    document.getElementById("game-sum-complete").textContent = `${pctCompletos} %`;

    let mensaje = "¡Muy bien! Mantén este ritmo de parpadeo mientras estudias.";
    if (stats.blinks && pctCompletos < 70) {
      mensaje = "Muchos parpadeos fueron incompletos. Intenta cerrar los párpados del todo: así se distribuye mejor la lágrima.";
    } else if (stats.blinks / minutos < 12) {
      mensaje = "Parpadeaste poco. Frente a la pantalla tendemos a olvidarlo; intenta seguir el ritmo del juego.";
    }
    document.getElementById("game-sum-message").textContent = mensaje;
  }

  // ---------- Dibujo ----------

  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    colors = {
      bg: v("--surface"),
      bg2: v("--accent-soft"),
      ground: v("--border-strong"),
      iris: v("--accent"),
      outline: v("--ink"),
      lid: v("--border-strong"),
      obstacle: v("--ink-3"),
      hit: v("--danger"),
      text: v("--ink"),
    };
  }

  function resizeCanvas() {
    const rect = overlay.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    size = { w: rect.width, h: rect.height };
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(now) {
    const { ground, radius, legs, eyeX } = geometry();

    const gradient = ctx.createLinearGradient(0, 0, 0, size.h);
    gradient.addColorStop(0, colors.bg2);
    gradient.addColorStop(1, colors.bg);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size.w, size.h);

    ctx.strokeStyle = colors.ground;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, ground);
    ctx.lineTo(size.w, ground);
    ctx.stroke();

    obstacles.forEach((o) => {
      ctx.fillStyle = o.hit ? colors.hit : colors.obstacle;
      roundRect(o.x, ground - o.h, o.w, o.h, 6);
    });

    const flashing = hitAt !== null && now - hitAt < HIT_FLASH_MS;
    const height = phase === "running" ? jumpHeight(now) : 0;
    drawEyeCharacter(now, eyeX, ground - height, radius, legs, height > 0, flashing);

    if (phase === "countdown") {
      const restante = Math.ceil((COUNTDOWN_MS - (now - phaseStartedAt)) / 1000);
      ctx.fillStyle = colors.text;
      ctx.font = `800 ${Math.round(size.h * 0.16)}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.max(1, restante)), size.w / 2, size.h * 0.42);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, [r, r, 0, 0]);
    ctx.fill();
  }

  // Ojo con patas. feetY es la altura de los pies; el párpado copia el del usuario.
  function drawEyeCharacter(now, x, feetY, r, legs, airborne, hurt) {
    const cy = feetY - legs - r;
    const line = Math.max(2, r * 0.12);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = line;
    ctx.strokeStyle = colors.outline;

    // Patas: caminan en el suelo y se recogen en el aire.
    const step = airborne || phase !== "running" ? 0 : Math.sin(now / 90) * r * 0.35;
    [[-0.4, step], [0.4, -step]].forEach(([side, swing]) => {
      const hipX = x + side * r;
      const hipY = cy + r * 0.8;
      const footX = hipX + (airborne ? side * r * 0.3 : swing);
      const footY = airborne ? feetY - legs * 0.35 : feetY;
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(footX, footY);
      ctx.lineTo(footX + r * 0.3, footY);
      ctx.stroke();
    });

    // Globo ocular
    ctx.fillStyle = hurt ? "#ffd6d6" : "#ffffff";
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Iris y pupila, mirando hacia los obstáculos
    const irisX = x + r * 0.25;
    ctx.fillStyle = hurt ? colors.hit : colors.iris;
    ctx.beginPath();
    ctx.arc(irisX, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0b1116";
    ctx.beginPath();
    ctx.arc(irisX, cy, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(irisX - r * 0.15, cy - r * 0.17, r * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Párpado: baja cuando el usuario cierra los ojos (retroalimentación de la detección).
    if (eyeClosed) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = colors.lid;
      ctx.fillRect(x - r, cy - r, r * 2, r * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      // Pestañas sobre la línea del párpado cerrado
      ctx.beginPath();
      ctx.moveTo(x - r, cy);
      ctx.quadraticCurveTo(x, cy + r * 0.45, x + r, cy);
      for (let i = -2; i <= 2; i++) {
        const lx = x + i * r * 0.35;
        const ly = cy + r * 0.22 * (1 - (i * i) / 6);
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + i * r * 0.06, ly + r * 0.25);
      }
      ctx.stroke();
    }
  }

  // ---------- HUD ----------

  function updateHud() {
    document.getElementById("game-hud-cleared").textContent = stats.cleared;
    document.getElementById("game-hud-hits").textContent = stats.hits;
    document.getElementById("game-hud-blinks").textContent = `${stats.complete}/${stats.blinks}`;
  }

  function updateTimer(now) {
    const restante = Math.max(0, Math.ceil((DURATION_MS - (now - phaseStartedAt)) / 1000));
    document.getElementById("game-hud-time").textContent = `${restante}s`;
  }

  // ---------- Eventos ----------

  document.getElementById("game-start-btn").addEventListener("click", begin);
  document.getElementById("game-again-btn").addEventListener("click", begin);
  document.getElementById("game-exit-btn").addEventListener("click", close);
  document.getElementById("game-back-btn").addEventListener("click", close);
  document.getElementById("game-cancel-btn").addEventListener("click", close);

  window.addEventListener("resize", () => {
    if (phase === "closed") return;
    resizeCanvas();
    if (!rafHandle) draw(performance.now());
  });

  return {
    open,
    close,
    onEye,
    get active() {
      return phase !== "closed";
    },
  };
})();
