import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  type ColumnFiltersState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type FilterFn,
} from "@tanstack/react-table";

import {
  fetchCostCenterTickets,
  type CostCenterHoursRow,
  type CostCenterTicketRow,
} from "../../../api";
import { downloadExcelWorkbook, excelNum2 } from "./excelExport";

type CostCentersDataTableProps = {
  rows: CostCenterHoursRow[];
  dateFrom?: string;
  dateTo?: string;
};

function rowKey(r: CostCenterHoursRow): string {
  return `${r.proyecto}\0${r.asignado}\0${r.centro_costo ?? ""}`;
}

/**
 * % participación = horas de la fila / total de horas del mismo proyecto
 * en las filas actuales (misma lógica que el backend SUMAR.SI por proyecto).
 * Al quitar o restaurar filas se redistribuye entre los consultores que quedan.
 */
function withPctByProject(rows: CostCenterHoursRow[]): CostCenterHoursRow[] {
  const hoursByProject = new Map<string, number>();
  for (const r of rows) {
    const key = r.proyecto || "";
    hoursByProject.set(key, (hoursByProject.get(key) || 0) + (Number(r.horas_laboradas) || 0));
  }
  return rows.map((r) => {
    const denom = hoursByProject.get(r.proyecto || "") || 0;
    const pct = denom > 0 ? ((Number(r.horas_laboradas) || 0) / denom) * 100 : 0;
    return { ...r, pct_participacion: pct };
  });
}

