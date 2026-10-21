// validate: 와이어프레임·페이지 맵·테마를 조판 전에 규칙으로 검사한다.
//   node validate/index.ts <프로젝트 폴더>
// layout을 먼저 돌린다. 조판해야 잴 수 있는 규칙은 "잴 수 없음"으로 남는다(check가 잰다).
import { layout } from "../layout/index.ts";
import { collect } from "../rules/vars.ts";
import { evaluate, loadRules, type Result } from "../rules/engine.ts";

export async function validate(project: string, pdf?: (f: string) => Promise<any>) {
  const { vars, lang } = await collect(project, pdf);
  return loadRules().map((r: any) => evaluate(r, vars, lang)) as Result[];
}

export const line = (r: Result) => {
  const got = r.got ? ` (${r.got})` : "", score = r.kind === "점수" && r.score != null ? ` 점수 ${r.score}` : "";
  const where = r.where ? ` — ${r.where.slice(0, 8).join(", ")}${r.where.length > 8 ? ` 외 ${r.where.length - 8}곳` : ""}` : "";
  return `${r.id} ${r.status}${got}${score}${where}  ${r.rule}`;
};

if (process.argv[1] === import.meta.filename) for (const p of process.argv.slice(2)) {
  const l = layout(p);
  for (const e of l.errors) console.log(`문제: ${e}`);
  const rs = await validate(p);
  for (const r of rs.filter(r => r.status === "어긋남")) console.log(line(r));
  const n = (s: string) => rs.filter(r => r.status === s).length;
  console.log(`규칙 ${rs.length}개: 통과 ${n("통과")}, 어긋남 ${n("어긋남")}, 값 없음 ${n("값 없음")}, 잴 수 없음 ${n("잴 수 없음")}, 가이드 ${n("가이드")}`);
}
