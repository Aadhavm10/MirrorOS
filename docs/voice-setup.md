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

## Production setup (OptiPlex, Linux Mint)

```bash
sudo apt install python3-venv python3-dev libportaudio2 build-essential cmake

cd /home/aadhav/MirrorOS/voice
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# whisper.cpp from source (no brew on Linux; a few minutes on the OptiPlex)
git clone https://github.com/ggerganov/whisper.cpp /home/aadhav/whisper.cpp
cmake -B /home/aadhav/whisper.cpp/build /home/aadhav/whisper.cpp
cmake --build /home/aadhav/whisper.cpp/build -j --config Release
# binary: /home/aadhav/whisper.cpp/build/bin/whisper-cli

# models — same three downloads as macOS above
```

Point the daemon at the built binary with `voice/voice.env`:

```
WHISPER_BIN=/home/aadhav/whisper.cpp/build/bin/whisper-cli
```

### Audio devices

The mic (USB) and speakers (the panel's HDMI audio, or the OptiPlex's headphone jack) may not be defaults:

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
User=aadhav
WorkingDirectory=/home/aadhav/MirrorOS/voice
ExecStart=/home/aadhav/MirrorOS/voice/.venv/bin/python mirror_voice.py
Restart=always
RestartSec=5
# Mint's audio goes through PipeWire, which runs in the desktop session. This
# points the service at that session's sound server; 1000 is aadhav's uid
# (check with `id -u`).
Environment=XDG_RUNTIME_DIR=/run/user/1000

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
| `WHISPER_BIN` | `whisper-cli` | absolute path on the mirror |
| `WHISPER_MODEL` | `voice/models/ggml-base.en.bin` | `ggml-small.en.bin` = better, slower |
| `PIPER_VOICE` | `voice/models/en_US-lessac-medium.onnx` | any Piper voice |
| `AUDIO_INPUT_DEVICE` | system default | index or name substring |
| `AUDIO_OUTPUT_DEVICE` | system default | index or name substring |

## Swapping the wake word

Built-ins ship with openWakeWord: `hey_jarvis_v0.1`, `alexa_v0.1`,
`hey_mycroft_v0.1`, `hey_rhasspy_v0.1`. Set `WAKE_MODEL` to any of them and
you're done.

### "Hey mirror" — needs training

There is **no bundled "hey mirror" model**, so this isn't a config change. You
have to train one. The good news is it's synthetic — you don't record yourself
saying it hundreds of times.

1. Open the openWakeWord training notebook in Google Colab:
   github.com/dscripka/openWakeWord → *Training New Models* →
   `automatic_model_training.ipynb`
2. Set the target phrase to `hey mirror`
3. Run it. It uses Piper (the same TTS engine this repo already uses to *speak*)
   to synthesise thousands of variations of the phrase across different voices
   and accents, mixes in noise and negative samples, and trains a small
   classifier. Budget ~1 hour, nearly all of it waiting.
4. Download the resulting `hey_mirror.onnx`
5. Drop it in `voice/models/` and point `WAKE_MODEL` at its **absolute path**:

```
WAKE_MODEL=/home/aadhav/MirrorOS/voice/models/hey_mirror.onnx
```

Then tune the threshold. A freshly trained model is usually twitchier than the
bundled ones — start at `WAKE_THRESHOLD=0.6` and raise it if the mirror wakes
at the TV, lower it if it ignores you. Watch `[voice] wake (0.NN)` in the log to
see what scores you're actually getting.

> Short phrases false-trigger more. "Hey mirror" is two syllables of common
> English and will misfire more than "hey jarvis" does — if it's unusable after
> threshold tuning, that's why, and a longer or more distinctive phrase is the
> fix rather than more training.

`mirror_voice.py` reads the model's registered name back from openWakeWord
rather than assuming it matches `WAKE_MODEL`, so a file path works without
further changes.

## Whisper model choice

`base.en` (148 MB) transcribes a short command in well under a second on
the Mac and a second or two on the OptiPlex — fine for commands.
If accuracy disappoints, download `ggml-small.en.bin` (488 MB) the same way
and point `WHISPER_MODEL` at it.
