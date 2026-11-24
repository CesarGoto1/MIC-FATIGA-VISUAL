import { solicitar } from "../api.js";
import { avisar, esperarRespuesta } from "../dialogos.js";
import {
  actualizarUmbralesEar,
  agregarEar,
  agregarMinuto,
  detenerGraficasEnVivo,
  iniciarGraficasEnVivo,
} from "../graficas.js";
import { abrirJuego, alMedirOjo, cerrarJuego, juegoActivo } from "../juego-parpadeo.js";
import { kssElegido } from "../kss.js";
import { abrirResumenAlVolver } from "../panel.js";
import { alMostrarVista, mostrarPanel } from "../vistas.js";
import { alertar, descartarAlerta, reiniciarAlertas } from "./alertas.js";
import { cancelarDescanso, iniciarDescanso } from "./descanso.js";
import { crearDetector } from "./detector.js";
import { crearGrabador, grabacionDisponible } from "./grabacion.js";
import * as interfaz from "./interfaz.js";
import { cuerpoMedicion } from "./medicion.js";
import { VENTANA_MS } from "./parametros.js";
import {
  alEnviarPreparacion,
  leerPreparacion,
  mostrarErrorPreparacion,
  reiniciarPreparacion,
} from "./preparacion.js";
import { liberarContenido, mostrarContenido, pausarVideo } from "./visor.js";

const ROSTRO_PERDIDO_MS = 1_500;
const OBSERVACION_MINIMA_MS = 20_000;
const ESPERA_DETECTOR_MS = 20_000;
const GRACIA_TRAS_EJERCICIO_MS = 15_000;
const VERSION_FACE_MESH = "0.4.1633559619";

const seccionPreparacion = document.getElementById("mon-preparacion");
const seccionEnVivo = document.getElementById("mon-vivo");
const botonIniciar = document.getElementById("boton-iniciar");
const botonDetener = document.getElementById("boton-detener");
const escalaKssFinal = document.getElementById("kss-final");
const dialogoFinalizar = document.getElementById("finalizar-dialogo");
const formularioFinalizar = document.getElementById("finalizar-formulario");
const errorFinalizar = document.getElementById("finalizar-error");
const botonConfirmarFin = document.getElementById("finalizar-boton-confirmar");
const dialogoGrabacion = document.getElementById("grabacion-dialogo");
const camara = document.getElementById("webcam");

let camaraMediaPipe = null;
let mallaFacial = null;
let detector = null;
let grabador = null;
const temporizadores = { envio: null, detector: null };

function estadoInicial() {
  return {
    sesionId: null,
    monitoreoDesde: null,
    grabar: false,
    primerResultado: false,
    ultimoRostro: null,
    pausado: false,
    graciaHasta: 0,
    escucharOjo: null,
  };
}

let sesion = estadoInicial();
const sesionAbierta = () => sesion.sesionId !== null;

const eventosDetector = {
  alProgresar: interfaz.progresoCalibracion,
  alFijarLineaBase: interfaz.pedirParpadeosDeCalibracion,
  alTerminar: terminarCalibracion,
  alActualizarUmbrales: actualizarUmbralesEar,
  alMedirSenal: agregarEar,
};

function alRecibirResultados(resultados) {
  if (camaraMediaPipe === null) return;
  if (!sesion.primerResultado) {
    sesion.primerResultado = true;
    clearTimeout(temporizadores.detector);
    interfaz.textoDeCalibracion("Calibrando: mira la pantalla con naturalidad…");
  }
  const ahora = performance.now();
  const puntos = resultados.multiFaceLandmarks?.[0];

  if (!puntos) {
    detector.perderRostro();
    if (sesion.ultimoRostro === null || ahora - sesion.ultimoRostro > ROSTRO_PERDIDO_MS) marcarRostro(false);
    return;
  }
  sesion.ultimoRostro = ahora;
  marcarRostro(true);

  const ear = detector.procesar(puntos, ahora, {
    escucharOjo: sesion.escucharOjo,
    pausado: sesion.pausado || ahora < sesion.graciaHasta,
  });
  if (ear !== null) interfaz.pintarMetricas(ear, detector.calcularMetricas(ahora - VENTANA_MS));
}

function marcarRostro(visible) {
  if (!interfaz.mostrarRostro(visible)) return;
  if (!detector?.tieneLineaBase || sesion.pausado) return;
  if (visible) interfaz.ponerMonitoreando();
  else interfaz.ponerEstado("alerta", "Sin rostro");
}

