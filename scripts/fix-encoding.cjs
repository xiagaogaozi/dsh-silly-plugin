// 构建后编码修复：rolldown 在 Windows 上会把部分中文按 GBK 误读。
// 本脚本扫描 lib/client.*.js 产物，把乱码替换回正确中文（从 src 提取对照）。
'use strict'
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'client.ts'), 'utf8')
// 从源码提取所有中文字符串（含可能被破坏的）
const chinese = new Set()
const re = /[\u4e00-\u9fff][\u4e00-\u9fff\w\s·：:，。！？（）「」→]*/g
let m
while ((m = re.exec(src)) !== null) {
  const v = m[0].trim()
  if (v.length >= 2) chinese.add(v)
}

// 对每个中文字符串，生成它的"GBK 乱码版"（UTF-8 字节按 GBK 解码）
function gbkMangle(text) {
  try {
    const bytes = Buffer.from(text, 'utf8')
    // GBK 解码：用 TextDecoder 的 gbk（Node 支持）
    return new TextDecoder('gbk').decode(bytes)
  } catch {
    return null
  }
}

const libDir = path.join(__dirname, '..', 'lib')
for (const file of fs.readdirSync(libDir)) {
  if (!/^client\.(cjs|js|mjs)$/.test(file)) continue
  const full = path.join(libDir, file)
  let content = fs.readFileSync(full, 'utf8')
  let fixed = 0
  for (const good of chinese) {
    const bad = gbkMangle(good)
    if (bad && bad !== good && content.includes(bad)) {
      content = content.split(bad).join(good)
      fixed++
    }
  }
  if (fixed > 0) {
    fs.writeFileSync(full, content, 'utf8')
    console.log(`${file}: 修复 ${fixed} 处乱码`)
  } else {
    console.log(`${file}: 无需修复（或未检出）`)
  }
}
