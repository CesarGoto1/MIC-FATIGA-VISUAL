import { guardarPerfil, guardarToken, solicitar } from "./api.js";
import { mostrarPanel } from "./vistas.js";

const errorAcceso = document.getElementById("acceso-error");
const titulo = document.getElementById("acceso-titulo");
const subtitulo = document.getElementById("acceso-subtitulo");

const PESTANAS = {
  ingreso: {
    opcion: document.getElementById("opcion-ingreso"),
    seccion: document.getElementById("ingreso-seccion"),
    titulo: "Bienvenido de nuevo",
    subtitulo: "Ingresa tus datos para continuar.",
  },
  registro: {
    opcion: document.getElementById("opcion-registro"),
    seccion: document.getElementById("registro-seccion"),
    titulo: "Crea tu cuenta",
    subtitulo: "Empieza a monitorear tu fatiga visual.",
  },
};

function mostrarPestana(nombre) {
  Object.entries(PESTANAS).forEach(([clave, { opcion, seccion }]) => {
    const activa = clave === nombre;
    opcion.classList.toggle("esta-activo", activa);
    opcion.setAttribute("aria-selected", String(activa));
    opcion.tabIndex = activa ? 0 : -1;
    seccion.hidden = !activa;
  });
  titulo.textContent = PESTANAS[nombre].titulo;
  subtitulo.textContent = PESTANAS[nombre].subtitulo;
  errorAcceso.hidden = true;
}

Object.entries(PESTANAS).forEach(([nombre, { opcion }]) => {
  const otra = nombre === "ingreso" ? "registro" : "ingreso";
  opcion.addEventListener("click", () => mostrarPestana(nombre));
  opcion.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    mostrarPestana(otra);
    PESTANAS[otra].opcion.focus();
  });
});

document.querySelectorAll(".campo__mostrar").forEach((boton) => {
  const campo = document.getElementById(boton.dataset.campo);
  const ojoAbierto = boton.querySelector(".icono-ojo");
  const ojoTachado = boton.querySelector(".icono-ojo-tachado");

  boton.addEventListener("click", () => {
    const visible = campo.type === "text";
    campo.type = visible ? "password" : "text";
    ojoAbierto.hidden = !visible;
    ojoTachado.hidden = visible;
  });
});

async function enviarFormulario(formulario, textoEspera, ruta, datos) {
  const boton = formulario.querySelector(".acceso-enviar");
  const etiqueta = boton.querySelector(".acceso-enviar__etiqueta");
  const textoOriginal = etiqueta.textContent;

  errorAcceso.hidden = true;
  boton.disabled = true;
  etiqueta.textContent = textoEspera;
  try {
    const respuesta = await solicitar(ruta, { method: "POST", body: JSON.stringify(datos) });
    guardarToken(respuesta.token_acceso);
    guardarPerfil(respuesta);
    mostrarPanel();
  } catch (err) {
    errorAcceso.textContent = err.message;
    errorAcceso.hidden = false;
  } finally {
    boton.disabled = false;
    etiqueta.textContent = textoOriginal;
  }
}

const valor = (id) => document.getElementById(id).value;

document.getElementById("ingreso-formulario").addEventListener("submit", (e) => {
  e.preventDefault();
  enviarFormulario(e.currentTarget, "Ingresando…", "/tokens", {
    correo: valor("ingreso-correo"),
    clave: valor("ingreso-clave"),
  });
});

document.getElementById("registro-formulario").addEventListener("submit", (e) => {
  e.preventDefault();
  enviarFormulario(e.currentTarget, "Creando cuenta…", "/usuarios", {
    nombre: valor("registro-nombre"),
    correo: valor("registro-correo"),
    clave: valor("registro-clave"),
  });
});
