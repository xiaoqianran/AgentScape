# Asset Generator Gateway 协议

AgentScape 的原则是**先搜索已有资产，再生成缺失资产**。生成器运行在服务器侧，浏览器不保存模型供应商密钥。

## 请求

```http
POST <asset-generator-endpoint>
Content-Type: application/json
```

```json
{
  "prompt": "现代咖啡机"
}
```

## 响应

服务返回可直接注册的 AgentScape Manifest：

```json
{
  "manifest": {
    "id": "coffee_machine_a1b2",
    "type": "coffee_machine",
    "label": "现代咖啡机",
    "tags": ["coffee", "appliance"],
    "source": {
      "kind": "glb",
      "url": "https://assets.example.com/coffee_machine.glb"
    },
    "actions": ["move"],
    "physics": {
      "body": "fixed",
      "colliders": [
        {
          "shape": "box",
          "halfExtents": [0.2, 0.25, 0.2],
          "translation": [0, 0.25, 0]
        }
      ]
    }
  }
}
```

GLB URL 必须能被浏览器访问，并正确配置 CORS。Manifest 会先通过 Schema 校验，再注册进 AssetLibrary。

后端可以封装 Hunyuan3D、TRELLIS、Blender 自动化或其他生成系统；AgentScape Runtime 不依赖具体模型。
