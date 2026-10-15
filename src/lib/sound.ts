// Tiny WebAudio tones — no assets, fails silently anywhere audio is blocked.

let ctx: AudioContext | null = null;

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  gain = 0.04,
  delay = 0,
): void {
  try {
    if (typeof AudioContext === 'undefined') return;
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const start = ctx.currentTime + delay;
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  } catch {
    // Audio unavailable; stay silent.
  }
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // No haptics; fine.
  }
}

export function playLifeTick(): void {
  tone(660, 0.05, 'square', 0.02);
  vibrate(10);
}

export function playTurnChime(): void {
  tone(523, 0.12, 'sine', 0.045);
  tone(784, 0.2, 'sine', 0.04, 0.12);
  vibrate([20, 40, 20]);
}

export function playDefeat(): void {
  tone(196, 0.35, 'sawtooth', 0.05);
  tone(131, 0.55, 'sawtooth', 0.05, 0.22);
  vibrate([60, 60, 120]);
}

export function playVictory(): void {
  // A rising fanfare: C–E–G, then the octave held over a low root.
  tone(523, 0.16, 'triangle', 0.05);
  tone(659, 0.16, 'triangle', 0.05, 0.14);
  tone(784, 0.18, 'triangle', 0.05, 0.28);
  tone(1047, 0.9, 'triangle', 0.055, 0.44);
  tone(262, 1.0, 'sine', 0.04, 0.44);
  vibrate([30, 60, 30, 60, 120]);
}

export function playSlash(): void {
  // A quick metallic "shink": bright attack, short low thud behind it.
  tone(1800, 0.06, 'sawtooth', 0.025);
  tone(2400, 0.09, 'square', 0.012, 0.02);
  tone(220, 0.12, 'triangle', 0.035, 0.05);
  vibrate([15, 30, 10]);
}
