from __future__ import annotations

import io
from typing import Any

import numpy as np
import trimesh


def _rigid_inverse(world: np.ndarray) -> np.ndarray:
    matrix = np.asarray(world, dtype=float)
    linear = matrix[:3, :3]
    scale = np.linalg.norm(linear, axis=0)
    if np.any(scale < 1e-9):
        raise ValueError("Part transform contains zero scale")
    rotation = linear / scale
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-5):
        raise ValueError("Part transform contains shear")
    if np.linalg.det(rotation) <= 0:
        raise ValueError("Part transform contains mirrored/negative scale")
    rigid = np.eye(4)
    rigid[:3, :3] = rotation
    rigid[:3, 3] = matrix[:3, 3]
    return np.linalg.inv(rigid)


def part_meshes(glb: bytes, parts: list[dict[str, Any]]) -> tuple[dict[str, trimesh.Trimesh], dict[str, str]]:
    scene = trimesh.load(io.BytesIO(glb), file_type="glb", force="scene")
    if not isinstance(scene, trimesh.Scene):
        raise ValueError("Part geometry requires a GLB scene")

    node_to_part = {str(part["node"]): str(part["id"]) for part in parts}
    if len(node_to_part) != len(parts):
        raise ValueError("Part node names must be unique")
    missing = [node for node in node_to_part if node not in scene.graph.nodes]
    if missing:
        raise ValueError(f"Part nodes missing from GLB: {missing}")

    parents = scene.graph.transforms.parents
    owned: dict[str, list[str]] = {str(part["id"]): [] for part in parts}
    for geometry_node in scene.graph.nodes_geometry:
        current = geometry_node
        owner = None
        while current is not None:
            if current in node_to_part:
                owner = node_to_part[current]
                break
            current = parents.get(current)
        if owner is not None:
            owned[owner].append(geometry_node)

    result: dict[str, trimesh.Trimesh] = {}
    errors: dict[str, str] = {}
    for part in parts:
        part_id, part_node = str(part["id"]), str(part["node"])
        try:
            owner_inverse = _rigid_inverse(scene.graph[part_node][0])
        except Exception as exc:
            errors[part_id] = str(exc)
            continue
        meshes = []
        for geometry_node in owned[part_id]:
            world, geometry_name = scene.graph[geometry_node]
            if geometry_name is None:
                continue
            mesh = scene.geometry[geometry_name].copy()
            mesh.apply_transform(owner_inverse @ world)
            meshes.append(mesh)
        if meshes:
            result[part_id] = trimesh.util.concatenate(meshes)
    return result, errors


def mesh_report(mesh: trimesh.Trimesh, density: float) -> dict[str, Any]:
    volume = float(abs(mesh.volume)) if mesh.is_volume else None
    components = len(mesh.split(only_watertight=False))
    report: dict[str, Any] = {
        "watertight": bool(mesh.is_watertight),
        "windingConsistent": bool(mesh.is_winding_consistent),
        "components": int(components),
        "volume": volume,
        "vertices": int(len(mesh.vertices)),
        "faces": int(len(mesh.faces)),
        "extents": np.asarray(mesh.extents, dtype=float).round(6).tolist(),
    }
    if volume is not None and np.isfinite(volume) and volume > 0:
        report["mass"] = round(max(0.01, min(200.0, volume * density)), 4)
        report["massMethod"] = "watertight-volume-density"
    return report
