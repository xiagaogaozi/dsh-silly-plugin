var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
let TavernService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _importCard_decorators;
    let _listCharacters_decorators;
    let _deleteCharacter_decorators;
    let _openCharacter_decorators;
    return class TavernService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _importCard_decorators = [Remote('importCard')];
            _listCharacters_decorators = [Remote('listCharacters')];
            _deleteCharacter_decorators = [Remote('deleteCharacter')];
            _openCharacter_decorators = [Remote('openCharacter')];
            __esDecorate(this, null, _importCard_decorators, { kind: "method", name: "importCard", static: false, private: false, access: { has: obj => "importCard" in obj, get: obj => obj.importCard }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listCharacters_decorators, { kind: "method", name: "listCharacters", static: false, private: false, access: { has: obj => "listCharacters" in obj, get: obj => obj.listCharacters }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _deleteCharacter_decorators, { kind: "method", name: "deleteCharacter", static: false, private: false, access: { has: obj => "deleteCharacter" in obj, get: obj => obj.deleteCharacter }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _openCharacter_decorators, { kind: "method", name: "openCharacter", static: false, private: false, access: { has: obj => "openCharacter" in obj, get: obj => obj.openCharacter }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        fs = __runInitializers(this, _instanceExtraInitializers);
        shell;
        workspaceRegistry;
        charactersRoot;
        writePolicy;
        importDir = 'D:\\github\\deepseektavern\\character-cards';
        constructor(ctx, fs, shell, workspaceRegistry, charactersRoot, writePolicy) {
            super(ctx, 'tavernMode', { namespace: 'tavern' });
            this.fs = fs;
            this.shell = shell;
            this.workspaceRegistry = workspaceRegistry;
            this.charactersRoot = charactersRoot;
            this.writePolicy = writePolicy;
        }
        // ── 工具 ──────────────────────────────────────────────
        latin1(bytes) {
            let s = '';
            for (let i = 0; i < bytes.length; i++)
                s += String.fromCharCode(bytes[i]);
            return s;
        }
        utf8(bytes) {
            try {
                return new TextDecoder('utf-8').decode(bytes);
            }
            catch {
                return this.latin1(bytes);
            }
        }
        /** 标准 base64 → 字节（DSH atob 是 UTF-8 文本语义，不能用于二进制）。 */
        base64ToBytes(b64) {
            const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            const lookup = {};
            for (let i = 0; i < 64; i++)
                lookup[CHARS[i]] = i;
            const out = [];
            let buffer = 0;
            let bits = 0;
            for (let i = 0; i < b64.length; i++) {
                const c = b64[i];
                if (c === '=')
                    break;
                const v = lookup[c];
                if (v === undefined)
                    continue;
                buffer = (buffer << 6) | v;
                bits += 6;
                if (bits >= 8) {
                    bits -= 8;
                    out.push((buffer >> bits) & 0xff);
                }
            }
            return Uint8Array.from(out);
        }
        tryParseJson(bytes) {
            const texts = [];
            try {
                texts.push(this.utf8(bytes));
            }
            catch { /* noop */ }
            try {
                texts.push(this.latin1(bytes));
            }
            catch { /* noop */ }
            for (const text of texts) {
                try {
                    return JSON.parse(text);
                }
                catch { /* try next */ }
            }
            try {
                const b64 = this.latin1(bytes).trim();
                return JSON.parse(this.utf8(this.base64ToBytes(b64)));
            }
            catch { /* not base64 */ }
            return null;
        }
        parsePngToJson(bytes) {
            const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
            for (let i = 0; i < 8; i++)
                if (bytes[i] !== sig[i])
                    throw new Error('不是合法的 PNG 文件');
            let offset = 8;
            let found = null;
            const textChunks = [];
            while (offset + 8 <= bytes.length) {
                const len = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
                const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
                const start = offset + 8;
                const data = bytes.subarray(start, start + len);
                if (type === 'tEXt') {
                    const nul = data.indexOf(0);
                    if (nul >= 0) {
                        const key = this.latin1(data.subarray(0, nul));
                        const textBytes = data.subarray(nul + 1);
                        textChunks.push(key);
                        if ((key === 'chara' || key === 'ccv3') && found === null) {
                            found = this.tryParseJson(textBytes);
                        }
                    }
                }
                offset = start + len + 4;
            }
            if (found === null) {
                throw new Error('未找到角色卡 chunk（chara/ccv3）。文本 chunk: ' + (textChunks.join(', ') || '(无)'));
            }
            return found;
        }
        safeName(name) {
            return String(name || '角色').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
        }
        normalizeRegex(r) {
            return {
                scriptName: r.scriptName || r.name || 'unnamed',
                findRegex: r.findRegex || '', replaceString: r.replaceString || '',
                trimStrings: r.trimStrings ?? false, placement: r.placement ?? 0,
                disabled: r.disabled ?? false, markdownOnly: r.markdownOnly ?? false,
                promptOnly: r.promptOnly ?? false, runOnEdit: r.runOnEdit ?? false,
                substituteRegex: r.substituteRegex ?? false, minDepth: r.minDepth ?? 0, maxDepth: r.maxDepth ?? 0,
            };
        }
        normalizeWorldEntry(e, id) {
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
            };
        }
        async splitCard(json, srcDir) {
            const data = (json.data || json);
            const name = data.name || json.name || '角色';
            const ext = (data.extensions || {});
            const out = {
                card: {
                    spec: json.spec || 'chara_card_v3', spec_version: json.spec_version || '3.0',
                    name, description: data.description || '', personality: data.personality || '',
                    scenario: data.scenario || '', first_mes: data.first_mes || '',
                    mes_example: data.mes_example || '', creator_notes: data.creator_notes || data.creatorcomment || '',
                    system_prompt: data.system_prompt || '', post_history_instructions: data.post_history_instructions || '',
                    alternate_greetings: data.alternate_greetings || [], tags: data.tags || [],
                    creator: data.creator || '', character_version: data.character_version || '',
                },
                world: null,
                worldNote: [],
                worldMerged: 0,
                regexes: [],
                scripts: [],
            };
            const mergedWorld = { entries: {}, name: '' };
            const seen = new Set();
            const mergeWorld = (obj, label) => {
                if (!obj || typeof obj !== 'object')
                    return 0;
                const entries = obj.entries || obj;
                if (typeof entries !== 'object')
                    return 0;
                if (obj.name)
                    mergedWorld.name = obj.name;
                let added = 0;
                for (const [id, entry] of Object.entries(entries)) {
                    if (entry && typeof entry === 'object' && typeof entry.content === 'string') {
                        const norm = this.normalizeWorldEntry(entry, id);
                        const dedupKey = String(norm.content || '').slice(0, 64);
                        if (!seen.has(dedupKey)) {
                            seen.add(dedupKey);
                            mergedWorld.entries[id] = norm;
                            added++;
                        }
                    }
                }
                if (added > 0)
                    out.worldNote.push(label + ' ' + added + ' 条');
                return added;
            };
            // 1) 内嵌世界书：data.character_book（Character Card V3 规范的位置）
            if (data.character_book && typeof data.character_book === 'object') {
                if (data.character_book.name)
                    mergedWorld.name = data.character_book.name;
                mergeWorld(data.character_book, '内嵌世界书:');
            }
            // 2) 兼容：extensions.world 是对象（老格式）
            if (ext.world && typeof ext.world === 'object') {
                mergeWorld(ext.world, 'extensions.world 内嵌:');
            }
            // 3) 外部引用：extensions.world 字符串 → character-cards 目录同名文件
            if (typeof ext.world === 'string' && ext.world) {
                out.worldNote.push('外部引用: ' + ext.world);
                if (!mergedWorld.name)
                    mergedWorld.name = ext.world;
                const ref = ext.world;
                const candidates = ['世界书-' + ref + '.json', '世界书-' + ref + '.lorebook', ref + '.json', ref + '.lorebook'];
                for (const cand of candidates) {
                    try {
                        const t = await this.fs.resolve(srcDir + '\\' + cand);
                        const info = await this.fs.stat(t);
                        if (info) {
                            const wb = JSON.parse(await this.fs.readText(t));
                            const added = mergeWorld(wb, '合并外部世界书:');
                            if (added > 0) {
                                out.worldMerged = added;
                                out.worldNote.push('来源: ' + cand);
                            }
                            break;
                        }
                    }
                    catch { /* try next */ }
                }
            }
            const entryCount = Object.keys(mergedWorld.entries).length;
            if (entryCount > 0) {
                out.world = mergedWorld;
                out.worldMerged = entryCount;
            }
            else {
                out.worldNote.push('未找到任何世界书条目');
            }
            for (const r of (ext.regex_scripts || []))
                out.regexes.push(this.normalizeRegex(r));
            for (const s of ((ext.tavern_helper && ext.tavern_helper.scripts) || [])) {
                out.scripts.push({ type: s.type || 'script', enabled: s.enabled !== false, name: s.name, id: s.id, info: s.info || '', button: s.button || { enabled: false, buttons: [] }, data: s.data || {}, content: s.content || '' });
            }
            return out;
        }
        // ── Remote 方法 ───────────────────────────────────────
        /** 导入角色卡：fileName + base64（任意位置文件）。 */
        async importCard(request) {
            const fileName = request?.fileName;
            const base64 = request?.base64;
            if (!fileName)
                return { ok: false, error: '缺少 fileName' };
            try {
                let json = null;
                try {
                    const dirTarget = await this.fs.resolve(this.importDir + '\\' + fileName);
                    const dirInfo = await this.fs.stat(dirTarget);
                    if (dirInfo) {
                        if (/\.png$/i.test(fileName)) {
                            const bytes = await this.fs.readBytes(dirTarget, undefined, 64 * 1024 * 1024);
                            json = this.parsePngToJson(bytes);
                        }
                        else if (/\.(json|lorebook)$/i.test(fileName)) {
                            json = JSON.parse(await this.fs.readText(dirTarget));
                        }
                    }
                }
                catch { /* 目录读取失败，走 base64 */ }
                if (json === null && typeof base64 === 'string' && base64.length > 0) {
                    const bytes = this.base64ToBytes(base64);
                    if (/\.png$/i.test(fileName)) {
                        json = this.parsePngToJson(bytes);
                    }
                    else if (/\.(json|lorebook)$/i.test(fileName)) {
                        json = JSON.parse(this.utf8(bytes));
                    }
                }
                if (json === null) {
                    return { ok: false, error: '无法读取角色卡：文件不存在或内容无效' };
                }
                const split = await this.splitCard(json, this.importDir);
                const cardName = String(split.card.name || '角色');
                const safe = this.safeName(cardName);
                const wsDir = this.charactersRoot ? this.charactersRoot + '\\' + safe : null;
                if (!wsDir)
                    return { ok: false, error: '无法解析 DSH 数据目录' };
                split.card.importedAt = new Date().toISOString().slice(0, 10);
                await this.fs.writeText(await this.fs.resolve(wsDir + '\\card.json'), JSON.stringify(split.card, null, 2), undefined, undefined, this.writePolicy);
                if (split.world)
                    await this.fs.writeText(await this.fs.resolve(wsDir + '\\world.json'), JSON.stringify(split.world, null, 2), undefined, undefined, this.writePolicy);
                if (split.regexes.length)
                    await this.fs.writeText(await this.fs.resolve(wsDir + '\\regex.json'), JSON.stringify(split.regexes, null, 2), undefined, undefined, this.writePolicy);
                if (split.scripts.length) {
                    for (const s of split.scripts) {
                        const base = this.safeName(String(s.name || 'script'));
                        if (s.content)
                            await this.fs.writeText(await this.fs.resolve(wsDir + '\\scripts\\' + base + '.js'), String(s.content), undefined, undefined, this.writePolicy);
                        await this.fs.writeText(await this.fs.resolve(wsDir + '\\scripts\\' + base + '.meta.json'), JSON.stringify(s, null, 2), undefined, undefined, this.writePolicy);
                    }
                }
                let workspace = null;
                if (this.workspaceRegistry) {
                    try {
                        workspace = await this.workspaceRegistry.create(wsDir, cardName);
                    }
                    catch (e) {
                        return { ok: false, error: '工作区创建失败: ' + (e instanceof Error ? e.message : String(e)) };
                    }
                }
                return {
                    ok: true, cardName, workspacePath: wsDir,
                    workspaceId: workspace ? workspace.id : null,
                    worldNote: split.worldNote, worldMerged: split.worldMerged,
                    regexCount: split.regexes.length, scriptCount: split.scripts.length,
                };
            }
            catch (e) {
                return { ok: false, error: e instanceof Error ? e.message : String(e) };
            }
        }
        /** 列出已导入角色卡（磁盘持久化）。 */
        async listCharacters() {
            const out = [];
            if (!this.charactersRoot || !this.fs)
                return { characters: out };
            try {
                const rootTarget = await this.fs.resolve(this.charactersRoot);
                const entries = await this.fs.listDir(rootTarget);
                for (const e of entries) {
                    if (e.type !== 'directory')
                        continue;
                    try {
                        const cardTarget = await this.fs.resolve(this.charactersRoot + '\\' + e.name + '\\card.json');
                        const card = JSON.parse(await this.fs.readText(cardTarget));
                        let worldEntries = 0;
                        try {
                            const wTarget = await this.fs.resolve(this.charactersRoot + '\\' + e.name + '\\world.json');
                            const w = JSON.parse(await this.fs.readText(wTarget));
                            worldEntries = Object.keys(w.entries || {}).length;
                        }
                        catch { /* 无世界书 */ }
                        let regexCount = 0;
                        try {
                            const rTarget = await this.fs.resolve(this.charactersRoot + '\\' + e.name + '\\regex.json');
                            const r = JSON.parse(await this.fs.readText(rTarget));
                            regexCount = Array.isArray(r) ? r.length : 0;
                        }
                        catch { /* 无正则 */ }
                        let scriptCount = 0;
                        try {
                            const sTarget = await this.fs.resolve(this.charactersRoot + '\\' + e.name + '\\scripts');
                            const sEntries = await this.fs.listDir(sTarget);
                            scriptCount = sEntries.filter((x) => /\.js$/i.test(x.name || '')).length;
                        }
                        catch { /* 无脚本 */ }
                        out.push({
                            name: card.name || e.name,
                            dirName: e.name,
                            worldEntries, regexCount, scriptCount,
                            importedAt: card.importedAt || '',
                        });
                    }
                    catch { /* 目录无 card.json，跳过 */ }
                }
            }
            catch { /* 根目录不存在 */ }
            return { characters: out };
        }
        /** 删除角色：解除工作区注册 + 物理删除目录。 */
        async deleteCharacter(request) {
            const workspaceName = request?.workspaceName;
            if (!workspaceName || !this.charactersRoot)
                return { ok: false, error: '缺少 workspaceName' };
            const safe = this.safeName(workspaceName);
            const wsDir = this.charactersRoot + '\\' + safe;
            try {
                if (this.workspaceRegistry) {
                    try {
                        const ws = await this.workspaceRegistry.resolveByPath(wsDir);
                        if (ws)
                            await this.workspaceRegistry.delete(ws.id);
                    }
                    catch { /* 未注册则跳过 */ }
                }
                if (this.shell) {
                    const cmd = 'Remove-Item -LiteralPath ' + JSON.stringify(wsDir) + ' -Recurse -Force -ErrorAction SilentlyContinue';
                    const spec = this.shell.resolve({ command: cmd, timeoutMs: 30000 });
                    const result = await this.shell.run(spec);
                    if (result.exitCode !== 0 && result.exitCode !== null) {
                        return { ok: false, error: '目录删除失败: ' + (result.stderr || 'exit ' + result.exitCode) };
                    }
                }
                return { ok: true, workspaceName: safe };
            }
            catch (e) {
                return { ok: false, error: e instanceof Error ? e.message : String(e) };
            }
        }
        /** 打开角色工作区：确保注册（幂等 create），返回 workspaceId。 */
        async openCharacter(request) {
            const workspaceName = request?.workspaceName;
            if (!workspaceName || !this.charactersRoot)
                return { ok: false, error: '缺少 workspaceName' };
            try {
                const wsDir = this.charactersRoot + '\\' + this.safeName(workspaceName);
                let workspace = null;
                if (this.workspaceRegistry) {
                    try {
                        workspace = await this.workspaceRegistry.create(wsDir, workspaceName);
                    }
                    catch (e) {
                        return { ok: false, error: '工作区打开失败: ' + (e instanceof Error ? e.message : String(e)) };
                    }
                }
                return { ok: true, workspaceId: workspace ? workspace.id : null, workspacePath: wsDir };
            }
            catch (e) {
                return { ok: false, error: e instanceof Error ? e.message : String(e) };
            }
        }
    };
})();
export { TavernService };
