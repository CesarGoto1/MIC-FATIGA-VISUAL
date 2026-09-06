-- Esquema de base de datos: Sistema de monitoreo de fatiga visual
-- Corrige, respecto al prototipo anterior (SecurityEye):
--   1. La columna se llama "actividad" de forma consistente (antes había
--      una consulta que buscaba "etapa", que nunca existió).
--   2. Se agregan NOT NULL en las llaves foráneas para evitar registros
--      huérfanos.

SET client_encoding = 'UTF8';

CREATE TABLE IF NOT EXISTS usuarios (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(120) NOT NULL,
    email           VARCHAR(160) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,   -- hash bcrypt, nunca texto plano
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sesiones (
    id              SERIAL PRIMARY KEY,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    actividad       VARCHAR(80) NOT NULL,     -- p.ej. "lectura", "estudio"
    -- Fase experimental de la sesión dentro de la validación pre/post
    -- jornada (RF07, Objetivo específico 4). NULL = sesión suelta fuera
    -- del protocolo de validación.
    momento         VARCHAR(10) CHECK (momento IN ('pre', 'post')),
    iniciada_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalizada_en   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mediciones (
    id              SERIAL PRIMARY KEY,
    sesion_id       INTEGER NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
    actividad       VARCHAR(80) NOT NULL,     -- momento de la sesión al que corresponde la medición
    ear             NUMERIC(5,3),
    perclos         NUMERIC(5,2),
    parpadeos_min   NUMERIC(5,2),
    nivel_fatiga    VARCHAR(20),              -- "sin_fatiga" | "leve" | "moderada"
    registrado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS diagnosticos (
    id              SERIAL PRIMARY KEY,
    sesion_id       INTEGER NOT NULL REFERENCES sesiones(id) ON DELETE CASCADE,
    texto           TEXT,
    disponible      BOOLEAN NOT NULL DEFAULT false,  -- false si n8n/Gemini no respondió (RNF05)
    generado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_mediciones_sesion ON mediciones(sesion_id);
CREATE INDEX IF NOT EXISTS idx_diagnosticos_sesion ON diagnosticos(sesion_id);

-- Migración: agrega "momento" a bases de datos creadas antes de RF07
-- pre/post (CREATE TABLE IF NOT EXISTS de arriba no altera tablas ya
-- existentes).
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS momento VARCHAR(10);
ALTER TABLE sesiones DROP CONSTRAINT IF EXISTS sesiones_momento_check;
ALTER TABLE sesiones ADD CONSTRAINT sesiones_momento_check CHECK (momento IN ('pre', 'post'));
