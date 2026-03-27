import { callOpenRouter, OpenRouterMessage, OpenRouterTool } from '@/lib/openrouter';

// ── Types ──

export interface ToolCallRecord {
  round: number;
  toolName: string;
  args: unknown;
  result: unknown;
}

export interface AgentLoopConfig {
  systemPrompt: string;
  userPrompt: string;
  tools: OpenRouterTool[];
  toolExecutors: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
  maxRounds?: number;
  maxTokens?: number;
  model?: string;
  onToolCall?: (toolName: string, args: unknown) => void;
}

export interface AgentLoopResult {
  finalContent: string;
  toolCallLog: ToolCallRecord[];
  rounds: number;
  llmCalls: number;
}

// ── Agent Loop ──

export async function agentLoop(config: AgentLoopConfig): Promise<AgentLoopResult> {
  const {
    systemPrompt,
    userPrompt,
    tools,
    toolExecutors,
    maxRounds = 20,
    maxTokens = 4000,
    model,
    onToolCall,
  } = config;

  const conversation: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const toolCallLog: ToolCallRecord[] = [];
  let llmCalls = 0;

  for (let round = 0; round < maxRounds; round++) {
    llmCalls++;
    const message = await callOpenRouter(conversation, {
      model,
      tools,
      maxTokens,
    });

    // If no tool calls, agent is done
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return {
        finalContent: message.content ?? '',
        toolCallLog,
        rounds: round + 1,
        llmCalls,
      };
    }

    // Add the assistant message (with tool_calls) to conversation
    conversation.push(message);

    // Execute each tool call
    for (const call of message.tool_calls) {
      const toolName = call.function.name;
      const executor = toolExecutors[toolName];

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        args = { raw: call.function.arguments };
      }

      onToolCall?.(toolName, args);

      let result: unknown;
      if (executor) {
        try {
          result = await executor(args);
        } catch (e) {
          result = { error: e instanceof Error ? e.message : 'Tool execution failed' };
        }
      } else {
        result = { error: `Unknown tool: ${toolName}` };
      }

      toolCallLog.push({ round, toolName, args, result });

      // Add tool result to conversation
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }

  // Max rounds hit — force a final response without tools
  conversation.push({
    role: 'user',
    content: 'You have reached the maximum number of tool calls. Please output your final answer now based on everything you have gathered so far.',
  });

  llmCalls++;
  const finalMessage = await callOpenRouter(conversation, { model, maxTokens });

  return {
    finalContent: finalMessage.content ?? '',
    toolCallLog,
    rounds: maxRounds,
    llmCalls,
  };
}
