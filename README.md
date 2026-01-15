# Project Mirage: Digital Human

## Setup Instructions

### 1. Assets
**CRITICAL**: You must place your 3D avatar file in the `assets` folder.
- Path: `./assets/avatar.glb`
- If you don't have one, [download a sample RPM avatar](https://models.readyplayer.me/64b73b5d2595958612147321.glb) and rename it to `avatar.glb`.

### 2. Local Server
Due to Browser Security (CORS) and AudioContext rules, you **CANNOT** just double-click `index.html`.
You **MUST** use a local server.

**Recommended:**
1.  Install "Live Server" extension in VS Code.
2.  Right-click `index.html` -> "Open with Live Server".

### 3. API Keys
When the app opens, enter your keys:
- **Gemini API Key**: from Google AI Studio.
- **ElevenLabs API Key**: from ElevenLabs profile.

## Features
- **VAD Interruption**: Speak loudly while the avatar is talking to trigger the "Kill Switch".
- **Dynamic Status**: Watch the badge change colors (Thinking, Speaking, Listening).
- **Glassmorphism**: Premium dark UI.
