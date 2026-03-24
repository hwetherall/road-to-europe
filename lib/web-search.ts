const SERPER_API_KEY = process.env.SERPER_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

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
      .map((r) => {
        const content = r.snippet?.slice(0, 250) ?? '';
        return `- ${r.title ?? 'Result'}: ${content}${r.link ? ` [${r.link}]` : ''}`;
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
      .map((r) => {
        const content = r.content?.slice(0, 250) ?? '';
        return `- ${r.title ?? 'Result'}: ${content}${r.url ? ` [${r.url}]` : ''}`;
      })
      .join('\n');
    parts.push(`\nTop results:\n${snippets}`);
  }

  return parts.join('\n') || 'No results found.';
}

async function searchWithSerper(query: string): Promise<string | null> {
  if (!SERPER_API_KEY) return null;

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': SERPER_API_KEY,
      },
      body: JSON.stringify({
        q: query,
        num: 5,
      }),
    });

    if (response.ok) {
      const data: SerperResponse = await response.json();
      return summariseSerperResults(data);
    }

    console.error('Serper search failed with status:', response.status);
    return null;
  } catch (e) {
    console.error('Serper search failed:', e);
    return null;
  }
}

async function searchWithTavily(query: string): Promise<string | null> {
  if (!TAVILY_API_KEY) return null;

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return summariseTavilyResults(data);
    }

    console.error('Tavily search failed with status:', response.status);
    return null;
  } catch (e) {
    console.error('Tavily search failed:', e);
    return null;
  }
}

/**
 * Execute a web search using Serper (primary) with Tavily as fallback.
 */
export async function executeWebSearch(query: string): Promise<string> {
  // Primary: Serper
  const serperResult = await searchWithSerper(query);
  if (serperResult) return serperResult;

  // Fallback: Tavily
  const tavilyResult = await searchWithTavily(query);
  if (tavilyResult) return tavilyResult;

  return '[Search unavailable — neither SERPER_API_KEY nor TAVILY_API_KEY are configured or working.]';
}
