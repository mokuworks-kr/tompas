# 구조

## 세 층

| 층 | 무엇 | 어디 |
|---|---|---|
| 자산 | 규칙, 기본 테마, 와이어프레임 표기 | `tompas/references/`, git |
| 판단 | 디자이너의 선택, 에이전트의 분류·옮기기·비평 | 대화와 프로젝트의 `data/` |
| 계산 | 배치, 조판, 측정, 검사 | 엔진(`tompas/scripts/`) + InDesign |

InDesign은 출력 장비다. 글이 상자에 맞는지, 줄이 어디서 바뀌는지는 InDesign 조판 엔진만 정확히 안다(D-02). InDesign에 묶이는 것은 마지막 조판 한 층뿐이다.

## 제어 방향

디자이너 ↔ 에이전트 → 스킬(SKILL.md) → 엔진 명령 → InDesign

- 엔진은 AI를 부르지 않는다. 같은 데이터는 같은 결과를 낸다.
- 에이전트와 엔진은 `data/` 안의 파일로만 주고받는다. 에이전트는 원고 분류, 와이어프레임 텍스트, 페이지 맵, 테마를 쓰고, 엔진은 배치, 측정값, 리포트, 결과 파일을 쓴다.
- 패스트 트랙의 "채우기"(아이콘 글리프, 도식, 바탕 사진과 막)는 엔진이 아니라 그 위의 층(`fill/`)이다(D-47). 엔진은 자리를 회색으로 잡고 받은 파일을 놓기까지만 한다. 스톡 사진을 찾고 내려받는 일은 에이전트가 `fast.md`대로 한다.

## 저장소

```
CLAUDE.md, AGENTS.md   입구
docs/                  이 문서들
tompas/
├── SKILL.md           일반 트랙의 흐름과 판단 지침
├── fast.md            패스트 트랙
├── references/        rules.json(규칙), theme.json(기본 테마), wireframe.md(표기), icons.json
└── scripts/           엔진 명령(명령 목록은 SKILL.md)
archive/               아카이브 목록, 측정값, 검증 리포트, 측정 방법(원본 파일은 git 제외)
test/                  테스트 원고와 프로젝트(git 제외)
```

프로젝트 폴더의 구조는 `tompas/SKILL.md`에 있다.

## 엔진 안

| 모듈 | 하는 일 |
|---|---|
| ingest | kordoc으로 원고를 읽어 블록으로 나누고 사실을 잠근다. PDF 깨진 기호는 맥 Vision(`ocr.swift`)으로 푼다(D-40) |
| wireframe | 와이어프레임 텍스트를 읽는다 |
| layout | 격자와 와이어프레임 칸을 mm로 바꾸고 원고를 붓는다 |
| rules | 규칙의 관계 일곱 가지를 계산하고 변수를 모은다 |
| validate, check | 배치 전과 조판 뒤에 규칙을 검사한다 |
| render | InDesign 조판. ExtendScript가 `render.jsx`(흐름), `styles`, `table`, `fit`, `measure`, `util`로 나뉘어 있고, `index.ts`가 `fill/render.jsx`와 이어 붙여 AppleScript로 부른다 |
| fill | 패스트 트랙의 채우기 층. 배치 쪽(`index.ts`)과 InDesign 쪽(`render.jsx`). 데이터가 없으면 아무것도 하지 않는다 |
| candidates | 와이어프레임 후보를 견주고 나란히 조판한다 |
| measure | PDF에서 변수를 잰다. 아카이브 측정과 check가 함께 쓴다(대조 그림 `show`·`show2`는 아카이브 전용) |

## InDesign 연결

- 맥 우선. AppleScript(osascript)로 ExtendScript를 실행한다(D-25). 윈도(COM)와 UXP는 필요해질 때.
- ExtendScript에는 JSON이 없어 폴리필을 붙였다.
- 창 없이 문서를 열고 화면 갱신을 끄면 빨라진다.
- 처음 실행할 때 맥이 자동화 권한을 묻는다. 에이전트의 권한 설정에서도 InDesign 제어를 허용해야 할 수 있다.
- 조판 중에는 InDesign을 다른 작업에 쓰지 않는다.

## 다른 기기에서 쓰기

공개 저장소(`mokuworks-kr/tompas`, D-50)를 받고 `tompas/scripts/`에서 `npm install`. 필요한 것:

- 맥. 윈도에서는 원고 읽기와 배치 계산까지만 된다.
- Node 23 이상(.ts를 바로 돌린다), Adobe InDesign(2026에서 시험), 테마 서체(기본 Pretendard). 없는 서체는 render가 알린다.
- 원고와 결과물(`test/`), 아카이브 원본(`archive/files/`)은 저장소에 없다.

## 기술을 들이는 기준

무료, 로컬, 얇게. 필요해질 때까지 들이지 않는다. 엔진은 TypeScript(Node), 데이터는 JSON이다(D-23).

## 제약

### 비용 0원

새로 결제하는 것은 없다(D-04). 쓴다: Adobe 전체 앱, AI 구독, 무료 오픈소스, 로컬 실행. 쓰지 않는다: 서버, 유료 API, 유료 서비스(InDesign Server, Adobe 클라우드 API 등), 무료 티어 API(한도와 약관이 바뀌고 입력을 학습에 쓸 수 있다).

### AI 구독

- 구독은 API가 아니다. 그래서 도구는 AI를 부르지 않는다. 비대화형 호출(`claude -p` 등) 정책이 바뀌어도 흔들리지 않는다.
- 로컬 에이전트만 쓴다. 클라우드 에이전트는 이 맥의 InDesign에 닿지 않는다.
- 고객 원고를 넣기 전에 계정의 학습 활용 설정을 끈다.

### 저작권

- 레퍼런스와 아카이브에서는 규칙과 수치만 뽑는다. 그림을 복제하지 않는다.
- 아카이브 원본은 저장소에 올리지 않는다. 잰 수치와 출처 링크만 둔다.
- 고전 규칙은 원리를 우리 말로 규칙화한다. 책의 문장을 옮기지 않는다.
- 사진은 라이선스가 확인된 것만(Unsplash 무료 라이선스 등). 고객 자료가 오기 전의 임시 그림은 FPO로 표시한다.
- 저장소는 공개다. 라이선스 파일을 두지 않아 쓸 권리는 디자이너에게 남는다. 문서와 코드에는 고객 이름 대신 가명(고객A·B·C)을 쓴다(D-50).
