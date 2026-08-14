# 酒馆模式（Tavern Mode）— DSH 角色扮演扩展

让 DeepSeek Harness 具备 SillyTavern 风格的角色扮演玩法。

## 文件清单

| 文件 | 说明 |
|---|---|
| `png2json.js` | 工具：角色卡 PNG → JSON（解析 tEXt chunk 中的 chara/ccv3，支持 base64 包裹） |
| `split-card.js` | 工具：角色卡 JSON → 四部分拆分（本体 / 世界书 / 正则 / 酒馆助手脚本），**自动合并外部引用世界书** |
| `tavern-host.js` | 插件 Host 半源码（与运行中 pkg-5 一致） |
| `tavern-client.js` | 插件 Client 半源码（与运行中 pkg-5 一致） |
| `e2e-check.js` | 端到端验证脚本（模拟导入链路） |

## 当前功能（pkg-4，运行中）

1. **总开关**：设置 → 酒馆模式 → "启用酒馆模式"。真开关：关闭时 Host 拒绝所有业务 RPC。
2. **导入角色卡**：页面内点击（弹**系统文件选择器**，在电脑里选文件）或直接**拖拽**文件到虚线区域。支持 PNG / JSON / Lorebook。
   - 选中的文件内容以 base64 传给 Host → 解析 → 四部分拆分 → 写入工作区 → 注册
   - 结果卡片显示：**绑定世界书个数 / 正则条数 / 脚本个数 / 工作区路径**
   - 导入成功后**自动建同名工作区并跳转**（打开该工作区会话），也可点"打开工作区 →"

## 工作区结构

导入角色卡后，自动创建同名工作区（`~/.dsh/tavern-characters/<角色名>/`，注册到 harness 工作区列表）：

```
~/.dsh/tavern-characters/<角色名>/
├── card.json      # 本体角色卡（name/description/scenario/first_mes/...）
├── world.json     # 世界书（含自动合并的外部引用）
├── regex.json     # 正则脚本列表
└── scripts/       # 酒馆助手脚本（.js + .meta.json）
```

## 样式约定

所有 UI 颜色只使用 harness 主题 token（`--dsw-alias-*`），不自创视觉。

## Host RPC 接口（Client → Host，Package 私有）

| method | 参数 | 返回 |
|---|---|---|
| `tavern:get` | — | `{ enabled }` |
| `tavern:set` | `{ enabled }` | `{ enabled }` |
| `tavern:import-card` | `{ fileName, base64 }` | `{ ok, cardName, workspacePath, workspaceId, worldNote[], worldMerged, regexCount, scriptCount }`（未启用拒绝） |

## 服务（供后续功能包读取）

- `tavernMode`（Host）：`isEnabled()` / `setEnabled(v)` / `getCharactersRoot()`
  - 后续功能（正则注入、HTML 渲染、快捷回复等）在 `apply` 时先检查 `tavernMode.isEnabled()`，未开启则不注册。

## 使用流程

1. 设置 → 酒馆模式 → 打开总开关
2. 点击虚线区域（或拖拽角色卡文件进去）
3. 系统文件选择器选角色卡（PNG / JSON）
4. 自动建同名工作区并跳转；结果卡片显示世界书 / 正则 / 脚本数量

## 命令行工具用法

```bash
# PNG → JSON
node tavern-plugin/png2json.js character-cards/xxx.png
# JSON → 四部分拆分（自动合并外部世界书）
node tavern-plugin/split-card.js character-cards/xxx.json
```

## 已知边界

- 动态插件不持久：进程重启后需重新 define/run。源码已落盘，后续可改造成持久 agent preset 或正式插件。
- PNG 解析支持 tEXt chunk（含 base64 包裹 JSON），zTXt/iTXt 暂不支持。
- 世界书若为外部引用（`extensions.world` 为字符串），需把同名文件（`世界书-<名>.json` / `<名>.json`）放入 `character-cards\` 才能自动合并。
