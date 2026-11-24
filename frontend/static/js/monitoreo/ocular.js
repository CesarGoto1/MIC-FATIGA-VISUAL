export const OJO_DERECHO = [33, 160, 158, 133, 153, 144];
export const OJO_IZQUIERDO = [362, 385, 387, 263, 373, 380];
const CENTRO_IRIS_DERECHO = 468;
const CENTRO_IRIS_IZQUIERDO = 473;

export function distancia(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function proporcionAspectoOjo(puntos, indicesOjo) {
  const [p1, p2, p3, p4, p5, p6] = indicesOjo.map((i) => puntos[i]);
  return (distancia(p2, p6) + distancia(p3, p5)) / (2 * distancia(p1, p4));
}

function desplazamientoIris(puntos, indicesOjo, indiceIris) {
  const interior = puntos[indicesOjo[0]];
  const exterior = puntos[indicesOjo[3]];
  const ancho = distancia(interior, exterior);
  const iris = puntos[indiceIris];
  return {
    x: (iris.x - (interior.x + exterior.x) / 2) / ancho,
    y: (iris.y - (interior.y + exterior.y) / 2) / ancho,
  };
}

export function desplazamientoMedioIris(puntos) {
  const derecho = desplazamientoIris(puntos, OJO_DERECHO, CENTRO_IRIS_DERECHO);
  const izquierdo = desplazamientoIris(puntos, OJO_IZQUIERDO, CENTRO_IRIS_IZQUIERDO);
  return { x: (derecho.x + izquierdo.x) / 2, y: (derecho.y + izquierdo.y) / 2 };
}

export function mediana(valores) {
  const ordenados = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[mitad] : (ordenados[mitad - 1] + ordenados[mitad]) / 2;
}

export function promedioDe(lista, clave) {
  if (lista.length === 0) return 0;
  return lista.reduce((acumulado, elemento) => acumulado + elemento[clave], 0) / lista.length;
}
