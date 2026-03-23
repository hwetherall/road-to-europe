'use client';

import { useState, useCallback, useEffect } from 'react';
import { Team, SensitivityResult } from '@/lib/types';
import DeepAnalysisLoader from './DeepAnalysisLoader';
import DeepAnalysisContent from './DeepAnalysisContent';
import DeepAnalysisChat from './DeepAnalysisChat';

interface Props {
  open: boolean;
  onClose: () => void;
  accentColor: string;
  selectedTeam: string;
  teams: Team[];
  sensitivityResults: SensitivityResult[] | null;
}

export default function DeepAnalysisModal({
  open,
  onClose,
  accentColor,
  selectedTeam,
  teams,
  sensitivityResults,
}: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const [fadeIn, setFadeIn] = useState(false);

  // Reset to loading when opened
  useEffect(() => {
    if (open) {
      setPhase('loading');
      setFadeIn(false);
    }
  }, [open]);

  const handleLoaderComplete = useCallback(() => {
    setPhase('ready');
    // Trigger fade-in after a frame
    requestAnimationFrame(() => setFadeIn(true));
  }, []);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  if (phase === 'loading') {
    return <DeepAnalysisLoader accentColor={accentColor} onComplete={handleLoaderComplete} />;
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#070707]">
      {/* Top bar */}
      <div
        className="h-12 border-b flex items-center justify-between px-5 shrink-0"
        style={{ borderColor: `${accentColor}15`, background: '#0a0a0a' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-6 h-6 rounded flex items-center justify-center font-oswald text-[9px] font-bold"
            style={{ background: `${accentColor}25`, color: accentColor }}
          >
            {selectedTeam}
          </div>
          <span className="font-oswald text-[12px] tracking-[0.12em] uppercase text-white/50">
            Deep Analysis
          </span>
          <span className="text-[10px] text-white/20">&middot;</span>
          <span className="text-[10px] text-white/25">Path to Europe</span>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3L11 11M11 3L3 11" stroke="rgba(255,255,255,0.4)" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Main content area */}
      <div
        className={`flex h-[calc(100vh-48px)] transition-opacity duration-500 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* Analysis content — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 lg:px-10 min-w-0">
          <DeepAnalysisContent accentColor={accentColor} />
        </div>

        {/* Chat panel — right side */}
        <div
          className="w-[380px] shrink-0 border-l border-white/[0.06] bg-[#0d0d0d] hidden lg:flex flex-col"
        >
          <DeepAnalysisChat
            accentColor={accentColor}
            selectedTeam={selectedTeam}
            teams={teams}
            sensitivityResults={sensitivityResults}
          />
        </div>
      </div>
    </div>
  );
}
