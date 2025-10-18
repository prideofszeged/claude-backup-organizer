# QA Test Plan - Bug Fixes

## Overview
This document outlines the testing procedures for the 6 critical bug fixes applied to Claude Backup Organizer.

---

## Bug Fix #1: Global `event` Reference Fix

### Issue
`selectFolder()` was using the global `event` object which could fail in strict mode or certain browsers.

### Test Cases

#### Test 1.1: Click Folder in Tree
**Steps:**
1. Open the extension options page
2. Look at the folder tree on the left sidebar
3. Click on different folders (Inbox, custom folders, nested folders)

**Expected Result:**
- Folders highlight when clicked
- No console errors appear
- Folder contents display correctly in the main area
- Selection indicator shows the correct folder is selected

**Pass/Fail:** ___________

#### Test 1.2: Check Browser Console
**Steps:**
1. Open extension options page
2. Open Developer Console (F12)
3. Click on various folders in the tree

**Expected Result:**
- No errors about "event is not defined"
- No runtime errors in console
- Console remains clean

**Pass/Fail:** ___________

---

## Bug Fix #2: Folder Rename Race Condition

### Issue
Renaming "Work" to "Working" could incorrectly affect paths like "Working/Projects" due to substring matching.

### Test Cases

#### Test 2.1: Rename Similar Folder Names
**Steps:**
1. Create folder "Work" with subfolder "Work/Projects"
2. Create folder "Working" if it doesn't exist
3. Right-click "Work" folder → "Rename"
4. Change "Work" to "Working2"
5. Check folder paths in browser

**Expected Result:**
- "Working2/Projects" exists (renamed correctly)
- "Working" folder (if it existed) remains unchanged
- "Working/Projects" is not affected
- No conversations are lost or misplaced

**Pass/Fail:** ___________

#### Test 2.2: Check Conversation Paths After Rename
**Steps:**
1. Create "Project" folder with subfolder "Project/Code"
2. Move some conversations to "Project/Code"
3. Right-click "Project" → "Rename" to "Projects"
4. Check conversation locations

**Expected Result:**
- Conversations that were in "Project/Code" are now in "Projects/Code"
- No conversations remain in old paths
- Folder structure reflects the rename

**Pass/Fail:** ___________

#### Test 2.3: Nested Folder Rename
**Steps:**
1. Create nested structure: "Dev/Frontend/Components"
2. Rename "Dev" to "Development"
3. Navigate through folders

**Expected Result:**
- Full path updates correctly to "Development/Frontend/Components"
- All conversations move with the folder
- Nested structure is preserved

**Pass/Fail:** ___________

---

## Bug Fix #3: Duplicate Selection Handlers

### Issue
Checkbox click and card click handlers could both trigger, causing unpredictable selection behavior.

### Test Cases

#### Test 3.1: Click Card Body (Not Checkbox)
**Steps:**
1. Open library view with conversations
2. Click on the card body (title, date, tags area - NOT the checkbox)
3. Verify selection

**Expected Result:**
- Conversation gets selected
- Card highlights
- Only one toggle action occurs (not multiple)
- No duplicate events fire

**Pass/Fail:** ___________

#### Test 3.2: Click Checkbox Directly
**Steps:**
1. Open library view
2. Click directly on the checkbox of a conversation
3. Verify selection

**Expected Result:**
- Conversation toggles (selected/deselected)
- Only one action occurs
- No interference from card click handler

**Pass/Fail:** ___________

#### Test 3.3: Shift-Click Range Selection
**Steps:**
1. Click checkbox on conversation #1
2. Hold Shift and click checkbox on conversation #5
3. Verify range selection

**Expected Result:**
- Conversations #1-5 all get selected
- No toggle-back behavior
- All in range are highlighted
- Works consistently

**Pass/Fail:** ___________

#### Test 3.4: Shift-Click on Card Body
**Steps:**
1. Click card body of conversation #1
2. Hold Shift and click card body of conversation #5
3. Verify range selection

**Expected Result:**
- Conversations #1-5 all get selected
- Range selection works
- No conflicts between handlers

**Pass/Fail:** ___________

---

## Bug Fix #4: XSS Vulnerability Fix

### Issue
User content in raw view wasn't escaped, potentially allowing XSS attacks.

### Test Cases

#### Test 4.1: View Conversation with HTML Content
**Steps:**
1. View a conversation that contains HTML-like content (if available)
2. Click "View" on a conversation
3. Switch to "Raw View"
4. Inspect the content

**Expected Result:**
- HTML tags appear as text (e.g., `<script>` shows as text, not executed)
- No scripts execute
- Content displays safely
- No console errors

**Pass/Fail:** ___________

#### Test 4.2: Check Escaped Content
**Steps:**
1. View conversation in Raw View
2. Open developer console (F12)
3. Check the HTML source of displayed content

**Expected Result:**
- Content is properly HTML-escaped
- Special characters like `<`, `>`, `"` are escaped
- Text content is safely contained

**Pass/Fail:** ___________

#### Test 4.3: View Thinking/Code Blocks
**Steps:**
1. Find conversation with thinking section or code blocks
2. View in Raw View
3. Check thinking section and code are displayed safely

