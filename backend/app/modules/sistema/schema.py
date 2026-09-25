"""
Tablas propias del panel dentro de la BD de GLPI.

Prefijo `glpi_plugin_coorddash_` para no colisionar con tablas del núcleo de GLPI ni con
sus migraciones. Las sentencias son idempotentes (CREATE TABLE IF NOT EXISTS) y se ejecutan
al arrancar la API y el worker.
"""

import logging

from app.db import get_connection

log = logging.getLogger(__name__)

T_SETTINGS = "glpi_plugin_coorddash_settings"
T_REPORT_PROJECTS = "glpi_plugin_coorddash_report_projects"
T_REPORT_RUNS = "glpi_plugin_coorddash_report_runs"
T_REPORT_SENDS = "glpi_plugin_coorddash_report_sends"
T_SURVEY_RESPONSES = "glpi_plugin_coorddash_survey_responses"

_DDL = [
    f"""
    CREATE TABLE IF NOT EXISTS `{T_SETTINGS}` (
        `name` VARCHAR(100) NOT NULL,
        `value` MEDIUMTEXT NULL,
        `users_id_mod` INT UNSIGNED NOT NULL DEFAULT 0,
        `date_mod` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (`name`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Coordinación GLPI: configuración clave/valor (JSON)'
    """,
    f"""
    CREATE TABLE IF NOT EXISTS `{T_REPORT_PROJECTS}` (
        `projects_id` INT UNSIGNED NOT NULL,
        `is_active` TINYINT(1) NOT NULL DEFAULT 1,
        `extra_to` TEXT NULL,
        `extra_cc` TEXT NULL,
        `users_id_mod` INT UNSIGNED NOT NULL DEFAULT 0,
        `date_mod` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (`projects_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Coordinación GLPI: parámetros del informe automático por proyecto'
    """,
    f"""
    CREATE TABLE IF NOT EXISTS `{T_REPORT_RUNS}` (
        `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        `trigger_type` VARCHAR(10) NOT NULL COMMENT 'auto | manual',
        `occurrence_key` VARCHAR(64) NOT NULL COMMENT 'auto:<fecha local programada> | manual:<uuid>',
        `period_from` DATE NOT NULL,
        `period_to` DATE NOT NULL,
        `status` VARCHAR(12) NOT NULL DEFAULT 'queued' COMMENT 'queued | running | done | partial | failed',
        `project_ids` TEXT NULL COMMENT 'JSON; NULL = todos los proyectos activos',
        `test_mode` TINYINT(1) NOT NULL DEFAULT 0,
        `users_id_requested` INT UNSIGNED NOT NULL DEFAULT 0,
        `total_projects` INT NOT NULL DEFAULT 0,
        `sent_count` INT NOT NULL DEFAULT 0,
        `failed_count` INT NOT NULL DEFAULT 0,
        `skipped_count` INT NOT NULL DEFAULT 0,
        `error` TEXT NULL,
        `date_creation` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `date_start` DATETIME NULL,
        `date_end` DATETIME NULL,
        PRIMARY KEY (`id`),
        UNIQUE KEY `uq_occurrence` (`occurrence_key`),
        KEY `idx_status` (`status`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Coordinación GLPI: ejecuciones del envío de informes'
    """,
    f"""
    CREATE TABLE IF NOT EXISTS `{T_REPORT_SENDS}` (
        `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        `runs_id` INT UNSIGNED NOT NULL,
        `projects_id` INT UNSIGNED NOT NULL,
        `project_name` VARCHAR(255) NULL,
        `status` VARCHAR(10) NOT NULL DEFAULT 'pending' COMMENT 'pending | sending | sent | failed | skipped',
        `skip_reason` VARCHAR(255) NULL,
        `recipients_to` TEXT NULL COMMENT 'JSON [{{name,email}}]',
        `recipients_cc` TEXT NULL COMMENT 'JSON [email]',
        `subject` VARCHAR(255) NULL,
        `tickets_count` INT NOT NULL DEFAULT 0,
        `total_seconds` INT NOT NULL DEFAULT 0,
        `attempts` INT NOT NULL DEFAULT 0,
        `last_error` TEXT NULL,
        `next_attempt_at` DATETIME NULL,
        `message_id` VARCHAR(255) NULL,
        `date_sent` DATETIME NULL,
        `date_creation` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `date_mod` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (`id`),
        UNIQUE KEY `uq_run_project` (`runs_id`, `projects_id`),
        KEY `idx_status_next` (`status`, `next_attempt_at`),
        KEY `idx_project` (`projects_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Coordinación GLPI: control de envío por proyecto (un correo por proyecto)'
    """,
    f"""
    CREATE TABLE IF NOT EXISTS `{T_SURVEY_RESPONSES}` (
        `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        `projects_id` INT UNSIGNED NOT NULL,
        `project_name` VARCHAR(255) NULL,
        `period_from` DATE NOT NULL,
        `period_to` DATE NOT NULL,
        `sends_id` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Envío que originó el enlace (0 = vista previa)',
        `score_solution_time` TINYINT UNSIGNED NOT NULL COMMENT '0-5',
        `score_response_time` TINYINT UNSIGNED NOT NULL COMMENT '0-5',
        `score_quality` TINYINT UNSIGNED NOT NULL COMMENT '0-5',
        `needs_training` TINYINT(1) NOT NULL DEFAULT 0,
        `training_module` VARCHAR(255) NULL,
        `respondent_name` VARCHAR(255) NULL,
        `observations` TEXT NULL,
        `ip_address` VARCHAR(45) NULL,
        `user_agent` VARCHAR(255) NULL,
        `date_creation` DATETIME NOT NULL,
        PRIMARY KEY (`id`),
        KEY `idx_project_period` (`projects_id`, `period_from`),
        KEY `idx_date` (`date_creation`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Coordinación GLPI: respuestas de la encuesta de satisfacción enviada con el informe'
    """,
]


# Migraciones sobre tablas ya creadas. El informe automático dejó de incluir facturación/costos (2026-09-25).
_MIGRATIONS = [
    f"ALTER TABLE `{T_REPORT_PROJECTS}` DROP COLUMN IF EXISTS `hourly_rate`, "
    "DROP COLUMN IF EXISTS `contract_hours`, DROP COLUMN IF EXISTS `iva_percent`",
    f"ALTER TABLE `{T_REPORT_SENDS}` DROP COLUMN IF EXISTS `facturable_seconds`",
]


def ensure_schema() -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            for ddl in _DDL + _MIGRATIONS:
                cur.execute(ddl)
        conn.commit()
    log.info("Esquema glpi_plugin_coorddash_* verificado.")
