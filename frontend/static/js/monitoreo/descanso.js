import { descartarAlerta } from "./alertas.js";

const SEGUNDOS_DESCANSO = 20;

const capa = document.getElementById("descanso-capa");
const cuenta = document.getElementById("descanso-cuenta");

let temporizador = null;
let alTerminarDescanso = null;

function terminarDescanso() {
  if (temporizador === null) return;
  clearInterval(temporizador);
  temporizador = null;
  capa.hidden = true;
  alTerminarDescanso?.();
}

export function cancelarDescanso() {
  clearInterval(temporizador);
  temporizador = null;
  capa.hidden = true;
}

export function iniciarDescanso(alTerminar) {
  descartarAlerta();
  alTerminarDescanso = alTerminar;
  let restantes = SEGUNDOS_DESCANSO;
  cuenta.textContent = restantes;
  capa.hidden = false;
  temporizador = setInterval(() => {
    restantes -= 1;
    cuenta.textContent = restantes;
    if (restantes <= 0) terminarDescanso();
  }, 1000);
}

document.getElementById("descanso-boton-saltar").addEventListener("click", terminarDescanso);
