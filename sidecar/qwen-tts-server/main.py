"""TiaLynn TTS Sidecar — v0.2

多 backend HTTP 服务：
  - edge-tts (默认，无需 GPU，质量高，需联网)
  - openai-compat（转发到任意 OpenAI-compatible /v1/audio/speech）
  - qwen3-tts / cosyvoice / gpt-sovits 预留槽位（v0.2.3+）

接口：
  GET  /healthz
  GET  /v1/voices                    -> 已注册音色列表
  POST /v1/audio/speech              { text, voice?, emotion?, backend? } -> audio bytes
  POST /v1/audio/clone (multipart)   name=<id>, sample=<file>             -> 注册一个音色样本
  POST /v1/audio/register-batch      { dir } -> 扫描目录把每个子目录注册为一个 voice

启动：
  cd sidecar/qwen-tts-server
  python -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  uvicorn main:app --host 127.0.0.1 --port 5050
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import wave
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, UploadFile, Form, HTTPException
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel

# 配置
HOME = Path.home()
VOICE_DIR = HOME / ".tialynn" / "voice_clones"
VOICE_DIR.mkdir(parents=True, exist_ok=True)
REGISTRY_FILE = VOICE_DIR / "registry.json"
DEFAULT_BACKEND = os.environ.get("TIALYNN_TTS_BACKEND", "edge_tts")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("tialynn-tts")

app = FastAPI(title="TiaLynn TTS Sidecar", version="0.2.1")


# ---------- 音色注册表 ----------


class VoiceEntry(BaseModel):
    """注册的音色：可以是 edge_tts 的内置 voice，也可以是用户上传的样本路径。"""

    id: str
    kind: str  # "edge" | "sample" | "openai"
    edge_voice: Optional[str] = None  # 当 kind=edge 时
    sample_path: Optional[str] = None  # 当 kind=sample 时
    note: Optional[str] = None  # 显示用


def _load_registry() -> Dict[str, VoiceEntry]:
    if REGISTRY_FILE.exists():
        try:
            data = json.loads(REGISTRY_FILE.read_text("utf-8"))
            return {k: VoiceEntry(**v) for k, v in data.items()}
        except Exception as e:
            log.warning(f"registry parse failed: {e}")
    return {}


def _save_registry(reg: Dict[str, VoiceEntry]) -> None:
    REGISTRY_FILE.write_text(
        json.dumps({k: v.model_dump() for k, v in reg.items()}, ensure_ascii=False, indent=2),
        "utf-8",
    )


# 启动时填充内置 edge_tts 音色（中文常用）
_BUILTIN_EDGE = {
    "edge_xiaoxiao": "zh-CN-XiaoxiaoNeural",
    "edge_xiaoyi": "zh-CN-XiaoyiNeural",
    "edge_yunxia": "zh-CN-YunxiaNeural",
    "edge_xiaomeng": "zh-CN-XiaomengNeural",
}

REGISTRY: Dict[str, VoiceEntry] = _load_registry()
for vid, edge in _BUILTIN_EDGE.items():
    if vid not in REGISTRY:
        REGISTRY[vid] = VoiceEntry(id=vid, kind="edge", edge_voice=edge, note="内置中文女声")


# ---------- TTS Backend ----------


class Backend:
    name: str = "noop"

    async def synthesize(self, text: str, voice: VoiceEntry) -> bytes:
        raise NotImplementedError


class EdgeTtsBackend(Backend):
    """微软 edge-tts。质量稳定、覆盖中文多种音色，但需联网。"""

    name = "edge_tts"

    async def synthesize(self, text: str, voice: VoiceEntry) -> bytes:
        try:
            import edge_tts  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "edge-tts 未安装。请在 sidecar 目录运行 pip install edge-tts"
            ) from e

        edge_voice = (
            voice.edge_voice if voice.kind == "edge" and voice.edge_voice else "zh-CN-XiaoxiaoNeural"
        )
        communicate = edge_tts.Communicate(text, voice=edge_voice)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        return buf.getvalue()


class OpenAiCompatBackend(Backend):
    """转发到 OpenAI-compatible TTS 端点（如 fish-speech / coqui-tts 等）。"""

    name = "openai_compat"

    def __init__(self) -> None:
        self.endpoint = os.environ.get(
            "TIALYNN_TTS_OPENAI_ENDPOINT", "http://127.0.0.1:8080/v1/audio/speech"
        )
        self.model = os.environ.get("TIALYNN_TTS_OPENAI_MODEL", "tts-1")

    async def synthesize(self, text: str, voice: VoiceEntry) -> bytes:
        import httpx  # type: ignore

        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                self.endpoint,
                json={
                    "model": self.model,
                    "input": text,
                    "voice": voice.id,
                    "response_format": "mp3",
                },
            )
            r.raise_for_status()
            return r.content


BACKENDS: Dict[str, Backend] = {
    "edge_tts": EdgeTtsBackend(),
    "openai_compat": OpenAiCompatBackend(),
}


def _pick_backend(name: Optional[str], voice: VoiceEntry) -> Backend:
    # voice.kind=edge 强制走 edge_tts
    if voice.kind == "edge":
        return BACKENDS["edge_tts"]
    if name and name in BACKENDS:
        return BACKENDS[name]
    return BACKENDS[DEFAULT_BACKEND]


# ---------- HTTP 接口 ----------


class SpeakRequest(BaseModel):
    text: str
    voice: str = "edge_xiaoxiao"
    emotion: str = "neutral"
    backend: Optional[str] = None


@app.get("/healthz")
def healthz() -> dict:
    return {
        "status": "ok",
        "version": app.version,
        "default_backend": DEFAULT_BACKEND,
        "voice_count": len(REGISTRY),
    }


@app.get("/v1/voices")
def list_voices() -> dict:
    return {"voices": [v.model_dump() for v in REGISTRY.values()]}


@app.post("/v1/audio/speech")
async def speak(req: SpeakRequest) -> Response:
    if not req.text.strip():
        return Response(content=_silent_wav(0.15), media_type="audio/wav")

    voice = REGISTRY.get(req.voice)
    if voice is None:
        # 未注册音色，降级到默认
        log.warning(f"voice not found: {req.voice}, falling back to edge_xiaoxiao")
        voice = REGISTRY.get("edge_xiaoxiao") or VoiceEntry(
            id="default", kind="edge", edge_voice="zh-CN-XiaoxiaoNeural"
        )

    backend = _pick_backend(req.backend, voice)
    try:
        audio = await backend.synthesize(req.text, voice)
        media_type = "audio/mpeg" if backend.name in ("edge_tts", "openai_compat") else "audio/wav"
        return Response(content=audio, media_type=media_type)
    except Exception as e:
        log.error(f"synthesize failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/audio/clone")
async def clone_voice(
    name: str = Form(...),
    note: Optional[str] = Form(None),
    sample: UploadFile = None,
) -> dict:
    """注册用户上传的样本作为一个 voice。"""
    if sample is None:
        raise HTTPException(status_code=400, detail="sample required")
    suffix = Path(sample.filename or "sample.wav").suffix or ".wav"
    target = VOICE_DIR / f"{name}{suffix}"
    target.write_bytes(await sample.read())
    REGISTRY[name] = VoiceEntry(
        id=name, kind="sample", sample_path=str(target), note=note or "用户样本"
    )
    _save_registry(REGISTRY)
    return REGISTRY[name].model_dump()


class RegisterBatchRequest(BaseModel):
    dir: str
    """目录下每个子目录会被注册为一个 voice，子目录名做 voice id。"""


@app.post("/v1/audio/register-batch")
def register_batch(req: RegisterBatchRequest) -> dict:
    root = Path(req.dir).expanduser()
    if not root.exists() or not root.is_dir():
        raise HTTPException(status_code=400, detail=f"dir not found: {root}")

    registered: List[str] = []
    for sub in root.iterdir():
        if not sub.is_dir() or sub.name.startswith("."):
            continue
        # 找第一个音频文件
        audio = next(
            (f for f in sub.iterdir() if f.suffix.lower() in {".wav", ".mp3", ".m4a", ".aac", ".ogg"}),
            None,
        )
        if audio is None:
            continue
        vid = f"clone_{sub.name}"
        REGISTRY[vid] = VoiceEntry(
            id=vid, kind="sample", sample_path=str(audio), note=f"来自 {sub.name}"
        )
        registered.append(vid)
    _save_registry(REGISTRY)
    return {"registered": registered, "total": len(REGISTRY)}


# ---------- 工具 ----------


def _silent_wav(duration_sec: float, sample_rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    n_samples = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * n_samples)
    return buf.getvalue()


@app.on_event("startup")
async def on_start() -> None:
    log.info(f"TiaLynn TTS sidecar v{app.version} started. backend={DEFAULT_BACKEND}")
    log.info(f"registered voices: {list(REGISTRY.keys())}")
