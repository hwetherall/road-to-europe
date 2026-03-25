'use client';

import { Chapter } from '@/lib/chat-types';
import ChapterCard from './ChapterCard';

interface Props {
  chapters: Chapter[];
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onResetAll: () => void;
}

export default function ChaptersPanel({ chapters, onRemove, onToggle, onResetAll }: Props) {
  if (chapters.length === 0) {
    return (
      <div className="px-3 py-4">
        <div className="text-[11px] text-white/25 text-center">
          No saved scenarios yet. Use Ask Assistant or Match Outcomes to create one.
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="space-y-1.5">
        {chapters.map((chapter) => (
          <ChapterCard
            key={chapter.id}
            chapter={chapter}
            onRemove={onRemove}
            onToggle={onToggle}
          />
        ))}
      </div>
      <button
        onClick={onResetAll}
        className="w-full mt-3 py-2 rounded-lg text-[11px] text-red-400/60 hover:text-red-400 border border-red-400/15 hover:border-red-400/30 bg-transparent transition-colors cursor-pointer tracking-wider uppercase"
      >
        Clear all scenarios
      </button>
    </div>
  );
}
