self.onmessage = async event => {
  try {
    const response = await fetch(event.data.wasmURL)
    if (!response.ok) throw new Error('WASM 资源读取失败。')
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer())
    self.postMessage({ result: instance.exports.add(event.data.a, event.data.b) })
  } catch (error) { self.postMessage({ error: error.message }) }
}
