# AgentScape 世界包和分块资源

## 现有能力

`.asworld` 使用 `ASWORLD1` 头、版本化根节点以及无压缩的内容寻址数据块，不存储来源文件路径，也不执行上传代码。内容块固定上限为 1 MiB，使用 SHA-256 校验；相同内容只需写入一次。世界根节点保存环境插件 ID、实体分页和资产引用。

逻辑实体总数不采用固定业务上限。文件导入将全部实体注册进 Runtime；默认仅激活前 256 个需立即运行的实体，其余保持休眠状态，后续可通过 `WorldRuntime.setObjectActive()` 激活。此预算只约束同时使用的实时资源，不限制世界对象总数。

## Studio

世界编辑器的「保存与文件」菜单中有「导出世界包」和「导入世界包」功能。支持 `.asworld` 文件，使用浏览器 OPFS 存储不可变资源块。可用时使用 `showSaveFilePicker` 流式写入；其他具备 OPFS 的浏览器通过 OPFS 暂存再下载，不会将完整归档拼成一个 JavaScript 字节数组。

当前 Studio 仅向 **相同环境 ID** 的运行时导入，避免环境切换后 UI、自动存档和 URL 状态不一致。导入世界包不会自动转换成 localStorage JSON；刷新页面后可从 `.asworld` 文件重新导入。旧的 JSON 快照按钮仍保留为小场景的调试用途，不应作为大型世界的完整资源备份。

## Node SDK

```javascript
import { AgentScape, WorldStorage, WorldDiskStorage } from 'agentscape3d/node';
import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';

const world = await AgentScape.open();
const storage = new WorldStorage(await new WorldDiskStorage('./world-blocks').initialize());
const writer = await open('./my-world.asworld', 'w');
try {
  await world.exportWorld(storage, { write: bytes => writer.writeFile(bytes) });
} finally {
  await writer.close();
}

const restored = await AgentScape.open();
await restored.importWorld(storage, createReadStream('./my-world.asworld'));
restored.close();
world.close();
```

SDK 也可通过 `prepareWorld(storage, root)` 获得校验结果，再 `prepared.commit()` 激活；不暴露内部 Runtime。SDK 与 Studio 共用 WorldIO、WorldArchive 和资源存储协议。

## 资源与限制

- 单个数据块最多 1 MiB；对资源总量没有原先的 64 MiB 固定上限。测试已覆盖 70 MiB 的磁盘往返与逐块哈希校验。
- 资产解码、GPU/CPU 驻留和当前活跃实体仍然有单独资源预算。源资源的 `CompiledAssetStore` 当前仍可能在激活单个大 GLB 时将该 GLB 解码为完整字节数组，这与归档流式传输是不同的边界。
- 当前导入阶段仍需在内存中收集实体清单以执行 Runtime 的事务性恢复；大型世界的真正分区流送、自动按距离激活和跨环境 Studio 切换属于下一阶段。
- 未受信任的第三方 JavaScript 不会从 `.asworld` 包中执行；环境插件必须由宿主明确注册。
- 源码和归档协议处于早期设计阶段，不承诺与先前实验性 JSON 包格式双向兼容。

## 验收

`tests/integration/world-storage.test.js`、`world-document.test.js`、`world-io.test.js`、`world-io-real-glb.test.js`、`world-bounded-activation.test.js`、`tests/studio/world-file-ui.test.js`、`tests/browser/world-package.spec.js`。
