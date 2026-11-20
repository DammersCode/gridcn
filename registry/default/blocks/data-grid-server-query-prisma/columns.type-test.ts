import { definePrismaColumnMap } from "./columns";

// The shapes of a generated `Prisma.UserScalarFieldEnum` and `User`.
const UserScalarFieldEnum = { id: "id", name: "name" } as const;
type User = { id: number; name: string | null };
const defineUserColumns = definePrismaColumnMap<User>();

defineUserColumns(UserScalarFieldEnum, { id: { type: "number", numeric: "int4", primaryKey: true }, label: { type: "text", field: "name", nullable: true } });

// @ts-expect-error a column id the model lacks needs a `field`
defineUserColumns(UserScalarFieldEnum, { id: { type: "number", numeric: "int4", primaryKey: true }, nick: { type: "text", nullable: true } });

// @ts-expect-error a `field` the model lacks
defineUserColumns(UserScalarFieldEnum, { id: { type: "number", numeric: "int4", primaryKey: true }, label: { type: "text", field: "nick", nullable: true } });

// @ts-expect-error a field whose model type admits null needs `nullable: true`
defineUserColumns(UserScalarFieldEnum, { id: { type: "number", numeric: "int4", primaryKey: true }, name: { type: "text", required: true } });

// @ts-expect-error a field whose model type is never null takes no `nullable: true`
defineUserColumns(UserScalarFieldEnum, { id: { type: "number", numeric: "int4", primaryKey: true, nullable: true }, name: { type: "text", nullable: true } });
