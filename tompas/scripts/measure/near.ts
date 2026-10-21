// L4 근접성: 글, 사진, 도형을 모두 요소로 보고, 요소가 이웃 중 한쪽에 확실히 붙었는지 잰다.
// 양쪽 이웃이 모두 자기와 성격이 다른 요소(부제, 캡션, 소제목, 사이에 낀 사진)마다 넓은 쪽 간격 ÷ 좁은 쪽 간격을 낸다.
// 1에 가까우면 어느 묶음인지 읽히지 않는다. 한쪽 이웃이 같은 성격이면(문단이 이어짐, 카드가 늘어섬),
// 또는 셋이 바깥보다 확실히 촘촘하면 묶음 안이라 재지 않는다.
// 글은 크기(15% 안)와 서체(굵기 포함)가 모두 같아야 같은 성격이다. 위계를 크기로 주든 굵기로 주든 같게 본다.
// 간격 말고 다른 신호로 경계가 정해진 곳은 재지 않는다: 사이를 지나는 괘선, 한쪽 이웃과만 함께 든 바탕.
import type { Box, Line, Page } from "./read.ts";

const MM = 25.4 / 72;
export type El = Box & { kind: "글" | "그림"; size: number; text: string; font?: string };
export type Side = { page: number; axis: "세로" | "가로"; el: El; a: El; b: El; ga: number; gb: number; ratio: number };

// 글 요소: 크기가 같고, 위아래로 이어지고, 왼끝·가운데·오른끝 중 하나가 같은 줄들(가운데·오른쪽 정렬도 한 덩어리).
// 첫 줄이 나머지와 서체가 다르면(굵은 머리글이 본문에 바로 붙은 것) 따로 뗀다. 글자 윗선과 마지막 줄 아랫선으로 잰다
function texts(lines: Line[]): El[] {
  const out: Line[][] = [];
  const mid = (l: Line) => (l.x0 + l.x1) / 2;
  for (const l of [...lines].sort((a, b) => a.y - b.y)) {
    const b = out.find(b => {
      const q = b.at(-1)!;
      return Math.abs(q.size - l.size) < 0.1 * l.size && l.y > q.y && l.y - q.y <= 2.2 * l.size && Math.min(q.x1, l.x1) > Math.max(q.x0, l.x0)
        && (Math.abs(q.x0 - l.x0) < 1.5 || Math.abs(mid(q) - mid(l)) < 1.5 || Math.abs(q.x1 - l.x1) < 1.5);
    });
    if (b) b.push(l); else out.push([l]);
  }
  const main = (b: Line[]) => Object.entries(b.reduce((m, l) => (m[l.font] = (m[l.font] ?? 0) + l.text.length, m), {} as Record<string, number>)).sort((x, y) => y[1] - x[1])[0][0];
  const split = out.flatMap(b => {
    const f = main(b), head = b.findIndex(l => l.font === f);
    return head > 0 && head < b.length ? [b.slice(0, head), b.slice(head)] : [b];
  });
  return split.map(b => ({
    kind: "글", size: b[0].size, font: main(b), text: b.map(l => l.text).join(" "),
    x0: Math.min(...b.map(l => l.x0)), x1: Math.max(...b.map(l => l.x1)), y0: b[0].y - 0.75 * b[0].size, y1: b.at(-1)!.y + 0.2 * b.at(-1)!.size,
  }));
}

// 그림 요소: 사진 자리와 작은 그림·도형. 1mm 안으로 닿거나 겹친 것은 하나로 묶는다(아이콘 조각들)
// 괘선(한 변이 1mm 미만)은 요소가 아니라 나누는 선이다. 따로 모아 경계로 쓴다.
// 긴 변이 3mm 미만인 조각(차트 파편, 장식 점)은 뺀다
const thin = 1 / MM, tiny = 3 / MM;
const isRule = (b: Box) => Math.min(b.x1 - b.x0, b.y1 - b.y0) < thin && Math.max(b.x1 - b.x0, b.y1 - b.y0) >= tiny;
function marks(boxes: Box[]): El[] {
  const els = boxes.filter(b => Math.min(b.x1 - b.x0, b.y1 - b.y0) >= thin && Math.max(b.x1 - b.x0, b.y1 - b.y0) >= tiny).map(b => ({ ...b }));
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < els.length && !merged; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j];
      if (a.x0 <= b.x1 + thin && b.x0 <= a.x1 + thin && a.y0 <= b.y1 + thin && b.y0 <= a.y1 + thin) {
        Object.assign(a, { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
        els.splice(j, 1); merged = true; break;
      }
    }
  }
  return els.map(b => ({ ...b, kind: "그림", size: (b.x1 - b.x0) * (b.y1 - b.y0), text: "" }));
}

