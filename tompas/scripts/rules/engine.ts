// 규칙 엔진: rules.json의 관계 일곱 가지. 공식이 고른 값의 검사와 조판 결과의 검사에 같이 쓴다.
import fs from "node:fs";
import path from "node:path";

// 변수 값: 수 하나, 수 여럿(쪽·스프레드마다), 분포({p10, p50, p90}), 글자열(톤 순서)
// at이 있으면 값마다 붙은 이름(예: "4–5쪽")으로 어긋난 곳을 알린다
export type Value = number | number[] | string | { p10: number; p50: number; p90: number } | null | undefined;
export type Vars = Record<string, Value> & { at?: Record<string, string[]> };
export type Result = {
  id: string; rule: string; kind: string; status: "통과" | "어긋남" | "예외" | "값 없음" | "잴 수 없음" | "가이드";
  got?: string; where?: string[]; score?: number;
};

const TOL = 0.02;
const list = (v: Value): number[] => v == null ? [] : typeof v === "number" ? [v] : Array.isArray(v) ? v : typeof v === "object" ? [v.p10, v.p50, v.p90] : [];
const show = (v: Value) => v == null ? ""
  : typeof v === "object" && !Array.isArray(v) ? `${v.p10}–${v.p90}(가운데 ${v.p50})`
  : Array.isArray(v) ? (v.length > 6 ? `${Math.min(...v)}–${Math.max(...v)}` : v.join(", "))
  : String(v);
const within = (x: number, r: any) => (r.min == null || x >= r.min - 1e-9) && (r.max == null || x <= r.max + 1e-9);

export const loadRules = (file = path.resolve(import.meta.dirname, "../../references/rules.json")) =>
  JSON.parse(fs.readFileSync(file, "utf8")).layers.flatMap((l: any) => l.rules);

export function evaluate(rule: any, vars: Vars, lang: string): Result {
  const base = { id: rule.id, rule: rule.rule, kind: rule.kind };
  if (rule.kind === "가이드") return { ...base, status: "가이드" };
  const [a, b] = rule.args.map((k: string) => vars[k]);
  if (a == null || (rule.args.length > 1 && b == null && rule.rel !== "scale")) return { ...base, status: "잴 수 없음" };
  const range = rule.value && (rule.value[lang] ?? rule.value);
  const at = vars.at?.[rule.args[0]];
  let xs: number[] = [], bad: boolean[] = [], got: Value = a;

  switch (rule.rel) {
    case "range":
      xs = list(a); bad = xs.map(x => range ? !within(x, range) : false); break;
    case "ratio":
      xs = list(a).map(x => x / list(b)[0]); got = xs.map(x => Math.round(x * 100) / 100);
      bad = xs.map(x => range ? !within(x, range) : false); break;
    case "multiple":
      xs = list(a).map(x => x / list(b)[0]); got = xs.map(x => Math.round(x * 100) / 100);
      bad = xs.map(x => Math.abs(x - Math.round(x)) > TOL || (range ? !within(Math.round(x), range) : false)); break;
    case "order":
      xs = list(a); bad = xs.map((x, i) => i > 0 && x < xs[i - 1]); break;
    case "snap": {
      const lines = list(b);
      xs = list(a); bad = xs.map(x => !lines.some(l => Math.abs(l - x) < 0.2)); break;
    }
    case "scale": {
      const r = list(b)[0], body = list(vars["body.size"])[0];
      xs = list(a); bad = xs.map(x => { const n = Math.log(x / body) / Math.log(r); return Math.abs(n - Math.round(n)) > 0.05; }); break;
    }
    case "run": {
      const seq = typeof a === "string" ? a.split("") : list(a);
      let best = 0, n = 0;
      seq.forEach((s, i) => { n = i && s === seq[i - 1] ? n + 1 : 1; best = Math.max(best, n); });
      xs = [best]; got = best; bad = [range ? !within(best, range) : false]; break;
    }
  }
  if (!range && !["multiple", "order", "snap", "scale"].includes(rule.rel)) return { ...base, status: "값 없음", got: show(got) };
  const n = bad.filter(Boolean).length;
  const where = at ? at.filter((_, i) => bad[i]) : undefined;
  return { ...base, status: n ? "어긋남" : "통과", got: show(got), where: where?.length ? where : undefined, score: xs.length ? Math.round((1 - n / xs.length) * 100) / 100 : undefined };
}
