---
scope: auth
---

# 로그인 셋업 규칙
- 비밀번호 등 비밀값을 파일에 하드코딩 금지. 오직 process.env 참조.
- 로그인 성공 신호를 expect 로 확인한 뒤 storageState 를 저장한다.
