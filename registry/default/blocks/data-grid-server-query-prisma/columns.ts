import { type ColumnMap, type ColumnMapOptions, type ColumnSpec, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";

/** Column specs whose `field` (or id, when `field` is absent) names a scalar field of the model. */
export type PrismaColumnSpecs<Field extends string, C> = { [K in keyof C]: ColumnSpec & (K extends Field ? { field?: Field } : { field: Field }) };

/**
 * Validates a hand-written column map against a model's scalar fields, such as `Prisma.UserScalarFieldEnum`: a column id
 * or `field` the model lacks fails to compile and throws. Set `required` on every field the schema declares without `?`.
 *
 * @example
 * const columns = definePrismaColumnMap(Prisma.UserScalarFieldEnum, {
 *   id: { type: "number", numeric: "int4", primaryKey: true },
 *   displayName: { type: "text", field: "name", searchable: true },
 * });
 */
export function definePrismaColumnMap<const F extends Readonly<Record<string, string>>, const C extends Record<string, ColumnSpec>>(
  fields: F,
  columns: C & PrismaColumnSpecs<F[keyof F], C>,
  options: ColumnMapOptions<keyof C & string> = {},
): ColumnMap<keyof C & string> {
  const known = new Set<string>(Object.values(fields));
  for (const id of Object.keys(columns)) {
    const name = columns[id]!.field ?? id;
    if (!known.has(name)) throw new Error(`definePrismaColumnMap: column "${id}" names the field "${name}", which the model's scalar fields lack`);
  }
  return defineColumnMap(columns, options);
}
