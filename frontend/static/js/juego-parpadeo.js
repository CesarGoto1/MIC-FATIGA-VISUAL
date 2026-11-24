import {
PROPORCION_CIERRE,
PROPORCION_APERTURA,
PARPADEO_MAXIMO_MS,
CIERRE_MINIMO_MS,
APERTURA_P80,
} from "./monitoreo/parametros.js";

const DURACION_MS = 60_000;
const SEPARACION_MINIMA_MS = 2_600;
const SEPARACION_MAXIMA_MS = 4_000;
const RECORRIDO_MS = 2_400;
const TIEMPO_EN_AIRE_MS = 950;
const CUENTA_REGRESIVA_MS = 3_000;
const DESTELLO_CHOQUE_MS = 700;
const PISTA_MS = 1_800;
const CUADRO_MAXIMO_MS = 50;
const APERTURA_SALTO = 0.5;

const capa = document.getElementById("juego-capa");
const lienzo = document.getElementById("juego-lienzo");
const ctx = lienzo.getContext("2d");
const intro = document.getElementById("juego-intro");
const marcador = document.getElementById("juego-marcador");
const resumen = document.getElementById("juego-resumen");
const pista = document.getElementById("juego-pista");

let fase = "cerrado";
let alSalirJuego = null;
let umbrales = null;
let cuadroPendiente = null;
let colores = {};
let tamano = { w: 0, h: 0 };

let inicioFase = 0;
let ultimoCuadro = 0;
let relojJuego = 0;
let proximoObstaculo = 0;
let obstaculos = [];
let inicioSalto = null;
let ultimoChoque = null;
let temporizadorPista = null;
let conteo = null;

let ojoCerrado = false;
let inicioCierre = null;
let minimoCierre = null;
let saltoEnEsteCierre = false;

export function abrirJuego({ umbrales: umbralesDelOjo, alSalir }) {
  umbrales = umbralesDelOjo;
  alSalirJuego = alSalir;
  leerColores();
  capa.hidden = false;
  ajustarLienzo();
  mostrarFase("intro");
  dibujar(performance.now());
}

export function cerrarJuego() {
  if (fase === "cerrado") return;
  cancelAnimationFrame(cuadroPendiente);
  clearTimeout(temporizadorPista);
  cuadroPendiente = null;
  fase = "cerrado";
  capa.hidden = true;
  const accion = alSalirJuego;
  alSalirJuego = null;
  if (accion) accion();
}

export function juegoActivo() {
  return fase !== "cerrado";
}

function empezar() {
  conteo = { parpadeos: 0, completos: 0, obstaculos: 0, esquivados: 0, choques: 0 };
  obstaculos = [];
  inicioSalto = null;
  ultimoChoque = null;
  ojoCerrado = false;
  actualizarMarcador();
  document.getElementById("juego-marcador-tiempo").textContent = `${DURACION_MS / 1000}s`;
  mostrarFase("cuenta");
  inicioFase = ultimoCuadro = performance.now();
  cuadroPendiente = requestAnimationFrame(bucle);
}

function mostrarFase(siguiente) {
  fase = siguiente;
  intro.hidden = siguiente !== "intro";
  marcador.hidden = siguiente !== "jugando" && siguiente !== "cuenta";
  resumen.hidden = siguiente !== "resumen";
  pista.hidden = true;
}

export function alMedirOjo(ear, ahora) {
  if (!ojoCerrado && ear < umbrales.earBase * PROPORCION_CIERRE) {
    ojoCerrado = true;
    inicioCierre = ahora;
    minimoCierre = ear;
    saltoEnEsteCierre = false;
    return;
  }
  if (!ojoCerrado) return;

  minimoCierre = Math.min(minimoCierre, ear);
  if (ear <= umbrales.earBase * PROPORCION_APERTURA) {
    if (!saltoEnEsteCierre && fase === "jugando" && ahora - inicioCierre >= CIERRE_MINIMO_MS && minimoCierre <= umbralSalto()) {
      saltoEnEsteCierre = true;
      saltar(ahora);
    }
    return;
  }

  ojoCerrado = false;
  const duracion = ahora - inicioCierre;
  if (duracion < CIERRE_MINIMO_MS || duracion > PARPADEO_MAXIMO_MS || fase !== "jugando") return;

  const piso = umbrales.pisoOjoCerrado;
  const completos = minimoCierre <= piso + APERTURA_P80 * (umbrales.earBase - piso);
  conteo.parpadeos += 1;
  if (completos) conteo.completos += 1;
  else mostrarPista("Cierra los ojos por completo al parpadear");
  actualizarMarcador();
}

