#!/bin/bash
# Installs Whisper speech recognition for Scripture Listener (Apple Silicon Mac):
# whisper.cpp via Homebrew, the large-v3-turbo model (~550 MB) and a small voice-activity model.
# Usage: npm run setup-whisper
set -euo pipefail
cd "$(dirname "$0")/.."
command -v whisper-server >/dev/null || brew install whisper-cpp
mkdir -p data/whisper
get() { [ -f "data/whisper/$1" ] || { echo "Downloading $1..."; curl -fL --progress-bar -o "data/whisper/$1.part" "$2" && mv "data/whisper/$1.part" "data/whisper/$1"; }; }
get ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
get ggml-silero-v5.1.2.bin https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin
echo "Whisper ready. Restart Scripture Listener to use it."
