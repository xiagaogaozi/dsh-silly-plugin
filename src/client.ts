/**
 * dsh-tavern-mode · Client 半（正式插件）
 *
 * 设置 → 酒馆模式 页面：
 *  - 导入角色卡（点击弹系统文件选择器 / 拖拽，任意位置文件）
 *  - 已导入角色卡列表（世界书/正则/脚本统计 + 打开 + 删除）
 *  - 导入/列表/删除/打开 都通过 fetch POST /tavern/api/<method> 调宿主
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createElement, useEffect, useReducer, useRef, useState } from 'react'

// ── harness 官方 SVG 图标（ic_ds_*，内嵌 path，fill=currentColor）──
const ICON_FOLDER = 'M5.19629 1.57104C5.81144 1.5711 6.38623 1.8786 6.72754 2.39038L7.19922 3.09839C7.28454 3.22635 7.42824 3.30344 7.58203 3.30347H12.1699C13.5039 3.30348 14.5859 4.38548 14.5859 5.71948V6.62671C15.2694 7.02689 15.6605 7.85012 15.4385 8.68726L14.3848 12.658C14.1037 13.7164 13.1449 14.4527 12.0498 14.4529H2.91699C1.51651 14.4529 0.451662 13.2814 0.501954 11.9519V3.98706C0.501954 2.65305 1.58396 1.57104 2.91797 1.57104H5.19629ZM3.7793 7.75562C3.30994 7.75562 2.89883 8.07153 2.77832 8.52515L1.91602 11.7722C1.74167 12.4291 2.23734 13.073 2.91699 13.073H12.0498C12.5191 13.0728 12.9304 12.757 13.0508 12.3035L14.1045 8.33374C14.1819 8.04202 13.9619 7.756 13.6602 7.75562H3.7793ZM2.91797 2.9519C2.34625 2.9519 1.88281 3.41534 1.88281 3.98706V7.2937C2.33068 6.7269 3.02249 6.37476 3.7793 6.37476H13.2051V5.71948C13.2051 5.14777 12.7416 4.68434 12.1699 4.68433H7.58203C6.96675 4.6843 6.39209 4.37595 6.05078 3.86401L5.5791 3.15601C5.49379 3.02821 5.34995 2.95196 5.19629 2.9519H2.91797Z'
const ICON_GLOBE = 'M7.00018 0.353516C10.6708 0.353535 13.6468 3.32958 13.6469 7.00018C13.6468 10.6708 10.6708 13.6468 7.00018 13.6469C3.32957 13.6468 0.353535 10.6708 0.353516 7.00018C0.353535 3.32957 3.32957 0.353531 7.00018 0.353516ZM5.44643 7.59661C5.49463 8.97506 5.70762 10.191 6.02136 11.0793C6.20141 11.5891 6.40328 11.9585 6.59898 12.1889C6.79501 12.4196 6.93213 12.454 7.00018 12.454C7.06822 12.454 7.20533 12.4197 7.40138 12.1889C7.59708 11.9585 7.79895 11.589 7.979 11.0793C8.29274 10.191 8.50574 8.97506 8.55394 7.59661H5.44643ZM1.57861 7.59661C1.80785 9.70467 3.2386 11.4509 5.1715 12.1388C5.07135 11.9317 4.97972 11.7098 4.89746 11.477C4.53084 10.4391 4.30224 9.0828 4.25357 7.59661H1.57861ZM9.74679 7.59661C9.69813 9.0828 9.46952 10.4391 9.1029 11.477C9.0206 11.7099 8.92818 11.9316 8.82797 12.1388C10.7613 11.4511 12.1925 9.70496 12.4218 7.59661H9.74679ZM5.1706 1.8616C3.23814 2.54963 1.80876 4.29604 1.5795 6.40376H4.25357C4.30224 4.91756 4.53083 3.56129 4.89746 2.5234C4.97968 2.29066 5.07051 2.0686 5.1706 1.8616ZM7.00018 1.54637C6.93213 1.54638 6.79503 1.5807 6.59898 1.81145C6.40332 2.04177 6.20139 2.41058 6.02136 2.92012C5.70754 3.80851 5.49461 5.02499 5.44643 6.40376H8.55394C8.50575 5.025 8.29282 3.80851 7.979 2.92012C7.79898 2.41059 7.59705 2.04177 7.40138 1.81145C7.20531 1.58067 7.06823 1.54637 7.00018 1.54637ZM8.82887 1.8616C8.92902 2.0687 9.02064 2.29053 9.1029 2.5234C9.46953 3.56129 9.69812 4.91756 9.74679 6.40376H12.4209C12.1916 4.29575 10.7618 2.54943 8.82887 1.8616Z'
const ICON_SEARCH = ['M11.894845 6.647401C11.894845 3.725463 9.534486 1.356779 6.623219 1.35657C3.711786 1.35657 1.351635 3.725338 1.351635 6.647401C1.351843 9.569296 3.711911 11.938273 6.623219 11.938273C9.534361 11.938064 11.894637 9.569171 11.894845 6.647401ZM13.245462 6.647401C13.245254 10.317935 10.280401 13.293613 6.623219 13.293821C2.965871 13.293821 0.000204 10.31806 0 6.647401C0 2.976574 2.965746 0 6.623219 0C10.280526 0.000205 13.245462 2.9767 13.245462 6.647401Z', 'M16.000417 15.041079L15.044449 16.000433L11.530434 12.473588L12.486298 11.514234L16.000417 15.041079Z']
const ICON_CODE = 'M12.3368 1.53569L11.931 4.43172H14.8086V5.79673H11.7404L11.1962 9.67859H14.2839V11.0436H11.0056L10.4994 14.6529L9.14873 14.4643L9.62731 11.0436H5.75876L5.25252 14.6529L3.90186 14.4643L4.38043 11.0436H1.69141V9.67859H4.57104L5.11417 5.79673H2.21609V4.43172H5.30581L5.73724 1.34713L7.08995 1.53569L6.68414 4.43172H10.5527L10.9841 1.34713L12.3368 1.53569ZM5.94937 9.67859H9.81791L10.361 5.79673H6.49353L5.94937 9.67859Z'
const ICON_CHEVRON_R = 'M5.5 2.15137L5.92383 2.57617L8.65137 5.30273C8.90706 5.55843 9.13382 5.78438 9.29785 5.98828C9.46883 6.20088 9.61756 6.44405 9.66602 6.75C9.69222 6.91565 9.69222 7.08435 9.66602 7.25C9.61756 7.55595 9.46883 7.79912 9.29785 8.01172C9.13382 8.21561 8.90706 8.44157 8.65137 8.69727L5.92383 11.4238L5.5 11.8486L4.65137 11L5.07617 10.5762L7.80273 7.84863C8.07732 7.57405 8.24849 7.40124 8.3623 7.25977C8.46904 7.12709 8.47813 7.07728 8.48047 7.0625C8.48703 7.02105 8.48703 6.97895 8.48047 6.9375C8.47813 6.92272 8.46904 6.87291 8.3623 6.74023C8.24848 6.59876 8.07732 6.42595 7.80273 6.15137L5.07617 3.42383L4.65137 3L5.5 2.15137Z'
const ICON_MASKS = 'M8.11 19.45a6.95 6.95 0 0 1-4.4-5.1L2.05 6.54c-.24-1.08.45-2.14 1.53-2.37l9.77-2.07l.03-.01c1.07-.21 2.12.48 2.34 1.54l.35 1.67l4.35.93h.03c1.05.24 1.73 1.3 1.51 2.36l-1.66 7.82a6.993 6.993 0 0 1-8.3 5.38a6.9 6.9 0 0 1-3.89-2.34M20 8.18L10.23 6.1l-1.66 7.82v.03c-.57 2.68 1.16 5.32 3.85 5.89s5.35-1.15 5.92-3.84zm-4 8.32a2.96 2.96 0 0 1-3.17 1.39a2.97 2.97 0 0 1-2.33-2.55zM8.47 5.17L4 6.13l1.66 7.81l.01.03c.15.71.45 1.35.86 1.9c-.1-.77-.08-1.57.09-2.37l.43-2c-.45-.08-.84-.33-1.05-.69c.06-.61.56-1.15 1.25-1.31h.25l.78-3.81c.04-.19.1-.36.19-.52m6.56 7.06c.32-.53 1-.81 1.69-.66c.69.14 1.19.67 1.28 1.29c-.33.52-1 .8-1.7.64c-.69-.13-1.19-.66-1.27-1.27m-4.88-1.04c.32-.53.99-.81 1.68-.66c.67.14 1.2.68 1.28 1.29c-.33.52-1 .81-1.69.68c-.69-.17-1.19-.7-1.27-1.31m1.82-6.76l1.96.42l-.16-.8z'
const ICON_TRASH = 'M4.10464 14.4955C4.12932 15.2361 4.63954 15.8178 5.40176 15.8477L10.5983 15.8477C11.3605 15.8178 11.8707 15.2361 11.8954 14.4955L12.5859 4.58721H3.41414L4.10464 14.4955ZM13.4922 2.8365H10.0313L9.66003 1.59599C9.53865 1.19849 9.16987 0.936413 8.75756 0.936413H7.24246C6.83015 0.936413 6.46137 1.19849 6.33999 1.59599L5.96869 2.8365H2.50783C2.2274 2.8365 2 3.0639 2 3.34433V4.22882C2 4.50925 2.2274 4.73665 2.50783 4.73665H3.12257L3.81257 14.6169C3.86563 15.9317 4.95263 16.9522 6.27955 16.9984L9.72047 16.9984C11.0474 16.9522 12.1344 15.9317 12.1874 14.6169L12.8774 4.73665H13.4922C13.7726 4.73665 14 4.50925 14 4.22882V3.34433C14 3.0639 13.7726 2.8365 13.4922 2.8365Z'

/** 客户端 → 宿主 HTTP RPC（与 better-sidebar 相同的 fetch 通道）。 */
async function callHost<T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/tavern/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const parsed = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new Error(parsed?.value?.error ?? `HTTP ${response.status}`)
  }
  return parsed.value as T
}

