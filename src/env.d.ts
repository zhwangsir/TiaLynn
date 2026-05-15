/// <reference types="vite/client" />

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// pixi-live2d-display cubism4 子入口（v0.3.1 回退为更稳的 cubism4 入口；
// Cubism 2 模型暂不支持，留 v0.3.2 单独调试）。
declare module 'pixi-live2d-display/cubism4' {
  import { Container } from 'pixi.js'
  export class Live2DModel extends Container {
    static from(url: string, opts?: { autoInteract?: boolean }): Promise<Live2DModel>
    internalModel: any
  }
}

interface Window {
  __tialynn_renderer__?: import('./live2d/renderer').TiaLynnRenderer
}
