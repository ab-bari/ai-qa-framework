import { QaError } from "../core/errors.js";

/** Print `code: message -> remediation` (stack only with --verbose) and set the exit code. */
export function handleFatalError(error: unknown, verbose: boolean): void {
  if (error instanceof QaError) {
    console.error(`${error.code}: ${error.message}`);
    if (error.remediation !== undefined) {
      console.error(`  -> ${error.remediation}`);
    }
    if (verbose && error.stack !== undefined) {
      console.error(`\n${error.stack}`);
    }
    process.exitCode = error.exitCode;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`INTERNAL_ERROR: ${message}`);
  if (verbose && error instanceof Error && error.stack !== undefined) {
    console.error(`\n${error.stack}`);
  }
  process.exitCode = 1;
}
