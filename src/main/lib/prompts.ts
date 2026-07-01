// Claude Code 에 보내는 프롬프트 빌더.
// 핵심 원칙: AI 는 "탐색·생성"만, 판정은 결정적(Playwright assertion)에 맡긴다.
// 따라서 프롬프트는 항상 "코드를 실제로 읽고 근거에 기반해" 결과 '파일을 직접 쓰라'고 지시한다.

/** 모든 테스트 생성 프롬프트가 공유하는 가드레일 (셀렉터 유일성·근거·로그인 상태). */
export const TEST_GUARDRAILS = `# 테스트 작성 가드레일 (필수)
## 셀렉터 유일성 (strict-mode 위반 방지) — 가장 흔한 실패 원인
- 클릭/입력/**단언** 모두, 셀렉터는 **정확히 1개 요소**에 매칭돼야 한다.
- ⚠️ getByRole 의 name 과 getByText 의 텍스트는 **기본이 '부분일치'** 라, 짧은 이름이 더 긴 이름의 부분문자열이면 둘 다 잡힌다 (예: '상담 신청' 이 제목 '상담 신청하기' 의 부분 → 2개 매칭 → strict-mode 위반).
- 따라서 **getByRole 의 name 에는 기본적으로 { exact: true } 를 붙여라.** (부분일치가 의도적으로 꼭 필요한 경우만 예외.) getByText 도 정확한 전체 문자열이나 컨테이너 스코프로 유일하게.
- 그래도 여러 개면 컨테이너로 스코프(section/nav 안에서 getByRole). .first()/.nth() 로 억지 회피는 지양.
## 근거 기반 (추측 금지)
- 텍스트·개수·라우트·역할(role)·구조(footer=contentinfo 등)를 '추측'하지 말고 코드에서 확인한 것만 단언한다.
  랜드마크 role(contentinfo/navigation 등)은 실제 DOM 노출이 불확실하니, 확신 없으면 getByText 등 직접 셀렉터를 쓴다.
## 로그인 상태
- auth(로그인)가 켜진 프로젝트에서는 모든 테스트가 '로그인된 세션(storageState)'으로 실행된다.
- 따라서 '미인증/로그아웃 상태의 동작'(로그인 폼 노출, 접근 거부 등)을 검증하는 테스트는 그 test 안에서
  세션을 비워야 한다: test.use({ storageState: { cookies: [], origins: [] } }) 를 그 describe/test 에 적용.`


/** grounding 인덱스(진짜 셀렉터/라우트)를 생성 프롬프트에 주입 → 셀렉터 환각 방지 */
export function indexHeader(index: {
  testids: string[]
  ariaLabels: string[]
  routes: string[]
}): string {
  if (!index.testids.length && !index.ariaLabels.length && !index.routes.length) return ''
  const list = (arr: string[], n: number): string =>
    arr.length ? arr.slice(0, n).map((x) => `\`${x}\``).join(', ') : '없음'
  return `# 프로젝트 실제 셀렉터·라우트 (이 목록 안에서만 사용 — 없는 것 지어내기 절대 금지)
## data-testid (${index.testids.length})
${list(index.testids, 120)}
## aria-label (${index.ariaLabels.length})
${list(index.ariaLabels, 120)}
## 라우트 (${index.routes.length})
${list(index.routes, 120)}

셀렉터는 위 실제 값을 우선 사용한다. 목록에 없으면 코드를 Read 해서 확인하고, 그래도 없으면 test.fixme 로 두되 **절대 지어내지 않는다**. (없는 testid/aria-label/route 를 쓴 테스트는 거부됨)
────────────────────────────────────────────────────────

`
}

/** known-world(시드된 결정적 상태)를 생성 프롬프트에 주입 → 정확한 값 단언 가능 */
export function seedHeader(knownWorld: string): string {
  const body = knownWorld.trim()
  if (!body) return ''
  return `# 시드 데이터 (known-world) — 테스트는 이 결정적 상태를 전제로 한다
${body}

위 known-world 의 정확한 값(개수·ID·이름 등)을 단언에 활용하라. 데이터가 없다고 test.fixme 로 빼지 말 것.
────────────────────────────────────────────────────────

`
}

