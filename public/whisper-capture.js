// Microphone capture for Whisper: records 16 kHz mono audio, cuts it into phrases at natural
// pauses, and hands each phrase over as a WAV file. Loudness-based, adapting to the room's
// background noise, so it works with a room mic or a feed from the sound desk.

const SAMPLE_RATE = 16000;
const FRAME = 480; // 30 ms
const FRAME_MS = 30;
const PRE_ROLL_FRAMES = 10; // keep 300 ms before speech starts so first words aren't clipped
const END_SILENCE_MS = 700; // a pause this long ends a phrase
const MIN_PHRASE_MS = 1000;
const MAX_PHRASE_MS = 12000; // long run-on speech is cut so text keeps flowing
const MIN_SPEECH_MS = 300; // shorter bursts (a cough, a click) are dropped

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${FRAME}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === ${FRAME}) { this.port.postMessage(this.buf.slice()); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('capture', Capture);
`;

function encodeWav(frames) {
  const samples = frames.reduce((n, f) => n + f.length, 0);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  let o = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 1, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, f[i])) * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export class WhisperCapture {
  /**
   * @param {object} opts
   * @param {string} [opts.deviceId] microphone to use ('' = default)
   * @param {(wav: Blob) => void} opts.onPhrase called with each spoken phrase
   * @param {(level: number, speaking: boolean) => void} [opts.onLevel] ~33x per second, level 0..1
   */
  constructor({ deviceId = '', onPhrase, onLevel = () => {} }) {
    Object.assign(this, { deviceId, onPhrase, onLevel });
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.node = new AudioWorkletNode(this.ctx, 'capture');
    this.node.port.onmessage = (e) => this.frame(e.data);
    this.ctx.createMediaStreamSource(this.stream).connect(this.node);

    this.noise = 0.005; // running estimate of background loudness
    this.preRoll = [];
    this.phrase = null;
  }

  stop() {
    this.flush();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.node = this.stream = this.ctx = null;
  }

  frame(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    // Background level follows quiet moments quickly and loud ones slowly.
    this.noise = rms < this.noise ? this.noise * 0.9 + rms * 0.1 : this.noise * 0.999 + rms * 0.001;
    const speaking = rms > Math.max(0.006, this.noise * 3);
    this.onLevel(Math.min(1, rms * 8), speaking);

    if (!this.phrase) {
      this.preRoll.push(samples);
      if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
      if (speaking) {
        this.phrase = { frames: [...this.preRoll], speechMs: 0, silenceMs: 0 };
        this.preRoll = [];
      }
      return;
    }
    const p = this.phrase;
    p.frames.push(samples);
    if (speaking) {
      p.speechMs += FRAME_MS;
      p.silenceMs = 0;
    } else {
      p.silenceMs += FRAME_MS;
    }
    const length = p.frames.length * FRAME_MS;
    if ((p.silenceMs >= END_SILENCE_MS && length >= MIN_PHRASE_MS) || length >= MAX_PHRASE_MS) this.flush();
  }

  flush() {
    const p = this.phrase;
    this.phrase = null;
    if (p && p.speechMs >= MIN_SPEECH_MS) this.onPhrase(encodeWav(p.frames));
  }
}
