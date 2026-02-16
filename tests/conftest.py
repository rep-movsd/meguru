"""Shared test fixtures."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import pytest

import backend


@pytest.fixture(autouse=True)
def clear_window_cache():
    """Clear the window detection cache before each test to avoid cross-test pollution."""
    backend._window_detect_cache.clear()
