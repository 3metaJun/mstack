// Host-native tool names belong in one dedicated reference per host. The portable
// workflow text may point at that reference but must not name the tools.
const HOST_TOOL_PATTERNS = [
  [
    "T3 Code orchestration tool",
    /\b(?:orchestrator_capabilities|delegate_task|task_status|task_cancel|create_threads|request_secret|schedule_task|run_scheduled_task_now|(?:list|update|delete)_scheduled_task|(?:link|unlink|unwatch|watch)_pull_request|list_thread_pull_requests|html_(?:preview|render))\b/,
  ],
  ["T3 Code thread tool", /\bt3_[a-z]+(?:_[a-z]+)+\b/],
  ["T3 Code preview tool", /\bpreview_[a-z]+(?:_[a-z]+)*\b/],
  ["T3 Code device tool", /\bdevice_[a-z]+(?:_[a-z]+)*\b/],
  ["T3 Code MCP server name", /\bt3-code\b|\bmcp__t3_code__/],
];

const HOST_REFERENCE_PATH = /^skills\/[^/]+\/references\/hosts\/[^/]+$/;

export function isHostReference(relativePath) {
  return HOST_REFERENCE_PATH.test(relativePath.replaceAll("\\", "/"));
}

export function hostBindingProblems(relativePath, content) {
  if (isHostReference(relativePath)) return [];
  const problems = [];
  for (const [label, pattern] of HOST_TOOL_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      problems.push(
        `${relativePath} names the ${label} \`${match[0]}\` outside skills/*/references/hosts/`,
      );
    }
  }
  return problems;
}

export const hostToolPatterns = HOST_TOOL_PATTERNS.map(([, pattern]) => pattern);
