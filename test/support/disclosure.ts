// JSON snapshots drop symbol values and keys, so a leaked scope, revision or id is looked for directly.
export const holdsSymbol = (value: unknown): boolean => typeof value === "symbol"
  || (value !== null && typeof value === "object" && (Object.getOwnPropertySymbols(value).length > 0 || Object.values(value).some(holdsSymbol)));
