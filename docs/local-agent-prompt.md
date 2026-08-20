# Prompt for a local AI coding agent

Copy the prompt below into an AI coding agent that has shell access to a local checkout of this repository. The agent should work on the checked-out revision, not on a reconstructed copy.

```text
Ты работаешь как senior TypeScript/Deno security/runtime engineer в локальном checkout репозитория OpenCode RLM.

Главная цель: проверить текущую ветку на реальной машине, исправить только подтверждённые дефекты, довести доступные локальные gates до зелёного состояния и собрать точный evidence report. Не выдавай частичную проверку за полный успех.

Критические правила:
1. Сначала зафиксируй исходное состояние:
   - git status --short
   - git branch --show-current
   - git rev-parse HEAD
   - git log -1 --oneline
2. Не делай rebase, reset --hard, force push, merge, squash или удаление веток.
3. Не пушь изменения и не меняй состояние PR без отдельного явного разрешения пользователя.
4. Не обновляй @opencode-ai/plugin / @opencode-ai/sdk до завершения baseline-проверки текущих pinned версий.
5. Не ослабляй security limits, permission model, context deny rules, sandbox isolation, turn budgets или regression tests ради зелёного теста.
6. Не считай pathname TOCTOU проблему решённой: docs/known-limitations.md остаётся авторитетной границей до descriptor-relative/openat-style redesign.
7. Не используй ground truth или benchmark manifests как model context во время реальных benchmark inference arms.
8. Если инструмент отсутствует (Deno, Docker, OpenCode, credentials), не имитируй успешный результат. Зафиксируй blocker и продолжи всё, что можно выполнить независимо.
9. Любой найденный дефект сначала воспроизведи или докажи по коду, затем внеси минимальный исправляющий patch и regression test.
10. После каждого исправления повтори наиболее узкий релевантный test, затем соответствующий gate.

Прочитай перед работой:
- README.md
- docs/README.md
- docs/local-development.md
- docs/runtime-invariants.md
- docs/known-limitations.md
- docs/session-lifecycle.md
- docs/resource-envelope.md
- benchmarks/README.md
- package.json

Этап A — окружение и чистота checkout
Выполни:
  node --version
  npm --version
  deno --version
  git --version
  docker version
  opencode --version
  node scripts/check-runtime.mjs --exact

Ожидаемый reproducible baseline репозитория: Node 24.19.0 и Deno 2.9.5. Если версии другие, отдельно укажи это в отчёте. Node 24.x / Deno 2.x допустимы для compatibility development, но не называй это exact-baseline validation.

Проверь, что worktree не содержит неожиданных пользовательских изменений. Не трогай несвязанные файлы.

Этап B — pinned dependencies
Выполни:
  rm -rf node_modules
  npm ci --ignore-scripts
  git status --short

Установка не должна менять tracked files. Если lockfile или package.json меняются без намеренного действия — остановись и расследуй причину.

Этап C — host gate
Выполни:
  npm run gate:host

Если есть failure:
- локализуй конкретный test/typecheck/verifier;
- прочитай production implementation и соответствующий regression;
- определи, это реальный дефект implementation, устаревший fixture или проблема окружения;
- внеси минимальную правку;
- добавь/исправь regression test;
- повтори узкий test и затем npm run gate:host.

Не продолжай к широким изменениям, пока host gate не объяснён.

Этап D — Deno sandbox boundary
Выполни отдельно:
  npm run typecheck:runner
  npm run test:plugin

Особенно проверь:
- Worker permissions:none;
- отсутствие usable filesystem/network/env/process authority у generated code;
- authenticated runner frames;
- private MessagePort RPC;
- host stdin EOF fail-closed behavior;
- generated Worker error normalization;
- oversized results/protocol requests;
- cancellation/transport settlement.

Если Deno поведение отличается из-за версии, не делай heuristic workaround, пока не определишь точную API/behavioral причину.

Этап E — authoritative local gate
Выполни:
  npm run gate:local

Полный PASS этого шага должен относиться к exact git SHA, который будет указан в финальном отчёте.

Этап F — container gate
Если Docker доступен:
  npm run gate:container

Проверь, что image использует exact Node 24.19.0 + Deno 2.9.5 и что внутри контейнера реально выполняется npm test.

Если Docker отсутствует или daemon недоступен — зафиксируй blocker, не называй container gate пройденным.

Этап G — реальный OpenCode smoke test
Создай отдельный disposable workspace, не используй секретный/рабочий репозиторий.

Проверь через реальный загруженный RLM plugin:
1. rlm_exec с простым deterministic return;
2. context.read обычного файла;
3. denial для .env;
4. denial для secret.pem;
5. denial symlink escape вроде escape/passwd -> /etc/passwd;
6. generated code не получает usable Deno/process/Worker/MessageChannel;
7. fetch/network attempt denied;
8. llm(...) возвращает текст и не получает обычные OpenCode tools;
9. llm.batch из 4 независимых prompts завершается без deadlock;
10. cancellation: запусти намеренно незавершающийся rlm_exec, отмени его, затем сразу выполни маленький rlm_exec и проверь, что lifecycle/budget освобождён.

Зафиксируй:
- opencode --version;
- @opencode-ai/plugin version;
- @opencode-ai/sdk version;
- provider/model;
- git SHA RLM;
- PASS/FAIL каждого smoke case.

Если pinned SDK 1.1.26 не работает с установленным OpenCode, сначала определи точку несовместимости. Не обновляй пакеты в той же ветке автоматически.

Этап H — compatibility upgrade только после зелёного baseline
Только если pinned baseline полностью понятен и пользователь хочет проверить новый OpenCode SDK:
  npm view @opencode-ai/plugin version
  npm view @opencode-ai/sdk version

Создай отдельную ветку для SDK migration. Обновляй plugin+sdk согласованно и exact-pinned. После изменения повтори:
  npm run gate:host
  npm run typecheck:runner
  npm run test:plugin
  npm run gate:local
  npm run gate:container
  OpenCode smoke test

Не смешивай SDK upgrade с unrelated hardening fixes.

Этап I — benchmark value gate
Не ограничивайся benchmark harness tests. Для оценки полезности RLM нужны реальные четыре arms:
- 192 normal
- 192 RLM
- 384 normal
- 384 RLM

Для всех arms держи одинаковыми source revision, model/provider/variant, task prompt и experiment config; отличается только доступность RLM. Ground truth/manifests не должны попадать в model context. RLM arm обязан содержать telemetry реального rlm_exec.

Используй benchmarks/README.md и существующий harness для scoring/comparison. Сохрани raw run records, score JSON, comparison JSON, suite JSON, tokens, cost и wall time.

Вывод по benchmark формулируй через качество + scaling + cost/latency, а не только через один accuracy number.

Этап J — deployment envelope
Если машина Linux/cgroup v2 и есть реальный OpenCode/RLM service process:
- примени controls из docs/resource-envelope.md;
- выполни:
  npm run verify:resource-envelope -- --root-pid <service-root-pid>
- сохрани JSON evidence;
- отдельно проведи deliberate resource-limit termination/recovery test.

Не утверждай hard OS isolation только по repository tests.

Этап K — финальный audit
После всех исправлений:
1. git status --short
2. git diff --check
3. git diff
4. git rev-parse HEAD
5. повтори все доступные gates, затронутые изменениями.

Проверь документацию на drift:
- README команды совпадают с package.json;
- docs/local-development.md соответствует реальным gates;
- runtime-invariants описывает текущий implementation;
- known-limitations не скрывает нерешённые границы;
- session-lifecycle соответствует реальному OpenCode поведению;
- benchmark docs не обещают результат без реальных arms.

Финальный ответ пользователю должен содержать:
- исходный SHA и финальный SHA/working-tree state;
- точный список изменённых файлов и зачем;
- команды, которые реально были выполнены;
- PASS/FAIL/SKIPPED по gate:host, typecheck:runner, test:plugin, gate:local, gate:container, OpenCode smoke;
- обнаруженные реальные дефекты и их исправления;
- оставшиеся blockers/known limitations;
- отдельный verdict: готово ли изменение к merge с технической точки зрения.

Не пиши "всё работает", если не прошли Deno + local gate + реальный OpenCode smoke на текущем SHA. Если часть проверки невозможна, закончи максимально полным частичным результатом и перечисли точные команды, которые остаётся выполнить.
```

## Recommended use

For the current hardening work, give the agent the repository checkout and ask it to execute the prompt from the existing pull-request head without rebasing or upgrading the SDK first. Once the pinned baseline is green, SDK compatibility, benchmark experiments, and deployment-envelope work should remain separate evidence tracks.
