// Auto split: every new tab whose only pane is a terminal (a new tab, or the first
// tab of a new space) gets a shell below it, sized 70/30, and focus goes back to the top.
// Tabs that exist when the app starts are left alone. Split sizes can't be set with a
// command, so split7030.py edits the tab's weights in herdr-core's "herdr-app" document
// (version-checked doc.set, so it never writes over a newer change).
import { spaces, panes, exec, run, home } from "herdr";

const SCRIPT = `${home()}/.config/herdr-app/mods/my-status/split7030.py`;

export function startAutoSplit(cx) {
  const seen = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
  cx.timer.every(800, (cx) => {
    for (const s of spaces()) for (const t of s.tabs) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (s.machine || t.panes !== 1) continue; // this computer only; already split: leave it
      const p = panes().find((x) => x.tab === t.id);
      if (!p?.terminal) continue; // a mod tab (a board, a viewer) stays alone
      cx.spawn(async () => {
        const r = await exec("herdr-app", ["do", "pane.split", JSON.stringify({ direction: "down", pane: p.pane })]);
        if (r.code !== 0) return;
        const bottom = JSON.parse(r.stdout).pane;
        await exec("python3", [SCRIPT, t.id, p.pane, bottom]);
        run("pane.focus", { pane: p.pane });
      });
    }
  });
}
