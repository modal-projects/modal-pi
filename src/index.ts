import {
	createProvider,
	envApiKeyAuth,
	type Model,
	type ModelThinkingLevel,
	type Provider,
	type ThinkingLevelMap,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
	type ExtensionAPI,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { modelCost } from "./pricing.js";

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toModel(
	value: unknown,
	baseUrl: string,
): Model<"openai-completions"> | undefined {
	if (!record(value)) return undefined;
	const {
		id,
		base_model_id: baseModelId,
		context_length: contextWindow,
		max_output_length: maxTokens,
		supported_features: features,
		input_modalities: input,
		output_modalities: output,
	} = value;
	if (
		typeof id !== "string" ||
		!id ||
		typeof baseModelId !== "string" ||
		typeof contextWindow !== "number" ||
		!Number.isSafeInteger(contextWindow) ||
		contextWindow <= 0 ||
		typeof maxTokens !== "number" ||
		!Number.isSafeInteger(maxTokens) ||
		maxTokens <= 0 ||
		!Array.isArray(features) ||
		!features.includes("tools") ||
		!Array.isArray(input) ||
		!input.includes("text") ||
		!Array.isArray(output) ||
		!output.includes("text")
	)
		return undefined;
	const options = Array.isArray(value.reasoning_options)
		? value.reasoning_options
		: [];
	const effort = options.find(
		(option) => record(option) && option.type === "effort",
	);
	const efforts: unknown[] =
		record(effort) && Array.isArray(effort.values) ? effort.values : [];
	const reasoning = features.includes("reasoning");
	const thinkingLevelMap: ThinkingLevelMap = {};
	for (const level of [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	] as const satisfies readonly ModelThinkingLevel[]) {
		const mapped = level === "off" ? "none" : level;
		thinkingLevelMap[level] = efforts.includes(mapped) ? mapped : null;
	}
	const cost = modelCost(baseModelId);
	return {
		id,
		name: `${typeof value.name === "string" ? value.name : baseModelId} (${id})${cost ? "" : " [cost unavailable]"}`,
		provider: "modal",
		api: "openai-completions",
		baseUrl,
		input: input.includes("image") ? ["text", "image"] : ["text"],
		contextWindow,
		maxTokens,
		reasoning,
		thinkingLevelMap: reasoning ? thinkingLevelMap : undefined,
		cost: cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		compat: {
			maxTokensField:
				Array.isArray(value.supported_sampling_parameters) &&
				value.supported_sampling_parameters.includes("max_tokens")
					? "max_tokens"
					: "max_completion_tokens",
			supportsReasoningEffort: efforts.length > 0,
			requiresReasoningContentOnAssistantMessages:
				record(value.interleaved) &&
				value.interleaved.field === "reasoning_content",
		},
	};
}

async function discover(key: string, baseUrl: string, signal: AbortSignal) {
	const response = await fetch(`${baseUrl}/models`, {
		headers: { Authorization: `Bearer ${key}` },
		signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
	});
	if (!response.ok) {
		throw new Error(
			response.status === 401 || response.status === 403
				? `Modal authentication failed (HTTP ${response.status}). Run /login modal or check MODAL_PROXY_TOKEN and its environment scope.`
				: `Modal model discovery failed (HTTP ${response.status}).`,
		);
	}
	const payload: unknown = await response.json();
	if (!record(payload) || !Array.isArray(payload.data))
		throw new Error("Modal returned an invalid model catalog.");
	signal.throwIfAborted();
	return payload.data.flatMap((value) => toModel(value, baseUrl) ?? []);
}

export function createModalProvider(): Provider<"openai-completions"> {
	// Endpoint catalogs belong to one credential and are never persisted to disk.
	let catalog: readonly Model<"openai-completions">[] = [];
	let catalogKey: string | undefined;
	let catalogBaseUrl: string | undefined;
	const auth = envApiKeyAuth("Modal proxy token (wk-<id>.ws-<secret>)", [
		"MODAL_PROXY_TOKEN",
	]);
	const provider = createProvider<"openai-completions">({
		id: "modal",
		name: "Modal",
		baseUrl: "https://inference.us-west.modal.direct/v1",
		auth: {
			apiKey: {
				...auth,
				login: async (interaction) => {
					interaction.signal.throwIfAborted();
					const key = await interaction.prompt({
						type: "secret",
						message: `Enter ${auth.name}`,
					});
					interaction.signal.throwIfAborted();
					const baseUrl = "https://inference.us-west.modal.direct/v1";
					const models = await discover(key, baseUrl, interaction.signal);
					catalog = models;
					catalogKey = key;
					catalogBaseUrl = baseUrl;
					return { type: "api_key", key };
				},
				resolve: async (input) => {
					const result = await auth.resolve(input);
					if (result?.auth.apiKey !== catalogKey) catalog = [];
					return result;
				},
			},
		},
		models: [],
		api: openAICompletionsApi(),
	});
	return {
		...provider,
		getModels: () => catalog,
		getAllModels: () => catalog,
		refreshModels: async (context) => {
			if (
				!context.allowNetwork ||
				context.credential?.type !== "api_key" ||
				!context.credential.key
			)
				return;
			const key = context.credential.key;
			const baseUrl = (context.baseUrl ?? (provider.baseUrl as string)).replace(
				/\/+$/,
				"",
			);
			if (key !== catalogKey || baseUrl !== catalogBaseUrl) {
				if (
					!(await context.publish({
						update: () => {
							catalog = [];
							catalogKey = key;
							catalogBaseUrl = baseUrl;
						},
					}))
				)
					return;
			}
			const models = await discover(key, baseUrl, context.signal);
			await context.publish({
				update: () => {
					catalog = models;
				},
			});
		},
	};
}

export default async function modal(pi: ExtensionAPI) {
	const provider = createModalProvider();
	// Pi's initial extension refresh is cache-only, so discover before registration.
	const runtime = await ModelRuntime.create({ refreshOnCreate: false });
	runtime.registerNativeProvider(provider);
	const { errors } = await runtime.refresh({
		providers: ["modal"],
		allowNetwork: true,
		signal: AbortSignal.timeout(15_000),
	});
	pi.registerProvider(provider);
	const error = errors.get("modal");
	if (error)
		pi.on("session_start", (_event, context) => {
			context.ui.notify(error.message, "warning");
		});
}
