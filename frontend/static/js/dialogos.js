const dialogo = document.getElementById("dialogo-mensaje");
const titulo = document.getElementById("dialogo-mensaje-titulo");
const texto = document.getElementById("dialogo-mensaje-texto");
const botonAceptar = document.getElementById("dialogo-mensaje-aceptar");
const botonCancelar = document.getElementById("dialogo-mensaje-cancelar");

export function esperarRespuesta(elemento) {
  elemento.returnValue = "";
  elemento.showModal();
  return new Promise((resolver) => {
    elemento.addEventListener("close", () => resolver(elemento.returnValue === "aceptar"), { once: true });
  });
}

function abrir({ encabezado, mensaje, etiquetaAceptar, conCancelar, peligroso = false }) {
  titulo.textContent = encabezado;
  texto.textContent = mensaje;
  botonAceptar.textContent = etiquetaAceptar;
  botonAceptar.className = `boton ${peligroso ? "boton--peligro" : "boton--principal"}`;
  botonCancelar.hidden = !conCancelar;
  return esperarRespuesta(dialogo);
}

export function avisar(encabezado, mensaje) {
  return abrir({ encabezado, mensaje, etiquetaAceptar: "Entendido", conCancelar: false });
}

export function confirmar(encabezado, mensaje, etiquetaAceptar) {
  return abrir({ encabezado, mensaje, etiquetaAceptar, conCancelar: true, peligroso: true });
}
