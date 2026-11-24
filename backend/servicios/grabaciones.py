import logging
import os
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from backend import configuracion
from backend.modelos.orm import Grabacion, Sesion

EXTENSIONES = {"video/webm": ".webm", "video/mp4": ".mp4", "video/x-matroska": ".mkv"}
MAX_BYTES_PARTE = 25 * 1024 * 1024
TIPO_VISTA = "video/mp4"

bitacora = logging.getLogger(__name__)


class ParteFueraDeOrden(Exception):
    pass


def tipo_mime_base(tipo_mime: str) -> str | None:
    base = tipo_mime.split(";", 1)[0].strip().lower()
    return base if base in EXTENSIONES else None


def ruta_archivo(grabacion: Grabacion) -> Path:
    return configuracion.DIRECTORIO_GRABACIONES / grabacion.archivo


def ruta_vista(grabacion: Grabacion) -> Path:
    return ruta_archivo(grabacion).with_suffix(".vista.mp4")


def _ejecutable_ffmpeg() -> str | None:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return shutil.which("ffmpeg")


def _convertir_a_mp4(ffmpeg: str, origen: Path, destino: Path) -> bool:
    temporal = destino.with_name(f"{destino.stem}.{uuid4().hex}.mp4")
    comando = [
        ffmpeg, "-v", "error", "-y", "-i", str(origen),
        "-map", "0:v:0", "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-g", "15", "-bf", "0", "-pix_fmt", "yuv420p",
        "-fps_mode", "passthrough", "-movflags", "+faststart",
        str(temporal),
    ]
    resultado = subprocess.run(comando, capture_output=True, text=True)
    if resultado.returncode != 0 or not temporal.exists():
        temporal.unlink(missing_ok=True)
        bitacora.warning("No se pudo convertir %s a MP4: %s", origen.name, resultado.stderr.strip()[-500:])
        return False
    os.replace(temporal, destino)
    return True


def archivo_para_ver(grabacion: Grabacion) -> tuple[Path, str]:
    origen = ruta_archivo(grabacion)
    vista = ruta_vista(grabacion)
    if grabacion.tipo_mime == TIPO_VISTA:
        return origen, grabacion.tipo_mime
    if vista.exists() and vista.stat().st_mtime >= origen.stat().st_mtime:
        return vista, TIPO_VISTA
    ffmpeg = _ejecutable_ffmpeg()
    if ffmpeg and _convertir_a_mp4(ffmpeg, origen, vista):
        return vista, TIPO_VISTA
    return origen, grabacion.tipo_mime


def agregar_parte(
    bd: Session, sesion: Sesion, parte: int, tipo_mime: str, desfase_ms: int, datos: bytes
) -> Grabacion:
    grabacion = sesion.grabacion
    if grabacion is None:
        if parte != 0:
            raise ParteFueraDeOrden()
        grabacion = Grabacion(
            sesion_id=sesion.id,
            archivo=f"sesion_{sesion.id}{EXTENSIONES[tipo_mime]}",
            tipo_mime=tipo_mime,
            desfase_ms=desfase_ms,
            partes=0,
            bytes=0,
        )
        bd.add(grabacion)
        sesion.grabacion = grabacion
    if parte < grabacion.partes:
        return grabacion
    if parte > grabacion.partes:
        raise ParteFueraDeOrden()

    ruta = ruta_archivo(grabacion)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with ruta.open("wb" if parte == 0 else "ab") as archivo:
        archivo.write(datos)
    grabacion.partes += 1
    grabacion.bytes += len(datos)
    bd.flush()
    return grabacion


def eliminar_archivo(grabacion: Grabacion) -> None:
    ruta_archivo(grabacion).unlink(missing_ok=True)
    ruta_vista(grabacion).unlink(missing_ok=True)


def borrar_grabacion(bd: Session, sesion: Sesion) -> bool:
    if sesion.grabacion is None:
        return False
    eliminar_archivo(sesion.grabacion)
    bd.delete(sesion.grabacion)
    sesion.grabacion = None
    bd.flush()
    return True
