// 가로 정렬: 스프레드의 큰 요소(제목, 20자 넘는 글 덩어리, 사진)가 윗선이나 아랫선을
// 다른 요소와 같은 높이(1.5mm 안)로 함께 쓰는지 잰다. 어디에 맞추는지(위·아래, 사진 밑과 제목 위)는 따지지 않는다.
// 아무것과도 높이를 함께 쓰지 않는 요소가 "혼자 떨어진 시작점"이다.
// 묶음이 시작하는 요소만 본다. 바로 위 요소에 붙은 것(제목 밑 부제, 이어지는 문단)은 묶음 안이라 따로 맞출 필요가 없다.
// 옆(가로로 겹치지 않는 자리)에 20mm 안 높이에서 시작하는 다른 묶음이 있을 때만 판정한다. 비슷한 높이에서 미묘하게
// 어긋난 것이 문제다. 한 단에 차례로 쌓인 목록이나 크게 엇갈린 배치는 의도로 보고 따지지 않는다.
import type { Line, Page } from "./read.ts";
import { elements, type El } from "./near.ts";

const MM = 25.4 / 72, TOL = 1.5 / MM, NEAR = 20 / MM;

// 글: 윗선은 글자 윗선, 아랫선은 마지막 줄 기준선. 그림: 상자 위아래
const edges = (e: El) => e.kind === "글" ? [e.y0, e.y1 - 0.2 * e.size] : [e.y0, e.y1];

export function rows(spread: Page[], content: (p: Page) => Line[], body: number) {
  const all = spread.flatMap(p => elements(p, content(p)).map(e => ({ e, page: p })));
  const big = all.filter(({ e, page }) => e.kind === "글"
    ? e.text.replace(/\s/g, "").length >= 20 || e.size >= 1.15 * body
    : e.size >= 0.005 * page.w * page.h);
  // 바로 위(가로로 겹치는) 요소와의 간격이 본문 2.5배(9pt 본문이면 약 8mm) 안이면 붙어 있다
  const attached = (e: El) => all.some(({ e: o }) => o !== e && Math.min(e.x1, o.x1) - Math.max(e.x0, o.x0) > 2 && o.y1 <= e.y0 + 1 && e.y0 - o.y1 < 2.5 * body);
  const starts = big.filter(({ e }) => !attached(e));
  const x = (o: { e: El; page: Page }) => { const off = spread.slice(0, spread.indexOf(o.page)).reduce((a, q) => a + q.w, 0); return [off + o.e.x0, off + o.e.x1]; };
  const judged = starts.filter(s => starts.some(o => {
    if (o === s) return false;
    const [a0, a1] = x(s), [b0, b1] = x(o);
    return Math.min(a1, b1) <= Math.max(a0, b0) && Math.abs(o.e.y0 - s.e.y0) < NEAR;
  }));
  const alone = judged.filter(({ e }) => {
    const [t, b] = edges(e);
    // 쪽의 위아래 끝도 선이다(도련 사진, 위아래로 닿는 띠)
    const lines = [0, spread[0].h, ...all.filter(o => o.e !== e).flatMap(o => edges(o.e))];
    return !lines.some(y => Math.abs(y - t) < TOL || Math.abs(y - b) < TOL);
  });
  return { judged: judged.length, alone, starts: judged };
}
