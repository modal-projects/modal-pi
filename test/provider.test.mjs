import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import modal, { createModalProvider } from "../dist/index.js";

function registry(env = {}, credentials = new InMemoryCredentialStore()) {
	const models = createModels({
		credentials,
		authContext: {
			env: async (name) => env[name],
			fileExists: async () => false,
		},
	});
	models.setProvider(createModalProvider());
	return models;
}

test(
	"startup discovery survives Pi's concurrent cache-only refresh",
	{ timeout: 5000 },
	async (t) => {
		const directory = await mkdtemp(join(tmpdir(), "modal-pi-startup-"));
		const old = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = directory;
		try {
			await writeFile(
				join(directory, "auth.json"),
				JSON.stringify({
					modal: { type: "api_key", key: "wk-startup.ws-startup" },
				}),
			);
			await writeFile(
				join(directory, "models.json"),
				JSON.stringify({
					providers: { modal: { baseUrl: "https://fixture.invalid/v1" } },
				}),
			);
			const networkStarted = Promise.withResolvers();
			const offlineFinished = Promise.withResolvers();
			const refresh = ModelRuntime.prototype.refresh;
			t.mock.method(
				ModelRuntime.prototype,
				"refresh",
				async function (options) {
					if (options?.allowNetwork !== false)
						return refresh.call(this, options);
					await networkStarted.promise;
					try {
						return await refresh.call(this, options);
					} finally {
						offlineFinished.resolve();
					}
				},
			);
			t.mock.method(globalThis, "fetch", async (url, options) => {
				assert.equal(url, "https://fixture.invalid/v1/models");
				assert.equal(
					options.headers.Authorization,
					"Bearer wk-startup.ws-startup",
				);
				networkStarted.resolve();
				await offlineFinished.promise;
				return Response.json({
					data: [
						{
							id: "startup.modal.direct",
							name: "Startup",
							base_model_id: "deepseek-ai/DeepSeek-V4.1-Flash",
							context_length: 32768,
							max_output_length: 4096,
							input_modalities: ["text"],
							output_modalities: ["text"],
							supported_features: ["tools"],
						},
					],
				});
			});
			const providers = [];
			const warnings = [];
			await modal({
				registerProvider: (provider) => providers.push(provider),
				on: (name) => warnings.push(name),
			});
			assert.deepEqual(warnings, []);
			assert.equal(providers[0].getModels()[0]?.id, "startup.modal.direct");
		} finally {
			if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = old;
			await rm(directory, { recursive: true, force: true });
		}
	},
);

test("offline startup registers without attempting discovery", async (t) => {
	const old = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";
	try {
		const fetch = t.mock.method(globalThis, "fetch", async () => {
			throw new Error("unexpected request");
		});
		const providers = [];
		await modal({ registerProvider: (provider) => providers.push(provider) });
		assert.equal(providers.length, 1);
		assert.deepEqual(providers[0].getModels(), []);
		assert.equal(fetch.mock.callCount(), 0);
	} finally {
		if (old === undefined) delete process.env.PI_OFFLINE;
		else process.env.PI_OFFLINE = old;
	}
});

test("registers the Modal provider without replacing another provider", async () => {
	const providers = [];
	await modal({
		registerProvider: (provider) => providers.push(provider),
		on: () => {},
	});
	assert.equal(providers.length, 1);
	assert.equal(providers[0].id, "modal");
	assert.equal(providers[0].name, "Modal");
	assert.equal(
		providers[0].baseUrl,
		"https://inference.us-west.modal.direct/v1",
	);
});

test("resolves the combined proxy token from the environment", async () => {
	const models = registry({ MODAL_PROXY_TOKEN: "wk-test.ws-test" });
	assert.deepEqual((await models.getAuth("modal")).auth, {
		apiKey: "wk-test.ws-test",
	});
});

test("stored login takes precedence over the environment and logout restores it", async (t) => {
	t.mock.method(globalThis, "fetch", async () => Response.json({ data: [] }));
	const credentials = new InMemoryCredentialStore();
	const models = registry({ MODAL_PROXY_TOKEN: "wk-env.ws-env" }, credentials);
	await models.login("modal", "api_key", {
		prompt: async ({ type }) => {
			assert.equal(type, "secret");
			return "wk-stored.ws-stored";
		},
		notify: () => {},
	});
	assert.equal(
		(await models.getAuth("modal")).auth.apiKey,
		"wk-stored.ws-stored",
	);
	await models.logout("modal");
	assert.equal((await models.getAuth("modal")).auth.apiKey, "wk-env.ws-env");
});

test("does not treat Modal CLI credentials as proxy credentials", async () => {
	const models = registry({
		MODAL_TOKEN_ID: "ak-test",
		MODAL_TOKEN_SECRET: "as-test",
	});
	assert.equal(await models.getAuth("modal"), undefined);
});

test("cancelled login never persists a credential", async () => {
	const credentials = new InMemoryCredentialStore();
	const models = registry({}, credentials);
	const controller = new AbortController();
	await assert.rejects(
		models.login("modal", "api_key", {
			signal: controller.signal,
			prompt: async () => {
				controller.abort();
				return "wk-cancelled.ws-cancelled";
			},
			notify: () => {},
		}),
		{ name: "AbortError" },
	);
	assert.equal(await credentials.read("modal"), undefined);
});
