--
-- PostgreSQL database dump
--

\restrict eG8yeDDOq59aZ87NxILnEz1PxJM7nqttHv4sDZjbMX420oOoCu2GjYoonySAzBc

-- Dumped from database version 16.15 (Debian 16.15-1.pgdg13+2)
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: diagnosticos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diagnosticos (
    id integer NOT NULL,
    sesion_id integer NOT NULL,
    texto text,
    detalle jsonb,
    disponible boolean DEFAULT false NOT NULL,
    generado_en timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: diagnosticos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diagnosticos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diagnosticos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diagnosticos_id_seq OWNED BY public.diagnosticos.id;


--
-- Name: grabaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grabaciones (
    id integer NOT NULL,
    sesion_id integer NOT NULL,
    archivo character varying(255) NOT NULL,
    tipo_mime character varying(40) NOT NULL,
    desfase_ms integer NOT NULL,
    partes integer NOT NULL,
    bytes bigint NOT NULL,
    creada_en timestamp with time zone DEFAULT now() NOT NULL,
    actualizada_en timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grabaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.grabaciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: grabaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.grabaciones_id_seq OWNED BY public.grabaciones.id;


--
-- Name: mediciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mediciones (
    id integer NOT NULL,
    sesion_id integer NOT NULL,
    actividad character varying(80) NOT NULL,
    ear numeric(5,3),
    perclos numeric(5,2),
    parpadeos_min numeric(5,2),
    tiempo_cierre numeric(7,1),
    velocidad_ocular numeric(8,5),
    nivel_fatiga character varying(20),
    registrado_en timestamp with time zone DEFAULT now() NOT NULL,
    cierres_prolongados smallint,
    parpadeos_incompletos_pct numeric(5,2),
    somnolencia boolean
);


--
-- Name: mediciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mediciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mediciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mediciones_id_seq OWNED BY public.mediciones.id;


--
-- Name: parpadeos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parpadeos (
    id integer NOT NULL,
    sesion_id integer NOT NULL,
    medicion_id integer,
    tipo character varying(12) NOT NULL,
    inicio_ms integer NOT NULL,
    duracion_ms integer NOT NULL,
    ocurrido_en timestamp with time zone NOT NULL,
    ear_minimo numeric(5,3),
    umbral_p80 numeric(5,3),
    ear_base numeric(5,3),
    CONSTRAINT parpadeos_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['completo'::character varying, 'incompleto'::character varying, 'prolongado'::character varying])::text[])))
);


--
-- Name: parpadeos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parpadeos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parpadeos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parpadeos_id_seq OWNED BY public.parpadeos.id;


--
-- Name: sesiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sesiones (
    id integer NOT NULL,
    usuario_id integer NOT NULL,
    actividad character varying(80) NOT NULL,
    momento character varying(10),
    iniciada_en timestamp with time zone DEFAULT now() NOT NULL,
    finalizada_en timestamp with time zone,
    kss_inicial smallint,
    kss_final smallint,
    grabacion_consentida boolean,
    CONSTRAINT sesiones_kss_final_check CHECK (((kss_final >= 1) AND (kss_final <= 9))),
    CONSTRAINT sesiones_kss_inicial_check CHECK (((kss_inicial >= 1) AND (kss_inicial <= 9))),
    CONSTRAINT sesiones_momento_check CHECK (((momento)::text = ANY ((ARRAY['pre'::character varying, 'post'::character varying])::text[])))
);


--
-- Name: sesiones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sesiones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sesiones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sesiones_id_seq OWNED BY public.sesiones.id;


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    nombre character varying(120) NOT NULL,
    correo character varying(160) NOT NULL,
    clave_hash character varying(255) NOT NULL,
    creado_en timestamp with time zone DEFAULT now() NOT NULL,
    es_admin boolean DEFAULT false NOT NULL,
    grabacion_habilitada boolean DEFAULT false NOT NULL
);


--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- Name: diagnosticos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosticos ALTER COLUMN id SET DEFAULT nextval('public.diagnosticos_id_seq'::regclass);


--
-- Name: grabaciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grabaciones ALTER COLUMN id SET DEFAULT nextval('public.grabaciones_id_seq'::regclass);


--
-- Name: mediciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mediciones ALTER COLUMN id SET DEFAULT nextval('public.mediciones_id_seq'::regclass);


--
-- Name: parpadeos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parpadeos ALTER COLUMN id SET DEFAULT nextval('public.parpadeos_id_seq'::regclass);


--
-- Name: sesiones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones ALTER COLUMN id SET DEFAULT nextval('public.sesiones_id_seq'::regclass);


--
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: diagnosticos diagnosticos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosticos
    ADD CONSTRAINT diagnosticos_pkey PRIMARY KEY (id);


--
-- Name: grabaciones grabaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grabaciones
    ADD CONSTRAINT grabaciones_pkey PRIMARY KEY (id);


--
-- Name: grabaciones grabaciones_sesion_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grabaciones
    ADD CONSTRAINT grabaciones_sesion_id_key UNIQUE (sesion_id);


--
-- Name: mediciones mediciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mediciones
    ADD CONSTRAINT mediciones_pkey PRIMARY KEY (id);


--
-- Name: parpadeos parpadeos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parpadeos
    ADD CONSTRAINT parpadeos_pkey PRIMARY KEY (id);


--
-- Name: sesiones sesiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_correo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_correo_key UNIQUE (correo);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: idx_diagnosticos_sesion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diagnosticos_sesion ON public.diagnosticos USING btree (sesion_id);


--
-- Name: idx_mediciones_sesion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mediciones_sesion ON public.mediciones USING btree (sesion_id);


--
-- Name: idx_parpadeos_sesion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parpadeos_sesion ON public.parpadeos USING btree (sesion_id);


--
-- Name: idx_sesiones_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_usuario ON public.sesiones USING btree (usuario_id);


--
-- Name: diagnosticos diagnosticos_sesion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnosticos
    ADD CONSTRAINT diagnosticos_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES public.sesiones(id) ON DELETE CASCADE;


--
-- Name: grabaciones grabaciones_sesion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grabaciones
    ADD CONSTRAINT grabaciones_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES public.sesiones(id) ON DELETE CASCADE;


--
-- Name: mediciones mediciones_sesion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mediciones
    ADD CONSTRAINT mediciones_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES public.sesiones(id) ON DELETE CASCADE;


--
-- Name: parpadeos parpadeos_medicion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parpadeos
    ADD CONSTRAINT parpadeos_medicion_id_fkey FOREIGN KEY (medicion_id) REFERENCES public.mediciones(id) ON DELETE SET NULL;


--
-- Name: parpadeos parpadeos_sesion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parpadeos
    ADD CONSTRAINT parpadeos_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES public.sesiones(id) ON DELETE CASCADE;


--
-- Name: sesiones sesiones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict eG8yeDDOq59aZ87NxILnEz1PxJM7nqttHv4sDZjbMX420oOoCu2GjYoonySAzBc