function umbralSalto() {
  const piso = umbrales.pisoOjoCerrado;
  return piso + APERTURA_SALTO * (umbrales.earBase - piso);
}

function saltar(ahora) {
  if (inicioSalto !== null && ahora - inicioSalto < TIEMPO_EN_AIRE_MS) return;
  inicioSalto = ahora;
}

function mostrarPista(texto) {
  pista.textContent = texto;
  pista.hidden = false;
  clearTimeout(temporizadorPista);
  temporizadorPista = setTimeout(() => (pista.hidden = true), PISTA_MS);
}

function bucle(ahora) {
  const dt = Math.min(ahora - ultimoCuadro, CUADRO_MAXIMO_MS);
  ultimoCuadro = ahora;

  if (fase === "cuenta" && ahora - inicioFase >= CUENTA_REGRESIVA_MS) {
    mostrarFase("jugando");
    inicioFase = ahora;
    relojJuego = 0;
    proximoObstaculo = 1_200;
    actualizarMarcador();
  }

  if (fase === "jugando") {
    actualizar(ahora, dt);
    if (ahora - inicioFase >= DURACION_MS) {
      terminar();
      return;
    }
    actualizarTiempo(ahora);
  }

  dibujar(ahora);
  cuadroPendiente = requestAnimationFrame(bucle);
}

function geometria() {
  const suelo = tamano.h * 0.78;
  const radio = Math.max(16, tamano.h * 0.07);
  return { suelo, radio, piernas: radio * 0.75, xOjo: tamano.w * 0.2 };
}

function alturaSalto(ahora) {
  if (inicioSalto === null) return 0;
  const t = (ahora - inicioSalto) / TIEMPO_EN_AIRE_MS;
  if (t >= 1) {
    inicioSalto = null;
    return 0;
  }
  return 4 * tamano.h * 0.36 * t * (1 - t);
}

function actualizar(ahora, dt) {
  const { suelo, radio, xOjo } = geometria();
  const rapidez = (tamano.w - xOjo) / RECORRIDO_MS;
  relojJuego += dt;

  if (relojJuego >= proximoObstaculo) {
    const altura = tamano.h * (0.1 + Math.random() * 0.06);
    obstaculos.push({ x: tamano.w + 10, w: Math.max(18, tamano.w * 0.025), h: altura, choque: false, superado: false });
    conteo.obstaculos += 1;
    proximoObstaculo = relojJuego + SEPARACION_MINIMA_MS + Math.random() * (SEPARACION_MAXIMA_MS - SEPARACION_MINIMA_MS);
  }

  const cuerpo = zonaImpacto(xOjo, suelo - alturaSalto(ahora), radio, geometria().piernas);
  obstaculos.forEach((o) => {
    o.x -= rapidez * dt;
    if (!o.choque && choca(cuerpo, { x: o.x, y: suelo - o.h, w: o.w, h: o.h })) {
      o.choque = true;
      conteo.choques += 1;
      ultimoChoque = ahora;
      actualizarMarcador();
    }
    if (!o.superado && o.x + o.w < xOjo - radio) {
      o.superado = true;
      if (!o.choque) conteo.esquivados += 1;
      actualizarMarcador();
    }
  });
  obstaculos = obstaculos.filter((o) => o.x + o.w > -20);
}

