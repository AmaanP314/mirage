import { TalkingHead } from "talkinghead";
import * as THREE from "three";

function float32ToWav(float32Array, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + float32Array.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + float32Array.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, float32Array.length * 2, true);
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
      voiceId: "21m00Tcm4TlvDq8ikWAM",
    };

    this.head = null;
    this.socket = null;
    this.vad = null;
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    this.state = "idle";
    this.shouldInterrupt = false;

    this.ui = {
      container: document.getElementById("avatar-container"),
      badge: document.getElementById("status-badge"),
      statusText: document.getElementById("status-text"),
      chatHistory: document.getElementById("chat-history"),
      visualizer: document.getElementById("visualizer"),
    };

    this.initVisualizer();
  }

  initVisualizer() {
    this.vizBars = [];
    for (let i = 0; i < 20; i++) {
      const bar = document.createElement("div");
      bar.className = "viz-bar";
      this.ui.visualizer.appendChild(bar);
      this.vizBars.push(bar);
    }
  }

  updateVisualizer(volume) {
    const intensity = Math.min(1, volume * 5);
    this.vizBars.forEach((bar, i) => {
      const height = 4 + Math.random() * 40 * intensity;
      bar.style.height = `${height}px`;
      bar.style.opacity = 0.3 + intensity * 0.7;
    });
  }

  async init(keys) {
    this.config = { ...this.config, ...keys };
    this.updateStatus("loading", "INITIALIZING...");

    try {
      await this.setupAvatar();
      await this.setupVAD();
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

    this.ui.badge.className = `system-status status-${mode}`;

    if (mode === "listening") {
      this.startVizLoop();
    } else {
      this.stopVizLoop();
    }
  }

  startVizLoop() {
    if (this.vizInterval) clearInterval(this.vizInterval);
    this.vizInterval = setInterval(() => {
      if (this.state === "listening" || this.state === "speaking") {
        this.updateVisualizer(Math.random() * 0.5);
      } else {
        this.updateVisualizer(0);
      }
    }, 50);
  }

  stopVizLoop() {
    if (this.vizInterval) clearInterval(this.vizInterval);
    this.updateVisualizer(0);
  }

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

    this.head.start();
  }

  async setupVAD() {
    this.vad = await vad.MicVAD.new({
      workletURL: "./assets/libs/vad.worklet.bundle.min.js",
      modelURL: "./assets/libs/silero_vad.onnx",
      ortConfig: (ort) => {
        ort.env.wasm.wasmPaths = "./assets/libs/";
      },
      onSpeechStart: () => {
        console.log("VAD: Speech Start");
        if (this.state === "speaking" || this.state === "thinking") {
          this.interrupt();
        }
        this.updateStatus("listening", "LISTENING...");
      },
      onSpeechEnd: async (audio) => {
        console.log("VAD: Speech End", audio.length);
        if (this.state === "speaking") return;

        this.updateStatus("thinking", "PROCESSING...");
        await this.processUserAudio(audio);
      },
      onVADMisfire: () => {
        console.log("VAD: Misfire");
        this.updateStatus("idle", "READY");
      },
    });

    this.vad.start();
  }

  async processUserAudio(float32Audio) {
    const wavBlob = float32ToWav(float32Audio);
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

  connectBackend() {
    this.socket = new WebSocket("ws://localhost:8000/ws/chat");

    this.socket.onopen = () => console.log("Brain Connected");

    this.socket.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "audio_response") {
        this.addMessage("ai", data.text);
        await this.speak(data.text);
      }
    };

    this.socket.onerror = (e) => console.error("WS Error:", e);
  }

  sendToBrain(text) {
    this.addMessage("user", text);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.updateStatus("thinking", "THINKING...");
      this.socket.send(text);
    }
  }

  async speak(text) {
    this.state = "speaking";
    this.shouldInterrupt = false;
    this.updateStatus("speaking", "SPEAKING...");

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

      if (this.shouldInterrupt) {
        return;
      }

      const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);

      const words = text.split(" ");
      const durationMs = audioBuffer.duration * 1000;
      const avgWordDur = durationMs / words.length;

      const audioObj = {
        audio: audioBuffer,
        words: words,
        wtimes: words.map((_, i) => i * avgWordDur),
        wdurations: words.map(() => avgWordDur),
      };

      return new Promise((resolve) => {
        this.head.speakAudio(audioObj, { lipsyncLang: "en" }, (sub) => {});

        const interval = setInterval(() => {
          if (this.shouldInterrupt) {
            clearInterval(interval);
            this.audioCtx.suspend().then(() => this.audioCtx.resume());
            resolve();
          }
        }, 100);

        setTimeout(() => {
          clearInterval(interval);
          if (this.state === "speaking") {
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
    this.shouldInterrupt = true;
    this.state = "listening";
    if (this.audioCtx.state === "running") {
      this.audioCtx.suspend().then(() => this.audioCtx.resume());
    }
  }

  addMessage(role, text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${role}`;

    const label = document.createElement("span");
    label.className = "message-label";
    label.innerText = role === "user" ? "YOU" : "MIRAGE";

    msgDiv.appendChild(label);
    msgDiv.appendChild(document.createTextNode(text));

    this.ui.chatHistory.appendChild(msgDiv);
    this.ui.chatHistory.scrollTop = this.ui.chatHistory.scrollHeight;
  }
}

let digitalHuman;

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
