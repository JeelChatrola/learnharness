const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const version = "0.25.2";
const maxSharedBytes = 48 * 1024;

function launch(cwd, directory, args, pairEnv) {
  const env = {
    ...process.env, ...pairEnv, PYTHONUNBUFFERED: "1", NO_COLOR: "1", PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPATH: [directory, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    LEARNHARNESS_NOTEBOOK_RESULT: path.join(cwd, ".published-result.txt"),
  };
  const options = { cwd, env, stdio: [pairEnv ? "pipe" : "ignore", "pipe", "pipe"], windowsHide: true };
  function start(program, argv) {
    return new Promise((resolve, reject) => {
      const child = spawn(program, argv, { ...options, detached: process.platform !== "win32" });
      child.once("error", reject);
      child.once("spawn", () => resolve(child));
    });
  }
  if (process.env.LEARNHARNESS_MARIMO) return start(process.env.LEARNHARNESS_MARIMO, args);
  return start("marimo", args).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return start("uv", ["tool", "run", "--from", "marimo==" + version, "marimo", ...args]).catch(cause => {
      if (cause.code !== "ENOENT") throw cause;
      throw new Error("Install marimo or uv, or set LEARNHARNESS_MARIMO to the marimo executable.");
    });
  });
}

function stopProcess(child, force = false) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
    } else {
      process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    }
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

exports.activate = function activate(ctx) {
  const running = new Map();
  let disposed = false;
  function notebook(id) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error("Invalid lesson ID.");
    return path.join(ctx.dataDirectory, "notebooks", id, "lesson.py");
  }

  function open(id) {
    const file = notebook(id);
    if (disposed || ctx.signal.aborted) throw new Error("Notebook plugin disabled.");
    if (running.has(id)) return running.get(id).ready;
    const cwd = path.dirname(file);
    fs.mkdirSync(cwd, { recursive: true, mode: 0o700 });
    try {
      fs.copyFileSync(path.join(ctx.directory, "starter.py"), file, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    const base = "/lh-" + randomUUID();
    const state = {};
    running.set(id, state);
    state.ready = (async () => {
      const child = await launch(cwd, ctx.directory, ["edit", "--headless", "--host", "127.0.0.1", "--token",
        "--base-url", base, "--skip-update-check", "--timeout", "5", "lesson.py"]);
      state.child = child;
      if (disposed || ctx.signal.aborted) {
        stopProcess(child);
        throw new Error("Notebook plugin disabled.");
      }
      return new Promise((resolve, reject) => {
        let tail = "";
        const timeout = setTimeout(() => {
          stopProcess(child);
          reject(new Error("marimo did not start within 90 seconds. Check the marimo or uv installation."));
        }, 90_000);
        function read(chunk) {
          tail = (tail + chunk).slice(-8192);
          const match = tail.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/lh-[a-f0-9-]+)\?access_token=([a-zA-Z0-9_~.%-]+)(?=\s|\x1b)/);
          if (!match || match[2] !== base) return;
          clearTimeout(timeout);
          child.stdout.off("data", read);
          child.stderr.off("data", read);
          tail = "";
          resolve({ port: Number(match[1]), path: base + "/?access_token=" + match[3] });
        }
        child.stdout.setEncoding("utf8").on("data", read);
        child.stderr.setEncoding("utf8").on("data", read);
        child.once("exit", (code, signal) => {
          clearTimeout(timeout);
          if (running.get(id) === state) running.delete(id);
          reject(new Error("marimo exited during startup (" + (signal ?? code) + "). Check the installed runtime or uv network access."));
        });
      });
    })().catch(error => {
      if (running.get(id) === state) running.delete(id);
      throw error;
    });
    return state.ready;
  }

  ctx.handle("open", input => open(input?.sessionId));
  ctx.handle("snapshot", input => {
    const file = notebook(input?.sessionId);
    if (fs.statSync(file).size > maxSharedBytes) throw new Error("Notebook source exceeds the 48 KiB sharing limit.");
    const source = fs.readFileSync(file, "utf8");
    if (Buffer.byteLength(source) > maxSharedBytes) throw new Error("Notebook source exceeds the 48 KiB sharing limit.");
    const result = path.join(path.dirname(file), ".published-result.txt");
    try {
      if (fs.statSync(result).size > 16 * 1024) throw new Error("Published result exceeds 16 KiB.");
      return { source, result: fs.readFileSync(result, "utf8") };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { source, result: null };
    }
  });
  require("./tutor.cjs")(ctx, { running, notebook, launch, stopProcess });
  function onExit() {
    for (const { child } of running.values()) stopProcess(child, true);
  }
  process.once("exit", onExit);
  return () => {
    disposed = true;
    process.off("exit", onExit);
    for (const { child } of running.values()) {
      stopProcess(child);
      if (child) setTimeout(() => stopProcess(child, true), 2000).unref();
    }
    running.clear();
  };
};
