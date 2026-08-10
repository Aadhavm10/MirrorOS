#!/usr/bin/env python3
"""MirrorOS voice pipeline.

Wake word (openWakeWord) -> record until silence (webrtcvad) ->
transcribe (whisper.cpp) -> POST /api/assistant -> speak reply (Piper).

Everything is CPU-only. All paths and devices come from env vars (or
voice/voice.env), so the same file runs on the dev Mac and the Surface.

    python mirror_voice.py                 # normal operation
    python mirror_voice.py --echo          # speak transcript back, skip assistant
    python mirror_voice.py --once          # handle one interaction, then exit
    python mirror_voice.py --list-devices  # show audio devices
    python mirror_voice.py --say "hi"      # TTS smoke test
    python mirror_voice.py --transcribe f.wav  # STT smoke test
"""

import argparse
import os
import queue
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy as np

VOICE_DIR = Path(__file__).resolve().parent

# --- Config: voice.env file (if present), then real env, then defaults ------

def _load_env_file():
    env_file = VOICE_DIR / "voice.env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())

_load_env_file()

CFG = {
    "mirror_url": os.environ.get("MIRROR_URL", "http://localhost:3000"),
    "wake_model": os.environ.get("WAKE_MODEL", "hey_jarvis_v0.1"),
    "wake_threshold": float(os.environ.get("WAKE_THRESHOLD", "0.5")),
    "whisper_bin": os.environ.get("WHISPER_BIN", "whisper-cli"),
    "whisper_model": os.environ.get("WHISPER_MODEL", str(VOICE_DIR / "models" / "ggml-base.en.bin")),
    "piper_voice": os.environ.get("PIPER_VOICE", str(VOICE_DIR / "models" / "en_US-lessac-medium.onnx")),
    # int index, name substring, or empty for system default
    "input_device": os.environ.get("AUDIO_INPUT_DEVICE", "") or None,
    "output_device": os.environ.get("AUDIO_OUTPUT_DEVICE", "") or None,
}

SAMPLE_RATE = 16000
BLOCK = 1280            # 80 ms — openWakeWord's preferred chunk
VAD_FRAME = 160         # 10 ms subframes for webrtcvad
SILENCE_BLOCKS = 12     # ~1.0 s of silence ends the command
MAX_BLOCKS = 180        # ~14.4 s hard cap per command
NO_SPEECH_BLOCKS = 62   # give up if nothing said within ~5 s of the wake

# --- TTS ---------------------------------------------------------------------

_piper = None

def speak(text):
    global _piper
    import sounddevice as sd
    if _piper is None:
        from piper import PiperVoice
        _piper = PiperVoice.load(CFG["piper_voice"])
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = tmp.name
    try:
        with wave.open(path, "wb") as wf:
            _piper.synthesize_wav(text, wf)
        with wave.open(path, "rb") as wf:
            rate = wf.getframerate()
            audio = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
        sd.play(audio, rate, device=CFG["output_device"])
        sd.wait()
    finally:
        os.unlink(path)

def chirp():
    """Short rising tone so you know the mirror is listening."""
    import sounddevice as sd
    t = np.linspace(0, 0.15, int(0.15 * 22050), dtype=np.float32)
    tone = 0.25 * np.sin(2 * np.pi * (600 + 1200 * t / 0.15) * t)
    sd.play(tone, 22050, device=CFG["output_device"])
    sd.wait()

# --- STT ---------------------------------------------------------------------

