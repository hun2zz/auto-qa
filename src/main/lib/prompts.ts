// Claude Code 에 보내는 프롬프트 빌더.
// 핵심 원칙: AI 는 "탐색·생성"만, 판정은 결정적(Playwright assertion)에 맡긴다.
// 따라서 프롬프트는 항상 "코드를 실제로 읽고 근거에 기반해" 결과 '파일을 직접 쓰라'고 지시한다.

/** 모든 생성/수정 프롬프트 앞에 붙는 가드레일(.qa/RULES.md). 무신사식 "규칙 문서" 패턴. */
export function rulesHeader(rules: string): string {
  const body = rules.trim()
  if (!body) return ''
  return `# 프로젝트 QA 규칙 (.qa/RULES.md — 아래 규칙을 예외 없이 모두 준수한다)
${body}

위 규칙은 이후의 모든 지시에 우선한다. 규칙과 충돌하면 규칙을 따른다.
────────────────────────────────────────────────────────

`
}


export function auditPrompt(args: { requirementPath: string; outPath: string }): string {
  return `너는 시니어 QA 감사관이다. 요구사항의 각 기능이 '실제로 구현됐는지' 코드를 근거로 감사한다. (E2E 실행이 아니라 구현 존재 여부 감사)

# 작업
1. 요구사항 문서를 읽는다(Read): ${args.requirementPath} (PDF/이미지면 내용 파악)
2. 요구사항을 '개별 기능 항목'으로 빠짐없이 나눈다(압축 금지).
3. 각 항목마다 프로젝트 코드를 Read/Grep/Glob 해서 구현 여부를 판정한다:
   - implemented: 해당 라우트/페이지/컴포넌트/API/로직이 실제로 존재하고 동작 형태를 갖춤
   - partial: 일부만 있음(껍데기/TODO/미완성/일부 케이스 누락)
   - missing: 코드에 흔적이 없음
4. evidence 에는 판정 근거가 된 '파일 경로/심볼'을 구체적으로 적는다(없으면 사유). 추측 금지 — 코드에서 확인한 것만.

# 출력 (반드시 이 경로에 JSON 을 Write)
경로: ${args.outPath}
형식: { "items": [ { "requirement": "<항목 설명>", "status": "implemented|partial|missing", "evidence": "<파일경로/심볼 또는 사유>", "note": "<선택>" } ] }
- 항목은 가능한 한 잘게. 파일만 쓰고 result 에는 항목 수만 요약.

# 규칙
- 'implemented' 로 판정하려면 반드시 실제 코드 근거가 있어야 한다(stub/주석만 있으면 partial 또는 missing).
- 확신이 없으면 partial 로 두고 note 에 사유를 남긴다.`
}

export function testCoveragePrompt(args: {
  requirementPath: string
  testsDir: string
  outPath: string
}): string {
  return `너는 시니어 QA 감사관이다. 요구사항의 각 항목이 '테스트로 검증되고 있는지' 감사한다. (구현 여부가 아니라 '테스트 존재' 여부)

# 작업
1. 요구사항 문서를 읽는다(Read): ${args.requirementPath}
2. 요구사항을 '개별 검증 항목'으로 빠짐없이 나눈다.
3. 생성된 테스트들을 읽는다: ${args.testsDir} 의 *.spec.ts 파일들(Read/Grep).
4. 각 요구사항 항목마다 '그것을 검증하는 test 가 있는지' 판정한다:
   - implemented(=검증됨): 그 항목을 직접 검증하는 test 가 존재하고 실제 단언(expect)이 있음
   - partial(=부분): 관련 test 는 있으나 일부만 검증 / test.fixme 로 비활성 / 단언이 약함
   - missing(=미검증): 해당 항목을 검증하는 test 가 없음
5. evidence 에는 근거가 된 'spec 파일:test 제목'을 적는다(없으면 사유).

# 출력 (반드시 이 경로에 JSON 을 Write)
경로: ${args.outPath}
형식: { "items": [ { "requirement": "<항목>", "status": "implemented|partial|missing", "evidence": "<spec파일:test 또는 사유>", "note": "<선택>" } ] }
- 파일만 쓰고 result 에는 항목 수만 요약. 추측 금지 — 실제 spec 내용으로 판정.`
}

