import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJsonPath = resolve(import.meta.dirname, "..", "..", "package.json");

let packageMetadata;

export function readPackageMetadata() {
  packageMetadata ??= JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return packageMetadata;
}

export function formatPackageVersion() {
  const metadata = readPackageMetadata();
  return `${metadata.name} ${metadata.version}`;
}
