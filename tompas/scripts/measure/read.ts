// PDF를 낱쪽과 줄로 읽는다. 단위는 pt, 원점은 쪽의 왼쪽 위.
import fs from "node:fs";
import { getDocument, OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs";

export type Line = { x0: number; x1: number; y: number; size: number; font: string; text: string };
export type Box = { x0: number; y0: number; x1: number; y1: number };
// src·dx: 원본 PDF의 몇째 쪽, 그 쪽에서 얼마나 왼쪽으로 옮겼는지. images: 사진 자리
// marks: 사진 자리보다 작은 그림(아이콘)과 도형·괘선. 쪽을 덮는 바탕은 뺀다. 근접성(L4)에 쓴다
export type Page = { n: number; w: number; h: number; side: "L" | "R" | "S"; lines: Line[]; images: Box[]; marks: Box[]; src: number; dx: number };
// 가로 낱쪽은 화면용으로 본다. 화면용의 pt·mm는 인쇄 크기가 아니라 비율 값만 쓴다.
// inks: 서체·크기·글자색("서체|크기|#색")마다 그린 글자 수. swatches: 원본 쪽마다 쓴 색(면 채우기·선·글자)
export type Doc = { pages: Page[]; layout: "스프레드" | "세로 낱쪽" | "가로 낱쪽"; medium: "인쇄" | "화면"; inks: Record<string, number>; swatches: string[][] };
type Raw = { w: number; h: number; lines: Line[]; images: Box[]; marks: Box[] };

type Run = Line;

// 서브셋 접두(ABCDEF+)를 뗀 서체 이름
const fontName = (raw: string) => raw.replace(/^[A-Z]{6}\+/, "");

// 연산 목록을 따라가며 사진 자리(쪽 면적의 0.5% 이상), 글자색별 글자 수, 쓴 색을 모은다.
// 쓴 색: 쪽 면적의 0.05% 넘게 채운 면, 선, 세 글자 넘게 쓴 글자의 색
// marks: 작은 그림, 채운 면, 선. 한 변이 2pt 넘는 것만. 쪽의 80% 넘게 덮으면 바탕이라 뺀다
function paints(ol: any, vp: any, w: number, h: number, inks: Record<string, number>, objs: any, used: Set<string>, marks: Box[]): Box[] {
  const box = (m: number[], pts: number[][]) => {
    const q = pts.map(p => { const c = [...p]; Util.applyTransform(c, m); return c; });   // 자리에서 바꾼다
    const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
    return { x0: Math.max(0, Math.min(...xs)), y0: Math.max(0, Math.min(...ys)), x1: Math.min(w, Math.max(...xs)), y1: Math.min(h, Math.max(...ys)) };
  };
  const mark = (b: Box) => {
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    if (Math.max(bw, bh) > 2 && bw * bh < 0.8 * w * h && bw >= 0 && bh >= 0) marks.push(b);
  };
  const boxes: Box[] = [], stack: [number[], string, string][] = [], glyphs: Record<string, number> = {};
  let ctm = [1, 0, 0, 1, 0, 0], tm = [1, 0, 0, 1, 0, 0], fill = "#000000", stroke = "#000000", font = "", size = 0;
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i];
    if (f === OPS.save || f === OPS.paintFormXObjectBegin) {
      stack.push([ctm, fill, stroke]);
      if (f === OPS.paintFormXObjectBegin && a?.[0]) ctm = Util.transform(ctm, a[0]);
    } else if (f === OPS.restore || f === OPS.paintFormXObjectEnd) [ctm, fill, stroke] = stack.pop() ?? [ctm, fill, stroke];
    else if (f === OPS.transform) ctm = Util.transform(ctm, a);
    else if (f === OPS.setFillRGBColor) fill = a[0];
    else if (f === OPS.setStrokeRGBColor) stroke = a[0];
    else if (f === OPS.constructPath) {
      const op = a[0], mm = a[2];
      const painted = op === OPS.stroke || op === OPS.closeStroke || (op >= OPS.fill && op <= OPS.closeEOFillStroke);
      if (painted && mm) mark(box(Util.transform(vp.transform, ctm), [[mm[0], mm[1]], [mm[2], mm[1]], [mm[0], mm[3]], [mm[2], mm[3]]]));
      if (op === OPS.stroke || op === OPS.closeStroke) used.add(stroke);
      else if (op >= OPS.fill && op <= OPS.closeEOFillStroke && mm) {
        const area = Math.abs((mm[2] - mm[0]) * (mm[3] - mm[1]) * (ctm[0] * ctm[3] - ctm[1] * ctm[2]));
        if (area > 0.0005 * w * h) used.add(fill);
        if (op >= OPS.fillStroke) used.add(stroke);
      }
    }
    else if (f === OPS.setFont) { size = a[1]; try { font = fontName(objs.get(a[0]).name); } catch { font = a[0]; } }
    else if (f === OPS.beginText) tm = [1, 0, 0, 1, 0, 0];
    else if (f === OPS.setTextMatrix) tm = Array.from(a[0]);
    else if (f === OPS.showText || f === OPS.showSpacedText || f === OPS.nextLineShowText || f === OPS.nextLineSetSpacingShowText) {
      const glyphs = a.find((x: any) => Array.isArray(x)) ?? [];
      const n = glyphs.filter((g: any) => g?.unicode?.trim()).length;
      const k = `${font}|${(Math.abs(size) * Math.hypot(tm[2], tm[3]) * Math.hypot(ctm[2], ctm[3])).toFixed(1)}|${fill}`;
      if (n) inks[k] = (inks[k] ?? 0) + n;
      if ((glyphs[fill] = (glyphs[fill] ?? 0) + n) > 3) used.add(fill);
    } else if (f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.paintImageXObjectRepeat) {
      const m = Util.transform(vp.transform, ctm);
      const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]], ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
      const b = { x0: Math.max(0, Math.min(...xs)), y0: Math.max(0, Math.min(...ys)), x1: Math.min(w, Math.max(...xs)), y1: Math.min(h, Math.max(...ys)) };
      if ((b.x1 - b.x0) * (b.y1 - b.y0) >= 0.005 * w * h) boxes.push(b); else mark(b);
    }
  }
  return boxes;
}

