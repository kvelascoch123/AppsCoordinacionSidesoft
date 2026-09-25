"""
Formato de tiempo GLPI Fields H.MM: parte entera = horas, decimales = minutos.

Ejemplos: 0.50 → 50 min, 1.00 → 1 h, 1.50 → 1 h 50 min (no 1,5 h decimales).
"""


def glpi_hm_cast_sql(field_expr: str) -> str:
    return f"CAST(COALESCE(NULLIF(TRIM({field_expr}), ''), '0') AS DECIMAL(10,2))"


def glpi_hm_to_decimal_hours_sql(cast_expr: str) -> str:
    return f"(FLOOR({cast_expr}) + (({cast_expr} - FLOOR({cast_expr})) * 100) / 60.0)"


def glpi_plugin_field_hm_hours_sql(qualified_field: str) -> str:
    """Convierte un campo plugin (pf.campo) a horas decimales reales."""
    cast = glpi_hm_cast_sql(qualified_field)
    return f"ROUND({glpi_hm_to_decimal_hours_sql(cast)}, 4)"
