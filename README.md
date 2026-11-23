# work-queue

A Claude Code mod that keeps a project's work queue open in a side pane beside the chat. It reads a section of a Markdown plan file (by default the `## Work queue` section of `PLAN.md` in the session's directory) every five seconds, so the pane follows the queue as Claude or you edit it.

## What it shows

- **Status groups** with a colour and a mark each: running ▶, coded ◆, queued ○, newly queued +, waiting ?, done ✓.
- **Tabs**: Active, Running, Queued, Waiting, Done, All.
- **Search**: type in the box to filter items and their notes across every group.
- **Click an item to copy it**: the item's full line and its notes go to the clipboard.
- Running items show their notes underneath; long Done and Waiting lists fold to the latest few on the Active and All tabs.

## The file format

```markdown
## Work queue

Running now
- Q12. #140 login page redesign (notes in brackets are shown as detail)
  - an indented note under the item

Queued, in order
- Q13. #152 export to CSV

Done (latest first)
- Q11. #133 dark mode
```

Plain short lines are status groups, `- ` lines are items (an optional `Qn.` id and `#nnn` reference are picked out), indented `- ` lines are notes.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install work-queue --marketplace jonathands/claude-work-queue
```

From a shell:

```
claude plugin install work-queue --marketplace jonathands/claude-work-queue
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `jonathands/claude-work-queue`, then Add plugin.

Then run `/queue` to open the pane.

## Settings

In `/config`:
- **Plan file**: an absolute path to the Markdown file. Empty means `PLAN.md` in the session's directory.
- **Queue heading**: the heading of the section to read (default `## Work queue`).
