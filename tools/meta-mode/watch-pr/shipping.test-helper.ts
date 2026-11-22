// The slice of GitHub's GraphQL schema the shipping service depends on: the
// one required input field of each mutation, and the pull request field the
// mutation clears.
const MUTATIONS: Record<string, { input: string; clears: string }> = {
  disablePullRequestAutoMerge: {
    input: "pullRequestId",
    clears: "autoMergeRequest",
  },
  dequeuePullRequest: { input: "id", clears: "mergeQueueEntry" },
};

const MUTATION =
  /mutation\s*\w*\s*\(\s*\$id\s*:\s*ID!\s*\)\s*\{\s*(\w+)\(\s*input\s*:\s*\{\s*(\w+)\s*:\s*\$id\s*\}\s*\)/;

export function fakeGitHub(
  pullRequest: Record<string, unknown>,
  argv: readonly string[]
): { data: Record<string, unknown> } {
  const query = argv.find((arg) => arg.startsWith("query=")) ?? "";
  if (!query.includes("mutation")) {
    const selection = query.replace(/\{[^{}]*\}/g, "");
    const selected = Object.entries(pullRequest).filter(([field]) =>
      new RegExp(`\\b${field}\\b`).test(selection)
    );
    return {
      data: { repository: { pullRequest: Object.fromEntries(selected) } },
    };
  }
  const [, name = "", input = ""] = MUTATION.exec(query) ?? [];
  const contract = MUTATIONS[name];
  if (!contract) throw new Error(`not a mutation GitHub accepts: ${query}`);
  if (input !== contract.input)
    throw new Error(`${name} input requires ${contract.input}, got ${input}`);
  if (!argv.includes(`id=${pullRequest.id}`))
    throw new Error("Could not resolve to a node with the given id");
  pullRequest[contract.clears] = null;
  return { data: { [name]: { clientMutationId: null } } };
}
