import json, os, sys

LOG = os.environ.get("PROBE_LOG", "/dev/null")


def send(o):
    sys.stdout.write(json.dumps(o) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    try:
        m = json.loads(line)
    except Exception:
        continue
    mid, meth = m.get("id"), m.get("method")
    with open(LOG, "a") as f:
        f.write(json.dumps({"pid": os.getpid(), "ppid": os.getppid(), "msg": m}) + "\n")
    if meth == "initialize":
        send({"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": m["params"].get("protocolVersion", "2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "probe", "version": "1"}}})
    elif meth == "tools/list":
        send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [{
            "name": "ping",
            "description": "Answers pong with the caller's label.",
            "inputSchema": {"type": "object", "properties": {"label": {"type": "string"}}, "required": ["label"]}}]}})
    elif meth == "tools/call":
        label = m["params"].get("arguments", {}).get("label", "")
        send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": "pong " + label}]}})
    elif mid is not None:
        send({"jsonrpc": "2.0", "id": mid, "result": {}})
