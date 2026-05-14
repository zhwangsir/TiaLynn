/**
 * 视线/头部跟随鼠标。
 */
import type { TiaLynnRenderer } from './renderer'

export function startMouseFocus(renderer: TiaLynnRenderer): () => void {
  let lastX = window.innerWidth / 2
  let lastY = window.innerHeight / 2

  const onMove = (e: MouseEvent) => {
    lastX = e.clientX
    lastY = e.clientY
  }

  const rafLoop = () => {
    renderer.setFocus(lastX, lastY)
    raf = requestAnimationFrame(rafLoop)
  }

  window.addEventListener('mousemove', onMove)
  let raf = requestAnimationFrame(rafLoop)

  return () => {
    window.removeEventListener('mousemove', onMove)
    cancelAnimationFrame(raf)
  }
}
