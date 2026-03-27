function getSerperKey() {
  return process.env.SERPER_API_KEY;
}

function getTavilyKey() {
  return process.env.TAVILY_API_KEY;
}

interface SerperResult {
  title?: string;
  snippet?: string;
  link?: string;
}

interface SerperResponse {
  answerBox?: { answer?: string; snippet?: string };
  organic?: SerperResult[];
  knowledgeGraph?: { description?: string };
}

export interface WebSearchExecution {
  query: string;
  provider: 'serper' | 'tavily' | 'unavailable';
  resultCount: number;
  summary: string;
}

function summariseSerperResults(data: SerperResponse): string {
  const parts: string[] = [];

  if (data.answerBox?.answer) {
    parts.push(`Summary: ${data.answerBox.answer}`);
  } else if (data.answerBox?.snippet) {
    parts.push(`Summary: ${data.answerBox.snippet}`);
  } else if (data.knowledgeGraph?.description) {
    parts.push(`Summary: ${data.knowledgeGraph.description}`);
  }

  if (data.organic?.length) {
    const snippets = data.organic
      .slice(0, 3)
      .map((result) => {
        const content = result.snippet?.slice(0, 250) ?? '';
        return `- ${result.title ?? 'Result'}: ${content}${result.link ? ` [${result.link}]` : ''}`;
      })
      .join('\n');
    parts.push(`\nTop results:\n${snippets}`);
  }

  return parts.join('\n') || 'No results found.';
}

function summariseTavilyResults(data: {
  answer?: string;
  results?: Array<{ title?: string; content?: string; url?: string }>;
}): string {
  const parts: string[] = [];

  if (data.answer) {
    parts.push(`Summary: ${data.answer}`);
  }

  if (data.results?.length) {
    const snippets = data.results
      .slice(0, 3)
      .map((result) => {
        const content = result.content?.slice(0, 250) ?? '';
        return `- ${result.title ?? 'Result'}: ${content}${result.url ? ` [${result.url}]` : ''}`;
      })
      .join('\n');
    parts.push(`\nTop results:\n${snippets}`);
  }

  return parts.join('\n') || 'No results found.';
}

async function searchWithSerper(query: string): Promise<WebSearchExecution | null> {
  const key = getSerperKey();
  if (!key) {
    console.warn('[web-search] SERPER_API_KEY not found in env, skipping Serper');
    return null;
  }

  try {
    console.log(`[web-search] Serper request: "${query.slice(0, 80)}"`);
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': key,
      },
      body: JSON.stringify({
        q: query,
        num: 5,
      }),
    });

    if (response.ok) {
      const data: SerperResponse = await response.json();
      console.log(`[web-search] Serper OK - ${data.organic?.length ?? 0} results`);
      return {
        query,
        provider: 'serper',
        resultCount: data.organic?.length ?? 0,
        summary: summariseSerperResults(data),
      };
    }

    const errorBody = await response.text().catch(() => '');
    console.error(`[web-search] Serper failed (${response.status}):`, errorBody.slice(0, 200));
    return null;
  } catch (error) {
    console.error('[web-search] Serper network error:', error);
    return null;
  }
}

async function searchWithTavily(query: string): Promise<WebSearchExecution | null> {
  const key = getTavilyKey();
  if (!key) {
    console.warn('[web-search] TAVILY_API_KEY not found in env, skipping Tavily');
    return null;
  }

  try {
    console.log(`[web-search] Tavily fallback request: "${query.slice(0, 80)}"`);
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`[web-search] Tavily OK - ${data.results?.length ?? 0} results`);
      return {
        query,
        provider: 'tavily',
        resultCount: data.results?.length ?? 0,
        summary: summariseTavilyResults(data),
      };
    }

    const errorBody = await response.text().catch(() => '');
    console.error(`[web-search] Tavily failed (${response.status}):`, errorBody.slice(0, 200));
    return null;
  } catch (error) {
    console.error('[web-search] Tavily network error:', error);
    return null;
  }
}

export async function executeWebSearchDetailed(query: string): Promise<WebSearchExecution> {
  const serperResult = await searchWithSerper(query);
  if (serperResult) return serperResult;

  const tavilyResult = await searchWithTavily(query);
  if (tavilyResult) return tavilyResult;

  console.error('[web-search] Both Serper and Tavily failed/unavailable for query:', query.slice(0, 80));
  return {
    query,
    provider: 'unavailable',
    resultCount: 0,
    summary: '[Search unavailable - neither SERPER_API_KEY nor TAVILY_API_KEY are configured or working.]',
  };
}

export async function executeWebSearch(query: string): Promise<string> {
  const execution = await executeWebSearchDetailed(query);
  return execution.summary;
}
