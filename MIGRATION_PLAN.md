# Plan: Create New Repository from juicebox-mcp Branch

## Overview
Create a new standalone repository at `https://github.com/aidenlab/[NEW_REPO_NAME]` that contains a complete copy of the `juicebox-mcp` branch from `juicebox.js`.

## Prerequisites
- GitHub account with access to `aidenlab` organization
- Git configured with SSH keys for GitHub
- Node.js and npm installed (for building/testing)

## Step-by-Step Plan

### Phase 1: Prepare the New Repository Content

1. **Create a temporary working directory**
   ```bash
   cd /tmp
   mkdir juicebox-mcp-new
   cd juicebox-mcp-new
   ```

2. **Clone the current repository and checkout the juicebox-mcp branch**
   ```bash
   git clone git@github.com:aidenlab/juicebox.js.git .
   git checkout juicebox-mcp
   ```

3. **Remove the old git history and initialize a fresh repository**
   ```bash
   rm -rf .git
   git init
   ```

4. **Update package.json**
   - Change `name` from `"juicebox.js"` to `"[NEW_REPO_NAME]"`
   - Update `repository.url` to point to the new repository
   - Update `bugs.url` to point to the new repository
   - Consider updating version to `1.0.0` (or appropriate initial version)

5. **Update README.md**
   - Update repository URLs (currently references both `igvteam/juicebox.js` and should be updated to new repo)
   - Update installation instructions if needed
   - Add note about this being a fork/branch of juicebox.js if desired
   - Update clone URL in Development section

6. **Update CONTRIBUTING.md**
   - Update GitHub Issues URLs to point to new repository

7. **Update any other files that reference the old repository**
   - Check for hardcoded URLs in:
     - Documentation files
     - Configuration files
     - Code comments
     - Example files

7. **Remove or update workspace files** (if not needed in new repo)
   - `juicebox-with-hello3dmcp-server.code-workspace`
   - `juicebox-with-igvjs.code-workspace`
   - `juicebox-with-pg-ruler.code-workspace`
   - `juicebox-with-spacewalk.code-workspace`
   - Decide if these should be kept or removed

8. **Create initial commit**
   ```bash
   git add .
   git commit -m "Initial commit: Fork of juicebox-mcp branch"
   ```

### Phase 2: Create GitHub Repository

9. **Create new repository on GitHub**
   - Go to https://github.com/organizations/aidenlab/repositories/new
   - Repository name: `[NEW_REPO_NAME]` (e.g., `juicebox-mcp` or `juicebox-mcp-standalone`)
   - Description: "MCP-enabled version of juicebox.js"
   - Visibility: Public or Private (as appropriate)
   - **DO NOT** initialize with README, .gitignore, or license (we're bringing our own)

### Phase 3: Push to New Repository

10. **Add remote and push**
    ```bash
    git remote add origin git@github.com:aidenlab/[NEW_REPO_NAME].git
    git branch -M main  # or master, depending on your preference
    git push -u origin main
    ```

### Phase 4: Post-Migration Tasks

11. **Verify the new repository**
    - Check that all files are present
    - Verify package.json changes
    - Test that the repository can be cloned

12. **Update CI/CD (if applicable)**
    - Update any GitHub Actions workflows
    - Update any deployment configurations
    - Update any badge URLs in README

13. **Set up repository settings**
    - Configure branch protection rules
    - Set up issue templates (if needed)
    - Configure repository topics/tags
    - Add repository description and website links

14. **Test the build**
    ```bash
    npm install
    npm run build
    npm test  # if tests exist
    ```

15. **Create initial release/tag** (optional)
    ```bash
    git tag -a v1.0.0 -m "Initial release"
    git push origin v1.0.0
    ```

## Files That Need Updating

### Files with juicebox-mcp specific changes:
- `dev/dat-sequence-gene-track.html`
- `js/dataLoader.js`
- `js/genome.js`
- `js/igvjs-utils.js` (new file)
- `juicebox-with-hello3dmcp-server.code-workspace` (new file)
- `juicebox-with-igvjs.code-workspace` (new file)
- `package.json`

### Files that reference repository URLs (need updating):
- `package.json` - repository.url and bugs.url
- `README.md` - Multiple GitHub URLs (currently mix of igvteam and aidenlab references)
- `CONTRIBUTING.md` - GitHub Issues URLs

## Important Considerations

1. **Repository Name**: Decide on the new repository name (e.g., `juicebox-mcp`, `juicebox-mcp-standalone`)

2. **License**: The project uses MIT license - ensure LICENSE file is included

3. **Dependencies**: All npm dependencies should work as-is since they're external packages

4. **Git History**: 
   - Option A: Start fresh (no history) - simpler, cleaner
   - Option B: Preserve history - more complex but maintains attribution
   - **Recommendation**: Start fresh for a cleaner new project

5. **Workspace Files**: Decide whether to keep `.code-workspace` files or remove them

6. **Documentation**: Update any documentation that references the old repository

## Alternative: Automated Script Approach

If you prefer, I can create a shell script that automates most of these steps. The script would:
- Clone the repo
- Checkout the branch
- Remove old git history
- Update package.json and README
- Create initial commit
- Provide instructions for creating GitHub repo and pushing

Would you like me to create this automated script?
