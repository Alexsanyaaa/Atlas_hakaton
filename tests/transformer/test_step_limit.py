import pytest

from catalog_ai.training.demo import optimizer_step_limit


@pytest.mark.parametrize('windows,batch,accum,epochs,cap,expected', [
    (157718, 8, 3, 3, 100000, 19716),
    (48000, 12, 2, 3, 1200, 1200),
    (25, 8, 3, 3, 100000, 6),
    (24, 8, 3, 3, 100000, 3),
    (1, 8, 3, 3, 100000, 3),
])
def test_step_limit_counts_partial_batches_and_accumulation(windows, batch, accum, epochs, cap, expected):
    config = {'batch_size': batch, 'gradient_accumulation': accum, 'epochs': epochs, 'max_steps': cap}
    assert optimizer_step_limit(config, windows) == expected