def transcribe(wav_path):
    cmd = [
        CFG["whisper_bin"], "-m", CFG["whisper_model"],
        "-f", wav_path, "-np", "-nt", "--language", "en",
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise RuntimeError(f"whisper failed: {out.stderr.strip()[:200]}")
    return " ".join(out.stdout.split()).strip()

# --- Assistant ---------------------------------------------------------------

def ask_assistant(text):
    import requests
    res = requests.post(
        f"{CFG['mirror_url']}/api/assistant", json={"text": text}, timeout=60
    )
    if res.status_code == 503:
        return "The assistant isn't configured yet."
    res.raise_for_status()
    return res.json()["reply"]

def report(state, text=""):
    """Tell the mirror display what we're doing (best-effort; never fatal)."""
    import requests
    try:
        requests.post(
            f"{CFG['mirror_url']}/api/voice/state",
            json={"state": state, "text": text}, timeout=2,
        )
    except Exception:
        pass

# --- Audio capture -----------------------------------------------------------

def record_command(audio_q, vad):
    """Collect audio after the wake word until ~1 s of silence."""
    blocks, silent, heard_speech = [], 0, False
    for i in range(MAX_BLOCKS):
        block = audio_q.get()
        blocks.append(block)
        speechy = sum(
            vad.is_speech(block[j : j + VAD_FRAME * 2], SAMPLE_RATE)
            for j in range(0, len(block), VAD_FRAME * 2)
        )
        if speechy >= 2:
            heard_speech, silent = True, 0
        else:
            silent += 1
        if heard_speech and silent >= SILENCE_BLOCKS:
            break
        if not heard_speech and i >= NO_SPEECH_BLOCKS:
            return None
    if not heard_speech:
        return None
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = tmp.name
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(b"".join(blocks))
    return path

def drain(audio_q):
    try:
        while True:
            audio_q.get_nowait()
    except queue.Empty:
        pass

def main_loop(echo=False, once=False):
    import sounddevice as sd
    import webrtcvad
    from openwakeword.model import Model

    oww = Model(wakeword_models=[CFG["wake_model"]], inference_framework="onnx")

    # openWakeWord keys its predictions by model NAME, which is the bare alias
    # for a bundled model ("hey_jarvis_v0.1") but the filename stem for a custom
    # .onnx path. Ask it what it actually registered rather than assuming
    # WAKE_MODEL is the key — otherwise a custom model KeyErrors on first audio.
    wake_key = next(iter(oww.models))

    vad = webrtcvad.Vad(2)
    audio_q = queue.Queue()

    def callback(indata, frames, t, status):
        audio_q.put(bytes(indata))

    device = CFG["input_device"]
    if device is not None and str(device).isdigit():
        device = int(device)

    print(f"[voice] listening for '{wake_key}' "
          f"(threshold {CFG['wake_threshold']}, echo={echo})", flush=True)

    with sd.RawInputStream(samplerate=SAMPLE_RATE, blocksize=BLOCK, device=device,
                           dtype="int16", channels=1, callback=callback):
        while True:
            block = audio_q.get()
            score = oww.predict(np.frombuffer(block, dtype=np.int16))[wake_key]
            if score < CFG["wake_threshold"]:
                continue

            print(f"[voice] wake ({score:.2f})", flush=True)
            oww.reset()
            drain(audio_q)
            chirp()
            drain(audio_q)  # don't transcribe the chirp echo
            report("listening")

            wav = record_command(audio_q, vad)
            if wav is None:
                print("[voice] heard nothing, going back to sleep", flush=True)
                report("idle")
                continue
            try:
                text = transcribe(wav)
            finally:
                os.unlink(wav)
            if not text:
                print("[voice] empty transcript", flush=True)
                report("idle")
                continue
            print(f'[voice] heard: "{text}"', flush=True)
            report("thinking", text)

            if echo:
                report("speaking", text)
                speak(text)
            else:
                try:
                    reply = ask_assistant(text)
                except Exception as err:
                    print(f"[voice] assistant error: {err}", flush=True)
                    reply = "Sorry, something went wrong."
                print(f'[voice] reply: "{reply}"', flush=True)
                report("speaking", reply)
                speak(reply)
            report("idle")

            drain(audio_q)
            if once:
                return

# --- CLI ---------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--echo", action="store_true", help="speak transcript back; skip assistant")
    ap.add_argument("--once", action="store_true", help="handle one interaction, then exit")
    ap.add_argument("--list-devices", action="store_true")
    ap.add_argument("--say", metavar="TEXT", help="TTS smoke test")
    ap.add_argument("--transcribe", metavar="WAV", help="STT smoke test")
    args = ap.parse_args()

    if args.list_devices:
        import sounddevice as sd
        print(sd.query_devices())
        return
    if args.say:
        speak(args.say)
        return
    if args.transcribe:
        print(transcribe(args.transcribe))
        return
    try:
        main_loop(echo=args.echo, once=args.once)
    except KeyboardInterrupt:
        print("\n[voice] bye")
    finally:
        report("idle")  # don't leave a stale indicator on the mirror

if __name__ == "__main__":
    main()
