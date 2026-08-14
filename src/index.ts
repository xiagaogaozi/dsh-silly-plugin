/**
 * dsh-tavern-mode · 宿主半（正式插件，webServer HTTP 路由版）
 *
 * 通信机制：浏览器 fetch POST /tavern/api/<method> → 本插件用
 * ctx.webServer.register 注册的 HTTP 路由处理。与 dsh-better-sidebar
 * 的 /sidebar/api 同构。
 *
 * 功能：
 *  - importCard：导入角色卡（PNG/JSON，任意位置，标准 base64 解码）
 *  - listCharacters：已导入角色卡列表（磁盘持久化）
 *  - deleteCharacter：解除工作区注册 + 物理删除目录
 *  - openCharacter：确保工作区注册（幂等 create），返回 workspaceId
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-tavern-mode'

export function apply(ctx: Context): void {
  const fs = ctx.get('fs') as any
  const shell = ctx.get('shell') as any
  const workspaceRegistry = ctx.get('workspaceRegistry') as any
  const webServer = ctx.get('webServer') as any
  const dshHomePath = ctx.get('dshHomePath') as ((...segments: string[]) => string) | undefined
  const charactersRoot = dshHomePath ? dshHomePath('tavern-characters') : null
  const importDir = 'D:\\github\\deepseektavern\\character-cards'

  const writePolicy = charactersRoot
    ? { mode: 'workspace-write' as const, workspaceRoot: charactersRoot }
    : undefined

  // ── 工具 ──────────────────────────────────────────────
  function latin1(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return s
  }
  function utf8(bytes: Uint8Array): string {
    try { return new TextDecoder('utf-8').decode(bytes) } catch (e) { return latin1(bytes) }
  }
  // 标准 base64 → 字节（DSH atob 是 UTF-8 文本语义，不能用于二进制）
  function base64ToBytes(b64: string): Uint8Array {
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const lookup: Record<string, number> = {}
    for (let i = 0; i < 64; i++) lookup[CHARS[i]] = i
    const out: number[] = []
    let buffer = 0
    let bits = 0
    for (let i = 0; i < b64.length; i++) {
      const c = b64[i]
      if (c === '=') break
      const v = lookup[c]
      if (v === undefined) continue
      buffer = (buffer << 6) | v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out.push((buffer >> bits) & 0xff)
      }
    }
    return Uint8Array.from(out)
  }
  function tryParseJson(bytes: Uint8Array): unknown | null {
    const candidates: string[] = []
    try { candidates.push(utf8(bytes)) } catch (e) { /* noop */ }
    try { candidates.push(latin1(bytes)) } catch (e) { /* noop */ }
    for (const text of candidates) {
      try { return JSON.parse(text) } catch (e) { /* try next */ }
    }
    try {
      const b64 = latin1(bytes).trim()
      return JSON.parse(utf8(base64ToBytes(b64)))
    } catch (e) { /* 不是 base64 包裹 JSON */ }
    return null
  }
  function parsePngToJson(bytes: Uint8Array): unknown {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('不是合法的 PNG 文件')
    let offset = 8
    let found: unknown = null
    const textChunks: string[] = []
    while (offset + 8 <= bytes.length) {
      const len = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
      const start = offset + 8
      const data = bytes.subarray(start, start + len)
      if (type === 'tEXt') {
        const nul = data.indexOf(0)
        if (nul >= 0) {
          const key = latin1(data.subarray(0, nul))
          const textBytes = data.subarray(nul + 1)
          textChunks.push(key)
          if ((key === 'chara' || key === 'ccv3') && found === null) {
            found = tryParseJson(textBytes)
          }
        }
      }
      offset = start + len + 4
    }
    if (found === null) throw new Error('未找到角色卡 chunk（chara/ccv3）。文本 chunk: ' + (textChunks.join(', ') || '(无)'))
    return found
  }
  function safeName(name: string): string {
    return String(name || '角色').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  }
  function normalizeRegex(r: Record<string, any>): Record<string, unknown> {
    return {
      scriptName: r.scriptName || r.name || 'unnamed',
      findRegex: r.findRegex || '', replaceString: r.replaceString || '',
      trimStrings: r.trimStrings ?? false, placement: r.placement ?? 0,
      disabled: r.disabled ?? false, markdownOnly: r.markdownOnly ?? false,
      promptOnly: r.promptOnly ?? false, runOnEdit: r.runOnEdit ?? false,
      substituteRegex: r.substituteRegex ?? false, minDepth: r.minDepth ?? 0, maxDepth: r.maxDepth ?? 0,
    }
  }
  function normalizeWorldEntry(e: Record<string, any>, id: string): Record<string, unknown> {
    return {
      key: Array.isArray(e.key) ? e.key : (e.keys || []),
      keysecondary: Array.isArray(e.keysecondary) ? e.keysecondary : (e.secondary_keys || []),
      comment: e.comment || '',
      content: e.content || '',
      constant: !!e.constant,
      selective: !!e.selective,
      order: e.order ?? e.insertion_order ?? 0,
      position: e.position ?? 0,
      enabled: e.enabled !== false,
      id,
      extensions: e.extensions || {},
    }
  }
  async function splitCard(json: Record<string, any>, srcDir: string): Promise<{
    card: Record<string, unknown>
    world: { entries: Record<string, unknown>; name: string } | null
    worldNote: string[]
    worldMerged: number
    regexes: Record<string, unknown>[]
    scripts: Record<string, unknown>[]
  }> {
    const data = (json.data || json) as Record<string, any>
    const name = data.name || json.name || '角色'
    const ext = (data.extensions || {}) as Record<string, any>
    const out = {
      card: {
        spec: json.spec || 'chara_card_v3', spec_version: json.spec_version || '3.0',
        name, description: data.description || '', personality: data.personality || '',
        scenario: data.scenario || '', first_mes: data.first_mes || '',
        mes_example: data.mes_example || '', creator_notes: data.creator_notes || data.creatorcomment || '',
        system_prompt: data.system_prompt || '', post_history_instructions: data.post_history_instructions || '',
        alternate_greetings: data.alternate_greetings || [], tags: data.tags || [],
        creator: data.creator || '', character_version: data.character_version || '',
      } as Record<string, unknown>,
      world: null as { entries: Record<string, unknown>; name: string } | null,
      worldNote: [] as string[],
      worldMerged: 0,
      regexes: [] as Record<string, unknown>[],
      scripts: [] as Record<string, unknown>[],
    }
    const mergedWorld: { entries: Record<string, unknown>; name: string } = { entries: {}, name: '' }
    const seen = new Set<string>()
    const mergeWorld = (obj: Record<string, any>, label: string): number => {
      if (!obj || typeof obj !== 'object') return 0
      const entries = obj.entries || obj
      if (typeof entries !== 'object') return 0
      if (obj.name) mergedWorld.name = obj.name
      let added = 0
      for (const [id, entry] of Object.entries(entries)) {
        if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).content === 'string') {
          const norm = normalizeWorldEntry(entry as Record<string, any>, id)
          const dedupKey = String(norm.content || '').slice(0, 64)
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey)
            mergedWorld.entries[id] = norm
            added++
          }
        }
      }
      if (added > 0) out.worldNote.push(label + ' ' + added + ' 条')
      return added
    }
    // 1) 内嵌世界书：data.character_book（Character Card V3 规范的位置）
    if (data.character_book && typeof data.character_book === 'object') {
      if (data.character_book.name) mergedWorld.name = data.character_book.name
      mergeWorld(data.character_book, '内嵌世界书:')
    }
    // 2) 兼容：extensions.world 是对象（老格式）
    if (ext.world && typeof ext.world === 'object') {
      mergeWorld(ext.world, 'extensions.world 内嵌:')
    }
    // 3) 外部引用：extensions.world 字符串 → character-cards 目录同名文件
    if (typeof ext.world === 'string' && ext.world) {
      out.worldNote.push('外部引用: ' + ext.world)
      if (!mergedWorld.name) mergedWorld.name = ext.world
      const ref = ext.world
      const candidates = ['世界书-' + ref + '.json', '世界书-' + ref + '.lorebook', ref + '.json', ref + '.lorebook']
      for (const cand of candidates) {
        try {
          const t = await fs.resolve(srcDir + '\\' + cand)
          const info = await fs.stat(t)
          if (info) {
            const wb = JSON.parse(await fs.readText(t))
            const added = mergeWorld(wb, '合并外部世界书:')
            if (added > 0) { out.worldMerged = added; out.worldNote.push('来源: ' + cand) }
            break
          }
        } catch (e) { /* try next */ }
      }
    }
    const entryCount = Object.keys(mergedWorld.entries).length
    if (entryCount > 0) {
      out.world = mergedWorld
      out.worldMerged = entryCount
    } else {
      out.worldNote.push('未找到任何世界书条目')
    }
    for (const r of (ext.regex_scripts || [])) out.regexes.push(normalizeRegex(r))
    for (const s of ((ext.tavern_helper && ext.tavern_helper.scripts) || [])) {
      out.scripts.push({ type: s.type || 'script', enabled: s.enabled !== false, name: s.name, id: s.id, info: s.info || '', button: s.button || { enabled: false, buttons: [] }, data: s.data || {}, content: s.content || '' })
    }
    return out
  }

  async function listCharacters(): Promise<Array<{
    name: string
    dirName: string
    worldEntries: number
    regexCount: number
    scriptCount: number
    importedAt: string
  }>> {
    const out: Array<{ name: string; dirName: string; worldEntries: number; regexCount: number; scriptCount: number; importedAt: string }> = []
    if (!charactersRoot || !fs) return out
    try {
      const rootTarget = await fs.resolve(charactersRoot)
      const entries = await fs.listDir(rootTarget)
      for (const e of entries) {
        if (e.type !== 'directory') continue
        try {
          const cardTarget = await fs.resolve(charactersRoot + '\\' + e.name + '\\card.json')
          const card = JSON.parse(await fs.readText(cardTarget))
          let worldEntries = 0
          try {
            const wTarget = await fs.resolve(charactersRoot + '\\' + e.name + '\\world.json')
            const w = JSON.parse(await fs.readText(wTarget))
            worldEntries = Object.keys(w.entries || {}).length
          } catch (err) { /* 无世界书 */ }
          let regexCount = 0
          try {
            const rTarget = await fs.resolve(charactersRoot + '\\' + e.name + '\\regex.json')
            const r = JSON.parse(await fs.readText(rTarget))
            regexCount = Array.isArray(r) ? r.length : 0
          } catch (err) { /* 无正则 */ }
          let scriptCount = 0
          try {
            const sTarget = await fs.resolve(charactersRoot + '\\' + e.name + '\\scripts')
            const sEntries = await fs.listDir(sTarget)
            scriptCount = sEntries.filter((x) => /\.js$/i.test(x.name || '')).length
          } catch (err) { /* 无脚本 */ }
          out.push({
            name: card.name || e.name,
            dirName: e.name,
            worldEntries, regexCount, scriptCount,
            importedAt: card.importedAt || '',
          })
        } catch (err) { /* 目录无 card.json，跳过 */ }
      }
    } catch (err) { /* 根目录不存在 */ }
    return out
  }

  // ── HTTP 路由处理器 ──────────────────────────────────
  async function handle(method: string, payload: Record<string, any>): Promise<Record<string, unknown>> {
    try {
      switch (method) {
        case 'importCard': {
          const fileName = payload && payload.fileName
          const base64 = payload && payload.base64
          if (!fileName) return { ok: false, error: '缺少 fileName' }
          let json: unknown = null
          try {
            const dirTarget = await fs.resolve(importDir + '\\' + fileName)
            const dirInfo = await fs.stat(dirTarget)
            if (dirInfo) {
              if (/\.png$/i.test(fileName)) {
                const bytes = await fs.readBytes(dirTarget, undefined, 64 * 1024 * 1024)
                json = parsePngToJson(bytes)
              } else if (/\.(json|lorebook)$/i.test(fileName)) {
                json = JSON.parse(await fs.readText(dirTarget))
              }
            }
          } catch (e) { /* 目录读取失败，走 base64 */ }
          if (json === null && typeof base64 === 'string' && base64.length > 0) {
            const bytes = base64ToBytes(base64)
            if (/\.png$/i.test(fileName)) {
              json = parsePngToJson(bytes)
            } else if (/\.(json|lorebook)$/i.test(fileName)) {
              json = JSON.parse(utf8(bytes))
            }
          }
          if (json === null) {
            return { ok: false, error: '无法读取角色卡：文件不存在或内容无效' }
          }
          const split = await splitCard(json as Record<string, any>, importDir)
          const cardName = String(split.card.name || '角色')
          const safe = safeName(cardName)
          const wsDir = charactersRoot ? charactersRoot + '\\' + safe : null
          if (!wsDir) return { ok: false, error: '无法解析 DSH 数据目录' }
          split.card.importedAt = new Date().toISOString().slice(0, 10)
          await fs.writeText(await fs.resolve(wsDir + '\\card.json'), JSON.stringify(split.card, null, 2), undefined, undefined, writePolicy)
          if (split.world) await fs.writeText(await fs.resolve(wsDir + '\\world.json'), JSON.stringify(split.world, null, 2), undefined, undefined, writePolicy)
          if (split.regexes.length) await fs.writeText(await fs.resolve(wsDir + '\\regex.json'), JSON.stringify(split.regexes, null, 2), undefined, undefined, writePolicy)
          if (split.scripts.length) {
            for (const s of split.scripts) {
              const base = safeName(String(s.name || 'script'))
              if (s.content) await fs.writeText(await fs.resolve(wsDir + '\\scripts\\' + base + '.js'), String(s.content), undefined, undefined, writePolicy)
              await fs.writeText(await fs.resolve(wsDir + '\\scripts\\' + base + '.meta.json'), JSON.stringify(s, null, 2), undefined, undefined, writePolicy)
            }
          }
          let workspace: { id: string } | null = null
          if (workspaceRegistry) {
            try { workspace = await workspaceRegistry.create(wsDir, cardName) }
            catch (e) { return { ok: false, error: '工作区创建失败: ' + (e && e.message ? e.message : String(e)) } }
          }
          return {
            ok: true, cardName, workspacePath: wsDir,
            workspaceId: workspace ? workspace.id : null,
            worldNote: split.worldNote, worldMerged: split.worldMerged,
            regexCount: split.regexes.length, scriptCount: split.scripts.length,
          }
        }
        case 'listCharacters': {
          return { ok: true, characters: await listCharacters() }
        }
        case 'deleteCharacter': {
          const workspaceName = payload && payload.workspaceName
          if (!workspaceName || !charactersRoot) return { ok: false, error: '缺少 workspaceName' }
          const safe = safeName(workspaceName)
          const wsDir = charactersRoot + '\\' + safe
          if (workspaceRegistry) {
            try {
              const ws = await workspaceRegistry.resolveByPath(wsDir)
              if (ws) await workspaceRegistry.delete(ws.id)
            } catch (e) { /* 未注册则跳过 */ }
          }
          if (shell) {
            const cmd = 'Remove-Item -LiteralPath ' + JSON.stringify(wsDir) + ' -Recurse -Force -ErrorAction SilentlyContinue'
            const spec = shell.resolve({ command: cmd, timeoutMs: 30000 })
            const result = await shell.run(spec)
            if (result.exitCode !== 0 && result.exitCode !== null) {
              return { ok: false, error: '目录删除失败: ' + (result.stderr || 'exit ' + result.exitCode) }
            }
          }
          return { ok: true, workspaceName: safe }
        }
        case 'openCharacter': {
          const workspaceName = payload && payload.workspaceName
          if (!workspaceName || !charactersRoot) return { ok: false, error: '缺少 workspaceName' }
          const wsDir = charactersRoot + '\\' + safeName(workspaceName)
          let workspace: { id: string } | null = null
          if (workspaceRegistry) {
            try {
              workspace = await workspaceRegistry.create(wsDir, workspaceName)
            } catch (e) {
              return { ok: false, error: '工作区打开失败: ' + (e && e.message ? e.message : String(e)) }
            }
          }
          return { ok: true, workspaceId: workspace ? workspace.id : null, workspacePath: wsDir }
        }
        default:
          return { ok: false, error: '未知方法: ' + method }
      }
    } catch (e) {
      return { ok: false, error: e && (e as Error).message ? (e as Error).message : String(e) }
    }
  }

  function readBody(req: any): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk: Buffer) => { data += chunk })
      req.on('end', () => {
        try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) }
      })
      req.on('error', reject)
    })
  }

  if (webServer) {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/tavern/api',
      handler: async (req: any, res: any) => {
        const url = new URL(req.url || '/', 'http://dsh.internal')
        const method = url.pathname.split('/').filter(Boolean).pop() || ''
        let payload: Record<string, any> = {}
        try {
          payload = await readBody(req)
        } catch (e) { /* 空 body */ }
        const result = await handle(method, payload)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: (result as { ok?: boolean }).ok !== false, value: result }))
      },
    }))
  } else {
    ctx.logger?.warn?.('dsh-tavern-mode: webServer 服务不可用，浏览器端将无法调用导入接口')
  }

  // 服务（供后续功能包读取）
  ctx.effect(() => {
    if (ctx.get('tavernMode') === undefined) {
      return ctx.provide('tavernMode', {
        isEnabled: () => true,
        getCharactersRoot: () => charactersRoot,
      })
    }
  })
}
