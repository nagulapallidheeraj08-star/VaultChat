# VaultChat

100% local AI & private document RAG

## Problem Statement

Most AI chat applications send your data to external servers, compromising privacy. Document-based Q&A typically requires cloud-hosted vector databases and embedding APIs. There's a need for a fully local solution where both the LLM and the retrieval pipeline run on the user's machine with zero network calls to third parties.

## Solution Overview

VaultChat is a Next.js application that runs entirely locally:

- **LLM inference** via Ollama (localhost:11434) — no API keys, no cloud
- **Embeddings & RAG** via `@huggingface/transformers` in a Web Worker — model downloads once, runs in-browser
- **PDF text extraction** via `pdfjs-dist` — client-side, no upload
- **Chat UI** with streaming responses, source citations, and real-time indexing progress

Everything runs on your hardware. Documents never leave your browser; queries never leave your machine.

## On-Device AI Usage

### Ollama LLM Inference
- **Runtime**: Ollama server (`http://127.0.0.1:11434`)
- **Model**: `llama3.2:1b` (1B parameter Llama 3.2, ~1.3 GB)
- **Protocol**: Native `/api/chat` streaming endpoint
- **Integration**: Browser `fetch` with `ReadableStream` for token-by-token UI updates

### On-Device Embedding & RAG Pipeline
- **Runtime**: `@huggingface/transformers` (WebAssembly/WebGPU backend) inside a **Web Worker** — keeps UI thread responsive
- **Model**: `Xenova/all-MiniLM-L6-v2` (quantized, ~90 MB download on first use, cached in browser)
- **Chunking**: ~500-character sliding window with 50-char overlap, sentence-aware splitting
- **Indexing**: In-memory only — each chunk stores its `Float32Array` embedding alongside text
- **Retrieval**: Cosine similarity over all indexed chunks; top-3 injected into Ollama prompt as:
  ```
  Context from your documents:
  [Source: filename.pdf]
  chunk text...
  
  ---
  
  [Source: another.pdf]
  chunk text...
  
  User question: {query}
  
  Answer:
  ```
- **Progress**: Real percentage-based UI updates during model load, chunk embedding, and search

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| LLM | Ollama (`llama3.2:1b`) |
| Embeddings | `@huggingface/transformers` (`Xenova/all-MiniLM-L6-v2`) |
| PDF Parsing | `pdfjs-dist` (Web Worker) |
| Icons | `lucide-react` |
| Utilities | `clsx`, `tailwind-merge` |

## Setup Instructions

### Prerequisites
- Node.js 18+
- npm / pnpm / yarn
- Ollama installed and running

### 1. Install Ollama & Pull Model
```bash
# macOS
brew install ollama
# Linux
curl -fsSL https://ollama.com/install.sh | sh
# Windows: download from https://ollama.com/download

# Start Ollama server (keep running)
ollama serve

# In a separate terminal, pull the model
ollama pull llama3.2:1b
```

Verify it works:
```bash
curl http://127.0.0.1:11434/api/tags
# Should return {"models":[{"name":"llama3.2:1b",...}]}
```

### 2. Install & Run VaultChat
```bash
cd vault-chat
npm install
npm run dev
```

Open `http://localhost:3000`.

## Usage Instructions

1. **Upload PDFs** — Drag & drop or click the left sidebar. Each file shows page-by-page extraction progress, then indexing progress (embedding generation).
2. **Wait for "Indexed"** — Green checkmark + "Indexed" badge means the document is searchable.
3. **Ask questions** — Type in the chat input. The app:
   - Embeds your query locally
   - Finds top-3 matching chunks across all indexed docs
   - Sends query + context to Ollama
   - Streams the answer token-by-token
4. **View sources** — Click "Sources (N)" on any assistant message to see which chunks were used, with similarity scores.

## Known Limitations / Future Scope

- **No voice input** — Text-only chat; no microphone, Whisper, or transcription features
- **In-memory only** — Document chunks and embeddings are lost on page refresh; no persistence (IndexedDB, file export, or server-side store)
- **Single model** — Hardcoded to `llama3.2:1b` and `all-MiniLM-L6-v2`; no model selector
- **No multi-user / auth** — Single-user local app
- **No hybrid search** — Pure vector similarity; no keyword/BM25 fallback
- **Browser cache dependency** — Embedding model downloads ~90 MB on first visit; cached via browser Cache API
- **Ollama must be local** — Only `http://127.0.0.1:11434` supported; no remote Ollama or OpenAI-compatible endpoints

## Known Issues & Fixes

### Browser Extension Interference (Hydration Mismatch)
Password manager extensions (Bitwarden, 1Password, etc.) inject attributes like `bis_register` into `<body>` before React hydrates, causing:
```
A tree hydrated but some attributes of the server rendered HTML didn't match...
```
**Fix**: Disable the extension for `localhost:3000` or use incognito mode. The app works correctly — this is purely a hydration warning.

### Ollama CORS Error
If you see `Cross-Origin Request Blocked` when calling `http://127.0.0.1:11434`:
```bash
# Set allowed origin and restart Ollama
$env:OLLAMA_ORIGINS = "http://localhost:3000"  # PowerShell
ollama serve
```
Or add to your shell profile (`.bashrc`, `.zshrc`, etc.):
```bash
export OLLAMA_ORIGINS="http://localhost:3000"
```

### Port 11434 Already in Use
```bash
# Find and kill the process
netstat -ano | findstr :11434
taskkill /PID <PID> /F

# Or run Ollama on a different port
$env:OLLAMA_HOST = "127.0.0.1:11435"
ollama serve
```

## Demo

[Screen recording](https://drive.google.com/file/d/1ogb40m0ICHPajp85dm4Z70xx8dKge3ZD/view?usp=drive_link) (Google Drive)

## License

MIT — see [LICENSE](LICENSE) for details. Copyright (c) 2026 Nagulapalli Dheeraj