export function decomposePrompt(args: { requirementPath: string; outPath: string }): string {
  return `너는 시니어 QA 리드다. 거대한 요구사항을 '독립적으로 테스트 가능한 기능 모듈'로 빠짐없이 분해한다.

# 작업
1. 요구사항 문서를 읽는다(Read): ${args.requirementPath} (PDF/이미지면 내용을 보고 파악)
2. 프로젝트 코드를 탐색한다(Read/Grep/Glob): 라우트, 페이지, 관리자 화면, API 를 파악해 '실제 기능 단위'를 확인한다.
3. 요구사항을 테스트 모듈로 '빠짐없이' 분해한다. 압축·샘플링 금지. 잘게 쪼갤수록 좋다(20~40개도 무방).
   - 게시판 종류(수행사례/언론보도/마중소식/뉴스레터/의뢰인후기/법률칼럼/유튜브/자료실 등)는 '각각' 별도 모듈
   - "관리자에서 설정 변경 → 유저 페이지에 반영"되는 플로우는 '각각' 별도 모듈로 (노출여부 토글, 대표지정, 순서변경, 메뉴구성 등)
   - 통합검색, 상담/취재 폼, 구성원 목록/상세, 업무분야/FAQ, 인재채용, 오시는길(지도), SEO(메타/OG/sitemap/robots/canonical/schema), 301 리다이렉트, 공통 상세페이지 등 각각
   - 공통 상세페이지 기능(목차/이전다음/공유/연관콘텐츠 등)도 별도 모듈

# 출력 (반드시 이 경로에 JSON 배열을 Write)
경로: ${args.outPath}
형식: [{ "id": "kebab-case-id", "title": "한글 모듈명", "summary": "이 모듈에서 검증할 핵심 기능 1~3줄" }, ...]
- id 는 영문 kebab-case 로 고유하게. 30개를 넘기면 가장 중요한 30개로.
- 파일만 쓰고 result 에는 모듈 개수만 요약.`
}

export function checklistPrompt(args: {
  requirementName: string
  requirementPath: string
  checklistId: string
  outPath: string
  module?: { title: string; summary: string }
}): string {
  const focus = args.module
    ? `\n# 집중 모듈 (이 체크리스트는 아래 모듈만 다룬다)\n제목: ${args.module.title}\n범위: ${args.module.summary}\n이 모듈의 모든 핵심 시나리오 + 주요 엣지/에러 케이스를 빠짐없이 작성한다(보통 5~20개). 다른 모듈은 다루지 않는다.\n`
    : ''
  return `너는 시니어 QA 자동화 엔지니어다. 이 프로젝트의 실제 코드를 근거로 합격기준(acceptance criteria) 체크리스트를 작성한다.
${focus}
# 작업
1. 요구사항 문서를 읽는다(Read): ${args.requirementPath}
   - 마크다운/텍스트면 그대로, PDF면 내용을, 이미지(가이드 화면 캡처)면 화면을 보고 요구사항을 파악한다.
2. 이 프로젝트의 코드를 실제로 탐색한다(Read/Grep/Glob). 라우트, 페이지, 버튼/폼, 그리고 데이터-testid·label·텍스트 같은 "셀렉터로 쓸 단서"를 파악한다. 추측하지 말고 코드에서 확인한다.
3. 요구사항을 Given/When/Then 형식의 '검증 가능한' 합격기준으로 분해한다. 막연한 항목("잘 동작한다") 금지. 각 항목은 하나의 명확한 관찰 가능한 결과여야 한다.

# 출력 (반드시 이 파일을 Write 로 생성)
경로: ${args.outPath}
형식 (frontmatter + 마크다운):
---
id: ${args.checklistId}
title: <요구사항을 대표하는 짧은 한글 제목>
source: ${args.requirementName}
status: draft
spec: null
---

## 합격기준

- **Given** <전제> **When** <동작> **Then** <기대결과> _(셀렉터 힌트: <코드에서 찾은 실제 셀렉터/텍스트>)_
- ...

# 규칙
- 항목 5~15개. 핵심 플로우 + 주요 에러 케이스를 포함.
- 셀렉터 힌트는 코드에서 실제로 확인한 것만 적는다. 없으면 "(확인 필요)" 라고 표기.
- 파일만 쓰고, 마지막 result 에는 무엇을 만들었는지 1~2줄 요약만.`
}

