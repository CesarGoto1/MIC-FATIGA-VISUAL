import "./tema.js";
import "./kss.js";
import "./acceso.js";
import "./panel.js";
import "./admin.js";
import "./monitoreo/vista.js";
import { obtenerToken } from "./api.js";
import { mostrarPanel } from "./vistas.js";

if (obtenerToken()) mostrarPanel();
