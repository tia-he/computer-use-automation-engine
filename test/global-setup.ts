import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import { MOCK_BANK_PORT, MOCK_BANK_URL } from "../src/test-support/mock-bank";

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`mock-bank did not become ready at ${url} within ${timeoutMs}ms`);
}

export default async function setup() {
  const cwd = path.resolve(__dirname, "../apps/mock-bank");
  const child: ChildProcess = spawn("npm", ["run", "start"], {
    cwd,
    env: { ...process.env, PORT: MOCK_BANK_PORT },
    stdio: "ignore",
  });

  await waitForServer(`${MOCK_BANK_URL}/`, 15000);

  return async () => {
    child.kill();
  };
}
