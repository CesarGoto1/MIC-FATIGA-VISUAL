function redondear(valor, decimales = 3) {
  return valor == null ? null : Number(valor.toFixed(decimales));
}

function eventoParaEnvio(evento, origen) {
  return {
    tipo: evento.tipo,
    inicio_ms: Math.max(0, Math.round(evento.inicio - origen)),
    duracion_ms: Math.round(evento.duracion),
    ocurrido_en: new Date(performance.timeOrigin + evento.inicio).toISOString(),
    ear_minimo: redondear(evento.earMinimo),
    umbral_p80: redondear(evento.umbralP80),
    ear_base: redondear(evento.earBase),
  };
}

export function cuerpoMedicion(m, origen) {
  return {
    ear: Math.min(1, m.ear),
    perclos: Math.min(100, m.perclos),
    parpadeos_min: m.parpadeos_min,
    tiempo_cierre: m.tiempo_cierre,
    velocidad_ocular: m.velocidad_ocular,
    cierres_prolongados: m.cierres_prolongados,
    parpadeos_incompletos_pct: m.parpadeos_incompletos_pct,
    parpadeos: m.eventos.map((evento) => eventoParaEnvio(evento, origen)),
  };
}
