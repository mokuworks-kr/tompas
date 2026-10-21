// 잰 값을 쪽 그림 위에 그려 눈으로 대조한다.
//   node measure/show.ts <pdf> <출력 폴더> [원본 쪽 번호]...
// 쪽 번호를 주지 않으면 본문이 있는 모든 쪽을 열두 장씩 모은 그림으로 낸다. --sample이면 고르게 열두 장만.
// 초록: 판면, 파랑: 본문 줄, 빨강: 쪽번호·머리글로 뺀 것, 주황: 판면 밖으로 나간 글, 회색: 나머지 글
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { read } from "./read.ts";
import { furniture, measure } from "./vars.ts";

const [file, outDir, ...rest] = process.argv.slice(2);
const sample = rest.includes("--sample"), nums = rest.filter(a => a !== "--sample");
const doc = await read(file);
const { vars: v } = measure(doc);
const furn = furniture(doc.pages);
const PT = 72 / 25.4;
const isBody = (size: number) => Math.abs(size - v["body.size"]) < 0.06;

const task = getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 });
const pdf = await task.promise;
const name = path.basename(file, ".pdf");
fs.mkdirSync(outDir, { recursive: true });

async function draw(n: number, width: number) {
  const page = await pdf.getPage(n);
  const k = width / page.getViewport({ scale: 1 }).width, vp = page.getViewport({ scale: k });
  const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as any, canvas: canvas as any, viewport: vp }).promise;
  const line = Math.max(1, width / 800);
  for (const p of doc.pages.filter(p => p.src === n)) {
    const X = (x: number) => (x + p.dx) * k, Y = (y: number) => y * k;
    const inner = v["margin.inner"] * PT, outer = v["margin.outer"] * PT;
    const left = p.side === "L" ? outer : inner, right = p.w - (p.side === "L" ? inner : outer);
    const top = v["margin.top"] * PT, bottom = p.h - v["margin.bottom"] * PT;
    ctx.strokeStyle = "rgba(0,170,80,.9)"; ctx.lineWidth = 2 * line;
    ctx.strokeRect(X(left), Y(top), (right - left) * k, (bottom - top) * k);
    for (const l of p.lines) {
      const box = [X(l.x0), Y(l.y - 0.8 * l.size), (l.x1 - l.x0) * k, l.size * k] as const;
      const out = l.size >= 0.8 * v["body.size"] && (l.x0 < left - PT || l.x1 > right + PT || l.y - 0.8 * l.size < top - PT || l.y > bottom + PT);
      if (furn.has(l)) { ctx.strokeStyle = "rgba(230,0,0,.9)"; ctx.lineWidth = line; ctx.strokeRect(...box); }
      else if (out) { ctx.fillStyle = "rgba(255,140,0,.55)"; ctx.fillRect(...box); }
      else if (isBody(l.size)) { ctx.fillStyle = "rgba(0,90,255,.18)"; ctx.fillRect(...box); }
      else { ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = line / 2; ctx.strokeRect(...box); }
    }
  }
  return canvas;
}

if (nums.length) {
  for (const n of nums.map(Number)) {
    const out = path.join(outDir, `${name}-${n}.png`);
    fs.writeFileSync(out, await (await draw(n, 1600)).encode("png"));
    console.log(out);
  }
} else {
  const all = [...new Set(doc.pages.filter(p => p.lines.filter(l => isBody(l.size)).length >= 6).map(p => p.src))];
  const srcs = sample && all.length > 12 ? [...Array(12).keys()].map(i => all[Math.floor((i + 0.5) * all.length / 12)]) : all;
  const COLS = 3, ROWS = 4, W = 640, GAP = 24;
  for (let s = 0; s < srcs.length; s += COLS * ROWS) {
    const tiles = await Promise.all(srcs.slice(s, s + COLS * ROWS).map(n => draw(n, W)));
    const H = Math.max(...tiles.map(t => t.height)) + GAP;
    const sheet = createCanvas(COLS * (W + GAP), Math.ceil(tiles.length / COLS) * H);
    const ctx = sheet.getContext("2d");
    ctx.fillStyle = "#ddd"; ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.font = "16px sans-serif";
    tiles.forEach((t, i) => {
      const x = (i % COLS) * (W + GAP), y = Math.floor(i / COLS) * H;
      ctx.drawImage(t, x, y + GAP);
      ctx.fillStyle = "#000"; ctx.fillText(`p.${srcs[s + i]}`, x + 4, y + 17);
    });
    const out = path.join(outDir, `${name}-모음${s / (COLS * ROWS) + 1}.png`);
    fs.writeFileSync(out, await sheet.encode("png"));
    console.log(out);
  }
}
await task.destroy();
