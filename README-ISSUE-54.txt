DCS-Common issue #54 local patch
================================

1. Extract this ZIP directly into the root of your local DCS-Common repository.
2. Allow the extracted files to replace the existing files.
3. From PowerShell in the repository root, run:

   .\APPLY-ISSUE-54.ps1

   This removes the superseded file:
   assets/shared/hardware/source/vkb-grip-clean.png

4. Validate the patch:

   npm test

5. Review the changes with git status and git diff, then commit them normally.

Included changes
----------------
- Two new user-provided VKB F-14 grip source images.
- A two-view, portrait-oriented draw.io template.
- Deterministically regenerated shared SVG.
- Source provenance documentation.
- Regression coverage for image count, unique callouts, external label boxes,
  unique anchors, and logical grouping.

Expected validation result: all 19 tests pass.
