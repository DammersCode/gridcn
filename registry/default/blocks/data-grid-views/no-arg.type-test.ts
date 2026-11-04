import { useDataGridViews, type UseDataGridViewsOptions } from "./use-data-grid-views";
import { DataGridViews } from "./views-menu";

export function noArgs() {
  const views = useDataGridViews();
  views.modified satisfies boolean;
  views.selectView(null);
  views.saveView("name")?.id satisfies string | undefined;
  return DataGridViews({});
}

export const controlled: UseDataGridViewsOptions = {
  value: null,
  onValueChange: (id) => {
    id satisfies string | null;
  },
};
