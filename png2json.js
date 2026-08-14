#!/usr/bin/env node
/**
 * png2json.js — 酒馆角色卡 PNG → JSON 提取工具
 *
 * SillyTavern / Character Card V2 规范：角色卡的 JSON 本体存在 PNG 的
 * 文本 chunk 里（key 为 "chara" 或 "ccv3"），图片本身只是载体。
 *
 * 用法：
 *   node png2json.js <角色卡.png> [输出.json]
 *   node png2json.js --inspect <角色卡.png>   # 只列出所有文本 chunk，不输出
 *
 * 输出（默认写到 <png同名>.json 或指定路径）：
 *   提取出的完整角色卡 JSON。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

// PNG 签名：89 50 4E 47 0D 0A 1A 0A
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * 遍历 PNG chunk。每个 chunk：4 字节长度(大端) + 4 字节类型 + 数据 + 4 字节 CRC。
 * @param {Buffer} buf
 * @returns {Array<{type: string, data: Buffer, offset: number}>}
 */
function parseChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('不是合法的 PNG 文件（签名不匹配）')
  }
  const chunks = []
  let offset = 8
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    const start = offset + 8
    const data = buf.subarray(start, start + len)
    chunks.push({ type, data, offset })
    offset = start + len + 4 // 跳过 CRC
  }
  return chunks
}

/**
 * 解码一个文本 chunk 为 { key, text }。
 * 支持 tEXt（未压缩）、zTXt（zlib 压缩）、iTXt（UTF-8，可压缩）。
 * @param {{type: string, data: Buffer}} chunk
 * @returns {{key: string, text: string, encoding: string} | null}
 */
function decodeTextChunk(chunk) {
  const { type, data } = chunk
  if (type === 'tEXt') {
    // keyword\0text（Latin-1）
    const nul = data.indexOf(0)
    if (nul < 0) return null
    const key = data.toString('latin1', 0, nul)
    const text = data.toString('latin1', nul + 1)
    return { key, text, encoding: 'latin1' }
  }
  if (type === 'zTXt') {
    // keyword\0compressionMethod(1 byte)\0compressedText
    const nul = data.indexOf(0)
    if (nul < 0) return null
    const key = data.toString('latin1', 0, nul)
    const method = data[nul + 1]
    if (method !== 0) return null // 只支持 zlib
    const inflated = zlib.inflateSync(data.subarray(nul + 2))
    return { key, text: inflated.toString('latin1'), encoding: 'latin1' }
  }
  if (type === 'iTXt') {
    // keyword\0 compressionFlag(1) compressionMethod(1) language\0 translatedKeyword\0 text(UTF-8)
    const nul = data.indexOf(0)
    if (nul < 0) return null
    const key = data.toString('latin1', 0, nul)
    const compFlag = data[nul + 1]
    let pos = nul + 3 // 跳过 flag + method
    // language\0
    const langEnd = data.indexOf(0, pos)
    if (langEnd < 0) return null
    // translatedKeyword\0
    const tkEnd = data.indexOf(0, langEnd + 1)
    if (tkEnd < 0) return null
    const raw = data.subarray(tkEnd + 1)
    const text = compFlag === 1
      ? zlib.inflateSync(raw).toString('utf8')
      : raw.toString('utf8')
    return { key, text, encoding: 'utf8' }
  }
  return null
}

/**
 * 从 PNG 字节中提取角色卡 JSON（优先 "chara" / "ccv3" key）。
 * @param {Buffer} buf
 * @returns {{json: any, raw: string, key: string, chunks: Array<{key: string, text: string}>}}
 */
function extractCharacterJson(buf) {
  const chunks = parseChunks(buf)
  const textChunks = []
  let cardRaw = null
  let cardKey = null
  for (const chunk of chunks) {
    const decoded = decodeTextChunk(chunk)
    if (!decoded) continue
    textChunks.push(decoded)
    if ((decoded.key === 'chara' || decoded.key === 'ccv3') && cardRaw === null) {
      cardRaw = decoded.text
      cardKey = decoded.key
    }
  }
  if (cardRaw === null) {
    throw new Error(
      '未找到角色卡文本 chunk（key 应为 "chara" 或 "ccv3"）。' +
      '发现文本 chunk: ' + (textChunks.map(c => c.key).join(', ') || '(无)')
    )
  }
  let json
  try {
    json = JSON.parse(cardRaw)
  } catch (e) {
    // 部分卡用 base64 包一层
    try {
      json = JSON.parse(Buffer.from(cardRaw.trim(), 'base64').toString('utf8'))
    } catch (e2) {
      throw new Error('chunk "chara" 内容既不是合法 JSON 也不是 base64 包裹的 JSON')
    }
  }
  return { json, raw: cardRaw, key: cardKey, chunks: textChunks }
}

function main() {
  const args = process.argv.slice(2)
  const inspect = args[0] === '--inspect'
  const src = inspect ? args[1] : args[0]
  if (!src) {
    console.error('用法: node png2json.js <角色卡.png> [输出.json]')
    console.error('      node png2json.js --inspect <角色卡.png>')
    process.exit(2)
  }
  const buf = fs.readFileSync(src)
  const { json, key, chunks } = extractCharacterJson(buf)

  if (inspect) {
    console.log(`文件: ${src} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`)
    console.log(`角色卡 chunk key: ${key}`)
    console.log('全部文本 chunk:')
    for (const c of chunks) {
      console.log(`  - ${c.key} (${c.text.length} 字符, ${c.encoding})`)
    }
    console.log('\n角色卡 JSON 顶层结构:')
    console.log(JSON.stringify(json, null, 2).slice(0, 3000))
    return
  }

  const out = args[1] || src.replace(/\.png$/i, '.json')
  fs.writeFileSync(out, JSON.stringify(json, null, 2), 'utf8')
  console.log(`已提取角色卡 JSON (${key}) → ${out}`)
  console.log(`顶层键: ${Object.keys(json).join(', ')}`)
}

main()
