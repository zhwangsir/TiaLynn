# TiaLynn TTS Sidecar — v0.2.1

Python HTTP 子进程，负责文本转语音 + voice clone 注册。Tauri 主程序通过本地 HTTP 调用。

## Backend 支持

| backend | 状态 | 联网 | 备注 |
|---|---|---|---|
| `edge_tts` (默认) | ✅ 可用 | 是 | 微软 Edge TTS，覆盖中文多种音色，质量高，免费 |
| `openai_compat` | ✅ 可用 | 视端点 | 转发到任意 OpenAI-compat `/v1/audio/speech` |
| `qwen3_tts` | 🚧 v0.2.3 | 否 | 阿里 Qwen3-TTS 1.7B 本地推理 + voice clone |
| `cosyvoice` | 🚧 v0.2.3 | 否 | 阿里达摩 CosyVoice，中文 voice clone 第一梯队 |
| `gpt_sovits` | 🚧 v0.2.3 | 否 | 中文 voice clone 社区方案 |

> v0.2.1 主推 `edge_tts`：无需 GPU、无需下载模型，开箱即用。
> v0.2.3 上线本地 voice clone 实装（你的 `example_voice/` 才能真正被克隆出来）。

## 启动

```bash
cd sidecar/qwen-tts-server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 直接启动（与 Tauri 主程序 auto-spawn 二选一）
uvicorn main:app --host 127.0.0.1 --port 5050
```

主程序会在启动时尝试 `python -m uvicorn main:app --port 5050` 自动拉起 sidecar；
若你已手动启动，主程序会探测到 healthz 并直接复用。

## 接口

| Method | Path | 用途 |
|---|---|---|
| GET | `/healthz` | 探活 + 版本 + 音色数 |
| GET | `/v1/voices` | 列出已注册音色 |
| POST | `/v1/audio/speech` | 合成（`{text, voice, emotion, backend?}`） |
| POST | `/v1/audio/clone` | 上传单个样本注册一个 voice（multipart） |
| POST | `/v1/audio/register-batch` | `{dir: "..."}` 扫描子目录批量注册 |

## 批量注册示例

把项目根的 `example_voice/` 自动注册为 4 个情绪音色：

```bash
curl -X POST http://127.0.0.1:5050/v1/audio/register-batch \
  -H 'Content-Type: application/json' \
  -d '{"dir":"~/Documents/Project/TiaLynn/example_voice"}'
```

注册后会出现：
- `clone_基础`
- `clone_撒娇`
- `clone_伤心难过`
- `clone_责怪`

主程序会在 TiaLynn 设置 → 语音 → 情绪映射表里使用这些 id。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TIALYNN_TTS_BACKEND` | `edge_tts` | 默认 backend |
| `TIALYNN_TTS_OPENAI_ENDPOINT` | `http://127.0.0.1:8080/v1/audio/speech` | `openai_compat` 转发端点 |
| `TIALYNN_TTS_OPENAI_MODEL` | `tts-1` | `openai_compat` 模型名 |

## 数据位置

- 注册表 / 上传样本：`~/.tialynn/voice_clones/`
- 注册表文件：`registry.json`
