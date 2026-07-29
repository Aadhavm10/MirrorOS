# Voice Pipeline Setup

Wake word → record until silence → transcribe → assistant → speak reply.

All CPU-only: openWakeWord (wake) → webrtcvad (endpointing) → whisper.cpp
(STT) → `POST /api/assistant` (brain) → Piper (TTS). The daemon lives in
`voice/mirror_voice.py` and talks to the Node server over HTTP, so it runs
as its own process/service.

---

## Dev setup (macOS)

```bash
cd voice

# 1. Python env (3.12 — best wheel coverage; 3.14 lacks some audio wheels)
/opt/homebrew/bin/python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. whisper.cpp
brew install whisper-cpp     # provides `whisper-cli`

# 3. Models (~210 MB total, gitignored)
mkdir -p models
curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
.venv/bin/python -c "import openwakeword.utils; openwakeword.utils.download_models()"
.venv/bin/python -m piper.download_voices en_US-lessac-medium --data-dir models
```

### Smoke tests (no mic needed)

```bash
.venv/bin/python mirror_voice.py --say "Hello from the mirror"   # TTS + speakers
.venv/bin/python mirror_voice.py --transcribe some.wav           # STT
.venv/bin/python mirror_voice.py --list-devices                  # audio devices
```

### Live echo test

```bash
.venv/bin/python mirror_voice.py --echo
```

Say **"Hey Jarvis"**, wait for the chirp, speak a sentence, and it speaks the
transcript back. First run: macOS asks for microphone permission for your
terminal app — accept it. `--echo` never calls the assistant, so it works
before `ANTHROPIC_API_KEY` exists.

Drop `--echo` for real assistant replies (needs the key in `.env` and the
Node server running).

---

## Production setup (Surface Pro 4, Debian x86)

```bash
sudo apt install python3-venv python3-dev libportaudio2 build-essential cmake

cd /home/mirror/MirrorOS/voice
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# whisper.cpp from source (no brew on Linux; takes a few minutes on the i5)
git clone https://github.com/ggerganov/whisper.cpp /home/mirror/whisper.cpp
cmake -B /home/mirror/whisper.cpp/build /home/mirror/whisper.cpp
cmake --build /home/mirror/whisper.cpp/build -j --config Release
# binary: /home/mirror/whisper.cpp/build/bin/whisper-cli

# models — same three downloads as macOS above
```

Point the daemon at the built binary with `voice/voice.env`:

```
WHISPER_BIN=/home/mirror/whisper.cpp/build/bin/whisper-cli
```

### Audio devices

The mic (USB) and speakers (HDMI to the TV mainboard) may not be defaults:

```bash
.venv/bin/python mirror_voice.py --list-devices
```

Then in `voice/voice.env` set `AUDIO_INPUT_DEVICE` / `AUDIO_OUTPUT_DEVICE`
to a device index or a name substring.

### systemd service

`/etc/systemd/system/mirrorvoice.service`:

```ini
[Unit]
Description=MirrorOS Voice Pipeline
After=network.target mirroros.service

[Service]
Type=simple
User=mirror
WorkingDirectory=/home/mirror/MirrorOS/voice
ExecStart=/home/mirror/MirrorOS/voice/.venv/bin/python mirror_voice.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now mirrorvoice
journalctl -u mirrorvoice -f    # watch the [voice] log lines
```

---

## Configuration reference

Env vars, or `voice/voice.env` (copy `voice.env.example`; real env wins):

| Variable | Default | Notes |
|---|---|---|
| `MIRROR_URL` | `http://localhost:3000` | Node server |
| `WAKE_MODEL` | `hey_jarvis_v0.1` | see "Swapping the wake word" |
| `WAKE_THRESHOLD` | `0.5` | raise to ~0.6 if false triggers |
| `WHISPER_BIN` | `whisper-cli` | absolute path on the Surface |
| `WHISPER_MODEL` | `voice/models/ggml-base.en.bin` | `ggml-small.en.bin` = better, slower |
| `PIPER_VOICE` | `voice/models/en_US-lessac-medium.onnx` | any Piper voice |
| `AUDIO_INPUT_DEVICE` | system default | index or name substring |
| `AUDIO_OUTPUT_DEVICE` | system default | index or name substring |

## Swapping the wake word

Built-ins ship with openWakeWord: `hey_jarvis_v0.1`, `alexa_v0.1`,
`hey_mycroft_v0.1`, `hey_rhasspy_v0.1`. Set `WAKE_MODEL` to any of them.
For a custom phrase ("hey mirror"), train a model in the openWakeWord
Colab notebook (github.com/dscripka/openWakeWord → "Training New Models"),
drop the resulting `.onnx` somewhere, and set `WAKE_MODEL` to its absolute
path.

## Whisper model choice

`base.en` (148 MB) transcribes a short command in well under a second on
the Mac and a couple of seconds on the Surface's i5 — fine for commands.
If accuracy disappoints, download `ggml-small.en.bin` (488 MB) the same way
and point `WHISPER_MODEL` at it.
