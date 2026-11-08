import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
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

test("registers the Modal provider without replacing another provider", () => {
	const providers = [];
	modal({ registerProvider: (provider) => providers.push(provider) });
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

test("stored login takes precedence over the environment and logout restores it", async () => {
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
