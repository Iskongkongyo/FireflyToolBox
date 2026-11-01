import { mountWebTool, stopBrowserModule, clearPreviewStorage } from '../src/services/browserModule.ts'
export { stopBrowserModule, clearPreviewStorage }
export async function mount(container, script, settings = {}) {
  const report = { errors: [], statuses: [] }
  await mountWebTool(container, {
    moduleId: settings.moduleId ?? 'preview.services-review',
    html: '<main><button id="run">Run</button><button id="cancel">Cancel</button><output id="result">Ready</output></main>',
    css: 'button{min-height:44px;min-width:80px}output{display:block;overflow-wrap:anywhere}', script,
    networkHosts: settings.hosts ?? ['https://api.example.test'], timeoutMs: 15000, inputBytes: 2 ** 31, outputBytes: 2 ** 31,
    resources: settings.resources ?? [], resourceModuleId: settings.resourceModuleId ?? settings.moduleId ?? 'preview.services-review',
    openFile: async () => null, saveFile: async () => true,
    onError: message => report.errors.push(message), onFileStatus: status => report.statuses.push(status),
  })
  return report
}
