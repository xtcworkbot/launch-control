// Builds dist/ for Vercel (full HTML document) and dist/artifact.html for claude.ai (no skeleton).
// CSS and page scripts are inlined; engine.js stays a separate file because it runs as a Web Worker.
const fs = require("fs"), path = require("path");
const W = __dirname, out = path.join(W, "..", "dist");
fs.mkdirSync(out, { recursive: true });
const read = f => fs.readFileSync(path.join(W, f), "utf8");
const build = Date.now().toString(36);
let page = read("index.html")
  .replace('<link rel="stylesheet" href="app.css"><!--INLINE_CSS-->', () => "<style>\n" + read("app.css") + "\n</style>")
  .replace('<script src="lab.js"></script><!--INLINE_LAB-->', () => `<script>window.LC_BUILD="${build}";\n` + read("lab.js") + "\n</script>")
  .replace('<script src="app.js"></script><!--INLINE_APP-->', () => "<script>\n" + read("app.js") + "\n</script>")
  .replace('<script src="popups.js"></script><!--INLINE_POPUPS-->', () => "<script>\n" + read("popups.js") + "\n</script>")
  .replace('<script src="cases.js"></script><!--INLINE_CASES-->', () => "<script>\n" + read("cases.js") + "\n</script>");
if (/src="(lab|app|popups|cases)\.js"|href="app\.css"/.test(page)) throw new Error("inlining failed");
fs.writeFileSync(path.join(out, "artifact.html"), page);
const icon = (page.match(/<link rel="icon"[^>]*>/) || [""])[0];
fs.writeFileSync(path.join(out, "index.html"), '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="robots" content="noindex">\n' + icon + '\n</head>\n<body>\n' + page.replace(icon, "") + "\n</body>\n</html>\n");
fs.copyFileSync(path.join(W, "engine.js"), path.join(out, "engine.js"));
console.log("built dist/ (" + Math.round(page.length / 1024) + " KB page)");
