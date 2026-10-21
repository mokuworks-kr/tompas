// PDF의 깨진 기호를 푼다. 서체가 글자 정보를 틀리게 담은 PDF는 어떤 도구로 읽어도 기호가 엉뚱한 글자로 나온다(D-40).
// 같은 기호는 늘 같은 엉뚱한 글자로 나오므로, 종류마다 몇 자리를 쪽 그림으로 잘라 글자 인식(맥 Vision)으로 읽고
// 앞뒤 글자가 맞는 자리에서 그 칸에 찍힌 글자를 다수결로 정한다. 글자 인식은 이 투표에만 쓴다(다른 글자는 자주 틀린다).
// 인식이 믿을 만한 답(괄호, @, +, %, : 같은 기본 기호)만 받는다. 화살표·도형은 인식이 엉뚱하게 읽어서(→를 >, ▲를 '스')
// 받지 않고, 그 자리를 그림(data/decode.png)으로 남긴다. 에이전트가 그림을 보고 content.json의 decode에 적는다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";
// kordoc은 자기 pdf.js(옛 판)를 따로 쓴다. 한 프로세스에 두 판이 있으면 충돌하므로 ingest는 이 파일을 따로 띄운다(run)
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// 문서에 어울리지 않는 글자: 호환 기호(㎿ ㏙), 확장 한자 A(㖇 㚉), 사용자 정의 영역, 대체 문자
export const odd = /[\u3300-\u33ff\u3400-\u4dbf\ue000-\uf8ff\ufffd]/g;
const SAMPLES = 6;   // 종류마다 읽어 볼 자리 수

export type Decoded = { char: string; to: string | null; votes: Record<string, number>; seen: number; context: string };
const SAFE = /^[()[\]{}@+%&:~#\/,.;!?=_"'-]$/;

// 인식기: 처음 한 번 빌드해 캐시에 둔다(저장소 밖)
function ocrTool() {
  const bin = path.join(os.homedir(), "Library/Caches/tompas/tompas-ocr");
  const src = path.join(import.meta.dirname, "ocr.swift");
  if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) {
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    execFileSync("swiftc", ["-O", src, "-o", bin], { stdio: "ignore" });
  }
  return bin;
}

const nm = path.resolve(import.meta.dirname, "../node_modules/pdfjs-dist") + "/";