**Expected Result:**
- Thinking blocks display without execution
- Code blocks display as text
- No interpretation of HTML/scripts
- Formatting preserved with linebreaks

**Pass/Fail:** ___________

---

## Bug Fix #5: Search Input Debounce

### Issue
Search was re-rendering on every keystroke, causing lag with many conversations.

### Test Cases

#### Test 5.1: Type Search Query Slowly
**Steps:**
1. Open library with 50+ conversations
2. Open Developer Tools → Performance tab (or just watch for lag)
3. Type search term slowly: "h-e-l-l-o"
4. Watch the UI response

**Expected Result:**
- UI remains responsive
- No lag while typing
- Search results update after you stop typing (150ms delay)
- Smooth experience

**Pass/Fail:** ___________

#### Test 5.2: Type Search Query Quickly
**Steps:**
1. Open library with 50+ conversations
2. Type search term quickly: "testing"
3. Observe rendering

**Expected Result:**
- Only one search happens after you finish typing
- Not multiple re-renders for each keystroke
- Results appear after brief delay (150ms)
- No unnecessary processing

**Pass/Fail:** ___________

#### Test 5.3: Delete Characters and Search Updates
**Steps:**
1. Type search: "test"
2. Wait for results to appear
3. Delete characters: "tes" → "te" → "t"
4. Verify updates work

**Expected Result:**
- Results update as you delete
- Debounce still works while deleting
- Transitions are smooth

**Pass/Fail:** ___________

#### Test 5.4: Performance Comparison
**Steps:**
1. Note the UI responsiveness before fix (if you remember)
2. Type in search field with 100+ conversations
3. Rate the responsiveness: Smooth / Acceptable / Laggy

**Expected Result:**
- Search UI interaction is smooth
- No noticeable lag
- Professional feel

**Pass/Fail:** ___________

---

## Bug Fix #6: Folder Validation

### Issue
Folder creation/rename had no validation for empty names, invalid characters, or duplicates.

### Test Cases

#### Test 6.1: Create Folder with Empty Name
**Steps:**
1. Click "+" to add new folder
2. In the prompt, click OK without entering a name (or enter only spaces)
3. Observe result

**Expected Result:**
- Alert: "Folder name cannot be empty"
- Folder is NOT created
- Prompt closes

**Pass/Fail:** ___________

#### Test 6.2: Create Folder with Invalid Characters
**Steps:**
1. Click "+" to add new folder
2. Try each invalid character:
   - `< > : " | ? * / \`
3. Example: "Folder<Test>"

**Expected Result:**
- Alert: "Folder name contains invalid characters: < > : " | ? * / \"
- Folder is NOT created
- Explains which characters are invalid

**Pass/Fail:** ___________

#### Test 6.3: Create Folder with Very Long Name
**Steps:**
1. Click "+" to add new folder
2. Enter 150+ character string
3. Attempt to create

**Expected Result:**
- Alert: "Folder name is too long (max 100 characters)"
- Folder is NOT created

**Pass/Fail:** ___________

#### Test 6.4: Rename Folder with Duplicate Name
**Steps:**
1. Create two folders: "Work" and "Projects"
2. Right-click "Projects" → "Rename"
3. Try to rename to "Work" (which already exists)

**Expected Result:**
- Alert: "Folder with this name already exists"
- Folder is NOT renamed
- Original name "Projects" is kept

**Pass/Fail:** ___________

#### Test 6.5: Rename Folder with Invalid Characters
**Steps:**
1. Right-click any folder → "Rename"
2. Try entering invalid characters: `< > : " | ? * / \`
3. Example: "New<Folder>"

**Expected Result:**
- Alert: "Folder name contains invalid characters: < > : " | ? * / \"
- Folder is NOT renamed
- Original name is preserved

**Pass/Fail:** ___________

#### Test 6.6: Create Valid Nested Folder
**Steps:**
1. Create valid folder: "MyProject"
2. Click "+" on "MyProject"
3. Create subfolder: "src"
4. Enter valid name: "components"

**Expected Result:**
- All folders create successfully
- Nested structure: "MyProject/src/components"
- No validation errors for valid names

**Pass/Fail:** ___________

---

## Summary

### Bugs Fixed
- [ ] Bug #1: Global event reference
- [ ] Bug #2: Folder rename race condition
- [ ] Bug #3: Duplicate selection handlers
- [ ] Bug #4: XSS vulnerability
- [ ] Bug #5: Search debounce
- [ ] Bug #6: Folder validation

### Overall Status
**Total Tests Passed:** _____ / 23

### Issues Found
List any bugs or unexpected behaviors discovered during testing:

1.
2.
3.

### Additional Notes
[Space for tester observations and comments]

---

## Testing Checklist

Before releasing, verify:
- [ ] All test cases marked as Pass
- [ ] No console errors during normal use
- [ ] Browser DevTools console is clean
- [ ] No warnings or deprecations logged
- [ ] UI responds smoothly
- [ ] Folder operations are reliable
- [ ] Search is responsive
- [ ] No data loss observed
- [ ] All validation messages are clear
- [ ] No regression in other features

**Tested By:** ___________________
**Date:** ___________________
**Browser Version:** ___________________
**Extension Version:** 0.3.0+fixes
