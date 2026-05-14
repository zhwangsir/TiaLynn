/// <reference types="vite/client" />

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// pixi-live2d-display 的 cubism4 子入口没附带类型，做最小声明。
// 让 Live2DModel 继承 PIXI.Container，可直接 addChild 到 stage。
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
