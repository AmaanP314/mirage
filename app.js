import { TalkingHead } from "talkinghead";

// Utility: Convert Float32Array to WAV (16kHz mono)
function float32ToWav(float32Array, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + float32Array.length * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, "RIFF");
  // RIFF chunk length
  view.setUint32(4, 36 + float32Array.length * 2, true);
  // WAVE identifier
  writeString(view, 8, "WAVE");
  // fmt sub-chunk
  writeString(view, 12, "fmt ");
  // fmt sub-chunk length
  view.setUint32(16, 16, true);
  // sample format (1 is PCM)
  view.setUint16(20, 1, true);
  // mono (1 channel)
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * blockAlign)
  view.setUint32(28, sampleRate * 2, true);
  // block align (2 bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data sub-chunk
  writeString(view, 36, "data");
  // data sub-chunk length
  view.setUint32(40, float32Array.length * 2, true);

  // write PCM samples
  let offset = 44;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: "audio/wav" });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

class DigitalHuman {
  constructor() {
    this.config = {
      geminiKey: "",
      elevenLabsKey: "",
      deepgramKey: "",
      voiceId: "21m00Tcm4TlvDq8ikWAM", // Default Rachel
    };

    // Modules
    this.head = null; // TalkingHead
    this.socket = null; // Backend WebSocket
    this.vad = null; // Silero VAD
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // State
    this.state = "idle"; // idle, listening, thinking, speaking
    this.shouldInterrupt = false;

    // UI Elements
    this.ui = {
      container: document.getElementById("avatar-container"),
      badge: document.getElementById("status-badge"),
      statusText: document.getElementById("status-text"),
      chatOverlay: document.getElementById("chat-overlay"),
      micBar: document.getElementById("mic-level"),
    };
  }

  async init(keys) {
    this.config = { ...this.config, ...keys };
    this.updateStatus("loading", "INITIALIZING...");

    try {
      // 1. Setup Avatar
      await this.setupAvatar();

      // 2. Setup VAD (and Mic)
      await this.setupVAD();

      // 3. Connect Backend
      this.connectBackend();

      this.updateStatus("idle", "READY");
      console.log("System Initialized");
    } catch (error) {
      console.error("Init Error:", error);
      alert("Initialization failed. Check console.");
    }
  }

  updateStatus(mode, text) {
    this.state = mode;
    this.ui.statusText.innerText = text;
    this.ui.badge.className = `status-${mode}`;
    if (mode === "listening") {
      this.ui.micBar.style.backgroundColor = "#00ff00";
    } else if (mode === "speaking") {
      this.ui.micBar.style.backgroundColor = "#00ccff";
    } else {
      this.ui.micBar.style.backgroundColor = "#555";
    }
  }

  // --- AVATAR ---
  async setupAvatar() {
    this.head = new TalkingHead(this.ui.container, {
      cameraView: "upper",
      lipsyncModules: ["en"],
      cameraRotateEnable: false,
      ttsEndpoint:
        "https://eu-texttospeech.googleapis.com/v1beta1/text:synthesize",
    });

    const AVATAR_URL =
      "https://models.readyplayer.me/65a8dba831b23abb4f401bae.glb?morphTargets=ARKit,Oculus Visemes";

    await this.head.showAvatar({
      url: AVATAR_URL,
      body: "F",
      avatarMood: "neutral",
      lipsyncLang: "en",
    });

    this.head.start(); // Start animation loop
  }

  // --- VAD & AUDIO INPUT ---
  async setupVAD() {
    this.vad = await vad.MicVAD.new({
      workletURL: "./assets/libs/vad.worklet.bundle.min.js",
      modelURL: "./assets/libs/silero_vad.onnx",
      ortConfig: (ort) => {
        ort.env.wasm.wasmPaths = "./assets/libs/";
      },
      onSpeechStart: () => {
        console.log("VAD: Speech Start");
        // INTERRUPTION LOGIC
        if (this.state === "speaking" || this.state === "thinking") {
          this.interrupt();
        }
        this.updateStatus("listening", "LISTENING...");
      },
      onSpeechEnd: async (audio) => {
        console.log("VAD: Speech End", audio.length);
        // audio is Float32Array of the utterance
        if (this.state === "speaking") return;

        this.updateStatus("thinking", "PROCESSING...");
        await this.processUserAudio(audio);
      },
      onVADMisfire: () => {
        console.log("VAD: Misfire (Noise)");
        this.updateStatus("idle", "READY");
      },
    });

    this.vad.start();
  }

  // --- STT (Deepgram REST) ---
  async processUserAudio(float32Audio) {
    // 1. Convert to WAV
    const wavBlob = float32ToWav(float32Audio);

    // 2. Send to Deepgram
    try {
      const response = await fetch(
        "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${this.config.deepgramKey}`,
            "Content-Type": "audio/wav",
          },
          body: wavBlob,
        }
      );

