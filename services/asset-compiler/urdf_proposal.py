import io
from typing import Any

import numpy as np
from yourdfpy import URDF


def urdf_part_proposal(urdf_bytes: bytes) -> dict[str, Any]:
    model = URDF.load(
        io.BytesIO(urdf_bytes),
        build_scene_graph=False,
        build_collision_scene_graph=False,
        load_meshes=False,
        load_collision_meshes=False,
    )
    joints = list(model.robot.joints)
    by_child = {joint.child: joint for joint in joints}
    movable = {"revolute", "prismatic", "continuous"}

    def parent_frame(link_name: str, joint_origin: np.ndarray) -> tuple[str, np.ndarray]:
        current = link_name
        transform = joint_origin.copy()
        while current in by_child:
            parent_joint = by_child[current]
            if parent_joint.type in movable:
                return parent_joint.child, transform
            parent_origin = np.asarray(parent_joint.origin if parent_joint.origin is not None else np.eye(4), dtype=float)
            transform = parent_origin @ transform
            current = parent_joint.parent
        return "$root", transform

    parts = []
    for joint in joints:
        if joint.type == "fixed":
            continue
        axis = np.asarray(joint.axis if joint.axis is not None else [1, 0, 0], dtype=float)
        norm = float(np.linalg.norm(axis))
        if norm > 1e-12:
            axis = axis / norm
        limits = None
        if joint.limit and joint.limit.lower is not None and joint.limit.upper is not None:
            lower, upper = float(joint.limit.lower), float(joint.limit.upper)
            if np.isfinite(lower) and np.isfinite(upper) and lower < upper:
                limits = [lower, upper]
        origin = np.asarray(joint.origin if joint.origin is not None else np.eye(4), dtype=float)
        parent_part, parent_to_joint = parent_frame(joint.parent, origin)
        proposal_joint = {
            "type": joint.type,
            "axis": axis.round(9).tolist(),
            "urdf": {
                "name": joint.name,
                "parentLink": joint.parent,
                "childLink": joint.child,
                "originMatrix": origin.round(9).tolist(),
                "parentToJointMatrix": parent_to_joint.round(9).tolist(),
            },
        }
        if limits is not None:
            proposal_joint["limits"] = limits
        parts.append({
            "id": joint.child,
            "node": joint.child,
            "parent": parent_part,
            "joint": proposal_joint,
            "confidence": 1.0,
        })

    return {
        "version": 1,
        "source": "urdf/yourdfpy",
        "frameConvention": "urdf-link-local",
        "confidence": 1.0,
        "parts": parts,
    }
