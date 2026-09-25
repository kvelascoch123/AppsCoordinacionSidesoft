import { useMemo, useState } from "react";
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

import type { BillingInvoiceRow } from "../api";

function fmtMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Alínea formato char Y/N (`ispaid`), boolean JSON o otros. */
function fmtPagadaSiNo(v: unknown): string {
  if (v === true) return "Sí";
  if (v === false) return "No";
  const s = String(v ?? "").trim().toUpperCase();
  if (["Y", "T", "TRUE", "1", "SI", "SÍ"].includes(s)) return "Sí";
  if (["N", "F", "FALSE", "0", "NO"].includes(s)) return "No";
  return "—";
}

const textIncludes: FilterFn<BillingInvoiceRow> = (row, columnId, filterValue) => {
  const q = String(filterValue ?? "").trim().toLowerCase();
  if (!q) return true;
  const v = row.getValue(columnId);
  return String(v ?? "").toLowerCase().includes(q);
};

const columnHelper = createColumnHelper<BillingInvoiceRow>();

export function BillingInvoicesDataTable({ rows }: { rows: BillingInvoiceRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo(
    () => [
      columnHelper.accessor("tercero", {
        header: "Tercero",
        cell: (info) => (info.getValue() as string | null | undefined) ?? "—",
        filterFn: textIncludes,
        enableSorting: true,
      }),
      columnHelper.accessor("documentno", {
        header: "Documentno",
        cell: (info) => info.getValue() ?? "—",
        filterFn: textIncludes,
      }),
      columnHelper.accessor("poreference", {
        header: "Ref.",
        cell: (info) => info.getValue() ?? "—",
        filterFn: textIncludes,
      }),
      columnHelper.accessor((r) => (r.dateinvoiced ?? "").slice(0, 10), {
        id: "fecha",
        header: "Fecha",
        cell: (info) => String(info.getValue() || "").trim() || "—",
        filterFn: textIncludes,
      }),
      columnHelper.accessor("grandtotal", {
        header: "Total",
        cell: (info) => fmtMoney(info.getValue() as number | null | undefined),
        sortingFn: "basic",
        filterFn: textIncludes,
      }),
      columnHelper.accessor("ispaid", {
        header: "Pagada",
        cell: (info) => fmtPagadaSiNo(info.getValue()),
        filterFn: textIncludes,
        sortingFn: (rowA, rowB) =>
          fmtPagadaSiNo(rowA.original.ispaid).localeCompare(fmtPagadaSiNo(rowB.original.ispaid), "es"),
      }),
      columnHelper.accessor("totalpaid", {
        header: "Pagado",
        cell: (info) => fmtMoney(info.getValue() as number | null | undefined),
        sortingFn: "basic",
        filterFn: textIncludes,
      }),
      columnHelper.accessor("valor_pendiente", {
        header: "Valor pendiente",
        cell: (info) => fmtMoney(info.getValue() as number | null | undefined),
        sortingFn: "basic",
        filterFn: textIncludes,
      }),
      columnHelper.accessor("centro_costo", {
        header: "Centro de costos",
        cell: (info) => info.getValue() ?? "—",
        filterFn: textIncludes,
      }),
      columnHelper.accessor("usuario1", {
        header: "Usuario",
        cell: (info) => info.getValue() ?? "—",
        filterFn: textIncludes,
      }),
      columnHelper.accessor("description", {
        header: "Descripción",
        cell: (info) => ((info.getValue() as string | null | undefined)?.trim() || "") || "—",
        filterFn: textIncludes,
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
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

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem",
          alignItems: "center",
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
        <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
          Mostrando {filt} de {rows.length} filas
        </span>
      </div>
      <div
        style={{
          maxHeight: 520,
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
                  const right = id === "grandtotal" || id === "totalpaid" || id === "valor_pendiente";
                  return (
                  <th
                    key={h.id}
                    style={{
                      padding: "0.4rem",
                      position: "sticky",
                      top: 0,
                      background: "var(--surface2)",
                      zIndex: 1,
                      textAlign: right ? "right" : "left",
                      verticalAlign: "top",
                      minWidth: id === "description" ? 200 : undefined,
                    }}
                  >
                    {h.isPlaceholder ? null : (
                      <>
                        <div
                          onClick={() => h.column.toggleSorting()}
                          role={h.column.getCanSort() ? "button" : undefined}
                          style={{ fontWeight: 600, cursor: h.column.getCanSort() ? "pointer" : "default", marginBottom: 4 }}
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
              <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{
                      padding: "0.4rem 0.45rem",
                      verticalAlign: "top",
                      textAlign:
                        cell.column.id === "grandtotal" || cell.column.id === "totalpaid" || cell.column.id === "valor_pendiente"
                          ? "right"
                          : "left",
                      maxWidth: cell.column.id === "description" ? 320 : undefined,
                      color:
                        cell.column.id === "description"
                          ? "var(--muted)"
                          : cell.column.id === "tercero"
                            ? "var(--text)"
                            : "var(--text)",
                      fontWeight: cell.column.id === "tercero" ? 600 : undefined,
                      whiteSpace: cell.column.id === "fecha" ? "nowrap" : undefined,
                      wordBreak: cell.column.id === "description" ? "break-word" : undefined,
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
