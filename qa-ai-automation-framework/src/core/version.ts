import { createRequire } from "node:module";

// Works from both src/ (tsx) and dist/ (build) — each sits one level below
// the package root, so ../../package.json resolves to the same file.
const require = createRequire(import.meta.url);

interface PackageJson {
  name: string;
  version: string;
}

export function getPackageInfo(): PackageJson {
  return require("../../package.json") as PackageJson;
}

export function generatedByStamp(): string {
  const pkg = getPackageInfo();
  return `qa-ai@${pkg.version}`;
}
