import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createModels,
	getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import { createModalProvider } from "../dist/index.js";

const endpoint = {
	id: "workspace--endpoint.modal.direct",
	name: "My endpoint",
	base_model_id: "deepseek-ai/DeepSeek-V4.1-Flash",
	context_length: 1048576,
	max_output_length: 262144,
	input_modalities: ["text", "image"],
	output_modalities: ["text"],
	supported_features: ["tools", "reasoning"],
	supported_sampling_parameters: ["max_tokens"],
	reasoning_options: [
		{ type: "effort", values: ["none", "low", "high", "xhigh", "max"] },
	],
	interleaved: { field: "reasoning_content" },
};

function registry() {
	const env = { MODAL_PROXY_TOKEN: "wk-test.ws-test" };
	const models = createModels({
		authContext: {
			env: async (name) => env[name],
			fileExists: async () => false,
		},
	});
	const provider = createModalProvider();
	models.setProvider(provider);
	return { models, provider, env };
}

function response(data) {
	return Response.json({ data });
}

test("login validates the token and makes discovered models immediately available", async (t) => {
	t.mock.method(globalThis, "fetch", async (_url, options) => {
		assert.equal(options.headers.Authorization, "Bearer wk-login.ws-login");
		return response([endpoint]);
	});
	const { models } = registry();
	await models.login("modal", "api_key", {
		prompt: async () => "wk-login.ws-login",
		notify: () => {},
	});
	assert.equal((await models.getAvailable("modal"))[0].id, endpoint.id);
	assert.equal(models.getModel("modal", endpoint.id).id, endpoint.id);
});

test("rejected login does not overwrite a saved credential", async (t) => {
	let status = 200;
	t.mock.method(globalThis, "fetch", async () =>
		status === 200 ? response([endpoint]) : new Response("denied", { status }),
	);
	const { models } = registry();
	await models.login("modal", "api_key", {
		prompt: async () => "wk-good.ws-good",
		notify: () => {},
	});
	status = 403;
	await assert.rejects(
		models.login("modal", "api_key", {
			prompt: async () => "wk-bad.ws-bad",
			notify: () => {},
		}),
		/HTTP 403/,
	);
	assert.equal((await models.getAuth("modal")).auth.apiKey, "wk-good.ws-good");
	assert.equal((await models.getAvailable("modal")).length, 1);
});

test("discovers endpoint IDs and maps capabilities, supported thinking levels, and published pricing", async (t) => {
	t.mock.method(globalThis, "fetch", async (url, options) => {
		assert.equal(url, "https://inference.us-west.modal.direct/v1/models");
		assert.equal(options.headers.Authorization, "Bearer wk-test.ws-test");
		return response([
			endpoint,
			{ ...endpoint, id: "workspace--second.modal.direct" },
		]);
	});
	const { models } = registry();
	assert.equal((await models.refresh({ allowNetwork: true })).errors.size, 0);
	const available = await models.getAvailable("modal");
	assert.equal(available.length, 2);
	assert.equal(available[0].id, endpoint.id);
	assert.equal(available[1].id, "workspace--second.modal.direct");
	assert.match(available[0].name, /My endpoint.*workspace--endpoint/);
	assert.deepEqual(available[0].input, ["text", "image"]);
	assert.equal(available[0].contextWindow, 1048576);
	assert.equal(available[0].maxTokens, 262144);
	assert.deepEqual(available[0].cost, {
		input: 0.3,
		output: 1.2,
		cacheRead: 0.03,
		cacheWrite: 0,
	});
	assert.deepEqual(getSupportedThinkingLevels(available[0]), [
		"off",
		"low",
		"high",
		"xhigh",
		"max",
	]);
	assert.equal(available[0].compat.maxTokensField, "max_tokens");
	assert.equal(
		available[0].compat.requiresReasoningContentOnAssistantMessages,
		true,
	);
});