export function codeTestsPrompt(args: { testsDir: string }): string {
  return `너는 Playwright characterization(특성) 테스트 전문가다. 코드를 분석해 '현재 동작을 고정'하는 회귀+커버리지 테스트를 만든다. (요구사항 정확성 판정이 아니라, 지금 동작을 박제해 회귀를 잡고 코드 커버리지를 채우는 용도)

# 작업 (속도 우선 — 전수 탐색 말고 라우트 중심으로 빠르게)
1. src/app 의 라우트(page 파일)를 중심으로 파악한다. 모든 컴포넌트를 깊게 파지 말 것 — 핵심 셀렉터만 빠르게 확인.
2. .qa/requirements 와 .qa/intent 도 훑어 '요구사항에 적힌 흐름'을 파악한다.
3. 주요 라우트/플로우마다 characterization 테스트를 만든다:
   - 페이지가 에러 없이 렌더되는지, 핵심 요소가 노출되는지 등 '관찰 가능한 현재 동작'을 단언한다.
   - 요구사항에 매핑되는 기능은 그 흐름대로.
   - **요구사항에 없는 코드/기능도 커버**한다. 그런 test 의 제목 앞에 [undocumented] 를 붙인다.
4. 로그인/시드데이터가 없어 결정적이지 않은 부분은 test.fixme() 로 두고 사유를 남긴다.

# 출력 (${args.testsDir} 안에 code-<area>.spec.ts 파일들을 Write)
- import { test, expect } from '@playwright/test'
- page.goto('/path') 상대경로 사용 (baseURL 주입됨).
- 셀렉터는 코드에서 실제로 확인. 확정 못 하면 핵심 요소 toBeVisible 수준으로.
- 영역별로 파일 분리 (예: code-public.spec.ts, code-admin.spec.ts). **3개 이내 파일**로 빠르게.

# 규칙
- 이건 '회귀' 테스트다 — 현재 동작을 단언하되, 명백한 에러 상태(500 등)를 정답으로 박제하지 말 것.
- 요구사항 기준 테스트(이미 .qa/tests 에 있는 것)와 '중복'되지 않게 — 보완·확장 위주.
- 파일만 쓰고 result 에는 만든 파일 수·테스트 수·[undocumented] 개수만 요약.`
}

export function authSetupPrompt(args: {
  loginUrl: string
  setupOutPath: string
  storageStateRel: string
  userEnv: string
  passEnv: string
  urlEnv: string
}): string {
  return `너는 Playwright 인증 셋업 전문가다. "한 번 로그인 → 세션 저장(storageState)" 셋업 테스트를 만든다.

# 작업
1. 로그인 페이지(${args.loginUrl})의 폼을 프로젝트 코드에서 실제로 Read/Grep 해 확인한다. 아이디 입력, 비밀번호 입력, 로그인 버튼의 정확한 셀렉터(getByRole/getByLabel/getByTestId)를 찾는다. 추측 금지.
2. 로그인 성공을 확정할 '관찰 가능한 신호'(예: 대시보드 URL 이동, 특정 메뉴 노출)를 코드에서 찾아 대기 조건으로 쓴다.

# 출력 (반드시 이 파일을 Write)
경로: ${args.setupOutPath}
요건:
- import { test as setup, expect } from '@playwright/test'
- 자격증명은 환경변수에서만 읽는다 (코드에 값 하드코딩 절대 금지):
  - URL: process.env.${args.urlEnv}
  - 아이디: process.env.${args.userEnv}
  - 비밀번호: process.env.${args.passEnv}
- 로그인 절차 수행 후, 성공 신호를 expect 로 확인한 다음:
  await page.context().storageState({ path: '${args.storageStateRel}' })
- setup('authenticate', async ({ page }) => { ... }) 형태.

# 규칙
- 비밀번호 등 비밀값을 파일에 절대 적지 않는다(오직 process.env 참조).
- 셀렉터를 코드에서 확정 못 하면 가장 합리적인 getByLabel/getByRole 추정을 쓰되 주석으로 표시한다.
- 파일만 쓰고 result 에는 어떤 셀렉터를 썼는지 1~2줄 요약.`
}

