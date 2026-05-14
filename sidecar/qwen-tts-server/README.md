# TiaLynn TTS Sidecar — Qwen3-TTS

本目录是 Tauri 主进程的 Python 子进程，负责文本转语音（含 voice clone）。

## v0.1 状态（占位）

- ✅ FastAPI HTTP 接口（兼容 OpenAI `/v1/audio/speech` 风格）
- ✅ 音色克隆样本注册（`/v1/audio/clone`）
- ⚠️ TTS 合成返回 0.5s 静音（接口跑通用）
- ❌ Qwen3-TTS 推理（v0.2 启用）

## 启动

```bash
cd sidecar/qwen-tts-server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 5050
```

确认运行：
```bash
curl http://127.0.0.1:5050/healthz
```

## 在 TiaLynn 主程序中启用

设置环境变量：

```bash
export TIALYNN_TTS_PROVIDER=sidecar
export TIALYNN_TTS_SIDECAR_URL=http://127.0.0.1:5050
```

或修改 `default.yaml`：

```yaml
tts:
  provider: "sidecar"
```

## v0.2 启用 Qwen3-TTS

1. 解开 `requirements.txt` 末尾的 torch/transformers 注释
2. 重新 `pip install -r requirements.txt`（约 3-5GB）
3. 把 `main.py` 中的 `_silent_wav` 替换为真实推理（见 v0.2 PR）
