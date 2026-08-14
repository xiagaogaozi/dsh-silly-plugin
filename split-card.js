#!/usr/bin/env node
/**
 * split-card.js — 酒馆角色卡 JSON → 四部分拆分工具
 *
 * 把一张完整的角色卡 JSON（png2json.js 的产物）拆分成可独立使用的四部分：
 *   1. 本体角色卡   card.json            — name/description/personality/scenario/first_mes/...
 *   2. 世界书       world/               — 内嵌 lorebook；字符串引用则只记录名字
 *   3. 正则         regex/               — extensions.regex_scripts，每条一个 JSON
 *   4. 酒馆助手脚本 scripts/             — extensions.tavern_helper.scripts，每个 .js/.json
 *
 * 用法：
 *   node split-card.js <角色卡.json> [输出目录]
 * 输出目录默认为 <角色卡同名>_split/。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

function normalizeRegex(r) {
  // ST 正则脚本字段补全：enabled 缺省按 true
  const out = {
    scriptName: r.scriptName || r.name || 'unnamed',
    findRegex: r.findRegex || '',
    replaceString: r.replaceString || '',
    trimStrings: r.trimStrings ?? false,
    placement: r.placement ?? 0,
    disabled: r.disabled ?? false,
    markdownOnly: r.markdownOnly ?? false,
    promptOnly: r.promptOnly ?? false,
    runOnEdit: r.runOnEdit ?? false,
    substituteRegex: r.substituteRegex ?? false,
    minDepth: r.minDepth ?? 0,
    maxDepth: r.maxDepth ?? 0,
  }
  if (typeof r.enabled === 'boolean') out.enabled = r.enabled
  return out
}

function main() {
  const src = process.argv[2]
  if (!src) {
    console.error('用法: node split-card.js <角色卡.json> [输出目录]')
    process.exit(2)
  }
  const json = JSON.parse(fs.readFileSync(src, 'utf8'))
  const data = json.data || json // V3 有 data 包裹，V2 直接平铺
  const name = data.name || json.name || path.basename(src, '.json')

  const outDir = process.argv[3] || path.join(
    path.dirname(src),
    path.basename(src, '.json') + '_split'
  )
  fs.mkdirSync(path.join(outDir, 'regex'), { recursive: true })
  fs.mkdirSync(path.join(outDir, 'world'), { recursive: true })
  fs.mkdirSync(path.join(outDir, 'scripts'), { recursive: true })

  // ---- 1. 本体角色卡 ----
  const card = {
    spec: json.spec || 'chara_card_v3',
    spec_version: json.spec_version || '3.0',
    name: data.name || name,
    description: data.description || '',
    personality: data.personality || '',
    scenario: data.scenario || '',
    first_mes: data.first_mes || '',
    mes_example: data.mes_example || '',
    creator_notes: data.creator_notes || data.creatorcomment || '',
    system_prompt: data.system_prompt || '',
    post_history_instructions: data.post_history_instructions || '',
    alternate_greetings: data.alternate_greetings || [],
    tags: data.tags || [],
    creator: data.creator || '',
    character_version: data.character_version || '',
  }
  fs.writeFileSync(path.join(outDir, 'card.json'), JSON.stringify(card, null, 2), 'utf8')

  // ---- 2. 世界书 ----
  const ext = data.extensions || {}
  const worldNotes = []
  // 候选世界书：内嵌对象 或 外部引用名 + 同目录同名文件自动合并
  const srcDir = path.dirname(src)
  const mergedWorld = { entries: {} }

  const mergeWorldObject = (obj, label) => {
    if (!obj || typeof obj !== 'object') return false
    const entries = obj.entries || obj
    if (typeof entries !== 'object') return false
    let added = 0
    for (const [id, entry] of Object.entries(entries)) {
      if (entry && typeof entry === 'object' && typeof entry.content === 'string') {
        mergedWorld.entries[id] = entry
        added++
      }
    }
    if (added > 0) worldNotes.push(`${label} ${added} 条`)
    return added > 0
  }

  // 2a. 内嵌世界书（对象形态）
  if (ext.world && typeof ext.world === 'object') {
    mergeWorldObject(ext.world, '内嵌世界书:')
  }

  // 2b. 外部引用（字符串形态）：同目录自动查找同名世界书文件
  if (typeof ext.world === 'string' && ext.world) {
    const ref = ext.world
    worldNotes.push('外部引用: ' + ref)
    const refCandidates = [
      path.join(srcDir, `世界书-${ref}.json`),
      path.join(srcDir, `世界书-${ref}.lorebook`),
      path.join(srcDir, `${ref}.json`),
      path.join(srcDir, `${ref}.lorebook`),
    ]
    let found = false
    for (const cand of refCandidates) {
      if (fs.existsSync(cand)) {
        try {
          const wb = JSON.parse(fs.readFileSync(cand, 'utf8'))
          const merged = mergeWorldObject(wb, '自动合并外部世界书:')
          if (merged) { found = true; worldNotes.push('来源: ' + path.basename(cand)) }
          break
        } catch (e) {
          worldNotes.push('外部世界书解析失败: ' + path.basename(cand) + ' (' + e.message + ')')
        }
      }
    }
    if (!found) {
      worldNotes.push('未找到同名外部世界书文件（期待 ' +
        `世界书-${ref}.json / ${ref}.json 于 ${srcDir}）`)
    }
  }

  const entryCount = Object.keys(mergedWorld.entries).length
  if (entryCount > 0) {
    fs.writeFileSync(path.join(outDir, 'world', 'world.json'), JSON.stringify(mergedWorld, null, 2), 'utf8')
  } else {
    fs.writeFileSync(
      path.join(outDir, 'world', 'REFERENCE.txt'),
      'world 引用名: ' + (typeof ext.world === 'string' ? ext.world : '(内嵌为空)') + '\n' +
      '拆分时未找到任何世界书条目。若需要，请提供同名世界书文件（.json 或 .lorebook）。\n'
    )
  }

  // ---- 3. 正则 ----
  const regexes = ext.regex_scripts || []
  const regexIndex = []
  regexes.forEach((r, i) => {
    const norm = normalizeRegex(r)
    const file = `${String(i + 1).padStart(2, '0')}-${norm.scriptName.replace(/[\\/:*?"<>|]/g, '_')}.json`
    fs.writeFileSync(path.join(outDir, 'regex', file), JSON.stringify(norm, null, 2), 'utf8')
    regexIndex.push({ file, scriptName: norm.scriptName })
  })

  // ---- 4. 酒馆助手脚本 ----
  const scripts = (ext.tavern_helper && ext.tavern_helper.scripts) || []
  const scriptIndex = []
  scripts.forEach((s, i) => {
    const base = `${String(i + 1).padStart(2, '0')}-${s.name.replace(/[\\/:*?"<>|]/g, '_')}`
    const meta = {
      type: s.type || 'script',
      enabled: s.enabled !== false,
      name: s.name,
      id: s.id,
      info: s.info || '',
      button: s.button || { enabled: false, buttons: [] },
      data: s.data || {},
      export_with: s.export_with || {},
    }
    if (s.content && s.content.length > 0) {
      fs.writeFileSync(path.join(outDir, 'scripts', base + '.js'), s.content, 'utf8')
      meta.content_file = base + '.js'
    }
    fs.writeFileSync(path.join(outDir, 'scripts', base + '.meta.json'), JSON.stringify(meta, null, 2), 'utf8')
    scriptIndex.push({ file: base + '.meta.json', name: s.name, contentLen: (s.content || '').length })
  })

  // ---- 索引 ----
  const manifest = {
    card_name: name,
    source: src,
    spec: json.spec || 'chara_card_v3',
    split_at: new Date().toISOString(),
    parts: {
      card: 'card.json',
      world: worldNotes,
      regex: { count: regexIndex.length, files: regexIndex },
      tavern_helper_scripts: { count: scriptIndex.length, files: scriptIndex },
    },
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`已拆分 → ${outDir}`)
  console.log(`  1. 本体角色卡: card.json`)
  console.log(`  2. 世界书: ${worldNotes.join('; ') || '(无)'}`)
  console.log(`  3. 正则: ${regexIndex.length} 条 → regex/`)
  console.log(`  4. 酒馆助手脚本: ${scriptIndex.length} 个 → scripts/`)
  console.log(`  索引: manifest.json`)}

main()
