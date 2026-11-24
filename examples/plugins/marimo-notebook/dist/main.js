function canAttach(target) {
  return target.type === "text" || target.type === "thinking" || target.channels.includes("thinking");
}

export function activate(ctx) {
  const queued = new Map();
  const pages = new Map();
  let panel;

  function refresh() {
    ctx.refreshActions();
    ctx.refreshSubmissions();
  }

  function open(context) {
    if (context.surface !== "session") return;
    const { sessionId } = context;
    if (panel?.sessionId === sessionId && panel.root.isConnected) {
      panel.close();
      return;
    }
    panel?.close();
    const pathname = ctx.app.pathname();
    pages.set(pathname, sessionId);
    // API v1 only supplies covering surfaces. Dock alongside the actual session
    // body, outside the transcript that React reconciles on each streamed turn.
    const region = [...document.querySelectorAll("[data-session-surface] [data-session-surface-region]")]
      .find(node => node.getClientRects().length);
    const body = region?.parentElement;
    const column = body?.parentElement;
    if (!column || !column.querySelector(":scope > header")) {
      throw new Error("Could not locate the lesson column for this LearnHarness layout.");
    }
    const root = document.createElement("aside");
    root.className = "lh-marimo-panel";
    root.setAttribute("aria-label", "Lesson notebook");
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const layout = new ResizeObserver(() => {
      if (!root.isConnected || ctx.app.pathname() !== pathname) close();
    });
    function close() {
      if (signal.aborted) return;
      lifetime.abort();
      layout.disconnect();
      root.remove();
      body.classList.remove("lh-marimo-lesson");
      column.classList.remove("lh-marimo-columns");
      panel = undefined;
    }
    panel = { sessionId, root, close, accepted() {
      updateShare();
      status.textContent = "Notebook sent.";
    } };
    window.navigation?.addEventListener("currententrychange", () => {
      if (ctx.app.pathname() !== pathname) close();
    }, { signal });
    column.classList.add("lh-marimo-columns");
    body.classList.add("lh-marimo-lesson");
    column.append(root);
    layout.observe(column);
    const bar = document.createElement("div");
    bar.className = "lh-marimo-bar";
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    const share = document.createElement("button");
    const back = document.createElement("button");
    back.textContent = "Hide";
    back.title = "Hide notebook";
    back.onclick = close;
    share.disabled = true;
    const frame = document.createElement("iframe");
    frame.title = "Interactive marimo notebook";
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-downloads allow-forms allow-popups");
    frame.allowFullscreen = true;
    bar.append(status, share, back);
    root.append(bar, frame);

    function updateShare() {
      share.textContent = queued.has(sessionId) ? "Remove attachment" : "Attach notebook";
      share.title = "Attach the saved Python source and last published result to your next lesson message.";
    }
    updateShare();
    status.textContent = "Starting marimo…";
    share.onclick = async () => {
      share.disabled = true;
      try {
        if (queued.has(sessionId)) {
          queued.delete(sessionId);
          status.textContent = "Attachment removed.";
        } else {
          const snapshot = await ctx.call("snapshot", { sessionId });
          if (signal.aborted) return;
          queued.set(sessionId, snapshot);
          status.textContent = "Notebook attached to your next lesson message.";
        }
        updateShare();
        refresh();
      } catch (error) {
        if (!signal.aborted) status.textContent = error.message;
      } finally {
        if (!signal.aborted) share.disabled = false;
      }
    };
    ctx.call("open", { sessionId }).then(({ port, path }) => {
      if (signal.aborted) return;
      // Same site for marimo's login cookie, separate origin for its editor.
      const host = location.hostname === "localhost" ? "localhost" : "127.0.0.1";
      frame.src = "http://" + host + ":" + port + path;
      status.textContent = queued.has(sessionId) ? "Notebook attached." : "Notebook";
      share.disabled = false;
    }).catch(error => {
      if (!signal.aborted) status.textContent = error.message;
    });
  }

  ctx.registerAction({
    id: "open",
    get name() {
      return queued.has(pages.get(ctx.app.pathname())) ? "Notebook (attached)" : "Notebook";
    },
    run: open,
  });
  ctx.placeAction({ id: "lesson-notebook", location: "top-bar", actionId: "open", sessions: ["teaching", "practice"] });
  ctx.registerSubmissionInterceptor({
    id: "attach-notebook",
    hasPendingInput(target) {
      // A notebook can accompany a structured answer, but cannot supply that answer.
      return (target.type === "text" || target.type === "thinking") && queued.has(target.sessionId);
    },
    intercept(input, target) {
      const captured = queued.get(target.sessionId);
      if (!captured || !canAttach(target)) return;
      const field = input.type === "text" || input.type === "thinking" ? "content" : "thinking";
      const part = input[field];
      // Indent the source as Markdown code, including notebooks containing backtick fences.
      const indent = text => text.split("\n").map(line => "    " + line).join("\n");
      const source = "Saved marimo notebook (Python)\n\n" + indent(captured.source);
      const result = captured.result == null ? "" : "Last published notebook result\n\n" + indent(captured.result);
      const attachment = [result, source].filter(Boolean).join("\n\n");
      target.onAccepted(() => {
        if (queued.get(target.sessionId) === captured && !ctx.signal.aborted) {
          queued.delete(target.sessionId);
          if (panel?.sessionId === target.sessionId) panel.accepted();
          refresh();
        }
      });
      return { ...input, [field]: { ...part, text: [part.text, attachment].filter(Boolean).join("\n\n") } };
    },
  });
  return () => { panel?.close(); queued.clear(); pages.clear(); };
}
