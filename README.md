# cco-hud

개인용 Claude Code 상태줄 플러그인. [claude-ultimate-hud](https://github.com/hadamyeedady12-dev/claude-ultimate-hud) 1.6.0 에서 포크 (MIT).

```
Fable 5.1 e:hi θ 캐시 98% │ ████░░░░░░ 40% 402K/1M │ 5시간: 29% (2시54분) │ 7일: 74% (1일18시) · Fable: 76% ⚠ 한도까지 1시20분 │ $11.0
▸ cco-hud 세션 이름… ⎇ master* ↑1 │ 1 CLAUDE.md · 7 MCPs · 13 hooks │ ⏱ 56m │ +38 −0
◐ Bash: 설명 텍스트… │ ✓ Bash×17 · Write×2
◐ general-purpose “A: 데이터 계층” 3m07s
```

## 표시 항목

**1행 — 세션**
- 모델명 + 배지: `e:hi` effort(lo/md/hi/xh/mx), `fast`, `θ` extended thinking, `캐시 98%` prompt cache hit ratio(70% 미만 노랑)
- 컨텍스트: 바 + % + `사용/전체` 토큰. 80% 이상 `⚠ /compact`, 90% 이상 빨강. 85% 이상이면 in/cache 내역 추가
- `5시간: 29% (2시54분)`: 5시간 한도 사용률과 리셋까지 남은 시간
- `7일: 74% (1일18시) · Fable: 76%`: 7일 전체 한도 + 리셋 카운트다운(일 단위), 모델 스코프 주간 한도(usage API `limits[]` 의 `weekly_scoped`)
- `⚠ 한도까지 1시20분`: 최근 소진 속도로 리셋 전에 100% 도달 예상 시 표시
- `$6.13`: 세션 비용 (모든 플랜)

**2행 — 프로젝트**
`▸ 레포명 세션이름 ⎇ 브랜치* ↑ahead ↓behind ⌂ worktree PR #n ✓ │ 설정 파일 수 │ ⏱ 세션 시간 │ ∴ 사고 중 · ◇ skill · +추가 −삭제`

**3행 이후 — 활동**
실행 중 도구 → 완료 도구 집계 / 서브에이전트(실행 중·완료, 실제 소요 시간) / 할 일 진행률

## 색 규칙

- 사용률(%)은 항상 색: 50% 이하 초록, 80% 이하 노랑, 초과 빨강. 라벨·시간은 기본색, 배지·비용·부가 정보는 `dim`.
- 현재 병목인 한도(`is_active`)는 굵게.
- 컨텍스트 80% 이상 `⚠ /compact`, 90% 이상 그룹 전체 빨강.

## 자동 축약

터미널 폭을 넘치는 행은 우선순위가 낮은 항목부터 하나씩 빼고 다시 그린다(`constants.ts` 의 `TRIM`).

- 1행: 배지 → 토큰 수 → 바 6칸으로 축소 → 비용 → 7일 리셋 시간 → Fable/소넷
- 2행: 세션 이름 → 스킬 → 설정 파일 수 → stats → 세션 시간

핵심인 `5시간: 29% (2시54분) │ 7일: 74%` 는 마지막까지 남는다.

## 데이터 소스

- 5시간/7일 한도: Claude Code가 stdin으로 넘기는 `rate_limits` (네이티브) 우선.
- 모델 스코프 한도·`is_active`·`severity`: `api.anthropic.com/api/oauth/usage` (OAuth 토큰은 `~/.claude/.credentials.json`). `plan: pro` 면 호출 안 함.
- 소진 속도: `~/.claude/cco-hud-usage-history.json` 에 6시간치 샘플 보관, 현재 윈도우 안의 샘플만 사용.

## 설치

```bash
claude plugin marketplace add Yongveloper/cco-hud     # 또는 로컬 클론 경로
claude plugin install cco-hud@cco-hud
```

`~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "bash -c '\"$HOME/.bun/bin/bun\" \"$(ls -d ~/.claude/plugins/cache/cco-hud/cco-hud/*/ | sort -V | tail -1)src/index.ts\"'",
  "refreshInterval": 60
}
```

`refreshInterval` 이 있어야 메시지 없이도 카운트다운이 갱신됨.

`~/.claude/cco-hud.local.json`:

```json
{
  "language": "ko",
  "plan": "max200",
  "cache": { "ttlSeconds": 60 },
  "display": {
    "showTools": true, "showAgents": true, "showTodos": true, "showStats": true,
    "showTokenBreakdown": true, "showCost": true, "showBadges": true
  }
}
```

## 개발

```bash
bun install
bun x tsc --noEmit                              # Bun 전역 타입 오류 2건은 기존 이슈
cat test/fixtures/stdin.json | bun src/index.ts # 실측 stdin 픽스처로 렌더
COLUMNS=80 bun src/index.ts < test/fixtures/stdin.json   # 좁은 폭 축약 확인
```

소스 수정 후 설치본 반영: `.claude-plugin/plugin.json`·`marketplace.json`·`package.json` 버전을 올리고 `claude plugin update cco-hud`. 버전이 같으면 갱신되지 않는다. statusLine 명령은 `sort -V` 로 최신 버전 디렉터리를 고른다.
