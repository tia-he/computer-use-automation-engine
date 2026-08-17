export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's input object. */
  inputSchema: Record<string, unknown>;
}

/**
 * Provider-agnostic conversation shape. A concrete provider maps this to
 * its own wire format (e.g. Anthropic's tool_use/tool_result message
 * blocks) internally — nothing outside that one file needs to know it.
 */
export type ConversationTurn =
  | { role: "observation"; text: string }
  | { role: "action"; toolName: string; input: Record<string, unknown> };

export interface ToolInvocation {
  toolName: string;
  input: Record<string, unknown>;
  /** Short, optional — never the model's full chain-of-thought. */
  reasoningSummary?: string;
}

export interface LlmProvider {
  decide(input: { system: string; tools: ToolSchema[]; turns: ConversationTurn[] }): Promise<ToolInvocation>;
}