      const data = await response.json();

      if (data.results && data.results.channels[0].alternatives[0]) {
        const transcript = data.results.channels[0].alternatives[0].transcript;
        console.log("Transcript:", transcript);

        if (transcript.trim().length > 0) {
          this.sendToBrain(transcript);
        } else {
          this.updateStatus("idle", "READY");
        }
      }
    } catch (e) {
      console.error("STT Error:", e);
      this.updateStatus("stopped", "STT ERROR");
    }
  }

  // --- BACKEND ---
  connectBackend() {
    this.socket = new WebSocket("ws://localhost:8000/ws/chat");

    this.socket.onopen = () => console.log("Brain Connected");

    this.socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "audio_response") {
        this.showSubtitle("AI: " + data.text);
        await this.speak(data.text);
      }
    };

    this.socket.onerror = (e) => console.error("WS Error:", e);
  }

  sendToBrain(text) {
    this.showSubtitle("User: " + text);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.updateStatus("thinking", "THINKING...");
      this.socket.send(text);
    }
  }

  // --- TTS & SPEAKING ---
  async speak(text) {
    this.state = "speaking";
    this.shouldInterrupt = false;
    this.updateStatus("speaking", "SPEAKING...");

    // 1. Fetch Audio from ElevenLabs
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.config.voiceId}?optimize_streaming_latency=3`,
        {
          method: "POST",
          headers: {
            "xi-api-key": this.config.elevenLabsKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: text,
            model_id: "eleven_turbo_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.7 },
          }),
        }
      );

      if (!response.ok) throw new Error("TTS Failed");

      const arrayBuffer = await response.arrayBuffer();

      // Check interruption before decoding
      if (this.shouldInterrupt) {
        console.log("Interrupted before playback");
        return;
      }

      const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);

      // Prepare for Lipsync
      const words = text.split(" ");
      const durationMs = audioBuffer.duration * 1000;
      const avgWordDur = durationMs / words.length;

      const audioObj = {
        audio: audioBuffer,
        words: words,
        wtimes: words.map((_, i) => i * avgWordDur),
        wdurations: words.map(() => avgWordDur),
      };

      // Play via TalkingHead
      return new Promise((resolve) => {
        this.head.speakAudio(audioObj, { lipsyncLang: "en" }, (sub) => {
          // Subtitle callback
        });

        // Monitor for interruption during playback
        const interval = setInterval(() => {
          if (this.shouldInterrupt) {
            clearInterval(interval);
            this.head.stopSpeaking(); // Stops current speech
            this.audioCtx.suspend().then(() => this.audioCtx.resume());
            resolve();
          }
        }, 100);

        setTimeout(() => {
          clearInterval(interval);
          if (this.state === "speaking") {
            // Only reset if not already interrupted/listening
            this.state = "idle";
            this.updateStatus("idle", "READY");
          }
          resolve();
        }, durationMs + 200);
      });
    } catch (e) {
      console.error("TTS Error:", e);
      this.state = "idle";
    }
  }

  interrupt() {
    console.log("!!! INTERRUPTED !!!");
    this.shouldInterrupt = true;
    this.state = "listening"; // Force state

    // Stop Audio immediately
    if (this.audioCtx.state === "running") {
      this.audioCtx.suspend().then(() => this.audioCtx.resume());
    }

    // Stop Avatar Animation (Reset to neutral)
    // force a short silent speak or just reset
    if (this.head) {
      // this.head.stop(); // Stops the loop
      // this.head.start(); // Restart loop
    }
  }

  // --- UI HELPER ---
  showSubtitle(text) {
    this.ui.chatOverlay.classList.remove("hidden");
    this.ui.chatOverlay.innerText = text;
    setTimeout(() => this.ui.chatOverlay.classList.add("hidden"), 5000);
  }
}

// Global Instance
let digitalHuman;

// --- INITIALIZATION ---
document.getElementById("start-btn").addEventListener("click", () => {
  const keys = {
    geminiKey: document.getElementById("gemini-key").value,
    elevenLabsKey: document.getElementById("elevenlabs-key").value,
    deepgramKey: document.getElementById("deepgram-key").value,
  };

  if (!keys.geminiKey || !keys.elevenLabsKey || !keys.deepgramKey) {
    alert("Please enter all 3 API keys.");
    return;
  }

  document.getElementById("config-modal").classList.add("hidden");

  digitalHuman = new DigitalHuman();
  digitalHuman.init(keys);
});

document.addEventListener("DOMContentLoaded", () => {
  // Check local storage for keys
});
