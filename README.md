# Loreframe Server 🎬

**Loreframe Server** is an asynchronous, multi-agent AI orchestration backend for generating rich historical documentary videos. It powers the end-to-end documentary pipeline: story generation, scriptwriting, voiceover synthesis, 16:9 scene rendering, audio-visual timing synchronization, and final video assembly.

---

## 📐 Architecture & Pipeline Flow

```mermaid
flowchart TD
    User([User Prompt]) --> API[Express POST /api/generate]
    API --> BullMQ[BullMQ Job Queue - Redis]
    BullMQ --> Director[Director Agent - LangGraph]
    
    subgraph Agents Pipeline
        Director --> ScriptWriter[ScriptWriter Agent]
        ScriptWriter --> TTSAgent[TTS Agent - Audio Narration]
        TTSAgent --> ImageGen[ImageGenerator Agent - Visual Scenes]
        ImageGen --> VideoAssembler[Video Assembler Agent - FFmpeg Engine]
    end

    ScriptWriter -- Ollama / Gemini --> ScriptOutput[Script & Scene Prompts]
    TTSAgent -- Kokoro TTS / GCP --> AudioAssets[WAV / MP3 Files]
    ImageGen -- ComfyUI / Fallback --> ImageAssets[16:9 PNG Scenes]
    VideoAssembler -- FFmpeg Static --> FinalVideo[Final MP4 Documentary Video]
```

---

## 🛠️ Prerequisites & Local Service Setup

To run Loreframe locally, you need the following background services installed and running.

---

### 1. Redis (Queue & Job Management)

Loreframe uses **BullMQ** on top of **Redis** to queue and process video rendering tasks asynchronously.

#### Installation & Launch

* **Using Docker (Recommended):**
  ```bash
  docker run -d --name loreframe-redis -p 6379:6379 redis:alpine
  ```

* **Using Homebrew (macOS):**
  ```bash
  brew install redis
  brew services start redis
  ```

* **Verify Connection:**
  ```bash
  redis-cli ping
  # Expected Output: PONG
  ```

---

### 2. Ollama (Local Large Language Model)

Loreframe uses local LLMs via **Ollama** for non-cloud scriptwriting and documentary structuring.

#### Installation & Setup

