import { config } from '../config';
import { midiFrequency, type ScheduledEvent } from './schedule';

export interface Player {
  /** Starts audio. Must run from a user gesture: iOS blocks audio until one. */
  play(events: readonly ScheduledEvent[], totalBeats: number, bpm: number): Promise<void>;
  stop(): void;
  readonly playing: boolean;
}

type ToneModule = typeof import('tone');

/** Thin wrapper over Tone.js. Tone is loaded on first Play so it stays out of the
 * initial page load. A fresh synth per run means Stop can dispose everything that
 * was scheduled ahead of time, with nothing left to fire afterwards.
 */
export function createPlayer(onEnded: () => void): Player {
  let tone: ToneModule | null = null;
  let synth: InstanceType<ToneModule['Synth']> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let playing = false;

  function stop(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    synth?.dispose();
    synth = null;
    if (playing) { playing = false; onEnded(); }
  }

  return {
    get playing() { return playing; },
    stop,
    async play(events, totalBeats, bpm) {
      stop();
      playing = true; // set first so a second tap during the load stops this run
      const loaded = tone ?? await import('tone');
      if (!playing) return;
      tone = loaded;
      await loaded.start();
      if (!playing) return;
      const secondsPerBeat = 60 / bpm;
      const instrument = new loaded.Synth(config.playbackSynth).toDestination();
      synth = instrument;
      const origin = loaded.now() + config.playbackStartDelaySeconds;
      for (const event of events) {
        if (event.midi === null) continue;
        // Shorten each note slightly so repeated pitches re-articulate.
        const sounding = event.durationBeats * secondsPerBeat * config.playbackNoteFraction;
        instrument.triggerAttackRelease(midiFrequency(event.midi), sounding, origin + event.startBeats * secondsPerBeat);
      }
      timer = setTimeout(stop, (config.playbackStartDelaySeconds + totalBeats * secondsPerBeat + 0.3) * 1000);
    },
  };
}
