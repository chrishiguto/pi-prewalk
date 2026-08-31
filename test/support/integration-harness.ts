import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "../../src/trajectory-router/index.ts";
import { fakeModel } from "./prewalk-harness.ts";

type Factory = (pi: ExtensionAPI) => void;
type Handler = (event: any, context: ExtensionContext) => unknown;

export function createIntegrationHarness(factories: Factory[], options: {
  models?: Model<any>[];
  contextTokens?: number;
  idle?: boolean;
  setModelResult?: boolean;
} = {}) {
  const handlers = new Map<string, Handler[]>();
  const bus = new Map<string, Set<(data: unknown) => void>>();
  const commands = new Map<string, { handler(args: string, context: ExtensionContext): unknown }>();
  const sent: Array<{ message: any; options: any }> = [];
  const notifications: Array<{ message: string; level?: string }> = [];
  const statuses = new Map<string, string>();
  const entries: any[] = [];
  const tools = ["read", "bash", "edit", "write", "todo"];
  const flags = new Map<string, boolean | string>();
  const models = options.models ?? [fakeModel("frontier", "architect"), fakeModel("fast", "executor")];
  let selected = models[0]!;
  let thinking: ThinkingLevel = "high";
  let idle = options.idle ?? true;
  let sessionMutations = 0;

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
      getSessionId: () => "session-1",
      getLeafId: () => "leaf-1",
    },
    modelRegistry: {
      getAvailable: () => models,
      find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
      hasConfiguredAuth: () => true,
    },
    get model() {
      return selected;
    },
    isIdle: () => idle,
    signal: undefined,
    abort() {},
    hasPendingMessages: () => false,
    shutdown() {},
    getContextUsage: () => ({ tokens: options.contextTokens ?? 1_000, contextWindow: selected.contextWindow, percent: 1 }),
    compact() {},
    getSystemPrompt: () => "",
    newSession: () => { sessionMutations += 1; },
    fork: () => { sessionMutations += 1; },
    navigateTree: () => { sessionMutations += 1; },
    switchSession: () => { sessionMutations += 1; },
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
    sendMessage(message: any, options: any) {
      sent.push({ message, options });
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data });
    },
    getActiveTools: () => tools,
    setModel: async (model: Model<any>) => {
      if (options.setModelResult === false) return false;
      selected = model;
      return true;
    },
    getThinkingLevel: () => thinking,
    setThinkingLevel: (level: ThinkingLevel) => {
      thinking = level;
    },
    events: {
      emit(channel: string, data: unknown) {
        for (const listener of bus.get(channel) ?? []) listener(data);
      },
      on(channel: string, listener: (data: unknown) => void) {
        const listeners = bus.get(channel) ?? new Set();
        listeners.add(listener);
        bus.set(channel, listeners);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as ExtensionAPI;

  for (const factory of factories) factory(pi);

  async function emit(name: string, event: unknown) {
    const results = [];
    for (const handler of handlers.get(name) ?? []) results.push(await handler(event, context));
    return results;
  }

  return {
    sent,
    notifications,
    statuses,
    flags,
    activeTools: () => [...tools],
    currentModel: () => ({ provider: selected.provider, model: selected.id }),
    thinking: () => thinking,
    continuity: () => ({ session: "session-1", leaf: "leaf-1" }),
    sessionMutations: () => sessionMutations,
    setIdle(value: boolean) {
      idle = value;
    },
    async settle() {
      await emit("agent_settled", { type: "agent_settled" });
    },
    async start() {
      await emit("session_start", { type: "session_start", reason: "startup" });
    },
    async command(args: string) {
      await commands.get("prewalk")?.handler(args, context);
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
    async tool(toolName: string) {
      await emit("tool_result", { type: "tool_result", toolName, toolCallId: `${toolName}-1`, input: {}, content: [], details: undefined, isError: false });
    },
    async filter(messages: any[]) {
      const [result] = await emit("context", { type: "context", messages });
      return (result as { messages?: any[] } | undefined)?.messages ?? messages;
    },
  };
}
