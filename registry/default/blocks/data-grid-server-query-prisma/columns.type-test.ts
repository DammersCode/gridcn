import { definePrismaColumnMap } from "./columns";

// The shape of a generated `Prisma.UserScalarFieldEnum`.
const UserScalarFieldEnum = { id: "id", name: "name" } as const;

definePrismaColumnMap(UserScalarFieldEnum, { id: { type: "number", numeric: "int4", primaryKey: true }, label: { type: "text", field: "name" } });

// @ts-expect-error a column id the model lacks needs a `field`
definePrismaColumnMap(UserScalarFieldEnum, { id: { type: "number", numeric: "int4", primaryKey: true }, nick: { type: "text" } });

// @ts-expect-error a `field` the model lacks
definePrismaColumnMap(UserScalarFieldEnum, { id: { type: "number", numeric: "int4", primaryKey: true }, label: { type: "text", field: "nick" } });