export function seedAnalysisPrompt(args: { outPath: string }): string {
  return `너는 테스트 데이터 엔지니어다. 프로젝트의 시드/스키마를 분석해 '결정적 known-world' 문서를 만든다. (DB 를 실행/변경하지 말 것 — 읽기·분석만)

# 작업
1. 시드/스키마를 Read/Grep 한다: prisma/seed*.ts, drizzle, migrations, scripts/seed*, package.json 의 db:seed 류 스크립트, schema.prisma 등.
2. 시드가 만드는 '결정적 엔티티'를 파악한다: 관리자/유저 계정(이메일·역할), 핵심 레코드의 개수·이름·ID, 지점/카테고리 등 고정값.
3. 테스트 전 상태를 만드는 setup 명령을 추정한다 (예: "npm run db:seed").

# 출력 (이 파일을 Write)
경로: ${args.outPath}
형식 (마크다운):
# Known World (시드 결정적 상태)
## 계정
- 관리자: <이메일> / 역할 <...> (비번은 시드 기본값 또는 env)
## 핵심 데이터
- <엔티티>: <개수>개 — <이름/ID 예시>
## setup 명령
- <추정 명령> (⚠️ 반드시 테스트 DB 를 대상으로)

# 규칙
- 코드에서 확인한 것만. 추측은 "(확인 필요)" 표기.
- 파일만 쓰고, result 의 마지막 줄에 "SETUP: <추정 명령>" 한 줄을 적는다.`
}

export function strengthenPrompt(args: { targets: string; testsDir: string }): string {
  return `너는 Playwright 테스트 품질 엔지니어다. 아래 '약한/공허한' 테스트들을 '진짜 값/상태를 검증하는 강한 단언'으로 다시 쓴다. 단, 거짓 통과를 만들지 않는 것이 최우선이다.

# 강화 대상 (각: 파일 · 테스트명 · 사유)
${args.targets}

# 작업
1. 각 대상 테스트를 해당 spec 파일에서 찾아, 그 테스트 '안에서만' 단언을 강화한다 (다른 테스트·구조는 건드리지 말 것).
2. 약한 단언(toBeVisible/toBeAttached 등 '존재 확인')을 가능한 곳에서 '값 단언'으로 교체·추가한다:
   - 텍스트: toHaveText/toContainText, URL: toHaveURL, 입력값: toHaveValue, 개수: toHaveCount, 상태: toBeChecked/toBeDisabled 등.
3. **기대값은 반드시 '근거 있는 리터럴'로 쓴다**:
   - 위의 grounding 인덱스(실제 셀렉터/라우트)와 known-world(시드 데이터의 고정 값·개수·계정)에서 확인된 값만 사용.
   - 코드/시드에서 값을 확정할 수 없으면 **지어내지 말 것**. 그 경우 그 단언은 그대로 두거나, 확정 가능한 다른 강한 단언을 추가한다.

# 절대 금지 (가짜 강함)
- 같은 변수끼리 비교 금지: const t = await el.textContent(); expect(el).toHaveText(t) ← 항상 통과 = 공허. 기대값은 독립적인 리터럴이어야 한다.
- expect(true)/expect(1) 같은 리터럴 단언 추가 금지.
- 단언을 약화하거나 삭제해서 통과시키지 말 것.

# 깨뜨리지 마라 (가장 중요)
- 강화한 단언은 **실제로 통과할 값·흐름**이어야 한다. 그 값이 화면에 '언제/어떤 조건'에서 나타나는지(트리거·타이밍)를 코드로 확인하고, 그 흐름을 정확히 재현해라.
- 확신이 없으면 **강화하지 말고 원본을 그대로 둬라.** (통과하던 약한 테스트를 깨진 강한 테스트로 바꾸는 건 최악)

${TEST_GUARDRAILS}

# 출력
- ${args.testsDir} 의 spec 파일들을 Edit/Write 로 '제자리 수정'.
- result 에는 수정한 파일과 강화한 테스트 수만 요약.`
}

