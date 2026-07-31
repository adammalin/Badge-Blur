import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [server, worker, page, electronMain] = await Promise.all([
  readFile(new URL("./serve.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/model-inference-worker.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../electron/main.cjs", import.meta.url), "utf8"),
]);

assert.match(server, /const host = "127\.0\.0\.1";/);
assert.doesNotMatch(server, /listen\([^\n]*0\.0\.0\.0/);
assert.match(worker, /env\.allowRemoteModels = false;/);
assert.match(worker, /env\.allowLocalModels = true;/);
assert.match(page, /connect-src 'self' blob:/);
assert.match(electronMain, /installLocalOnlyNetworkPolicy\(session\.defaultSession\)/);

console.log(
  JSON.stringify({
    loopbackBindingPinned: true,
    remoteModelsDisabled: true,
    sameOriginConnectionPolicy: true,
    electronRemoteRequestsDenied: true,
  }),
);
