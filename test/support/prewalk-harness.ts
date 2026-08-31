import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerPrewalk } from "../../src/prewalk.ts";
import type {
  TrajectoryRouter,
  TransitionResult,
  TransitionTarget,
} from "../../src/trajectory-router/index.ts";

type Handler = (event: any, context: ExtensionContext) => unknown;

export function fakeModel(provider: string, id: string): Model<any> {
  return {
    provider,
    id,
    name: id,
    api: "openai-completions",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  } as Model<any>;
}

export function createHarness(options: {
  router?: { result?: TransitionResult };
  activeTools?: string[];
  models?: Model<any>[];
  currentModel?: Model<any>;
  unauthenticated?: string[];
} = {}) {
  const handlers = new Map<string, Handler[]>();
  const eventHandlers = new Map<string, Set<(data: unknown) => void>>();
  const commands = new Map<string, {
    handler(args: string, context: ExtensionContext): unknown;
    getArgumentCompletions?(prefix: string): Array<{ value: string; label: string }> | null;
  }>();
  const sent: Array<{ message: any; options: any }> = [];
  const notifications: Array<{ message: string; level?: string }> = [];
  const statuses = new Map<string, string>();
  const entries: any[] = [];
  const transitionRequests: TransitionTarget[] = [];
  const flags = new Map<string, boolean | string>();
  const models = options.models ?? [fakeModel("frontier", "architect"), fakeModel("fast", "executor")];
  const activeTools = options.activeTools ?? ["read", "bash", "edit", "write", "todo"];

  const events = {
    emit(channel: string, data: unknown) {
      for (const handler of eventHandlers.get(channel) ?? []) handler(data);
    },
    on(channel: string, handler: (data: unknown) => void) {
      const channelHandlers = eventHandlers.get(channel) ?? new Set();
      channelHandlers.add(handler);
      eventHandlers.set(channel, channelHandlers);
      return () => channelHandlers.delete(handler);
    },
  };

  const context = {
    ui: {
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
      setStatus(key: string, value?: string) {
        if (value === undefined) statuses.delete(key);
        else statuses.set(key, value);
      },
      theme: { fg: (_color: string, value: string) => value },
    },
    hasUI: true,
    cwd: process.cwd(),
    sessionManager: {
      getEntries: () => entries,
      getBranch: () => entries,
    },
    modelRegistry: {
      getAvailable: () => models,
      hasConfiguredAuth: (model: Model<any>) => !options.unauthenticated?.includes(`${model.provider}/${model.id}`),
    },
    model: options.currentModel ?? models[0],
    isIdle: () => true,
    signal: undefined,
    abort() {},
    hasPendingMessages: () => false,
    shutdown() {},
    getContextUsage: () => undefined,
    compact() {},
    getSystemPrompt: () => "",
  } as unknown as ExtensionContext;

  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    registerFlag() {},
    getFlag: (name: string) => flags.get(name),
    sendMessage(message: any, messageOptions: any) {
      sent.push({ message, options: messageOptions });
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data });
    },
    getActiveTools: () => activeTools,
    events,
  } as unknown as ExtensionAPI;

  const router: TrajectoryRouter = {
    async transitionTo(target) {
      transitionRequests.push(target);
      return options.router?.result ?? {
        status: "changed",
        previous: { provider: "frontier", model: "architect", thinkingLevel: "high" },
        current: {
          provider: target.provider,
          model: target.model,
          thinkingLevel: target.thinkingLevel ?? "high",
        },
        thinking: {
          requested: target.thinkingLevel ?? "high",
          effective: target.thinkingLevel ?? "high",
          clamped: false,
        },
        transitionPoint: { sessionId: "session-1", branchLeafId: "entry-4" },
      };
    },
  };

  registerPrewalk(pi, router);

  async function emit(name: string, event: unknown) {
    const results = [];
    for (const handler of handlers.get(name) ?? []) results.push(await handler(event, context));
    return results;
  }

  return {
    entries,
    flags,
    notifications,
    sent,
    statuses,
    transitionRequests,
    async start() {
      await emit("session_start", { type: "session_start", reason: "startup" });
    },
    async command(args: string) {
      await commands.get("prewalk")?.handler(args, context);
    },
    complete(prefix: string) {
      return commands.get("prewalk")?.getArgumentCompletions?.(prefix) ?? null;
    },
    async prompt(text = "sample task") {
      const results = await emit("before_agent_start", {
        type: "before_agent_start",
        prompt: text,
        images: [],
        systemPrompt: "",
      });
      return results.flatMap((result) => {
        const message = (result as { message?: any } | undefined)?.message;
        return message ? [message] : [];
      });
    },
    async tool(toolName: string, isError = false, details?: unknown) {
      await emit("tool_result", { type: "tool_result", toolName, toolCallId: `${toolName}-1`, input: {}, content: [], details, isError });
    },
    async turn(textOnly = true) {
      await emit("turn_end", {
        type: "turn_end",
        turnIndex: 1,
        message: {
          role: "assistant",
          content: textOnly
            ? [{ type: "text", text: "planning" }]
            : [{ type: "toolCall", id: "read-1", name: "read", arguments: {} }],
        },
        toolResults: [],
      });
    },
    async filter(messages: any[]) {
      const [result] = await emit("context", { type: "context", messages });
      return (result as { messages?: any[] } | undefined)?.messages ?? messages;
    },
  };
}
