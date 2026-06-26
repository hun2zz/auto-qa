# Auto QA

사내 QA 자동화 데스크톱 툴. 프로젝트 폴더를 연결 → 요구사항 업로드 → AI가 합격기준 체크리스트 생성 → 사람 승인 → AI가 Playwright 테스트 생성 → 결정적 자동 실행.

**설계 원칙**: AI 는 "탐색·생성"만 한다. 합격/실패 **판정은 결정적(Playwright assertion)** 에 맡긴다.

## 동작 파이프라인

```
폴더 열기 → .qa/ 생성
요구사항 업로드 → .qa/requirements/
  ↓ [AI] claude -p (코드 탐색 근거)
체크리스트(Given/When/Then) → .qa/checklists/*.md → 사람 검토·승인
  ↓ [AI] claude -p
Playwright 테스트 → .qa/tests/*.spec.ts
  ↓ [결정적] dev서버 구동 + playwright 실행
리포트 → .qa/reports/last.json (통과/실패/스킵)
```

`.qa/` 폴더는 대상 프로젝트 안에 생성되어 git 에 같이 커밋된다 → "무엇이 바뀌었는지"가 코드 diff 로 추적된다.

## AI 인증 / 과금

- 내부적으로 **`claude -p`(Claude Code CLI)를 child_process 로 spawn** 한다.
- `ANTHROPIC_API_KEY` 를 자식 env 에서 제거해(`scrubApiKey`) **`claude login` 구독 인증을 강제**한다 → 별도 API 종량과금 없음.
- 전제: 이 머신에 Claude Code 가 설치되어 있고 `claude login` 이 되어 있어야 한다.

## 개발 / 실행

```bash
npm install          # 의존성
npm run dev          # 개발 모드 실행 (Electron)
npm run typecheck    # main + renderer 타입체크
npm run build        # 프로덕션 빌드 (out/)
```

> 최초 설치 후 Electron 바이너리가 없다는 오류(`Error: Electron uninstall`)가 나면:
> `node node_modules/electron/install.js` 로 바이너리를 받는다.

## 대상 프로젝트 설정 (.qa/config.json)

연결 후 앱의 설정(⚙️)에서 편집:

| 키 | 의미 | 예시 |
|---|---|---|
| `devCommand` | dev 서버 실행 명령 | `npm run dev` |
| `readyUrl` | 서버 준비 폴링 URL | `http://localhost:3000` |
| `baseURL` | 테스트 baseURL | `http://localhost:3000` |
| `readyTimeoutMs` | 준비 대기 한도 | `60000` |
| `auth` | (선택) 로그인 시드 | `{ loginUrl, user, passEnv }` |

## 구조

```
src/
├─ shared/types.ts        # main/preload/renderer 공유 계약(IPC API, 데이터 타입)
├─ main/
│  ├─ index.ts            # Electron 엔트리/윈도우
│  ├─ ipc.ts              # IPC 핸들러
│  └─ lib/
│     ├─ claudeRunner.ts  # claude -p spawn 래퍼 (stream-json 파싱)
│     ├─ prompts.ts       # 체크리스트/테스트 생성 프롬프트
│     ├─ projectManager.ts# .qa 스캐폴딩·체크리스트·요구사항
│     ├─ devServer.ts     # dev 서버 구동 + readyUrl 폴링
│     ├─ playwrightRunner.ts # playwright 실행 + JSON 리포트 파싱
│     └─ runner.ts        # 실행 오케스트레이션
├─ preload/index.ts       # contextBridge → window.api
└─ renderer/src/          # React + Tailwind v4 UI
```

## MVP 범위 / 다음 단계

- ✅ MVP: 폴더 연결 → 요구사항 → AI 체크리스트(승인) → AI Playwright 생성 → 실행 → 리포트
- ⏭ v2: 스냅샷/비주얼 회귀 diff + baseline 자동 저장
- ⏭ v3: self-healing 셀렉터 (UI 드리프트 자동 대응)
- ⏭ v4: 애매한 화면만 AI 단일 yes/no 판정
