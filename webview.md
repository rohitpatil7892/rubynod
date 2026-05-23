# Rubynod AI — Chat Webview Design (Cursor + Continue Style)

## Goal

Build a modern AI coding assistant chat UI similar to:

- GitHub Copilot Chat
- Continue.dev
- Cursor Agent

Optimized for:

- Ollama local models
- VS Code extension
- Agent workflows
- Multi-file editing
- Context visibility
- Trust & transparency

---

# Full Webview Layout

```text
┌────────────────────────────────────────────┐
│ HEADER                                     │
├────────────────────────────────────────────┤
│ CONTEXT BAR                                │
├────────────────────────────────────────────┤
│ CHAT + AGENT ACTIVITY AREA                 │
│                                            │
│                                            │
│                                            │
├────────────────────────────────────────────┤
│ ATTACHMENTS                                │
├────────────────────────────────────────────┤
│ INPUT / COMPOSER                           │
├────────────────────────────────────────────┤
│ FOOTER STATUS                              │
└────────────────────────────────────────────┘
```

---

# 1. Header Section

## Position

Top of webview.

Always fixed.

Height:

```text
50–60px
```

## Purpose

Show:

- current mode
- selected model
- quick actions
- settings access

## Layout

```text
┌────────────────────────────────────┐
│ Rubynod     Agent ▼      ⚙️        │
│ qwen3-coder:14b                    │
└────────────────────────────────────┘
```

## Components

### Left

App branding.

```text
Rubynod
```

Optional logo.

---

### Center

Mode switcher.

```text
Ask ▼
```

Modes:

```text
Ask
Edit
Agent
Debug
```

### Mode Behavior

#### Ask

Read-only.

No edits.

Good for:

```text
Explain code
Answer questions
Architecture help
```

#### Edit

Single-file changes.

Good for:

```text
Refactor function
Fix issue
```

#### Agent

Multi-step workflow.

Can:

```text
Read files
Edit files
Run tools
Verify changes
```

#### Debug

Focuses on:

```text
Errors
Logs
Stack traces
Diagnostics
```

---

### Right

Quick actions.

```text
+ New Chat
🕘 History
⚙️ Settings
```

---

### Model Label

Below header.

Example:

```text
qwen3-coder:14b • Agent Ready
```

Alternative:

```text
Ollama Connected
```

---

# 2. Context Bar

## Position

Below header.

Sticky.

Always visible.

## Purpose

Show what AI currently sees.

Critical for trust.

Without this users think:

> Why did AI change random files?

## Layout

```text
[@auth.ts ✕]
[@jwt.ts ✕]
[@git ✕]
[@codebase ✕]
[@diagnostics ✕]
```

## Supported Chips

### File

```text
@auth.ts
```

Manual attachment.

---

### Folder

```text
@backend
```

Folder context.

---

### Codebase

```text
@codebase
```

Semantic retrieval enabled.

---

### Git

```text
@git
```

Changed files.

---

### Diagnostics

```text
@diagnostics
```

TypeScript/lint problems.

---

### Terminal

```text
@terminal
```

Optional.

---

## Interaction

Hover:

```text
auth.ts
315 lines
modified recently
```

Click:

Open preview.

Remove:

```text
✕
```

---

# 3. Chat Area

## Position

Main center area.

Largest section.

Scrollable.

Contains:

- messages
- plans
- activities
- diffs
- approvals
- errors

---

## User Message

Right aligned.

Example:

```text
Add JWT authentication
```

Simple bubble.

---

## Assistant Message

Left aligned.

Example:

```text
I found your auth flow.

JWT middleware does not exist.

I can create it.
```

---

## Code Blocks

Example:

```ts
const token = jwt.sign(...)
```

Buttons:

```text
Copy
Insert
Apply
```

---

# 4. Plan View

## Position

Inside assistant response.

Before editing.

Only in:

```text
Agent mode
```

## Purpose

Show execution plan.

Very important for Ollama.

Improves reliability.

## Layout

```text
Plan

1. Inspect auth flow
2. Install dependency
3. Add middleware
4. Protect routes
5. Verify build

[Approve]
[Edit Plan]
[Cancel]
```

---

## Recommended Setting

Default:

```text
Plan Before Execution = ON
```

---

# 5. Agent Activity Timeline

## Position

Below plan.

During execution.

## Purpose

Show what agent is doing.

Makes slow models feel smart.

Builds trust.

## Layout

```text
Activity

✓ Retrieved auth.ts
✓ Found middleware
✓ Installed dependency
⏳ Running lint
```

