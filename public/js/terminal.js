let term = null;
let fallbackEl = null;
let logs = "";

export function initTerminal(el) {
  fallbackEl = el;

  try {
    if (window.Terminal) {
      term = new window.Terminal({
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        theme: { background: "#020617", foreground: "#e2e8f0" }
      });
      term.open(el);
      writeln("Ready.");
      writeln("1) Apply config");
      writeln("2) Choose ZIP → preview");
      writeln("3) Deploy");
      return;
    }
  } catch (e) {
    console.warn("xterm init failed:", e);
  }

  el.innerHTML = `<pre class="p-4 text-xs text-slate-200 whitespace-pre-wrap">[terminal fallback]
xterm not loaded — app tetap jalan.</pre>`;
}

export function write(s) {
  logs += s;
  if (term) term.write(s);
  else if (fallbackEl) {
    const pre = fallbackEl.querySelector("pre");
    if (pre) pre.textContent += s;
  }
}

export function writeln(s) {
  write(s + "\r\n");
}

export function clearLogs() {
  logs = "";
  if (term) term.reset();
  if (fallbackEl) {
    const pre = fallbackEl.querySelector("pre");
    if (pre) pre.textContent = "";
  }
  writeln("Terminal cleared.");
}

export function getLogsText() {
  return logs.replace(/\r/g, "");
}