test("skips non-agent and invalid models and labels unavailable cost estimates", async (t) => {
	t.mock.method(globalThis, "fetch", async () =>
		response([
			null,
			{},
			{ ...endpoint, supported_features: [] },
			{ ...endpoint, input_modalities: ["audio"] },
			{ ...endpoint, output_modalities: ["image"] },
			{ ...endpoint, context_length: -1 },
			{ ...endpoint, max_output_length: 1.5 },
			{
				...endpoint,
				base_model_id: "unknown/new-model",
				input_modalities: ["text"],
				supported_features: ["tools"],
			},
		]),
	);
	const { models } = registry();
	await models.refresh({ allowNetwork: true });
	const available = await models.getAvailable("modal");
	assert.equal(available.length, 1);
	assert.equal(available[0].reasoning, false);
	assert.deepEqual(available[0].input, ["text"]);
	assert.match(available[0].name, /\[cost unavailable\]/);
});

test("does not fetch without credentials or permission to use the network", async (t) => {
	const fetch = t.mock.method(globalThis, "fetch", async () => {
		throw new Error("unexpected request");
	});
	const { models, env } = registry();
	await models.refresh({ allowNetwork: false });
	delete env.MODAL_PROXY_TOKEN;
	await models.refresh({ allowNetwork: true });
	assert.equal(fetch.mock.callCount(), 0);
	assert.deepEqual(await models.getAvailable("modal"), []);
});

test("refresh replaces the catalog and an empty response removes endpoints", async (t) => {
	let data = [endpoint];
	t.mock.method(globalThis, "fetch", async () => response(data));
	const { models } = registry();
	await models.refresh({ allowNetwork: true });
	assert.equal((await models.getAvailable("modal")).length, 1);
	data = [];
	await models.refresh({ allowNetwork: true });
	assert.deepEqual(await models.getAvailable("modal"), []);
});

test("retains same-token models on transient errors but never exposes them under a different token", async (t) => {
	let status = 200;
	t.mock.method(globalThis, "fetch", async () =>
		status === 200
			? response([endpoint])
			: new Response("sensitive upstream body", { status }),
	);
	const { models, env, provider } = registry();
	await models.refresh({ allowNetwork: true });
	status = 503;
	let result = await models.refresh({ allowNetwork: true });
	assert.match(result.errors.get("modal").message, /HTTP 503/);
	assert.equal((await models.getAvailable("modal")).length, 1);
	env.MODAL_PROXY_TOKEN = "wk-other.ws-other";
	status = 401;
	result = await models.refresh({ allowNetwork: true });
	assert.match(result.errors.get("modal").message, /\/login modal/);
	assert.doesNotMatch(result.errors.get("modal").message, /sensitive|wk-other/);
	assert.deepEqual(provider.getModels(), []);
	assert.deepEqual(await models.getAvailable("modal"), []);
});

test("removing credentials clears the in-memory catalog", async (t) => {
	t.mock.method(globalThis, "fetch", async () => response([endpoint]));
	const { models, env, provider } = registry();
	await models.refresh({ allowNetwork: true });
	delete env.MODAL_PROXY_TOKEN;
	assert.equal(await models.getAuth("modal"), undefined);
	assert.deepEqual(provider.getModels(), []);
});

test("surfaces malformed catalogs without replacing a valid catalog", async (t) => {
	let valid = true;
	t.mock.method(globalThis, "fetch", async () =>
		valid ? response([endpoint]) : Response.json({ error: "not a model list" }),
	);
	const { models } = registry();
	await models.refresh({ allowNetwork: true });
	valid = false;
	const result = await models.refresh({ allowNetwork: true });
	assert.match(result.errors.get("modal").message, /invalid model catalog/);
	assert.equal((await models.getAvailable("modal")).length, 1);
});

test("cancels discovery without publishing a late catalog", async (t) => {
	const controller = new AbortController();
	t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
		controller.abort();
		signal.throwIfAborted();
	});
	const { models, provider } = registry();
	const result = await models.refresh({
		allowNetwork: true,
		signal: controller.signal,
	});
	assert.equal(result.aborted, true);
	assert.deepEqual(provider.getModels(), []);
});