export function seedScriptPrompt(args: { seedDir: string; outFile: string }): string {
  return `너는 테스트 시드 데이터 엔지니어다. 이 프로젝트의 DB 스키마를 읽고, E2E 테스트가 의존하는 '최소한의 현실적인' 시드 데이터를 넣는 실행 가능한 스크립트를 만든다.

# 작업
1. DB 스키마/ORM 을 Read/Grep 으로 파악한다: prisma/schema.prisma, drizzle, 기존 prisma client 위치(lib/prisma, db, server/db 등), package.json.
2. 각 모델/테이블에 최소 1~3건의 '현실적인' 테스트 데이터를 넣는 스크립트를 작성한다:
   - 관계/외래키 순서를 지켜 삽입 (부모 먼저).
   - **재실행 안전(idempotent)**: 넣기 전에 해당 테스트 데이터를 비우거나(deleteMany) upsert 로 처리해, 여러 번 돌려도 중복/오류가 없게.
   - 프로젝트의 **기존 client 를 재사용**한다 (예: import { PrismaClient } from '@prisma/client' 또는 프로젝트의 lib/prisma). 새 ORM 도입 금지.
   - **DATABASE_URL 은 환경변수에서 읽는다 (절대 하드코딩 금지)**. 실행 시 .env 가 주입된다고 가정.
   - 끝에 한 번 client.\$disconnect() 호출하고, 성공 시 넣은 건수를 console.log 한다.
   - 에러 시 비-0 종료 (process.exit(1)).

# 출력
- 파일 1개만 Write: ${args.outFile}
- 모듈 형식은 프로젝트 package.json 의 "type" 에 맞춘다. 불확실하면 ESM(.mjs 확장자라 import 사용).
- 파일 맨 위에 주석으로 경고: "// ⚠️ 테스트 DB 전용. DATABASE_URL 이 가리키는 DB 에 시드를 넣는다(기존 테스트 데이터 삭제 가능). 프로덕션 DB 금지."

# 규칙
- 스키마에서 확인한 실제 모델·필드명만 사용 (지어내지 말 것).
- 필수(required) 필드는 빠짐없이 채운다. enum/형식 제약을 지킨다.
- 파일만 쓰고, result 에는 만든 파일 경로 + 모델별 건수 요약만 적는다.`
}

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

# 테스트 설계 기법 (누락 방지 — 각 입력/조건에 반드시 적용)
해피패스(정상 흐름)만 만들면 안 된다. 아래 블랙박스 기법으로 입력 공간을 빠짐없이 도출하고, 각 항목 끝에 적용한 기법을 대괄호 태그로 붙인다.
1. **[EP] 동등분할**: 각 입력을 '유효 클래스' + '무효 클래스들'로 나눠, 각 클래스마다 최소 1케이스. (예: 필수 입력 → 채운 경우 / 빈 경우 / 형식 틀린 경우)
2. **[BVA] 경계값**: 길이·개수·수치·범위 제약이 있으면 경계 '바로 아래 / 정확히 / 바로 위'를 각각 케이스로. (예: 최소 1자면 0자/1자, 최대 100이면 100/101)
3. **[DT] 결정표**: 조건이 2개 이상 얽히면 조건 조합(참/거짓)마다 기대결과를 나열 — 특히 '무효 조합'(비회원+대상, 미로그인+권한필요 등)을 빼먹지 말 것.
4. **[ST] 상태전이**: 상태가 바뀌는 흐름(모달 열림/닫힘, 대기→진행→완료, 로그인/아웃)이면 정상 전이 + 잘못된 전이(중복 제출, 진행 중 재클릭 등)를 포함.
⚠️ 단, 제약(경계값·조건)은 **코드/요구사항에서 실제로 확인된 것만** 적용한다. 확정 못 하는 제약은 지어내지 말고 넘어간다(거짓 케이스 방지).

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
- 항목 수는 기능 복잡도에 맞춰(보통 6~20개). 정상 흐름 + 무효/경계/조합/상태전이 케이스를 위 기법대로 포함(해피패스 편중 금지).
- 각 항목 끝에 적용 기법 태그([EP]/[BVA]/[DT]/[ST]) 표기. 순수 정상 흐름은 태그 없이 둬도 된다.
- 셀렉터 힌트는 코드에서 실제로 확인한 것만 적는다. 없으면 "(확인 필요)" 라고 표기.
- 파일만 쓰고, 마지막 result 에는 무엇을 만들었는지 1~2줄 요약만.`
}

export function flowTestsPrompt(args: { gaps: string; testsDir: string }): string {
  return `너는 시니어 QA 엔지니어다. '커버리지가 안 닿은 파일들'을 보고, 그 파일들이 속한 '사용자 흐름(flow)'을 찾아 **그 흐름의 E2E 테스트**를 만든다. (함수 단독 테스트 금지 — 흐름을 타면 그 코드들이 자연히 덮인다)

# 안 덮인 파일 (gap)
${args.gaps}

