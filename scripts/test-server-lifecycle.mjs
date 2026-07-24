import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const serverScript = path.join(projectRoot, "scripts", "serve.mjs");
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "badge-blur-lifecycle-test-"),
);
const pidFile = path.join(temporaryRoot, "server.pid");
const children = new Set();

try {
  const first = await startServer({
    parentPid: process.pid,
    pidFile,
  });
  const firstStatus = await readStatus(first.url);
  assert(firstStatus.localOnly === true, "Server did not report local-only mode.");
  assert(
    typeof firstStatus.lifecycleToken === "string" &&
      firstStatus.lifecycleToken.length >= 32,
    "Server did not return a lifecycle token.",
  );
  assert(
    firstStatus.processId === first.child.pid,
    "Status process ID did not match the server process.",
  );

  const rejected = await fetch(`${first.url}api/shutdown`, {
    method: "POST",
    headers: {
      "X-Badge-Lifecycle-Token": "invalid-token",
    },
  });
  assert(rejected.status === 403, "Invalid shutdown token was not rejected.");
  await readStatus(first.url);

  const firstPort = Number(new URL(first.url).port);
  await requestShutdown(first.url, firstStatus.lifecycleToken);
  const firstExit = await waitForExit(first.child, 5000);
  assert(
    firstExit.code === 0 && firstExit.signal === null,
    `Graceful shutdown exited unexpectedly: ${JSON.stringify(firstExit)}`,
  );
  assert(
    await waitForPortClosed(firstPort, 3000),
    "Graceful shutdown did not release the local port.",
  );

  const second = await startServer({
    parentPid: process.pid,
    pidFile,
    port: firstPort,
  });
  const secondStatus = await readStatus(second.url);
  assert(
    second.child.pid !== first.child.pid,
    "Relaunch reused the old server process.",
  );
  assert(
    secondStatus.lifecycleToken !== firstStatus.lifecycleToken,
    "Relaunch reused the old lifecycle token.",
  );
  second.child.kill("SIGTERM");
  const secondExit = await waitForExit(second.child, 5000);
  const expectedSignalExit =
    process.platform === "win32"
      ? secondExit.code === null && secondExit.signal === "SIGTERM"
      : secondExit.code === 0 && secondExit.signal === null;
  assert(
    expectedSignalExit,
    `Signal shutdown exited unexpectedly: ${JSON.stringify(secondExit)}`,
  );
  assert(
    await waitForPortClosed(firstPort, 3000),
    "Signal shutdown did not release the local port.",
  );

  const orphan = await startServer({
    parentPid: 2147483000,
    pidFile,
  });
  const orphanPort = Number(new URL(orphan.url).port);
  const orphanExit = await waitForExit(orphan.child, 5000);
  assert(
    orphanExit.code === 0 && orphanExit.signal === null,
    `Parent watchdog exited unexpectedly: ${JSON.stringify(orphanExit)}`,
  );
  assert(
    await waitForPortClosed(orphanPort, 3000),
    "Parent watchdog did not release the orphaned server port.",
  );

  console.log(
    JSON.stringify({
      passed: true,
      authenticatedShutdown: true,
      invalidTokenRejected: true,
      cleanRelaunch: true,
      signalShutdown: true,
      parentWatchdog: true,
      releasedPort: firstPort,
    }),
  );
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

function startServer({ parentPid, pidFile: lifecyclePidFile, port = 0 }) {
  return new Promise((resolveStart, rejectStart) => {
    const child = spawn(process.execPath, [serverScript], {
      cwd: projectRoot,
      env: {
        ...process.env,
        BADGE_REMOVER_OPEN_BROWSER: "0",
        BADGE_REMOVER_PARENT_PID: String(parentPid),
        BADGE_REMOVER_PID_FILE: lifecyclePidFile,
        BADGE_REMOVER_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      rejectStart(
        new Error(`Server did not become ready.\nstdout: ${stdout}\nstderr: ${stderr}`),
      );
    }, 10000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/Badge Blur: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (!match) return;
      clearTimeout(timeout);
      resolveStart({ child, url: match[1] });
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      clearTimeout(timeout);
      if (!stdout.includes("Badge Blur:")) {
        rejectStart(
          new Error(
            `Server exited before readiness (${code || signal}).\n${stderr}`,
          ),
        );
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectStart(error);
    });
  });
}

async function readStatus(url) {
  const response = await fetch(`${url}api/status`, { cache: "no-store" });
  assert(response.ok, `Status request failed (${response.status}).`);
  return response.json();
}

async function requestShutdown(url, token) {
  const response = await fetch(`${url}api/shutdown`, {
    method: "POST",
    headers: {
      "X-Badge-Lifecycle-Token": token,
    },
  });
  const detail = await response.json();
  assert(
    response.ok && detail.shuttingDown === true,
    `Shutdown request failed (${response.status}).`,
  );
}

function waitForExit(child, timeoutMilliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
    });
  }
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      rejectExit(new Error("Server did not exit before the lifecycle timeout."));
    }, timeoutMilliseconds);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });
}

async function waitForPortClosed(port, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (!(await portIsOpen(port))) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return !(await portIsOpen(port));
}

function portIsOpen(port) {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port,
    });
    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolvePort(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolvePort(false);
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
