function windowsReserved(name: string) {
  return /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(name.split('.')[0]!.trimEnd())
}

export function validateShortcutName(value: string, windows: boolean): string {
  const name = value.trim()
  if (!name || Array.from(name).length > 40 || /[\x00-\x1f\x7f-\x9f]/.test(name)) throw new Error('快捷方式名称须为 1 到 40 个字符，且不能包含控制字符。')
  if (windows && (/[\\/:*?"<>|]/.test(name) || name.endsWith('.'))) throw new Error('Windows 快捷方式名称不能以句点结尾或包含 \\ / : * ? " < > |。')
  if (windows && windowsReserved(name)) throw new Error('该名称是 Windows 保留名称，请换个名字。')
  return name
}

export function suggestedShortcutName(value: string, windows: boolean): string {
  let name = value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
  if (windows) name = name.replace(/[\\/:*?"<>|]/g, '-')
  name = Array.from(name.trim()).slice(0, 40).join('').trim()
  if (windows) name = name.replace(/[. ]+$/g, '')
  if (!name) name = '工具快捷方式'
  if (windows && windowsReserved(name)) name = `工具-${name}`
  return Array.from(name).slice(0, 40).join('')
}

/** Native/launcher stalls must release the form without accepting a late result. */
export async function requestShortcutCreation(create: () => Promise<string>, android: boolean): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      create(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('桌面快捷方式服务响应超时，请先返回桌面查看是否已创建；若未创建，请稍后重试。')), android ? 15000 : 30000)
      }),
    ])
  } finally { clearTimeout(timer) }
}

/** Keep launch hints while a write is busy; fetch again to prefer the latest hint. */
export function createShortcutLaunchQueue(options: {
  take: () => Promise<string>
  canOpen: () => boolean
  open: (toolId: string) => void
  onError: (error: unknown) => void
}) {
  let requested = false
  let pending = ''
  let task: Promise<void> | null = null
  async function drain() {
    while (requested && options.canOpen()) {
      requested = false
      const incoming = await options.take()
      if (incoming) pending = incoming
      if (!options.canOpen()) { requested = true; return }
      if (pending) { const tool = pending; pending = ''; options.open(tool) }
    }
  }
  function request(): Promise<void> {
    requested = true
    if (task) return task
    if (!options.canOpen()) return Promise.resolve()
    task = drain().catch(error => { requested = false; options.onError(error) }).finally(() => {
      task = null
      if (requested && options.canOpen()) return request()
    })
    return task
  }
  return { request, resume: () => requested || pending ? request() : Promise.resolve() }
}
