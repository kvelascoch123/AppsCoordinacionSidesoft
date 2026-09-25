# Módulos por área (`frontend/src/modules`)

- **`soporte/`** — Funcionalidad actual de soporte GLPI: coordinación de indicadores, bloque problemas/soporte, informes DOCX/PDF y utilidades de gráficos ISO asociadas. Punto de entrada: `soporte/index.ts`.
- **`_template/`** — Componente base (`AreaModulePlaceholder`) para arrancar un área nueva sin acoplar código a `App.tsx` hasta tener páginas propias.

Referencias backend equivalentes: `backend/app/modules/soporte/` (rutas `/api/indicators/coordination/*` sin cambios).
