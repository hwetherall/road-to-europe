'use client';

import { useEffect, useRef, useState } from 'react';
import { ChatMessage, ScenarioModification, ProposedOption, TeamFixtureLock } from '@/lib/chat-types';

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
  onApplyOption: (option: ProposedOption, messageId: string, optionIndex: number) => void;
  onUnapply: (appliedKey: string) => void;
  appliedMessageIds: Set<string>;
}

/** Small inline pp input used in tweak mode. */
function DeltaInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const ppValue = Math.round(value * 100);
  return (
    <label className="inline-flex items-center gap-0.5 text-[11px] text-white/50">
      <span className="text-white/40">{label}</span>
      <input
        type="number"
        value={ppValue}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-10 bg-white/[0.06] border border-white/[0.12] rounded px-1 py-0.5 text-[11px] text-white/80 text-center outline-none focus:border-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="text-white/30">pp</span>
    </label>
  );
}

/** Display a team modification row (read-only). */
function TeamModRow({ tm }: { tm: { team: string; homeWinDelta: number; drawDelta: number; awayWinDelta: number } }) {
  return (
    <div className="text-[11px] text-white/50 mb-1">
      <span className="font-semibold text-white/70">{tm.team}</span>:{' '}
      home {tm.homeWinDelta > 0 ? '+' : ''}
      {(tm.homeWinDelta * 100).toFixed(0)}pp, draw{' '}
      {tm.drawDelta > 0 ? '+' : ''}
      {(tm.drawDelta * 100).toFixed(0)}pp, away{' '}
      {tm.awayWinDelta > 0 ? '+' : ''}
      {(tm.awayWinDelta * 100).toFixed(0)}pp
    </div>
  );
}

/** Editable team modification row. */
function TeamModEditRow({
  tm,
  onChange,
}: {
  tm: { team: string; homeWinDelta: number; drawDelta: number; awayWinDelta: number };
  onChange: (updated: typeof tm) => void;
}) {
  return (
    <div className="text-[11px] text-white/50 mb-1.5">
      <span className="font-semibold text-white/70 mr-1.5">{tm.team}</span>
      <div className="flex flex-wrap gap-x-2 gap-y-1 mt-0.5">
        <DeltaInput label="home" value={tm.homeWinDelta} onChange={(v) => onChange({ ...tm, homeWinDelta: v })} />
        <DeltaInput label="draw" value={tm.drawDelta} onChange={(v) => onChange({ ...tm, drawDelta: v })} />
        <DeltaInput label="away" value={tm.awayWinDelta} onChange={(v) => onChange({ ...tm, awayWinDelta: v })} />
      </div>
    </div>
  );
}

function ModificationCard({
  modification,
  onApply,
  onUnapply,
  applied,
}: {
  modification: ScenarioModification;
  onApply: (tweaked: ScenarioModification) => void;
  onUnapply: () => void;
  applied: boolean;
}) {
  const [tweaking, setTweaking] = useState(false);
  const [editedMods, setEditedMods] = useState(modification.teamModifications);

  const handleTeamChange = (index: number, updated: typeof editedMods[number]) => {
    setEditedMods((prev) => prev.map((tm, i) => (i === index ? updated : tm)));
  };

  const handleApply = () => {
    onApply({ ...modification, teamModifications: editedMods });
    setTweaking(false);
  };

  return (
    <div className="mt-2 rounded-lg border border-white/[0.10] bg-white/[0.03] p-3">
      <div className="text-[10px] text-white/40 tracking-wider uppercase mb-1.5">
        Proposed Modification
      </div>
      <div className="text-xs text-white/70 mb-2">{modification.description}</div>
      {tweaking
        ? editedMods.map((tm, i) => (
            <TeamModEditRow key={i} tm={tm} onChange={(u) => handleTeamChange(i, u)} />
          ))
        : editedMods.map((tm, i) => <TeamModRow key={i} tm={tm} />)
      }
      {applied ? (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[11px] text-green-400/70">Applied</span>
          <button
            onClick={onUnapply}
            className="px-2 py-1 rounded text-[10px] text-red-400/60 hover:text-red-400 border border-red-400/20 hover:border-red-400/40 transition-colors cursor-pointer"
          >
            Unapply
          </button>
        </div>
      ) : (
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleApply}
            className="px-3 py-1.5 rounded text-[11px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors cursor-pointer"
          >
            Apply
          </button>
          <button
            onClick={() => setTweaking(!tweaking)}
            className={`px-3 py-1.5 rounded text-[11px] font-semibold border transition-colors cursor-pointer ${
              tweaking
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
                : 'bg-white/[0.04] text-white/50 border-white/[0.12] hover:text-white/70 hover:border-white/20'
            }`}
          >
            {tweaking ? 'Done' : 'Tweak'}
          </button>
        </div>
      )}
    </div>
  );
}

