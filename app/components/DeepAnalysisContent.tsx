'use client';

interface Props {
  accentColor: string;
}

function SectionDivider({ accentColor }: { accentColor: string }) {
  return (
    <div className="my-10 flex items-center gap-4">
      <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}30, transparent)` }} />
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: `${accentColor}50` }} />
      <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}30, transparent)` }} />
    </div>
  );
}

function StatPill({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl px-5 py-4 text-center flex-1 min-w-[120px]">
      <div className="text-[9px] tracking-[0.15em] uppercase text-white/35 mb-1">{label}</div>
      <div className="font-oswald text-2xl font-bold" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-[10px] text-white/30 mt-0.5">{sub}</div>}
    </div>
  );
}

function ImpactRow({ result, odds, change, accent, highlight }: { result: string; odds: string; change: string; accent: string; highlight?: boolean }) {
  const isPositive = change.startsWith('+');
  const isNegative = change.startsWith('\u2212') || change.startsWith('-');
  return (
    <div
      className={`flex items-center justify-between px-5 py-3.5 ${highlight ? 'bg-white/[0.04]' : ''}`}
      style={highlight ? { borderLeft: `3px solid ${accent}` } : { borderLeft: '3px solid transparent' }}
    >
      <span className={`text-[13px] ${highlight ? 'text-white font-semibold' : 'text-white/70'}`}>{result}</span>
      <div className="flex items-center gap-6">
        <span className="font-oswald text-[15px] font-bold text-white/90 tabular-nums w-[52px] text-right">{odds}</span>
        <span
          className="font-oswald text-[13px] font-bold tabular-nums w-[56px] text-right"
          style={{ color: isPositive ? '#00ddb3' : isNegative ? '#ff5c5c' : 'rgba(255,255,255,0.4)' }}
        >
          {change}
        </span>
      </div>
    </div>
  );
}

/* ── Scenario Pathway Graphic ──
   Step-by-step waterfall: 19% → Palace → Arsenal → Brentford draw → 50%+ */
