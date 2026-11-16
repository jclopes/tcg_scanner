import { loadPreferences, savePreferences } from "./preferences";

/** 60 beats per minute. */
const HEARTBEAT_INTERVAL_MS = 60_000 / 60;

interface Tone {
  wave: OscillatorType;
  /** Seconds after now. */
  delay: number;
  duration: number;
  /** Seconds to reach full volume; longer is softer. */
  attack: number;
  /** Start and end pitch (Hz); the pitch glides between them. */
  frequency: number;
  endFrequency: number;
  /** Peak volume, 0–1. */
  gain: number;
}

/** Lub-dub, pitched up to 200–320 Hz: phone speakers can't play a real
 * heartbeat's 40–60 Hz. */
const HEARTBEAT_TONES: readonly Tone[] = [
  { wave: "sine", delay: 0, duration: 0.18, attack: 0.035, frequency: 280, endFrequency: 200, gain: 0.12 },
  { wave: "sine", delay: 0.28, duration: 0.14, attack: 0.035, frequency: 320, endFrequency: 230, gain: 0.08 },
];

/** A short, sharp click standing in for a camera shutter. */
const SHUTTER_TONES: readonly Tone[] = [
  { wave: "square", delay: 0, duration: 0.03, attack: 0.001, frequency: 1800, endFrequency: 900, gain: 0.2 },
];

/** A struck fundamental plus two quieter, slightly inharmonic overtones (the
 * ratios a small bell's partials roughly follow), all decaying together —
 * what gives it a "bell" timbre instead of a flat tone. */
const BELL_FUNDAMENTAL_HZ = 1180;
const BELL_TONES: readonly Tone[] = [
  { wave: "sine", delay: 0, duration: 0.9, attack: 0.004, frequency: BELL_FUNDAMENTAL_HZ, endFrequency: BELL_FUNDAMENTAL_HZ * 0.97, gain: 0.22 },
  { wave: "sine", delay: 0, duration: 0.6, attack: 0.004, frequency: BELL_FUNDAMENTAL_HZ * 2.4, endFrequency: BELL_FUNDAMENTAL_HZ * 2.3, gain: 0.1 },
  { wave: "sine", delay: 0, duration: 0.4, attack: 0.004, frequency: BELL_FUNDAMENTAL_HZ * 3.6, endFrequency: BELL_FUNDAMENTAL_HZ * 3.5, gain: 0.06 },
];

/** Synthesized scan sounds, muted by the Settings "Sound" checkbox. */
export class ScanSounds {
  private context: AudioContext | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly checkbox: HTMLInputElement) {
    checkbox.checked = loadPreferences().sound ?? true;
    checkbox.addEventListener("change", () => savePreferences({ sound: checkbox.checked }));
  }

  /** Must run from a user gesture (browsers block audio otherwise) before
   * any sound plays. */
  unlock(): void {
    this.context ??= new AudioContext();
    void this.context.resume();
  }

  setHeartbeat(on: boolean): void {
    if (on && this.heartbeatInterval === null) {
      this.play(HEARTBEAT_TONES);
      this.heartbeatInterval = setInterval(() => this.play(HEARTBEAT_TONES), HEARTBEAT_INTERVAL_MS);
    } else if (!on && this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /** A card was captured — a short camera-shutter click. */
  ping(): void {
    this.play(SHUTTER_TONES);
  }

  /** For an auto-accepted capture — distinct from ping() so the user can
   * tell, by ear, that no tap was needed. */
  bell(): void {
    this.play(BELL_TONES);
  }

  private play(tones: readonly Tone[]): void {
    if (!this.checkbox.checked) {
      return;
    }
    const context = this.context;
    if (!context) {
      throw new Error("A scan sound played before ScanSounds.unlock().");
    }
    tones.forEach((tone) => playTone(context, tone));
  }
}

function playTone(context: AudioContext, tone: Tone): void {
  const start = context.currentTime + tone.delay;
  const end = start + tone.duration;
  const oscillator = context.createOscillator();
  oscillator.type = tone.wave;
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, end);
  const volume = applyEnvelope(context, start, end, tone.attack, tone.gain);
  oscillator.connect(volume).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end);
}

/** A gain node ramping up from and back down to silence; exponential ramps
 * can't start from or reach 0, hence the near-silent ends. */
function applyEnvelope(context: AudioContext, start: number, end: number, attack: number, peak: number): GainNode {
  const volume = context.createGain();
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(peak, start + attack);
  volume.gain.exponentialRampToValueAtTime(0.0001, end);
  return volume;
}
