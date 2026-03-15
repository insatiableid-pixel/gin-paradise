/**
 * Audio Manager for Gin Paradise.
 *
 * Generates synthesized audio feedback for core table actions.
 * Uses the Web Audio API for short, restrained audio cues.
 *
 * Design philosophy:
 * - Support comprehension through sonic confirmation, not decoration
 * - Respect reduced-motion / muted states
 * - Keep volume low and timbres pleasant (not slot-machine-like)
 * - All sounds are generated via Web Audio API = no external files needed
 */

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  // Resume if suspended (browser autoplay policy)
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

/** Play a soft "card slide" sound — for draw from stock */
export function playDrawSound(): void {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  // White noise burst — short and soft, like a card sliding
  const bufferSize = ctx.sampleRate * 0.06;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // Decaying
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  // Filter to soften
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2000;
  filter.Q.value = 0.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.06);
}

/** Play a slightly different "card place" sound — for discard */
export function playDiscardSound(): void {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  // Soft thud + tap combination
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

/** Play a satisfying "deal" sequence — soft rapid taps */
export function playDealSound(): void {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  // Play 5 quick soft taps at decreasing intervals
  for (let i = 0; i < 5; i++) {
    const t = now + i * 0.05;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(800 + (i * 100), t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.04);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.04);
  }
}

/** Play a "knock" emphasis — two-tone impact */
export function playKnockSound(): void {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  // Impact tone 1
  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(300, now);
  osc1.frequency.exponentialRampToValueAtTime(120, now + 0.15);

  const gain1 = ctx.createGain();
  gain1.gain.setValueAtTime(0.15, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.15);

  // Impact tone 2 (slightly delayed, higher)
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(500, now + 0.05);
  osc2.frequency.exponentialRampToValueAtTime(200, now + 0.18);

  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0.1, now + 0.05);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.05);
  osc2.stop(now + 0.18);
}

/** Play a "result reveal" chime — ascending major arpeggio */
export function playResultSound(isWin: boolean): void {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  // Major chord arpeggio for win, minor for loss
  const baseFreq = isWin ? 523.25 : 440; // C5 or A4
  const intervals = isWin ? [1, 1.25, 1.5] : [1, 1.19, 1.5]; // major vs minor third

  intervals.forEach((ratio, i) => {
    const t = now + i * 0.1;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = baseFreq * ratio;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.setValueAtTime(0.08, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

/** Play a subtle payout / coin sound — shimmery */
export function playPayoutSound(): void {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  // Shimmery ascending tone
  for (let i = 0; i < 4; i++) {
    const t = now + i * 0.06;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 1200 + i * 200;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

/**
 * Check if reduced motion is preferred by the system.
 * Components can use this to conditionally disable animations.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
