# Integrating External Projects with Juicebox.js

This document describes how to work with external projects (like Spacewalk) that use Juicebox.js.

## Multi-Root Workspace (Current Approach)

**We use a multi-root workspace to reference Spacewalk without copying files.**

### Setup:
1. Ensure Spacewalk is cloned locally (e.g., as a sibling directory: `../spacewalk`)
2. Open `juicebox-with-spacewalk.code-workspace` in Cursor/VS Code
3. Both projects will appear in the file explorer side-by-side

### Benefits:
- ✅ Full code navigation and IntelliSense across both projects
- ✅ Can search across both codebases
- ✅ No file duplication
- ✅ Always sees latest Spacewalk changes immediately
- ✅ Git history stays separate
- ✅ Cursor AI can understand both codebases together

### Usage:
```bash
# Open the workspace file in Cursor
cursor juicebox-with-spacewalk.code-workspace

# Or in VS Code
code juicebox-with-spacewalk.code-workspace
```

### Updating the Spacewalk Path:
If your Spacewalk repository is in a different location, edit `juicebox-with-spacewalk.code-workspace` and update the path:
```json
{
  "name": "Spacewalk (External Reference)",
  "path": "/absolute/path/to/spacewalk"  // or "../relative/path/to/spacewalk"
}
```

## Option 2: Git Submodules

**Best for:** When Spacewalk is a separate Git repository

### Setup:
```bash
# Add Spacewalk as a submodule
git submodule add <spacewalk-repo-url> spacewalk-reference

# Or if Spacewalk is already a submodule elsewhere
git submodule add <spacewalk-repo-url> external/spacewalk
```

### Benefits:
- ✅ Tracks specific commit of Spacewalk
- ✅ Can update to latest version easily
- ✅ Keeps projects separate
- ✅ Works well with CI/CD

### Drawbacks:
- ⚠️ Requires submodule initialization (`git submodule update --init`)
- ⚠️ Can be confusing for team members

## Option 3: Symbolic Links

**Best for:** Quick local development (not recommended for Git)

### Setup:
```bash
# Create a symlink to Spacewalk's juiceboxPanel.js
ln -s /path/to/spacewalk/src/panels/juiceboxPanel.js spacewalk-code/juiceboxPanel.js
```

### Benefits:
- ✅ Always points to latest version
- ✅ No duplication

### Drawbacks:
- ⚠️ Symlinks don't work well in Git (platform-specific)
- ⚠️ Can break if Spacewalk moves
- ⚠️ Not portable across machines

## Option 4: npm/yarn Workspaces (If Both Are Packages)

**Best for:** When both projects are npm packages

### Setup:
Create a root `package.json`:
```json
{
  "name": "juicebox-workspace",
  "private": true,
  "workspaces": [
    ".",
    "../spacewalk"
  ]
}
```

### Benefits:
- ✅ Shared dependencies
- ✅ Can link packages locally
- ✅ Standard npm workflow

## Option 5: GitHub Integration

**Best for:** Reference code from GitHub without cloning

### Using GitHub CLI:
```bash
# View file from GitHub repo
gh repo view <owner>/spacewalk --web

# Or use GitHub's web interface to browse
```

### Using Cursor's GitHub Integration:
- Cursor can reference GitHub repos in some contexts
- Use GitHub URLs in comments/links
- Not as seamless as local files

## Option 6: Documentation-Based Approach

**Best for:** When you just need to document usage patterns

### Create a reference file:
```markdown
# Spacewalk Integration Reference

See: https://github.com/your-org/spacewalk/blob/main/src/panels/juiceboxPanel.js

Key integration points:
- Line 82: `hic.restoreSession()`
- Line 89: `hic.getCurrentBrowser()`
- etc.
```

## Current Setup

We use the **Multi-Root Workspace** approach. The workspace file (`juicebox-with-spacewalk.code-workspace`) includes both:
- The juicebox.js project (current directory)
- The Spacewalk project (external reference)

This allows Cursor to understand both codebases together, making it easy to:
- Check compatibility when refactoring Juicebox.js
- See how Spacewalk uses Juicebox.js APIs
- Navigate between both projects seamlessly
- Get IntelliSense and code completion across both

### Notes:
- The workspace file is committed to Git, but Spacewalk itself is not
- Each developer needs to have Spacewalk cloned locally
- Update the path in the workspace file if Spacewalk is in a different location

## Questions?

- For workspace setup: See Cursor/VS Code documentation on multi-root workspaces
- For Git submodules: See `git help submodule`
- For npm workspaces: See npm/yarn workspace documentation

