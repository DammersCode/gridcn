"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type DeepPartialLabels,
  type GridDirection,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar, DataGridSearch } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateDemoRows, type DemoRow } from "./demo-data";

type Locale = "en" | "de" | "ar";

type Translation = {
  name: string;
  dir: GridDirection;
  values: {
    columns: { name: string; email: string; role: string; age: string };
    hint: string;
    /** Partial overrides only — deep merge fills every other string from DEFAULT_LABELS. */
    labels: DeepPartialLabels;
  };
};

const TRANSLATIONS: Record<Locale, Translation> = {
  en: {
    name: "English",
    dir: "ltr",
    values: {
      columns: { name: "Name", email: "Email", role: "Role", age: "Age" },
      hint: "Pick a language — direction follows it.",
      labels: {},
    },
  },
  de: {
    name: "Deutsch",
    dir: "ltr",
    values: {
      columns: { name: "Name", email: "E-Mail", role: "Rolle", age: "Alter" },
      hint: "Sprache wählen — die Richtung folgt.",
      labels: {
        toolbar: { searchPlaceholder: "Suchen…", filter: "Filter", columns: "Spalten" },
        grid: { emptyState: "Keine Zeilen", loading: "Wird geladen…" },
      },
    },
  },
  ar: {
    name: "العربية",
    dir: "rtl",
    values: {
      columns: { name: "الاسم", email: "البريد الإلكتروني", role: "الدور", age: "العمر" },
      hint: "اختر لغة — يتبعها اتجاه التخطيط.",
      labels: {
        toolbar: { searchPlaceholder: "بحث…", filter: "تصفية", columns: "أعمدة" },
        grid: { emptyState: "لا صفوف", loading: "جارٍ التحميل…" },
      },
    },
  },
};

const LOCALES = Object.keys(TRANSLATIONS) as Locale[];

function useTranslation(locale: Locale) {
  return TRANSLATIONS[locale];
}

/**
 * One locale `Select` drives everything: the `labels` prop, this demo's own column headers, and
 * `direction` — read off the locale's own `dir`, the way a real app derives layout direction from
 * its active language rather than from a separate switch.
 */
export default function DataGridI18nDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(10), []);
  const [locale, setLocale] = useState<Locale>("en");
  const { dir, values } = useTranslation(locale);

  const columns = useMemo(
    () =>
      defineColumns<DemoRow>()([
        { id: "name", header: values.columns.name, accessorKey: "name", type: "text", width: 100, flex: 1, pin: "left" },
        { id: "email", header: values.columns.email, accessorKey: "email", type: "text", width: 130, flex: 2 },
        { id: "role", header: values.columns.role, accessorKey: "role", type: "text", width: 90, flex: 1 },
        { id: "age", header: values.columns.age, accessorKey: "age", type: "number", width: 70, flex: 1 },
      ] as const),
    [values],
  );

  return (
    <div className="w-full flex h-[420px] flex-col gap-3" dir={dir}>
      <div className="flex flex-wrap items-center gap-4">
        <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((value) => (
              <SelectItem key={value} value={value}>
                {TRANSLATIONS[value].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{values.hint}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          defaultData={rows}
          columns={columns}
          getRowId={(row) => row.id}
          labels={values.labels}
        >
          <DataGridToolbar>
            <DataGridSearch />
          </DataGridToolbar>
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none" direction={dir}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
