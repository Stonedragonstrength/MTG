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
