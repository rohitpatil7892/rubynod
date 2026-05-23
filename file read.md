# Rubynod AI — Drag & Drop File Attachments in Chat

## Goal

Allow users to:

- Drag files into chat
- Attach multiple files
- Show attachment chips
- Remove files
- Include attachments in AI context
- Support VS Code Explorer + OS drag-drop

Example UX:

```text
┌──────────────────────────────┐
│ Explain auth issue           │
│                              │
│ [auth.ts ✕] [jwt.ts ✕]      │
│                              │
│ Type message...              │
└──────────────────────────────┘
```

---

# Expected Flow

```text
User drags file
        ↓
Webview catches drop event
        ↓
Send event to extension host
        ↓
Extension reads file safely
        ↓
Store attachment state
        ↓
Render file chips in UI
        ↓
Add file to ContextBundle
        ↓
AI receives file content
```

---

# Step 1 — Create Attachment State

Create:

```text
extensions/rubynod-ai-ui/src/chat-attachments.ts
```

Example:

```ts
export interface ChatAttachment {
  id: string;
  name: string;
  path: string;
  content?: string;
  language?: string;
  size?: number;
}
```

Create store:

```ts
export class AttachmentStore {
  private attachments: ChatAttachment[] = [];

  add(file: ChatAttachment) {
    this.attachments.push(file);
  }

  remove(id: string) {
    this.attachments = this.attachments.filter(
      a => a.id !== id
    );
  }

  getAll() {
    return this.attachments;
  }

  clear() {
    this.attachments = [];
  }
}
```

---

# Step 2 — Add Drag & Drop to Chat Webview

File:

```text
webview/chat.tsx
```

Add drop area:

```tsx
<div
  onDrop={handleDrop}
  onDragOver={(e) => e.preventDefault()}
>
  Chat UI
</div>
```

Drop handler:

```ts
const handleDrop = async (e: DragEvent) => {
  e.preventDefault();

  const files = [...e.dataTransfer.files];

  vscode.postMessage({
    type: 'filesDropped',
    files: files.map(file => ({
      name: file.name,
      path: file.path
    }))
  });
};
```

---

# Step 3 — Listen in Extension Host

File:

```text
chat-provider.ts
```

Add:

```ts
webview.onDidReceiveMessage(async (msg) => {
  switch (msg.type) {
    case 'filesDropped':
      await handleDroppedFiles(msg.files);
      break;
  }
});
```

---

# Step 4 — Read Files Safely

Create:

```text
extensions/rubynod-ai-ui/src/file-attachments.ts
```

Example:

```ts
import * as vscode from 'vscode';

export async function loadFiles(files) {
  const loaded = [];

  for (const file of files) {
    try {
      const uri = vscode.Uri.file(file.path);

      const bytes =
        await vscode.workspace.fs.readFile(uri);

      const content =
        Buffer.from(bytes).toString('utf8');

      loaded.push({
        id: crypto.randomUUID(),
        name: file.name,
        path: file.path,
        content
      });

    } catch (err) {
      console.error(
        'Failed loading file',
        file.path
      );
    }
  }

  return loaded;
}
```

---

# Step 5 — Security Rules

Do NOT allow sensitive files by default.

Block:

```text
.env
.env.*
*.pem
*.key
id_rsa
id_ed25519
*.p12
*.crt
secrets.json
credentials.json
```

Example:

```ts
const BLOCKED_PATTERNS = [
  '.env',
  '.pem',
  '.key',
  'id_rsa'
];
```

If detected:

Show confirmation modal.

```text
This file may contain secrets.

Attach anyway?

[Attach]
[Cancel]
```

---

# Step 6 — Send Files Back to UI

After loading:

```ts
webview.postMessage({
  type: 'attachmentsUpdated',
  attachments
});
```

---

# Step 7 — Render Attachment Chips

UI:

```tsx
attachments.map(file => (
  <div key={file.id}>
    {file.name}
    <button
      onClick={() => removeFile(file.id)}
    >
      ✕
    </button>
  </div>
))
```

Example UX:

```text
[auth.ts ✕]
[jwt.ts ✕]
[package.json ✕]
```

---

# Step 8 — Remove File

Add message:

```ts
vscode.postMessage({
  type: 'removeAttachment',
  id
});
```

Extension:

```ts
store.remove(id);
```

---

# Step 9 — Add to Context Bundle

File:

```text
packages/rubynod-ai/src/context-bundle.ts
```

Add:

```ts
manualAttachmentsProvider()
```

Example:

```ts
function manualAttachmentsProvider(
  attachments
) {
  return attachments.map(file => ({
    type: 'manual-file',
    priority: 100,
    content: `
Attached file:
${file.name}

${file.content}
`
  }));
}
```

Priority:

```text
Manual attachments = highest priority
```

Order:

```text
1. manual files
2. active file
3. diagnostics
4. git
5. retrieval
```

---

# Step 10 — Token Budget Protection

Do NOT inject huge files directly.

Rule:

### Small file

```text
< 500 lines
```

Send entire file.

### Large file

Only send:

```text
- imports
- exported symbols
- relevant chunks
- surrounding context
```

or semantic retrieval.

Example:

```ts
if (file.lines > 500) {
  summarizeAndChunk(file);
}
```

---

# Step 11 — Support Multiple Sources

Support drag from:

### VS Code Explorer

```text
drag file from explorer
```

### Finder / File Explorer

```text
drag from desktop
```

### Multiple Files

Example:

```text
auth.ts
jwt.ts
package.json
```

at once.

---

# Step 12 — Better UX

Add empty-state hint:

```text
Drop files here or use @file
```

Highlight border on drag:

```text
dragenter → blue border
dragleave → normal
```

Show loading:

```text
Loading attachments...
```

---

# Step 13 — Recommended Folder Structure

```text
extensions/rubynod-ai-ui/src/
├── chat-attachments.ts
├── file-attachments.ts
├── attachment-store.ts
├── attachment-security.ts
├── chat-provider.ts
└── webview/
    └── components/
        ├── AttachmentChip.tsx
        └── AttachmentDropZone.tsx
```

---

# Future Improvements

Phase 2:

- Drag folder support
- Image attachments
- Paste screenshots
- Code preview modal
- Chunk preview

Phase 3:

- Smart file ranking
- Auto-related files
- AI suggested attachments

---

# Success Criteria

Feature is complete when:

- drag works
- multiple files supported
- chips visible
- remove works
- files enter context
- token safe
- secrets blocked
- no crashes
- works with Ollama models
need to fix 