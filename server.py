"""Proxima configuration lab: python3 server.py, then open http://127.0.0.1:8770
Localhost only. Pure simulation: no wallets, keys, RPC or chain access.
"""
import json
import pathlib
import socketserver
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import config
import lab
import runner

HERE = pathlib.Path(__file__).parent
PORT = 8770


def diff(cfgs):
    keys = [k for k in config.FIELDS if k not in ("name", "seed") and len({json.dumps(c.get(k)) for c in cfgs}) > 1]
    return [[k, config.FIELDS[k][0]] + [c.get(k) for c in cfgs] for k in keys]


ROUTES = {
    "schema": lambda p: {"schema": config.SCHEMA, "defaults": config.defaults()},
    "configs": lambda p: {"configs": lab.list_configs()},
    "config": lambda p: {"config": lab.get_config(p["name"])},
    "save": lambda p: {"config": lab.save_config(p["config"])},
    "delete": lambda p: lab.delete_config(p["name"]) or {"ok": True},
    "run": lambda p: runner.run(p["config"] if "config" in p else lab.get_config(p["name"])),
    "compare": lambda p: (lambda cfgs: {"runs": [runner.run(c, light=True) for c in cfgs], "diff": diff(cfgs)})(
        [lab.get_config(n) if isinstance(n, str) else config.normalise(n) for n in p["items"]]),
    "imports": lambda p: {"imports": lab.list_imports()},
    "import": lambda p: lab.save_import(p.get("name", ""), p["trades_csv"], p.get("holders_csv", "")),
    "import_get": lambda p: (lambda r: {k: v for k, v in r.items() if k != "trades"})(lab.get_import(p["name"])),
    "match": lambda p: lab.match(p["name"], extra=int(p.get("extra", 40)), names=p.get("names") or None),
}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body, default=float).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            return self._send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
        self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            p = json.loads(self.rfile.read(n) or b"{}")
            fn = ROUTES.get(self.path.removeprefix("/api/"))
            if not fn:
                return self._send(404, {"error": "unknown endpoint"})
            self._send(200, fn(p))
        except (ValueError, KeyError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:   # surface bugs to the page instead of hanging
            traceback.print_exc()
            self._send(500, {"error": f"{type(e).__name__}: {e}"})


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self):   # skip HTTPServer's reverse-DNS lookup, which can hang offline
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = "127.0.0.1", PORT


if __name__ == "__main__":
    print(f"Proxima config lab at http://127.0.0.1:{PORT}  (Ctrl+C to stop)", flush=True)
    Server(("127.0.0.1", PORT), H).serve_forever()