function TIcon(props: { d?: string; ds?: string[]; size?: number; viewBox?: string }): React.ReactElement {
  const { d, ds, size = 16, viewBox = '0 0 16 16' } = props
  const paths = ds
    ? ds.map((p, i) => createElement('path', { key: i, d: p, fill: 'currentColor' }))
    : createElement('path', { d, fill: 'currentColor' })
  return createElement('svg', { width: size, height: size, viewBox, fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true }, paths)
}

function toBase64(bytes: Uint8Array): string {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out.push(CHARS[b0 >> 2])
    out.push(CHARS[((b0 & 3) << 4) | (b1 >> 4)])
    out.push(i + 1 < bytes.length ? CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=')
    out.push(i + 2 < bytes.length ? CHARS[b2 & 63] : '=')
  }
  return out.join('')
}

const css = `
.tv-settings { display: flex; flex-direction: column; gap: 12px; padding: 6px 0; }
.tv-head { display: flex; align-items: center; gap: 8px; padding: 2px 2px 0; }
.tv-head .tv-head-ic { color: var(--dsw-alias-label-secondary, #aaa); display: inline-flex; }
.tv-head .tv-head-label { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #eee); }
.tv-dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 22px 14px; border: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,0.35)); border-radius: 10px; cursor: pointer; text-align: center; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06)); color: var(--dsw-alias-label-secondary, #aaa); font-size: 13px; transition: background 0.15s ease; }
.tv-dropzone:hover, .tv-dropzone.tv-dragging { background: var(--dsw-alias-interactive-bg-hover-solid, rgba(128,128,128,0.14)); border-color: var(--dsw-alias-brand-primary, #4c8dff); }
.tv-dropzone .tv-dz-ic { color: var(--dsw-alias-label-secondary, #aaa); }
.tv-dropzone .tv-dz-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #eee); }
.tv-dropzone .tv-dz-hint { font-size: 12px; opacity: 0.7; }
.tv-dropzone.tv-busy { opacity: 0.6; pointer-events: none; }
.tv-result { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 8px; background: rgba(46,158,91,0.12); border: 1px solid rgba(46,158,91,0.3); }
.tv-result .tv-msg { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-primary, #eee); white-space: pre-wrap; word-break: break-all; }
.tv-stat-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-primary, #eee); }
.tv-stat-row .tv-stat-ic { color: var(--dsw-alias-label-secondary, #aaa); display: inline-flex; }
.tv-error { padding: 10px 12px; border-radius: 8px; background: rgba(192,57,43,0.14); border: 1px solid rgba(192,57,43,0.3); font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-primary, #eee); white-space: pre-wrap; word-break: break-all; }
.tv-list { display: flex; flex-direction: column; gap: 6px; }
.tv-list-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #aaa); }
.tv-char-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08)); color: var(--dsw-alias-label-primary, #eee); }
.tv-char-row .tv-char-ic { color: var(--dsw-alias-label-secondary, #aaa); display: inline-flex; flex: none; }
.tv-char-row .tv-char-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.tv-char-row .tv-char-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #eee); }
.tv-char-row .tv-char-meta { font-size: 11px; color: var(--dsw-alias-label-secondary, #aaa); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tv-char-row .tv-char-actions { display: flex; gap: 6px; flex: none; }
.tv-char-row .tv-char-btn { display: inline-flex; align-items: center; gap: 4px; flex: none; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3)); background: transparent; color: var(--dsw-alias-label-primary, #eee); border-radius: 14px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
.tv-char-row .tv-char-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12)); }
.tv-char-row .tv-char-btn.tv-danger { color: var(--dsw-alias-state-error-primary, #e5484d); border-color: rgba(229,72,77,0.4); }
.tv-char-row .tv-char-btn.tv-danger:hover { background: rgba(229,72,77,0.12); }
.tv-open-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: none; border-radius: 14px; height: 28px; padding: 0 10px; cursor: pointer; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary-foreground, #fff); background: var(--dsw-alias-button-primary-fill, #4c6ef5); align-self: flex-start; }
.tv-open-btn:hover { background: var(--dsw-alias-button-primary-hover, #4263eb); }
.tv-open-btn:disabled { cursor: not-allowed; opacity: 0.4; }
`

