'use client';

import { Chapter } from '@/lib/chat-types';

interface Props {
  chapter: Chapter;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
}

export default function ChapterCard({ chapter, onRemove, onToggle }: Props) {
  const isDisabled = chapter.status === 'disabled';

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
        isDisabled
          ? 'bg-white/[0.01] border-white/[0.04] opacity-50'
          : 'bg-white/[0.04] border-white/[0.10]'
      }`}
    >
      {/* Toggle enable/disable */}
      <button
        onClick={() => onToggle(chapter.id)}
        className="w-4 h-4 rounded border shrink-0 transition-colors cursor-pointer flex items-center justify-center"
        style={{
          borderColor: isDisabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.3)',
          background: isDisabled ? 'transparent' : 'rgba(255,255,255,0.1)',
        }}
        title={isDisabled ? 'Enable scenario' : 'Disable scenario'}
      >
        {!isDisabled && (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1 4L3 6L7 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white/80 truncate">{chapter.title}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[9px] tracking-wider uppercase text-white/30">
            {chapter.type === 'fixture_lock' ? 'Lock' : 'Modifier'}
          </span>
          {chapter.confidence && (
            <span
              className={`text-[9px] tracking-wider uppercase ${
                chapter.confidence === 'high'
                  ? 'text-green-400/60'
                  : chapter.confidence === 'medium'
                  ? 'text-amber-400/60'
                  : 'text-red-400/60'
              }`}
            >
              {chapter.confidence}
            </span>
          )}
          {chapter.mode && (
            <span className="text-[9px] tracking-wider uppercase text-white/20">
              {chapter.mode}
            </span>
          )}
        </div>
      </div>

      {/* Remove button */}
      <button
        onClick={() => onRemove(chapter.id)}
        className="w-5 h-5 rounded flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors cursor-pointer shrink-0"
        title="Remove scenario"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
