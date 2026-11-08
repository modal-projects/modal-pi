import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { createModalProvider } from "../dist/index.js";

const endpoint = {
	id: "workspace--chat.modal.direct",
	name: "Chat",
	base_model_id: "deepseek-ai/DeepSeek-V4.1-Flash",
	context_length: 1048576,
	max_output_length: 262144,
	input_modalities: ["text", "image"],
	output_modalities: ["text"],
	supported_features: ["tools", "reasoning"],
	supported_sampling_parameters: ["max_tokens"],
	reasoning_options: [{ type: "effort", values: ["none", "low", "high"] }],
	interleaved: { field: "reasoning_content" },
};
const user = { role: "user", content: "Hello", timestamp: 0 };
const tool = {
	name: "read",
	description: "Read a file",
	parameters: {
		type: "object",
		properties: { path: { type: "string" } },
		required: ["path"],
	},
};

async function setup(t) {
	t.mock.method(globalThis, "fetch", async () =>
		Response.json({ data: [endpoint] }),
	);
	const models = createModels({
		authContext: {
			env: async (name) =>
				name === "MODAL_PROXY_TOKEN" ? "wk-test.ws-test" : undefined,
			fileExists: async () => false,
		},
	});
	models.setProvider(createModalProvider());
	await models.refresh({ allowNetwork: true });
	return { models, model: models.getModel("modal", endpoint.id) };
}

