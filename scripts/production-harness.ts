#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const nextBin = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);

function run(command: string, args: string[], env = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a loopback port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForServer(baseURL: string, child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}`);
    try {
      const response = await fetch(baseURL, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the production server");
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertJsonStatus(
  response: Response,
  status: number,
  message: string,
) {
  invariant(response.status === status, `${message}: expected ${status}, received ${response.status}`);
  invariant(response.headers.get("content-type")?.includes("application/json"), `${message}: expected JSON`);
  return (await response.json()) as { error?: string };
}

async function exerciseProduction(baseURL: string) {
  const home = await fetch(baseURL);
  invariant(home.status === 200, `homepage returned ${home.status}`);
  invariant((await home.text()).includes("FitLens"), "homepage did not contain the product name");
  invariant(home.headers.get("x-frame-options") === "DENY", "production frame policy is missing");
  invariant(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "production CSP is missing");

  const example = await fetch(`${baseURL}/examples/cmux-vs-otty`);
  invariant(example.status === 200, `example route returned ${example.status}`);

  const crossOrigin = await fetch(`${baseURL}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: "{}",
  });
  await assertJsonStatus(crossOrigin, 403, "cross-origin guard");
  invariant(!crossOrigin.headers.has("access-control-allow-origin"), "cross-origin response unexpectedly enables CORS");

  const invalidMedia = await fetch(`${baseURL}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: baseURL },
    body: "{}",
  });
  await assertJsonStatus(invalidMedia, 415, "content-type guard");

  const noCredentials = await fetch(`${baseURL}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL },
    body: JSON.stringify({
      urls: ["https://one.example/", "https://two.example/"],
      context: "A hermetic production artifact verification request.",
      criteria: [
        { key: "fit", label: "Fit", hint: "Workflow fit", weight: 80 },
        { key: "risk", label: "Risk", hint: "Operational risk", weight: 70 },
      ],
      locale: "en",
    }),
  });
  const noCredentialsBody = await assertJsonStatus(noCredentials, 503, "credential boundary");
  invariant(noCredentialsBody.error?.toLowerCase().includes("api key"), "credential boundary returned an unsafe or unexpected error");
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) {
    child.stdout?.destroy();
    child.stderr?.destroy();
    return;
  }
  const signal = (name: NodeJS.Signals) => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, name);
        return;
      } catch {
        // Fall back to the direct child if the process group has already gone.
      }
    }
    child.kill(name);
  };
  signal("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) signal("SIGKILL");
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

async function main() {
  process.stdout.write("Building the production artifact...\n");
  await run(process.execPath, [nextBin, "build"]);

  const port = await availablePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FITLENS_DISABLE_LIVE_ANALYSIS: "1",
    NODE_ENV: "production",
  };
  delete env.OPENAI_API_KEY;
  delete env.FITLENS_MODEL_API_KEY;
  delete env.FITLENS_MODEL_BASE_URL;
  delete env.FITLENS_MODEL_MODEL;
  delete env.FITLENS_MODEL_PROVIDER;

  const server: ChildProcess = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  let serverLog = "";
  const collectLog = (chunk: Buffer) => {
    serverLog = `${serverLog}${chunk.toString("utf8")}`.slice(-8_000);
  };
  server.stdout?.on("data", collectLog);
  server.stderr?.on("data", collectLog);

  try {
    await waitForServer(baseURL, server);
    await exerciseProduction(baseURL);
    process.stdout.write("Production harness passed: built artifact, pages, headers, and guarded analysis route.\n");
  } catch (error) {
    if (serverLog) process.stderr.write(`\nnext start output:\n${serverLog}\n`);
    throw error;
  } finally {
    await stop(server);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Production harness failed"}\n`);
  process.exitCode = 1;
});
