import { WebIO } from '@gltf-transform/core';
import { inspect } from '@gltf-transform/functions';

export class GLTFInspectPass {
  constructor({ io = new WebIO() } = {}) { this.io = io; }

  async run(context) {
    const document = await this.io.readBinary(context.bytes);
    const report = inspect(document);
    const root = document.getRoot();
    const nodes = root.listNodes().map((node) => ({
      name: node.getName() || '',
      translation: node.getTranslation(),
      rotation: node.getRotation(),
      scale: node.getScale(),
      mesh: node.getMesh()?.getName() || null
    }));
    const scene = report.scenes.properties[0] || null;
    const meshes = report.meshes.properties;
    const stats = {
      scenes: report.scenes.properties.length,
      nodes: nodes.length,
      meshes: meshes.length,
      materials: report.materials.properties.length,
      textures: report.textures.properties.length,
      animations: report.animations.properties.length,
      renderVertices: report.scenes.properties.reduce((n, x) => n + (x.renderVertexCount || 0), 0),
      meshPrimitives: meshes.reduce((n, x) => n + (x.meshPrimitives || 0), 0),
      inputBytes: context.bytes.byteLength
    };
    return { ...context, document, inspection: { report, nodes, scene, stats } };
  }
}