Expandable:

```text
View Details ▼
```

Detailed example:

```text
Retrieved:
auth.service.ts

Tool:
read_file

Result:
Success
```

---

# 6. File Change View

## Position

After edits.

## Purpose

Show modified files.

## Layout

```text
Modified Files

auth.ts
+20 -2

jwt.ts
+30 -0
```

Buttons:

```text
View Diff
Accept
Reject
```

---

# 7. Diff View

## Position

Expandable card or modal.

## Purpose

Trust before applying changes.

## Example

```diff
+ import jwt from "jsonwebtoken"

+ const token = jwt.sign(...)
```

Buttons:

```text
Accept
Reject
Accept All
```

---

# 8. Terminal Approval View

## Position

Inline card.

Shown before command execution.

## Layout

```text
Rubynod wants to run:

npm install jsonwebtoken

[Approve]
[Deny]
```

After execution:

```text
Terminal Output

added 17 packages
```

---

## Safe Mode

Default:

```text
ON
```

Block:

```text
rm -rf
curl | sh
sudo
fork bomb
```

---

# 9. Error Card

## Position

Inline response.

## Purpose

Show failures clearly.

## Example

```text
Build Failed

TS2304:
Cannot find module jwt
```

Button:

```text
Fix Automatically
```

---

# 10. Attachments Area

## Position

Above composer.

## Purpose

Show attached files.

## Layout

```text
[auth.ts ✕]
[jwt.ts ✕]
[schema.sql ✕]
```

Horizontal scroll.

---

## Drag State

When dragging files:

```text
━━━━━━━━━━━━━━━━━━━━
Drop files here
━━━━━━━━━━━━━━━━━━━━
```

Highlighted border.

---

# 11. Input / Composer

## Position

Bottom.

Sticky.

## Layout

```text
┌──────────────────────────┐
│ Type message...          │
│ @ file   /commands       │
└──────────────────────────┘
```

---

## Features

### @ Mention

```text
@file
@codebase
@git
@folder
```

---

### Slash Commands

```text
/explain
/fix
/refactor
/debug
```

---

### Send Button

```text
↑
```

---

### Model Quick Switch

Optional:

```text
qwen ▼
```

---

# 12. Footer Status Bar

## Position

Bottom fixed.

Height:

```text
28–35px
```

## Purpose

Quick health visibility.

## Layout

```text
Ollama ✅
Index Ready ✅
4.2k / 16k tokens
2.3s
```

## Show

### Ollama

```text
Connected
Disconnected
```

### Index

```text
Ready
Indexing
Paused
```

### Context

```text
4.2k / 16k
```

### Latency

```text
2.3s
```

Useful for local models.

---

# Suggested Component Structure

```text
webview/
├── Header.tsx
├── ContextBar.tsx
├── ChatMessages.tsx
├── MessageBubble.tsx
├── CodeBlock.tsx
├── PlanView.tsx
├── ActivityTimeline.tsx
├── FileDiff.tsx
├── TerminalApproval.tsx
├── ErrorCard.tsx
├── AttachmentBar.tsx
├── Composer.tsx
├── FooterStatus.tsx
└── ChatLayout.tsx
```

---

# Build Priority

## P0

Must have:

```text
Header
Chat
Context chips
Attachments
Composer
Footer
```

---

## P1

Important:

```text
Plan view
Activity timeline
Diff preview
Terminal approval
```

---

## P2

Later:

```text
History
Logs
Debug timeline
Quick model switch
```

---

# Final UI Blueprint

```text
┌────────────────────────────────────┐
│ Rubynod      Agent ▼      ⚙️       │
│ qwen3-coder:14b                    │
├────────────────────────────────────┤
│ [@auth.ts] [@git] [@codebase]     │
├────────────────────────────────────┤
│ User                               │
│ Add JWT auth                       │
│                                    │
│ Assistant                          │
│ Plan                               │
│ 1. Inspect auth                    │
│ 2. Add middleware                  │
│ [Approve]                          │
│                                    │
│ Activity                           │
│ ✓ Read auth.ts                     │
│ ✓ Installed package                │
│ ⏳ Running lint                    │
│                                    │
│ Modified Files                     │
│ auth.ts +20 -2                     │
│ [View Diff]                        │
│                                    │
├────────────────────────────────────┤
│ [auth.ts ✕] [jwt.ts ✕]            │
├────────────────────────────────────┤
│ Type message...                    │
├────────────────────────────────────┤
│ Ollama ✅ Index ✅ 4k/16k          │
└────────────────────────────────────┘
```