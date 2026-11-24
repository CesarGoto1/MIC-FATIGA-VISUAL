import { esAdmin, guardarPerfil, solicitar } from "./api.js";

const VISTAS = {
  acceso: document.getElementById("vista-acceso"),
  panel: document.getElementById("vista-panel"),
  monitoreo: document.getElementById("vista-monitoreo"),
  admin: document.getElementById("vista-admin"),
};
const alMostrar = {};

export function alMostrarVista(vista, accion) {
  alMostrar[vista] = accion;
}

function mostrarVista(nombre) {
  Object.entries(VISTAS).forEach(([clave, elemento]) => (elemento.hidden = clave !== nombre));
  alMostrar[nombre]?.();
}

function pintarPerfil() {
  const codigo = localStorage.getItem("codigo_participante");
  document.getElementById("panel-usuario-nombre").textContent = localStorage.getItem("usuario_nombre") || "";
  document.getElementById("panel-codigo").hidden = !codigo;
  document.getElementById("panel-codigo-valor").textContent = codigo || "";
  document.getElementById("panel-boton-admin").hidden = !esAdmin();
}

async function actualizarPerfil() {
  try {
    guardarPerfil(await solicitar("/usuarios/yo"));
    pintarPerfil();
  } catch (err) {
    console.warn("No se pudo actualizar el perfil:", err.message);
  }
}

export function mostrarPanel() {
  pintarPerfil();
  actualizarPerfil();
  mostrarVista("panel");
}

export const mostrarAdmin = () => mostrarVista("admin");
export const mostrarMonitoreo = () => mostrarVista("monitoreo");
