/**
 * tavern-host.js — 酒馆模式核心 · Host 半（动态 Cordis 插件源码 v12）
 *
 * 挂载位置：cordis_define 动态插件 tavern-1/pkg-12（本文件为源码备份，
 * 与运行中的包内容一致；修改后需重新 define/update 才能生效）。
 *
 * 功能：
 *  - RPC: tavern:import-card
 *    * 路径一：文件在 character-cards 目录 → 直接读磁盘
 *    * 路径二：客户端 base64（任意位置文件）→ 手写标准 base64→字节解码
 *      （DSH 的 atob 是 UTF-8 文本语义，不能用于二进制，故手写解码）
 *  - RPC: tavern:list-characters（已导入角色卡列表，磁盘持久化；
 *    FsDirEntry.type === 'directory' 过滤目录）
 *  - 世界书/正则/脚本均非必需：卡里没有就不写对应文件，统计返回 0
 *  - 写入 ~/.dsh/tavern-characters 携带 sandboxPolicy（workspaceRoot=角色卡根目录）
 */
return {
  apply(ctx) {
    const fs = ctx.get('fs')
    const workspaceRegistry = ctx.get('workspaceRegistry')
    const dshHomePath = ctx.get('dshHomePath')
    const charactersRoot = dshHomePath ? dshHomePath('tavern-characters') : null
    const importDir = 'D:\\github\\deepseektavern\\character-cards'

    // 写 ~/.dsh/tavern-characters 的沙箱策略：把角色卡根目录作为本次写入的工作区根
    const writePolicy = charactersRoot
      ? { mode: 'workspace-write', workspaceRoot: charactersRoot }
      : undefined

    function latin1(bytes) {
      let s = ''
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
      return s
    }
    function utf8(bytes) {
      try { return new TextDecoder('utf-8').decode(bytes) } catch (e) { return latin1(bytes) }
    }
    // 标准 base64 → 字节（DSH 的 atob 是 UTF-8 文本语义，不能用于二进制；这里手写标准解码）
    function base64ToBytes(b64) {
      const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      const lookup = {}
      for (let i = 0; i < 64; i++) lookup[CHARS[i]] = i
      const out = []
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
    function tryParseJson(bytes) {
      const candidates = []
      try { candidates.push(utf8(bytes)) } catch (e) { /* noop */ }
      try { candidates.push(latin1(bytes)) } catch (e) { /* noop */ }
      for (const text of candidates) {
        try { return JSON.parse(text) } catch (e) { /* try next */ }
      }
      // PNG chara 内容通常是 base64 包裹的 JSON：用标准 base64 解码
      try {
        const b64 = latin1(bytes).trim()
        const decoded = utf8(base64ToBytes(b64))
        return JSON.parse(decoded)
      } catch (e) { /* 不是 base64 包裹 JSON */ }
      return null
    }
    function parsePngToJson(bytes) {
      const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('不是合法的 PNG 文件')
      let offset = 8
      let found = null
      const textChunks = []
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
    function safeName(name) {
      return String(name || '角色').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
    }
    function normalizeRegex(r) {
      return {
        scriptName: r.scriptName || r.name || 'unnamed',
        findRegex: r.findRegex || '', replaceString: r.replaceString || '',
        trimStrings: r.trimStrings ?? false, placement: r.placement ?? 0,
        disabled: r.disabled ?? false, markdownOnly: r.markdownOnly ?? false,
        promptOnly: r.promptOnly ?? false, runOnEdit: r.runOnEdit ?? false,
        substituteRegex: r.substituteRegex ?? false, minDepth: r.minDepth ?? 0, maxDepth: r.maxDepth ?? 0,
      }
    }
    // 世界书条目归一化：character_book 与外部文件字段名不同，统一为 ST 格式
    function normalizeWorldEntry(e, id) {
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
        id: id,
        extensions: e.extensions || {},
      }
    }
    async function splitCard(json, srcDir) {
      const data = json.data || json
      const name = data.name || json.name || '角色'
      const ext = data.extensions || {}
      const out = { card: null, world: null, worldNote: [], regexes: [], scripts: [], worldRef: typeof ext.world === 'string' ? ext.world : null, worldMerged: 0 }
      out.card = {
        spec: json.spec || 'chara_card_v3', spec_version: json.spec_version || '3.0',
        name, description: data.description || '', personality: data.personality || '',
        scenario: data.scenario || '', first_mes: data.first_mes || '',
        mes_example: data.mes_example || '', creator_notes: data.creator_notes || data.creatorcomment || '',
        system_prompt: data.system_prompt || '', post_history_instructions: data.post_history_instructions || '',
        alternate_greetings: data.alternate_greetings || [], tags: data.tags || [],
        creator: data.creator || '', character_version: data.character_version || '',
      }
      const mergedWorld = { entries: {}, name: '' }
      const seen = new Set()
      const mergeWorld = (obj, label) => {
        if (!obj || typeof obj !== 'object') return 0
        const entries = obj.entries || obj
        if (typeof entries !== 'object') return 0
        if (obj.name) mergedWorld.name = obj.name
        let added = 0
        for (const [id, entry] of Object.entries(entries)) {
          if (entry && typeof entry === 'object' && typeof entry.content === 'string') {
            const norm = normalizeWorldEntry(entry, id)
            // 按 content 去重（同一条目不会重复合并）
            const dedupKey = (norm.content || '').slice(0, 64)
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
      }
      else out.worldNote.push('未找到任何世界书条目')
      for (const r of (ext.regex_scripts || [])) out.regexes.push(normalizeRegex(r))
      for (const s of ((ext.tavern_helper && ext.tavern_helper.scripts) || [])) {
        out.scripts.push({ type: s.type || 'script', enabled: s.enabled !== false, name: s.name, id: s.id, info: s.info || '', button: s.button || { enabled: false, buttons: [] }, data: s.data || {}, content: s.content || '' })
      }
      return out
    }

    // 读取已导入角色卡列表（磁盘即持久化）
    async function listCharacters() {
      const out = []
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
            let workspaceId = null
            if (workspaceRegistry) {
              try {
                const ws = await workspaceRegistry.resolveByPath(charactersRoot + '\\' + e.name)
                workspaceId = ws ? ws.id : null
              } catch (err) { /* 未注册 */ }
            }
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

    ctx.effect(() => harness.handle('tavern:import-card', async (args) => {
      const fileName = args && args.fileName
      const base64 = args && args.base64
      if (!fileName) return { ok: false, error: '缺少 fileName' }
      try {
        let json = null
        // 路径一：文件就在 character-cards 目录 → 直接读
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
        // 路径二：客户端 base64（任意位置文件，标准 base64 解码）
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
        const split = await splitCard(json, importDir)
        const cardName = split.card.name
        const safe = safeName(cardName)
        const wsDir = charactersRoot ? charactersRoot + '\\' + safe : null
        if (!wsDir) return { ok: false, error: '无法解析 DSH 数据目录' }
        split.card.importedAt = new Date().toISOString().slice(0, 10)
        await fs.writeText(await fs.resolve(wsDir + '\\card.json'), JSON.stringify(split.card, null, 2), undefined, undefined, writePolicy)
        if (split.world) await fs.writeText(await fs.resolve(wsDir + '\\world.json'), JSON.stringify(split.world, null, 2), undefined, undefined, writePolicy)
        if (split.regexes.length) await fs.writeText(await fs.resolve(wsDir + '\\regex.json'), JSON.stringify(split.regexes, null, 2), undefined, undefined, writePolicy)
        if (split.scripts.length) {
          for (const s of split.scripts) {
            const base = safeName(s.name)
            if (s.content) await fs.writeText(await fs.resolve(wsDir + '\\scripts\\' + base + '.js'), s.content, undefined, undefined, writePolicy)
            await fs.writeText(await fs.resolve(wsDir + '\\scripts\\' + base + '.meta.json'), JSON.stringify(s, null, 2), undefined, undefined, writePolicy)
          }
        }
        let workspace = null
        if (workspaceRegistry) {
          try { workspace = await workspaceRegistry.create(wsDir, cardName) }
          catch (e) { return { ok: false, error: '工作区创建失败: ' + e.message } }
        }
        return {
          ok: true, cardName, workspacePath: wsDir,
          workspaceId: workspace ? workspace.id : null,
          worldNote: split.worldNote, worldMerged: split.worldMerged,
          regexCount: split.regexes.length, scriptCount: split.scripts.length,
        }
      } catch (e) { return { ok: false, error: e.message || String(e) } }
    }))
    // 打开角色工作区：确保工作区已注册（幂等 create），返回 workspaceId 供跳转
    ctx.effect(() => harness.handle('tavern:open-character', async (args) => {
      const workspaceName = args && args.workspaceName
      if (!workspaceName || !charactersRoot) return { ok: false, error: '缺少 workspaceName' }
      try {
        const wsDir = charactersRoot + '\\' + safeName(workspaceName)
        let workspace = null
        if (workspaceRegistry) {
          try {
            workspace = await workspaceRegistry.create(wsDir, workspaceName)
          } catch (e) {
            return { ok: false, error: '工作区打开失败: ' + e.message }
          }
        }
        return { ok: true, workspaceId: workspace ? workspace.id : null, workspacePath: wsDir }
      } catch (e) { return { ok: false, error: e.message || String(e) } }
    }))
    ctx.effect(() => harness.handle('tavern:list-characters', async () => {
      return { characters: await listCharacters() }
    }))
    // 服务已存在则复用，避免重复注册冲突
    ctx.effect(() => {
      if (ctx.get('tavernMode') === undefined) {
        return ctx.provide('tavernMode', {
          isEnabled: () => true,
          getCharactersRoot: () => charactersRoot,
        })
      }
    })
  },
}
