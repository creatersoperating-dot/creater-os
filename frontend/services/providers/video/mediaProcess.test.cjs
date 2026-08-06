/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  resolveTrustedWindowsTaskkillPath,
  runMediaProcess,
  terminateWindowsProcessTree,
} = require("./mediaProcess.server.ts");

function childDouble(onKill = () => true) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.unref = () => child;
  child.kill = (signal) => onKill(signal, child);
  return child;
}

function request(overrides = {}) {
  return {
    executablePath: "C:\\private\\tool.exe",
    args: ["safe-argument"],
    timeoutMs: 5_000,
    terminationGraceMs: 1,
    forceCloseDeadlineMs: 5,
    ...overrides,
  };
}

async function withWindowsEnvironment(overrides, action) {
  const keys = ["SystemRoot", "WINDIR", "CREATOROS_FFMPEG_PATH", "CREATOROS_FFPROBE_PATH"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
  try { return await action(); }
  finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("normal close resolves and process output capture is bounded", async () => {
  const child = childDouble();
  const promise = runMediaProcess(request({ captureStdout: true, maxCaptureBytes: 4 }), () => child);
  child.stdout.write(Buffer.from("123456"));
  child.stdout.end(); child.stderr.end();
  child.emit("close", 0);
  const result = await promise;
  assert.equal(new TextDecoder().decode(result.stdout), "1234");
  assert.equal(result.stdoutTruncated, true);
});

test("cancellation waits for close, checks initial termination, and force-kills an ignoring child", async () => {
  const signals = [];
  let closed = false;
  const child = childDouble((signal, instance) => {
    signals.push(signal);
    if (signal === "SIGKILL") setImmediate(() => { closed = true; instance.emit("close", null); });
    return true;
  });
  const controller = new AbortController();
  let settled = false;
  const promise = runMediaProcess(request({ signal: controller.signal }), () => child).finally(() => { settled = true; });
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  await assert.rejects(promise, (error) => error.code === "cancelled" && error.retryable === true);
  assert.equal(closed, true);
  assert.deepEqual(signals.slice(0, 2), ["SIGTERM", "SIGKILL"]);
});

test("an error during termination cannot replace the original timeout", async () => {
  const child = childDouble((signal, instance) => {
    if (signal === "SIGTERM") setImmediate(() => instance.emit("error", new Error("private process failure")));
    if (signal === "SIGKILL") setImmediate(() => instance.emit("close", null));
    return true;
  });
  await assert.rejects(runMediaProcess(request({ timeoutMs: 1 }), () => child), (error) => {
    assert.equal(error.code, "timeout");
    assert.equal(error.retryable, true);
    return true;
  });
});

test("a rejected initial kill request escalates immediately and still waits for close", async () => {
  const signals = [];
  const child = childDouble((signal, instance) => {
    signals.push(signal);
    if (signal === "SIGKILL") setImmediate(() => instance.emit("close", null));
    return signal !== "SIGTERM";
  });
  const controller = new AbortController();
  const promise = runMediaProcess(request({ signal: controller.signal, terminationGraceMs: 1_000 }), () => child);
  controller.abort();
  await assert.rejects(promise, (error) => error.code === "cancelled");
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("heartbeat rejection terminates rendering and is preserved through close", async () => {
  const child = childDouble((signal, instance) => {
    if (signal === "SIGTERM") setImmediate(() => instance.emit("close", null));
    return true;
  });
  await assert.rejects(runMediaProcess(request({
    heartbeatIntervalMs: 1,
    heartbeat: async () => { throw new Error("database detail"); },
  }), () => child), (error) => error.code === "heartbeat_failed" && error.retryable === true);
});

test("spawn failure is sanitized and does not wait for an impossible close", async () => {
  const child = childDouble();
  const promise = runMediaProcess(request(), () => child);
  child.emit("error", new Error("C:\\private\\tool.exe missing"));
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, "media_process_unavailable");
    assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /private|tool\.exe/);
    return true;
  });
});

