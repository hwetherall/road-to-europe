'use client';

import { useState, useCallback, useRef } from 'react';
import { Chapter, ChatMessage, ScenarioModification, ProposedOption } from '@/lib/chat-types';
import ChaptersPanel from './ChaptersPanel';
import ChatThread from './ChatThread';
import ChatInput from './ChatInput';
import { Team, SimulationResult, SensitivityResult } from '@/lib/types';

interface Props {
  isOpen: boolean;
  kyleMode?: boolean;
  onExitKyleMode?: () => void;
  onClose?: () => void;
  chapters: Chapter[];
  onAddChapter: (chapter: Chapter) => void;
  onRemoveChapter: (id: string) => void;
  onToggleChapter: (id: string) => void;
  onResetChapters: () => void;
  selectedTeam: string;
  teams: Team[];
  accentColor: string;
  sensitivityResults: SensitivityResult[] | null;
  baselineResult: SimulationResult | null;
  modifiedResult: SimulationResult | null;
}

export default function ChatSidebar({
  isOpen,
  kyleMode = false,
  onExitKyleMode,
  onClose,
  chapters,
  onAddChapter,
  onRemoveChapter,
  onToggleChapter,
  onResetChapters,
  selectedTeam,
  teams,
  accentColor,
  sensitivityResults,
  baselineResult,
  modifiedResult,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [mode, setMode] = useState<'fast' | 'deep'>('fast');
  const [appliedMessageIds, setAppliedMessageIds] = useState<Set<string>>(new Set());
  const responseMetadataRef = useRef<Record<string, {
    title?: string;
    confidence?: 'high' | 'medium' | 'low';
    reasoning?: string;
    proposedLock?: { fixtureId: string; result: 'home' | 'draw' | 'away' };
  }>>({});
  const pendingLocksRef = useRef<Record<string, { fixtureId: string; result: 'home' | 'draw' | 'away' }>>({});
  /** Incremented on chat reset so in-flight requests ignore stale responses. */
  const chatSessionRef = useRef(0);

  const handleResetChat = useCallback(() => {
    chatSessionRef.current += 1;
    setMessages([]);
    setAppliedMessageIds(new Set());
    setIsProcessing(false);
    responseMetadataRef.current = {};
    pendingLocksRef.current = {};
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      const session = chatSessionRef.current;
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsProcessing(true);

      // Create thinking message
      const thinkingId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        {
          id: thinkingId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isThinking: true,
        },
      ]);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...messages, userMessage].map((m) => ({
              role: m.role,
              content: m.content,
            })),
            mode,
            context: {
              selectedTeam,
              standings: teams,
              activeChapters: chapters,
              sensitivityResults: sensitivityResults?.slice(0, 10) ?? [],
            },
          }),
        });

        if (!res.ok) throw new Error('Chat request failed');

        const data = await res.json();

        if (session !== chatSessionRef.current) return;

        // Store metadata from the response for chapter creation
        const responseMetadata = {
          title: data.title as string | undefined,
          confidence: data.confidence as 'high' | 'medium' | 'low' | undefined,
          reasoning: data.reasoning as string | undefined,
          proposedLock: data.proposedLock as { fixtureId: string; result: 'home' | 'draw' | 'away' } | undefined,
        };

        // Replace thinking message with actual response
        const assistantMessage: ChatMessage = {
          id: thinkingId,
          role: 'assistant',
          content: data.content ?? data.message ?? 'I couldn\'t process that request.',
          timestamp: Date.now(),
          proposedModification: data.proposedModification ?? undefined,
          proposedOptions: data.proposedOptions ?? undefined,
          toolCalls: data.toolCalls ?? undefined,
        };

        setMessages((prev) =>
          prev.map((m) => (m.id === thinkingId ? assistantMessage : m))
        );

        // Store response metadata for later use when applying
        responseMetadataRef.current[thinkingId] = responseMetadata;

        // If there's a proposed fixture lock (no user action needed beyond Apply),
        // store it for the Apply handler
        if (responseMetadata.proposedLock) {
          pendingLocksRef.current[thinkingId] = responseMetadata.proposedLock;
        }
      } catch {
        if (session !== chatSessionRef.current) return;
        // Replace thinking with error
        setMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId
              ? {
                  ...m,
                  content: 'Sorry, I couldn\'t process that. Make sure the chat API is configured.',
                  isThinking: false,
                }
              : m
          )
        );
      } finally {
        if (session === chatSessionRef.current) {
          setIsProcessing(false);
        }
      }
    },
    [messages, mode, selectedTeam, teams, chapters, sensitivityResults]
  );

  const handleApplyModification = useCallback(
    (modification: ScenarioModification, messageId: string) => {
      const meta = responseMetadataRef.current[messageId];

      // Check if this is actually a fixture lock proposal
      const pendingLock = pendingLocksRef.current[messageId];
      if (pendingLock) {
        const chapter: Chapter = {
          id: crypto.randomUUID(),
          title: meta?.title ?? `Fixture lock: ${pendingLock.fixtureId}`,
          type: 'fixture_lock',
          status: 'active',
          createdAt: Date.now(),
          fixtureLock: pendingLock,
          confidence: 'high',
          reasoning: meta?.reasoning,
          mode,
        };
        onAddChapter(chapter);
        setAppliedMessageIds((prev) => new Set(prev).add(messageId));
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'system',
            content: `Chapter created: "${chapter.title}"`,
            timestamp: Date.now(),
            chapterId: chapter.id,
          },
        ]);
        return;
      }

      // Probability modifier chapter
      const chapter: Chapter = {
        id: crypto.randomUUID(),
        title: meta?.title ?? modification.description,
        type: 'probability_modifier',
        status: 'active',
        createdAt: Date.now(),
        modification,
        confidence: meta?.confidence ?? 'medium',
        reasoning: meta?.reasoning,
        mode,
      };

      onAddChapter(chapter);
      setAppliedMessageIds((prev) => new Set(prev).add(messageId));

      const sysMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Chapter created: "${chapter.title}"`,
        timestamp: Date.now(),
        chapterId: chapter.id,
      };
      setMessages((prev) => [...prev, sysMsg]);
    },
    [onAddChapter, mode]
  );

  const handleApplyOption = useCallback(
    (option: ProposedOption, messageId: string) => {
      // Find which index this option is so we can track it
      const msg = messages.find((m) => m.id === messageId);
      const optIndex = msg?.proposedOptions?.indexOf(option) ?? 0;
      const appliedKey = `${messageId}-opt-${optIndex}`;

      if (option.type === 'fixture_lock' && option.fixtureLock) {
        const chapter: Chapter = {
          id: crypto.randomUUID(),
          title: option.title,
          type: 'fixture_lock',
          status: 'active',
          createdAt: Date.now(),
          fixtureLock: option.fixtureLock,
          confidence: 'high',
          reasoning: option.reasoning,
          mode,
        };
        onAddChapter(chapter);
        setAppliedMessageIds((prev) => new Set(prev).add(appliedKey));
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'system' as const,
            content: `Chapter created: "${chapter.title}"`,
            timestamp: Date.now(),
            chapterId: chapter.id,
          },
        ]);
        return;
      }

      if (option.modification) {
        const chapter: Chapter = {
          id: crypto.randomUUID(),
          title: option.title,
          type: 'probability_modifier',
          status: 'active',
          createdAt: Date.now(),
          modification: option.modification,
          confidence: option.confidence ?? 'medium',
          reasoning: option.reasoning,
          mode,
        };
        onAddChapter(chapter);
        setAppliedMessageIds((prev) => new Set(prev).add(appliedKey));
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'system' as const,
            content: `Chapter created: "${chapter.title}"`,
            timestamp: Date.now(),
            chapterId: chapter.id,
          },
        ]);
      }
    },
    [onAddChapter, mode, messages]
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile backdrop (not shown in Kyle mode) */}
      {!kyleMode && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" />}

      {/* Sidebar — fixed 380px normally, flex-1 in Kyle mode */}
      <div className={
        kyleMode
          ? 'flex-1 bg-[#0d0d0d] border-l border-white/[0.06] flex flex-col min-w-0 min-h-0 overflow-hidden'
          : 'fixed top-0 right-0 h-full w-[380px] max-w-full bg-[#0d0d0d] border-l border-white/[0.06] z-50 flex flex-col'
      }>
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-oswald text-xs tracking-[0.15em] uppercase text-white/50">
              Saved Scenarios
            </div>
            <div className="flex items-center gap-2">
              {kyleMode && onExitKyleMode && (
                <button
                  type="button"
                  onClick={onExitKyleMode}
                  className="text-[11px] text-white/60 hover:text-white/90 border border-white/[0.14] hover:border-white/[0.24] rounded px-2 py-1 transition-colors cursor-pointer"
                  title="Exit focus chat mode"
                >
                  Exit Focus
                </button>
              )}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors cursor-pointer"
                  title="Close chat"
                  aria-label="Close chat"
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M2.5 2.5L10.5 10.5M10.5 2.5L2.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Chapters Panel */}
        <div className="border-b border-white/[0.06] shrink-0 max-h-[200px] overflow-y-auto">
          <ChaptersPanel
            chapters={chapters}
            onRemove={onRemoveChapter}
            onToggle={onToggleChapter}
            onResetAll={onResetChapters}
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-white/[0.06] shrink-0">
          <span className="font-oswald text-[10px] tracking-[0.12em] uppercase text-white/40">
            Ask Assistant
          </span>
          <button
            type="button"
            onClick={handleResetChat}
            disabled={messages.length === 0 && !isProcessing}
            className="text-[11px] text-white/45 hover:text-white/80 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            Reset chat
          </button>
        </div>

        {/* Chat Thread */}
        <ChatThread
          messages={messages}
          accentColor={accentColor}
          onApplyModification={handleApplyModification}
          onApplyOption={handleApplyOption}
          appliedMessageIds={appliedMessageIds}
        />

        {/* Chat Input */}
        <ChatInput
          onSend={handleSend}
          mode={mode}
          onModeChange={setMode}
          isProcessing={isProcessing}
          accentColor={accentColor}
          expanded={kyleMode}
        />
      </div>
    </>
  );
}
