import unittest
import numpy as np
import trimesh

from part_geometry import _rigid_inverse, mesh_report, part_meshes


class PartGeometryTest(unittest.TestCase):
    def test_extracts_nearest_part_owned_meshes_in_part_local_frame(self):
        scene = trimesh.Scene()
        door_transform = np.eye(4)
        door_transform[:3, 3] = [5, 2, -1]
        scene.graph.update(frame_from='world', frame_to='Door', matrix=door_transform)
        panel = trimesh.creation.box(extents=[2, 1, .2])
        handle = trimesh.creation.box(extents=[.2, .2, .2])
        scene.add_geometry(panel, node_name='Panel', geom_name='PanelGeom', parent_node_name='Door', transform=np.eye(4))
        scene.graph.update(frame_from='Door', frame_to='HandlePart', matrix=trimesh.transformations.translation_matrix([.7, 0, 0]))
        scene.add_geometry(handle, node_name='HandleMesh', geom_name='HandleGeom', parent_node_name='HandlePart', transform=np.eye(4))
        glb = scene.export(file_type='glb')

        meshes, errors = part_meshes(glb, [
            {'id':'door','node':'Door'},
            {'id':'handle','node':'HandlePart'},
        ])
        self.assertEqual(errors, {})
        self.assertEqual(set(meshes), {'door','handle'})
        np.testing.assert_allclose(meshes['door'].extents, [2,1,.2], atol=1e-6)
        np.testing.assert_allclose(meshes['door'].centroid, [0,0,0], atol=1e-6)
        np.testing.assert_allclose(meshes['handle'].extents, [.2,.2,.2], atol=1e-6)
        np.testing.assert_allclose(meshes['handle'].centroid, [0,0,0], atol=1e-6)

    def test_rejects_sheared_or_mirrored_part_frames(self):
        shear=np.eye(4); shear[0,1]=.2
        with self.assertRaisesRegex(ValueError, 'shear'):
            _rigid_inverse(shear)
        mirror=np.eye(4); mirror[0,0]=-1
        with self.assertRaisesRegex(ValueError, 'mirrored'):
            _rigid_inverse(mirror)

    def test_reports_mass_only_for_watertight_volume(self):
        box=trimesh.creation.box(extents=[1,1,1])
        report=mesh_report(box, 500)
        self.assertEqual(report['massMethod'], 'watertight-volume-density')
        self.assertEqual(report['mass'], 200.0)  # service safety cap
        plane=trimesh.Trimesh(vertices=[[0,0,0],[1,0,0],[0,1,0]], faces=[[0,1,2]], process=False)
        report=mesh_report(plane, 500)
        self.assertNotIn('mass', report)
        self.assertIsNone(report['volume'])


if __name__ == '__main__':
    unittest.main()
