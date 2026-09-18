"use client";

import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useState, type ReactNode } from "react";
import { formatScore, isoToLocalDate, DATE_LOCALE, DATE_DISPLAY_FORMAT, type BenchmarkRow } from "../_lib/dataset";

type Props = {
  rows: BenchmarkRow[];
  roles: string[];
};

const dateFormatter = new Intl.DateTimeFormat(DATE_LOCALE, DATE_DISPLAY_FORMAT);

/** Same 8-column shape as every other benchmark grid, using MUI's own column types where they exist. */
function makeColumns(roles: string[]): GridColDef<BenchmarkRow>[] {
  return [
    { field: "id", headerName: "ID", width: 120 },
    { field: "name", headerName: "Name", width: 180, editable: true },
    { field: "email", headerName: "Email", width: 220, editable: true },
    { field: "age", headerName: "Age", width: 80, type: "number", editable: true },
    { field: "active", headerName: "Active", width: 100, type: "boolean", editable: true },
    { field: "role", headerName: "Role", width: 140, type: "singleSelect", valueOptions: roles, editable: true },
    {
      field: "joined",
      headerName: "Joined",
      width: 140,
      type: "date",
      editable: true,
      // MUI's date column operates on Date objects; the shared dataset stores ISO strings.
      valueGetter: (value: string) => isoToLocalDate(value),
      valueFormatter: (value: Date | null) => (value ? dateFormatter.format(value) : ""),
    },
    {
      field: "score",
      headerName: "Score",
      width: 100,
      type: "number",
      editable: true,
      valueFormatter: (value: number) => formatScore(value),
    },
  ];
}

export default function MuiGridInner({ rows: initialRows, roles }: Props): ReactNode {
  const [rows, setRows] = useState(initialRows);

  return (
    <div className="h-full w-full" data-benchmark-grid-root>
      <DataGrid
        rows={rows}
        columns={makeColumns(roles)}
        getRowId={(row) => row.id}
        processRowUpdate={(updated) => {
          setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
          return updated;
        }}
        onProcessRowUpdateError={() => {}}
        checkboxSelection
        disableRowSelectionOnClick={false}
        rowHeight={36}
        columnHeaderHeight={36}
        hideFooter
        disableColumnMenu={false}
      />
    </div>
  );
}
