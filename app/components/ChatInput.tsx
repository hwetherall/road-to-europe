'use client';

import { useState, useRef, useCallback } from 'react';

interface Props {
  onSend: (message: string) => void;
  mode: 'fast' | 'deep';
  onModeChange: (mode: 'fast' | 'deep') => void;
  isProcessing: boolean;
  accentColor: string;
  expanded?: boolean;
}

export default function ChatInput({ onSend, mode, onModeChange, isProcessing, accentColor, expanded = false }: Props) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isProcessing) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, isProcessing, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const maxHeight = expanded ? 200 : 120;
  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [maxHeight]);

  const modeToggle = (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onModeChange('fast')}
        className={`px-2.5 py-1 rounded text-[10px] tracking-wider uppercase transition-colors cursor-pointer border ${
          mode === 'fast'
            ? 'text-white/80 border-white/20 bg-white/[0.08]'
            : 'text-white/25 border-transparent bg-transparent hover:text-white/40'
        }`}
      >
        Fast
      </button>
      <button
        onClick={() => onModeChange('deep')}
        className={`px-2.5 py-1 rounded text-[10px] tracking-wider uppercase transition-colors cursor-pointer border ${
          mode === 'deep'
            ? 'text-white/80 border-white/20 bg-white/[0.08]'
            : 'text-white/25 border-transparent bg-transparent hover:text-white/40'
        }`}
      >
        Deep
      </button>
    </div>
  );

  return (
    <div className="border-t border-white/[0.06] px-3 py-3">
      {/* Mode toggle — above input normally, inline top-right in expanded */}
      {expanded ? (
        <div className="flex items-start gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Describe a scenario..."
            rows={3}
            disabled={isProcessing}
            className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white/80 placeholder-white/20 resize-none outline-none focus:border-white/20 transition-colors disabled:opacity-40"
            style={{ minHeight: '72px' }}
          />
          <div className="flex flex-col items-end gap-2 shrink-0">
            {modeToggle}
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
      ) : (
        <>
          <div className="mb-2.5">{modeToggle}</div>
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                handleInput();
              }}
              onKeyDown={handleKeyDown}
              placeholder="Describe a scenario..."
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
        </>
      )}
    </div>
  );
}
