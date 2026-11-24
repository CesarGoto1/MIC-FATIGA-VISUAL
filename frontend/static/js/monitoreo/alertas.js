const notificacion = document.getElementById("notificacion");
const botonJuego = document.getElementById("notificacion-boton-juego");
const botonDescanso = document.getElementById("notificacion-boton-descanso");

const PAUSA_ENTRE_ALERTAS_MS = 120_000;
const MENSAJES = {
  leve: {
    titulo: "Fatiga visual leve",
    texto: "Parpadeas poco o sin cerrar del todo. Un minuto de ejercicio de parpadeo ayuda a hidratar tus ojos.",
  },
  moderada: {
    titulo: "Fatiga visual moderada",
    texto: "Parpadeas poco y sin cerrar del todo. Haz el ejercicio de parpadeo para recuperar parpadeos completos.",
  },
  somnolencia: {
    titulo: "Signos de somnolencia",
    texto: "Tus ojos se cierran por momentos largos. Si tienes sueño, conviene descansar antes de seguir.",
  },
};

let ultima = { nivel: null, descartadaEn: 0 };

export function reiniciarAlertas() {
  ultima = { nivel: null, descartadaEn: 0 };
  ocultarAlerta();
}

function ocultarAlerta() {
  notificacion.hidden = true;
}

export function descartarAlerta() {
  ocultarAlerta();
  ultima.descartadaEn = Date.now();
}

export function alertar(nivel) {
  const mensaje = MENSAJES[nivel];
  if (!mensaje) {
    ocultarAlerta();
    return;
  }
  const reciente = Date.now() - ultima.descartadaEn < PAUSA_ENTRE_ALERTAS_MS;
  if (reciente && ultima.nivel === nivel) return;

  ultima.nivel = nivel;
  document.getElementById("notificacion-titulo").textContent = mensaje.titulo;
  document.getElementById("notificacion-texto").textContent = mensaje.texto;
  notificacion.dataset.nivel = nivel;
  const sugerirJuego = nivel !== "somnolencia";
  botonJuego.hidden = !sugerirJuego;
  botonDescanso.hidden = sugerirJuego;
  notificacion.hidden = false;
}

document.getElementById("notificacion-boton-cerrar").addEventListener("click", descartarAlerta);
