/* 吴苑澄观 · LOD 分级管理器
 * 统一按「相机 → 对象包围球近缘」的距离把对象划入 L0/L1/L2/L3 四级：
 *   L0 0–18 m   ：显示核心体量 + 全部 L0 专属细节（瓦当、斗拱、砖雕、棂条细部）
 *   L1 18–55 m  ：显示核心体量 + L1 专属细节，剔除 L0 细节
 *   L2 55–140 m ：仅核心体量 + 简化体量 / 中模（塔、远景树、村落）
 *   L3 >140 m   ：仅剪影 + 雾；借景塔按 0.25 距离权重保留 L2 中模
 * 距离带随画质档 lodScale 缩放，进出阈值有 8% 滞回；4 Hz 判定避免跳变。
 */
import * as THREE from 'three';
import { LOD_LEVELS, clamp } from './core.js';

export class LODManager {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.items = [];
    this.visualTargets = [];
    this.stats = [0, 0, 0, 0];
    this.scale = 1;
    this.acc = 0;
    this.visualize = false;
    this.visMats = LOD_LEVELS.map(l => new THREE.MeshBasicMaterial({
      color: l.color, side: THREE.DoubleSide, fog: true,
    }));
  }
  _v(center) {
    return center instanceof THREE.Vector3 ? center.clone() : new THREE.Vector3(center[0], center[1], center[2]);
  }
  /** 扫描合批组：tag=0 核心体量参与统计与可视化；tag>=1 作为可剔除细节层 */
  addBatchGroup(group) {
    group.traverse(o => {
      if (!o.isMesh || !o.userData.center) return;
      const item = {
        kind: 'batch',
        obj: o,
        center: o.userData.center.clone(),
        radius: o.userData.radius || 1,
        tag: o.userData.lodTag || 0,
        level: 0,
        baseMat: o.material,
        distanceScale: 1,
      };
      this.items.push(item);
      this.visualTargets.push(item);
    });
  }
  /** 单体对象：level > maxLevel 时隐藏（匾额、灯笼、村落等） */
  addDetail(obj, center, radius = 1, maxLevel = 0) {
    const item = {
      kind: 'detail', obj, center: this._v(center), radius,
      maxLevel, level: 0, baseMat: obj.isMesh ? obj.material : null,
      distanceScale: 1,
    };
    this.items.push(item);
    if (obj.isMesh) this.visualTargets.push(item);
    else obj.traverse(c => {
      if (c.isMesh) this.visualTargets.push({ obj: c, baseMat: c.material, owner: item });
    });
    return item;
  }
  /** 多档几何：levels[0..n-1]，按级别切换；借景塔可传 distanceScale < 1 保留中模 */
  addLevels(levels, center, radius = 1, opts = {}) {
    const item = {
      kind: 'levels', levels, obj: null,
      center: this._v(center), radius,
      level: 0, distanceScale: opts.distanceScale ?? 1,
      baseMat: null,
    };
    this.items.push(item);
    levels.forEach(g => g.traverse(c => {
      if (c.isMesh) this.visualTargets.push({ obj: c, baseMat: c.material, owner: item });
    }));
    return item;
  }
  setQuality(q) { this.scale = q.lodScale; this.acc = 99; this.update(0, true); }
  levelFor(dist, prev) {
    let lvl = 3;
    for (let i = 0; i < 3; i++) {
      const th = LOD_LEVELS[i].far * this.scale * (prev > i ? 0.92 : 1.06);
      if (dist < th) { lvl = i; break; }
    }
    return lvl;
  }
  update(dt, force = false) {
    this.acc += dt;
    if (!force && this.acc < 0.25) return false;
    this.acc = 0;
    const stats = [0, 0, 0, 0];
    const cam = this.camera.position;
    for (const it of this.items) {
      const d = Math.max(0, cam.distanceTo(it.center) - it.radius * 0.55) * it.distanceScale;
      const lvl = this.levelFor(d, it.level);
      it.level = lvl;
      it.dist = d;
      stats[lvl]++;
      if (it.kind === 'batch' || it.kind === 'detail') {
        const visible = it.kind === 'detail' ? lvl <= it.maxLevel : (it.tag === 0 || lvl < it.tag);
        if (it.obj) it.obj.visible = visible;
      } else if (it.kind === 'levels') {
        // L0/L1 用全细节，L2 用中模，L3 才退为剪影
        const idx = Math.min(Math.max(0, lvl - 1), it.levels.length - 1);
        it.levels.forEach((g, i) => { g.visible = i === idx; });
      }
    }
    this.stats = stats;
    if (this.visualize) this._applyVisual();
    return true;
  }
  _applyVisual() {
    for (const it of this.visualTargets) {
      const idx = Math.min((it.owner ? it.owner.level : it.level) ?? 0, 3);
      if (it.obj && it.obj.material !== this.visMats[idx]) it.obj.material = this.visMats[idx];
    }
  }
  setVisualize(on) {
    this.visualize = on;
    if (on) this._applyVisual();
    else for (const it of this.visualTargets) {
      if (it.obj && it.baseMat && it.obj.material !== it.baseMat) it.obj.material = it.baseMat;
    }
    this.update(0, true);
  }
  /** 返回可读的分级摘要，供 HUD 与设计说明使用 */
  summary() {
    return LOD_LEVELS.map((l, i) => `${l.tag}/${this.stats[i]}`).join(' ');
  }
}
