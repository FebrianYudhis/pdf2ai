import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  AiError,
  AiResultStore,
  createAiCompletion,
  fetchAiModels,
  normalizeAiBaseUrl,
} from "../src/ai.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("Base URL AI dinormalisasi dan kredensial URL ditolak", () => {
  assert.equal(normalizeAiBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.throws(
    () => normalizeAiBaseUrl("ftp://api.example.com/v1"),
    (error) => error instanceof AiError && error.statusCode === 400,
  );
  assert.throws(
    () => normalizeAiBaseUrl("https://user:secret@api.example.com/v1"),
    (error) => error instanceof AiError && error.statusCode === 400,
  );
});

test("client AI mengimport model dan membaca chat completion", async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body: body ? JSON.parse(body) : null,
    });

    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/models") {
      response.end(
        JSON.stringify({
          data: [{ id: "model-z" }, { id: "model-a" }, { id: "model-a" }],
        }),
      );
      return;
    }
    if (request.url === "/v1/chat/completions") {
      response.end(
        JSON.stringify({
          id: "chatcmpl-local",
          model: "model-a-2026",
          choices: [{ message: { content: "Jawaban provider" } }],
          usage: { total_tokens: 17 },
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: "Not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  const models = await fetchAiModels({
    baseUrl,
    token: "token-test",
    timeoutMs: 2_000,
  });
  assert.deepEqual(models, ["model-a", "model-z"]);

  const completion = await createAiCompletion({
    baseUrl,
    token: "token-test",
    model: "model-a",
    prompt: "Ambil total",
    markdown: "# Invoice\n\nRp100.000",
    timeoutMs: 2_000,
  });
  assert.deepEqual(completion, {
    content: "Jawaban provider",
    providerId: "chatcmpl-local",
    providerModel: "model-a-2026",
    usage: { total_tokens: 17 },
  });
  assert.deepEqual(
    requests.map((request) => [request.method, request.url]),
    [
      ["GET", "/v1/models"],
      ["POST", "/v1/chat/completions"],
    ],
  );
  assert.equal(requests[0].authorization, "Bearer token-test");
  assert.equal(requests[1].body.model, "model-a");
  assert.equal(requests[1].body.stream, false);
  assert.match(requests[1].body.messages[1].content, /Rp100\.000/);
});

test("client AI menerima SSE dari provider compatible yang tetap melakukan stream", async (t) => {
  let requestBody;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    requestBody = JSON.parse(body);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.end([
      'data: {"id":"chatcmpl-stream","model":"model-stream","choices":[{"delta":{"content":"Jawaban "}}]}',
      "",
      'data: {"id":"chatcmpl-stream","model":"model-stream","choices":[{"delta":{"content":"SSE"}}]}',
      "",
      'data: {"id":"chatcmpl-stream","model":"model-stream","choices":[{"delta":{}}],"usage":{"total_tokens":9}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();

  const completion = await createAiCompletion({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "model-stream",
    prompt: "Ringkas",
    markdown: "# Dokumen",
    timeoutMs: 2_000,
  });

  assert.equal(requestBody.stream, false);
  assert.deepEqual(completion, {
    content: "Jawaban SSE",
    providerId: "chatcmpl-stream",
    providerModel: "model-stream",
    usage: { total_tokens: 9 },
  });
});

test("AiResultStore dapat menghitung dan mendeteksi hasil AI per job", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pdf2ai-ai-store-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const store = new AiResultStore({ directory });
  await store.init();

  const jobId = "11111111-1111-4111-8111-111111111111";
  assert.equal(store.countForJob(jobId), 0);
  assert.equal(store.hasForJob(jobId), false);

  await store.save({
    job: { id: jobId, originalName: "doc.pdf" },
    model: "gpt-model",
    prompt: "Apa intinya?",
    completion: {
      content: "Inti dokumen...",
      providerId: "test-id",
      providerModel: "gpt-model",
    },
  });

  assert.equal(store.countForJob(jobId), 1);
  assert.equal(store.hasForJob(jobId), true);
  assert.equal(store.countForJob("22222222-2222-4222-8222-222222222222"), 0);
  assert.equal(store.hasForJob("22222222-2222-4222-8222-222222222222"), false);
});

