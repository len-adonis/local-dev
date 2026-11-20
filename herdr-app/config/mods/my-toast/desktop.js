// desktop.js: sends Herdr's agent alerts to macOS as well, for my-toast.
// my-toast is Herdr's shipped `toast` mod plus one hook that calls toDesktop()
// (make-my-toast.sh builds it). The layout chooses it with "toast": "my-toast".
// - An agent alert ("done" or "needs you": its action is agent.focus) that arrives
//   while Herdr is not the front app also goes to macOS through terminal-notifier.
//   Clicking it brings Herdr forward and runs the same agent.focus. One group per
//   agent, so a newer alert replaces the older one.
// - Every notification still shows as the normal in-app card.
// Needs: brew install terminal-notifier, with notifications allowed for it.
import { exec, window, checking, home } from "herdr";

const NOTIFIER = "/opt/homebrew/bin/terminal-notifier";
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function toDesktop(p) {
  if (checking()) return;
  const terminal = p?.action?.args?.terminal;
  if (p?.action?.name !== "agent.focus" || typeof terminal !== "string") return;
  if (window().active) return; // the in-app card is enough
  const onClick = `${home()}/.local/bin/herdr-app do agent.focus ${quote(JSON.stringify({ terminal }))}`;
  exec(NOTIFIER, [
    "-title", p.title || "Herdr",
    "-message", p.body || " ",
    "-group", `herdr-${terminal}`,
    "-activate", "dev.herdr.app",
    "-execute", onClick,
  ]).catch(() => {});
}
