// Finds an installed Chrome for puppeteer-core. Override with CHROME=/path/to/chrome.
const fs = require("fs");
const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  (process.env.LOCALAPPDATA || "") + "\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
];
const found = process.env.CHROME || CANDIDATES.find(p => p && fs.existsSync(p));
if (!found) throw new Error("Google Chrome not found. Install it, or set CHROME=/path/to/chrome.");
module.exports = found;
