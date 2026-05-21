/**
 * Mood-aware TTS prosody — emotion + intensity → rate/pitch 叠加调整 (P5)。
 *
 * 不改用户 RuntimeConfig 基线 (tts_rate / tts_pitch)，运行时根据情感叠加 delta:
 *   happy/tease 强度高 → 语速 +5~10%，pitch 调高
 *   sad/missing 强度高 → 语速 -5~10%，pitch 调低
 *   shy → 语速略慢 + pitch 略高 (含羞声)
 *   angry → 语速快 + pitch 略低 (压抑的怒)
 *   sleepy → 语速明显慢
 *   其他 (calm/neutral/anxious/surprise) → 不调
 *
 * 输出 SSML 兼容字符串：rate '+8%' / pitch '+3Hz'
 *
 * 纯函数 — 不读 config，调用方传入基线 + 当前 emotion + intensity。
 */

/** mood → (rate %, pitch Hz) 在 intensity=1 时的目标 delta */
const PROSODY_TARGET: Record<string, { rateDelta: number; pitchHz: number }> = {
  happy: { rateDelta: 10, pitchHz: 5 },
  tease: { rateDelta: 8, pitchHz: 4 },
  shy: { rateDelta: -3, pitchHz: 3 },
  sad: { rateDelta: -8, pitchHz: -5 },
  missing: { rateDelta: -6, pitchHz: -4 },
  angry: { rateDelta: 6, pitchHz: -3 },
  sleepy: { rateDelta: -15, pitchHz: -2 },
  // 以下不调 (delta=0)
  calm: { rateDelta: 0, pitchHz: 0 },
  neutral: { rateDelta: 0, pitchHz: 0 },
  anxious: { rateDelta: 0, pitchHz: 0 },
  surprise: { rateDelta: 0, pitchHz: 0 },
}

export interface ProsodyBase {
  /** 用户在 settings 设的 rate 基线 (如 '+0%' / '+10%') */
  rate: string
  /** 用户基线 pitch (如 '+0Hz') */
  pitch: string
}

export interface ProsodyAdjusted {
  rate: string
  pitch: string
  /** debug: 哪个 mood / intensity / delta 计算出的 */
  applied?: {
    emotion: string
    intensity: number
    rateDelta: number
    pitchDelta: number
  }
}

/**
 * 解析 SSML 风格的 prosody 字符串 (+10%, -3Hz)，返回数字部分。
 * 无法解析或不带后缀时返 0。
 */
function parseSign(s: string | undefined, suffix: string): number {
  if (!s) return 0
  const re = new RegExp(`^([+-]?\\d+(?:\\.\\d+)?)${escapeReg(suffix)}$`)
  const m = s.trim().match(re)
  if (!m) return 0
  return parseFloat(m[1]!)
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatPct(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${Math.round(v)}%`
}

function formatHz(v: number): string {
  const sign = v >= 0 ? '+' : ''
  return `${sign}${Math.round(v)}Hz`
}

/**
 * 根据当前 emotion + intensity，给基线 prosody 叠加 mood 调整。
 *
 * intensity (0..1) 作为缩放因子：
 *   - intensity < 0.3 → delta * 0.5（弱情感小调）
 *   - intensity >= 0.3 → delta * intensity（线性）
 *
 * 未知 emotion 直接返回基线。
 */
export function adjustProsody(
  base: ProsodyBase,
  emotion: string | undefined | null,
  intensity: number | undefined | null,
): ProsodyAdjusted {
  if (!emotion) return { rate: base.rate, pitch: base.pitch }
  const target = PROSODY_TARGET[emotion.toLowerCase()]
  if (!target) return { rate: base.rate, pitch: base.pitch }

  // intensity 缺省 (null/undefined/NaN) → 0.5；明确 0 → 完全不调
  const hasIntensity = typeof intensity === 'number' && Number.isFinite(intensity)
  if (hasIntensity && intensity === 0) {
    return { rate: base.rate, pitch: base.pitch }
  }
  const i = hasIntensity ? Math.max(0, Math.min(intensity, 1)) : 0.5
  const scale = i < 0.3 ? i * 0.5 : i

  const rateDelta = target.rateDelta * scale
  const pitchDelta = target.pitchHz * scale

  if (Math.abs(rateDelta) < 0.5 && Math.abs(pitchDelta) < 0.5) {
    return { rate: base.rate, pitch: base.pitch }
  }

  const baseRate = parseSign(base.rate, '%')
  const basePitch = parseSign(base.pitch, 'Hz')
  return {
    rate: formatPct(baseRate + rateDelta),
    pitch: formatHz(basePitch + pitchDelta),
    applied: {
      emotion: emotion.toLowerCase(),
      intensity: i,
      rateDelta,
      pitchDelta,
    },
  }
}
