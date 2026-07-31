const assert = require("node:assert/strict");
const {
  installLocalOnlyNetworkPolicy,
  isAllowedAppRequest,
} = require("../electron/network-policy.cjs");

for (const value of [
  "http://127.0.0.1:4173/api/status",
  "http://localhost:4173/",
  "http://[::1]:4173/",
  "ws://127.0.0.1:4173/",
  "blob:http://127.0.0.1:4173/example",
  "data:image/png;base64,AA==",
]) {
  assert.equal(isAllowedAppRequest(value), true, `${value} should be allowed`);
}

for (const value of [
  "https://example.com/upload",
  "http://192.168.1.25/",
  "https://huggingface.co/model",
  "wss://example.com/socket",
  "ftp://example.com/file",
  "not a URL",
]) {
  assert.equal(isAllowedAppRequest(value), false, `${value} should be blocked`);
}

let requestFilter = null;
installLocalOnlyNetworkPolicy({
  webRequest: {
    onBeforeRequest(callback) {
      requestFilter = callback;
    },
  },
});
assert.equal(typeof requestFilter, "function");

function decision(url) {
  let result = null;
  requestFilter({ url }, (value) => {
    result = value;
  });
  return result;
}

assert.deepEqual(decision("http://127.0.0.1:4173/api/status"), {
  cancel: false,
});
assert.deepEqual(decision("https://example.com/upload"), { cancel: true });

console.log(
  JSON.stringify({
    localRequestsAllowed: true,
    remoteHttpBlocked: true,
    remoteWebSocketsBlocked: true,
    privateLanBlocked: true,
  }),
);
