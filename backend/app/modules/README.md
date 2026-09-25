# Módulos por área (`app.modules`)

- **`soporte`** — Lógica y rutas de «Indicadores coordinación» (`indicators.py`, `routes.py`). El prefijo HTTP sigue siendo `/api/indicators/coordination/*` (sin cambios para el cliente).

Otros routers globales (p. ej. facturación) pueden permanecer en `app/` o migrarse a `app.modules.<area>` siguiendo el mismo patrón.
