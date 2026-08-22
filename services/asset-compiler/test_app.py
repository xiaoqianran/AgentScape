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
