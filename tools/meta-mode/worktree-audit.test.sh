#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(mktemp -d "${TMPDIR:-/tmp}/mstack-worktree-audit.XXXXXX")
trap 'rm -rf "$root"' EXIT

remote="$root/remote.git"
repo="$root/repo"
worktree="$root/audit-worktree"
transcripts="$root/transcripts"
fake_bin="$root/bin"

git init --bare --initial-branch=main "$remote" >/dev/null
git init --initial-branch=main "$repo" >/dev/null
git -C "$repo" config user.name "Test User"
git -C "$repo" config user.email "test@example.com"
printf 'fixture\n' > "$repo/tracked.txt"
git -C "$repo" add tracked.txt
git -C "$repo" commit -m "test fixture" >/dev/null
git -C "$repo" remote add origin "$remote"
git -C "$repo" push --set-upstream origin main >/dev/null
git -C "$repo" worktree add -b audit-worktree "$worktree" >/dev/null

mkdir -p "$transcripts" "$fake_bin"
printf '{"cwd":"%s/"}\n' "$worktree" > "$transcripts/session.jsonl"
cat > "$fake_bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '[]\n'
EOF
chmod +x "$fake_bin/gh"

output=$(PATH="$fake_bin:$PATH" MSTACK_TRANSCRIPTS_DIR="$transcripts" "$script_dir/worktree-audit.sh" "$repo")
row=$(printf '%s\n' "$output" | awk -F '\t' -v worktree="$worktree" '$9 == worktree')

[ -n "$row" ] || { printf 'missing audit row for %s\n%s\n' "$worktree" "$output" >&2; exit 1; }
[ "$(printf '%s\n' "$row" | awk -F '\t' '{print $7}')" = "$(date '+%Y-%m-%d')" ] || {
  printf 'LAST_CHAT did not contain today: %s\n' "$row" >&2
  exit 1
}
[ "$(printf '%s\n' "$row" | awk -F '\t' '{print $8}')" = "verify-recent-chat" ] || {
  printf 'recent transcript did not select verify-recent-chat: %s\n' "$row" >&2
  exit 1
}
