// check: 조판 결과를 검사하고 리포트를 쓴다.
//   node check/index.ts <프로젝트 폴더>   out/report.md(디자이너용), data/report.json(에이전트용), out/spreads.png(전체 스프레드 한 장)
// 디자이너에게는 판단하거나 채울 것(넘침, 잠긴 사실, 사진 자리)을 보이고, 규칙 위반 자리는 에이전트가 읽고 고친다.
// 의도로 남긴 자리는 data/exceptions.json에 이유와 함께 적는다. 규칙은 규칙 번호로 말한다.
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { validate, line } from "../validate/index.ts";
import { measureFile } from "../measure/index.ts";
import type { Result } from "../rules/engine.ts";

const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));

export async function check(project: string) {
  project = path.resolve(project);
  const data = path.join(project, "data"), out = path.join(project, "out");
  const R = read(path.join(data, "render.json"));
  const L = read(path.join(data, "layout.json"));
  const content = read(path.join(data, "content.json"));

  // 넘친 글: 상자와 표 칸(칸은 쪽을 넘지 못해 칸 안에서 넘친다)
  const overflow = [...R.frames.filter((f: any) => f.overflows).map((f: any) => f.name), ...(R.cells ?? [])];
  // 넘침 조정: 엔진이 고친 것(스타일 변형, 상자 크기)과 남은 글자 수. 남은 것은 에이전트가 축약을 제안한다
  const adjust: { page: number; name: string; steps: string[]; overset: number }[] = R.adjust ?? [];
  const over = (n: string) => adjust.find(a => a.name === n)?.overset;
  const fitted = adjust.filter(a => !a.overset);   // 엔진이 넘침을 다 맞춘 상자
  // 아래에 붙는 글(↓)이 함께 쓰는 시작 높이. 혼자 긴 글이 다른 쪽의 간격을 벌린다
  const alone: string[] = (R.starts ?? []).filter((s: any) => s.alone).map((s: any) => s.alone);
  // 공백과 줄바꿈은 빼고 견준다. 흐르는 글은 쪽이나 상자 경계에서 주소·숫자가 나뉜다
  const flat = (t: string) => t.replace(/\s/g, "");
  const printed = flat(Object.values(R.text).join(""));
  const missing = content.facts.filter((f: any) => !printed.includes(flat(f.text))).map((f: any) => f.text);
  // 사진 자리: 쪽, 크기, 300ppi에서 필요한 최소 픽셀, 무엇으로 채웠나(data/pictures.json), 메모
  const fill = (f: any) => !f.pic ? "비어 있음"
    : [f.pic.file || f.pic.draw?.some((d: any) => d.image) ? "그림" : "", f.pic.draw?.length ? "도식" : ""].filter(Boolean).join("+")
      + (f.pic.fpo ? " (임시 FPO)" : "");
  const photos = L.pages.flatMap((p: any) => p.frames.filter((f: any) => f.kind === "image").map((f: any) => ({
    page: p.page, area: f.letter, w: Math.round(f.w), h: Math.round(f.h), px: [f.w, f.h].map(v => Math.ceil(v / 25.4 * 300)), memo: f.memo, fill: fill(f),
  })));

  // 예외: 에이전트가 의도로 남긴 자리. data/exceptions.json [{rule, where, why}]
  const exFile = path.join(data, "exceptions.json");
  const exceptions: { rule: string; where?: string; why: string }[] = fs.existsSync(exFile) ? read(exFile) : [];
  const rules: Result[] = (await validate(project, measureFile)).map(r => {
    const ex = exceptions.filter(e => e.rule === r.id);
    if (r.status !== "어긋남" || !ex.length) return r;
    const where = r.where?.filter(w => !ex.some(e => e.where && w.startsWith(e.where)));
    return (r.where && !where?.length) || ex.some(e => !e.where) ? { ...r, status: "예외", where: r.where } : { ...r, where };
  });
  // 표와 떨어진 앞 글: 흐르는 글에서 표만 다음 쪽으로 넘어갔다. 고칠지(소제목을 넘길지, 표를 줄일지)는 판단이다
  const apart: string[] = R.apart ?? [];
  const report = { overflow, adjust, alone, missing, apart, photos, layout: L.errors, rules, exceptions };
  fs.writeFileSync(path.join(data, "report.json"), JSON.stringify(report, null, 1) + "\n");

  // 디자이너용: 디자이너가 판단하거나 채울 것만 위에. 규칙은 에이전트가 고치고, 결과는 한 줄로
  const by = (s: string) => rules.filter(r => r.status === s);
  const count = (r: Result) => r.where ? `${r.id} ${r.where.length}곳` : r.id;
  const md = [
    `# 검사 리포트: ${path.basename(project)}`, "",
    `${L.total}쪽. 넘친 글 ${overflow.length}곳, 빠진 사실 ${missing.length}개, 사진 자리 ${photos.length}곳.`,
    // 흐르는 글이 쪽수를 정했으면 알린다. 중철은 4의 배수라야 묶인다
    ...(Object.keys(R.flows ?? {}).length ? [`흐르는 글의 쪽수: ${Object.entries<any>(R.flows).map(([k, f]) => `${k} ${f.need}쪽`).join(", ")}.`] : []),
    ...(L.page.binding === "중철" && L.total % 4
      ? [`중철은 4의 배수라야 한다. 지금 ${L.total}쪽이라 ${4 - L.total % 4}쪽을 더하거나 ${L.total % 4}쪽을 줄여야 한다.`] : []), "",
    "## 넘친 글",
    overflow.length ? overflow.map((n: string) => `- ${n.replace(/^(\d+)/, "$1쪽 ")}${over(n) ? `: ${over(n)}자 넘친다. 줄일 문장을 제안한다` : ""}`).join("\n")
      : alone.length ? "넘친 상자는 없다." : "없음",
    ...alone.map(n => `- ${n.replace(/^(\d+)/, "$1쪽 ")}: 같은 자리의 다른 쪽보다 글이 3줄 넘게 길어, `
      + "다른 쪽의 시작 높이까지 끌어올린다. 줄일 문장을 제안한다"),
    ...(fitted.length ? [`엔진이 맞춘 곳 ${fitted.length}곳: ${fitted.map(a => `${a.name.replace(/^(\d+)/, "$1쪽 ")}(${a.steps.join(", ")})`).join(", ")}`] : []), "",
    ...(apart.length ? ["## 표와 떨어진 글", ...apart.map(a => `- ${a}…: 표만 다음 쪽으로 넘어갔다. 소제목과 함께 넘기거나 표를 줄인다`), ""] : []),
    "## 잠긴 사실", missing.length ? missing.map((t: string) => `- 빠짐: ${t}`).join("\n") : `${content.facts.length}개 모두 원문 그대로 들어갔다.`, "",
    ...(L.errors.length ? ["## 원고가 놓이지 않은 곳", ...L.errors.map((e: string) => `- ${e}`), ""] : []),
    "## 사진 자리", "쪽 | 영역 | 채움 | 크기(mm) | 300ppi 최소 픽셀 | 메모", "---|---|---|---|---|---",
    ...photos.map((f: any) => `${f.page} | ${f.area} | ${f.fill} | ${f.w}×${f.h} | ${f.px[0]}×${f.px[1]} | ${f.memo ?? ""}`), "",
    "## 에이전트 점검",
    `규칙 ${rules.length}개 중 통과 ${by("통과").length}, 남은 어긋남 ${by("어긋남").length ? by("어긋남").map(count).join(", ") : "없음"}, `
      + `의도로 남긴 예외 ${by("예외").length ? by("예외").map(r => r.id).join(", ") : "없음"}. 자리는 data/report.json.`,
    ...exceptions.map(e => `- 예외 ${e.rule}${e.where ? ` ${e.where}` : ""}: ${e.why}`), "",
  ].join("\n");
  fs.writeFileSync(path.join(out, "report.md"), md);
  await sheet(path.join(out, "spreads"), path.join(out, "spreads.png"));
  return report;
}