function terminarCalibracion(umbrales) {
  iniciarGraficasEnVivo(umbrales);
  sesion.monitoreoDesde = performance.now();
  iniciarGrabacion();
  interfaz.iniciarCronometro(Date.now());
  interfaz.terminarCalibracion();
}

function iniciarGrabacion() {
  const flujo = camara.srcObject;
  if (!sesion.grabar || !flujo) return;
  try {
    grabador = crearGrabador({
      sesionId: sesion.sesionId,
      flujo,
      origen: sesion.monitoreoDesde,
      alFallar: (err) => {
        console.error("No se pudo guardar la grabación:", err.message);
        interfaz.mostrarGrabando(false);
      },
    });
    grabador.iniciar();
    interfaz.mostrarGrabando(true);
  } catch (err) {
    console.error("No se pudo iniciar la grabación:", err.message);
    grabador = null;
  }
}

async function consentimientoGrabacion() {
  if (!grabacionDisponible()) return false;
  try {
    const perfil = await solicitar("/usuarios/yo");
    if (!perfil.grabacion_habilitada) return false;
  } catch (err) {
    console.warn("No se pudo consultar el permiso de grabación:", err.message);
    return false;
  }
  return esperarRespuesta(dialogoGrabacion);
}

async function enviarMedicion() {
  if (!sesionAbierta() || sesion.pausado) return;
  const corte = performance.now();
  const metricas = detector.calcularMetricas(detector.ultimoEnvio);
  if (!metricas || metricas.observadoMs < OBSERVACION_MINIMA_MS) return;

  try {
    const resultado = await solicitar(`/sesiones/${sesion.sesionId}/mediciones`, {
      method: "POST",
      body: JSON.stringify(cuerpoMedicion(metricas, sesion.monitoreoDesde)),
    });
    detector.marcarEnviado(corte);
    agregarMinuto(metricas);
    interfaz.mostrarNivel(resultado.nivel_fatiga);
    alertar(resultado.somnolencia ? "somnolencia" : resultado.nivel_fatiga);
  } catch (err) {
    if (err.estado === 409) {
      cerradaPorElServidor();
      return;
    }
    console.error("No se pudo guardar la medición:", err.message);
  }
}

function cerradaPorElServidor() {
  sesion.sesionId = null;
  if (dialogoFinalizar.open) dialogoFinalizar.close();
  liberarRecursos();
  mostrarPanel();
  avisar("Sesión cerrada", "La sesión se cerró automáticamente por inactividad. Puedes iniciar una nueva.");
}

function pausar(texto) {
  descartarAlerta();
  sesion.pausado = true;
  interfaz.ponerEstado("inactivo", texto);
  pausarVideo();
}

function reanudar() {
  detector.reiniciarVentana();
  sesion.pausado = false;
  interfaz.ponerMonitoreando();
}

function iniciarJuego() {
  if (!detector?.tieneLineaBase || juegoActivo()) return;
  pausar("Ejercicio");
  sesion.escucharOjo = alMedirOjo;
  abrirJuego({ umbrales: detector.umbralesOjo(), alSalir: terminarJuego });
}

function terminarJuego() {
  sesion.escucharOjo = null;
  if (!sesionAbierta()) return;
  sesion.graciaHasta = performance.now() + GRACIA_TRAS_EJERCICIO_MS;
  reanudar();
}

function iniciarPausaActiva() {
  pausar("En pausa");
  iniciarDescanso(reanudar);
}

function reiniciarMonitoreo() {
  reiniciarPreparacion();
  seccionPreparacion.hidden = false;
  seccionEnVivo.hidden = true;
  botonDetener.hidden = true;
  interfaz.ocultarCronometro();
  interfaz.ponerEstado("inactivo", "Preparando");
}

