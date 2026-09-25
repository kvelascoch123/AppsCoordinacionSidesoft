import type { ReactNode } from "react";

/**
 * Plantilla mínima para un nuevo módulo por área de negocio.
 *
 * Pasos habituales:
 * 1. Crear `frontend/src/modules/<area>/` con `index.ts`, páginas y cliente API si aplica.
 * 2. Registrar la entrada de menú en `App.tsx` (o extraer después un mapa de rutas).
 * 3. En backend, opcionalmente `backend/app/modules/<area>/` con routers y `app.main.include_router(...)`.
 */
export type AreaModulePlaceholderProps = {
  title: string;
  children?: ReactNode;
};

export function AreaModulePlaceholder({ title, children }: AreaModulePlaceholderProps) {
  return (
    <section style={{ padding: "1.25rem", maxWidth: 720 }}>
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.05rem", fontWeight: 600 }}>{title}</h2>
      {children ?? (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem" }}>
          Sustituir este componente por las pantallas y llamadas API del área.
        </p>
      )}
    </section>
  );
}
