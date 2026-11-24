import math
from dataclasses import dataclass
from typing import Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

T = TypeVar("T")

POR_PAGINA_PREDETERMINADO = 20
POR_PAGINA_MAXIMO = 100


@dataclass(frozen=True)
class Paginacion:
    pagina: int
    por_pagina: int

    @property
    def desplazamiento(self) -> int:
        return (self.pagina - 1) * self.por_pagina


def parametros_paginacion(
    pagina: int = Query(default=1, ge=1, description="Número de página, desde 1"),
    por_pagina: int = Query(
        default=POR_PAGINA_PREDETERMINADO,
        ge=1,
        le=POR_PAGINA_MAXIMO,
        description="Elementos por página",
    ),
) -> Paginacion:
    return Paginacion(pagina, por_pagina)


class Pagina(BaseModel, Generic[T]):
    elementos: list[T]
    total: int
    pagina: int
    por_pagina: int
    paginas: int


def contar(bd: Session, consulta: Select) -> int:
    return bd.scalar(select(func.count()).select_from(consulta.order_by(None).subquery()))


def paginar(bd: Session, consulta: Select, paginacion: Paginacion) -> tuple[list, int]:
    filas = list(bd.scalars(consulta.limit(paginacion.por_pagina).offset(paginacion.desplazamiento)))
    if paginacion.pagina == 1 and len(filas) < paginacion.por_pagina:
        return filas, len(filas)
    return filas, contar(bd, consulta)


def crear_pagina(elementos: list, total: int, paginacion: Paginacion) -> dict:
    return {
        "elementos": elementos,
        "total": total,
        "pagina": paginacion.pagina,
        "por_pagina": paginacion.por_pagina,
        "paginas": math.ceil(total / paginacion.por_pagina),
    }
