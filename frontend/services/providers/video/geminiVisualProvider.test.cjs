/* eslint-disable @typescript-eslint/no-require-imports */
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");

const sharp = require("sharp");

const { createGeminiVisualProvider } = require("./geminiVisualProvider.server.ts");

function scenes(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `scene-${index + 1}`,
    sceneNumber: index + 1,
    title: `Scene ${index + 1}`,
    narrationText: `Narration ${index + 1}`,
    visualPrompt: `A distinct cinematic composition numbered ${index + 1}`,
    visualType: "image",
    durationMs: 1_000,
    transition: "cut",
  }));
}

function request(count = 2, overrides = {}) {
  return {
    projectId: "project-test",
    projectTitle: "Visual provider test",
    model: "gemini-3.1-flash-image",
    scenes: scenes(count),
    ...overrides,
  };
}

async function imageBytes(width = 64, height = 36, format = "png") {
  const pipeline = sharp({ create: { width, height, channels: 3, background: { r: 30, g: 80, b: 140 } } });
  return format === "jpeg" ? pipeline.jpeg().toBuffer() : format === "webp" ? pipeline.webp().toBuffer() : pipeline.png().toBuffer();
}

function responseFor(call, bytes, overrides = {}) {
  return {
    requestSceneId: call.sceneId,
    requestSceneNumber: call.sceneNumber,
    responseId: `request-${call.sceneNumber}`,
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: bytes.toString("base64") } }] } }],
    ...overrides,
  };
}

function provider(handler, overrides = {}) {
  return createGeminiVisualProvider({
    apiKey: "test-key-never-used",
    timeoutMs: 10_000,
    maxConcurrency: 2,
    client: { generateImage: handler },
    ...overrides,
  });
}

test("official SDK requests one 16:9 image with an AbortSignal", async () => {
  const source = await readFile(require.resolve("./geminiVisualProvider.server.ts"), "utf8");
  assert.match(source, /from "@google\/genai"/);
  assert.match(source, /candidateCount: 1/);
  assert.match(source, /responseModalities: \[Modality\.IMAGE\]/);
  assert.match(source, /imageConfig: \{ aspectRatio: "16:9", imageSize: "1K" \}/);
  assert.match(source, /abortSignal: request\.signal/);
});

test("one image per scene is normalized, hashed, sanitized, and returned in scene order", async () => {
  const png = await imageBytes();
  const calls = [];
  const visualProvider = provider(async (call) => {
    calls.push(call);
    if (call.sceneNumber === 1) await new Promise((resolve) => setTimeout(resolve, 10));
    return responseFor(call, png, { responseId: call.sceneNumber === 1 ? "safe.request-1" : "unsafe request path C:\\secret" });
  });
  const results = await visualProvider.generateVisualAssets(request());
  assert.deepEqual(results.map((asset) => asset.sceneNumber), [1, 2]);
  assert.deepEqual(results.map((asset) => asset.sceneId), ["scene-1", "scene-2"]);
  assert.equal(results[0].providerRequestId, "safe.request-1");
  assert.equal(results[1].providerRequestId, undefined);
  for (const asset of results) {
    assert.equal(asset.format, "png");
    assert.equal(asset.mimeType, "image/png");
    assert.equal(asset.width, 1280);
    assert.equal(asset.height, 720);
    assert.equal(asset.contentSha256, createHash("sha256").update(asset.bytes).digest("hex"));
    assert.deepEqual(await sharp(asset.bytes).metadata().then(({ format, width, height, orientation, exif }) => ({ format, width, height, orientation, exif })),
      { format: "png", width: 1280, height: 720, orientation: undefined, exif: undefined });
  }
  assert.ok(calls.every((call) => call.model === "gemini-3.1-flash-image" && call.prompt.includes("single 16:9 frame")));
});

test("missing, ambiguous, malformed, unsupported, mismatched, and wrong-scene responses fail deterministically", async (t) => {
  const png = await imageBytes();
  const cases = [
    ["missing", (call) => responseFor(call, png, { candidates: [] }), "visual_response_missing"],
    ["ambiguous", (call) => responseFor(call, png, { candidates: [{ content: { parts: [
      { inlineData: { mimeType: "image/png", data: png.toString("base64") } },
      { inlineData: { mimeType: "image/png", data: png.toString("base64") } },
    ] } }] }), "visual_response_ambiguous"],
    ["malformed base64", (call) => responseFor(call, png, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "not base64!" } }] } }] }), "visual_response_invalid"],
    ["invalid binary", (call) => responseFor(call, png, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from([1, 2, 3]).toString("base64") } }] } }] }), "visual_response_invalid"],
    ["unsupported MIME", (call) => responseFor(call, png, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/gif", data: png.toString("base64") } }] } }] }), "visual_format_unsupported"],
    ["MIME mismatch", (call) => responseFor(call, png, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: png.toString("base64") } }] } }] }), "visual_image_unsafe"],
    ["wrong scene", (call) => responseFor(call, png, { requestSceneId: "another-scene" }), "visual_response_mismatch"],
  ];
  for (const [name, makeResponse, code] of cases) {
    await t.test(name, async () => {
      const visualProvider = provider(async (call) => makeResponse(call));
      await assert.rejects(visualProvider.generateVisualAssets(request(1)), (error) => error.code === code && error.retryable === false);
    });
  }
});

