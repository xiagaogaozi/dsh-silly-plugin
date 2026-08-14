/**
 * dsh-tavern-mode · 宿主半入口
 *
 * 注册 TavernService（Typert Remote 端点：tavern/importCard 等），
 * 供浏览器端设置页调用。随 profile bundle 重启持久加载。
 */
import type { Context } from '@deepseek-ai/cordis'
import { TavernService } from './service.ts'

export const name = 'dsh-tavern-mode'

export function apply(ctx: Context): void {
  const dshHomePath = ctx.get('dshHomePath') as ((...segments: string[]) => string) | undefined
  const charactersRoot = dshHomePath ? dshHomePath('tavern-characters') : null

  const writePolicy = charactersRoot
    ? { mode: 'workspace-write' as const, workspaceRoot: charactersRoot }
    : undefined

  // 不依赖事件时序：立即构造服务并注册（fs/workspaceRegistry/shell 都是宿主服务，ready 前可用）
  const service = new TavernService(
    ctx,
    ctx.get('fs') as never,
    ctx.get('shell') as never,
    ctx.get('workspaceRegistry') as never,
    charactersRoot,
    writePolicy,
  )
  ctx.effect(() => {
    if (ctx.get('tavernMode') === undefined) {
      return ctx.provide('tavernMode', service) as never
    }
    return undefined as never
  })
}
