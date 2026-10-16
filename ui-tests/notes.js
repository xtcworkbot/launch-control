// End-to-end checks for the Notes widget: write, save, tag, persist, edit, delete, search, N key, other tabs, archive,
// export / import, drag, and fit on laptop and phone screens.   node ui-tests/notes.js [baseUrl]
const puppeteer = require("puppeteer-core"), fs = require("fs"), os = require("os"), path = require("path");
const B = process.argv[2] || "http://127.0.0.1:8772/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, info = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (info !== "" ? `  [${info}]` : "")); ok ? pass++ : fail++ };
(async () => {
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), "lc-notes-"));
  const b = await puppeteer.launch({ executablePath: require("./chrome"), headless: "new" });
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  const errors = []; const watch = pg => { pg.on("pageerror", e => errors.push(String(e))); pg.on("console", m => { if (m.type() === "error" && !/404/.test(m.text())) errors.push(m.text()) }) }; watch(p);
  await (await p.target().createCDPSession()).send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl });
  await p.goto(B + "?e=1", { waitUntil: "networkidle2" }); await sleep(1000);
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: "networkidle2" }); await sleep(1200);
  const panel = () => p.evaluate(() => { const e = $("notes"); return !!e && !e.hidden });
  const notes = pg => (pg || p).evaluate(() => JSON.parse(localStorage.getItem("lc-notes") || "[]"));
  const write = async (txt, pg = p) => { await pg.focus("#nt-text"); await pg.keyboard.type(txt); await pg.keyboard.down("Control"); await pg.keyboard.press("Enter"); await pg.keyboard.up("Control"); await sleep(250) };

  // open from the status bar; it doesn't block the page behind it
  await p.evaluate(() => show("activity")); await sleep(200);
  await p.evaluate(() => $("st-notes").click()); await sleep(200);
  check("Status bar Notes opens the panel", await panel());
  check("The panel isn't a modal: the page behind still takes clicks", await p.evaluate(() => { const b = [...document.querySelectorAll(".nav a")].find(a => a.dataset.r === "dashboard"); const r = b.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !document.querySelector(".palette") && (t === b || b.contains(t)) }));
  await write("First note: watching the Activity page");
  const n1 = await notes();
  check("Ctrl+Enter saves the note, tagged with the page", n1.length === 1 && n1[0].text === "First note: watching the Activity page" && n1[0].page === "Activity", JSON.stringify(n1[0] || {}).slice(0, 120));
  check("Status bar shows the count", await p.evaluate(() => /Notes\s*1/.test($("st-notes").textContent)));

  // typing is kept through a reload, and saved notes stay
  await p.type("#nt-text", "half-written thought"); await sleep(150);
  await p.reload({ waitUntil: "networkidle2" }); await sleep(1200);
  await p.evaluate(() => openNotes()); await sleep(200);
  check("Unsaved typing survives a reload", await p.evaluate(() => $("nt-text").value === "half-written thought"));
  check("Saved notes survive a reload", (await notes()).length === 1 && await p.evaluate(() => document.querySelectorAll(".nt-card").length === 1));
  await p.evaluate(() => { $("nt-text").value = ""; lsSet("lc-notes-draft", "") });

  // N toggles it (but not while typing in a field)
  await p.evaluate(() => { document.activeElement.blur(); $("notes").hidden = true }); await p.keyboard.press("n"); await sleep(150);
  check("Pressing N opens the notes", await panel());
  await p.focus("#nt-text"); await p.keyboard.press("n"); await sleep(100);
  check("…and typing the letter n in a note doesn't close it", await panel() && await p.evaluate(() => $("nt-text").value === "n"));
  await p.evaluate(() => { $("nt-text").value = "" }); await p.keyboard.press("Escape"); await sleep(100);
  check("Escape closes the notes", !(await panel()));

  // in a live launch: tagged with the coin and sim time; "This launch" filter
  await p.evaluate(async () => { await quickStart(); lSpeed(0); await lStep(42) }); await sleep(900);
  await p.evaluate(() => openNotes()); await sleep(200);
  check("Composer shows what the note will be tagged with", await p.evaluate(() => /\$SHARDS · 0:4\d sim · Workspace/.test($("nt-where").textContent)), await p.evaluate(() => $("nt-where").textContent));
  await write("Front MEV sold into the first buyers here");
  const n2 = (await notes())[0];
  check("A note in a live launch carries the coin, sim time and run", n2.ticker === "SHARDS" && n2.sim_t >= 40 && n2.sim_t < 50 && /^R/.test(n2.run || ""), JSON.stringify(n2).slice(0, 140));
  await p.evaluate(() => document.querySelector('[data-nf="this"]').click()); await sleep(100);
  check("'This launch' shows only this launch's notes", await p.evaluate(() => document.querySelectorAll(".nt-card").length === 1 && /Front MEV/.test(document.querySelector(".nt-card").textContent)));
  await p.evaluate(() => document.querySelector('[data-nf="all"]').click()); await sleep(100);
  check("'All' shows every note", await p.evaluate(() => document.querySelectorAll(".nt-card").length === 2));
  await p.type("#nt-q", "activity"); await sleep(150);
  check("Search filters the notes", await p.evaluate(() => document.querySelectorAll(".nt-card").length === 1 && /Activity/.test(document.querySelector(".nt-card").textContent)));
  await p.evaluate(() => { const q = $("nt-q"); q.value = ""; q.dispatchEvent(new Event("input")) }); await sleep(100);

  // edit and delete
  await p.evaluate(() => document.querySelector('.nt-card [data-nt="edit"]').click()); await sleep(100);
  await p.evaluate(() => { const t = document.querySelector(".nt-card.ed textarea"); t.value = "Front MEV sold into the first buyers (edited)" }); await p.evaluate(() => document.querySelector('[data-nt="esave"]').click()); await sleep(150);
  check("Edit saves the new text and marks it edited", (await notes())[0].text.endsWith("(edited)") && !!(await notes())[0].edited);
  await p.evaluate(() => document.querySelectorAll('.nt-card [data-nt="del"]')[1].click()); await sleep(100);
  check("Delete asks once more before deleting", (await notes()).length === 2 && await p.evaluate(() => /Delete\?/.test(document.querySelectorAll(".nt-card")[1].textContent)));
  await p.evaluate(() => document.querySelectorAll('.nt-card [data-nt="del"]')[1].click()); await sleep(150);
  check("Second click deletes it", (await notes()).length === 1);

  // another tab of the app sees new notes at once
  const p2 = await b.newPage(); watch(p2); await p2.setViewport({ width: 1280, height: 800 }); await p2.goto(B + "?e=1", { waitUntil: "networkidle2" }); await sleep(1200);
  await p2.evaluate(() => openNotes()); await sleep(200);
  await p.evaluate(() => { $("nt-text").value = "" }); await write("Written in tab one");
  await sleep(300);
  check("Another open tab shows the new note without reloading", await p2.evaluate(() => [...document.querySelectorAll(".nt-card")].some(c => /Written in tab one/.test(c.textContent))));
  check("…and its count updates", await p2.evaluate(() => /Notes\s*2/.test($("st-notes").textContent)));
  await p2.close();

  // archiving the run keeps its notes on its Archived page
  await p.evaluate(() => archiveLive()); await sleep(200);
  await p.evaluate(() => { AVIEW = ARCH[0].id; show("archived") }); await sleep(800);
  check("The archived run shows its notes", await p.evaluate(() => /Your notes on this run/.test($("archived-page").textContent) && /Front MEV sold/.test($("archived-page").textContent)));
  check("…and the archive entry keeps a copy (for Export)", await p.evaluate(() => (ARCH[0].notes || []).length === 2));

  // export to a file, import it elsewhere
  await p.evaluate(() => openNotes(true)); await sleep(150);
  await p.evaluate(() => document.querySelector('[data-nt="export"]').click()); await sleep(1200);
  const files = fs.readdirSync(dl).filter(f => /^launch-control-notes-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const exp = files.length ? JSON.parse(fs.readFileSync(path.join(dl, files[0]), "utf8")) : null;
  check("Export downloads a notes file", exp && exp.kind === "notes" && exp.notes.length === 2, files.join(","));
  await p.evaluate(() => { NOTES = []; saveNotes(); renderNotes() });
  const inp = await p.$("#nt-file"); await inp.uploadFile(path.join(dl, files[0])); await sleep(500);
  check("Import adds the notes from the file", (await notes()).length === 2);
  await inp.uploadFile(path.join(dl, files[0])); await sleep(500);
  check("Importing the same file again adds no duplicates", (await notes()).length === 2);
  await p.evaluate(() => importNotes("not json")); await sleep(100);
  check("A wrong file is refused with a message", (await notes()).length === 2 && await p.evaluate(() => /isn't a notes export/.test($("toast").textContent)));

  // drag and remembered position; fits on laptop and phone screens
  const h = await p.$("#notes .nt-h b"), hb = await h.boundingBox();
  await p.mouse.move(hb.x + 5, hb.y + 5); await p.mouse.down(); await p.mouse.move(400, 200, { steps: 6 }); await p.mouse.up(); await sleep(150);
  const moved = await p.evaluate(() => { const r = $("notes").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)] });
  check("Dragging the header moves the panel", moved[0] < 500 && moved[1] < 300, moved.join(","));
  await p.reload({ waitUntil: "networkidle2" }); await sleep(1200); await p.evaluate(() => openNotes()); await sleep(200);
  check("…and it reopens where you left it", await p.evaluate(m => { const r = $("notes").getBoundingClientRect(); return Math.abs(r.left - m[0]) < 3 && Math.abs(r.top - m[1]) < 3 }, moved));
  for (const [w, hh] of [[1280, 720], [390, 844]]) {
    await p.setViewport({ width: w, height: hh }); await p.evaluate(() => { localStorage.removeItem("lc-notes-pos"); $("notes").remove(); openNotes() }); await sleep(250);
    const r = await p.evaluate(() => { const e = $("notes"), b = e.getBoundingClientRect(), ctl = [...e.querySelectorAll("button, textarea, input:not([type=file])")].filter(x => x.offsetParent);
      const hidden = ctl.filter(x => { const q = x.getBoundingClientRect(), t = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !t || !(t === x || x.contains(t)) }).map(x => x.getAttribute("aria-label") || x.textContent.trim() || x.id);
      return { inside: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight - 36, hidden } });
    check(`Fits the screen with every control reachable at ${w}x${hh}`, r.inside && !r.hidden.length, r.hidden.join(" | "));
  }
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
