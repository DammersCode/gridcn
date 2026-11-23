import type { ServerRowsPageRequest } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import type { ServerFetchAnswer } from "@/registry/default/blocks/data-grid-server/read-answer";
import { type GridQuery, type RowsAnswer, defineColumnMap } from "./data-grid-server-query";
import { type QueryExecutor, createGridQuery } from "./data-grid-server-query-sdk";

type Row = { id: number };
declare const executor: QueryExecutor<unknown, unknown>;
const columns = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true } });

// the 2.0 generic arities compile unchanged: no cursor argument, no `paging` option
export const released: GridQuery<Row> = createGridQuery<Row>({ columns, executor });
export const releasedWithAll: GridQuery<Row, { tenantId: number }, unknown, unknown> = createGridQuery<Row, { tenantId: number }>({ columns, executor });
export const releasedAnswer: RowsAnswer<Row> = { rows: [], totalRowCount: 1, hasMore: false };
export const releasedRoute = async ({ signal, ...request }: ServerRowsPageRequest): Promise<ServerFetchAnswer<Row>> => released.fetchRows(request, { signal });
