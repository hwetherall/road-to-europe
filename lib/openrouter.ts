// ── Shared OpenRouter Client ──

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

export interface OpenRouterMessage {
  role: string;
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface OpenRouterFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type OpenRouterServerToolType = `openrouter:${string}`;

export interface OpenRouterServerTool {
  type: OpenRouterServerToolType;
}

export type OpenRouterTool = OpenRouterFunctionTool | OpenRouterServerTool;

export interface OpenRouterResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
}

export class OpenRouterError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
  }
}

export async function callOpenRouter(
  messages: OpenRouterMessage[],
  options: {
    model?: string;
    tools?: OpenRouterTool[];
    maxTokens?: number;
    responseFormat?: OpenRouterResponseFormat;
    /** @deprecated Use tools: [{ type: "openrouter:web_search" }] instead */
    plugins?: Array<{ id: string; max_results?: number }>;
  } = {}
): Promise<OpenRouterMessage> {
  const {
    model = 'anthropic/claude-opus-4.6',
    tools,
    maxTokens = 400000,
    responseFormat,
    plugins,
  } = options;

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
  };
  if (tools && tools.length > 0) body.tools = tools;
  if (responseFormat) body.response_format = responseFormat;
  if (plugins && plugins.length > 0) body.plugins = plugins;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let providerMessage = '';

    try {
      const parsed = JSON.parse(errorText);
      providerMessage =
        parsed?.error?.message ??
        parsed?.message ??
        parsed?.error ??
        '';
    } catch {
      providerMessage = errorText;
    }

    const trimmedMessage = typeof providerMessage === 'string' ? providerMessage.trim() : '';
    console.error('OpenRouter error:', trimmedMessage || errorText);

    if (response.status === 402) {
      throw new OpenRouterError(
        402,
        'OpenRouter credits/billing issue (HTTP 402). Add credits or switch to a cheaper model in OpenRouter.'
      );
    }

    throw new OpenRouterError(
      response.status,
      trimmedMessage || `OpenRouter API error: ${response.status}`
    );
  }

  const data = await response.json();
  return data.choices?.[0]?.message ?? { role: 'assistant', content: '' };
}
