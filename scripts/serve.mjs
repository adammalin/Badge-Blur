import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { dirname, extname, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createMetadataSidecar,
  cropPreview,
  decodePreview,
  detectColorBadgeCandidates,
  fitMaskCorners,
  redactImage,
} from "./image-runtime.mjs";

const host = "127.0.0.1";
const port = Number(process.env.BADGE_REMOVER_PORT || 4173);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..", "dist");
const packageRoot = resolve(scriptDirectory, "..");
const appVersion = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
).version;
const apiVersion = 5;
const lifecycleToken = randomBytes(32).toString("hex");
const launcherParentPid = positiveInteger(
  process.env.BADGE_REMOVER_PARENT_PID,
);
const pidFile = process.env.BADGE_REMOVER_PID_FILE || "";
let activeServer = null;
let parentWatch = null;
let shutdownStarted = false;

if (!existsSync(root)) {
  console.error(`The packaged app is missing: ${root}`);
  process.exitCode = 1;
} else {
  const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".onnx": "application/octet-stream",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
  };

  activeServer = createServer(async (request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);

    if (request.method === "GET" && requestPath === "/api/status") {
      sendJson(response, {
        appVersion,
        apiVersion,
        localOnly: true,
        lifecycleToken,
        launcherParentPid,
        processId: process.pid,
      });
      return;
    }

    if (request.method === "POST" && requestPath === "/api/shutdown") {
      const suppliedToken = String(
        request.headers["x-badge-lifecycle-token"] || "",
      );
      if (!tokensMatch(suppliedToken, lifecycleToken)) {
        sendJson(response, { error: "Shutdown authorization failed." }, 403);
        return;
      }
      sendJson(response, { shuttingDown: true });
      process.parentPort?.postMessage({
        type: "badge-blur-shutdown-requested",
      });
      setImmediate(() => requestShutdown("user request"));
      return;
    }

    if (request.method === "POST" && requestPath.startsWith("/api/image/")) {
      try {
        const sourceName = decodeRequestHeader(request.headers["x-badge-source-name"]);
        const source = await readRequestBody(request);
        if (requestPath === "/api/image/decode") {
          const result = await decodePreview(source, sourceName);
          sendBinary(response, result.preview, "image/jpeg", result.info);
          return;
        }
        if (requestPath === "/api/image/crop") {
          const options = JSON.parse(
            decodeRequestHeader(request.headers["x-badge-options"]) || "{}",
          );
          const result = await cropPreview(source, sourceName, options);
          sendBinary(response, result.image, "image/jpeg", result.info);
          return;
        }
        if (requestPath === "/api/image/redact") {
          const options = JSON.parse(
            decodeRequestHeader(request.headers["x-badge-options"]) || "{}",
          );
          const result = await redactImage(source, sourceName, options);
          sendBinary(
            response,
            result.image,
            result.info.outputMimeType,
            result.info,
          );
          return;
        }
        if (requestPath === "/api/image/fit-mask") {
          const options = JSON.parse(
            decodeRequestHeader(request.headers["x-badge-options"]) || "{}",
          );
          const result = await fitMaskCorners(source, sourceName, options);
          sendJson(response, result);
          return;
        }
        if (requestPath === "/api/image/color-badges") {
          const result = await detectColorBadgeCandidates(source, sourceName);
          sendJson(response, result);
          return;
        }
        if (requestPath === "/api/image/metadata") {
          const sidecar = await createMetadataSidecar(source, sourceName);
          sendBinary(response, sidecar, "application/octet-stream");
          return;
        }
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Image-processing route not found." }));
      } catch (error) {
        console.warn(`Image request rejected: ${error.message}`);
        response.writeHead(422, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    if (requestPath.startsWith("/api/")) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Local API route not found." }));
      return;
    }

    const relative = normalize(requestPath).replace(/^[/\\]+/, "");
    let filePath = resolve(root, relative || "index.html");

    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = resolve(root, "index.html");
    }

    response.setHeader("Content-Type", mimeTypes[extname(filePath)] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    createReadStream(filePath).pipe(response);
  });

  activeServer.listen(port, host, () => {
    const address = activeServer.address();
    const activePort = typeof address === "object" && address ? address.port : port;
    const url = `http://${host}:${activePort}/`;
    writePidFile();
    console.log(`Badge Blur: ${url}`);

    if (process.env.BADGE_REMOVER_OPEN_BROWSER === "1") {
      openBrowser(url);
    }
  });

  activeServer.on("error", (error) => {
    console.error(`Badge Blur local server failed: ${error.message}`);
    removePidFile();
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => requestShutdown(signal));
  }

  if (launcherParentPid) {
    parentWatch = setInterval(() => {
      if (!processIsAlive(launcherParentPid)) {
        requestShutdown("launcher exited");
      }
    }, 750);
  }

  process.once("exit", removePidFile);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function tokensMatch(supplied, expected) {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function writePidFile() {
  if (!pidFile) return;
  try {
    writeFileSync(pidFile, `${process.pid}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    console.warn(`Could not write lifecycle PID file: ${error.message}`);
  }
}

function removePidFile() {
  if (!pidFile || !existsSync(pidFile)) return;
  try {
    const recordedPid = positiveInteger(readFileSync(pidFile, "utf8").trim());
    if (recordedPid === process.pid) {
      unlinkSync(pidFile);
    }
  } catch {
    // A later launcher owns or has already removed the lifecycle file.
  }
}

function requestShutdown(reason) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  if (parentWatch) {
    clearInterval(parentWatch);
    parentWatch = null;
  }
  console.log(`Badge Blur shutting down: ${reason}`);

  if (!activeServer?.listening) {
    removePidFile();
    process.exit(0);
    return;
  }

  activeServer.close(() => {
    removePidFile();
    process.exit(0);
  });

  const forcedExit = setTimeout(() => {
    removePidFile();
    process.exit(0);
  }, 3000);
  forcedExit.unref();
}

function decodeRequestHeader(value) {
  if (!value) return "";
  return Buffer.from(String(value), "base64url").toString("utf8");
}

function readRequestBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024 * 1024) {
        reject(new Error("Request exceeds the 1 GB per-file safety limit."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendBinary(response, data, contentType, info) {
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", data.length);
  response.setHeader("Cache-Control", "no-store");
  if (info) {
    response.setHeader(
      "X-Badge-Image-Info",
      Buffer.from(JSON.stringify(info)).toString("base64url"),
    );
  }
  response.writeHead(200);
  response.end(data);
}

function sendJson(response, value, status = 200) {
  const data = Buffer.from(JSON.stringify(value));
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Content-Length", data.length);
  response.setHeader("Cache-Control", "no-store");
  response.writeHead(status);
  response.end(data);
}

function openBrowser(url) {
  if (
    process.platform === "win32" &&
    process.env.BADGE_REMOVER_PREFERRED_BROWSER === "edge"
  ) {
    const child = spawn("cmd.exe", ["/c", "start", "", "msedge.exe", url], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      console.warn(`Could not open Microsoft Edge automatically. Open: ${url}`);
    });
    child.unref();
    return;
  }

  const platformCommands = {
    darwin: ["open", [url]],
    linux: ["xdg-open", [url]],
    win32: ["cmd.exe", ["/c", "start", "", url]],
  };
  const command = platformCommands[process.platform];

  if (!command) {
    console.warn(`Open this address in a browser: ${url}`);
    return;
  }

  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {
    console.warn(`Could not open the browser automatically. Open: ${url}`);
  });
  child.unref();
}
