# cco-hud

개인용 Claude Code 상태줄 플러그인. [claude-ultimate-hud](https://github.com/hadamyeedady12-dev/claude-ultimate-hud) 1.6.0 에서 포크 (MIT).

```
Fable 5.1 e:hi θ 캐시 98% │ ▰▱▱▱▱▱▱▱▱▱ 13% 131K/1M │ 5시간 9% ↺3시17분 │ 7일 71% ↺2일5시 · Fable 75% ⚠ 한도까지 1시20분 │ $6.13
▸ cco-hud 세션 이름… ⎇ master* ↑1 │ 1 CLAUDE.md · 7 MCPs · 13 hooks │ ⏱ 26m │ +38 −0
◐ Bash: 설명 텍스트… │ ✓ Bash×17 · Write×2
◐ general-purpose “A: 데이터 계층” 3m07s
```

## 표시 항목

**1행 — 세션**
- 모델명 + 배지: `e:hi` effort(lo/md/hi/xh/mx), `fast`, `θ` extended thinking, `캐시 98%` prompt cache hit ratio(70% 미만 노랑)
- 컨텍스트: 바 + % + `사용/전체` 토큰. 80% 이상 `⚠ /compact`, 90% 이상 빨강. 85% 이상이면 in/cache 내역 추가
- `5시간 9% ↺3시17분`: 5시간 한도와 리셋까지 남은 시간
- `7일 71% ↺2일5시 · Fable 75%`: 7일 전체 한도 + 리셋 카운트다운(일 단위), 모델 스코프 주간 한도(usage API `limits[]` 의 `weekly_scoped`)
- `⚠ 한도까지 1시20분`: 최근 소진 속도로 리셋 전에 100% 도달 예상 시 표시
- `$6.13`: 세션 비용 (모든 플랜)

**2행 — 프로젝트**
`▸ 레포명 세션이름 ⎇ 브랜치* ↑ahead ↓behind ⌂ worktree PR #n ✓ │ 설정 파일 수 │ ⏱ 세션 시간 │ ∴ 사고 중 · ◇ skill · +추가 −삭제`

**3행 이후 — 활동**
실행 중 도구 → 완료 도구 집계 / 서브에이전트(실행 중·완료, 실제 소요 시간) / 할 일 진행률

## 색 규칙

- 정상값은 `dim`. 임계 초과만 노랑/빨강.
- 5시간·7일 한도는 **시간 대비 상대 기준**: 윈도우 경과 비율보다 15pt 이상 앞서면 노랑, 30pt 이상 또는 90% 이상이면 빨강. 리셋 정보 없으면 절대 기준(50/80).
- 현재 병목인 한도(`is_active`)는 굵게.

## Compact 모드

터미널 폭이 `display.compactWidth`(기본 100) 미만이면: 바 6칸, 토큰 수 생략, 배지는 `fast`만, 설정 파일 수·stats 생략, 7일 그룹은 `7일 71%` 만.

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
    "showTokenBreakdown": true, "showCost": true, "showBadges": true,
    "compactWidth": 100
  }
}
```

## 개발

```bash
bun install
bun x tsc --noEmit                              # Bun 전역 타입 오류 2건은 기존 이슈
cat test/fixtures/stdin.json | bun src/index.ts # 실측 stdin 픽스처로 렌더
COLUMNS=80 cat test/fixtures/stdin.json | bun src/index.ts   # compact
```

소스 수정 후 설치본 반영: `.claude-plugin/plugin.json`·`marketplace.json`·`package.json` 버전을 올리고 `claude plugin update cco-hud`. 버전이 같으면 갱신되지 않는다. statusLine 명령은 `sort -V` 로 최신 버전 디렉터리를 고른다.