# 작업
1. 위 파일들을 Read/Grep 해서 어떤 '사용자 흐름/기능'에 속하는지 파악한다. .qa/intent, .qa/requirements 도 참고.
   - 관련 파일들을 flow 로 묶는다 (예: refund.ts + RefundModal.tsx → "환불").
   - 어떤 flow 에도 안 속하는 순수 유틸/죽은 코드는 테스트하지 말고, result 에 "unreachable: <파일>" 로 보고한다.
2. 임팩트 큰 under-covered flow 1~3개를 골라 E2E 테스트를 만든다:
   - 그 flow 의 사용자 시나리오를 페이지에서 실제로 수행(이동·클릭·입력)해 해당 코드가 실행되게 한다.
   - characterization(현재 동작 고정) 스타일. 명백한 에러 상태(500 등)는 단언 금지.
   - 로그인/시드 필요하면 test.fixme() + 사유.

# 출력 (${args.testsDir} 안에 code-flow-<flow>.spec.ts 파일들을 Write)
- import { test, expect } from '@playwright/test', page.goto 상대경로.
- 셀렉터는 코드에서 확인. 기존 테스트와 중복 말 것.
- 파일만 쓰고 result 에는 만든 flow·테스트 수 + unreachable 개수만.

${TEST_GUARDRAILS}`
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
- 파일만 쓰고 result 에는 만든 파일 수·테스트 수·[undocumented] 개수만 요약.

${TEST_GUARDRAILS}`
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
  return `너는 Playwright self-healing 전문가다. 깨진 테스트를 먼저 '분류'하고, **셀렉터 드리프트만** 고친다. 회귀는 절대 고치지 않는다.

# 입력
- 깨진 spec: ${args.specPath}
- 실패 내역(에러 메시지):
${args.failures}

# ⚠️ 너는 테스트를 '실행'할 수 없다 (Bash 없음)
- 실행해서 검증하려 하지 마라. Read/Grep 으로 코드를 읽고, **위 에러 메시지만으로** 판단해 **바로 수정(Edit/Write)** 한다.
- 특히 'strict mode violation ... resolved to N elements' 에러는 Playwright 가 정답 셀렉터(예: { exact: true })까지 알려주므로, 실행 없이 확정적으로 고칠 수 있다.
- 수정을 미루거나 '승인/실행이 필요하다'고 대기하지 마라 — 확정되면 즉시 파일을 고치고 HEALED 로 보고한다.

# 1단계: 분류 (가장 중요)
spec 과 프로젝트 코드를 Read/Grep 해서 각 실패가 무엇인지 판정:
- **드리프트(DRIFT)**: DOM/셀렉터만 바뀌고 '검증하려는 동작·상태는 그대로 존재'. (버튼 id 변경, 텍스트 약간 변경, 구조 리팩터)
- **셀렉터 모호(AMBIGUOUS)**: 'strict mode violation ... resolved to N elements' — 셀렉터가 여러 요소에 매칭. 요소들은 멀쩡히 존재하므로 코드 버그가 아니라 '테스트 셀렉터 결함'이다. → 드리프트처럼 고친다.
- **로그인 상태(AUTH-STATE)**: auth 세션 때문에 '미인증/로그아웃 상태의 동작'(로그인 폼 노출 등)을 검증하는 테스트가 이미 로그인돼 실패. 코드 버그 아님 → 그 test 에 세션 비우기 적용.
- **회귀(REGRESSION)**: 검증하려던 요소/상태가 '실제로 사라지거나 동작이 깨짐'. (제출 버튼이 아예 없어짐, 성공 메시지가 안 뜸)

# 2단계: 처리
- **드리프트면**: 깨진 셀렉터만 현재 코드에 맞게 교체. assertion 의 '검증 의도'는 절대 그대로.
- **셀렉터 모호면**: Playwright 에러가 알려준 후보 요소들을 보고, '원래 의도한 하나'에만 매칭되게 셀렉터를 좁힌다 — getByRole(..., { exact: true }) 또는 컨테이너 스코프. 의도한 요소는 spec 의 test 제목·주석으로 판단.
  ⚠️ 에러난 그 줄만 고치지 말고, **이 파일의 모든 getByRole(name)/getByText 를 점검**해 같은 부분문자열 모호성이 있으면 (클릭이든 단언이든 helper 함수든) **함께 { exact: true } 로 좁혀라.** (한 줄 고치면 다음 줄에서 또 strict-mode 가 터지는 연쇄를 한 번에 막는다.)
- **로그인 상태면**: 그 test/describe 에 test.use({ storageState: { cookies: [], origins: [] } }) 를 추가해 로그아웃 상태로 실행되게 한다. (단언 자체는 유지)
- **회귀면**: **파일을 절대 수정하지 않는다.** 그냥 두고 REAL_BUG 로 보고. (회귀를 초록으로 만들면 안 됨)
- 확신 없으면 회귀로 간주하고 안 고친다.

# 절대 금지
- 통과시키려고 assertion 약화/삭제/주석처리, 의도와 다른 단언으로 교체 (거짓 통과).
- 회귀인데 셀렉터를 바꿔 억지로 통과.

# result 출력 (반드시 이 형식, 한 줄로 시작)
- 고침(드리프트/셀렉터 모호/로그인 상태): "HEALED: <무엇을 어떻게 좁혔/고쳤는지 한 줄>"
- 회귀(안 고침): "REAL_BUG: <사라진 요소/깨진 동작>"
- 못 고침/불확실: "SKIPPED: <사유>"`
}

