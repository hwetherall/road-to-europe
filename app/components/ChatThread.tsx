'use client';

import { useEffect, useRef } from 'react';
import { ChatMessage, ScenarioModification, ProposedOption } from '@/lib/chat-types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text: string): string {
  let html = escapeHtml(text);
  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white/90 font-semibold">$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong class="text-white/90 font-semibold">$1</strong>');
  // Italic: *text* or _text_ (but not inside words with underscores)
  html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<em>$1</em>');
  html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>');
  // Inline code: `text`
  html = html.replace(/`([^`]+?)`/g, '<code class="bg-white/[0.08] px-1 rounded text-[11px]">$1</code>');
  return html;
}

interface Props {
  messages: ChatMessage[];
  accentColor: string;
  onApplyModification: (modification: ScenarioModification, messageId: string) => void;
  onApplyOption: (option: ProposedOption, messageId: string) => void;
  appliedMessageIds: Set<string>;
}

function ModificationCard({
  modification,
  onApply,
  applied,
}: {
  modification: ScenarioModification;
  onApply: () => void;
  applied: boolean;
}) {
  return (
    <div className="mt-2 rounded-lg border border-white/[0.10] bg-white/[0.03] p-3">
      <div className="text-[10px] text-white/40 tracking-wider uppercase mb-1.5">
        Proposed Modification
      </div>
      <div className="text-xs text-white/70 mb-2">{modification.description}</div>
      {modification.teamModifications.map((tm, i) => (
        <div key={i} className="text-[11px] text-white/50 mb-1">
          <span className="font-semibold text-white/70">{tm.team}</span>:{' '}
          home {tm.homeWinDelta > 0 ? '+' : ''}
          {(tm.homeWinDelta * 100).toFixed(0)}pp, draw{' '}
          {tm.drawDelta > 0 ? '+' : ''}
          {(tm.drawDelta * 100).toFixed(0)}pp, away{' '}
          {tm.awayWinDelta > 0 ? '+' : ''}
          {(tm.awayWinDelta * 100).toFixed(0)}pp
        </div>
      ))}
      {applied ? (
        <div className="mt-2 text-[11px] text-green-400/70">Applied</div>
      ) : (
        <div className="flex gap-2 mt-2">
          <button
            onClick={onApply}
            className="px-3 py-1.5 rounded text-[11px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors cursor-pointer"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

function OptionCard({
  option,
  index,
  onApply,
  applied,
}: {
  option: ProposedOption;
  index: number;
  onApply: () => void;
  applied: boolean;
}) {
  const label = String.fromCharCode(65 + index); // A, B, C...
  return (
    <div className="mt-2 rounded-lg border border-white/[0.10] bg-white/[0.03] p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-5 h-5 rounded-full bg-white/[0.08] text-[10px] font-bold flex items-center justify-center text-white/60">
          {label}
        </span>
        <span className="text-[11px] text-white/70 font-semibold">{option.title}</span>
        {option.confidence && (
          <span className={`text-[9px] tracking-wider uppercase ${
            option.confidence === 'high' ? 'text-green-400/60' : option.confidence === 'medium' ? 'text-amber-400/60' : 'text-red-400/60'
          }`}>
            {option.confidence}
          </span>
        )}
      </div>
      {option.modification?.teamModifications.map((tm, i) => (
        <div key={i} className="text-[11px] text-white/50 mb-1">
          <span className="font-semibold text-white/70">{tm.team}</span>:{' '}
          home {tm.homeWinDelta > 0 ? '+' : ''}{(tm.homeWinDelta * 100).toFixed(0)}pp,{' '}
          draw {tm.drawDelta > 0 ? '+' : ''}{(tm.drawDelta * 100).toFixed(0)}pp,{' '}
          away {tm.awayWinDelta > 0 ? '+' : ''}{(tm.awayWinDelta * 100).toFixed(0)}pp
        </div>
      ))}
      {option.fixtureLock && (
        <div className="text-[11px] text-white/50">
          Lock: {option.fixtureLock.fixtureId} &rarr; {option.fixtureLock.result}
        </div>
      )}
      {applied ? (
        <div className="mt-2 text-[11px] text-green-400/70">Applied</div>
      ) : (
        <button
          onClick={onApply}
          className="mt-2 px-3 py-1.5 rounded text-[11px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors cursor-pointer"
        >
          Apply
        </button>
      )}
    </div>
  );
}

function ToolCallDisplay({ toolCall }: { toolCall: { query: string; status: string } }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-white/30 mt-1">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" />
        <path d="M4 6L5.5 7.5L8 4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
      <span className="italic truncate">{toolCall.query}</span>
      {toolCall.status === 'pending' && (
        <span className="text-amber-400/50 ml-1">searching...</span>
      )}
    </div>
  );
}

export default function ChatThread({ messages, accentColor, onApplyModification, onApplyOption, appliedMessageIds }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-white/25 text-sm mb-2">No messages yet</div>
          <div className="text-white/20 text-xs">
            Ask about a match outcome or type a scenario to explore.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
      {messages.map((msg) => {
        if (msg.role === 'system') {
          return (
            <div key={msg.id} className="text-center text-[11px] text-white/25 py-1">
              {msg.content}
            </div>
          );
        }

        const isUser = msg.role === 'user';

        return (
          <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                isUser
                  ? 'text-white'
                  : 'bg-white/[0.05] text-white/80 border border-white/[0.06]'
              }`}
              style={
                isUser
                  ? { background: `${accentColor}25`, border: `1px solid ${accentColor}30` }
                  : undefined
              }
            >
              {msg.isThinking && (
                <div className="flex items-center gap-1.5 text-white/30 mb-1">
                  <div className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse [animation-delay:200ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse [animation-delay:400ms]" />
                  </div>
                  <span className="text-[10px]">Thinking...</span>
                </div>
              )}

              <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />

              {msg.toolCalls?.map((tc) => (
                <ToolCallDisplay key={tc.id} toolCall={tc} />
              ))}

              {msg.proposedModification && !msg.proposedOptions && (
                <ModificationCard
                  modification={msg.proposedModification}
                  onApply={() => onApplyModification(msg.proposedModification!, msg.id)}
                  applied={appliedMessageIds.has(msg.id)}
                />
              )}

              {msg.proposedOptions && msg.proposedOptions.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {msg.proposedOptions.map((opt, i) => (
                    <OptionCard
                      key={i}
                      option={opt}
                      index={i}
                      onApply={() => onApplyOption(opt, msg.id)}
                      applied={appliedMessageIds.has(`${msg.id}-opt-${i}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
