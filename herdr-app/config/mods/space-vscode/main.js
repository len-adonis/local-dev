// Top bar button: bring up this space's VS Code window.
// `code <folder>` focuses the window that already has the folder open, and
// opens one only if none does, so VS Code itself keeps the link. No state saved.
import { View, div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, theme, exec, notify, home } from "herdr";

export default class SpaceVSCode extends View {
  open(cx) {
    const space = spaces().find((s) => s.active);
    if (!space) return;
    cx.spawn(async () => {
      // The space's repo root, so a worktree space opens its whole checkout.
      const git = await exec("git", ["-C", space.folder || ".", "rev-parse", "--show-toplevel"]);
      const dir = git.code === 0 ? git.stdout.trim() : space.folder;
      if (!dir || dir === home()) {
        notify({ title: "No project folder", body: `“${space.name}” is in your home folder, so there is no project to open.`, level: "warning" });
        return;
      }
      const r = await exec("code", [dir]);
      if (r.code !== 0) notify({ title: "Could not open VS Code", body: r.stderr.trim(), level: "error" });
    });
  }

  render() {
    const t = theme();
    return h_flex().size_full().items_center().justify_center().bg(t.chrome)
      .child(
        h_flex().id("space-vscode").gap(6).items_center().px(10).py(4).rounded(6).text_size(12).text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.open(cx))
          .child(image("mods/space-vscode/vscode.png").size(14))
          .child("VS Code"),
      );
  }
}
