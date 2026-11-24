"""Publish a text or JSON result for this lesson's Attach notebook action."""
import json
import os
import tempfile
from pathlib import Path


def publish(value):
    """Replace the result offered to LearnHarness. Nothing is sent until attached."""
    target = os.environ.get("LEARNHARNESS_NOTEBOOK_RESULT")
    if not target:
        return  # A notebook remains runnable outside LearnHarness.
    text = value if isinstance(value, str) else json.dumps(
        value, ensure_ascii=False, indent=2, allow_nan=False
    )
    content = text.encode("utf-8")
    if len(content) > 16 * 1024:
        raise ValueError("Choose a result smaller than 16 KiB.")
    directory = Path(target).parent
    with tempfile.NamedTemporaryFile(dir=directory, delete=False) as temporary:
        try:
            temporary.write(content)
            temporary.close()
            os.replace(temporary.name, target)
        finally:
            Path(temporary.name).unlink(missing_ok=True)
