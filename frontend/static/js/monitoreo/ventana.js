import {
  PROPORCION_CIERRE,
  PROPORCION_APERTURA,
  PARPADEO_MAXIMO_MS,
  SALTO_MAXIMO_CUADRO_MS,
  MAXIMO_SIN_ENVIAR_MS,
  CIERRE_MINIMO_MS,
  VENTANA_MS,
} from "./parametros.js";
import { promedioDe, distancia } from "./ocular.js";

export function crearVentana() {
  let muestras = [];
  let parpadeos = [];
  let cierresLargos = [];
  let velocidades = [];

  let ojoCerrado = false;
  let inicioCierre = null;
  let minimoCierre = null;
  let ultimaMuestra = null;
  let ultimoIris = null;
  let ultimoEnvioEn = 0;

  function soltarSeguimiento() {
    ultimaMuestra = null;
    ultimoIris = null;
  }

  function avanzar(ahora) {
    const dt = ultimaMuestra === null ? 0 : Math.min(ahora - ultimaMuestra, SALTO_MAXIMO_CUADRO_MS);
    ultimaMuestra = ahora;
    return dt;
  }

  function detectarParpadeo(ear, ahora, calibracion) {
    const { earBase } = calibracion;
    if (!ojoCerrado && ear < earBase * PROPORCION_CIERRE) {
      ojoCerrado = true;
      inicioCierre = ahora;
      minimoCierre = ear;
      return;
    }
    if (!ojoCerrado) return;

    minimoCierre = Math.min(minimoCierre, ear);
    if (ear <= earBase * PROPORCION_APERTURA) return;

    ojoCerrado = false;
    const duracion = ahora - inicioCierre;
    if (duracion < CIERRE_MINIMO_MS) return;

    const umbralP80 = calibracion.umbralP80();
    const alcanzoP80 = minimoCierre <= umbralP80;
    const evento = { t: ahora, inicio: inicioCierre, duracion, earMinimo: minimoCierre, umbralP80, earBase };
    if (duracion <= PARPADEO_MAXIMO_MS) {
      parpadeos.push({ ...evento, completo: alcanzoP80 });
    } else if (alcanzoP80) {
      cierresLargos.push(evento);
    }
  }

  function agregarMuestra(muestra) {
    muestras.push(muestra);
  }

  function registrarIris(iris, ahora, dt) {
    if (ultimoIris !== null && dt > 0 && !ojoCerrado) {
      velocidades.push({ t: ahora, rapidez: distancia(iris, ultimoIris) / (dt / 1000) });
    }
    ultimoIris = ojoCerrado ? null : iris;
  }

  function podar(ahora) {
    const corte = Math.max(Math.min(ahora - VENTANA_MS, ultimoEnvioEn), ahora - MAXIMO_SIN_ENVIAR_MS);
    muestras = muestras.filter((m) => m.t >= corte);
    parpadeos = parpadeos.filter((p) => p.t >= corte);
    cierresLargos = cierresLargos.filter((c) => c.t >= corte);
    velocidades = velocidades.filter((v) => v.t >= corte);
  }

  function reiniciar() {
    muestras = [];
    parpadeos = [];
    cierresLargos = [];
    velocidades = [];
    ojoCerrado = false;
    soltarSeguimiento();
  }

  function calcularMetricas(desde = -Infinity) {
    const posterior = (elemento) => elemento.t > desde;
    const muestrasRecientes = muestras.filter(posterior);
    const observadoMs = muestrasRecientes.reduce((acumulado, m) => acumulado + m.dt, 0);
    if (observadoMs === 0) return null;

    const cerradoMs = muestrasRecientes.reduce((acumulado, m) => acumulado + (m.p80 ? m.dt : 0), 0);
    const parpadeosRecientes = parpadeos.filter(posterior);
    const incompletos = parpadeosRecientes.filter((p) => !p.completo).length;
    const prolongados = cierresLargos.filter(posterior);
    const eventos = [
      ...parpadeosRecientes.map((p) => ({ ...p, tipo: p.completo ? "completo" : "incompleto" })),
      ...prolongados.map((c) => ({ ...c, tipo: "prolongado" })),
    ].sort((a, b) => a.inicio - b.inicio);
    return {
      observadoMs,
      ear: promedioDe(muestrasRecientes, "ear"),
      perclos: (cerradoMs / observadoMs) * 100,
      parpadeos_min: parpadeosRecientes.length / (observadoMs / 60_000),
      parpadeos_incompletos_pct: parpadeosRecientes.length ? (incompletos / parpadeosRecientes.length) * 100 : null,
      tiempo_cierre: promedioDe(parpadeosRecientes, "duracion"),
      velocidad_ocular: promedioDe(velocidades.filter(posterior), "rapidez"),
      cierres_prolongados: prolongados.length,
      eventos,
    };
  }

  return {
    soltarSeguimiento,
    avanzar,
    detectarParpadeo,
    agregarMuestra,
    registrarIris,
    podar,
    reiniciar,
    calcularMetricas,
    get ultimoEnvio() {
      return ultimoEnvioEn;
    },
    marcarEnviado(instante) {
      ultimoEnvioEn = instante;
    },
  };
}
