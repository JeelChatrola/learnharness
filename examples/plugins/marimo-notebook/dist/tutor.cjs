const path = require("node:path");

module.exports = function registerTutor(ctx, { running, notebook, launch, stopProcess }) {
  const agents = ["prober", "teacher", "practice"];
  ctx.registerInstructions({ agents, text: "Use the marimo tools when the learner wants to work in their lesson notebook. Read cells before editing, preserve learner work, and use a new cell for experiments. After running, read the cell again for its actual output or errors. If a call was interrupted, inspect the notebook before trying another edit or run." });

  async function pair(chatId, request, callSignal) {
    const state = running.get(chatId);
    if (!state) throw new Error("Open Notebook in this lesson to start its marimo editor, then return to the lesson.");
    const signal = AbortSignal.any([ctx.signal, callSignal, AbortSignal.timeout(60_000)].filter(Boolean));
    const { port, path: editorPath } = await state.ready;
    signal.throwIfAborted();
    const editor = new URL(editorPath, "http://127.0.0.1:" + port);
    const server = editor.origin + editor.pathname.replace(/\/$/, "");
    const token = editor.searchParams.get("access_token");
    const response = await fetch(server + "/api/sessions", {
      headers: { Authorization: "Bearer " + token }, redirect: "error", signal,
    });
    if (!response.ok) throw new Error("Could not read this lesson's marimo session (" + response.status + ").");
    const file = notebook(chatId), cwd = path.dirname(file);
    const sessions = Object.values(await response.json()).filter(s =>
      typeof s.path === "string" && path.resolve(cwd, s.path) === file);
    if (sessions.length !== 1 || !sessions[0].session_id) {
      throw new Error("Open lesson.py in a single editor for this lesson. Pairing requires marimo 0.25.2 with a live kernel.");
    }
    signal.throwIfAborted();
    const args = ["pair", "execute", "--url", server, "--session", sessions[0].session_id, "--code-file", "-"];
    const child = await launch(cwd, ctx.directory, args, { MARIMO_TOKEN: token });
    const encoded = Buffer.from(JSON.stringify(request)).toString("base64");
    const command = "await __import__('lesson_cells').perform('" + encoded + "')\n";
    const output = await new Promise((resolve, reject) => {
      const abort = () => {
        stopProcess(child, true);
        reject(new Error("Notebook call interrupted. Inspect the cell before retrying an edit or run."));
      };
      child.stdin.on("error", () => {}); // Exit handling reports an early close.
      let stdout = "", stderr = "";
      child.stdout.setEncoding("utf8").on("data", data => {
        stdout += data;
        if (stdout.length > 512_000) abort();
      });
      child.stderr.setEncoding("utf8").on("data", data => { stderr = (stderr + data).slice(-2000); });
      child.once("close", code => {
        signal.removeEventListener("abort", abort);
        let value;
        try { value = JSON.parse(stdout); } catch {}
        if (code !== 0 || !value?.success) {
          const detail = value?.stderr || value?.error || stderr || "Pairing command failed.";
          reject(new Error(String(detail).replaceAll(token, "[redacted]").slice(-2000)));
        } else resolve(value.stdout);
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else child.stdin.end(command);
    });
    const result = output.split("\n").findLast(line => line.startsWith("LH_CELL_RESULT "));
    if (!result) throw new Error("marimo did not confirm the operation. Inspect the cell before retrying.");
    return JSON.parse(result.slice("LH_CELL_RESULT ".length));
  }

  const cellId = { type: "string", minLength: 1, maxLength: 128 };
  ctx.registerTools({
    agents,
    create({ chatId }) {
      const tool = (action, name, label, description, properties, required) => ({
        name, label, description,
        parameters: { type: "object", properties, required, additionalProperties: false },
        executionMode: "sequential", replay: action === "read" ? "safe" : "never",
        async execute(_id, input, signal) {
          const result = await pair(chatId, { ...input, action }, signal);
          return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
        },
      });
      return [
        tool("read", "marimo_read_cells", "Read lesson notebook",
          "List live cell IDs and revisions, or read one cell's source, last output, console and errors.",
          { cell_id: cellId, offset: { type: "integer", minimum: 0 } }, []),
        tool("write", "marimo_write_cell", "Edit lesson notebook",
          "Create a cell or replace a specific cell using its last read revision. Set run to execute it.",
          { code: { type: "string", minLength: 1, maxLength: 24576 }, cell_id: cellId,
            revision: { type: "string", pattern: "^[a-f0-9]{64}$" }, run: { type: "boolean" } }, ["code"]),
        tool("run", "marimo_run_cell", "Run notebook cell",
          "Execute an existing cell by ID. Use marimo_read_cells afterward for actual results.",
          { cell_id: cellId }, ["cell_id"]),
      ];
    },
  });
};
