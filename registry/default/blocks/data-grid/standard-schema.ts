/**
 * Vendored from `@standard-schema/spec` v1 (https://github.com/standard-schema/standard-schema) so
 * shipped registry code has zero runtime/type dependency on the package — the spec is
 * frozen at version 1, so drift risk is ~nil; a type-level conformance test (data-grid.type-test.ts)
 * asserts this vendored copy stays assignable to/from the real package's type in both directions,
 * so any future drift fails `tsc` instead of silently diverging. `@standard-schema/spec` is still a
 * repo devDependency (types-only, for that conformance test) — never imported by shipped code.
 */
export type StandardSchemaV1<Input = unknown, Output = Input> = {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1Props<Input, Output>;
};

interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  /** The version number of the standard. */
  readonly version: 1;
  /** The vendor name of the schema library. */
  readonly vendor: string;
  /** Validates unknown input values. */
  readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
  /** Inferred types associated with the schema. */
  readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
}

/** Result of one `"~standard".validate()` call: `issues` set means failure, never thrown. */
export type StandardSchemaV1Result<Output> = StandardSchemaV1SuccessResult<Output> | StandardSchemaV1FailureResult;

interface StandardSchemaV1SuccessResult<Output> {
  /** The typed output value. */
  readonly value: Output;
  /** A falsy value for `issues` indicates success. */
  readonly issues?: undefined;
}

interface StandardSchemaV1FailureResult {
  /** The issues of failed validation. */
  readonly issues: ReadonlyArray<StandardSchemaV1Issue>;
}

/** One validation failure; cell values are scalars so `path` (when present) is a flat dot-joined prefix. */
export interface StandardSchemaV1Issue {
  /** The error message of the issue. */
  readonly message: string;
  /** The path of the issue, if any. */
  readonly path?: ReadonlyArray<PropertyKey | StandardSchemaV1PathSegment> | undefined;
}

interface StandardSchemaV1PathSegment {
  /** The key representing a path segment. */
  readonly key: PropertyKey;
}

interface StandardSchemaV1Types<Input = unknown, Output = Input> {
  /** The input type of the schema. */
  readonly input: Input;
  /** The output type of the schema. */
  readonly output: Output;
}

// Namespace-merged onto the `StandardSchemaV1` type (matching the official package's own
// declaration, and how consumers write `StandardSchemaV1.InferInput<S>`) — not a general-purpose
// namespace, so the lint rule's usual "prefer ES modules" concern doesn't apply here.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StandardSchemaV1 {
  /** Infers the input type of a Standard Schema. */
  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["input"];
  /** Infers the output type of a Standard Schema. */
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"];
}
