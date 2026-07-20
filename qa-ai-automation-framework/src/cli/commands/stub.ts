/** Placeholder action for commands whose build phase hasn't landed yet (plan §9). */
export function notImplemented(commandName: string, phase: number): void {
  console.error(
    `qa-ai ${commandName}: not implemented yet — arrives in Phase ${phase} of the build plan.`,
  );
  process.exitCode = 1;
}
