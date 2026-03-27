import { ToolCall } from '@/lib/chat-types';

type ChatStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'final'; data: Record<string, unknown> }
  | { type: 'error'; message: string };

interface ConsumeHandlers {
  onStatus?: (message: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onFinal: (data: Record<string, unknown>) => void;
  onError?: (message: string) => void;
}

function mergeToolCalls(existing: ToolCall[], incoming: ToolCall): ToolCall[] {
  const idx = existing.findIndex((tc) => tc.id === incoming.id);
  if (idx === -1) return [...existing, incoming];
  const next = [...existing];
  next[idx] = { ...next[idx], ...incoming };
  return next;
}

export function upsertToolCall(existing: ToolCall[] | undefined, incoming: ToolCall): ToolCall[] {
  return mergeToolCalls(existing ?? [], incoming);
}

export async function consumeChatStream(response: Response, handlers: ConsumeHandlers): Promise<void> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  // Backward compatibility if endpoint returns plain JSON.
  if (contentType.includes('application/json')) {
    const data = (await response.json()) as Record<string, unknown>;
    handlers.onFinal(data);
    return;
  }

  if (!response.body) {
    handlers.onError?.('No response body returned from chat endpoint.');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalReceived = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const dataLine = frame
        .split('\n')
        .find((line) => line.startsWith('data:'));
      if (!dataLine) continue;

      const payload = dataLine.slice(5).trim();
      if (!payload) continue;

      let event: ChatStreamEvent;
      try {
        event = JSON.parse(payload) as ChatStreamEvent;
      } catch {
        continue;
      }

      if (event.type === 'status') {
        handlers.onStatus?.(event.message);
      } else if (event.type === 'tool_call') {
        handlers.onToolCall?.(event.toolCall);
      } else if (event.type === 'final') {
        finalReceived = true;
        handlers.onFinal(event.data);
      } else if (event.type === 'error') {
        handlers.onError?.(event.message);
      }
    }
  }

  if (!finalReceived) {
    handlers.onError?.('Chat stream ended before a final response was received.');
  }
}
