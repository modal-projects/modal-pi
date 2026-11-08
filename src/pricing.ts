import type { ModelCost } from "@earendil-works/pi-ai";

// USD per million tokens: https://modal.com/docs/guide/supported-models
const rates: Record<string, [input: number, output: number, cached: number]> = {
	"nvidia/GLM-5.3-Flash-NVFP4": [0.15, 0.5, 0.03],
	"deepseek-ai/DeepSeek-V4.1-Flash-1017": [0.25, 1, 0.005],
	"deepseek-ai/DeepSeek-V4.1-Flash": [0.3, 1.2, 0.03],
	"zai-org/GLM-5.3-Flash": [0.45, 1.5, 0.09],
	"meta-models/Muse-Spark-Open-816B-A42B": [1.25, 4.25, 0.15],
	"zai-org/GLM-5.3": [1.4, 4.4, 0.26],
	"thinkingmachines/Inkling-NVFP4": [1.2, 5, 0.27],
	"Qwen/Qwen3.8-2.4T-A95B": [2, 6, 0.25],
	"Qwen/Qwen3.8-Max-VL-Thinking": [2, 6, 0.25],
	"moonshotai/Kimi-K3.1-Pro": [2, 10, 0.2],
	"moonshotai/Kimi-K3": [3, 15, 0.3],
};

export function modelCost(baseModelId: string): ModelCost | undefined {
	const rate = Object.hasOwn(rates, baseModelId)
		? rates[baseModelId]
		: undefined;
	if (!rate) return undefined;
	const [input, output, cacheRead] = rate;
	return { input, output, cacheRead, cacheWrite: 0 };
}
