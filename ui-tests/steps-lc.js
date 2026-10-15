// Launch Control walkthrough: live workspace, tools rail, create flow, wallets, lab.
const B = "http://127.0.0.1:8772/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = async (page, snap, w) => {
  await page.goto(B + "?n=1#demo", { waitUntil: "networkidle2" }); await sleep(7000); await snap("live");
  await page.evaluate(() => { BTAB = "detector"; renderBottom(true) }); await sleep(400); await snap("live-detector");
  await page.goto(B + "?n=2#demo-tools", { waitUntil: "networkidle2" }); await sleep(6000); await snap("tools");
  await page.evaluate(() => { localStorage.setItem("lc-route", "create") }); await page.goto(B + "?n=3#create", { waitUntil: "networkidle2" }); await sleep(1500);
  for (let i = 0; i < 4; i++) { await snap("create" + i); const ok = await page.evaluate(() => { const b = [...document.querySelectorAll("#step .cr-actions .btn")].find(x => /^(Configure Token|Create)$/.test(x.textContent.trim())); if (b) { b.click(); return true } return false }); if (!ok) break; await sleep(700) }
  await page.evaluate(() => { W_ADVOPEN = true; W_STEP = 2; wRender() }); await sleep(600); await snap("create2-adv");
  await page.evaluate(() => { W_STEP = 3; wRender() }); await sleep(600); await page.evaluate(() => { PRE.funder = preTotal() + 0.01; wDistribute() }); await sleep(2800); await snap("prelaunch-ready");
  await page.evaluate(() => wConfirmLaunch()); await sleep(300); await snap("launch-confirm");
  await page.goto(B + "?n=7#demo", { waitUntil: "networkidle2" }); await sleep(6000); await page.evaluate(() => openWithdraw()); await sleep(200);
  await page.evaluate(() => { const c = document.querySelector("#wd-dust"); c.checked = true; c.dispatchEvent(new Event("change")) }); await snap("withdraw-dialog");
  await page.evaluate(() => { document.querySelector(".modal").remove(); nukeArm() }); await sleep(200); await snap("nuke-dialog");
  await page.evaluate(() => { document.querySelector(".modal").remove(); BTAB = "trades"; renderBottom(true) }); await sleep(300); await snap("live-trades");
  await page.goto(B + "?n=4#wallets", { waitUntil: "networkidle2" }); await sleep(1200); await snap("wallets-empty");
  await page.goto(B + "?n=6#demo", { waitUntil: "networkidle2" }); await sleep(6000); await page.evaluate(() => show("wallets")); await sleep(500); await snap("wallets-live");
  await page.evaluate(() => show("activity")); await sleep(500); await snap("activity");
  await page.evaluate(() => { archiveLive(); endLive(); show("dashboard") }); await sleep(700); await snap("dashboard");
  await page.evaluate(() => { const li = document.querySelector("#launch-list [data-draft]"); if (li) li.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 110, clientY: 130 })) }); await sleep(300); await snap("draft-menu");
  await page.evaluate(() => { document.querySelectorAll(".ctx-menu").forEach(x => x.remove()); openVolumeBot(true); document.querySelector(".pop [data-adv]").click() }); await sleep(500); await snap("volume-bot-plan");
  await page.evaluate(() => document.querySelectorAll(".pop").forEach(x => x.remove()));
  await page.goto(B + "?n=8#import", { waitUntil: "networkidle2" }); await sleep(1000);
  await page.$eval("#impname", e => e.value = "Synthetic sweep");
  await (await page.$("#ftrades")).uploadFile(__dirname + "/fixtures/synthetic_trades.csv");
  await (await page.$("#ftransfers")).uploadFile(__dirname + "/fixtures/synthetic_transfers.csv");
  await page.evaluate(() => doImport()); await sleep(1500); await snap("import-signals");
  await page.goto(B + "?n=5#config", { waitUntil: "networkidle2" }); await sleep(1200); await page.evaluate(() => loadCfg("Blank (everything off)")); await sleep(500); await snap("lab-config");
};
