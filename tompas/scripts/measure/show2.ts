// 2차 변수를 스프레드 그림 위에 그려 눈으로 대조한다.
//   node measure/show2.ts <pdf> <출력 폴더> [--sample]
// 맨 위: 강조색과 본문 글자색 견본. 스프레드마다: 정렬선(빨강 세로선), 사진 자리(파랑 상자), 톤·균형·밀도,
// 근접성(L4): 요소(초록 테), 이웃 사이에 어중간하게 낀 요소(주황 면)와 양쪽 이웃까지의 간격(주황 선),
// 가로 정렬: 아무것과도 윗선·아랫선을 함께 쓰지 않는 큰 요소(보라 굵은 테)
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { read } from "./read.ts";
import { furniture, measure } from "./vars.ts";
import { look } from "./look.ts";
import { axes, measure2, spreads } from "./spread.ts";
import { elements, sides } from "./near.ts";
import { rows } from "./rows.ts";

const [file, outDir, flag] = process.argv.slice(2);
const doc = await read(file);
const body = measure(doc).vars["body.size"];
const looks = await look(file, doc);
const v = measure2(doc, looks, body);
const furn = furniture(doc.pages);
const all = spreads(doc), list = flag === "--sample" && all.length > 24 ? [...Array(24).keys()].map(i => all[Math.floor((i + 0.5) * all.length / 24)]) : all;

const task = getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 });
const pdf = await task.promise;
const COLS = 4, W = 480, GAP = 30, HEAD = 70;
const name = path.basename(file, ".pdf");
fs.mkdirSync(outDir, { recursive: true });

