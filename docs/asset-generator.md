# AgentScape Asset Generator contract

AgentScape searches reusable assets before generating anything. A generator is only used when no suitable asset exists.

## Request

`POST <asset-generator-endpoint>`

```json
{
  "prompt": "modern coffee machine"
}
```

## Response

The service returns a runtime-registerable AgentScape manifest. The GLB URL must be reachable by the browser and allow CORS from the AgentScape origin.

```json
{
  "manifest": {
    "id": "coffee_machine_a1b2",
    "type": "coffee_machine",
    "label": "Modern Coffee Machine",
    "tags": ["coffee", "appliance", "machine"],
    "source": {
      "kind": "glb",
      "url": "https://assets.example.com/coffee_machine_a1b2.glb"
    },
    "actions": ["move"],
    "physics": {
      "body": "fixed",
      "colliders": [
        { "shape": "box", "halfExtents": [0.2, 0.25, 0.2], "translation": [0, 0.25, 0] }
      ]
    }
  }
}
```

Generated assets are validated, registered in the in-memory `AssetLibrary`, and immediately become available to `searchAssets` and `spawnAsset` without changing the runtime.

Future generator backends can wrap Hunyuan3D, TRELLIS, SAM3D, Blender automation, or another 3D generation pipeline while preserving this contract.
