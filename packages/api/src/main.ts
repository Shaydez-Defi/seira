import "dotenv/config";
import { startServer } from "./server";

const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;

function resolvePort(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_PORT) {
    throw new Error(`invalid PORT "${raw}": expected an integer between 0 and ${MAX_PORT}`);
  }
  return parsed;
}

startServer(resolvePort(process.env.PORT));
