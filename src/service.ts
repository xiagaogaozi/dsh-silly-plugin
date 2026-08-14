/**
 * dsh-tavern-mode · TavernService
 *
 * 宿主半核心服务：通过 Typert Remote 端点暴露给浏览器。
 * 浏览器调用：remote.tavernMode.importCard(...) 等。
 */
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { FileSystem } from '@deepseek-ai/dsh-fs'

/** 写 ~/.dsh/tavern-characters 的沙箱策略。 */
interface WritePolicy { mode: 'workspace-write'; workspaceRoot: string }

export interface TavernImportResult {
  ok: boolean
  cardName?: string
  workspacePath?: string
  workspaceId?: string | null
  worldNote?: string[]
  worldMerged?: number
  regexCount?: number
  scriptCount?: number
  error?: string
}

export interface TavernCharacter {
  name: string
  dirName: string
  worldEntries: number
  regexCount: number
  scriptCount: number
  importedAt: string
}

export class TavernService extends TypertRemoteService {
  private readonly importDir = 'D:\\github\\deepseektavern\\character-cards'

  constructor(
    ctx: Context,
    private readonly fs: FileSystem,
    private readonly shell: { resolve(req: unknown): unknown; run(spec: unknown): Promise<{ exitCode: number | null; stderr?: string }> } | undefined,
    private readonly workspaceRegistry: {
      create(path: string, title: string): Promise<{ id: string }>
      delete(id: string): Promise<boolean>
      resolveByPath(path: string): Promise<{ id: string } | undefined>
    } | undefined,
    private readonly charactersRoot: string | null,
    private readonly writePolicy: WritePolicy | undefined,
  ) {
    super(ctx, 'tavernMode', { namespace: 'tavern' })
  }

  // ── 工具 ──────────────────────────────────────────────
  private latin1(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return s
  }

  private utf8(bytes: Uint8Array): string {
    try { return new TextDecoder('utf-8').decode(bytes) } catch { return this.latin1(bytes) }
  }

