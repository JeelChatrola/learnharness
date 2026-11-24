# Marimo Notebook for LearnHarness

Open **Notebook** in the toolbar of a teaching or practice session. The notebook opens beside the lesson, or below it in a narrow window. Hide it or toggle **Notebook** to give the lesson the whole window. Each session gets its own editable Python notebook. Run the starter cells with marimo’s **Run all stale cells** command (Ctrl+Shift+R on Linux). Move the slider to see Python recalculate the square.

Select **Attach notebook** and use the lesson composer alongside it. Add a question if you like and press the lesson’s normal **Send** button. The tutor receives the saved Python and the most recently published result. Save edits in marimo before attaching. The attachment is a snapshot. Reopen **Notebook** to remove it or to take a fresh snapshot. Reloading the app clears an unsent attachment.

## Work with the tutor in the live notebook

Open **Notebook** to connect a marimo kernel and ask the tutor to work in it using the lesson composer. For example, “Add a cell that cubes the slider value, run it, and tell me the result.” The new cell appears in the notebook as you chat.

The tutor can list cells, read a cell’s code and output, add a cell, edit one, and run it. When replacing code it uses the revision it read, so a subsequent learner edit requires a fresh read. Code runs in the same local Python kernel as the editor. Each tutor turn targets its own lesson. If the editor has timed out, reopen **Notebook** to reconnect.

**Attach notebook** still sends a fixed snapshot with the next message. A tutor can work with the live notebook without an attachment.

## Share a result from a cell

```python
from learnharness_notebook import publish

publish({"input": x.value, "square": x.value ** 2})
```

Pass text or a JSON-compatible Python value. A reactive cell can call this whenever a slider, dropdown or other input changes. The most recent call replaces the lesson’s published result. **Attach notebook** picks it up on demand. The learner controls when to send it. Source can be up to 48 KiB and the result up to 16 KiB. For a plot or table, publish the values or summary you want to discuss. The live widget stays in the notebook.

## Install

1. Use LearnHarness 0.7.0 or later with plugin API v1. In **Settings → Community plugins**, copy the plugin directory path for the profile you want to use.
2. Extract the plugin zip there. The package should be at `marimo-notebook/dist/manifest.json`.
3. Click **Refresh** and enable **Marimo Notebook**. When upgrading an already loaded copy, replace only `dist/` and restart LearnHarness.

The plugin starts a token-authenticated marimo editor on loopback. It uses the `marimo` executable on the app’s PATH, or `uv tool run` with marimo 0.25.2 when only uv is available. The first uv launch may download the runtime. To select a Python environment with your own packages, set `LEARNHARNESS_MARIMO` to the absolute path of its marimo executable before starting LearnHarness. The integration was tested on Linux with marimo 0.25.2.

## Files and lifetime

The working notebook is `marimo-notebook/data/notebooks/<session-id>/lesson.py`. Normal edits and the last published value stay in that session’s directory. To use an existing marimo notebook, close LearnHarness, back up the session’s `lesson.py`, and copy your notebook there under that name. Keep any local assets or modules it needs alongside it. The installed app and its knowledge graph need no changes.

Hiding the notebook keeps the local editor available briefly. After five minutes without an editor connection, marimo shuts down. Saved files survive that shutdown. Disabling the plugin stops its active editors. Notebook cells run with your local Python permissions.
