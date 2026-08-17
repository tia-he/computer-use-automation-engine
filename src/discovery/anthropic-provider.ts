import Anthropic from "@anthropic-ai/sdk";
import { ConversationTurn, LlmProvider, ToolInvocation, ToolSchema } from "./llm-provider";

export const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * The only module in this codebase allowed to import "@anthropic-ai/sdk".
 * Everything it exposes (LlmProvider, ToolSchema, ConversationTurn,
 * ToolInvocation) is plain data — no Anthropic SDK type leaks past this file.
 */
export class AnthropicLlmProvider implements LlmProvider {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string = DEFAULT_MODEL
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async decide(input: { system: string; tools: ToolSchema[]; turns: ConversationTurn[] }): Promise<ToolInvocation> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: input.system,
      tools: input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
      tool_choice: { type: "any" },
      messages: this.buildMessages(input.turns),
    });

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (!toolUse) {
      throw new Error("model response contained no tool_use block despite forced tool_choice");
    }
    const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");

    return {
      toolName: toolUse.name,
      input: toolUse.input as Record<string, unknown>,
      reasoningSummary: textBlock?.text ? textBlock.text.slice(0, 300) : undefined,
    };
  }

  /**
   * Every "observation" turn after the first doubles as the tool_result for
   * the immediately preceding "action" turn — the observation text already
   * embeds the last action's outcome, so no separate result turn is needed.
   */
  private buildMessages(turns: ConversationTurn[]): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];
    let pendingToolUseId: string | null = null;

    for (const turn of turns) {
      if (turn.role === "observation") {
        if (pendingToolUseId) {
          messages.push({
            role: "user",
            content: [{ type: "tool_result", tool_use_id: pendingToolUseId, content: turn.text }],
          });
          pendingToolUseId = null;
        } else {
          messages.push({ role: "user", content: turn.text });
        }
      } else {
        const id = `tool_${messages.length}`;
        messages.push({ role: "assistant", content: [{ type: "tool_use", id, name: turn.toolName, input: turn.input }] });
        pendingToolUseId = id;
      }
    }

    return messages;
  }
}