export function healPrompt(args: {
  specPath: string
  storageStateRel: string | null
  failures: string
}): string {
  return `너는 Playwright self-healing 전문가다. 셀렉터 변화로 '깨진' 테스트를 고친다. 테스트의 '의도'는 절대 바꾸지 않는다.

# 입력
- 깨진 spec: ${args.specPath}
- 실패 내역(에러 메시지):
${args.failures}

# 작업
1. spec 파일을 Read 한다.
2. 실패 원인이 셀렉터/로케이터가 더 이상 안 맞아서인지 판단한다. 프로젝트 코드를 Read/Grep 해 현재 올바른 셀렉터를 찾는다.
3. 깨진 셀렉터만 현재 코드에 맞는 것으로 교체한다. assertion 의 '검증 의도'(무엇을 확인하는지)는 그대로 둔다.

# 출력 (Write 로 같은 경로에 덮어쓰기)
경로: ${args.specPath}

# 규칙
- 절대 하지 말 것: 통과시키려고 assertion 을 약화/삭제, expect 를 주석처리, 의도와 다른 단언으로 교체. (거짓 통과 금지)
- 셀렉터 변화가 원인이 아니라 '진짜 버그(실제로 기능이 깨짐)'로 보이면, 고치지 말고 그대로 두고 result 에 "REAL_BUG: <사유>" 라고 적는다.
- 고쳤으면 result 에 "HEALED: <바꾼 셀렉터 요약>", 못 고쳤으면 "SKIPPED: <사유>" 로 시작하는 1~2줄 요약.`
}

export function testsPrompt(args: {
  checklistId: string
  checklistPath: string
  specOutPath: string
  baseURL: string
}): string {
  return `너는 Playwright 테스트 자동화 전문가다. 승인된 합격기준 체크리스트를 결정적인 Playwright 테스트 코드로 변환한다.

# 입력
- 체크리스트: ${args.checklistPath}
- 테스트 baseURL: ${args.baseURL}

# 작업
1. 체크리스트의 각 Given/When/Then 항목을 하나의 test() 로 변환한다.
2. 셀렉터는 체크리스트 힌트를 출발점으로 하되, 프로젝트 코드를 실제로 Read/Grep 해서 정확한 셀렉터(getByRole / getByTestId / getByText)를 확정한다. 추측 셀렉터 금지.
3. assertion 은 '관찰 가능한 결과'를 결정적으로 검증한다(URL 이동, 텍스트 노출, 요소 존재/비활성화 등). AI 판단이 아니라 expect() 로.

# 출력 (반드시 이 파일을 Write 로 생성)
경로: ${args.specOutPath}
- '@playwright/test' 사용, TypeScript.
- import { test, expect } from '@playwright/test'
- 각 test 제목은 체크리스트 항목과 1:1 대응되게.
- baseURL 은 playwright.config 에서 주입되므로 page.goto('/path') 처럼 상대경로 사용.

# 규칙
- 불필요한 wait/sleep 금지. Playwright auto-waiting + web-first assertion(expect(locator).toBeVisible() 등) 사용.
- 셀렉터를 코드에서 확정하지 못한 항목은 test.fixme() 로 두고 주석에 사유를 남긴다(거짓 통과 방지).
- 파일만 쓰고, result 에는 생성한 test 개수와 fixme 개수만 요약.`
}
