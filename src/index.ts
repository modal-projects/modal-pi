import { createProvider, envApiKeyAuth } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function createModalProvider() {
	return createProvider<"openai-completions">({
		id: "modal",
		name: "Modal",
		baseUrl: "https://inference.us-west.modal.direct/v1",
		auth: {
			apiKey: envApiKeyAuth("Modal proxy token (wk-<id>.ws-<secret>)", [
				"MODAL_PROXY_TOKEN",
			]),
		},
		models: [],
		api: openAICompletionsApi(),
	});
}

export default function modal(pi: ExtensionAPI) {
	pi.registerProvider(createModalProvider());
}