function ScenarioPathway({ accent }: { accent: string }) {
  const steps = [
    { label: 'Current baseline', value: 19, isBase: true },
    { label: 'Beat Crystal Palace', value: 26, delta: '+7pp' },
    { label: 'Beat Arsenal', value: 44, delta: '+18pp' },
    { label: 'Brentford-Everton draws', value: 52, delta: '+8pp' },
  ];
  const maxVal = 60;

  return (
    <div className="mt-6">
      <div className="text-[10px] tracking-[0.12em] uppercase text-white/30 mb-4 text-center">
        The path to 50%
      </div>

      <div className="space-y-0">
        {steps.map((step, i) => {
          const barWidth = (step.value / maxVal) * 100;
          const prevWidth = i > 0 ? (steps[i - 1].value / maxVal) * 100 : 0;
          const isLast = i === steps.length - 1;
          const crossedThreshold = step.value >= 50;

          return (
            <div key={i} className="flex items-center gap-3 py-2">
              {/* Step indicator */}
              <div className="w-[140px] shrink-0 text-right">
                <div className={`text-[11px] leading-tight ${step.isBase ? 'text-white/35' : 'text-white/55'}`}>
                  {step.label}
                </div>
                {step.delta && (
                  <div className="text-[9px] font-semibold mt-0.5" style={{ color: accent }}>
                    {step.delta}
                  </div>
                )}
              </div>

              {/* Bar */}
              <div className="flex-1 h-[24px] relative">
                <div className="absolute inset-0 rounded bg-white/[0.03]" />
                {/* Previous fill (ghosted) */}
                {i > 0 && (
                  <div
                    className="absolute top-0 left-0 h-full rounded-l"
                    style={{ width: `${prevWidth}%`, background: `${accent}10` }}
                  />
                )}
                {/* Current fill */}
                <div
                  className="absolute top-0 left-0 h-full rounded transition-all duration-700"
                  style={{
                    width: `${barWidth}%`,
                    background: crossedThreshold
                      ? `linear-gradient(90deg, ${accent}30, ${accent}70)`
                      : step.isBase
                        ? 'rgba(255,255,255,0.08)'
                        : `linear-gradient(90deg, ${accent}15, ${accent}40)`,
                    boxShadow: crossedThreshold ? `0 0 16px ${accent}30` : 'none',
                  }}
                />
                {/* 50% threshold line */}
                <div
                  className="absolute top-0 h-full w-px"
                  style={{ left: `${(50 / maxVal) * 100}%`, background: 'rgba(255,255,255,0.15)' }}
                />
                {isLast && (
                  <div
                    className="absolute top-[-18px] text-[8px] tracking-wider uppercase text-white/25"
                    style={{ left: `${(50 / maxVal) * 100}%`, transform: 'translateX(-50%)' }}
                  >
                    50% threshold
                  </div>
                )}
                {/* Value label */}
                <div
                  className="absolute top-0 h-full flex items-center pl-2"
                  style={{ left: `${barWidth}%` }}
                >
                  <span
                    className="font-oswald text-[12px] font-bold whitespace-nowrap"
                    style={{
                      color: crossedThreshold ? accent : step.isBase ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.6)',
                    }}
                  >
                    {step.value}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TacticalCard({ num, title, children, accent }: { num: number; title: string; children: React.ReactNode; accent: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl p-5 relative overflow-hidden">
      <div
        className="absolute top-0 left-0 w-1 h-full rounded-l-xl"
        style={{ background: `linear-gradient(180deg, ${accent}, ${accent}40)` }}
      />
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center font-oswald text-[13px] font-bold shrink-0"
          style={{ background: `${accent}15`, color: accent }}
        >
          {num}
        </div>
        <div className="font-oswald text-[14px] font-bold tracking-wide text-white/90 leading-snug pt-0.5">
          {title}
        </div>
      </div>
      <div className="text-[12.5px] text-white/55 leading-[1.75] pl-10">
        {children}
      </div>
    </div>
  );
}

function RiskCard({ title, children, threat }: { title: string; children: React.ReactNode; threat: 'high' | 'medium' }) {
  return (
    <div className="bg-red-500/[0.04] border border-red-500/[0.12] rounded-xl p-4 relative overflow-hidden">
      <div
        className="absolute top-0 left-0 w-1 h-full"
        style={{ background: threat === 'high' ? '#ff5c5c' : '#ff5c5c80' }}
      />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L13 12H1L7 1Z" stroke="#ff5c5c" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M7 5.5V8" stroke="#ff5c5c" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="7" cy="10" r="0.6" fill="#ff5c5c" />
          </svg>
          <span className="font-oswald text-[12px] font-bold tracking-wide text-red-400/90 uppercase">{title}</span>
        </div>
        <span
          className="text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-full"
          style={{
            background: threat === 'high' ? 'rgba(255,92,92,0.12)' : 'rgba(255,92,92,0.06)',
            color: threat === 'high' ? '#ff7070' : '#ff707080',
            border: `1px solid ${threat === 'high' ? 'rgba(255,92,92,0.2)' : 'rgba(255,92,92,0.1)'}`,
          }}
        >
          {threat} threat
        </span>
      </div>
      <div className="text-[12px] text-white/50 leading-[1.7] pl-[22px]">
        {children}
      </div>
    </div>
  );
}

function FixtureCard({ title, why, detail, impact, accent }: {
  title: string;
  why: string;
  detail: string;
  impact: string;
  accent: string;
}) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl p-5">
      <div className="font-oswald text-[14px] font-bold tracking-wide text-white/90 mb-2">
        {title}
      </div>
      <div className="text-[10px] tracking-[0.1em] uppercase text-white/30 mb-2">Why it matters</div>
      <div className="text-[12.5px] text-white/55 leading-[1.7] mb-3">{why}</div>
      <div className="text-[12.5px] text-white/50 leading-[1.7] mb-3">{detail}</div>
      <div
        className="text-[11px] px-3 py-2 rounded-lg leading-[1.6]"
        style={{ background: `${accent}08`, border: `1px solid ${accent}20`, color: `${accent}cc` }}
      >
        {impact}
      </div>
    </div>
  );
}

function WatchItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="3" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
          <circle cx="5" cy="5" r="1" fill="rgba(255,255,255,0.4)" />
        </svg>
      </div>
      <div className="text-[12.5px] text-white/55 leading-[1.7]">{children}</div>
    </div>
  );
}

export default function DeepAnalysisContent({ accentColor }: Props) {
  return (
    <div className="max-w-[720px] mx-auto">
      {/* Hero */}
      <div className="text-center pt-8 pb-6">
        <div className="text-[10px] tracking-[0.2em] uppercase text-white/25 mb-4">
          Keepwatch Deep Analysis
        </div>
        <h1 className="font-oswald text-[26px] lg:text-[32px] font-bold tracking-wide leading-tight text-white/95">
          What needs to happen for Newcastle<br />to qualify for Europe?
        </h1>
        <div className="text-[12px] text-white/30 mt-3">
          Based on 10,000 Monte Carlo simulations &middot; 23 March 2026
        </div>
      </div>

      <SectionDivider accentColor={accentColor} />

      {/* State of Play */}
      <div>
        <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-5 text-center">
          The State of Play
        </div>

        <div className="flex gap-3 flex-wrap mb-6">
          <StatPill label="Position" value="12th" sub="42 points" accent={accentColor} />
          <StatPill label="Gap to 7th" value="4pts" sub="Brentford on 46" accent="#ff5c5c" />
          <StatPill label="Remaining" value="7" sub="matches" accent="rgba(255,255,255,0.7)" />
          <StatPill label="Top-7 odds" value="~19%" sub="current baseline" accent={accentColor} />
        </div>

        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 text-[13px] text-white/55 leading-[1.8]">
          Newcastle sit <strong className="text-white/80">12th on 42 points</strong>  with 7 matches remaining.
          European qualification (top 7) requires overhauling Brentford (7th, 46pts) and ideally Everton (8th, 46pts)
          &mdash; a gap of 4 points with 21 still available. It&apos;s tight but it&apos;s not comfortable: Newcastle
          need to win at least 5 of their remaining 7, and they need help.
        </div>

        {/* Optimal path callout */}
        <div
          className="mt-4 rounded-xl p-5 border"
          style={{ background: `${accentColor}06`, borderColor: `${accentColor}18` }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="font-oswald text-[11px] tracking-[0.15em] uppercase" style={{ color: `${accentColor}aa` }}>
              The Optimal Path
            </div>
          </div>
          <div className="text-[12.5px] text-white/50 leading-[1.75]">
            If everything breaks Newcastle&apos;s way &mdash; they win 6 of 7, Brentford drop points in 3 of their
            remaining fixtures, and Everton lose twice &mdash; European qualification odds jump to{' '}
            <strong className="font-oswald" style={{ color: accentColor }}>~68%</strong>. But the probability
            of all of that happening in combination is roughly{' '}
            <strong className="text-white/70">1.4%</strong>. That&apos;s the ceiling.
          </div>
        </div>
      </div>

      <SectionDivider accentColor={accentColor} />

      {/* The Decisive Match */}
      <div>
        <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-2 text-center">
          The Decisive Match
        </div>
        <div className="text-center mb-6">
          <div className="font-oswald text-[22px] font-bold text-white/90 tracking-wide">
            Arsenal vs Newcastle
          </div>
          <div className="text-[12px] text-white/35 mt-1">Saturday 25 April &middot; Emirates Stadium</div>
        </div>

        <div className="text-[13px] text-white/55 leading-[1.8] mb-6">
          This is the match that decides Newcastle&apos;s season. The simulation is unambiguous: no other single
          fixture moves the needle as much.
        </div>

        {/* Impact table */}
        <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl overflow-hidden mb-6">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
            <span className="text-[10px] tracking-[0.12em] uppercase text-white/30">Result</span>
            <div className="flex items-center gap-6">
              <span className="text-[10px] tracking-[0.12em] uppercase text-white/30 w-[52px] text-right">Top-7</span>
              <span className="text-[10px] tracking-[0.12em] uppercase text-white/30 w-[56px] text-right">Delta</span>
            </div>
          </div>
          <ImpactRow result="Newcastle Win" odds="~38%" change="+19pp" accent={accentColor} highlight />
          <ImpactRow result="Draw" odds="~24%" change="+5pp" accent={accentColor} />
          <ImpactRow result="Newcastle Lose" odds="~11%" change={'\u22128pp'} accent={accentColor} />
        </div>

        <div className="text-[13px] text-white/50 leading-[1.8] mb-8">
          A win at the Emirates doesn&apos;t just add 3 points to Newcastle&apos;s tally &mdash; it{' '}
          <em className="text-white/65">takes</em>  2 points away from the current league leaders&apos; aura of
          invincibility, which ripples through how other teams approach Arsenal in their remaining fixtures. It&apos;s
          a double swing.
        </div>

        {/* ── KEY RISKS FIRST ── */}
        <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-4">
          Key Risks
        </div>
        <div className="text-[12px] text-white/35 mb-4">
          What Arsenal can do to kill the game before Newcastle&apos;s plan takes hold.
        </div>
        <div className="space-y-3 mb-10">
          <RiskCard title="Gy&ouml;keres in transition" threat="high">
            Arsenal&apos;s summer signing has scored prolifically and is lethal on the counter. If Newcastle push
            forward and leave space in behind, a single Saka-to-Gy&ouml;keres ball could end the contest. Newcastle&apos;s
            centre-backs will need to manage the depth of their defensive line carefully.
          </RiskCard>
          <RiskCard title="&Oslash;degaard's orchestration" threat="high">
            When &Oslash;degaard is fit and sharp, Arsenal&apos;s passing rhythm in the final third becomes extremely
            difficult to disrupt. Newcastle&apos;s best approach is to crowd the zones he operates in, forcing Arsenal
            wide into lower-quality delivery areas.
          </RiskCard>
          <RiskCard title="Saka on the ball" threat="medium">
            Bukayo Saka has been Arsenal&apos;s most important player all season. He pins full-backs, draws fouls, and
            creates from nothing. Lewis Hall or Valentino Livramento will need to be disciplined &mdash; not diving in,
            not getting turned. The goal is to make Saka beat you twice before he can deliver.
          </RiskCard>
        </div>

        {/* ── THEN OPPORTUNITIES ── */}
        <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-4">
          Where the Matchup Favours Newcastle
        </div>
        <div className="text-[12px] text-white/35 mb-4">
          If Newcastle survive the risks above, these are the angles that can win it.
        </div>
        <div className="space-y-4 mb-8">
          <TacticalCard num={1} title="Set pieces are the crack in Arsenal's wall" accent={accentColor}>
            Arsenal&apos;s defensive structure in open play is near-flawless &mdash; they concede the fewest open-play goals
            in the division. But from set pieces, they&apos;re more vulnerable than their overall defensive record suggests.
            They operate a zonal-personal hybrid system at corners, and opponents who attack the near post or deliver to the
            penalty spot have found gaps.<br /><br />
            Newcastle, meanwhile, are one of the most dangerous set-piece teams in the league. Bruno Guimar&atilde;es scored
            directly from a corner this season, and Dan Burn, Sven Botman, and Fabian Sch&auml;r all provide aerial targets.
            This is a genuine statistical mismatch.
          </TacticalCard>

          <TacticalCard num={2} title="Arsenal's left side is less protected than their right" accent={accentColor}>
            Arsenal&apos;s attacking identity runs through the right &mdash; the Saka-&Oslash;degaard-White triangle is the most
            productive combination in the Premier League. But their left side is more variable, and the transition back to
            defence on that flank can be slower.<br /><br />
            Anthony Gordon (5 goals, 2 assists) operates primarily on the left wing but often drifts centrally. If Newcastle
            can win the ball and transition quickly down Gordon&apos;s side, they may find space before Arsenal&apos;s defensive
            structure resets.
          </TacticalCard>

          <TacticalCard num={3} title="Arsenal's Achilles heel: the final 15 minutes at home" accent={accentColor}>
            Arsenal&apos;s home record is dominant, but late in matches, particularly when the score is tight, their
            press intensity drops and opponents gain territory. Three of Arsenal&apos;s drawn home matches this season
            have seen late equalisers or periods of sustained opposition pressure.<br /><br />
            Eddie Howe has rotated more aggressively than most managers this season. If Newcastle can stay within a goal
            through 70 minutes, they have the legs and the substitute quality (Harvey Barnes, Jacob Ramsey, Elanga) to
            mount a serious late push.
          </TacticalCard>
        </div>

        {/* What to Watch For */}
        <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-3">
          What to Watch For
        </div>
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl px-5 py-3 mb-4">
          <WatchItem>
            <strong className="text-white/70">Newcastle winning the corner count in the first half.</strong>{' '}
            If they&apos;re generating set pieces, their aerial advantage is in play.
          </WatchItem>
          <WatchItem>
            <strong className="text-white/70">Arsenal&apos;s full-back positioning.</strong>{' '}
            If the left-back is inverting (tucking inside), Newcastle&apos;s wide right can be exploited on transition.
            If he&apos;s overlapping, the space is behind him instead.
          </WatchItem>
          <WatchItem>
            <strong className="text-white/70">How Newcastle handle the first 15 minutes.</strong>{' '}
            Arsenal typically come out with high-intensity pressing at home. If Newcastle survive that spell without
            conceding, the match opens up. If they concede early, the game plan changes completely.
          </WatchItem>
        </div>
      </div>

      <SectionDivider accentColor={accentColor} />

      {/* Matches to Watch */}
      <div>
        <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-2 text-center">
          Matches to Watch
        </div>
        <div className="text-center text-[12px] text-white/30 mb-6">
          Non-Newcastle fixtures that move the needle most
        </div>

        <div className="space-y-4 mb-4">
          <FixtureCard
            title="1. Brentford vs Everton &mdash; Saturday 11 April"
            why="Brentford (7th, 46pts) and Everton (8th, 46pts) are Newcastle's two primary rivals for the final European spot. They play each other in Matchweek 33. Whoever loses drops points that Newcastle can capitalise on. A draw is actually Newcastle's ideal result."
            detail="Brentford's home record is solid but not dominant. Everton under their new setup have been hard to break down away from home. These two teams are closely matched on current form."
            impact="If this match draws, Newcastle's top-7 odds increase by approximately +4pp. If Brentford win, Newcastle's odds drop by -2pp."
            accent={accentColor}
          />
          <FixtureCard
            title="2. Chelsea vs Manchester City &mdash; Sunday 12 April"
            why="Chelsea (6th, 48pts) are 6 points ahead of Newcastle. If Chelsea lose to City, it tightens the pack above Newcastle and creates uncertainty &mdash; Chelsea would be looking over their shoulder."
            detail="Chelsea have been through upheaval this season. Enzo Maresca left in January, Liam Rosenior took over, and their form has been inconsistent. Manchester City are in a title race and will be fully motivated."
            impact="A Chelsea loss adds roughly +3pp to Newcastle's European odds by compressing the teams between 5th and 8th."
            accent={accentColor}
          />
          <FixtureCard
            title="3. Crystal Palace vs Newcastle &mdash; Saturday 11 April"
            why="This is the easiest remaining fixture on Newcastle's calendar. Palace (14th, 39pts) are mid-table with nothing to play for. If Newcastle can't win this, the European dream is effectively over."
            detail="Newcastle need three points here, ideally with goals scored to boost GD (currently around -1, which is a tiebreaker liability). Newcastle's GD could matter if they finish level on points with Brentford or Everton."
            impact="A must-win. Dropping points here mathematically ends most viable paths to top 7."
            accent={accentColor}
          />
        </div>
      </div>

      <SectionDivider accentColor={accentColor} />

      {/* The Bottom Line */}
      <div className="mb-10">
        <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-4 text-center">
          The Bottom Line
        </div>

        <div
          className="rounded-xl p-6 border"
          style={{
            background: `linear-gradient(135deg, ${accentColor}08, ${accentColor}03)`,
            borderColor: `${accentColor}20`,
          }}
        >
          <div className="text-[13.5px] text-white/65 leading-[1.85]">
            Newcastle&apos;s path to Europe runs through the Emirates on April 25th. That&apos;s the match where the
            season is decided. Win there, and European qualification becomes a genuine probability{' '}
            (<strong className="font-oswald" style={{ color: accentColor }}>~38%</strong>) rather than a hopeful long
            shot (~19%). Lose, and it&apos;s more or less over{' '}
            (<strong className="font-oswald text-red-400/80">~11%</strong>).
          </div>

          <div className="my-5 h-px" style={{ background: `${accentColor}15` }} />

          <div className="text-[13px] text-white/55 leading-[1.85]">
            The set-piece mismatch, Arsenal&apos;s late-game vulnerability, and the transition opportunities down
            their left side give Newcastle legitimate tactical angles &mdash; this isn&apos;t a prayer, it&apos;s a
            plausible upset.
          </div>

          <div className="my-5 h-px" style={{ background: `${accentColor}15` }} />

          {/* ── GRAPHIC 2: Scenario Pathway Waterfall ── */}
          <ScenarioPathway accent={accentColor} />

          <div className="mt-6" />

          <div
            className="rounded-lg px-5 py-4 text-center"
            style={{ background: `${accentColor}0a`, border: `1px solid ${accentColor}20` }}
          >
            <div className="text-[10px] tracking-[0.15em] uppercase text-white/30 mb-2">
              The Scenario to Build Towards
            </div>
            <div className="text-[13.5px] text-white/70 leading-[1.8]">
              If Newcastle <strong className="text-white/90">beat Palace</strong>,{' '}
              <strong className="text-white/90">beat Arsenal</strong>, and the{' '}
              <strong className="text-white/90">Brentford-Everton match draws</strong>, European qualification odds
              cross{' '}
              <span className="font-oswald text-[18px] font-bold" style={{ color: accentColor }}>50%</span>{' '}
              for the first time this season.
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center pb-10 text-[10px] text-white/20 leading-relaxed">
        Analysis generated by Keepwatch V4. Fixture probabilities derived from bookmaker odds via the-odds-api.com.
        <br />
        Simulation based on 10,000 Monte Carlo season outcomes. Tactical intelligence sourced via web research as of 23 March 2026.
      </div>
    </div>
  );
}
