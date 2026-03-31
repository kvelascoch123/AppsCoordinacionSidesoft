from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    db_host: str = Field(default="127.0.0.1", validation_alias="GLPI_DB_HOST")
    db_port: int = Field(default=3306, validation_alias="GLPI_DB_PORT")
    db_user: str = Field(default="glpi", validation_alias="GLPI_DB_USER")
    db_password: str = Field(default="", validation_alias="GLPI_DB_PASSWORD")
    db_name: str = Field(default="glpi", validation_alias="GLPI_DB_NAME")
    db_charset: str = Field(default="utf8mb4", validation_alias="GLPI_DB_CHARSET")

    # Solo lectura recomendado en producción
    assignee_link_type: int = Field(
        default=2,
        validation_alias="GLPI_ASSIGNEE_TYPE",
        description="Valor `type` en glpi_tickets_users para técnico asignado (GLPI: ASSIGN=2)",
    )
    requester_link_type: int = Field(default=1, validation_alias="GLPI_REQUESTER_TYPE")

    # Estados cerrados/resueltos (no cuentan como abiertos)
    status_solved: int = Field(default=5, validation_alias="GLPI_STATUS_SOLVED")
    status_closed: int = Field(default=6, validation_alias="GLPI_STATUS_CLOSED")

    # Entidad GLPI opcional (0 = todas)
    entities_id: Optional[int] = Field(default=None, validation_alias="GLPI_ENTITIES_ID")

    # Umbral horas sin actividad (seguimiento o creación) para alerta operativa
    stale_hours: int = Field(default=48, validation_alias="DASHBOARD_STALE_HOURS")

    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        validation_alias="CORS_ORIGINS",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