interface ImportResult {
  ok: boolean
  cardName?: string
  workspacePath?: string
  workspaceId?: string | null
  worldMerged?: number
  regexCount?: number
  scriptCount?: number
  error?: string
}

interface CharacterRow {
  name: string
  dirName: string
  worldEntries: number
  regexCount: number
  scriptCount: number
  importedAt: string
}

/** Required client service used by the settings-slot contribution. */
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = css
    style.setAttribute('data-plugin', 'dsh-tavern-mode')
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dsh-tavern-mode: styles')

  function TavernSettings(): React.ReactElement {
    const [, force] = useReducer((x: number) => x + 1, 0)
    const [busy, setBusy] = useState(false)
    const [result, setResult] = useState<ImportResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [dragging, setDragging] = useState(false)
    const [chars, setChars] = useState<CharacterRow[]>([])
    const [deleting, setDeleting] = useState<string | null>(null)
    const fileInput = useRef<HTMLInputElement | null>(null)

    const refreshChars = (): void => {
      callHost<{ characters: CharacterRow[] }>('listCharacters', {}).then((r) => {
        if (r && Array.isArray(r.characters)) setChars(r.characters)
      }).catch(() => {})
    }
    useEffect(() => { refreshChars() }, [])

    const openWorkspace = (dirName: string): void => {
      if (!dirName) return
      callHost<{ ok: boolean; workspaceId?: string | null; error?: string }>('openCharacter', { workspaceName: dirName })
        .then((r) => {
          if (r && r.ok && r.workspaceId) {
            // 通过 sessions 服务跳转（沿用 harness 的会话打开）
            const sessions = ctx.get('sessions') as { open(id: string): void } | undefined
            sessions?.open(r.workspaceId)
          } else {
            setError((r && r.error) || '无法打开角色工作区')
          }
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    }

    const deleteCharacter = (dirName: string): void => {
      if (!dirName || deleting) return
      if (!window.confirm('确定删除角色「' + dirName + '」？\n将删除其工作区目录（card/world/regex/scripts）。')) return
      setDeleting(dirName)
      callHost<{ ok: boolean; error?: string }>('deleteCharacter', { workspaceName: dirName })
        .then((r) => {
          if (r && r.ok) {
            setError(null)
            refreshChars()
          } else {
            setError((r && r.error) || '删除失败')
          }
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => setDeleting(null))
    }

    const handleFile = (file: File): void => {
      if (!file || busy) return
      setBusy(true)
      setResult(null)
      setError(null)
      file.arrayBuffer().then((buf) => {
        const base64 = toBase64(new Uint8Array(buf))
        return callHost<ImportResult>('importCard', { fileName: file.name, base64 })
      }).then((r) => {
        if (r && r.ok) {
          setResult(r)
          refreshChars()
          if (r.workspaceId) {
            const sessions = ctx.get('sessions') as { open(id: string): void } | undefined
            sessions?.open(r.workspaceId)
          }
        } else {
          setError((r && r.error) || '导入失败')
        }
      }).catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      }).finally(() => setBusy(false))
    }

    const onInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const file = e.target.files && e.target.files[0]
      if (file) handleFile(file)
      e.target.value = ''
    }

    const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
      if (file) handleFile(file)
    }

    const statRow = (icon: React.ReactElement, label: string): React.ReactElement =>
      createElement('div', { className: 'tv-stat-row' },
        createElement('span', { className: 'tv-stat-ic' }, icon),
        createElement('span', null, label),
      )

    return createElement('div', { className: 'tv-settings' },
      createElement('div', { className: 'tv-head' },
        createElement('span', { className: 'tv-head-ic' }, createElement(TIcon, { d: ICON_MASKS, size: 16, viewBox: '0 0 24 24' })),
        createElement('span', { className: 'tv-head-label' }, '酒馆模式'),
      ),
      createElement('div', {
        className: 'tv-dropzone' + (busy ? ' tv-busy' : '') + (dragging ? ' tv-dragging' : ''),
        onClick: () => { if (fileInput.current) fileInput.current.click() },
        onDragOver: (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(true) },
        onDragLeave: () => setDragging(false),
        onDrop,
      },
        createElement('div', { className: 'tv-dz-ic' }, createElement(TIcon, { d: ICON_FOLDER, size: 20 })),
        createElement('div', { className: 'tv-dz-title' }, busy ? '导入中…' : '导入角色卡'),
        createElement('div', { className: 'tv-dz-hint' }, '点击选择角色卡文件，或直接拖拽到这里（PNG / JSON / Lorebook，任意位置）'),
      ),
      createElement('input', {
        ref: fileInput,
        type: 'file',
        accept: '.png,.json,.lorebook',
        style: { display: 'none' },
        onChange: onInputChange,
      }),
      result && result.ok && createElement('div', { className: 'tv-result' },
        createElement('div', { className: 'tv-msg' }, '已导入「' + result.cardName + '」'),
        statRow(createElement(TIcon, { d: ICON_GLOBE, size: 14 }), '世界书: ' + (result.worldMerged ? result.worldMerged + ' 个' : '无')),
        statRow(createElement(TIcon, { ds: ICON_SEARCH, size: 14 }), '正则: ' + (result.regexCount || 0) + ' 条'),
        statRow(createElement(TIcon, { d: ICON_CODE, size: 14 }), '脚本: ' + (result.scriptCount || 0) + ' 个'),
        createElement('div', { className: 'tv-msg', style: { opacity: 0.65 } }, '工作区: ' + result.workspacePath),
        createElement('button', {
          className: 'tv-open-btn',
          onClick: () => openWorkspace(result.workspacePath ? result.workspacePath.split('\\').pop() || '' : ''),
        },
          '打开工作区',
          createElement(TIcon, { d: ICON_CHEVRON_R, size: 12 }),
        ),
      ),
      chars.length > 0 && createElement('div', { className: 'tv-list' },
        createElement('div', { className: 'tv-list-title' }, '已导入角色卡（' + chars.length + '）'),
        chars.map((c) => createElement('div', { className: 'tv-char-row', key: c.dirName || c.name },
          createElement('span', { className: 'tv-char-ic' }, createElement(TIcon, { d: ICON_MASKS, size: 16, viewBox: '0 0 24 24' })),
          createElement('div', { className: 'tv-char-info' },
            createElement('div', { className: 'tv-char-name' }, c.name),
            createElement('div', { className: 'tv-char-meta' },
              (c.worldEntries > 0 ? '世界书 ' + c.worldEntries + ' 条' : '无世界书')
              + ' · 正则 ' + c.regexCount + ' · 脚本 ' + c.scriptCount
              + (c.importedAt ? ' · ' + c.importedAt : '')),
          ),
          createElement('div', { className: 'tv-char-actions' },
            createElement('button', { className: 'tv-char-btn', onClick: () => openWorkspace(c.dirName || c.name) }, '打开'),
            createElement('button', {
              className: 'tv-char-btn tv-danger',
              disabled: deleting === c.dirName,
              onClick: () => deleteCharacter(c.dirName || c.name),
            }, deleting === c.dirName ? '删除中…' : '删除'),
          ),
        )),
      ),
      error && createElement('div', { className: 'tv-error' }, error),
    )
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'tavern', order: 1000, label: '酒馆模式' },
    () => createElement(TavernSettings),
  ))
}