async function readRuns(page: any): Promise<Run[]> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const runs: Run[] = [];
  for (const it of tc.items as any[]) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = Util.transform(vp.transform, it.transform);
    if (Math.abs(b) > 0.01 * Math.abs(a) || a <= 0) continue; // 가로쓰기만
    const size = Math.hypot(c, d);
    if (size < 1) continue;
    let font = it.fontName;
    try { font = fontName(page.commonObjs.get(it.fontName).name); } catch {}
    runs.push({ x0: e, x1: e + it.width, y: f, size, font, text: it.str });
  }
  return runs;
}

// 같은 기준선에 붙어 있는 조각을 한 줄로 잇는다
function toLines(runs: Run[]): Line[] {
  runs.sort((p, q) => p.y - q.y || p.x0 - q.x0);
  const lines: Line[] = [];
  const weight = new Map<Line, Map<string, number>>();
  for (const r of runs) {
    const l = lines.findLast(l => Math.abs(l.y - r.y) < 0.25 * Math.min(l.size, r.size) && r.x0 - l.x1 < 1.2 * r.size && r.x0 - l.x1 > -0.5 * r.size);
    if (!l) { lines.push({ ...r }); weight.set(lines.at(-1)!, new Map([[`${r.size.toFixed(1)}|${r.font}`, r.text.length]])); continue; }
    l.text += (r.x0 - l.x1 > 0.2 * r.size ? " " : "") + r.text;
    l.x1 = Math.max(l.x1, r.x1);
    const w = weight.get(l)!, k = `${r.size.toFixed(1)}|${r.font}`;
    w.set(k, (w.get(k) ?? 0) + r.text.length);
  }
  for (const l of lines) { // 줄의 크기와 서체는 글자가 가장 많은 쪽을 따른다
    const [k] = [...weight.get(l)!].sort((p, q) => q[1] - p[1])[0];
    const [s, ...f] = k.split("|");
    l.size = +s; l.font = f.join("|");
  }
  return lines;
}

