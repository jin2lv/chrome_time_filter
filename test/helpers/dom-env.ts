/**
 * JSDOM 环境装配（测试共用）：建立 dom 并把浏览器全局挂到 globalThis。
 *
 * 需要覆写某个全局（如用 no-op MutationObserver 模拟后台变异丢失）时，
 * 在调用本函数之后自行覆盖即可。
 */
import { JSDOM } from 'jsdom'

/** 建立 JSDOM 并注入全局；返回 dom 供用例覆写 window 行为（如 scrollTo） */
export function setupDom(html: string, options: Record<string, unknown> = {}): JSDOM {
  const dom = new JSDOM(html, options)
  const { window } = dom
  Object.assign(globalThis, {
    window,
    document: window.document,
    location: window.location,
    MutationObserver: window.MutationObserver,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Event: window.Event,
    KeyboardEvent: window.KeyboardEvent,
  })
  return dom
}
