// 端到端验证：模拟插件 Host 半的导入流程（与 tavern-host.js 逻辑一致）
'use strict'
const fs = require('fs')

// 1. PNG 解析（tEXt chunk 提取）
const buf = fs.readFileSync('D:/github/deepseektavern/character-cards/COC7th通用KP主持卡.png')
let offset = 8
let found = null
while (offset + 8 <= buf.length) {
  const len = (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]
  const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7])
  const start = offset + 8
  const data = buf.subarray(start, start + len)
  if (type === 'tEXt') {
    const nul = data.indexOf(0)
    if (nul >= 0) {
      const key = data.subarray(0, nul).toString('latin1')
      if (key === 'chara') found = data.subarray(nul + 1).toString('latin1')
    }
  }
  offset = start + len + 4
}
if (!found) throw new Error('未找到 chara chunk')
// chara chunk 可能是 base64 包裹的 JSON（本卡实测如此）
let json
try { json = JSON.parse(found) } catch (e) { json = JSON.parse(Buffer.from(found.trim(), 'base64').toString('utf8')) }
console.log('✓ PNG 解析成功. 角色名:', json.data.name)

// 2. 外部世界书自动合并
const ext = json.data.extensions
const mergedWorld = { entries: {} }
const wb = JSON.parse(fs.readFileSync('D:/github/deepseektavern/character-cards/世界书-COC7th通用KP主持卡.json', 'utf8'))
let added = 0
for (const [id, e] of Object.entries(wb.entries || {})) { mergedWorld.entries[id] = e; added++ }
console.log('✓ 世界书自动合并:', added, '条')

// 3. 建工作区（模拟 fs.writeText 自动建父目录）
const safe = json.data.name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
const wsDir = 'C:/Users/ASUS/.dsh/tavern-characters/' + safe
fs.mkdirSync(wsDir, { recursive: true })
fs.writeFileSync(wsDir + '/card.json', JSON.stringify({ name: json.data.name, system_prompt: json.data.system_prompt }, null, 2))
fs.writeFileSync(wsDir + '/world.json', JSON.stringify(mergedWorld, null, 2))
fs.writeFileSync(wsDir + '/regex.json', JSON.stringify(ext.regex_scripts || [], null, 2))
fs.mkdirSync(wsDir + '/scripts', { recursive: true })
for (const s of (ext.tavern_helper && ext.tavern_helper.scripts) || []) {
  const base = s.name.replace(/[\\/:*?"<>|]/g, '_')
  if (s.content) fs.writeFileSync(wsDir + '/scripts/' + base + '.js', s.content)
}
console.log('✓ 工作区已创建:', wsDir)
console.log('  文件:', fs.readdirSync(wsDir).join(', '))
console.log('  scripts:', fs.readdirSync(wsDir + '/scripts').join(', '))
const card = JSON.parse(fs.readFileSync(wsDir + '/card.json', 'utf8'))
console.log('✓ card.json name 无损:', card.name === 'COC7th通用KP主持卡')