function sse(deltas, finish = "stop", usage) {
	const events = deltas.map((delta) => ({
		choices: [{ index: 0, delta, finish_reason: null }],
	}));
	events.push({ choices: [{ index: 0, delta: {}, finish_reason: finish }] });
	if (usage) events.push({ choices: [], usage });
	return new Response(
		`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
		{ headers: { "content-type": "text/event-stream" } },
	);
}

test("streams text, reasoning, Unicode, cached usage and published costs through Pi's adapter", async (t) => {
	const { models, model } = await setup(t);
	const stream = models.streamSimple(
		model,
		{ messages: [user] },
		{
			reasoning: "low",
			maxTokens: 512,
			sessionId: "conversation-1",
			fetch: async (url, options) => {
				assert.equal(
					String(url),
					"https://inference.us-west.modal.direct/v1/chat/completions",
				);
				const headers = new Headers(options.headers);
				assert.equal(headers.get("authorization"), "Bearer wk-test.ws-test");
				assert.equal(
					headers.get("modal-routing-affinity-key"),
					"conversation-1",
				);
				const body = JSON.parse(options.body);
				assert.equal(body.model, endpoint.id);
				assert.equal(body.reasoning_effort, "low");
				assert.equal(body.max_tokens, 512);
				assert.equal(body.stream_options.include_usage, true);
				return sse(
					[
						{ reasoning_content: "Think" },
						{ reasoning_content: " carefully" },
						{ content: "Hello, " },
						{ content: "世界!" },
					],
					"stop",
					{
						prompt_tokens: 10,
						completion_tokens: 3,
						total_tokens: 13,
						prompt_tokens_details: { cached_tokens: 2 },
						completion_tokens_details: { reasoning_tokens: 1 },
					},
				);
			},
		},
	);
	const events = [];
	for await (const event of stream) events.push(event.type);
	const result = await stream.result();
	assert.equal(result.stopReason, "stop", result.errorMessage);
	assert.ok(events.includes("text_delta"));
	assert.ok(events.includes("thinking_delta"));
	assert.deepEqual(
		result.content.map((part) => [part.type, part.text ?? part.thinking]),
		[
			["thinking", "Think carefully"],
			["text", "Hello, 世界!"],
		],
	);
	assert.equal(result.usage.input, 8);
	assert.equal(result.usage.cacheRead, 2);
	assert.equal(result.usage.output, 3);
	assert.equal(result.usage.reasoning, 1);
	assert.equal(result.usage.totalTokens, 13);
	assert.ok(
		Math.abs(result.usage.cost.total - (8 * 0.3 + 2 * 0.03 + 3 * 1.2) / 1e6) <
			1e-15,
	);
});

test("assembles partial tool arguments and replays reasoning and tool results over multiple turns", async (t) => {
	const { models, model } = await setup(t);
	const first = await models.complete(
		model,
		{ messages: [user], tools: [tool] },
		{
			reasoningEffort: "low",
			maxTokens: 512,
			fetch: async () =>
				sse(
					[
						{ reasoning_content: "Read first." },
						{
							tool_calls: [
								{
									index: 0,
									id: "call_read",
									type: "function",
									function: { name: "read", arguments: '{"path":' },
								},
							],
						},
						{
							tool_calls: [
								{ index: 0, function: { arguments: '"résumé.ts"}' } },
							],
						},
					],
					"tool_calls",
				),
		},
	);
	assert.equal(first.stopReason, "toolUse", first.errorMessage);
	const call = first.content.find((part) => part.type === "toolCall");
	assert.deepEqual(call.arguments, { path: "résumé.ts" });
	const result = await models.completeSimple(
		model,
		{
			messages: [
				user,
				first,
				{
					role: "toolResult",
					toolCallId: call.id,
					toolName: "read",
					content: [{ type: "text", text: "file contents" }],
					isError: false,
					timestamp: 1,
				},
			],
			tools: [tool],
		},
		{
			fetch: async (_url, options) => {
				const body = JSON.parse(options.body);
				assert.equal(body.reasoning_effort, "none");
				const assistant = body.messages.find(
					(message) => message.role === "assistant",
				);
				assert.equal(assistant.reasoning_content, "Read first.");
				assert.equal(assistant.tool_calls[0].id, call.id);
				assert.equal(body.messages.at(-1).role, "tool");
				assert.equal(body.messages.at(-1).content, "file contents");
				return sse([{ content: "Done" }]);
			},
		},
	);
	assert.equal(result.stopReason, "stop", result.errorMessage);
});

test("preserves caller headers, including an explicit affinity override or suppression", async (t) => {
	const { models, model } = await setup(t);
	for (const [sessionId, override, expected] of [
		["s", "custom", "custom"],
		["s", null, null],
		[undefined, undefined, null],
	]) {
		const result = await models.completeSimple(
			model,
			{ messages: [user] },
			{
				sessionId,
				headers:
					override === undefined
						? { "X-Test": "kept" }
						: { "modal-routing-affinity-key": override, "X-Test": "kept" },
				fetch: async (_url, options) => {
					const headers = new Headers(options.headers);
					assert.equal(headers.get("x-test"), "kept");
					assert.equal(headers.get("modal-routing-affinity-key"), expected);
					return sse([{ content: "ok" }]);
				},
			},
		);
		assert.equal(result.stopReason, "stop", result.errorMessage);
	}
});

test("forwards image inputs using the OpenAI-compatible payload", async (t) => {
	const { models, model } = await setup(t);
	const result = await models.completeSimple(
		model,
		{
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Describe this" },
						{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
					],
					timestamp: 0,
				},
			],
		},
		{
			fetch: async (_url, options) => {
				const content = JSON.parse(options.body).messages[0].content;
				assert.equal(
					content[1].image_url.url,
					"data:image/png;base64,aGVsbG8=",
				);
				return sse([{ content: "Image received" }]);
			},
		},
	);
	assert.equal(result.stopReason, "stop", result.errorMessage);
});

test("normalizes empty responses and surfaces HTTP auth, rate-limit, and context errors", async (t) => {
	const { models, model } = await setup(t);
	const empty = await models.completeSimple(
		model,
		{ messages: [user] },
		{ fetch: async () => sse([]) },
	);
	assert.equal(empty.stopReason, "stop", empty.errorMessage);
	assert.deepEqual(empty.content, []);
	for (const [status, message] of [
		[401, "Invalid proxy token"],
		[403, "Environment access denied"],
		[429, "Rate limit exceeded"],
		[400, "maximum context length exceeded"],
	]) {
		const result = await models.completeSimple(
			model,
			{ messages: [user] },
			{
				maxRetries: 0,
				fetch: async () =>
					Response.json(
						{ error: { message, type: "invalid_request_error" } },
						{ status },
					),
			},
		);
		assert.equal(result.stopReason, "error");
		assert.ok(result.errorMessage.includes(message), result.errorMessage);
	}
});

test("surfaces malformed SSE without losing text already streamed", async (t) => {
	const { models, model } = await setup(t);
	const result = await models.completeSimple(
		model,
		{ messages: [user] },
		{
			fetch: async () =>
				new Response(
					'data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\ndata: invalid-json\n\n',
					{ headers: { "content-type": "text/event-stream" } },
				),
		},
	);
	assert.equal(result.stopReason, "error");
	assert.equal(
		result.content.find((part) => part.type === "text").text,
		"partial",
	);
});

test("cancels an in-flight HTTP request through the shared abort signal", async (t) => {
	const { models, model } = await setup(t);
	const controller = new AbortController();
	const result = await models.completeSimple(
		model,
		{ messages: [user] },
		{
			signal: controller.signal,
			fetch: async (_url, options) => {
				controller.abort();
				options.signal.throwIfAborted();
			},
		},
	);
	assert.equal(result.stopReason, "aborted");
});
