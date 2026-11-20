import { type ColumnMap, type ColumnMapOptions, type ColumnSpec, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";

/** A column spec of a Prisma model: `nullable` mirrors the schema's `?` on the field. */
export type PrismaColumnSpec = ColumnSpec & { nullable?: boolean };

type FieldOf<K, S> = S extends { field: infer F extends string } ? F : K;
type Nullability<M, F> = F extends keyof M ? (null extends M[F] ? { nullable: true } : { nullable?: false }) : unknown;

/**
 * Column specs whose `field` (or id, when `field` is absent) names a scalar field of the model, with `nullable: true`
 * exactly on the fields whose model type admits `null`.
 */
export type PrismaColumnSpecs<M, Field extends string, C> = {
  [K in keyof C]: PrismaColumnSpec & (K extends Field ? { field?: Field } : { field: Field }) & Nullability<M, FieldOf<K, C[K]>>;
};

const nullableIds = new WeakMap<ColumnMap, ReadonlySet<string>>();

/**
 * Validates a hand-written column map against a model, such as `User`, and its scalar fields, such as
 * `Prisma.UserScalarFieldEnum`: a column id or `field` the model lacks fails to compile and throws, and a column
 * whose `nullable` disagrees with the model type fails to compile. `required` only refuses blank writes.
 *
 * @example
 * const columns = definePrismaColumnMap<User>()(Prisma.UserScalarFieldEnum, {
 *   id: { type: "number", numeric: "int4", primaryKey: true },
 *   displayName: { type: "text", field: "name", searchable: true, nullable: true },
 * });
 */
export function definePrismaColumnMap<M extends object>() {
  return <const F extends Readonly<Record<string, string>>, const C extends Record<string, PrismaColumnSpec>>(
    fields: F,
    columns: C & PrismaColumnSpecs<M, F[keyof F], C>,
    options: ColumnMapOptions<keyof C & string> = {},
  ): ColumnMap<keyof C & string> => {
    const known = new Set<string>(Object.values(fields));
    for (const id of Object.keys(columns)) {
      const name = columns[id]!.field ?? id;
      if (!known.has(name)) throw new Error(`definePrismaColumnMap: column "${id}" names the field "${name}", which the model's scalar fields lack`);
    }
    const map = defineColumnMap(columns, options);
    nullableIds.set(map, new Set(Object.keys(columns).filter((id) => columns[id]!.nullable === true)));
    return map;
  };
}

/** The ids of the columns a map from {@link definePrismaColumnMap} marks `nullable`; any other map throws. */
export function nullableColumnIds(map: ColumnMap): ReadonlySet<string> {
  const ids = nullableIds.get(map);
  if (!ids) throw new Error("createPrismaGridQuery: `columns` must come from definePrismaColumnMap, which records the nullable fields");
  return ids;
}
