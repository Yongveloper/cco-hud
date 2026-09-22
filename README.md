# cco-hud

개인용 Claude Code 상태줄 플러그인. [claude-ultimate-hud](https://github.com/hadamyeedady12-dev/claude-ultimate-hud) 1.6.0 포크 (MIT).

```
🤖 Opus │ ███░░░░░░░ │ 25% │ 50K/200K │ 5시간: 5% (3시44분) │ 7일: 전체 71% (2일5시) │ Fable: 69%
📁 cco-hud git:(master) │ 1 CLAUDE.md │ 7 MCPs │ 13 hooks
```

## 원본 대비 변경

- **7일 한도 리셋 카운트다운** — `seven_day.resets_at` 를 `N일N시` 로 표시 (하루 미만이면 `N시N분`).
- **모델 스코프 주간 한도** — usage API `limits[]` 의 `weekly_scoped` 항목(예: Fable)을 `모델명: N%` 로 표시.
- 캐시/설정 파일 접두어 `cco-hud-*`, 설정 파일 `~/.claude/cco-hud.local.json`.

## 설치

```bash
# 로컬 클론에서
claude plugin marketplace add /path/to/cco-hud
claude plugin install cco-hud@cco-hud

# GitHub에서
claude plugin marketplace add yongveloper/cco-hud
claude plugin install cco-hud@cco-hud
```

`~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "bash -c '\"$HOME/.bun/bin/bun\" \"$(ls -td ~/.claude/plugins/cache/cco-hud/cco-hud/*/ | head -1)src/index.ts\"'"
}
```

`~/.claude/cco-hud.local.json`:

```json
{ "language": "ko", "plan": "max200", "cache": { "ttlSeconds": 60 } }
```

## 개발

```bash
bun x tsc --noEmit          # 타입체크 (Bun 전역 타입 오류 2건은 기존 이슈)
echo '{"model":{"display_name":"Opus"},"cwd":".","transcript_path":"","context_window":{"context_window_size":200000,"current_usage":{"input_tokens":50000,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"cost":{"total_cost_usd":0.5}}' | bun src/index.ts
```

소스 수정 후 설치본 반영: `claude plugin update cco-hud`.
