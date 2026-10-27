import { spawn } from "node:child_process";
import process from "node:process";

const services = [
  { name: "API Server", filter: "@workspace/api-server", port: "8080" },
  { name: "Robot Control", filter: "@workspace/robot-control", port: "5000" },
];

const children = [];
let stopping = false;
let stopPromise;

function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.error(`Could not signal ${child.spawnargs.join(" ")}:`, error);
    }
  }
}

function stop(exitCode) {
  if (stopPromise) return stopPromise;
  stopping = true;
  stopPromise = (async () => {
    const closed = children.map((child) =>
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("close", resolve)),
    );
    for (const child of children) signalGroup(child, "SIGTERM");
    const forceKill = setTimeout(() => {
      for (const child of children) signalGroup(child, "SIGKILL");
    }, 8_000);
    forceKill.unref();
    await Promise.all(closed);
    clearTimeout(forceKill);
    process.exitCode = exitCode;
  })();
  return stopPromise;
}

process.once("SIGINT", () => void stop(130));
process.once("SIGTERM", () => void stop(143));

for (const service of services) {
  const child = spawn(
    "pnpm",
    ["--filter", service.filter, "run", "dev"],
    {
      env: { ...process.env, PORT: service.port },
      stdio: "inherit",
      detached: true,
    },
  );
  children.push(child);
  child.once("spawn", () => {
    console.log(`${service.name} starting on port ${service.port}`);
    if (stopping) signalGroup(child, "SIGTERM");
  });
  child.once("error", (error) => {
    console.error(`${service.name} could not start:`, error);
    void stop(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `${service.name} exited unexpectedly (${signal ?? code ?? "unknown"})`,
      );
      void stop(code && code > 0 ? code : 1);
    }
  });
}
