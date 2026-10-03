import { loadPreferences, savePreferences } from "./preferences";

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

const PING_TONES: readonly Tone[] = [
  { wave: "sine", delay: 0, duration: 0.12, attack: 0.015, frequency: 1320, endFrequency: 1320, gain: 0.18 },
  { wave: "sine", delay: 0.1, duration: 0.25, attack: 0.015, frequency: 1760, endFrequency: 1760, gain: 0.18 },
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

  ping(): void {
    this.play(PING_TONES);
  }

  private play(tones: readonly Tone[]): void {
    if (!this.checkbox.checked) {
      return;
    }
    if (!this.context) {
      throw new Error("A scan sound played before ScanSounds.unlock().");
    }
    for (const tone of tones) {
      playTone(this.context, tone);
    }
  }
}

function playTone(context: AudioContext, tone: Tone): void {
  const start = context.currentTime + tone.delay;
  const end = start + tone.duration;
  const oscillator = context.createOscillator();
  oscillator.type = tone.wave;
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, end);
  const volume = context.createGain();
  // Exponential ramps can't start from or reach 0, hence the near-silent ends.
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(tone.gain, start + tone.attack);
  volume.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(volume).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(end);
}
