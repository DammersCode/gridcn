/** Where the server answer of a grouped request differs from the grid's own `buildGroupView`, and why. */
export const KNOWN_DIFFERENCES = {
  textOrder: { name: "text group order follows the database collation", because: "the client orders text keys with a locale collator, the database with its collation; keys are compared as sets" },
  sqliteDecimalKey: { name: "sqlite decimal keys lose trailing zeros", because: "a NUMERIC column stores 12.50 as the number 12.5, so the key is \"12.5\" where the client holds \"12.50\"; PostgreSQL keeps the scale" },
  reducerOnNonNumbers: { name: "min and max reduce text and instants", because: "the client reducers read finite numbers only, so they answer null for a decimal string or an instant; the database answers the value" },
} as const;