test("encoded input limits and unsafe decoded dimensions are enforced", async () => {
  const png = await imageBytes();
  const oversized = provider(async (call) => responseFor(call, png, { candidates: [{ content: { parts: [{ inlineData: {
    mimeType: "image/png", data: "A".repeat(16 * 1024 * 1024 + 4),
  } }] } }] }));
  await assert.rejects(oversized.generateVisualAssets(request(1)), (error) => error.code === "visual_response_invalid");

  const tooWide = await imageBytes(8193, 1);
  const unsafe = provider(async (call) => responseFor(call, tooWide));
  await assert.rejects(unsafe.generateVisualAssets(request(1)), (error) => error.code === "visual_image_unsafe");
  const outputLimited = provider(async (call) => responseFor(call, png), { maximumOutputBytes: 1 });
  await assert.rejects(outputLimited.generateVisualAssets(request(1)), (error) => error.code === "visual_image_oversized");
  const totalLimited = provider(async (call) => responseFor(call, png), { maximumTotalOutputBytes: 1 });
  await assert.rejects(totalLimited.generateVisualAssets(request(2)), (error) => error.code === "visual_set_oversized");
  assert.equal(unsafe.descriptor.capabilities.maximumBytesPerAsset, 8 * 1024 * 1024);
  assert.equal(unsafe.descriptor.capabilities.maximumTotalBytes, 64 * 1024 * 1024);
});

test("partial scene output rejects the whole set", async () => {
  const png = await imageBytes();
  const visualProvider = provider(async (call) => call.sceneNumber === 1
    ? responseFor(call, png) : responseFor(call, png, { candidates: [] }));
  await assert.rejects(visualProvider.generateVisualAssets(request(2)), (error) => error.code === "visual_response_missing");
});

test("scene generation uses bounded concurrency", async () => {
  const png = await imageBytes();
  let active = 0;
  let maximum = 0;
  const visualProvider = provider(async (call) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 8));
    active -= 1;
    return responseFor(call, png);
  }, { maxConcurrency: 2 });
  const results = await visualProvider.generateVisualAssets(request(6));
  assert.equal(results.length, 6);
  assert.equal(maximum, 2);
});

test("provider timeout aborts in-flight work and remains retryable", async () => {
  let cancelled = false;
  const visualProvider = provider((call) => new Promise((resolve, reject) => {
    call.signal.addEventListener("abort", () => { cancelled = true; reject(call.signal.reason); }, { once: true });
  }), {
    timeoutScheduler: (callback) => { setImmediate(callback); return "test-timeout"; },
    timeoutCanceller: () => {},
  });
  await assert.rejects(visualProvider.generateVisualAssets(request(1)), (error) => error.code === "timeout" && error.retryable === true);
  assert.equal(cancelled, true);
});

test("caller cancellation aborts in-flight work and remains retryable", async () => {
  const controller = new AbortController();
  const visualProvider = provider((call) => new Promise((resolve, reject) => {
    call.signal.addEventListener("abort", () => reject(call.signal.reason), { once: true });
    queueMicrotask(() => controller.abort());
  }));
  await assert.rejects(visualProvider.generateVisualAssets(request(1, { signal: controller.signal })),
    (error) => error.code === "cancelled" && error.retryable === true);
});

test("heartbeat failures abort generation and remain sanitized and retryable", async () => {
  let called = false;
  const visualProvider = provider(async () => { called = true; throw new Error("should not run"); });
  await assert.rejects(visualProvider.generateVisualAssets(request(1, {
    heartbeat: async () => { throw new Error("private database detail"); },
  })), (error) => {
    assert.equal(error.code, "lease_heartbeat_failed");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /private|database detail/);
    return true;
  });
  assert.equal(called, false);
});

test("rate limits and transient outages are retryable while unknown failures are sanitized", async (t) => {
  for (const [name, raw, expectedCode, retryable] of [
    ["rate limit", Object.assign(new Error("secret response"), { status: 429 }), "visual_rate_limited", true],
    ["outage", Object.assign(new Error("private upstream"), { status: 503 }), "visual_provider_unavailable", true],
    ["network", Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }), "visual_provider_unavailable", true],
    ["unknown", new Error("API key and raw provider body"), "visual_provider_failed", false],
  ]) {
    await t.test(name, async () => {
      const visualProvider = provider(async () => { throw raw; });
      await assert.rejects(visualProvider.generateVisualAssets(request(1)), (error) => {
        assert.equal(error.code, expectedCode);
        assert.equal(error.retryable, retryable);
        assert.doesNotMatch(error.message, /secret|private|API key|provider body/i);
        return true;
      });
    });
  }
});
