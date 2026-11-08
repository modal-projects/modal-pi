import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { createModalProvider } from "../dist/index.js";

assert.ok(
	process.env.MODAL_PROXY_TOKEN,
	"Set MODAL_PROXY_TOKEN to run billable live tests.",
);
const models = createModels();
models.setProvider(createModalProvider());
await models.login("modal", "api_key", {
	prompt: async () => process.env.MODAL_PROXY_TOKEN,
	notify: () => {},
});
const available = await models.getAvailable("modal");
const model = process.env.MODAL_MODEL
	? available.find((candidate) => candidate.id === process.env.MODAL_MODEL)
	: available.find(
			(candidate) =>
				candidate.thinkingLevelMap?.off === "none" && candidate.cost.input > 0,
		);
assert.ok(model, "Select a tool/reasoning-capable endpoint with MODAL_MODEL.");
const options = { maxRetries: 0, timeoutMs: 60_000, sessionId: randomUUID() };
const tool = {
	name: "add",
	description: "Add two numbers",
	parameters: {
		type: "object",
		properties: { a: { type: "number" }, b: { type: "number" } },
		required: ["a", "b"],
		additionalProperties: false,
	},
};

test("live Modal streams tool calls, replays results and reasoning, and reports usage and cost", async (t) => {
	t.diagnostic(`Endpoint: ${model.id}`);
	const user = {
		role: "user",
		content: "Call add with a=19 and b=23. Then report the returned number.",
		timestamp: Date.now(),
	};
	const first = await models.complete(
		model,
		{ messages: [user], tools: [tool] },
		{
			...options,
			maxTokens: 4096,
			toolChoice: { type: "function", function: { name: "add" } },
		},
	);
	assert.equal(first.stopReason, "toolUse", first.errorMessage);
	const call = first.content.find((part) => part.type === "toolCall");
	assert.equal(call.name, "add");
	assert.deepEqual(call.arguments, { a: 19, b: 23 });
	const context = {
		messages: [
			user,
			first,
			{
				role: "toolResult",
				toolCallId: call.id,
				toolName: "add",
				content: [{ type: "text", text: "42" }],
				isError: false,
				timestamp: Date.now(),
			},
		],
		tools: [tool],
	};
	const second = await models.completeSimple(model, context, {
		...options,
		reasoning: "low",
		maxTokens: 4096,
	});
	assert.equal(second.stopReason, "stop", second.errorMessage);
	assert.match(
		second.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join(""),
		/42/,
	);
	assert.ok(
		second.content.some((part) => part.type === "thinking" && part.thinking),
	);
	assert.ok(second.usage.totalTokens > 0);
	assert.ok(second.usage.cost.total > 0);
	const third = await models.completeSimple(
		model,
		{
			...context,
			messages: [
				...context.messages,
				second,
				{
					role: "user",
					content:
						"What number did the tool return? Reply with only the number.",
					timestamp: Date.now(),
				},
			],
		},
		{ ...options, maxTokens: 128 },
	);
	assert.equal(third.stopReason, "stop", third.errorMessage);
	assert.match(
		third.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join(""),
		/42/,
	);
	t.diagnostic(
		`Tokens: ${first.usage.totalTokens + second.usage.totalTokens + third.usage.totalTokens}; estimated USD: ${first.usage.cost.total + second.usage.cost.total + third.usage.cost.total}`,
	);
});

test("live Modal accepts image input", async () => {
	assert.ok(
		model.input.includes("image"),
		"Select an image-capable endpoint with MODAL_MODEL.",
	);
	const result = await models.completeSimple(
		model,
		{
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "What color is this image? Reply with one word.",
						},
						{
							type: "image",
							mimeType: "image/png",
							data: "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAX0lEQVR4nO3PQQ0AIBDAMMC/50MEj4ZkVbDtWX87OuBVA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA9oFUoUBf3Xr7AgAAAAASUVORK5CYII=",
						},
					],
					timestamp: Date.now(),
				},
			],
		},
		{ ...options, maxTokens: 128 },
	);
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.match(
		result.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join(""),
		/red/i,
	);
});

test("live Modal honors cancellation after the first streamed event", async () => {
	const controller = new AbortController();
	const result = await models.completeSimple(
		model,
		{
			messages: [
				{
					role: "user",
					content: "Count from one to a hundred.",
					timestamp: Date.now(),
				},
			],
		},
		{
			...options,
			maxTokens: 256,
			signal: controller.signal,
			onProviderStreamEvent: () => controller.abort(),
		},
	);
	assert.equal(controller.signal.aborted, true);
	assert.equal(result.stopReason, "aborted", result.errorMessage);
});