function fmtHours(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

function downloadVisibleRows(rows: CostCenterHoursRow[], dateFrom?: string, dateTo?: string) {
  const from = dateFrom || "desde";
  const to = dateTo || "hasta";
  downloadExcelWorkbook(`variables-centros-costo-${from}-${to}.xls`, [
    {
      name: "Centros de costo",
      headers: [
        "Proyecto",
        "Centro de costo",
        "Consultor (técnico / funcional)",
        "Tiempo",
        "Horas laboradas",
        "% participación del consultor",
      ],
      rows: rows.map((r) => [
        r.proyecto,
        r.centro_costo ?? "",
        r.asignado,
        r.tiempo_horas_minutos,
        excelNum2(r.horas_laboradas),
        excelNum2(r.pct_participacion),
      ]),
    },
  ]);
}

const textIncludes: FilterFn<CostCenterHoursRow> = (row, columnId, filterValue) => {
  const q = String(filterValue ?? "").trim().toLowerCase();
  if (!q) return true;
  const v = row.getValue(columnId);
  return String(v ?? "").toLowerCase().includes(q);
};

const columnHelper = createColumnHelper<CostCenterHoursRow>();

const btnBase: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "0.4rem 0.75rem",
  fontSize: "0.82rem",
  fontWeight: 600,
  cursor: "pointer",
  background: "var(--surface2)",
  color: "var(--text)",
};

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TicketsModal({
  row,
  dateFrom,
  dateTo,
  tickets,
  loading,
  err,
  onClose,
}: {
  row: CostCenterHoursRow;
  dateFrom?: string;
  dateTo?: string;
  tickets: CostCenterTicketRow[];
  loading: boolean;
  err: string | null;
  onClose: () => void;
}) {
  const totalHoras = tickets.reduce((sum, t) => sum + (Number(t.horas_laboradas) || 0), 0);
  const centro = row.centro_costo?.trim() || "—";

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(33, 37, 41, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cost-center-tickets-title"
        style={{
          background: "var(--surface)",
          borderRadius: 12,
          border: "1px solid var(--border)",
          padding: "1.2rem 1.4rem",
          maxWidth: 980,
          width: "100%",
          maxHeight: "82vh",
          overflowY: "auto",
          boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
          <div>
            <h2 id="cost-center-tickets-title" style={{ margin: 0, fontSize: "1.05rem", fontWeight: 650 }}>
              Tickets que acumulan las horas
            </h2>
            <p style={{ margin: "0.4rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
              {row.proyecto} · {row.asignado}
              {centro !== "—" ? ` · ${centro}` : ""}
            </p>
            <p style={{ margin: "0.2rem 0 0", color: "var(--muted)", fontSize: "0.82rem" }}>
              {dateFrom && dateTo ? `Rango ${dateFrom} → ${dateTo}` : null}
              {!loading && !err
                ? ` · ${tickets.length} ticket${tickets.length === 1 ? "" : "s"} · ${fmtHours(totalHoras)} h`
                : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "0.25rem 0.7rem",
              color: "var(--muted)",
              fontSize: "0.8rem",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Cerrar
          </button>
        </div>

        {loading && <p style={{ marginTop: "1rem", color: "var(--muted)" }}>Cargando tickets…</p>}
        {err && (
          <p style={{ color: "var(--danger-text)", marginTop: "0.85rem", fontSize: "0.9rem" }}>Error: {err}</p>
        )}
        {!loading && !err && (
          <div
            style={{
              marginTop: "0.9rem",
              overflowX: "auto",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
            }}
          >
            {tickets.length === 0 ? (
              <p style={{ margin: "0.85rem", color: "var(--muted)", fontSize: "0.86rem" }}>
                No hay tickets con tiempo en este registro y rango.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                <thead>
                  <tr style={{ background: "var(--surface2)", textAlign: "left" }}>
                    <th style={{ padding: "0.55rem 0.7rem" }}>ID Ticket</th>
                    <th style={{ padding: "0.55rem 0.7rem" }}>Título</th>
                    <th style={{ padding: "0.55rem 0.7rem" }}>Fecha</th>
                    <th style={{ padding: "0.55rem 0.7rem" }}>Estado</th>
                    <th style={{ padding: "0.55rem 0.7rem" }}>Tiempo</th>
                    <th style={{ padding: "0.55rem 0.7rem", textAlign: "right" }}>Horas laboradas</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.ticket} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.5rem 0.7rem", fontWeight: 650, whiteSpace: "nowrap" }}>{t.ticket}</td>
                      <td style={{ padding: "0.5rem 0.7rem" }}>{t.titulo?.trim() || "—"}</td>
                      <td style={{ padding: "0.5rem 0.7rem", whiteSpace: "nowrap", fontSize: "0.82rem" }}>
                        {t.fecha || "—"}
                      </td>
                      <td style={{ padding: "0.5rem 0.7rem" }}>{t.estado}</td>
                      <td style={{ padding: "0.5rem 0.7rem", whiteSpace: "nowrap", fontSize: "0.82rem" }}>
                        {t.tiempo_horas_minutos}
                      </td>
                      <td
                        style={{
                          padding: "0.5rem 0.7rem",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {fmtHours(t.horas_laboradas)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", background: "var(--surface2)" }}>
                    <td colSpan={5} style={{ padding: "0.55rem 0.7rem", fontWeight: 650 }}>
                      Total
                    </td>
                    <td
                      style={{
                        padding: "0.55rem 0.7rem",
                        textAlign: "right",
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmtHours(totalHoras)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TotalHoursCard({ totalHours, rowCount }: { totalHours: number; rowCount: number }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: "4px solid var(--accent)",
        borderRadius: "var(--radius)",
        padding: "0.85rem 1.15rem",
        minWidth: 200,
        flex: "0 1 260px",
      }}
    >
      <div style={{ color: "var(--muted)", fontSize: "0.82rem", fontWeight: 500 }}>
        Total horas laboradas
      </div>
      <div
        style={{
          fontSize: "1.55rem",
          fontWeight: 700,
          marginTop: "0.15rem",
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fmtHours(totalHours)}
      </div>
      <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.35rem" }}>
        Suma de {rowCount} fila{rowCount === 1 ? "" : "s"} visible{rowCount === 1 ? "" : "s"}
      </div>
    </div>
  );
}

export function CostCentersDataTable({ rows, dateFrom, dateTo }: CostCentersDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "proyecto", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(() => new Set());
  const [selectedRow, setSelectedRow] = useState<CostCenterHoursRow | null>(null);
  const [tickets, setTickets] = useState<CostCenterTicketRow[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsErr, setTicketsErr] = useState<string | null>(null);

  const closeTickets = useCallback(() => {
    setSelectedRow(null);
    setTickets([]);
    setTicketsErr(null);
    setTicketsLoading(false);
  }, []);

  useEffect(() => {
    setRemovedKeys(new Set());
    closeTickets();
  }, [rows, closeTickets]);

  useEffect(() => {
    if (!selectedRow || !dateFrom || !dateTo) return;
    let cancelled = false;
    setTicketsLoading(true);
    setTicketsErr(null);
    setTickets([]);
    fetchCostCenterTickets(dateFrom, dateTo, selectedRow.proyecto, selectedRow.asignado)
      .then((res) => {
        if (!cancelled) setTickets(res.tickets);
      })
      .catch((e) => {
        if (!cancelled) setTicketsErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setTicketsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRow, dateFrom, dateTo]);

  useEffect(() => {
    if (!selectedRow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTickets();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedRow, closeTickets]);

  const visibleRows = useMemo(
    () => withPctByProject(rows.filter((r) => !removedKeys.has(rowKey(r)))),
    [rows, removedKeys],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor("proyecto", {
        header: "Proyecto",
        cell: (info) => info.getValue() || "—",
        filterFn: textIncludes,
        enableSorting: true,
      }),
      columnHelper.accessor("centro_costo", {
        header: "Centro de costo",
        cell: (info) => {
          const label = (info.getValue() as string | null | undefined)?.trim() || "—";
          return (
            <span
              style={{
                color: "var(--accent)",
                fontWeight: 600,
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              {label}
            </span>
          );
        },
        filterFn: textIncludes,
      }),
      columnHelper.accessor("asignado", {
        header: "Consultor (técnico / funcional)",
        cell: (info) => info.getValue() || "—",
        filterFn: textIncludes,
      }),
      columnHelper.accessor("tiempo_horas_minutos", {
        header: "Tiempo",
        cell: (info) => info.getValue() || "—",
        filterFn: textIncludes,
      }),
      columnHelper.accessor("horas_laboradas", {
        header: "Horas laboradas",
        cell: (info) => fmtHours(info.getValue() as number),
        sortingFn: "basic",
        filterFn: textIncludes,
      }),
      columnHelper.accessor("pct_participacion", {
        header: "% participación del consultor",
        cell: (info) => fmtPct(info.getValue() as number),
        sortingFn: "basic",
        filterFn: textIncludes,
      }),
      columnHelper.display({
        id: "acciones",
        header: "Acciones",
        enableSorting: false,
        enableColumnFilter: false,
        cell: ({ row }) => (
          <button
            type="button"
            title="Quitar de la vista (no se incluirá al exportar)"
            aria-label={`Quitar ${row.original.proyecto} / ${row.original.asignado}`}
            onClick={(e) => {
              e.stopPropagation();
              const key = rowKey(row.original);
              setRemovedKeys((prev) => {
                const next = new Set(prev);
                next.add(key);
                return next;
              });
            }}
            style={{
              ...btnBase,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              padding: 0,
              borderColor: "rgba(220, 53, 69, 0.35)",
              color: "var(--danger-text)",
              background: "rgba(220, 53, 69, 0.08)",
            }}
          >
            <TrashIcon />
          </button>
        ),
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: visibleRows,
    columns,
    getRowId: (r) => rowKey(r),
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue ?? "").trim().toLowerCase();
      if (!q) return true;
      const vals = Object.values(row.original).map((v) => String(v ?? "").toLowerCase());
      return vals.some((s) => s.includes(q));
    },
  });

  const filt = table.getFilteredRowModel().rows.length;
  const exportRows = table.getFilteredRowModel().rows.map((r) => r.original);
  const removedCount = removedKeys.size;
  const totalHorasLaboradas = exportRows.reduce(
    (sum, r) => sum + (Number(r.horas_laboradas) || 0),
    0,
  );

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "stretch",
          marginBottom: "0.85rem",
        }}
      >
        <TotalHoursCard totalHours={totalHorasLaboradas} rowCount={exportRows.length} />
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem",
          alignItems: "flex-end",
          marginBottom: "0.65rem",
        }}
      >
        <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
          Buscar global
          <input
            type="search"
            placeholder="Filtra todas las columnas…"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            style={{
              display: "block",
              marginTop: 4,
              minWidth: 240,
              padding: "0.45rem 0.5rem",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface2)",
              color: "var(--text)",
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => downloadVisibleRows(exportRows, dateFrom, dateTo)}
          disabled={exportRows.length === 0}
          style={{
            ...btnBase,
            background: "var(--accent)",
            color: "var(--on-accent)",
            borderColor: "transparent",
            opacity: exportRows.length === 0 ? 0.55 : 1,
            cursor: exportRows.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          Descargar Excel ({exportRows.length})
        </button>
        {removedCount > 0 && (
          <button
            type="button"
            onClick={() => setRemovedKeys(new Set())}
            style={btnBase}
            title="Volver a mostrar los registros quitados"
          >
            Restaurar quitados ({removedCount})
          </button>
        )}
        <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
          Mostrando {filt} de {visibleRows.length} filas
          {removedCount > 0 ? ` · ${removedCount} quitada${removedCount === 1 ? "" : "s"}` : ""}
          {" · pulse una fila para ver los tickets"}
        </span>
      </div>
      <div
        className="cost-centers-data-table"
        style={{
          maxHeight: 560,
          overflow: "auto",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 960 }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} style={{ borderBottom: "2px solid var(--border)" }}>
                {hg.headers.map((h) => {
                  const id = h.column.id;
                  const right = id === "horas_laboradas" || id === "pct_participacion";
                  const isAction = id === "acciones";
                  return (
                    <th
                      key={h.id}
                      style={{
                        padding: "0.4rem",
                        position: "sticky",
                        top: 0,
                        background: "var(--surface2)",
                        zIndex: 1,
                        textAlign: right ? "right" : isAction ? "center" : "left",
                        verticalAlign: "top",
                        width: isAction ? 56 : undefined,
                      }}
                    >
                      {h.isPlaceholder ? null : (
                        <>
                          <div
                            onClick={() => (h.column.getCanSort() ? h.column.toggleSorting() : undefined)}
                            role={h.column.getCanSort() ? "button" : undefined}
                            style={{
                              fontWeight: 600,
                              cursor: h.column.getCanSort() ? "pointer" : "default",
                              marginBottom: h.column.getCanFilter() ? 4 : 0,
                            }}
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {h.column.getCanSort()
                              ? h.column.getIsSorted() === "asc"
                                ? " ▲"
                                : h.column.getIsSorted() === "desc"
                                  ? " ▼"
                                  : ""
                              : ""}
                          </div>
                          {h.column.getCanFilter() ? (
                            <input
                              type="text"
                              placeholder="Filtrar…"
                              value={(h.column.getFilterValue() ?? "") as string}
                              onChange={(e) => h.column.setFilterValue(e.target.value)}
                              aria-label={`Filtro ${String(h.column.columnDef.header ?? h.column.id)}`}
                              style={{
                                width: "100%",
                                boxSizing: "border-box",
                                padding: "0.3rem",
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                                background: "var(--surface)",
                                color: "var(--text)",
                                fontSize: "0.76rem",
                              }}
                            />
                          ) : null}
                        </>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="cost-centers-row-clickable"
                style={{ borderBottom: "1px solid var(--border)" }}
                onClick={() => setSelectedRow(row.original)}
                title="Ver tickets que acumulan estas horas"
              >
                {row.getVisibleCells().map((cell) => {
                  const id = cell.column.id;
                  const right = id === "horas_laboradas" || id === "pct_participacion";
                  const isAction = id === "acciones";
                  return (
                    <td
                      key={cell.id}
                      style={{
                        padding: "0.4rem 0.45rem",
                        verticalAlign: "middle",
                        textAlign: right ? "right" : isAction ? "center" : "left",
                        fontWeight: id === "proyecto" ? 600 : undefined,
                        whiteSpace: id === "tiempo_horas_minutos" ? "nowrap" : undefined,
                        fontVariantNumeric: right ? "tabular-nums" : undefined,
                        cursor: isAction ? "default" : undefined,
                      }}
                      onClick={isAction ? (e) => e.stopPropagation() : undefined}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedRow && (
        <TicketsModal
          row={selectedRow}
          dateFrom={dateFrom}
          dateTo={dateTo}
          tickets={tickets}
          loading={ticketsLoading}
          err={ticketsErr}
          onClose={closeTickets}
        />
      )}
    </div>
  );
}