// 스프레드 그림을 한 장에 모은다. 표본이 아니라 전체를 본다
async function sheet(dir: string, file: string) {
  if (!fs.existsSync(dir)) return;
  const num = (f: string) => +(f.match(/(\d+)\.jpg$/)?.[1] ?? 1);
  const imgs = await Promise.all(fs.readdirSync(dir).filter(f => f.endsWith(".jpg")).sort((a, b) => num(a) - num(b)).map(f => loadImage(path.join(dir, f))));
  const W = 700, H = Math.max(...imgs.map(i => i.height * W / Math.max(...imgs.map(j => j.width)))), gap = 16, cols = 2;
  const c = createCanvas(cols * W + (cols + 1) * gap, Math.ceil(imgs.length / cols) * (H + gap) + gap);
  const x = c.getContext("2d");
  x.fillStyle = "#8a8a8a"; x.fillRect(0, 0, c.width, c.height);
  const scale = W / Math.max(...imgs.map(j => j.width));
  imgs.forEach((im, i) => {
    const w = im.width * scale, h = im.height * scale;
    const left = gap + (i % cols) * (W + gap) + (im.width < Math.max(...imgs.map(j => j.width)) * 0.75 ? (W - w) / 2 : 0);
    x.drawImage(im, left, gap + Math.floor(i / cols) * (H + gap), w, h);
  });
  fs.writeFileSync(file, c.toBuffer("image/png"));
}

if (process.argv[1] === import.meta.filename) for (const p of process.argv.slice(2)) {
  const r = await check(p);
  console.log(`넘침 ${r.overflow.length}, 빠진 사실 ${r.missing.length}, 어긋난 규칙 ${r.rules.filter(x => x.status === "어긋남").length}`);
  for (const x of r.rules.filter(x => x.status === "어긋남" || x.status === "예외")) console.log("  " + line(x));
  if (r.missing.length) console.log("  빠진 사실: " + r.missing.join(", "));
}
