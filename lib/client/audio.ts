// Аудио-движок голосового занятия: запись микрофона (MediaRecorder) с анализатором для
// волны. Контекст создаётся по жесту пользователя — иначе iOS WebView его не запустит.

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

  dispose() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.context?.close();
    this.context = null;
  }
}

// Голос Мартины: бесплатный системный синтез речи устройства (Web Speech API), без
// платных сервисов. Тёплый женский голос: русский — для русских реплик, голос изучаемого
// языка — для фраз на английском или испанском. Любой сбой не показывается ошибкой:
// озвучка просто завершается.

// Лучшие известные женские голоса по платформам: iOS/macOS (Milena, Katya), Android/Chrome
// (Google русский), Windows (Svetlana, Dariya), плюс женские голоса для en/es.
const PREFERRED_VOICES =
  /(milena|katya|google русский|svetlana|dariya|irina|alena|female|samantha|karen|moira|tessa|victoria|monica|paulina|google español|google us english)/i;
// Мягкая, ласковая подача: чуть медленнее и чуть выше обычного.
const RATE = 0.92;
const PITCH = 1.08;

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

function pickVoice(voices: SpeechSynthesisVoice[], lang: string) {
  const base = lang.slice(0, 2).toLowerCase();
  const matching = voices.filter((voice) => voice.lang.replace("_", "-").toLowerCase().startsWith(base));
  // Улучшенные (Enhanced/Premium) версии звучат заметно естественнее — берём их первыми.
  const score = (voice: SpeechSynthesisVoice) =>
    (PREFERRED_VOICES.test(voice.name) ? 2 : 0) + (/enhanced|premium|natural|neural/i.test(voice.name) ? 1 : 0);
  return matching.sort((a, b) => score(b) - score(a))[0] ?? null;
}

// Длинные реплики Chrome обрывает примерно на 15-й секунде — говорим по предложениям.
function splitSentences(text: string) {
  return (text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text]).map((part) => part.trim()).filter(Boolean);
}

let primed = false;

// iOS разрешает синтез речи только после жеста пользователя. Вызывать синхронно в
// обработчике нажатия: пустая фраза «разблокирует» голос для последующих ответов,
// которые приходят асинхронно после запроса к ИИ.
export function primeSpeech() {
  if (primed || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  primed = true;
  try {
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
  } catch {
    // не критично: озвучка просто начнётся со следующего нажатия
  }
}

export function stopSpeech() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // нечего останавливать
  }
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
    const voice = pickVoice(await loadVoices(), lang);
    const parts = splitSentences(text);
    parts.forEach((part, index) => {
      const utterance = new SpeechSynthesisUtterance(part);
      utterance.lang = voice?.lang ?? lang;
      utterance.voice = voice;
      utterance.rate = RATE;
      utterance.pitch = PITCH;
      if (index === parts.length - 1) {
        utterance.onend = finish;
        utterance.onerror = finish;
      }
      synth.speak(utterance);
    });
    // Страховка: некоторые WebView не присылают onend — снимаем состояние «говорит» сами.
    setTimeout(finish, Math.max(4000, text.length * 110));
  } catch {
    finish();
  }
}