const inside = (o: Box, e: Box) => o.x0 <= e.x0 + 1 && o.x1 >= e.x1 - 1 && o.y0 <= e.y0 + 1 && o.y1 >= e.y1 - 1;
const similar = (a: El, b: El) => a.kind === b.kind && (a.kind === "글"
  ? Math.abs(a.size - b.size) < 0.15 * Math.max(a.size, b.size) && a.font === b.font
  : Math.max(a.size, b.size) / Math.max(1, Math.min(a.size, b.size)) < 1.5);

// 요소, 바탕(다른 요소를 품은 그림), 괘선
function scene(p: Page, content: Line[]) {
  const all = [...texts(content), ...marks([...p.images, ...p.marks])];
  const grounds = all.filter(o => o.kind === "그림" && all.some(e => e !== o && inside(o, e)));
  return { els: all.filter(o => !grounds.includes(o)), grounds, rules: p.marks.filter(isRule) };
}

export const elements = (p: Page, content: Line[]) => scene(p, content).els;

export function sides(p: Page, content: Line[]): Side[] {
  const { els, grounds, rules } = scene(p, content), out: Side[] = [];
  // e와 o 사이를 괘선이 지나는가
  const ruled = (e: El, o: El, vert: boolean) => rules.some(r => vert
    ? r.y0 >= Math.min(e.y1, o.y1) - 1 && r.y1 <= Math.max(e.y0, o.y0) + 1 && Math.min(e.x1, r.x1) - Math.max(e.x0, r.x0) > 2
    : r.x0 >= Math.min(e.x1, o.x1) - 1 && r.x1 <= Math.max(e.x0, o.x0) + 1 && Math.min(e.y1, r.y1) - Math.max(e.y0, r.y0) > 2);
  // 품은 바탕들. 같은 바탕에 든 것끼리 한 묶음이다
  const ground = (e: El) => grounds.filter(g => inside(g, e)).map(g => grounds.indexOf(g)).join(",");
  const near = (e: El, dir: "up" | "down" | "left" | "right") => {
    let best: El | undefined, gap = Infinity;
    for (const o of els) {
      if (o === e) continue;
      const vert = dir === "up" || dir === "down";
      const overlap = vert ? Math.min(e.x1, o.x1) - Math.max(e.x0, o.x0) : Math.min(e.y1, o.y1) - Math.max(e.y0, o.y0);
      if (overlap <= 2) continue;
      const g = dir === "up" ? e.y0 - o.y1 : dir === "down" ? o.y0 - e.y1 : dir === "left" ? e.x0 - o.x1 : o.x0 - e.x1;
      if (g > -1 && g < gap) { gap = Math.max(0, g); best = o; }
    }
    return best ? { o: best, gap } : null;
  };
  for (const e of els) for (const [axis, d1, d2, limit] of [["세로", "up", "down", p.h], ["가로", "left", "right", p.w]] as const) {
    const a = near(e, d1), b = near(e, d2);
    if (!a || !b || Math.max(a.gap, b.gap) > 0.3 * limit) continue;
    if (similar(e, a.o) || similar(e, b.o)) continue;   // 묶음 안
    const vert = axis === "세로";
    if (ruled(e, a.o, vert) || ruled(e, b.o, vert)) continue;   // 괘선이 경계를 정했다
    if ((ground(e) === ground(a.o)) !== (ground(e) === ground(b.o))) continue;   // 바탕이 경계를 정했다
    // 셋이 바깥보다 확실히 촘촘하면(아이콘·소제목·본문 카드) 이미 한 묶음이다
    const outA = near(a.o, d1)?.gap ?? Infinity, outB = near(b.o, d2)?.gap ?? Infinity;
    if (Math.min(outA, outB) >= 1.5 * Math.max(a.gap, b.gap)) continue;
    const ratio = Math.max(a.gap, b.gap) / Math.max(0.5, Math.min(a.gap, b.gap));
    out.push({ page: p.n, axis, el: e, a: a.o, b: b.o, ga: Math.round(a.gap * MM * 10) / 10, gb: Math.round(b.gap * MM * 10) / 10, ratio: Math.round(ratio * 100) / 100 });
  }
  return out;
}
