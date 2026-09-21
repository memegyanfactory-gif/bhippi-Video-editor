import sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src-tauri/workers'))
from depth_media import occlusion_alpha

def test_near_objects_occlude_far_objects_do_not():
    depth = np.array([1., 3., 5., 7., 9.], dtype=np.float32)
    alpha = occlusion_alpha(depth, .5, .2, 1, 9)
    np.testing.assert_allclose(alpha, [1, 1, .5, 0, 0], atol=1e-6)

def test_same_depth_keeps_same_alpha_across_frames():
    a = occlusion_alpha(np.array([2., 5.]), .5, .1, 1, 9)
    b = occlusion_alpha(np.array([5., 8.]), .5, .1, 1, 9)
    assert a[1] == b[0]

def test_hard_plane():
    np.testing.assert_array_equal(occlusion_alpha(np.array([1., 9.]), .5, 0, 1, 9), [1, 0])