test("a never-closing child rejects after the final deadline and stops heartbeat work", async () => {
  const child = childDouble(() => true);
  child.pid = 4242;
  let heartbeats = 0;
  let treePid = null;
  let failure;
  const startedAt = Date.now();
  await assert.rejects(runMediaProcess(request({
    timeoutMs: 5,
    terminationGraceMs: 2,
    forceCloseDeadlineMs: 3,
    heartbeatIntervalMs: 1,
    heartbeat: async () => { heartbeats += 1; },
    platform: "win32",
    terminateProcessTree: async (pid) => { treePid = pid; },
  }), () => child), (error) => {
    failure = error;
    assert.equal(error.code, "process_termination_unconfirmed");
    assert.equal(error.retryable, true);
    assert.equal(error.terminationReason.code, "timeout");
    return true;
  });
  assert.ok(Date.now() - startedAt < 250);
  assert.equal(treePid, 4242);
  const stoppedAt = heartbeats;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(heartbeats, stoppedAt);

  let eventuallyClosed = false;
  failure.closed.then(() => { eventuallyClosed = true; });
  child.emit("close", null);
  await failure.closed;
  assert.equal(eventuallyClosed, true);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("Windows process-tree termination uses fixed taskkill arguments with shell disabled", async () => {
  await withWindowsEnvironment({
    SystemRoot: "C:\\Windows",
    CREATOROS_FFMPEG_PATH: "D:\\untrusted\\taskkill.exe",
    CREATOROS_FFPROBE_PATH: "E:\\untrusted\\taskkill.exe",
  }, async () => {
    const helper = childDouble();
    let captured;
    const promise = terminateWindowsProcessTree(321, (executablePath, args, options) => {
      captured = { executablePath, args, options };
      return helper;
    });
    helper.emit("close", 0);
    await promise;
    assert.equal(captured.executablePath, "C:\\Windows\\System32\\taskkill.exe");
    assert.equal(path.win32.isAbsolute(captured.executablePath), true);
    assert.deepEqual(captured.args, ["/PID", "321", "/T", "/F"]);
    assert.equal(captured.options.shell, false);
    assert.equal(captured.options.windowsHide, true);
    assert.equal(captured.options.stdio, "ignore");
  });
});

test("Windows taskkill resolution falls back to a trusted absolute WINDIR", async () => {
  await withWindowsEnvironment({ WINDIR: "D:\\Windows" }, async () => {
    const helper = childDouble();
    let executablePath;
    const promise = terminateWindowsProcessTree(654, (receivedPath) => {
      executablePath = receivedPath;
      return helper;
    });
    helper.emit("close", 0);
    await promise;
    assert.equal(executablePath, "D:\\Windows\\System32\\taskkill.exe");
    assert.equal(path.win32.isAbsolute(executablePath), true);
  });
});

test("invalid or missing Windows directories fail closed without spawning taskkill", async () => {
  for (const environment of [
    {},
    { SystemRoot: "relative-windows", WINDIR: "C:\\Windows" },
  ]) {
    await withWindowsEnvironment(environment, async () => {
      let spawned = false;
      await terminateWindowsProcessTree(987, () => {
        spawned = true;
        return childDouble();
      });
      assert.equal(spawned, false);
    });
  }
});

test("taskkill path validation rejects empty, NUL-containing, and relative Windows directories", () => {
  assert.equal(resolveTrustedWindowsTaskkillPath(undefined), null);
  assert.equal(resolveTrustedWindowsTaskkillPath(""), null);
  assert.equal(resolveTrustedWindowsTaskkillPath("C:\\Windows\0poison"), null);
  assert.equal(resolveTrustedWindowsTaskkillPath("relative-windows"), null);
});

test("an unavailable trusted taskkill path preserves the original timeout reason", async () => {
  await withWindowsEnvironment({}, async () => {
    const child = childDouble(() => true);
    child.pid = 4243;
    let failure;
    await assert.rejects(runMediaProcess(request({
      timeoutMs: 1,
      terminationGraceMs: 1,
      forceCloseDeadlineMs: 2,
      platform: "win32",
    }), () => child), (error) => {
      failure = error;
      assert.equal(error.code, "process_termination_unconfirmed");
      assert.equal(error.retryable, true);
      assert.equal(error.terminationReason.code, "timeout");
      return true;
    });
    child.emit("close", null);
    await failure.closed;
  });
});

test("a nonzero process exit is deterministic unless explicitly classified transient", async () => {
  const child = childDouble();
  const promise = runMediaProcess(request({ failureCode: "ffmpeg_failed", failureMessage: "FFmpeg failed." }), () => child);
  child.emit("close", 1);
  await assert.rejects(promise, (error) => error.code === "ffmpeg_failed" && error.retryable === false);
});
