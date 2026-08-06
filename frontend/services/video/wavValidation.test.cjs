/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { assemblePcmChunksToWav } = require("../audio/wavAssembly.server.ts");
const { validateCreatorOsWav, WAV_DURATION_TOLERANCE_MS } = require("./wavValidation.server.ts");

function wav(milliseconds = 100) {
  return assemblePcmChunksToWav([new Uint8Array(48 * milliseconds)]);
}

test("accepts the canonical CreatorOS 24 kHz mono 16-bit PCM WAV", () => {
  const assembled = wav(100);
  assert.deepEqual(validateCreatorOsWav(assembled.wavBytes, assembled.durationMs), {
    durationMs: 100,
    durationCeilingMs: 100,
    sampleFrameCount: 2_400,
    sampleRate: 24_000,
    channels: 1,
    bitsPerSample: 16,
    dataSizeBytes: 4_800,
  });
});

test("rejects malformed, truncated, duplicate, empty, and incompatible WAV data", () => {
  const canonical = wav().wavBytes;
  assert.throws(() => validateCreatorOsWav(new Uint8Array([82, 73, 70, 70])), /valid CreatorOS WAV/);

  const wrongRate = canonical.slice();
  new DataView(wrongRate.buffer).setUint32(24, 44_100, true);
  assert.throws(() => validateCreatorOsWav(wrongRate), /valid CreatorOS WAV/);

  const unsupportedEncoding = canonical.slice();
  new DataView(unsupportedEncoding.buffer).setUint16(20, 3, true);
  assert.throws(() => validateCreatorOsWav(unsupportedEncoding), /valid CreatorOS WAV/);

  const invalidChunkSize = canonical.slice();
  new DataView(invalidChunkSize.buffer).setUint32(40, canonical.byteLength, true);
  assert.throws(() => validateCreatorOsWav(invalidChunkSize), /valid CreatorOS WAV/);

  const truncated = canonical.slice(0, -2);
  assert.throws(() => validateCreatorOsWav(truncated), /valid CreatorOS WAV/);

  const empty = wav().wavBytes.slice(0, 44);
  new DataView(empty.buffer).setUint32(4, 36, true);
  new DataView(empty.buffer).setUint32(40, 0, true);
  assert.throws(() => validateCreatorOsWav(empty), /valid CreatorOS WAV/);

  const missingData = canonical.slice(0, 36);
  new DataView(missingData.buffer).setUint32(4, missingData.byteLength - 8, true);
  assert.throws(() => validateCreatorOsWav(missingData), /valid CreatorOS WAV/);

  const duplicate = new Uint8Array(canonical.byteLength + 24);
  duplicate.set(canonical);
  duplicate.set(canonical.subarray(12, 36), canonical.byteLength);
  new DataView(duplicate.buffer).setUint32(4, duplicate.byteLength - 8, true);
  assert.throws(() => validateCreatorOsWav(duplicate), /valid CreatorOS WAV/);
});

test("checks the declared duration against the duration derived from PCM bytes", () => {
  const assembled = wav(100);
  assert.doesNotThrow(() => validateCreatorOsWav(assembled.wavBytes, 100 + WAV_DURATION_TOLERANCE_MS));
  assert.throws(() => validateCreatorOsWav(assembled.wavBytes, 103), /valid CreatorOS WAV/);
});

test("preserves a ceiling duration for PCM that does not end on a millisecond boundary", () => {
  const assembled = assemblePcmChunksToWav([new Uint8Array(2_401 * 2)]);
  const metadata = validateCreatorOsWav(assembled.wavBytes, assembled.durationMs);
  assert.equal(metadata.sampleFrameCount, 2_401);
  assert.equal(metadata.durationMs, 100);
  assert.equal(metadata.durationCeilingMs, 101);
  assert.ok(metadata.durationCeilingMs >= metadata.sampleFrameCount * 1_000 / metadata.sampleRate);
});

test("accepts bounded unknown chunks with required odd-byte padding", () => {
  const canonical = wav(100).wavBytes;
  const withUnknown = new Uint8Array(canonical.byteLength + 10);
  withUnknown.set(canonical.subarray(0, 36));
  withUnknown.set(new TextEncoder().encode("JUNK"), 36);
  new DataView(withUnknown.buffer).setUint32(40, 1, true);
  withUnknown[44] = 7;
  withUnknown[45] = 0;
  withUnknown.set(canonical.subarray(36), 46);
  new DataView(withUnknown.buffer).setUint32(4, withUnknown.byteLength - 8, true);
  assert.equal(validateCreatorOsWav(withUnknown).dataSizeBytes, 4_800);

  const missingPad = new Uint8Array(canonical.byteLength + 9);
  missingPad.set(canonical);
  missingPad.set(new TextEncoder().encode("JUNK"), canonical.byteLength);
  new DataView(missingPad.buffer).setUint32(canonical.byteLength + 4, 1, true);
  missingPad[missingPad.byteLength - 1] = 7;
  new DataView(missingPad.buffer).setUint32(4, missingPad.byteLength - 8, true);
  assert.throws(() => validateCreatorOsWav(missingPad), /valid CreatorOS WAV/);
});
