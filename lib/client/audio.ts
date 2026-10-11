// Аудио-движок голосового репетитора: запись микрофона (MediaRecorder) и
// воспроизведение голоса ИИ идут через один AudioContext с анализатором — так одна
// и та же волна показывает и речь ученика, и голос репетитора. Контекст создаётся
// по жесту пользователя: в iOS WebView это единственный способ потом проиграть звук,
// пришедший асинхронно (после запросов к API), без блокировки автовоспроизведения.

// iOS (Telegram WebView и Safari) пишет только mp4/AAC — он идёт первым, если поддержан:
// так запись гарантированно читается Whisper. Chrome и Android берут webm/opus.
const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];

export class AudioEngine {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private playing: AudioBufferSourceNode | null = null;
  private levels: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));

  // Вызывать синхронно внутри обработчика нажатия.
  unlock() {
    if (!this.context) {
      const Context = window.AudioContext ?? (window as any).webkitAudioContext;
      this.context = new Context();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.82;
      this.levels = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    }
    if (this.context.state === "suspended") this.context.resume();
  }

  // Спектр 0..1 по полосам — для отрисовки волны.
  readLevels(bands: number): number[] {
    if (!this.analyser) return new Array(bands).fill(0);
    this.analyser.getByteFrequencyData(this.levels);
    // Верхние частоты речи почти пусты — берём нижние ~70 % спектра.
    const usable = Math.floor(this.levels.length * 0.7);
    const step = usable / bands;
    return Array.from({ length: bands }, (_, band) => {
      let sum = 0;
      const from = Math.floor(band * step);
      const to = Math.max(from + 1, Math.floor((band + 1) * step));
      for (let i = from; i < to; i++) sum += this.levels[i];
      return sum / (to - from) / 255;
    });
  }

  static supported() {
    return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && "MediaRecorder" in window;
  }

  async startRecording() {
    this.unlock();
    this.stopPlayback();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.micSource = this.context!.createMediaStreamSource(this.stream);
    this.micSource.connect(this.analyser!);

    const mimeType = RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    // Без timeslice: Safari при нарезке на куски иногда пишет mp4 без заголовков в хвостовых
    // фрагментах — цельная запись отдаётся одним куском на stop() и всегда валидна.
    this.recorder.start();
  }

  stopRecording(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        this.micSource?.disconnect();
        this.micSource = null;
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        this.recorder = null;
        const blob = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
        resolve(blob.size > 0 ? blob : null);
      };
      recorder.stop();
    });
  }

  async play(data: ArrayBuffer, onEnd?: () => void) {
    this.unlock();
    this.stopPlayback();
    const buffer = await this.context!.decodeAudioData(data);
    const source = this.context!.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser!);
    this.analyser!.connect(this.context!.destination);
    source.onended = () => {
      this.analyser?.disconnect();
      if (this.playing === source) this.playing = null;
      onEnd?.();
    };
    this.playing = source;
    source.start();
  }

  stopPlayback() {
    if (!this.playing) return;
    try {
      this.playing.stop();
    } catch {
      // уже остановлен
    }
    this.playing = null;
  }

  dispose() {
    this.stopPlayback();
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.context?.close();
    this.context = null;
  }
}

// Запасной голос: системный синтез речи устройства — когда нет OPENAI_API_KEY,
// тариф Free или OpenAI не ответил. Предпочитаем женские голоса нужного языка.
// Любой сбой здесь не показывается пользователю ошибкой: озвучка просто завершается.
const FEMALE_HINTS =
  /(female|samantha|monica|paulina|google español|google us english|karen|moira|tessa|victoria|milena|alena|nova)/i;

// В Chrome и Android WebView список голосов приходит асинхронно — ждём его до 800 мс.
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const ready = synth.getVoices();
  if (ready.length) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", done);
    setTimeout(done, 800);
  });
}

export async function speakWithBrowser(text: string, lang: string, onEnd?: () => void) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onEnd?.();
  };
  try {
    if (!("speechSynthesis" in window)) return finish();
    const synth = window.speechSynthesis;
    synth.cancel();
    const voices = (await loadVoices()).filter((voice) => voice.lang.replace("_", "-").startsWith(lang.slice(0, 2)));
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.95;
    utterance.voice = voices.find((voice) => FEMALE_HINTS.test(voice.name)) ?? voices[0] ?? null;
    utterance.onend = finish;
    utterance.onerror = finish;
    synth.speak(utterance);
    // Страховка: некоторые WebView не присылают onend — снимаем состояние «говорит» сами.
    setTimeout(finish, Math.max(4000, text.length * 120));
  } catch {
    finish();
  }
}
