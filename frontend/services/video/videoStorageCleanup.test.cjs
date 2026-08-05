/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { removePrivateStorageObject } = require("./videoStorageCleanup.server.ts");

test("private object cleanup accepts a verified removal", async () => {
  await removePrivateStorageObject(async () => ({ error: null }), async () => false);
});

test("private object cleanup rejects a returned Storage error", async () => {
  await assert.rejects(removePrivateStorageObject(async () => ({ error: new Error("provider detail") }), async () => false), /cleanup was incomplete/i);
});

test("private object cleanup rejects a thrown Storage error", async () => {
  await assert.rejects(removePrivateStorageObject(async () => { throw new Error("provider detail"); }, async () => false), /cleanup was incomplete/i);
});

test("private object cleanup rejects an unverifiable or remaining object", async () => {
  await assert.rejects(removePrivateStorageObject(async () => ({ error: null }), async () => true), /could not be verified/i);
  await assert.rejects(removePrivateStorageObject(async () => ({ error: null }), async () => { throw new Error("provider detail"); }), /could not be verified/i);
});