function zonaImpacto(x, yPies, r, piernas) {
  const yCentro = yPies - piernas - r;
  return {
    circulo: { x, y: yCentro, r },
    piernas: { x: x - r * 0.75, y: yCentro + r * 0.8, w: r * 1.5, h: yPies - (yCentro + r * 0.8) },
  };
}

function choca(cuerpo, rectangulo) {
  const { circulo, piernas } = cuerpo;
  const xCercana = Math.max(rectangulo.x, Math.min(circulo.x, rectangulo.x + rectangulo.w));
  const yCercana = Math.max(rectangulo.y, Math.min(circulo.y, rectangulo.y + rectangulo.h));
  const tocaCirculo = Math.hypot(circulo.x - xCercana, circulo.y - yCercana) < circulo.r;
  const tocaPiernas =
    piernas.x < rectangulo.x + rectangulo.w && piernas.x + piernas.w > rectangulo.x &&
    piernas.y < rectangulo.y + rectangulo.h && piernas.y + piernas.h > rectangulo.y;
  return tocaCirculo || tocaPiernas;
}

function terminar() {
  cancelAnimationFrame(cuadroPendiente);
  cuadroPendiente = null;
  mostrarFase("resumen");

  const minutos = DURACION_MS / 60_000;
  const pctCompletos = conteo.parpadeos ? Math.round((conteo.completos / conteo.parpadeos) * 100) : 0;
  document.getElementById("juego-resumen-esquivados").textContent = `${conteo.esquivados} de ${conteo.obstaculos}`;
  document.getElementById("juego-resumen-ritmo").textContent = `${Math.round(conteo.parpadeos / minutos)} /min`;
  document.getElementById("juego-resumen-completos").textContent = `${pctCompletos} %`;

  let mensaje = "¡Muy bien! Mantén este ritmo de parpadeo mientras estudias.";
  if (conteo.parpadeos && pctCompletos < 70) {
    mensaje = "Muchos parpadeos fueron incompletos. Intenta cerrar los párpados del todo: así se distribuye mejor la lágrima.";
  } else if (conteo.parpadeos / minutos < 12) {
    mensaje = "Parpadeaste poco. Frente a la pantalla tendemos a olvidarlo; intenta seguir el ritmo del juego.";
  }
  document.getElementById("juego-resumen-mensaje").textContent = mensaje;
}

function leerColores() {
  const estilos = getComputedStyle(document.documentElement);
  const v = (name) => estilos.getPropertyValue(name).trim();
  colores = {
    fondo: v("--superficie"),
    fondo2: v("--acento-suave"),
    suelo: v("--borde-fuerte"),
    iris: v("--acento"),
    contorno: v("--texto"),
    parpado: v("--borde-fuerte"),
    obstaculo: v("--texto-3"),
    choque: v("--peligro"),
    texto: v("--texto"),
  };
}

function ajustarLienzo() {
  const rectangulo = capa.getBoundingClientRect();
  const densidad = window.devicePixelRatio || 1;
  tamano = { w: rectangulo.width, h: rectangulo.height };
  lienzo.width = Math.round(rectangulo.width * densidad);
  lienzo.height = Math.round(rectangulo.height * densidad);
  ctx.setTransform(densidad, 0, 0, densidad, 0, 0);
}