for (let s0 = 0, n = 1; s0 < list.length; s0 += 24, n++) {
  const tiles = [];
  for (const s of list.slice(s0, s0 + 24)) {
    const tw = s.reduce((a, p) => a + p.w, 0), k = W / tw, th = s[0].h * k;
    const c = createCanvas(W, Math.round(th)), ctx = c.getContext("2d"), near = [0, 0];
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, th);
    let off = 0;
    for (const p of s) {
      // 쪽마다 따로 그려 붙인다(스프레드로 저장된 PDF는 원본 쪽의 절반을 잘라 쓴다)
      const page = await pdf.getPage(p.src);
      const one = createCanvas(Math.max(1, Math.round(p.w * k)), Math.round(th)), octx = one.getContext("2d");
      octx.fillStyle = "#fff"; octx.fillRect(0, 0, one.width, one.height);
      await page.render({ canvasContext: octx as any, canvas: one as any, viewport: page.getViewport({ scale: k, offsetX: -p.dx * k }) }).promise;
      ctx.drawImage(one, off * k, 0);
      ctx.strokeStyle = "rgba(0,90,255,.9)"; ctx.lineWidth = 2;
      for (const b of p.images) ctx.strokeRect((off + b.x0) * k, b.y0 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
      const content = p.lines.filter(l => !furn.has(l));
      ctx.strokeStyle = "rgba(0,160,60,.7)"; ctx.lineWidth = 1;
      for (const e of elements(p, content)) ctx.strokeRect((off + e.x0) * k, e.y0 * k, (e.x1 - e.x0) * k, (e.y1 - e.y0) * k);
      const cs = sides(p, content);
      near[0] += cs.filter(c => c.ratio < 1.5).length; near[1] += cs.length;
      for (const c of cs.filter(c => c.ratio < 1.5)) {
        const e = c.el, cx = (off + (e.x0 + e.x1) / 2) * k, cy = ((e.y0 + e.y1) / 2) * k;
        ctx.fillStyle = "rgba(255,120,0,.35)"; ctx.fillRect((off + e.x0) * k, e.y0 * k, (e.x1 - e.x0) * k, (e.y1 - e.y0) * k);
        ctx.strokeStyle = "rgba(255,110,0,.95)"; ctx.lineWidth = 2; ctx.beginPath();
        if (c.axis === "세로") { ctx.moveTo(cx, c.a.y1 * k); ctx.lineTo(cx, e.y0 * k); ctx.moveTo(cx, e.y1 * k); ctx.lineTo(cx, c.b.y0 * k); }
        else { ctx.moveTo((off + c.a.x1) * k, cy); ctx.lineTo((off + e.x0) * k, cy); ctx.moveTo((off + e.x1) * k, cy); ctx.lineTo((off + c.b.x0) * k, cy); }
        ctx.stroke();
      }
      off += p.w;
    }
    const r = rows(s, p => p.lines.filter(l => !furn.has(l)), body);
    ctx.strokeStyle = "rgba(150,0,220,.95)"; ctx.lineWidth = 4;
    for (const { e, page } of r.alone) { const o = s.slice(0, s.indexOf(page)).reduce((a, q) => a + q.w, 0); ctx.strokeRect((o + e.x0) * k, e.y0 * k, (e.x1 - e.x0) * k, (e.y1 - e.y0) * k); }
    ctx.strokeStyle = "rgba(230,0,0,.8)"; ctx.lineWidth = 1.5;
    for (const x of axes(s, body, p => p.lines.filter(l => !furn.has(l)))) { ctx.beginPath(); ctx.moveTo(x * k, 0); ctx.lineTo(x * k, th); ctx.stroke(); }
    const lk = s.map(p => looks.get(p)!), wt = s.length === 2 ? [lk[0].weight[0] + lk[0].weight[1], lk[1].weight[0] + lk[1].weight[1]] : lk[0].weight;
    const dark = lk.filter(l => l.bg < 50).length / lk.length;
    const dens = Math.round(s.reduce((a, p) => a + p.lines.filter(l => !furn.has(l)).reduce((b, l) => b + l.text.replace(/\s/g, "").length, 0), 0) / (tw * s[0].h * (25.4 / 72) ** 2 / 10000));
    const tone = dark === 0 ? "L" : dark === 1 ? "D" : "M", balance = (Math.abs(wt[1] - wt[0]) / (wt[0] + wt[1])).toFixed(2);
    const lines = axes(s, body, p => p.lines.filter(l => !furn.has(l))).length;
    tiles.push({ c, th, label: `p.${s[0].src} 톤 ${tone} · 균형 ${balance} · 정렬 ${lines} · 밀도 ${dens} · 어중간 ${near[0]}/${near[1]} · 혼자 ${r.alone.length}/${r.judged}` });
  }
  const H = Math.max(...tiles.map(t => t.th)) + GAP;
  const sheet = createCanvas(COLS * (W + 20), HEAD + Math.ceil(tiles.length / COLS) * H), ctx = sheet.getContext("2d");
  ctx.fillStyle = "#ddd"; ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = "16px sans-serif"; ctx.fillStyle = "#000";
  ctx.fillText(`강조색 ${v.accents}`, 10, 26);
  v["accent.hues"].forEach((a: any, i: number) => {
    ctx.fillStyle = `hsl(${a.hue + 5},70%,50%)`; ctx.fillRect(110 + i * 70, 10, 60, 24);
    ctx.fillStyle = "#000"; ctx.fillText(`${a.hue}° ${Math.round(a.pages * 100)}%쪽`, 110 + i * 70, 52);
  });
  ctx.fillText(`본문색 ${v.ink}  바탕과 명도 차 ${v["tone.text"]}`, 560, 26);
  if (v.ink) { ctx.fillStyle = v.ink; ctx.fillRect(560, 34, 60, 24); }
  tiles.forEach((t, i) => {
    const x = (i % COLS) * (W + 20) + 10, y = HEAD + Math.floor(i / COLS) * H;
    ctx.fillStyle = "#000"; ctx.fillText(t.label, x, y + 20);
    ctx.drawImage(t.c, x, y + GAP - 4);
  });
  const out = path.join(outDir, `${name}-2차${n}.png`);
  fs.writeFileSync(out, await sheet.encode("png"));
  console.log(out);
}
await task.destroy();
