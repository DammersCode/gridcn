import { cn } from "@/lib/utils";

const columns = ["Name", "Email", "Role", "Joined", "Score"];
const rows = [
  ["Silent Tiger", "user0@example.com", "Viewer", "Jul 5, 2023", "4"],
  ["Quick Lion", "user1@example.com", "Viewer", "Apr 3, 2021", "89"],
  ["Swift Wolf", "user2@example.com", "Manager", "Oct 27, 2020", "80"],
  ["Eager Lion", "user3@example.com", "User", "Oct 8, 2022", "51"],
  ["Eager Tiger", "user4@example.com", "Viewer", "Oct 7, 2024", "83"],
  ["Silent Wolf", "user5@example.com", "User", "Jun 1, 2020", "15"],
  ["Swift Lion", "user6@example.com", "Viewer", "Oct 18, 2022", "63"],
  ["Eager Wolf", "user7@example.com", "Manager", "Oct 7, 2021", "42"],
];
const hideOnMobile = (i: number) => (i === 1 || i === 3 ? "hidden sm:block" : "");
const selected = { rows: [2, 3, 4], cols: [2, 3] };

/** Static, non-interactive picture of the grid: no grid code ships with the first paint. */
export function GridMock({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Illustration of a gridcn grid with a selected range of cells and a fill handle"
      className={cn("overflow-hidden border bg-background shadow-sm", className)}
    >
      <div className="grid grid-cols-[1.5fr_1fr_0.6fr] sm:grid-cols-[1.2fr_1.8fr_1fr_1.2fr_0.6fr] bg-border text-sm" style={{ gap: 1 }}>
        {columns.map((c) => (
          <div key={c} className={cn("bg-muted px-3 py-2 font-medium", hideOnMobile(columns.indexOf(c)))}>
            {c}
          </div>
        ))}
        {rows.flatMap((r, ri) =>
          r.map((cell, ci) => {
            const inRange = selected.rows.includes(ri) && selected.cols.includes(ci);
            const last = ri === selected.rows[selected.rows.length - 1] && ci === selected.cols[selected.cols.length - 1];
            return (
              <div
                key={`${ri}-${ci}`}
                className={cn(
                  "relative truncate bg-card px-3 py-2", hideOnMobile(ci),
                  ci === 4 && "text-end tabular-nums",
                  inRange && "bg-primary/10",
                )}
              >
                {cell}
                {last && <span className="absolute -bottom-0.5 -end-0.5 size-2 bg-primary" />}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
