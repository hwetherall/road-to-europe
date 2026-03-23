'use client';

interface Props {
  active: boolean;
  onToggle: () => void;
  accentColor: string;
}

export default function KyleToggle({ active, onToggle, accentColor }: Props) {
  return (
    <button
      onClick={onToggle}
      className={`px-5 py-3.5 rounded-lg text-sm font-bold font-oswald tracking-widest uppercase transition-all border cursor-pointer hidden lg:inline-flex items-center ${
        active
          ? 'text-white'
          : 'bg-transparent text-white/50 border-white/[0.12] hover:border-white/20'
      }`}
      style={
        active
          ? { background: `${accentColor}20`, borderColor: `${accentColor}40` }
          : undefined
      }
      title={active ? 'Exit Kyle mode' : 'Kyle mode — focus chat'}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        className="mr-1.5"
      >
        <path
          d="M2 8h4M10 8h4M7 5l2 3-2 3M9 5l-2 3 2 3"
          stroke={active ? accentColor : 'currentColor'}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Kyle
    </button>
  );
}
