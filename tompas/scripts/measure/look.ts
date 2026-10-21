// 쪽을 그림으로 그려 바탕 톤과 좌우 무게를 잰다.
// 무게는 와이어프레임의 균형 계산과 같게 사진 자리를 중간 회색(L* 50)으로 본다.
import fs from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Doc, Page } from "./read.ts";

// 쪽마다: 바탕 명도, 왼쪽·오른쪽 절반의 무게
export type Look = { bg: number; weight: [number, number] };

const lin = (c: number) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const LIN = Array.from({ length: 256 }, (_, i) => lin(i));
const f = (t: number) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;

// sRGB → CIELAB(D65)
export function lab(r: number, g: number, b: number) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const hexL = (hex: string) => lab(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))[0];

export async function look(file: string, doc: Doc): Promise<Map<Page, Look>> {
  const task = getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 });
  const pdf = await task.promise;
  const out = new Map<Page, Look>();
  for (const src of new Set(doc.pages.map(p => p.src))) {
    const page = await pdf.getPage(src);
    const base = page.getViewport({ scale: 1 });
    const k = 900 / Math.max(base.width, base.height), vp = page.getViewport({ scale: k }); // 긴 변 900px
    const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx as any, canvas: canvas as any, viewport: vp }).promise;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    page.cleanup();

    for (const p of doc.pages.filter(p => p.src === src)) {
      const X0 = Math.round(p.dx * k), X1 = Math.min(width, Math.round((p.dx + p.w) * k)), mid = (X0 + X1) / 2;
      // 사진 자리는 중간 회색으로 본다. 쪽의 80% 넘게 덮는 그림(종이 질감, 배경 그림, 전면 사진)은 바탕이라 실제 색을 쓴다.
      const photo = new Uint8Array(width * height);
      for (const b of p.images.filter(b => (b.x1 - b.x0) * (b.y1 - b.y0) < 0.8 * p.w * p.h))
        for (let y = Math.floor(b.y0 * k); y < Math.min(height, b.y1 * k); y++)
          photo.fill(1, y * width + Math.floor((b.x0 + p.dx) * k), y * width + Math.min(X1, Math.ceil((b.x1 + p.dx) * k)));
      const hist = new Array(51).fill(0), weight: [number, number] = [0, 0];
      let plain = 0;
      for (let y = 0; y < height; y++) for (let x = X0; x < X1; x++) {
        const i = y * width + x;
        if (photo[i]) { weight[x < mid ? 0 : 1] += 0.5; continue; }
        const L = lab(data[4 * i], data[4 * i + 1], data[4 * i + 2])[0];
        weight[x < mid ? 0 : 1] += 1 - L / 100;
        hist[Math.round(L / 2)]++; plain++;
      }
      const area = (X1 - X0) * height;
      weight[0] /= area; weight[1] /= area;
      // 바탕: 사진 밖에서 가장 흔한 명도. 사진이 쪽의 80% 넘게 덮으면(작은 사진 여럿) 중간 회색으로 보고 50
      const bg = plain > 0.2 * area ? 2 * hist.indexOf(Math.max(...hist)) : 50;
      out.set(p, { bg, weight });
    }
  }
  await task.destroy();
  return out;
}
