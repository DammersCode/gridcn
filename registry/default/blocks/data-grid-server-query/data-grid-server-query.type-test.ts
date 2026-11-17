import type { FetchFilterValues } from "@/registry/default/blocks/data-grid/data-grid";
import type { FetchAggregatesRequest } from "@/registry/default/blocks/data-grid-pinned-rows/data-grid-pinned-rows";
import type { ServerRowsAnswer, ServerRowsPageRequest } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { type ColumnMap, type GridQuery, QueryError, defineColumnMap, describeFilterOperators, handleGridRequest } from "./data-grid-server-query";

type Row = { id: number; name: string | null };
declare const plain: GridQuery<Row>;
declare const scoped: GridQuery<Row, { tenantId: number }>;

// the answer is what useDataGridServerRows reads, and the request it posts is what fetchRows takes
export const fetchRows = async ({ signal, ...request }: ServerRowsPageRequest): Promise<ServerRowsAnswer<Row>> => plain.fetchRows(request, { signal });

export const fetchFilterValues: FetchFilterValues = async ({ signal, ...request }) => plain.filterValues(request, { signal });
export const fetchAggregates = async ({ signal, ...request }: FetchAggregatesRequest): Promise<Record<string, unknown>> => plain.aggregates(request, { signal });

export const noOptions = plain.fetchRows({});
export const withContext = scoped.fetchRows({}, { context: { tenantId: 1 }, signal: new AbortController().signal });
// @ts-expect-error a factory with rowScope needs context
export const missingContext = scoped.fetchRows({});
// @ts-expect-error a factory with rowScope needs context
export const missingContextWithSignal = scoped.fetchRows({}, { signal: new AbortController().signal });
// @ts-expect-error a factory without rowScope takes no context
export const unexpectedContext = plain.fetchRows({}, { context: { tenantId: 1 } });

export const route = (req: Request) => handleGridRequest(req, plain.fetchRows);
export const scopedRoute = (req: Request) => handleGridRequest(req, scoped.fetchRows, { context: { tenantId: 1 } });
// @ts-expect-error the route must pass the context the factory needs
export const scopedRouteWithoutContext = (req: Request) => handleGridRequest(req, scoped.fetchRows);
export const routeWithBodyCap = (req: Request) => handleGridRequest(req, plain.fetchRows, { maxBodyBytes: 1024 });

export const columns: ColumnMap = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, name: { type: "text" } });
export const descriptor = describeFilterOperators(columns);
// @ts-expect-error an aggregate is one of sum, avg, min, max, count
export const unknownKind: ColumnMap = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true, aggregate: "median" } });
export const error = new QueryError("unknown-column", ["spec", 0]);