/** Inline selector for team fixture lock result in tweak mode. */
function LockResultSelect({
  lock,
  onChange,
}: {
  lock: TeamFixtureLock;
  onChange: (updated: TeamFixtureLock) => void;
}) {
  return (
    <div className="text-[11px] text-white/50 mb-0.5 flex items-center gap-1.5">
      <span className="font-semibold text-white/70">{lock.team}</span>
      <select
        value={lock.result}
        onChange={(e) => onChange({ ...lock, result: e.target.value as TeamFixtureLock['result'] })}
        className="bg-white/[0.06] border border-white/[0.12] rounded px-1 py-0.5 text-[11px] text-white/80 outline-none focus:border-white/30 cursor-pointer"
      >
        <option value="lose">loses all remaining</option>
        <option value="win">wins all remaining</option>
        <option value="draw">draws all remaining</option>
      </select>
    </div>
  );
}

function OptionCard({
  option,
  index,
  onApply,
  onUnapply,
  applied,
}: {
  option: ProposedOption;
  index: number;
  onApply: (tweaked: ProposedOption) => void;
  onUnapply: () => void;
  applied: boolean;
}) {
  const [tweaking, setTweaking] = useState(false);
  const [editedMods, setEditedMods] = useState(option.modification?.teamModifications ?? []);
  const [editedLocks, setEditedLocks] = useState<TeamFixtureLock[]>(option.teamFixtureLocks ?? []);

  const hasTweakableContent = (option.modification?.teamModifications?.length ?? 0) > 0 || (option.teamFixtureLocks?.length ?? 0) > 0;

  const handleTeamChange = (index: number, updated: typeof editedMods[number]) => {
    setEditedMods((prev) => prev.map((tm, i) => (i === index ? updated : tm)));
  };

  const handleLockChange = (index: number, updated: TeamFixtureLock) => {
    setEditedLocks((prev) => prev.map((l, i) => (i === index ? updated : l)));
  };

  const handleApply = () => {
    const tweaked: ProposedOption = {
      ...option,
      teamFixtureLocks: editedLocks.length > 0 ? editedLocks : option.teamFixtureLocks,
      modification: option.modification
        ? { ...option.modification, teamModifications: editedMods }
        : undefined,
    };
    onApply(tweaked);
    setTweaking(false);
  };

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

      {/* Team fixture locks */}
      {editedLocks.length > 0 && (
        <div className="mb-1.5">
          {tweaking
            ? editedLocks.map((lock, i) => (
                <LockResultSelect key={i} lock={lock} onChange={(u) => handleLockChange(i, u)} />
              ))
            : editedLocks.map((lock, i) => (
                <div key={i} className="text-[11px] text-white/50 mb-0.5">
                  <span className="font-semibold text-white/70">{lock.team}</span>{' '}
                  <span className={
                    lock.result === 'lose' ? 'text-red-400/70' : lock.result === 'win' ? 'text-green-400/70' : 'text-amber-400/70'
                  }>
                    {lock.result === 'lose' ? 'loses' : lock.result === 'win' ? 'wins' : 'draws'} all remaining
                  </span>
                </div>
              ))
          }
        </div>
      )}

      {/* Probability modifications */}
      {editedMods.length > 0 && (
        tweaking
          ? editedMods.map((tm, i) => (
              <TeamModEditRow key={i} tm={tm} onChange={(u) => handleTeamChange(i, u)} />
            ))
          : editedMods.map((tm, i) => <TeamModRow key={i} tm={tm} />)
      )}

      {option.fixtureLock && (
        <div className="text-[11px] text-white/50">
          Lock: {option.fixtureLock.fixtureId} &rarr; {option.fixtureLock.result}
        </div>
      )}

      {applied ? (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[11px] text-green-400/70">Applied</span>
          <button
            onClick={onUnapply}
            className="px-2 py-1 rounded text-[10px] text-red-400/60 hover:text-red-400 border border-red-400/20 hover:border-red-400/40 transition-colors cursor-pointer"
          >
            Unapply
          </button>
        </div>
      ) : (
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleApply}
            className="px-3 py-1.5 rounded text-[11px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors cursor-pointer"
          >
            Apply
          </button>
          {hasTweakableContent && (
            <button
              onClick={() => setTweaking(!tweaking)}
              className={`px-3 py-1.5 rounded text-[11px] font-semibold border transition-colors cursor-pointer ${
                tweaking
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
                  : 'bg-white/[0.04] text-white/50 border-white/[0.12] hover:text-white/70 hover:border-white/20'
              }`}
            >
              {tweaking ? 'Done' : 'Tweak'}
            </button>
          )}
        </div>
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

export default function ChatThread({ messages, accentColor, onApplyModification, onApplyOption, onUnapply, appliedMessageIds }: Props) {
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
                  onApply={(tweaked) => onApplyModification(tweaked, msg.id)}
                  onUnapply={() => onUnapply(msg.id)}
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
                      onApply={(tweaked) => onApplyOption(tweaked, msg.id, i)}
                      onUnapply={() => onUnapply(`${msg.id}-opt-${i}`)}
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