function dibujar(ahora) {
  const { suelo, radio, piernas, xOjo } = geometria();

  const degradado = ctx.createLinearGradient(0, 0, 0, tamano.h);
  degradado.addColorStop(0, colores.fondo2);
  degradado.addColorStop(1, colores.fondo);
  ctx.fillStyle = degradado;
  ctx.fillRect(0, 0, tamano.w, tamano.h);

  ctx.strokeStyle = colores.suelo;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, suelo);
  ctx.lineTo(tamano.w, suelo);
  ctx.stroke();

  obstaculos.forEach((o) => {
    ctx.fillStyle = o.choque ? colores.choque : colores.obstaculo;
    rectanguloRedondeado(o.x, suelo - o.h, o.w, o.h, 6);
  });

  const destellando = ultimoChoque !== null && ahora - ultimoChoque < DESTELLO_CHOQUE_MS;
  const altura = fase === "jugando" ? alturaSalto(ahora) : 0;
  dibujarPersonaje(ahora, xOjo, suelo - altura, radio, piernas, altura > 0, destellando);

  if (fase === "cuenta") {
    const restante = Math.ceil((CUENTA_REGRESIVA_MS - (ahora - inicioFase)) / 1000);
    ctx.fillStyle = colores.texto;
    ctx.font = `800 ${Math.round(tamano.h * 0.16)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.max(1, restante)), tamano.w / 2, tamano.h * 0.42);
  }
}

function rectanguloRedondeado(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, [r, r, 0, 0]);
  ctx.fill();
}

function dibujarPersonaje(ahora, x, yPies, r, piernas, enElAire, golpeado) {
  const yCentro = yPies - piernas - r;
  const grosor = Math.max(2, r * 0.12);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = grosor;
  ctx.strokeStyle = colores.contorno;

  const paso = enElAire || fase !== "jugando" ? 0 : Math.sin(ahora / 90) * r * 0.35;
  [[-0.4, paso], [0.4, -paso]].forEach(([lado, vaiven]) => {
    const xCadera = x + lado * r;
    const yCadera = yCentro + r * 0.8;
    const xPie = xCadera + (enElAire ? lado * r * 0.3 : vaiven);
    const yPie = enElAire ? yPies - piernas * 0.35 : yPies;
    ctx.beginPath();
    ctx.moveTo(xCadera, yCadera);
    ctx.lineTo(xPie, yPie);
    ctx.lineTo(xPie + r * 0.3, yPie);
    ctx.stroke();
  });

  ctx.fillStyle = golpeado ? "#ffd6d6" : "#ffffff";
  ctx.beginPath();
  ctx.arc(x, yCentro, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const xIris = x + r * 0.25;
  ctx.fillStyle = golpeado ? colores.choque : colores.iris;
  ctx.beginPath();
  ctx.arc(xIris, yCentro, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0b1116";
  ctx.beginPath();
  ctx.arc(xIris, yCentro, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(xIris - r * 0.15, yCentro - r * 0.17, r * 0.1, 0, Math.PI * 2);
  ctx.fill();

  if (ojoCerrado) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, yCentro, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = colores.parpado;
    ctx.fillRect(x - r, yCentro - r, r * 2, r * 2);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, yCentro, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r, yCentro);
    ctx.quadraticCurveTo(x, yCentro + r * 0.45, x + r, yCentro);
    for (let i = -2; i <= 2; i++) {
      const xPestana = x + i * r * 0.35;
      const yPestana = yCentro + r * 0.22 * (1 - (i * i) / 6);
      ctx.moveTo(xPestana, yPestana);
      ctx.lineTo(xPestana + i * r * 0.06, yPestana + r * 0.25);
    }
    ctx.stroke();
  }
}

function actualizarMarcador() {
  document.getElementById("juego-marcador-esquivados").textContent = conteo.esquivados;
  document.getElementById("juego-marcador-choques").textContent = conteo.choques;
  document.getElementById("juego-marcador-parpadeos").textContent = `${conteo.completos}/${conteo.parpadeos}`;
}

function actualizarTiempo(ahora) {
  const restante = Math.max(0, Math.ceil((DURACION_MS - (ahora - inicioFase)) / 1000));
  document.getElementById("juego-marcador-tiempo").textContent = `${restante}s`;
}

document.getElementById("juego-boton-iniciar").addEventListener("click", empezar);
document.getElementById("juego-boton-otra-vez").addEventListener("click", empezar);
document.getElementById("juego-boton-salir").addEventListener("click", cerrarJuego);
document.getElementById("juego-boton-volver").addEventListener("click", cerrarJuego);
document.getElementById("juego-boton-cancelar").addEventListener("click", cerrarJuego);

window.addEventListener("resize", () => {
  if (fase === "cerrado") return;
  ajustarLienzo();
  if (!cuadroPendiente) dibujar(performance.now());
});
