/// <reference types="vite/client" />

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// pixi-live2d-display 默认入口（同时支持 Cubism 2 + 4）的最小类型声明。
declare module 'pixi-live2d-display' {
  import { Container } from 'pixi.js'
  export class Live2DModel extends Container {
    static from(url: string, opts?: { autoInteract?: boolean }): Promise<Live2DModel>
    internalModel: any
  }
}

interface Window {
  __tialynn_renderer__?: import('./live2d/renderer').TiaLynnRenderer
}
