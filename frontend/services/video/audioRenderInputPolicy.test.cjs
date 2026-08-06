/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { assertAuthoritativeNarrationSize } = require("./audioRenderInputPolicy.server.ts");

test("production render boundary requires downloaded bytes to match authoritative audio size", () => {
  assert.doesNotThrow(() => assertAuthoritativeNarrationSize(new Uint8Array(4), 4));
  for (const authoritativeSize of [null, 0, 3, 5]) {
    assert.throws(() => assertAuthoritativeNarrationSize(new Uint8Array(4), authoritativeSize), (error) => {
      assert.equal(error.code, "invalid_audio");
      assert.equal(error.retryable, false);
      return true;
    });
  }
});
