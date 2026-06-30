---
scope: tests,healing
---

# Playwright 테스트 규칙
- 셀렉터 우선순위: getByRole > getByLabel > getByTestId > getByText. CSS/xpath 는 최후수단.
- 불필요한 wait/sleep 금지. web-first assertion(auto-waiting)을 사용한다.
- 셀렉터를 코드에서 확정 못 한 항목은 test.fixme() 로 두고 사유를 주석에 남긴다.
- 테스트 제목은 체크리스트 항목과 1:1 로 대응시킨다.