export function testsPrompt(args: {
  checklistId: string
  checklistPath: string
  checklistTitle: string
  checklistContent: string
  specOutPath: string
  baseURL: string
}): string {
  return `너는 Playwright 테스트 자동화 전문가다. 이 체크리스트는 '하나의 개발 범위(기능)'의 합격기준이다. 이걸 **그 기능이 범위대로 완료·작동하는지 검증하는 '흐름(flow) 단위 인수 테스트'**로 변환한다. (항목별 파편 테스트 ❌ — 흐름 단위 시나리오 ⭕)

# 입력 — 체크리스트 (내용을 아래에 그대로 준다. 이 파일을 다시 Read 하지 말 것)
- 기능: ${args.checklistTitle}
- 경로(참고용): ${args.checklistPath}
- 테스트 baseURL: ${args.baseURL}
--- 체크리스트 내용 시작 ---
${args.checklistContent}
--- 체크리스트 내용 끝 ---

# 핵심 원칙 — 흐름 단위로 두껍게
- 체크리스트 항목 하나하나를 개별 test() 로 쪼개지 마라. 대신 **이 기능의 '사용자 흐름'을 파악**해, test.describe('<기능 이름>') 안에 **시나리오 test() 3~6개**로 묶는다.
- 시나리오 구성(있는 것만):
  1) **정상 흐름(해피패스)**: 시작→입력→실행→결과→후속상태 까지 '한 test 안에서 끝까지' 이어서 진행하고, 단계마다 강한 값 단언.
  2) **핵심 예외**: 검증 에러 / 빈 상태 / 경계값.
  3) **권한·인증**: 로그인 필요/거부 등 (해당 시).
- 체크리스트의 모든 Given/When/Then 항목은 이 시나리오들의 단계·단언으로 **빠짐없이 커버**돼야 한다(단, 1:1 test 로 나열하지 말고 흐름에 녹여라).

# 셀렉터·단언
- 셀렉터는 체크리스트 힌트를 출발점으로, 프로젝트 코드를 Read/Grep 해서 확정한다(getByRole/getByTestId/getByText). 추측 금지. 여러 개 매칭되면 { exact:true } 나 더 좁은 셀렉터로 유일하게.
- 단언은 '진짜 값/상태'를 검증한다: toHaveText/toHaveURL/toHaveValue/toHaveCount 등. 단순 toBeVisible 로 끝내지 말고 흐름의 각 단계 결과를 값으로 확인.

# 출력 (반드시 이 파일을 Write)
경로: ${args.specOutPath}
- import { test, expect } from '@playwright/test'  (TypeScript)
- test.describe('<이 기능/flow 이름>') 로 감싸고, 그 안에 시나리오 test() 들.
- test 제목은 시나리오(예: '정상 발주 → 재고 차감', '재고 부족 시 거부')로. 체크리스트 항목명 그대로 나열 금지.
- page.goto('/path') 상대경로(baseURL 주입됨).

# 규칙
- 불필요한 wait/sleep 금지. auto-waiting + web-first assertion 사용.
- 셀렉터/값을 코드에서 확정 못 한 시나리오는 test.fixme() + 사유 주석(거짓 통과 방지).
- 파일만 쓰고, result 에는 만든 시나리오 수와 fixme 수만 요약.

${TEST_GUARDRAILS}`
}
