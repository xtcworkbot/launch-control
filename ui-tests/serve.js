// Minimal static server for previews: node serve.js <dir> [port]
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(process.argv[2] || "."), port = +(process.argv[3] || 8772);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!f.startsWith(root)) { r.writeHead(403); return r.end() } if (f.endsWith("/")) f += "index.html";
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end() } r.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); r.end(d) }) }).listen(port, "127.0.0.1", () => console.log("serving", root, "on", port));
