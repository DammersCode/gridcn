"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  DataGrid,
  SelectColumn,
  SelectCellFormatter,
  renderTextEditor,
  type CellCopyArgs,
  type Column,
  type RenderEditCellProps,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { formatJoined, formatScore, ROLE_CHOICES, type BenchmarkRow } from "../_lib/dataset";

/**
 * react-data-grid ships exactly one editor (`renderTextEditor`). The select/date/number editors
 * below are benchmark code, not library features — recorded as parity gaps in _lib/parity.ts so the
 * numbers aren't read as "RDG's rich cells are this fast".
 */
function SelectEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<BenchmarkRow>): ReactNode {
  return (
    <select
      className="h-full w-full border-0 bg-transparent px-1.5 outline-none"
      autoFocus
      value={row.role}
      onChange={(e) => onRowChange({ ...row, role: e.target.value }, true)}
      onBlur={() => onClose(true, false)}
      aria-label={String(column.name)}
    >
      {ROLE_CHOICES.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

function DateEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<BenchmarkRow>): ReactNode {
  return (
    <input
      type="date"
      className="h-full w-full border-0 bg-transparent px-1.5 outline-none"
      autoFocus
      value={row.joined}
      onChange={(e) => onRowChange({ ...row, joined: e.target.value })}
      onBlur={() => onClose(true, false)}
      aria-label={String(column.name)}
    />
  );
}

function NumberEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<BenchmarkRow>): ReactNode {
  const field = column.key === "age" ? "age" : "score";
  return (
    <input
      type="number"
      className="h-full w-full border-0 bg-transparent px-1.5 text-right outline-none"
      autoFocus
      value={row[field]}
      onChange={(e) => onRowChange({ ...row, [field]: Number(e.target.value) })}
      onBlur={() => onClose(true, false)}
      aria-label={String(column.name)}
    />
  );
}

const columns: readonly Column<BenchmarkRow>[] = [
  SelectColumn,
  { key: "id", name: "ID", width: 120 },
  { key: "name", name: "Name", width: 180, renderEditCell: renderTextEditor, editable: true },
  { key: "email", name: "Email", width: 220, renderEditCell: renderTextEditor, editable: true },
  { key: "age", name: "Age", width: 80, renderEditCell: NumberEditor, editable: true },
  {
    key: "active",
    name: "Active",
    width: 100,
    // RDG has no boolean column type; its selection-checkbox formatter is the closest built-in.
    renderCell: ({ row, onRowChange }) => (
      <SelectCellFormatter
        value={row.active}
        onChange={(checked) => onRowChange({ ...row, active: checked })}
        aria-label="Active"
      />
    ),
  },
  { key: "role", name: "Role", width: 140, renderEditCell: SelectEditor, editable: true },
  {
    key: "joined",
    name: "Joined",
    width: 140,
    renderCell: ({ row }) => formatJoined(row.joined),
    renderEditCell: DateEditor,
    editable: true,
  },
  {
    key: "score",
    name: "Score",
    width: 100,
    renderCell: ({ row }) => formatScore(row.score),
    renderEditCell: NumberEditor,
    editable: true,
  },
];

export default function ReactDataGridInner({ rows: initialRows }: { rows: BenchmarkRow[] }): ReactNode {
  const [rows, setRows] = useState(initialRows);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(new Set());

  // RDG exposes clipboard as opt-in single-cell callbacks; wiring them is the closest it gets to
  // gridcn's native range copy/paste.
  const handleCopy = useCallback(({ row, column }: CellCopyArgs<BenchmarkRow>) => {
    const value = row[column.key as keyof BenchmarkRow];
    void navigator.clipboard?.writeText(String(value ?? ""));
  }, []);

  return (
    <div className="h-full w-full" data-benchmark-grid-root>
      <DataGrid
        columns={columns}
        rows={rows}
        onRowsChange={setRows}
        rowKeyGetter={(row) => row.id}
        selectedRows={selectedRows}
        onSelectedRowsChange={setSelectedRows}
        onCellCopy={handleCopy}
        onCellPaste={({ row }) => row}
        rowHeight={36}
        headerRowHeight={36}
        className="rdg-light h-full"
      />
    </div>
  );
}
