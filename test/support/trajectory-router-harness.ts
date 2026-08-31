import type { Model } from "@earendil-works/pi-ai";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTrajectoryRouter, type ThinkingLevel } from "../../src/trajectory-router/index.ts";

type Handler = (event: { type: string }, context: ExtensionContext) => void | Promise<void>;

export function routerModel(provider: string, id: string, contextWindow = 200_000): Model<any> {
  return {
    provider,
    id,
    name: id,
    api: "anthropic-messages",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: 8_192,
  } as Model<any>;
}

export function createRouterHarness(options: { idle?: boolean; setModelResult?: boolean } = {}) {
  const handlers = new Map<string, Handler[]>();
  const models = [routerModel("source", "alpha"), routerModel("target", "beta")];
  const messages = [
    { role: "user", content: "trace the fault", timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "I will inspect it." }], timestamp: 2 },
    { role: "toolResult", toolName: "read", content: [{ type: "text", text: "fault location" }], timestamp: 3 },
  ];
  const branch: Array<Record<string, unknown>> = messages.map((message, index) => ({
    type: "message",
    id: `message-${index + 1}`,
    parentId: index === 0 ? null : `message-${index}`,
    message,
  }));
  const tools = ["read", "bash", "edit", "write"];
  let currentModel = models[0]!;
  let thinkingLevel: ThinkingLevel = "medium";
  let idle = options.idle ?? true;
  let leafId = "message-3";
  let controlId = 0;
  let contextTokens: number | null = 15;
  let authenticated = true;
  let setModelCalls = 0;

  const context = {
    get model() {
      return currentModel;
    },
    isIdle: () => idle,
    modelRegistry: {
      find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
      hasConfiguredAuth: () => authenticated,
    },
    getContextUsage: () => ({ tokens: contextTokens, contextWindow: currentModel.contextWindow, percent: 1 }),
    sessionManager: {
      getSessionId: () => "session-1",
      getLeafId: () => leafId,
      getBranch: () => structuredClone(branch),
    },
  } as unknown as ExtensionContext;

  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    getActiveTools: () => [...tools],
    getThinkingLevel: () => thinkingLevel,
    setThinkingLevel(level: ThinkingLevel) {
      const effective = clampThinkingLevel(currentModel, level);
      if (effective === thinkingLevel) return;
      thinkingLevel = effective;
      const id = `thinking-${++controlId}`;
      branch.push({ type: "thinking_level_change", id, parentId: leafId, thinkingLevel: effective });
      leafId = id;
    },
    async setModel(model: Model<any>) {
      setModelCalls += 1;
      if (options.setModelResult === false) return false;
      currentModel = model;
      const id = `model-${++controlId}`;
      branch.push({ type: "model_change", id, parentId: leafId, provider: model.provider, modelId: model.id });
      leafId = id;
      return true;
    },
  } as unknown as ExtensionAPI;

  const router = createTrajectoryRouter(pi);

  async function fire(name: string) {
    for (const handler of handlers.get(name) ?? []) await handler({ type: name }, context);
  }

  return {
    context,
    models,
    pi,
    router,
    fire,
    setAuthenticated(value: boolean) {
      authenticated = value;
    },
    setContextTokens(value: number | null) {
      contextTokens = value;
    },
    setIdle(value: boolean) {
      idle = value;
    },
    setModelCalls: () => setModelCalls,
    snapshot() {
      return {
        branch: structuredClone(branch),
        messages: structuredClone(messages),
        model: { provider: currentModel.provider, id: currentModel.id },
        sessionId: context.sessionManager.getSessionId(),
        trajectory: structuredClone(branch.filter((entry) => entry.type === "message")),
        thinkingLevel,
        tools: pi.getActiveTools(),
      };
    },
  };
}
