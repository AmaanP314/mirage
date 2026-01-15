import os
import requests

ASSETS_DIR = "assets/libs"
os.makedirs(ASSETS_DIR, exist_ok=True)

FILES = {
    "silero_vad.onnx": "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.13/dist/silero_vad.onnx",
    "vad.worklet.bundle.min.js": "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.13/dist/vad.worklet.bundle.min.js",
    "vad.min.js": "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.13/dist/bundle.min.js",
    "ort.min.js": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort.min.js",
    "ort-wasm.wasm": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort-wasm.wasm",
    "ort-wasm-simd.wasm": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort-wasm-simd.wasm",
    "ort-wasm-threaded.wasm": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort-wasm-threaded.wasm",
    "ort-wasm-simd-threaded.wasm": "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/ort-wasm-simd-threaded.wasm"
}

print(f"Downloading {len(FILES)} files to {ASSETS_DIR}...")

for filename, url in FILES.items():
    print(f"Downloading {filename}...")
    try:
        response = requests.get(url)
        response.raise_for_status()
        with open(f"{ASSETS_DIR}/{filename}", "wb") as f:
            f.write(response.content)
        print(f"[OK] {filename}")
    except Exception as e:
        print(f"[FAIL] Failed {filename}: {e}")

print("Download complete.")
