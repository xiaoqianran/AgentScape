import unittest
import numpy as np
from urdf_proposal import urdf_part_proposal


class UrdfProposalTest(unittest.TestCase):
    def test_fixed_chain_is_composed_into_parent_to_joint_frame(self):
        urdf = b'''<robot name="nested">
<link name="base"/><link name="offset"/><link name="door"/><link name="mount"/><link name="drawer"/>
<joint name="base_offset" type="fixed"><parent link="base"/><child link="offset"/><origin xyz="1 0 0" rpy="0 0 0"/></joint>
<joint name="door" type="revolute"><parent link="offset"/><child link="door"/><origin xyz="0 2 0" rpy="0 0 0"/><axis xyz="0 1 0"/><limit lower="-1" upper="0" effort="1" velocity="1"/></joint>
<joint name="door_mount" type="fixed"><parent link="door"/><child link="mount"/><origin xyz="0 0 3" rpy="0 0 0"/></joint>
<joint name="drawer" type="prismatic"><parent link="mount"/><child link="drawer"/><origin xyz="4 0 0" rpy="0 0 0"/><axis xyz="1 0 0"/><limit lower="0" upper=".5" effort="1" velocity="1"/></joint>
</robot>'''
        proposal = urdf_part_proposal(urdf)
        self.assertEqual(proposal['frameConvention'], 'urdf-link-local')
        door, drawer = proposal['parts']
        self.assertEqual(door['parent'], '$root')
        self.assertEqual(drawer['parent'], 'door')
        np.testing.assert_allclose(np.array(door['joint']['urdf']['parentToJointMatrix'])[:3, 3], [1, 2, 0])
        np.testing.assert_allclose(np.array(drawer['joint']['urdf']['parentToJointMatrix'])[:3, 3], [4, 0, 3])
        self.assertNotIn('actions', door)
        self.assertNotIn('physics', drawer)


if __name__ == '__main__':
    unittest.main()

class UrdfProposalMultipartEndpointTest(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app import app
        self.client = TestClient(app)

    def test_uploads_urdf_bytes_without_remote_url_and_returns_safe_part_proposal(self):
        urdf = b'''<robot name="door_test">
<link name="base"/><link name="door"/>
<joint name="door_joint" type="revolute">
  <parent link="base"/><child link="door"/>
  <origin xyz="0 0 0" rpy="0 0 0"/>
  <axis xyz="0 1 0"/>
  <limit lower="-1" upper="0" effort="1" velocity="1"/>
</joint>
</robot>'''
        response = self.client.post('/compile', data={'stage':'urdf-proposal'}, files={
            'asset':('asset.urdf', urdf, 'application/xml')
        })
        self.assertEqual(response.status_code, 200, response.text)
        proposal = response.json()['partProposal']
        self.assertEqual(proposal['version'], 1)
        self.assertEqual(proposal['source'], 'urdf/yourdfpy')
        self.assertEqual(proposal['frameConvention'], 'urdf-link-local')
        self.assertEqual(len(proposal['parts']), 1)
        part = proposal['parts'][0]
        self.assertEqual(part['joint']['type'], 'revolute')
        self.assertEqual(part['joint']['axis'], [0.0, 1.0, 0.0])
        self.assertNotIn('actions', part)
        self.assertNotIn('physics', part)
        self.assertNotIn('url', response.text.lower())

    def test_rejects_wrong_urdf_upload_media_type(self):
        response = self.client.post('/compile', data={'stage':'urdf-proposal'}, files={
            'asset':('asset.urdf', b'<robot name="x"/>', 'text/html')
        })
        self.assertEqual(response.status_code, 422)
        self.assertIn('unsupported media type', response.text)

    def test_rejects_oversized_urdf_upload(self):
        import app as compiler_app
        original = compiler_app.MAX_URDF_BYTES
        compiler_app.MAX_URDF_BYTES = 32
        try:
            response = self.client.post('/compile', data={'stage':'urdf-proposal'}, files={
                'asset':('asset.urdf', b'<robot name="x">' + b' ' * 64 + b'</robot>', 'application/xml')
            })
            self.assertEqual(response.status_code, 422)
            self.assertIn('MAX_ASSET_BYTES', response.text)
        finally:
            compiler_app.MAX_URDF_BYTES = original
