"""TiaLynn TTS Sidecar — Qwen3-TTS HTTP server (v0.1 stub).

启动方式：
    pip install -r requirements.txt
    uvicorn main:app --host 127.0.0.1 --port 5050

接口：
    POST /v1/audio/speech  { text, voice, emotion }   -> audio bytes
    POST /v1/audio/clone   multipart sample + name    -> 注册音色
    GET  /v1/voices                                   -> 列出可用音色
    GET  /healthz

v0.1：mock 接口，返回静音 WAV 占位。
v0.2：接入 Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice，实现 voice clone。
"""

from __future__ import annotations

import io
import wave
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, UploadFile, Form
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel

app = FastAPI(title="TiaLynn TTS Sidecar", version="0.1.0")

# 简单内存音色注册表（v0.2 替换为持久化）
VOICE_REGISTRY: Dict[str, Path] = {}


class SpeakRequest(BaseModel):
    text: str
    voice: str = "default"
    emotion: str = "neutral"


@app.get("/healthz")
def healthz():
    return {"status": "ok", "version": app.version}


@app.get("/v1/voices")
def list_voices():
    return {"voices": list(VOICE_REGISTRY.keys()) + ["default"]}


@app.post("/v1/audio/clone")
async def clone_voice(name: str = Form(...), sample: UploadFile = None):
    """注册一段样本作为命名音色（v0.2 实装 voice clone 预编码）。"""
    if sample is None:
        return JSONResponse({"error": "sample required"}, status_code=400)

    cache_dir = Path.home() / ".tialynn" / "voice_clones"
    cache_dir.mkdir(parents=True, exist_ok=True)
    out_path = cache_dir / f"{name}{Path(sample.filename).suffix or '.wav'}"
    with out_path.open("wb") as f:
        f.write(await sample.read())
    VOICE_REGISTRY[name] = out_path
    return {"voice": name, "path": str(out_path)}


@app.post("/v1/audio/speech")
def speak(req: SpeakRequest):
    """合成 WAV 字节流。v0.1 stub：返回 0.5s 静音占位。"""
    wav_bytes = _silent_wav(duration_sec=0.5, sample_rate=16000)
    return Response(content=wav_bytes, media_type="audio/wav")


def _silent_wav(duration_sec: float, sample_rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    n_samples = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * n_samples)
    return buf.getvalue()
