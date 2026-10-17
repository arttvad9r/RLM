This workspace is an evaluation corpus. Follow the user's task exactly and cover every TypeScript file in src/.

Do not use ordinary subagents. Do not access paths outside this workspace. Do not use network tools. Return exactly the JSON shape requested by the user, with no prose.

If rlm_exec is available, you MUST use it for the complete semantic analysis instead of bulk-reading the corpus with root shell/read tools. Use exactly one main rlm_exec when it succeeds; one retry is allowed only if that main call itself errors.

Inside rlm_exec, the exact generated-JavaScript API is:
- await context.files("src/") -> project-relative file paths.
- await context.readMany(paths) -> array of {path, content?, error?}, up to 64 paths per call.
- await llm.batch(prompts) -> 1-4 isolated semantic children in parallel.

When rlm_exec is available, use the following inner code exactly. In OpenCode Code Mode, place it in a template-literal string variable named code, then call return await tools.rlm_exec({code}). Do not rewrite or simplify the inner code.

const paths = await context.files("src/");
const files = [];
for (let i = 0; i < paths.length; i += 64) files.push(...await context.readMany(paths.slice(i, i + 64)));
const groups = [[], [], [], []];
for (let i = 0; i < files.length; i++) groups[i % 4].push(files[i]);
const rule = "Audit every assigned file. Report a file only when observable business, domain, or UI result state is mutated before a successful awaited asynchronous backend or worker operation completes. Loading, busy, pending, syncing, or similar lifecycle state before the await is not a violation. Result-state updates after the await, local-only mutations without backend coupling, and backend or mock adapter implementations are not violations. Return exactly one JSON array of project-relative violation paths and no prose.";
const nl = String.fromCharCode(10);
const prompts = groups.map((group) => rule + nl + group.map((file) => JSON.stringify({ path: file.path, source: file.content || "" })).join(nl));
const answers = await llm.batch(prompts);
const found = [];
for (const answer of answers) {
  const text = String(answer).trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end >= start) {
    const values = JSON.parse(text.slice(start, end + 1));
    for (const value of values) if (typeof value === "string") found.push(value);
  }
}
return { violations: [...new Set(found)].sort() };

After the main RLM result, verify only its candidate files at the root using ordinary root read/shell tools. Prefer one root tool call that reads all candidates. NEVER invoke rlm_exec for candidate verification. Remove false positives, sort the remaining paths and answer. Do not root-read non-candidates.

If rlm_exec is unavailable, solve the same task with ordinary local tools and still cover the complete workspace.
