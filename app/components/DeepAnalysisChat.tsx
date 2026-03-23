'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ChatMessage } from '@/lib/chat-types';
import { Team, SensitivityResult, DeepAnalysis } from '@/lib/types';

interface Props {
  accentColor: string;
  selectedTeam: string;
  teams: Team[];
  sensitivityResults: SensitivityResult[] | null;
  analysis: DeepAnalysis;
}

function buildAnalysisContext(analysis: DeepAnalysis, teamName: string): string {
  const { stateOfPlay, decisiveMatch, matchesToWatch, bottomLine } = analysis;
  const metricLabel = analysis.targetMetric.replace('Pct', '').replace('top', 'Top-');

  const outcomeTableStr = decisiveMatch.outcomeTable
    .map((r) => `  - ${r.result}: ${r.resultingOdds.toFixed(1)}% (${r.delta > 0 ? '+' : ''}${r.delta.toFixed(1)}pp)`)
    .join('\n');

  const risksStr = decisiveMatch.risks.map((r) => `  - ${r}`).join('\n');
  const anglesStr = decisiveMatch.angles.map((a) => `  - ${a.title}: ${a.analysis}`).join('\n');
  const watchStr = decisiveMatch.whatToWatch.map((w) => `  - ${w}`).join('\n');
  const matchesStr = matchesToWatch
    .map((m) => `  - ${m.homeTeam} vs ${m.awayTeam}: ${m.whyItMatters} (Ideal: ${m.idealResult}, Impact: ${m.simulationImpact})`)
    .join('\n');

  return `You are a Premier League football analyst assistant. The user has just read a deep analysis report about ${teamName}'s path to European qualification (2025-26 season). You have full knowledge of this analysis and can answer follow-up questions about it.

KEY FACTS FROM THE ANALYSIS:
- ${teamName} are ${stateOfPlay.position}th on ${stateOfPlay.points} points with ${stateOfPlay.gamesRemaining} matches remaining
- They need ${metricLabel} for Europe. Gap: ${stateOfPlay.gapToTarget} points
- Current ${metricLabel} probability: ~${stateOfPlay.baselineOdds.toFixed(1)}%
- Optimal path ceiling: ~${stateOfPlay.optimalPathOdds.toFixed(1)}% (plausibility: ${(stateOfPlay.optimalPathPlausibility * 100).toFixed(1)}%)

DECISIVE MATCH: ${decisiveMatch.homeTeam} vs ${decisiveMatch.awayTeam}
Outcome table:
${outcomeTableStr}

Key risks:
${risksStr}

Angles:
${anglesStr}

What to watch:
${watchStr}

MATCHES TO WATCH:
${matchesStr}

BOTTOM LINE:
${bottomLine.summary}
Key scenario: ${bottomLine.keyScenario}

Answer questions about any aspect of this analysis. Be specific, cite the numbers from the analysis, and provide additional tactical or statistical insight where relevant. Maintain the pundit-style voice — confident, analytical, direct.

IMPORTANT: This is a conversation about the analysis. Do NOT propose scenario modifications or fixture locks. Just answer questions and provide football analysis.`;
}

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`(.+?)`/g, '<code class="bg-white/10 px-1 rounded text-[11px]">$1</code>');
  html = html.replace(/\n/g, '<br />');
  return html;
}

export default function DeepAnalysisChat({ accentColor, selectedTeam, teams, sensitivityResults, analysis }: Props) {
  const teamName = teams.find((t) => t.abbr === selectedTeam)?.name ?? selectedTeam;

  const QUICK_PROMPTS = [
    `Why is ${analysis.decisiveMatch.homeTeam} vs ${analysis.decisiveMatch.awayTeam} so decisive?`,
    `What is the clearest path to ${analysis.targetThreshold}% odds?`,
    analysis.matchesToWatch[0]
      ? `Tell me more about ${analysis.matchesToWatch[0].homeTeam} vs ${analysis.matchesToWatch[0].awayTeam}`
      : 'Which non-team fixture has the highest leverage?',
  ];

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Ask me anything about this analysis — tactical details, specific fixtures, alternative scenarios, or the numbers behind any claim.',
      timestamp: Date.now(),
    },
  ]);
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasUserMessages = messages.some((m) => m.role === 'user' || m.isThinking);

  const primeInput = useCallback((value: string) => {
    setText(value);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    });
  }, []);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isProcessing) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setMessages((prev) => [...prev, userMessage]);
    setIsProcessing(true);

    const thinkingId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: thinkingId, role: 'assistant', content: '', timestamp: Date.now(), isThinking: true },
    ]);

    try {
      const conversationMessages = [...messages.filter(m => m.id !== 'welcome'), userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversationMessages,
          mode: 'fast',
          context: {
            selectedTeam,
            standings: teams,
            activeChapters: [],
            sensitivityResults: sensitivityResults?.slice(0, 10) ?? [],
            deepAnalysisContext: buildAnalysisContext(analysis, teamName),
          },
        }),
      });

      if (!res.ok) throw new Error('Chat request failed');
      const data = await res.json();

      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? { ...m, content: data.content ?? data.message ?? 'Sorry, I couldn\'t process that.', isThinking: false }
            : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? { ...m, content: 'Sorry, I couldn\'t process that. Make sure the chat API is configured.', isThinking: false }
            : m
        )
      );
    } finally {
      setIsProcessing(false);
    }
  }, [text, isProcessing, messages, selectedTeam, teams, sensitivityResults, analysis, teamName]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="font-oswald text-[11px] tracking-[0.15em] uppercase text-white/40">
          Ask About This Analysis
        </div>
      </div>

      <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {!hasUserMessages && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
            <div className="text-[9px] tracking-[0.12em] uppercase text-white/35 mb-2">Quick Prompts</div>
            <div className="grid gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  className="text-left text-[11px] text-white/70 hover:text-white transition-colors border border-white/[0.06] rounded-lg px-2.5 py-2 bg-black/20 hover:bg-black/30"
                  onClick={() => primeInput(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.isThinking) {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 max-w-[85%]">
                  <div className="flex items-center gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse"
                        style={{ animationDelay: `${i * 200}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          }

          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div
                  className="rounded-xl px-4 py-3 max-w-[85%] text-[12.5px] leading-[1.7] text-white/90"
                  style={{ background: `${accentColor}20`, border: `1px solid ${accentColor}30` }}
                >
                  {msg.content}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex justify-start">
              <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 max-w-[85%]">
                <div
                  className="text-[12.5px] text-white/70 leading-[1.7]"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-white/[0.06] px-3 py-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => { setText(e.target.value); handleInput(); }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the analysis..."
            rows={1}
            disabled={isProcessing}
            className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white/80 placeholder-white/20 resize-none outline-none focus:border-white/20 transition-colors disabled:opacity-40"
            style={{ minHeight: '38px' }}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || isProcessing}
            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: text.trim() && !isProcessing ? `${accentColor}30` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${text.trim() && !isProcessing ? `${accentColor}40` : 'rgba(255,255,255,0.08)'}`,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M12 7L2 2L4 7L2 12L12 7Z"
                stroke={text.trim() && !isProcessing ? accentColor : 'rgba(255,255,255,0.3)'}
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