1. **Install Ollama:** Download from [ollama.com](https://ollama.com) or run `brew install ollama`.
2. **Start the Ollama Server:**
   ```bash
   ollama serve
   ```
   *(By default, Ollama listens on `http://localhost:11434`)*

3. **Pull Required Models:**
   ```bash
   # Primary LLM Model (Script & Narrative Generation)
   ollama pull llama3.1:8b

   # Structured JSON Model (Used for scene parsing & JSON extraction)
   ollama pull llama3.1:8b
   ```

4. **Environment Config (`.env`):**
   ```env
   LLM_PROVIDER="ollama"
   OLLAMA_BASE_URL="http://localhost:11434"
   OLLAMA_MODEL_NAME="llama3.1:8b"
   OLLAMA_JSON_MODEL_NAME="llama3.1:8b"
   ```

---

### 3. ComfyUI (Local Image & LoRA Generation)

Loreframe uses **ComfyUI** REST API to render high-resolution 16:9 visual assets using Stable Diffusion checkpoints and custom LoRAs.

#### Installation & Setup

1. **Clone & Install ComfyUI:**
   Follow instructions at the [ComfyUI Repository](https://github.com/comfyanonymous/ComfyUI) or use ComfyUI Portable.

2. **Place Models & Checkpoints:**
   * **Checkpoints:** Download a SD 1.5 checkpoint (e.g. `v1-5-pruned-emaonly.safetensors` or SDXL / Flux checkpoints) and place it into:
     ```
     ComfyUI/models/checkpoints/
     ```
     *(Note: `comfyClient.ts` will automatically detect and fallback to any installed checkpoint if the default is not present.)*

   * **LoRAs (Style & Aesthetic Models):** Place your style LoRA `.safetensors` files (e.g. vintage paper, oil painting, watercolor, historical documentary style) into:
     ```
     ComfyUI/models/loras/
     ```

3. **Workflow Integration:**
   * Loreframe uses the workflow schema in [`src/workflows/comfy_image_workflow.json`](file:///Users/bibinantony/Documents/github/Loreframe-server/src/workflows/comfy_image_workflow.json).
   * To add a LoRA node in ComfyUI:
     - Add a `LoraLoader` node between your `CheckpointLoaderSimple` and `CLIPTextEncode`/`KSampler` nodes.
     - Save/export your workflow as **API Format JSON** and update `src/workflows/comfy_image_workflow.json`.

4. **Launch ComfyUI Server:**
   ```bash
   python main.py --listen 127.0.0.1 --port 8188
   ```

5. **Environment Config (`.env`):**
   ```env
   IMAGE_PROVIDER="comfyui"
   COMFYUI_BASE_URL="http://localhost:8188"
   ```

---

### 4. Kokoro TTS (Local Voiceover Speech Engine)

Loreframe uses **Kokoro TTS** via an OpenAI-compatible FastAPI REST service (`/v1/audio/speech`) for high-quality local voiceover synthesis.

#### Installation & Launch

* **Using Docker Container (Recommended):**
  ```bash
  docker run -d --name kokoro-tts -p 8880:8880 ghcr.io/resemble-ai/kokoro-fastapi
  ```

* **Available Voices:**
  - `am_adam` *(Default American Male - deep narrator tone)*
  - `af_bella` *(American Female)*
  - `am_michael` *(American Male)*

* **Environment Config (`.env`):**
  ```env
  TTS_PROVIDER="kokoro"
  KOKORO_BASE_URL="http://localhost:8880/v1/audio/speech"
  KOKORO_VOICE="am_adam"
  ```

---

## 🚀 Environment Setup & Project Execution

### 1. Copy Environment Configuration

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Ensure your `.env` contains:

```env
PORT=3001
NODE_ENV=development
DATABASE_URL="file:./dev.db"

# Redis Config
REDIS_HOST="localhost"
REDIS_PORT=6379

# LLM Config (ollama or gemini)
LLM_PROVIDER="ollama"
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_MODEL_NAME="llama3.1:8b"
OLLAMA_JSON_MODEL_NAME="llama3.1:8b"
GOOGLE_API_KEY="your-gemini-api-key-here"

# Image Config (comfyui or gemini)
IMAGE_PROVIDER="comfyui"
COMFYUI_BASE_URL="http://localhost:8188"

# TTS Config (kokoro or gcp)
TTS_PROVIDER="kokoro"
KOKORO_BASE_URL="http://localhost:8880/v1/audio/speech"
KOKORO_VOICE="am_adam"
```

### 2. Install Dependencies & Prepare Database

```bash
# Install node dependencies
npm install

# Generate Prisma Client & Push SQLite Schema
npm run db:generate
npm run db:push
```

### 3. Start Development Server

```bash
npm run dev
```

The server starts on `http://localhost:3001`.

---

## 🛰️ API Endpoints

### 1. Health Check
* **GET** `/health` or `/api/health`
* **Response:**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-08-04T08:26:32.000Z",
    "services": {
      "database": "connected",
      "redis": "connected"
    }
  }
  ```

### 2. Generate Historical Documentary Video
* **POST** `/api/generate`
* **Headers:** `Content-Type: application/json`
* **Body:**
  ```json
  {
    "prompt": "The Rise and Fall of the Roman Colosseum",
    "targetDurationMinutes": 2
  }
  ```
* **Response:**
  ```json
  {
    "jobId": "cm...123",
    "status": "QUEUED",
    "message": "Video generation job queued successfully"
  }
  ```

---

## 📁 Output Assets

Generated media files are saved in `/public`:
* `/public/audio/`: Synthesized narration voiceovers (`.mp3` / `.wav`)
* `/public/images/`: 16:9 scene visuals rendered by ComfyUI (`.png`)
* `/public/videos/`: Final assembled documentary MP4 video files (`.mp4`)

---

## 🧯 Troubleshooting & Fallbacks

* **Ollama Connection Error:** Ensure `ollama serve` is running and `OLLAMA_BASE_URL` is set correctly.
* **ComfyUI Fallback:** If ComfyUI is unavailable or encounters GPU OOM, Loreframe automatically generates dynamic gradient vector poster scenes via `Sharp` as a visual fallback so video assembly never fails.
* **Kokoro TTS Fallback:** If Kokoro TTS is unreachable, Loreframe generates clear PCM tone audio buffers to ensure sequence sync remains intact.
* **Redis Connection Refused:** Make sure Redis is listening on `6379`.
