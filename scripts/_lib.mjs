// Shared helpers for the registry verify/check scripts.

/** True when the file name is a test or test-helper source (.test, .browser.test, .type-test, .test-helper, .bench + extension). */
export function isTestFile(name) {
  return /\.(test|browser\.test|type-test|test-helper|bench)\.[^./]+$/.test(name);
}

/** A registry.json dependency entry without its optional `@version` pin ("hucre@1.1.0" -> "hucre", "@scope/pkg@1.2.3" -> "@scope/pkg"). */
export function dependencyName(dep) {
  return dep.replace(/(?<=.)@[^@/]*$/, "");
}

/** The npm package name of an import specifier ("@scope/pkg/sub" -> "@scope/pkg", "react/jsx-runtime" -> "react"). */
export function npmPackageName(specifier) {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}
