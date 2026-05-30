# momently-publisher

Momently 콘솔이 생성한 글을 사용자 본인 세션의 네이버 블로그 글쓰기 화면(SmartEditor)에 보조 입력해 주는 **Chromium 브라우저 확장**(Manifest V3, Chrome + Whale).

ADR 007 — [Naver Publisher Browser Extension](https://github.com/Sgyj-Momently/docs/blob/main/adr/007-naver-publisher-browser-extension.md).

## 핵심 원칙
- **발행 버튼 자동 클릭 절대 금지** — 필드 자동 채움까지만, 사용자가 직접 검토·발행한다. 자동화 발행과 작성 보조의 경계 안전선.
- **네이버 세션·쿠키 미접촉** — DOM 주입만 수행, 자격증명 보관 책임 0.
- **fail-closed kill switch** — 원격 config(`enabled:false`) 또는 config 조회 실패 시 즉시 비활성화.

## 진행 단계
- **7a (현재)**: scaffold + 콘솔↔확장 postMessage 핸드셰이크(echo only). 네이버 미접촉.
- 7b/7c/7d/7e: ADR 007 본문 참조.

## 보안 5계층 (핸드셰이크)
1. **target origin 명시** — 콘솔↔확장 양측에서 구체 origin 일치 시에만 수신.
2. **one-time nonce + LRU** — replay 차단.
3. **payload 스키마 검증** — 필드/크기 cap + 제어문자 sanitize.
4. **imageUrls SSRF 방지** — 내부망(169.254.169.254/localhost/사설망)·비정상 scheme 거부.
5. **위협 경계 선언** — 콘솔 origin 자체의 XSS 는 확장 보안 경계 밖(콘솔 CSP/XSS 방어가 1차).