export async function decode(file: string, sheet?: string): Promise<Decoded[]> {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), cMapUrl: nm + "cmaps/", cMapPacked: true, standardFontDataUrl: nm + "standard_fonts/", verbosity: 0 }).promise;
  // 깨진 글자가 든 글 조각과 그 자리
  const spots = new Map<string, { page: number; item: any }[]>();
  const seen = new Map<string, number>(), context = new Map<string, string>(), first = new Map<string, { page: number; item: any }>();
  for (let n = 1; n <= doc.numPages; n++) {
    const items = (await (await doc.getPage(n)).getTextContent()).items as any[];
    for (const item of items) for (const ch of new Set(item.str.match(odd) ?? [])) {
      seen.set(ch, (seen.get(ch) ?? 0) + (item.str.match(new RegExp(ch, "g"))?.length ?? 0));
      if (!context.has(ch) || context.get(ch)!.length < 4) context.set(ch, `${n}쪽: ${item.str.trim()}`);
      if (!first.has(ch)) first.set(ch, { page: n, item });   // 그림용: 기호 홀로 놓인 자리라도
      const list = spots.get(ch) ?? [];
      if (list.length < SAMPLES && item.str.replace(odd, "").trim().length >= 2) list.push({ page: n, item });
      spots.set(ch, list);
    }
  }
  if (!seen.size) return [];

  // 쪽마다 한 번 그려 자리를 잘라 둔다
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tompas-decode-"));
  const crops: { file: string; ch: string; str: string }[] = [];
  const byPage = new Map<number, { ch: string; item: any }[]>();
  for (const [ch, list] of spots) for (const s of list) byPage.set(s.page, [...(byPage.get(s.page) ?? []), { ch, item: s.item }]);
  for (const [n, list] of byPage) {
    const page = await doc.getPage(n), vp = page.getViewport({ scale: 4 });
    const c = createCanvas(vp.width, vp.height);
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x as any, viewport: vp }).promise;
    for (const { ch, item } of list) {
      const [a, b, , , e, f] = item.transform, h = Math.hypot(a, b) || 10;
      const [x0, y0] = vp.convertToViewportPoint(e - h, f + h * 1.3), [x1, y1] = vp.convertToViewportPoint(e + item.width + h, f - h * 0.5);
      const w = Math.max(8, x1 - x0), hh = Math.max(8, y1 - y0);
      const crop = createCanvas(w, hh);
      crop.getContext("2d").drawImage(c, -x0, -y0);
      const file = path.join(dir, `${crops.length}.png`);
      fs.writeFileSync(file, crop.toBuffer("image/png"));
      crops.push({ file, ch, str: item.str });
    }
  }
  const read = new Map<string, string[]>();
  for (const line of execFileSync(ocrTool(), crops.map(c => c.file), { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean)) {
    const r = JSON.parse(line); read.set(r.file, r.lines);
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // 투표: 깨진 글자의 앞뒤 글자(공백 빼고)가 인식 결과에서 맞는 자리를 찾아, 그 사이에 찍힌 한 글자를 표로 센다
  const votes = new Map<string, Record<string, number>>();
  for (const c of crops) {
    const ocr = (read.get(c.file) ?? []).join("").replace(/\s/g, "");
    const str = c.str.replace(/\s/g, "");
    const v = votes.get(c.ch) ?? {}; votes.set(c.ch, v);
    for (let i = str.indexOf(c.ch); i >= 0; i = str.indexOf(c.ch, i + 1)) {
      const got = between(ocr, str.slice(0, i).replace(odd, "").slice(-3), str.slice(i + 1).replace(odd, "").slice(0, 3));
      if (got) { v[got] = (v[got] ?? 0) + 1; break; }
    }
  }
  const quotes = new Map<string, [number, number]>();   // 따옴표: [여는 자리(앞이 비었거나 괄호), 닫는 자리] 수
  for (const c of crops) for (let i = c.str.indexOf(c.ch); i >= 0; i = c.str.indexOf(c.ch, i + 1)) {
    const q = quotes.get(c.ch) ?? [0, 0]; q[/^$|[\s(\[]/.test(c.str[i - 1] ?? "") ? 0 : 1]++; quotes.set(c.ch, q);
  }
  const out = [...seen.keys()].map(ch => {
    const v = votes.get(ch) ?? {}, total = Object.values(v).reduce((a, b) => a + b, 0);
    const [top, n] = Object.entries(v).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    // 셋 중 둘 넘게 같은 답이고 믿을 만한 기호일 때만 푼다. 곧은 따옴표는 자리로 여는·닫는 것을 고른다
    let to = top && n / total > 0.66 && SAFE.test(top) ? top : null;
    // 한쪽 자리에만 나오면 굽은 따옴표로, 양쪽에 다 나오면 곧은 그대로 둔다
    const [o, c] = quotes.get(ch) ?? [0, 0];
    if ((to === '"' || to === "'") && !(o && c)) to = o ? (to === '"' ? "\u201c" : "\u2018") : (to === '"' ? "\u201d" : "\u2019");
    return { char: ch, to, votes: v, seen: seen.get(ch)!, context: context.get(ch) ?? "" };
  });
  // 못 푼 기호는 자리를 크게 잘라 한 장에 모은다. 에이전트가 보고 판단한다
  const left = out.filter(d => !d.to);
  if (sheet && left.length) await draw(doc, first, left.map(d => d.char), sheet);
  return out;
}

async function draw(doc: any, first: Map<string, { page: number; item: any }>, chars: string[], file: string) {
  const W = 1000, H = 150, c = createCanvas(W, chars.length * H), x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, W, c.height);
  for (const [i, ch] of chars.entries()) {
    const s = first.get(ch) ?? null;
    x.fillStyle = "#c00"; x.font = "18px sans-serif";
    x.fillText(`${i + 1}. ${ch} (U+${ch.codePointAt(0)!.toString(16).toUpperCase()})${s ? ` ${s.page}쪽: ${s.item.str.trim().slice(0, 60)}` : " 자리를 찾지 못함"}`, 6, i * H + 22);
    if (!s) continue;
    const page = await doc.getPage(s.page), vp = page.getViewport({ scale: 4 });
    const pc = createCanvas(vp.width, vp.height), px = pc.getContext("2d");
    px.fillStyle = "#fff"; px.fillRect(0, 0, pc.width, pc.height);
    await page.render({ canvasContext: px as any, viewport: vp }).promise;
    const [a, b, , , e, f] = s.item.transform, h = Math.hypot(a, b) || 10;
    const [x0, y0] = vp.convertToViewportPoint(e - h, f + h * 1.3), [x1, y1] = vp.convertToViewportPoint(e + s.item.width + h, f - h * 0.5);
    const k = Math.min((W - 12) / (x1 - x0), (H - 40) / (y1 - y0));
    x.drawImage(pc, x0, y0, x1 - x0, y1 - y0, 6, i * H + 32, (x1 - x0) * k, (y1 - y0) * k);
  }
  fs.writeFileSync(file, c.toBuffer("image/png"));
}

// 앞 글자(left)와 뒤 글자(right) 사이의 한 글자. 짧게 줄여 가며 찾는다(인식이 앞뒤 글자를 틀릴 수 있다)
function between(ocr: string, left: string, right: string): string | null {
  for (let k = 3; k >= 1; k--) {
    const l = left.slice(-k), r = right.slice(0, k);
    if (l && r) {
      for (let i = ocr.indexOf(l); i >= 0; i = ocr.indexOf(l, i + 1)) {
        const j = ocr.indexOf(r, i + l.length);
        if (j === i + l.length + 1) return ocr[i + l.length];
      }
    } else if (r && r.length === k && !left) {
      const j = ocr.indexOf(r); if (j > 0) return ocr[j - 1];
    } else if (l && l.length === k && !right) {
      const i = ocr.indexOf(l); if (i >= 0 && i + l.length < ocr.length) return ocr[i + l.length];
    }
  }
  return null;
}

// ingest가 부른다: node decode.ts <PDF> <그림 경로>   결과는 JSON 한 줄
export function run(file: string, sheet: string): Decoded[] {
  return JSON.parse(execFileSync(process.execPath, [import.meta.filename, file, sheet], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }));
}
if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(await decode(process.argv[2], process.argv[3])));