function obtenerMallaFacial() {
  if (mallaFacial === null) {
    mallaFacial = new FaceMesh({
      locateFile: (archivo) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${VERSION_FACE_MESH}/${archivo}`,
    });
    mallaFacial.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    mallaFacial.onResults(alRecibirResultados);
  }
  return mallaFacial;
}

async function iniciarMonitoreo(preparacion) {
  const nueva = await solicitar("/sesiones", {
    method: "POST",
    body: JSON.stringify({
      actividad: preparacion.actividad,
      momento: preparacion.momento,
      kss_inicial: preparacion.kss,
      grabar: preparacion.grabar,
    }),
  });
  sesion = { ...estadoInicial(), sesionId: nueva.id, grabar: nueva.grabar };
  detector = crearDetector(eventosDetector);
  reiniciarAlertas();

  interfaz.reiniciarMetricas();
  interfaz.prepararCalibracion();
  seccionPreparacion.hidden = true;
  seccionEnVivo.hidden = false;
  botonDetener.hidden = false;
  mostrarContenido(preparacion.actividad, preparacion.archivo, preparacion.youtube);
  interfaz.ponerEstado("calibrando", "Calibrando");

  temporizadores.detector = setTimeout(() => {
    interfaz.textoDeCalibracion("El detector no responde. Recarga la página (Ctrl + F5) e inténtalo de nuevo.");
  }, ESPERA_DETECTOR_MS);

  const malla = obtenerMallaFacial();
  camaraMediaPipe = new Camera(camara, {
    onFrame: async () => {
      await malla.send({ image: camara });
    },
    width: 640,
    height: 480,
  });
  await camaraMediaPipe.start();

  temporizadores.envio = setInterval(enviarMedicion, VENTANA_MS);
}

function liberarRecursos() {
  clearInterval(temporizadores.envio);
  clearTimeout(temporizadores.detector);
  temporizadores.envio = temporizadores.detector = null;
  cancelarDescanso();
  reiniciarAlertas();
  cerrarJuego();
  detenerGraficasEnVivo();
  interfaz.detenerInterfaz();
  sesion.escucharOjo = null;
  grabador?.cancelar();
  grabador = null;

  camaraMediaPipe?.stop();
  camaraMediaPipe = null;
  camara.srcObject?.getTracks().forEach((pista) => pista.stop());
  camara.srcObject = null;
  liberarContenido();
}

async function finalizarMonitoreo(kssFinal) {
  await enviarMedicion();
  if (!sesionAbierta()) return;
  if (grabador) {
    await grabador.detener();
    grabador = null;
    interfaz.mostrarGrabando(false);
  }
  try {
    await solicitar(`/sesiones/${sesion.sesionId}`, {
      method: "PATCH",
      body: JSON.stringify({ finalizada: true, kss_final: kssFinal }),
    });
  } catch (err) {
    if (err.estado !== 409) throw err;
    cerradaPorElServidor();
    return;
  }
  abrirResumenAlVolver(sesion.sesionId);
  sesion.sesionId = null;
  liberarRecursos();
  mostrarPanel();
}

alEnviarPreparacion(async () => {
  const preparacion = leerPreparacion();
  if (preparacion.error) {
    mostrarErrorPreparacion(preparacion.error);
    return;
  }
  mostrarErrorPreparacion("");
  botonIniciar.disabled = true;
  try {
    preparacion.grabar = await consentimientoGrabacion();
    await iniciarMonitoreo(preparacion);
  } catch (err) {
    console.error(err);
    sesion.sesionId = null;
    liberarRecursos();
    reiniciarMonitoreo();
    mostrarErrorPreparacion(`No se pudo iniciar el monitoreo: ${err.message}`);
  } finally {
    botonIniciar.disabled = false;
  }
});

function pedirFinalizar() {
  formularioFinalizar.reset();
  errorFinalizar.hidden = true;
  dialogoFinalizar.showModal();
}

function mostrarErrorFinalizar(mensaje) {
  errorFinalizar.textContent = mensaje;
  errorFinalizar.hidden = false;
}

formularioFinalizar.addEventListener("submit", async (e) => {
  e.preventDefault();
  const kss = kssElegido(escalaKssFinal);
  if (!kss) {
    mostrarErrorFinalizar("Selecciona tu nivel de somnolencia para terminar.");
    return;
  }
  botonConfirmarFin.disabled = true;
  try {
    await finalizarMonitoreo(kss);
    dialogoFinalizar.close();
  } catch (err) {
    mostrarErrorFinalizar(`No se pudo finalizar la sesión: ${err.message}`);
  } finally {
    botonConfirmarFin.disabled = false;
  }
});

botonDetener.addEventListener("click", pedirFinalizar);
document.getElementById("finalizar-boton-cancelar").addEventListener("click", () => dialogoFinalizar.close());
document.getElementById("notificacion-boton-descanso").addEventListener("click", iniciarPausaActiva);
document.getElementById("notificacion-boton-juego").addEventListener("click", iniciarJuego);
document.getElementById("lateral-boton-juego").addEventListener("click", iniciarJuego);
document.getElementById("mon-boton-volver").addEventListener("click", () => {
  if (sesionAbierta()) pedirFinalizar();
  else mostrarPanel();
});

window.addEventListener("beforeunload", (e) => {
  if (sesionAbierta()) e.preventDefault();
});

alMostrarVista("monitoreo", reiniciarMonitoreo);
