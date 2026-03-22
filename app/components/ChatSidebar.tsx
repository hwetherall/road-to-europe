'use client';

import { useState, useCallback, useRef } from 'react';
import { Chapter, ChatMessage, ScenarioModification } from '@/lib/chat-types';
import ChaptersPanel from './ChaptersPanel';
import ChatThread from './ChatThread';
import ChatInput from './ChatInput';
import { Team, SimulationResult, SensitivityResult } from '@/lib/types';

interface Props {
  isOpen: boolean;
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

  const handleSend = useCallback(
    async (text: string) => {
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
        setIsProcessing(false);
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

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" />

      {/* Sidebar */}
      <div className="fixed top-0 right-0 h-full w-[380px] max-w-full bg-[#0d0d0d] border-l border-white/[0.06] z-50 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
          <div className="font-oswald text-xs tracking-[0.15em] uppercase text-white/50">
            Scenarios
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

        {/* Chat Thread */}
        <ChatThread
          messages={messages}
          accentColor={accentColor}
          onApplyModification={handleApplyModification}
          appliedMessageIds={appliedMessageIds}
        />

        {/* Chat Input */}
        <ChatInput
          onSend={handleSend}
          mode={mode}
          onModeChange={setMode}
          isProcessing={isProcessing}
          accentColor={accentColor}
        />
      </div>
    </>
  );
}
