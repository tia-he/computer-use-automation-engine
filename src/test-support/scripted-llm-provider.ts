import { ConversationTurn, LlmProvider, ToolInvocation } from "../discovery/llm-provider";

/**
 * Test double for LlmProvider. Either a fixed array (repeats its last entry
 * once exhausted) or a function of (turns, callIndex) for scripts that need
 * to read the live observation — e.g. extracting a dynamic value it just
 * saw on the page.
 */
export class ScriptedLlmProvider implements LlmProvider {
  private callIndex = 0;

  constructor(
    private readonly script: ToolInvocation[] | ((turns: ConversationTurn[], callIndex: number) => ToolInvocation)
  ) {}

  async decide(input: { turns: ConversationTurn[] }): Promise<ToolInvocation> {
    const index = this.callIndex++;
    if (Array.isArray(this.script)) {
      return this.script[Math.min(index, this.script.length - 1)];
    }
    return this.script(input.turns, index);
  }
}