  /** 标准 base64 → 字节（DSH atob 是 UTF-8 文本语义，不能用于二进制）。 */
  private base64ToBytes(b64: string): Uint8Array {
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

  private tryParseJson(bytes: Uint8Array): unknown | null {
    const texts: string[] = []
    try { texts.push(this.utf8(bytes)) } catch { /* noop */ }
    try { texts.push(this.latin1(bytes)) } catch { /* noop */ }
    for (const text of texts) {
      try { return JSON.parse(text) } catch { /* try next */ }
    }
    try {
      const b64 = this.latin1(bytes).trim()
      return JSON.parse(this.utf8(this.base64ToBytes(b64)))
    } catch { /* not base64 */ }
    return null
  }

  private parsePngToJson(bytes: Uint8Array): unknown {
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
          const key = this.latin1(data.subarray(0, nul))
          const textBytes = data.subarray(nul + 1)
          textChunks.push(key)
          if ((key === 'chara' || key === 'ccv3') && found === null) {
            found = this.tryParseJson(textBytes)
          }
        }
      }
      offset = start + len + 4
    }
    if (found === null) {
      throw new Error('未找到角色卡 chunk（chara/ccv3）。文本 chunk: ' + (textChunks.join(', ') || '(无)'))
    }
    return found
  }

  private safeName(name: string): string {
    return String(name || '角色').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  }

  private normalizeRegex(r: Record<string, unknown>): Record<string, unknown> {
    return {
      scriptName: r.scriptName || r.name || 'unnamed',
      findRegex: r.findRegex || '', replaceString: r.replaceString || '',
      trimStrings: r.trimStrings ?? false, placement: r.placement ?? 0,
      disabled: r.disabled ?? false, markdownOnly: r.markdownOnly ?? false,
      promptOnly: r.promptOnly ?? false, runOnEdit: r.runOnEdit ?? false,
      substituteRegex: r.substituteRegex ?? false, minDepth: r.minDepth ?? 0, maxDepth: r.maxDepth ?? 0,
    }
  }

  private normalizeWorldEntry(e: Record<string, unknown>, id: string): Record<string, unknown> {
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

  private async splitCard(json: Record<string, any>, srcDir: string): Promise<{
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
          const norm = this.normalizeWorldEntry(entry as Record<string, unknown>, id)
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
          const t = await this.fs.resolve(srcDir + '\\' + cand)
          const info = await this.fs.stat(t)
          if (info) {
            const wb = JSON.parse(await this.fs.readText(t))
            const added = mergeWorld(wb, '合并外部世界书:')
            if (added > 0) { out.worldMerged = added; out.worldNote.push('来源: ' + cand) }
            break
          }
        } catch { /* try next */ }
      }
    }
    const entryCount = Object.keys(mergedWorld.entries).length
    if (entryCount > 0) {
      out.world = mergedWorld
      out.worldMerged = entryCount
    } else {
      out.worldNote.push('未找到任何世界书条目')
    }
    for (const r of (ext.regex_scripts || [])) out.regexes.push(this.normalizeRegex(r))
    for (const s of ((ext.tavern_helper && ext.tavern_helper.scripts) || [])) {
      out.scripts.push({ type: s.type || 'script', enabled: s.enabled !== false, name: s.name, id: s.id, info: s.info || '', button: s.button || { enabled: false, buttons: [] }, data: s.data || {}, content: s.content || '' })
    }
    return out
  }

  // ── Remote 方法 ───────────────────────────────────────

  /** 导入角色卡：fileName + base64（任意位置文件）。 */
  @Remote('importCard')
  async importCard(request: { fileName: string; base64?: string }): Promise<TavernImportResult> {
    const fileName = request?.fileName
    const base64 = request?.base64
    if (!fileName) return { ok: false, error: '缺少 fileName' }
    try {
      let json: unknown = null
      try {
        const dirTarget = await this.fs.resolve(this.importDir + '\\' + fileName)
        const dirInfo = await this.fs.stat(dirTarget)
        if (dirInfo) {
          if (/\.png$/i.test(fileName)) {
            const bytes = await this.fs.readBytes(dirTarget, undefined, 64 * 1024 * 1024)
            json = this.parsePngToJson(bytes)
          } else if (/\.(json|lorebook)$/i.test(fileName)) {
            json = JSON.parse(await this.fs.readText(dirTarget))
          }
        }
      } catch { /* 目录读取失败，走 base64 */ }
      if (json === null && typeof base64 === 'string' && base64.length > 0) {
        const bytes = this.base64ToBytes(base64)
        if (/\.png$/i.test(fileName)) {
          json = this.parsePngToJson(bytes)
        } else if (/\.(json|lorebook)$/i.test(fileName)) {
          json = JSON.parse(this.utf8(bytes))
        }
      }
      if (json === null) {
        return { ok: false, error: '无法读取角色卡：文件不存在或内容无效' }
      }
      const split = await this.splitCard(json as Record<string, any>, this.importDir)
      const cardName = String(split.card.name || '角色')
      const safe = this.safeName(cardName)
      const wsDir = this.charactersRoot ? this.charactersRoot + '\\' + safe : null
      if (!wsDir) return { ok: false, error: '无法解析 DSH 数据目录' }
      split.card.importedAt = new Date().toISOString().slice(0, 10)
      await this.fs.writeText(await this.fs.resolve(wsDir + '\\card.json'), JSON.stringify(split.card, null, 2), undefined, undefined, this.writePolicy)
      if (split.world) await this.fs.writeText(await this.fs.resolve(wsDir + '\\world.json'), JSON.stringify(split.world, null, 2), undefined, undefined, this.writePolicy)
      if (split.regexes.length) await this.fs.writeText(await this.fs.resolve(wsDir + '\\regex.json'), JSON.stringify(split.regexes, null, 2), undefined, undefined, this.writePolicy)
      if (split.scripts.length) {
        for (const s of split.scripts) {
          const base = this.safeName(String(s.name || 'script'))
          if (s.content) await this.fs.writeText(await this.fs.resolve(wsDir + '\\scripts\\' + base + '.js'), String(s.content), undefined, undefined, this.writePolicy)
          await this.fs.writeText(await this.fs.resolve(wsDir + '\\scripts\\' + base + '.meta.json'), JSON.stringify(s, null, 2), undefined, undefined, this.writePolicy)
        }
      }
      let workspace: { id: string } | null = null
      if (this.workspaceRegistry) {
        try { workspace = await this.workspaceRegistry.create(wsDir, cardName) }
        catch (e) { return { ok: false, error: '工作区创建失败: ' + (e instanceof Error ? e.message : String(e)) } }
      }
      return {
        ok: true, cardName, workspacePath: wsDir,
        workspaceId: workspace ? workspace.id : null,
        worldNote: split.worldNote, worldMerged: split.worldMerged,
        regexCount: split.regexes.length, scriptCount: split.scripts.length,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 列出已导入角色卡（磁盘持久化）。 */
  @Remote('listCharacters')
  async listCharacters(): Promise<{ characters: TavernCharacter[] }> {
    const out: TavernCharacter[] = []
    if (!this.charactersRoot || !this.fs) return { characters: out }
    try {
      const rootTarget = await this.fs.resolve(this.charactersRoot)
      const entries = await this.fs.listDir(rootTarget)
      for (const e of entries) {
        if (e.type !== 'directory') continue
        try {
          const cardTarget = await this.fs.resolve(this.charactersRoot + '\\' + e.name + '\\card.json')
          const card = JSON.parse(await this.fs.readText(cardTarget)) as Record<string, any>
          let worldEntries = 0
          try {
            const wTarget = await this.fs.resolve(this.charactersRoot + '\\' + e.name + '\\world.json')
            const w = JSON.parse(await this.fs.readText(wTarget)) as { entries?: Record<string, unknown> }
            worldEntries = Object.keys(w.entries || {}).length
          } catch { /* 无世界书 */ }
          let regexCount = 0
          try {
            const rTarget = await this.fs.resolve(this.charactersRoot + '\\' + e.name + '\\regex.json')
            const r = JSON.parse(await this.fs.readText(rTarget))
            regexCount = Array.isArray(r) ? r.length : 0
          } catch { /* 无正则 */ }
          let scriptCount = 0
          try {
            const sTarget = await this.fs.resolve(this.charactersRoot + '\\' + e.name + '\\scripts')
            const sEntries = await this.fs.listDir(sTarget)
            scriptCount = sEntries.filter((x) => /\.js$/i.test(x.name || '')).length
          } catch { /* 无脚本 */ }
          out.push({
            name: card.name || e.name,
            dirName: e.name,
            worldEntries, regexCount, scriptCount,
            importedAt: card.importedAt || '',
          })
        } catch { /* 目录无 card.json，跳过 */ }
      }
    } catch { /* 根目录不存在 */ }
    return { characters: out }
  }

  /** 删除角色：解除工作区注册 + 物理删除目录。 */
  @Remote('deleteCharacter')
  async deleteCharacter(request: { workspaceName: string }): Promise<{ ok: boolean; workspaceName?: string; error?: string }> {
    const workspaceName = request?.workspaceName
    if (!workspaceName || !this.charactersRoot) return { ok: false, error: '缺少 workspaceName' }
    const safe = this.safeName(workspaceName)
    const wsDir = this.charactersRoot + '\\' + safe
    try {
      if (this.workspaceRegistry) {
        try {
          const ws = await this.workspaceRegistry.resolveByPath(wsDir)
          if (ws) await this.workspaceRegistry.delete(ws.id)
        } catch { /* 未注册则跳过 */ }
      }
      if (this.shell) {
        const cmd = 'Remove-Item -LiteralPath ' + JSON.stringify(wsDir) + ' -Recurse -Force -ErrorAction SilentlyContinue'
        const spec = (this.shell as any).resolve({ command: cmd, timeoutMs: 30000 })
        const result = await this.shell.run(spec)
        if (result.exitCode !== 0 && result.exitCode !== null) {
          return { ok: false, error: '目录删除失败: ' + (result.stderr || 'exit ' + result.exitCode) }
        }
      }
      return { ok: true, workspaceName: safe }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 打开角色工作区：确保注册（幂等 create），返回 workspaceId。 */
  @Remote('openCharacter')
  async openCharacter(request: { workspaceName: string }): Promise<{ ok: boolean; workspaceId?: string | null; workspacePath?: string; error?: string }> {
    const workspaceName = request?.workspaceName
    if (!workspaceName || !this.charactersRoot) return { ok: false, error: '缺少 workspaceName' }
    try {
      const wsDir = this.charactersRoot + '\\' + this.safeName(workspaceName)
      let workspace: { id: string } | null = null
      if (this.workspaceRegistry) {
        try {
          workspace = await this.workspaceRegistry.create(wsDir, workspaceName)
        } catch (e) {
          return { ok: false, error: '工作区打开失败: ' + (e instanceof Error ? e.message : String(e)) }
        }
      }
      return { ok: true, workspaceId: workspace ? workspace.id : null, workspacePath: wsDir }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
