/**
 * CDP 辅助：连接 Chrome SW target，检查扩展身份 + 写入/读取 chrome.storage.local
 * 用法：node scripts/cdp-sw.mjs <port> [set|get|manifest] [json]
 */
const port = process.argv[2] ?? '9223'
const action = process.argv[3] ?? 'manifest'
const payload = process.argv[4]

const targets = await (await fetch(`http://localhost:${port}/json`)).json()
const sw = targets.find((t) => t.type === 'service_worker' || t.type === 'background_page')
if (!sw) {
  console.log('NO_SW_TARGET')
  process.exit(1)
}
console.log('SW_TARGET:', sw.url.slice(0, 90))

const ws = new WebSocket(sw.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
}
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result)
    pending.delete(msg.id)
  }
}
await new Promise((r) => (ws.onopen = r))

if (action === 'manifest') {
  const r = await send('Runtime.evaluate', {
    expression: `JSON.stringify(chrome.runtime.getManifest())`,
    returnByValue: true,
    awaitPromise: true,
  })
  const m = JSON.parse(r.result.value)
  console.log('EXT_NAME:', m.name)
  console.log('EXT_VERSION:', m.version)
  console.log('HOST_PERMS:', JSON.stringify(m.host_permissions ?? []))
  console.log('OPTIONAL_PERMS:', JSON.stringify(m.optional_host_permissions ?? []))
} else if (action === 'get') {
  const r = await send('Runtime.evaluate', {
    expression: `chrome.storage.local.get(null).then(v => JSON.stringify(v))`,
    returnByValue: true,
    awaitPromise: true,
  })
  console.log('STORAGE:', r.result.value)
} else if (action === 'set') {
  const r = await send('Runtime.evaluate', {
    expression: `chrome.storage.local.set(${payload}).then(() => 'OK')`,
    returnByValue: true,
    awaitPromise: true,
  })
  console.log('SET_RESULT:', r.result?.value ?? JSON.stringify(r))
}
ws.close()
process.exit(0)
