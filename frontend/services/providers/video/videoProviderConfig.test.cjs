/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { getVideoProviderConfiguration } = require("./videoProviderConfig.server.ts");

const keys = [
  "NODE_ENV", "CREATOROS_VIDEO_PROVIDER", "CREATOROS_VIDEO_MODEL",
  "CREATOROS_VIDEO_FALLBACK_PROVIDER", "CREATOROS_VIDEO_REQUEST_TIMEOUT_MS",
  "CREATOROS_VIDEO_ACTIVE_LEASE_MS", "CREATOROS_VIDEO_HEARTBEAT_MS",
];

function configured(overrides, action) {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test", CREATOROS_VIDEO_PROVIDER: "disabled", CREATOROS_VIDEO_MODEL: "disabled",
    CREATOROS_VIDEO_FALLBACK_PROVIDER: "none", CREATOROS_VIDEO_REQUEST_TIMEOUT_MS: "240000",
    CREATOROS_VIDEO_ACTIVE_LEASE_MS: "30000", CREATOROS_VIDEO_HEARTBEAT_MS: "5000",
    ...overrides,
  });
  try { return action(); }
  finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("lease and heartbeat settings are bounded and lease exceeds heartbeat", () => {
  const result = configured({}, getVideoProviderConfiguration);
  assert.equal(result.activeLeaseMs, 30_000);
  assert.equal(result.heartbeatMs, 5_000);
  configured({ CREATOROS_VIDEO_ACTIVE_LEASE_MS: "14999" }, () => assert.throws(getVideoProviderConfiguration, /ACTIVE_LEASE_MS/));
  configured({ CREATOROS_VIDEO_HEARTBEAT_MS: "30000", CREATOROS_VIDEO_ACTIVE_LEASE_MS: "30000" }, () => assert.throws(getVideoProviderConfiguration, /three heartbeat intervals/));
});

test("mock renderer remains forbidden in production configuration", () => {
  configured({ NODE_ENV: "production", CREATOROS_VIDEO_PROVIDER: "mock", CREATOROS_VIDEO_MODEL: "mock-render-v1" },
    () => assert.throws(getVideoProviderConfiguration, /unavailable in production/));
});
