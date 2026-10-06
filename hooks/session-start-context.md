mstack is installed as a plugin.

For a task that touches more than one file, changes a signature other files call, involves a design choice, or is a bug with an unknown cause or a performance problem, invoke the `mstack:meta-mode` skill first. It picks the playbook and the supporting skills.

For a contained change to one file, a question, or a one-line edit, work directly and check the result on the real artifact.

When the intent is already specific, go straight to the skill: `mstack:tdd`, `mstack:architect`, `mstack:how`, `mstack:why`, `mstack:arena`, `mstack:interrogate`, `mstack:diagnosing-bugs`.

Reversible work proceeds without asking. Stop and ask before anything irreversible, such as a force-push, a deploy, data deletion, or a message to a customer.

User instructions (CLAUDE.md, AGENTS.md, direct requests) take priority over this note.
