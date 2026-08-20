# Prompt for a local AI coding agent

Copy the prompt below into an AI coding agent that has shell access to the real local checkout. The synchronization stage is mandatory because the local repository and GitHub may contain materially different work.

```text
Ты работаешь как senior TypeScript/Deno security/runtime engineer в реальном локальном checkout репозитория OpenCode RLM на NixOS.

КЛЮЧЕВОЕ УСЛОВИЕ: локальный repository и GitHub repository сейчас могут сильно отличаться. НЕ НАЧИНАЙ разработку, Nix setup, npm install, тесты, рефакторинг или исправления кода, пока не исследуешь и безопасно не синхронизируешь обе стороны.

Главная цель состоит из двух последовательных частей:
1. безопасно объединить все релевантные локальные и GitHub изменения без потери данных и получить понятную синхронизированную feature branch;
2. только после этого проверить текущую ветку на реальной машине, исправить подтверждённые дефекты, довести доступные gates до зелёного состояния и собрать точный evidence report.

Критические правила:
1. Никогда не считай GitHub автоматически более правильным, чем local checkout, и наоборот.
2. Не теряй uncommitted, local-only или remote-only изменения.
3. Не используй `git reset --hard`, `git clean -fd`, `git restore .`, force push, `--force-with-lease`, массовое удаление веток или слепое разрешение конфликтов через `ours`/`theirs`.
4. Не merge PR в main, не закрывай PR/issues, не меняй draft/ready state и не удаляй branches в рамках этой задачи.
5. Обычный non-force push текущей feature branch разрешён только как финальный шаг синхронизации после проверки точного diff/commit set; если remote успел измениться после fetch, сначала снова интегрируй изменения и только потом push.
6. Не обновляй `@opencode-ai/plugin` / `@opencode-ai/sdk` до завершения baseline-проверки текущих pinned версий.
7. Не ослабляй security limits, permission model, context deny rules, sandbox isolation, turn budgets или regression tests ради зелёного теста.
8. Не считай pathname TOCTOU проблему решённой: `docs/known-limitations.md` остаётся авторитетной границей до descriptor-relative/openat-style redesign.
9. Не используй ground truth или benchmark manifests как model context во время реальных benchmark inference arms.
10. Если инструмент отсутствует (Deno, Docker, OpenCode, credentials), не имитируй успешный результат. Зафиксируй blocker и продолжи всё, что можно выполнить независимо.
11. Любой найденный дефект сначала воспроизведи или докажи по коду, затем внеси минимальный исправляющий patch и regression test.
12. После каждого исправления повтори наиболее узкий релевантный test, затем соответствующий gate.

==================================================
STAGE 0 — ОБЯЗАТЕЛЬНАЯ СИНХРОНИЗАЦИЯ LOCAL ↔ GITHUB
==================================================

0.1. Убедись, что это правильный repository.

Выполни:

pwd
git rev-parse --show-toplevel
git remote -v
git status --short --branch
git branch --show-current
git rev-parse HEAD
git log --oneline --decorate -20

Ожидаемый GitHub repository:

arttvad9r/RLM

Если `origin` указывает на другой repository, не переписывай remote вслепую. Сначала установи причину и зафиксируй blocker.

0.2. Зафиксируй все локальные изменения до fetch/integration.

Выполни:

git status --porcelain=v1
git diff
git diff --staged
git ls-files --others --exclude-standard

Запиши:
- исходную branch;
- исходный HEAD;
- tracked modifications;
- staged modifications;
- untracked files.

Если worktree грязный, создай recoverable safety state:

BACKUP_BRANCH="backup/pre-sync-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_BRANCH" HEAD
git stash push -u -m "pre-sync safety snapshot"
git stash list
git status --short

Если имя branch конфликтует, выбери другое уникальное имя.

НЕ удаляй safety branch/stash, пока синхронизация и восстановление локальной работы не подтверждены.

Если worktree clean, всё равно сохрани исходный SHA в отчёте.

0.3. Получи фактическое состояние GitHub.

Выполни:

git fetch --all --prune
git remote show origin
git branch -vv
git status --short --branch
git rev-parse origin/main

Для текущей hardening работы проверь наличие:

origin/fix/consolidate-audit-hardening

Если branch существует:

git rev-parse origin/fix/consolidate-audit-hardening

Если доступен `gh`, используй read-only inspection:

gh repo view
gh pr view 30

Не выполняй GitHub write-actions на этом этапе.

0.4. Определи реальное расхождение истории.

Для актуальной feature branch выполни:

git merge-base HEAD origin/<branch>
git rev-list --left-right --count HEAD...origin/<branch>
git log --oneline --left-right --graph HEAD...origin/<branch>
git log --oneline origin/<branch>..HEAD
git log --oneline HEAD..origin/<branch>
git diff --stat HEAD..origin/<branch>
git diff --stat origin/<branch>..HEAD

Также сравни feature branch с main:

git rev-list --left-right --count origin/main...HEAD

Классифицируй состояние строго как одно из:
A. local == remote;
B. local только behind;
C. local только ahead;
D. local и remote diverged;
E. релевантная работа находится в другой local branch;
F. любой из вариантов плюс сохранённый stash/uncommitted work.

Не меняй историю, пока эта классификация не установлена.

0.5. Интегрируй безопасно.

A. Если local == remote:
ничего с историей не делай.

B. Если local только behind:

git merge --ff-only origin/<branch>

C. Если local только ahead:
сначала внимательно проверь local-only commits и diff. Не push'ь случайные/unrelated commits.

D. Если histories diverged:
- изучи обе стороны;
- сохрани обе группы релевантных commits;
- предпочитай normal merge на feature/integration branch;
- не делай reset/rebase опубликованной истории только ради красоты;
- конфликты разрешай содержательно после чтения обеих версий.

Допустимый подход после анализа:

git merge origin/<branch>

Если безопаснее, создай временную integration branch от текущего состояния и объединяй там. Не уничтожай исходные refs.

0.6. Верни сохранённый local work.

Если создавался stash:

git stash apply <stash>
git status
git diff
git diff --staged

Используй `apply`, не `pop`, пока результат не проверен.

Если возникают конфликты, разрешай их семантически. Не теряй remote или local функциональность.

0.7. Перед публикацией проверь итоговый branch.

Выполни:

git status --short --branch
git log --oneline --decorate -20
git diff
git diff --check
git fetch origin
git rev-list --left-right --count HEAD...origin/<branch>
git log --oneline origin/<branch>..HEAD

Убедись, что commits, которые собираешься публиковать, относятся только к нужной синхронизации/feature work.

0.8. Если после интеграции local содержит нужные commits, которых нет на GitHub, синхронизируй feature branch обычным non-force push:

git push origin HEAD:<branch>

Запрещено:
- `git push --force`;
- `git push --force-with-lease`;
- push в `main`;
- merge PR;
- изменение unrelated remote branches.

0.9. После push немедленно подтвердить синхронизацию:

git fetch origin
git rev-list --left-right --count HEAD...origin/<branch>
git status --short --branch

Для синхронизированной branch ожидается:

0 0

Если remote снова изменился параллельно — НЕ перезаписывай его. Повтори fetch → compare → integration.

0.10. Сформируй промежуточный synchronization report:
- initial local branch;
- initial local SHA;
- initial remote SHA;
- local-only commit count;
- remote-only commit count;
- были ли uncommitted changes;
- backup branch/stash;
- integration method;
- conflicts и их resolution;
- final synchronized branch;
- final synchronized SHA;
- final `HEAD...origin/<branch>` count.

ТОЛЬКО когда intended local branch и GitHub feature branch синхронизированы и `HEAD...origin/<branch>` показывает `0 0`, переходи к разработке.

==================================================
STAGE 1 — ПРОЧИТАТЬ АКТУАЛЬНЫЙ REPOSITORY ПОСЛЕ SYNC
==================================================

После синхронизации прочитай:
- README.md
- docs/README.md
- docs/local-development.md
- docs/runtime-invariants.md
- docs/known-limitations.md
- docs/session-lifecycle.md
- docs/resource-envelope.md
- benchmarks/README.md
- package.json
- package-lock.json
- scripts/check-runtime.mjs
- scripts/check-standalone.mjs

Проверяй именно синхронизированное состояние. Не опирайся на предположения о старой local или GitHub версии.

==================================================
STAGE 2 — NIXOS / RUNTIME ENVIRONMENT
==================================================

Пользователь работает на NixOS. Предпочитай reproducible project-local development environment (`nix develop`/flake), а не глобальную установку Node/Deno в `/etc/nixos/configuration.nix`.

Сначала проверь, есть ли уже:
- flake.nix;
- flake.lock;
- shell.nix;
- default.nix;
- .envrc.

Если синхронизированный repository уже содержит подходящий maintained Nix environment — используй/исправляй его, не создавай конкурирующий.

Если Nix environment отсутствует и задача включает его реализацию, добавь простой maintained `flake.nix` + `flake.lock` после baseline анализа repository.

Dev shell должен предоставлять compatible:
- Node 24.x;
- npm;
- Deno 2.x;
- Git.

Exact reproducible reference остаётся:
- Node 24.19.0;
- Deno 2.9.5.

Не создавай хрупкие custom derivations только ради exact patch versions, если nixpkgs даёт совместимые 24.x/2.x; exact pair уже проверяется container gate.

Не запускай npm install/tests автоматически из shellHook.
Не делай Docker daemon частью dev shell.
Не изменяй `/etc/nixos/configuration.nix` ради проекта.

После входа в environment выполни:

node --version
npm --version
deno --version
git --version
docker version
opencode --version
node scripts/check-runtime.mjs --exact

Если exact check не проходит, но Node 24.x/Deno 2.x совместимы, зафиксируй это как compatibility environment, а не exact-baseline evidence.

==================================================
STAGE 3 — PINNED DEPENDENCIES
==================================================

Выполни:

rm -rf node_modules
npm ci --ignore-scripts
git status --short

Установка не должна менять tracked files. Если `package.json` или lockfile меняются без намеренного действия — расследуй причину.

==================================================
STAGE 4 — HOST GATE
==================================================

Выполни:

npm run gate:host

Если есть failure:
- локализуй конкретный test/typecheck/verifier;
- прочитай implementation и regression;
- определи: implementation bug, stale fixture, environment issue или documentation drift;
- внеси минимальную правку;
- добавь/исправь regression;
- повтори узкий test;
- затем снова `npm run gate:host`.

Не продолжай к широким изменениям, пока host gate не объяснён.

==================================================
STAGE 5 — DENO SANDBOX BOUNDARY
==================================================

Выполни отдельно:

npm run typecheck:runner
npm run test:plugin

Особенно проверь:
- Worker `permissions: "none"`;
- отсутствие usable filesystem/network/env/process authority;
- authenticated runner frames;
- private MessagePort RPC;
- host stdin EOF fail-closed behavior;
- generated Worker error normalization;
- oversized results/protocol requests;
- cancellation/transport settlement.

Не делай heuristic workaround для Deno version difference, пока не установлен root cause.

==================================================
STAGE 6 — AUTHORITATIVE LOCAL GATE
==================================================

Выполни:

npm run gate:local

PASS должен быть привязан к точному `git rev-parse HEAD`.

==================================================
STAGE 7 — CONTAINER GATE
==================================================

Если Docker доступен:

npm run gate:container

Проверь, что image использует exact Node 24.19.0 + Deno 2.9.5 и реально запускает `npm test`.

Если Docker unavailable — статус `SKIPPED/BLOCKED`, не PASS.

==================================================
STAGE 8 — REAL OPENCODE SMOKE TEST
==================================================

Создай отдельный disposable workspace без реальных секретов.

Проверь через реально загруженный RLM plugin:
1. простой deterministic `rlm_exec`;
2. `context.read` обычного файла;
3. denial `.env`;
4. denial `secret.pem`;
5. denial symlink escape `escape/passwd -> /etc/passwd`;
6. generated code не получает usable `Deno/process/Worker/MessageChannel`;
7. network/fetch denied;
8. `llm(...)` возвращает text и не получает обычные OpenCode tools;
9. `llm.batch` из 4 prompts завершается без deadlock;
10. cancellation non-settling `rlm_exec`, после чего следующий маленький exec работает и budget/lifecycle освобождён.

Зафиксируй:
- OpenCode version;
- `@opencode-ai/plugin` version;
- `@opencode-ai/sdk` version;
- provider/model;
- RLM SHA;
- PASS/FAIL каждого case.

Если pinned SDK 1.1.26 несовместим с установленным OpenCode, сначала локализуй incompatibility. Не обновляй SDK в той же baseline работе автоматически.

==================================================
STAGE 9 — SDK COMPATIBILITY ОТДЕЛЬНО
==================================================

Только после понятного pinned baseline и если это действительно требуется:

npm view @opencode-ai/plugin version
npm view @opencode-ai/sdk version

SDK migration делай в отдельной branch, exact-pin обе зависимости и повторяй полный local/container/OpenCode smoke sequence.

Не смешивай SDK upgrade с unrelated hardening.

==================================================
STAGE 10 — BENCHMARK VALUE GATE
==================================================

Для оценки реальной полезности RLM нужны четыре настоящих arms:
- 192 normal;
- 192 RLM;
- 384 normal;
- 384 RLM.

Для всех arms держи одинаковыми source revision, model/provider/variant, prompt и experiment config. Отличается только доступность RLM.

Ground truth/manifests не должны попадать в model context.
RLM arm обязан иметь telemetry реального `rlm_exec`.

Сохрани raw runs, score JSON, comparison JSON, suite JSON, token usage, cost и wall time.

Вывод делай по quality + scaling + cost/latency.

==================================================
STAGE 11 — DEPLOYMENT ENVELOPE
==================================================

Если машина Linux/cgroup v2 и есть реальный OpenCode/RLM service process:
- применяй controls из `docs/resource-envelope.md`;
- выполни:

npm run verify:resource-envelope -- --root-pid <service-root-pid>

- сохрани JSON evidence;
- отдельно проведи deliberate resource-limit termination/recovery.

Repository tests сами по себе не доказывают hard OS isolation.

==================================================
STAGE 12 — FINAL AUDIT
==================================================

После всех исправлений:

git status --short
git diff --check
git diff
git rev-parse HEAD
git fetch origin
git rev-list --left-right --count HEAD...origin/<branch>

Повтори все gates, затронутые изменениями.

Проверь documentation drift:
- README команды совпадают с package.json;
- `docs/local-development.md` соответствует реальным gates;
- runtime-invariants соответствует implementation;
- known-limitations не скрывает нерешённые boundaries;
- session-lifecycle соответствует реальному OpenCode поведению;
- benchmark docs не обещают эффективность без реальных arms.

Финальный report должен содержать два отдельных раздела.

A. Repository synchronization:
- initial local branch/SHA;
- initial remote branch/SHA;
- uncommitted local work;
- local-only и remote-only commits;
- backup branch/stash;
- integration method;
- conflicts;
- push result;
- final synchronized SHA;
- final `HEAD...origin/<branch>` count.

B. Development/validation:
- исходный synchronized SHA и финальный SHA/working-tree state;
- изменённые файлы и причины;
- найденные bugs и fixes;
- реально выполненные команды;
- PASS/FAIL/SKIPPED для gate:host, typecheck:runner, test:plugin, gate:local, gate:container и OpenCode smoke;
- environment versions;
- оставшиеся blockers/known limitations;
- отдельный verdict: технически готова ли ветка к merge.

Не пиши "всё работает", если на текущем SHA не прошли Deno + `gate:local` + реальный OpenCode smoke.
Не начинай разработку, если local/GitHub synchronization ещё не завершён и не подтверждён.
```

## Recommended use

Run this prompt against the real local checkout. The first deliverable is a synchronization report, not code changes. Only after the local feature branch and its GitHub counterpart are reconciled should the agent proceed into Nix/environment setup, tests, implementation fixes, OpenCode smoke testing, benchmarks, or deployment evidence.
