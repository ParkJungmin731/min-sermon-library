# 나의 설교서재

브라우저에 설교를 기록하고 검색·백업하며, 인증 서버 연결 시 AI 초안을 별도로 보관하는 개인 서재입니다.

## 사용법
1. 새 설교에서 제목·본문을 작성하고 **저장하기**를 누릅니다.
2. 내 설교에서 제목·본문·성경·태그로 검색하거나 상태·청중으로 좁힙니다.
3. 삭제 대신 휴지통으로 옮깁니다. **휴지통 보기**에서 복구할 수 있습니다.
4. **백업 · 설정 → 전체 백업 다운로드**로 JSON 파일을 보관합니다.
5. 다른 기기/주소에서는 백업을 선택하고 미리보기 후 새 자료로 복원합니다. 반복 복원은 중복을 만듭니다.

자료는 현재 기기·브라우저·사이트 출처의 IndexedDB에 저장됩니다. 기존 SermonDB 및 Dexie v1(native v10)과 호환됩니다. 기존 날짜 문자열을 임의로 해석하거나 다시 쓰지 않습니다.

## GitHub Pages
별도 빌드 없이 index.html, app.js, data.js, styles.css를 같은 폴더에 제공합니다. 외부 CDN·폰트를 불러오지 않습니다. GitHub Pages에는 AI 서버가 없으므로 AI 요청문 다운로드만 활성화됩니다.

## 로컬 실행
Node.js 22 이상에서 `npm start` 후 http://127.0.0.1:3000 에 접속합니다. 기본 실행은 AI 없이 서재 기능을 제공합니다.

## AI 서버 연결
운영자가 .env.example을 참고해 환경변수를 설정합니다. 실제 비밀번호나 키를 Git에 올리지 마세요.

- OPENAI_API_KEY: 서버에서만 보관할 키
- OPENAI_MODEL: Responses API와 Structured Outputs를 지원하는, 계정에서 사용 가능한 모델 ID
- APP_PASSWORD: 16자 이상 개인 서재 비밀번호
- SESSION_SECRET: 무작위 32자 이상. `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`로 생성
- PUBLIC_ORIGIN: 공개 서버의 정확한 HTTPS 주소. 프록시에서 원래 Host를 유지해야 합니다.
- DATA_DIR: 단일 인스턴스 전용 지속 디스크 경로
- DAILY_REQUEST_LIMIT: UTC 기준 하루 요청 수. 기본 30회, 실패·시간 초과 포함

.env를 쓰면 `node --env-file=.env server.mjs`로 실행합니다. 공개 서버는 HTTPS 프록시 뒤에서 운영하고 DATA_DIR을 웹에서 제공하지 마세요. 다중 인스턴스는 지원하지 않습니다. 제공자 계정에도 지출 한도를 설정하세요. 사용량 로그의 토큰 수에 가격을 적용하기 전에는 실제 비용 수치를 표시하지 않습니다.

로그인 후 본문·의도·청중과 전송 동의를 입력하면 초안을 생성합니다. 설교 DB 전체를 자동 전송하지 않습니다. 결과는 **검토용 초안으로 별도 저장**해야 보관됩니다. 성경 해석·원어·인용은 목회자가 확인합니다.

AI 설정이 불완전하면 실행을 거부하거나 생성 버튼을 비활성화합니다. 브라우저 API 키 입력 기능은 제거했습니다. 이전 localStorage 키는 앱 시작 시 지웁니다. 실제 노출이 의심되는 키는 제공자 계정에서 교체하세요.

## 검증
- `npm ci && npm test`: 서버와 IndexedDB 데이터 보존·복원 검증
- `npx playwright install chromium && npm run test:browser`: Chromium으로 편집·저장·백업·복원·모바일 검증
- eval/cases.json 및 eval/review-template.csv: 20개 대표 요청과 검토표. 실제 AI 품질 평가는 별도 진행

[구현 범위 및 되돌리기](docs/IMPLEMENTATION.md)