// 가로 쪽에서 가운데를 가로지르는 글줄이 1% 미만이면 스프레드로 저장된 것이다
function isSpread(pages: Raw[]) {
  let n = 0, cross = 0;
  for (const p of pages) {
    if (p.w <= p.h) continue;
    for (const l of p.lines) {
      if (l.text.length < 8) continue;
      n++;
      if (l.x0 < p.w / 2 - 3 && l.x1 > p.w / 2 + 3) cross++;
    }
  }
  return n > 0 && cross / n < 0.01;
}

function half(p: Raw, side: "L" | "R"): Omit<Page, "n" | "src"> {
  const w = p.w / 2, dx = side === "L" ? 0 : w;
  const lines = p.lines
    .filter(l => side === "L" ? (l.x0 + l.x1) / 2 < w : (l.x0 + l.x1) / 2 >= w)
    .map(l => ({ ...l, x0: l.x0 - dx, x1: l.x1 - dx }));
  // 사진은 이 쪽에 걸친 부분만 남긴다(가운데에 걸친 사진은 양쪽에 나뉜다)
  const cut = (bs: Box[]) => bs
    .map(b => ({ ...b, x0: Math.max(b.x0, dx) - dx, x1: Math.min(b.x1, dx + w) - dx }))
    .filter(b => b.x1 - b.x0 > 1);
  return { w, h: p.h, side, lines, images: cut(p.images), marks: cut(p.marks), dx };
}

export async function read(file: string): Promise<Doc> {
  const task = getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0, disableFontFace: true });
  const pdf = await task.promise;
  const raw: Raw[] = [], inks: Record<string, number> = {}, swatches: string[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const ol = await page.getOperatorList(); // 서체의 실제 이름도 이때 commonObjs에 오른다
    const used = new Set<string>(), marks: Box[] = [];
    const images = paints(ol, vp, vp.width, vp.height, inks, page.commonObjs, used, marks);
    swatches.push([...used]);
    const lines = toLines(await readRuns(page));
    raw.push({ w: vp.width, h: vp.height, lines, images, marks });
    page.cleanup();
  }
  await task.destroy();

  const spread = isSpread(raw);
  // 가장 흔한 폭의 쪽만 나눈다. 반쪽짜리 표지와 접지 쪽은 그대로 둔다.
  const widths = raw.map(p => Math.round(p.w));
  const typical = widths.sort((a, b) => widths.filter(w => w === b).length - widths.filter(w => w === a).length)[0];
  const pages: Page[] = [];
  // 세로 낱쪽은 쪽번호가 바깥 가장자리에 있다. 쪽마다 가장 가까운 쪽번호로 왼쪽·오른쪽을 정한다.
  // 표지나 접지 쪽 때문에 PDF 쪽수와 인쇄 쪽수의 짝홀이 어긋나는 파일이 있다. 쪽번호가 하나도 없으면 홀수 쪽을 오른쪽으로 본다.
  const folioSide = raw.map(p => {
    const f = p.lines.find(l => /^\d{1,3}$/.test(l.text.trim()) && (l.y < 0.12 * p.h || l.y > 0.88 * p.h) && Math.abs((l.x0 + l.x1) / 2 - p.w / 2) > 0.1 * p.w);
    return f ? ((f.x0 + f.x1) / 2 > p.w / 2 ? "R" : "L") : null;
  });
  const sideOf = (i: number): "L" | "R" => {
    for (let d = 0; d < raw.length; d++) for (const j of [i - d, i + d]) {
      const f = folioSide[j];
      if (f) return d % 2 ? (f === "L" ? "R" : "L") : f;
    }
    return i % 2 ? "L" : "R";
  };
  raw.forEach((p, i) => {
    // 가로 낱쪽(화면용)은 좌우가 없다.
    const side = p.w > p.h ? "S" : sideOf(i);
    const halves = spread && p.w > p.h && Math.abs(p.w - typical) < 0.05 * typical ? [half(p, "L"), half(p, "R")] : [{ ...p, side: side as Page["side"], dx: 0 }];
    for (const h of halves) pages.push({ n: pages.length + 1, src: i + 1, ...h });
  });
  const wide = raw.filter(p => p.w > p.h).length > raw.length / 2;
  const layout = spread ? "스프레드" : wide ? "가로 낱쪽" : "세로 낱쪽";
  return { pages, layout, medium: layout === "가로 낱쪽" ? "화면" : "인쇄", inks, swatches };
}
