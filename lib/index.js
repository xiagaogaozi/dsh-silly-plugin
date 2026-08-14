import { TavernService } from "./service.js";
export const name = 'dsh-tavern-mode';
export function apply(ctx) {
    const dshHomePath = ctx.get('dshHomePath');
    const charactersRoot = dshHomePath ? dshHomePath('tavern-characters') : null;
    const writePolicy = charactersRoot
        ? { mode: 'workspace-write', workspaceRoot: charactersRoot }
        : undefined;
    // 不依赖事件时序：立即构造服务并注册（fs/workspaceRegistry/shell 都是宿主服务，ready 前可用）
    const service = new TavernService(ctx, ctx.get('fs'), ctx.get('shell'), ctx.get('workspaceRegistry'), charactersRoot, writePolicy);
    ctx.effect(() => {
        if (ctx.get('tavernMode') === undefined) {
            return ctx.provide('tavernMode', service);
        }
        return undefined;
    });
}
