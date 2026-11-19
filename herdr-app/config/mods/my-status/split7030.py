# Set a tab's two-pane split to 70/30 in the herdr-app document (version-checked).
import json, subprocess, sys
tab, top, bottom = sys.argv[1:4]
def rpc(method, params):
    msg = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    out = subprocess.run(["hc", "connect"], input=msg + "\n", capture_output=True, text=True, timeout=10).stdout
    return json.loads(out.splitlines()[0])
for attempt in range(3):
    r = rpc("doc.get", {"name": "herdr-app"})["result"]
    doc, version = r["value"], r["version"]
    def walk(n):
        kids = n.get("children") or []
        ids = [k.get("id") for k in kids]
        if top in ids and bottom in ids:
            for k in kids:
                if k["id"] == top: k["size"] = {"weight": 0.7}
                if k["id"] == bottom: k["size"] = {"weight": 0.3}
            return n
        for k in kids:
            f = walk(k)
            if f: return f
    node = None
    for s in doc["spaces"]:
        for t in s["tabs"]:
            if t["id"] == tab: node = walk(t["root"])
    if not node: sys.exit("split not found")
    w = rpc("doc.set", {"name": "herdr-app", "value": doc, "version": version})
    if "result" in w: print("set", node.get("type"), [(k["id"][:8], k.get("size")) for k in node["children"]]); break
    print("retry:", w.get("error"))
