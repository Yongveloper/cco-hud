# cco-hud

Claude Code 상태줄(statusLine) 플러그인. 한도·컨텍스트·프로젝트·진행 중인 작업을 터미널 하단 몇 줄로 보여준다.

```
Fable 5.1 e:hi θ 캐시 98% │ ████░░░░░░ 40% 402K/1M │ 5시간: 29% (2시54분) │ 7일: 74% (1일18시) · Fable: 76% │ $11.0
▸ cco-hud 세션 이름… ⎇ master* ↑1 │ 1 CLAUDE.md · 7 MCPs · 13 hooks │ ⏱ 56m │ +38 −0
◐ Bash: 테스트 실행… │ ✓ Bash×17 · Write×2
◐ general-purpose “데이터 계층 구현” 3m07s
```

[claude-ultimate-hud](https://github.com/hadamyeedady12-dev/claude-ultimate-hud) 1.6.0 을 포크해 만든 개인용 버전이다. 원본과 다른 점은 [원본 대비 변경](#원본-대비-변경) 참고.

---

## 목차

- [설치](#설치)
- [설정](#설정)
- [화면 읽는 법](#화면-읽는-법)
- [동작 방식](#동작-방식)
- [문제 해결](#문제-해결)
- [개발](#개발)
- [원본 대비 변경](#원본-대비-변경)

---

## 설치

**필요한 것**: Claude Code 2.1.251 이상, [Bun](https://bun.sh).

### 1. 플러그인 설치

```bash
claude plugin marketplace add Yongveloper/cco-hud
claude plugin install cco-hud@cco-hud
```

로컬 클론에서 쓰려면 `Yongveloper/cco-hud` 대신 클론한 디렉터리 경로를 넣는다.

### 2. 상태줄 연결

`~/.claude/settings.json` 에 추가:

```json
"statusLine": {
  "type": "command",
  "command": "bash -c '\"$HOME/.bun/bin/bun\" \"$(ls -d ~/.claude/plugins/cache/cco-hud/cco-hud/*/ | sort -V | tail -1)src/index.ts\"'",
  "refreshInterval": 60
}
```

- `refreshInterval: 60` — 메시지를 보내지 않아도 1분마다 다시 그린다. 없으면 리셋 카운트다운이 멈춘 것처럼 보인다.
- Bun 경로가 다르면 `$HOME/.bun/bin/bun` 을 `which bun` 결과로 바꾼다.

### 3. 플랜·언어 설정

`~/.claude/cco-hud.local.json` 생성:

```json
{
  "language": "ko",
  "plan": "max200"
}
```

Claude Code를 재시작하면 하단에 상태줄이 뜬다.

---

## 설정

`~/.claude/cco-hud.local.json`. 모든 키는 선택 사항이다.

| 키 | 기본값 | 설명 |
|---|---|---|
| `language` | `"ko"` | `"ko"` / `"en"` / `"auto"` (시스템 로케일 따름) |
| `plan` | `"max100"` | `"pro"` / `"max100"` / `"max200"` / `"enterprise"`. 7일 한도 표시 여부와 비용 표시 방식이 달라진다 |
| `cache.ttlSeconds` | `300` | 사용량 API 재조회 주기(초). 짧을수록 Fable 한도가 자주 갱신되지만 API 호출이 늘어난다 |
| `display.showTools` | `true` | 3행 도구 활동 |
| `display.showAgents` | `true` | 서브에이전트 목록 |
| `display.showTodos` | `true` | 할 일 진행률 |
| `display.showStats` | `true` | 2행 끝의 사고 중·스킬·라인 변경 수 |
| `display.showTokenBreakdown` | `true` | 컨텍스트 85% 이상일 때 in/cache 토큰 내역 |
| `display.showCost` | `true` | 세션 비용 `$` |
| `display.showBadges` | `true` | 모델명 옆 배지(effort·thinking·캐시 히트율) |

전부 켠 예시:

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

---

## 화면 읽는 법

### 1행 — 모델·컨텍스트·한도

```
Fable 5.1 e:hi θ 캐시 98% │ ████░░░░░░ 40% 402K/1M │ 5시간: 29% (2시54분) │ 7일: 74% (1일18시) · Fable: 76% │ $11.0
```

| 항목 | 의미 |
|---|---|
| `Fable 5.1` | 현재 모델 |
| `e:hi` | effort level. `lo` / `md` / `hi` / `xh` / `mx` |
| `fast` | fast mode 켜짐 (켜졌을 때만 표시) |
| `θ` | extended thinking 켜짐 |
| `캐시 98%` | prompt cache 히트율. 70% 미만이면 노랑 — 컨텍스트 앞부분이 자주 바뀌고 있다는 신호 |
| `████░░░░░░ 40% 402K/1M` | 컨텍스트 사용량. 80% 이상 `⚠ /compact`, 90% 이상 빨강 |
| `5시간: 29% (2시54분)` | 5시간 한도 사용률, 괄호는 리셋까지 남은 시간 |
| `7일: 74% (1일18시)` | 7일 한도 사용률과 리셋까지 남은 일·시 |
| `Fable: 76%` | 모델별 주간 한도 (Max 플랜만). 현재 모델의 한도가 전체와 따로 잡히는 경우 |
| `⚠ 한도까지 1시20분` | 최근 소진 속도로 계산했을 때 리셋 전에 100%에 도달할 것으로 예상되면 표시 |
| `$11.0` | 이 세션의 누적 비용 |

**색 규칙**: 사용률은 50% 이하 초록, 80% 이하 노랑, 그 위 빨강. 현재 실제로 걸려 있는 한도(`is_active`)는 굵게 표시된다.

### 2행 — 프로젝트

```
▸ cco-hud 세션 이름… ⎇ master* ↑1 ⌂ feat-x PR #12 ✓ │ 1 CLAUDE.md · 7 MCPs · 13 hooks │ ⏱ 56m │ ∴ 사고 중 │ ◇ skill명 │ +38 −0
```

| 항목 | 의미 |
|---|---|
| `▸ cco-hud` | 레포 이름 (없으면 디렉터리 이름) |
| `세션 이름…` | Claude Code가 붙인 세션 이름 (30칸에서 잘림) |
| `⎇ master* ↑1 ↓2` | 브랜치. `*` 미커밋 변경, `↑` push 안 한 커밋, `↓` pull 안 한 커밋 |
| `⌂ feat-x` | git worktree 이름 (worktree 안에서만) |
| `PR #12 ✓` | 열린 PR과 리뷰 상태. `✓` approved, `✗` changes requested, `○` 대기 |
| `1 CLAUDE.md · 7 MCPs · 13 hooks` | 적용 중인 설정 파일 수 |
| `⏱ 56m` | 세션 경과 시간 |
| `∴ 사고 중` | 모델이 thinking 중 |
| `◇ skill명` | 마지막으로 호출한 스킬 |
| `+38 −0` | 세션에서 추가·삭제한 코드 라인 |

### 3행 이후 — 활동

```
◐ Bash: 테스트 실행… │ ✓ Bash×17 · Write×2 · ✗ Edit×1
◐ general-purpose “데이터 계층 구현” 3m07s
✓ Explore·haiku “렌더 구조 조사” 1m21s
▸ 2/5 트랜스크립트 파서 수정…
```

| 기호 | 의미 |
|---|---|
| `◐` | 실행 중 (도구는 대상 파일·설명, 에이전트는 경과 시간) |
| `✓` | 완료. 도구는 종류별 횟수로 묶는다 |
| `✗` | 오류로 끝남 |
| `▸ 2/5 …` | 할 일 진행률(완료/전체)과 현재 진행 중인 항목 |

---

## 동작 방식

**자동 축약** — 행이 터미널 폭을 넘으면 우선순위가 낮은 항목부터 하나씩 빼고 다시 그린다. 폭이 좁아져도 `5시간: 29% (2시54분) │ 7일: 74%` 는 마지막까지 남는다.

- 1행 제거 순서: 배지 → 토큰 수 → 바 축소(6칸) → 비용 → 7일 리셋 시간 → Fable/소넷
- 2행 제거 순서: 세션 이름 → 스킬 → 설정 파일 수 → stats → 세션 시간

**데이터 출처**

| 정보 | 출처 |
|---|---|
| 5시간·7일 한도, 컨텍스트, 비용, 배지, PR, worktree | Claude Code가 상태줄에 넘겨주는 stdin JSON |
| 모델별 주간 한도(Fable), 병목 한도 여부 | `api.anthropic.com/api/oauth/usage`. 토큰은 `~/.claude/.credentials.json` 에서 읽는다. `plan: pro` 면 호출하지 않음 |
| 소진 속도 예측 | `~/.claude/cco-hud-usage-history.json` 에 6시간치 사용률 샘플을 쌓고, 현재 윈도우 안의 샘플로 선형 추정 |
| 도구·에이전트·할 일 | 세션 트랜스크립트(`.jsonl`) 증분 파싱 |

캐시 파일은 모두 `~/.claude/cco-hud-*.json`. 지워도 다음 렌더에 다시 만들어진다.

---

## 문제 해결

**상태줄이 안 보인다**
`settings.json` 의 명령을 터미널에서 직접 실행해 본다. 에러 없이 빈 출력이면 stdin이 없어서 그런 것이니 정상. `bun: command not found` 면 Bun 경로를 고친다.

**`? limits` 라고 나온다**
stdin에 `rate_limits` 가 없고 API도 실패한 상태. Claude Code 2.1.251 이상인지, `claude login` 상태인지 확인.

**Fable 한도가 안 나온다**
`plan` 이 `max100`/`max200` 이어야 한다. `pro` 는 7일 그룹 자체를 표시하지 않는다.

**카운트다운이 갱신되지 않는다**
`statusLine.refreshInterval` 이 빠져 있다. 없으면 새 메시지가 올 때만 다시 그린다.

**`⚠ 한도까지 …` 가 비정상적으로 짧게 나온다**
픽스처로 테스트 실행을 섞으면 히스토리가 오염된다. `rm ~/.claude/cco-hud-usage-history.json` 후 5분 이상 두면 정상화.

**플러그인을 업데이트했는데 그대로다**
`claude plugin update` 는 버전이 같으면 갱신하지 않는다. 최신 버전 디렉터리가 `~/.claude/plugins/cache/cco-hud/cco-hud/` 아래에 있는지 확인하고 Claude Code를 재시작한다.

---

## 개발

```bash
git clone https://github.com/Yongveloper/cco-hud && cd cco-hud
bun install
bun x tsc --noEmit                                    # 타입체크 (Bun 전역 타입 오류 2건은 기존 이슈)
bun src/index.ts < test/fixtures/stdin.json           # 실측 stdin 픽스처로 렌더
COLUMNS=80 bun src/index.ts < test/fixtures/stdin.json   # 좁은 폭 자동 축약 확인
```

`test/fixtures/stdin.json` 은 Claude Code 2.1.278이 실제로 넘긴 stdin을 캡처한 것이다.

**설치본에 반영하기**: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json` 의 `version` 을 올리고 `claude plugin update cco-hud`. 상태줄 명령이 `sort -V` 로 최신 버전 디렉터리를 고르므로 이전 버전 디렉터리는 지워도 된다.

**구조**

| 경로 | 역할 |
|---|---|
| `src/index.ts` | stdin·설정 읽기, 데이터 수집 병렬 실행 |
| `src/utils/rate-limits.ts` | stdin 네이티브 한도 + 사용량 API 병합, 소진 속도 계산 |
| `src/utils/transcript.ts` | 트랜스크립트 증분 파싱 (도구·에이전트·할 일) |
| `src/render/` | 행별 렌더. `index.ts` 가 자동 축약 루프 담당 |
| `src/constants.ts` | 임계값, 표시 개수 상한, 축약 순서(`TRIM`) |
| `src/utils/i18n.ts` | 한국어·영어 라벨 |

---

## 원본 대비 변경

claude-ultimate-hud 1.6.0 기준.

- 7일 한도 리셋까지 남은 시간을 일·시 단위로 표시
- 모델별 주간 한도(Fable 등) 표시 — 사용량 API `limits[]` 의 `weekly_scoped` 파싱
- 소진 속도 기반 한도 도달 예상 경고
- 5시간/7일 한도를 Claude Code stdin의 `rate_limits` 에서 우선 읽음 (API 의존 축소)
- stdin 필드 경로 수정 — 라인 변경 수·세션 시간이 실제로 표시됨
- 백그라운드 서브에이전트가 1초 만에 완료로 뜨던 버그 수정 (실제 완료 알림 기준)
- effort·thinking·prompt cache 배지, 전 플랜 비용 표시, 세션 이름·worktree·PR 상태
- 폭에 따른 자동 축약, 이모지 대신 기호 사용
- 설정·캐시 파일 접두어 `cco-hud-*`

라이선스: MIT (원본 저작권 표시 유지).
