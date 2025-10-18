// State management
let conversations = [];
let folders = { 'Inbox': { children: {}, color: '#61dafb' } };
let tags = {};
let selectedConversations = new Set();
let currentFolder = null;
let lastSelectedId = null; // For shift-click range selection
let filteredConversationsList = []; // Track current filtered list for range selection

function strIncludes(hay, needle) {
  return (hay || "").toLowerCase().includes((needle || "").toLowerCase());
}

function rank(item, q) {
  const t = [item.title, (item.tags||[]).join(" "), item.notes||""];
  return t.reduce((s, f) => s + (strIncludes(f, q) ? 1 : 0), 0);
}

async function loadData() {
  const { index = [], folderStructure = {}, tagColors = {} } = await chrome.storage.local.get(["index", "folderStructure", "tagColors"]);
  conversations = index;
  folders = Object.keys(folderStructure).length > 0 ? folderStructure : { 'Inbox': { children: {}, color: '#61dafb' } };
  tags = tagColors;
  
  // Migrate conversations without folders to Inbox
  conversations.forEach(conv => {
    if (!conv.folder) conv.folder = 'Inbox';
  });
}

async function saveData() {
  await chrome.storage.local.set({ 
    index: conversations, 
    folderStructure: folders,
    tagColors: tags
  });
}

// Folder management
function createFolder(name, parent = null) {
  if (!parent || parent === 'Inbox') {
    // Root level folder
    if (folders[name]) return false; // Already exists
    folders[name] = { children: {}, color: '#61dafb' };
    return true;
  }

  // Nested folder - get parent folder and add to its children
  const parentObj = getFolder(parent);
  if (!parentObj) return false;

  if (!parentObj.children) parentObj.children = {};
  if (parentObj.children[name]) return false; // Already exists
  parentObj.children[name] = { children: {}, color: '#61dafb' };
  return true;
}

function getFolder(path) {
  if (!path || path === 'Inbox') return folders['Inbox'];

  const parts = path.split('/');
  let current = folders;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!current[part]) return null;

    // If this is the last part, return the folder object
    if (i === parts.length - 1) {
      return current[part];
    }

    // Otherwise, navigate to its children
    current = current[part].children || {};
  }
  return null;
}

function getAllFolderPaths() {
  const paths = ['Inbox'];
  
  function traverse(obj, prefix = '') {
    Object.keys(obj).forEach(key => {
      if (key !== 'Inbox') {
        const path = prefix ? `${prefix}/${key}` : key;
        paths.push(path);
        if (obj[key].children) {
          traverse(obj[key].children, path);
        }
      }
    });
  }
  
  traverse(folders.Inbox.children);
  Object.keys(folders).forEach(key => {
    if (key !== 'Inbox') {
      paths.push(key);
      if (folders[key].children) {
        traverse(folders[key].children, key);
      }
    }
  });
  
  return paths;
}

// UI Rendering
function renderFolderTree() {
  const container = document.getElementById('folderTree');
  container.innerHTML = '';
  
  function renderFolderItem(name, folderObj, path, level = 0) {
    const div = document.createElement('div');
    div.className = `tree-item ${currentFolder === path ? 'selected' : ''}`;
    div.style.marginLeft = `${level * 16}px`;
    
    const count = conversations.filter(c => c.folder === path).length;
    
    const folderColor = folderObj.color || '#61dafb';
    div.innerHTML = `
      <div class="folder-name">
        <span class="folder-icon">
          <span class="folder-color-indicator" style="background-color: ${folderColor}"></span>📁
        </span>
        <span>${name}</span>
        <span class="folder-count">(${count})</span>
        <div class="folder-actions">
          <button class="small-btn add-subfolder-btn" data-folder-path="${path}">+</button>
          ${path !== 'Inbox' ? `<button class="small-btn rename-folder-btn" data-folder-path="${path}" title="Rename folder">✎</button>` : ''}
          ${path !== 'Inbox' ? `<button class="small-btn delete-folder-btn" data-folder-path="${path}">×</button>` : ''}
        </div>
      </div>
    `;
    
    // Add event listeners
    const addBtn = div.querySelector('.add-subfolder-btn');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addSubfolder(path);
      });
    }
    
    const renameBtn = div.querySelector('.rename-folder-btn');
    if (renameBtn) {
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        renameFolder(path);
      });
    }

    const deleteBtn = div.querySelector('.delete-folder-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteFolder(path);
      });
    }

    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('small-btn')) return;
      selectFolder(path, e);
    });

    // Add drag-over handlers for drop target
    div.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      div.classList.add('drag-over');
    });

    div.addEventListener('dragleave', (e) => {
      div.classList.remove('drag-over');
    });

    div.addEventListener('drop', (e) => {
      e.preventDefault();
      div.classList.remove('drag-over');
      const convId = e.dataTransfer.getData('text/plain');
      moveConversationToFolder(convId, path);
    });

    // Add right-click context menu
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFolderContextMenu(e.clientX, e.clientY, path);
    });

    container.appendChild(div);
    
    // Render children
    if (folderObj.children) {
      Object.keys(folderObj.children).forEach(childName => {
        const childPath = path === 'Inbox' ? childName : `${path}/${childName}`;
        renderFolderItem(childName, folderObj.children[childName], childPath, level + 1);
      });
    }
  }
  
  // Add "All" view at the top
  const allDiv = document.createElement('div');
  allDiv.className = `tree-item ${currentFolder === null ? 'selected' : ''}`;
  const allCount = conversations.length;
  allDiv.innerHTML = `
    <div class="folder-name">
      <span class="folder-icon">⭐</span>
      <span>All</span>
      <span class="folder-count">(${allCount})</span>
    </div>
  `;
  allDiv.addEventListener('click', () => {
    currentFolder = null;
    document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
    allDiv.classList.add('selected');
    selectedConversations.clear();
    renderConversations();
  });
  container.appendChild(allDiv);

  renderFolderItem('Inbox', folders.Inbox, 'Inbox');

  Object.keys(folders).forEach(key => {
    if (key !== 'Inbox') {
      renderFolderItem(key, folders[key], key);
    }
  });
}

function renderConversations() {
  const container = document.getElementById('conversationGrid');
  const countEl = document.getElementById('conversationCount');
  
  let filtered = conversations;
  
  // Filter by folder
  if (currentFolder !== null) {
    filtered = filtered.filter(c => c.folder === currentFolder);
  }
  
  // Search filter
  const query = document.getElementById('q').value;
  if (query) {
    filtered = filtered.map(x => ({x, s: rank(x, query)}))
                     .filter(y => y.s > 0)
                     .sort((a, b) => b.s - a.s)
                     .map(y => y.x);
  }
  
  // Sort
  const sortBy = document.getElementById('sortBy').value;
  filtered.sort((a, b) => {
    switch(sortBy) {
      case 'updated-desc': return new Date(b.updatedAt) - new Date(a.updatedAt);
      case 'updated-asc': return new Date(a.updatedAt) - new Date(b.updatedAt);
      case 'title-asc': return a.title.localeCompare(b.title);
      case 'title-desc': return b.title.localeCompare(a.title);
      default: return 0;
    }
  });
  
  countEl.textContent = `${filtered.length} conversation${filtered.length !== 1 ? 's' : ''}`;

  // Store filtered list for range selection
  filteredConversationsList = filtered.map(c => c.id);

  // Update selection toolbar
  const toolbar = document.getElementById('selectionToolbar');
  const selectionCount = document.getElementById('selectionCount');
  if (selectedConversations.size > 0) {
    toolbar.style.display = 'flex';
    selectionCount.textContent = `${selectedConversations.size} selected`;
  } else {
    toolbar.style.display = 'none';
  }

  container.innerHTML = '';

  filtered.forEach(conv => {
    const card = document.createElement('div');
    card.className = `conversation-card ${selectedConversations.has(conv.id) ? 'selected' : ''}`;
    card.draggable = true;
    card.dataset.convId = conv.id;

    const tagHtml = (conv.tags || []).map(tag => {
      const color = tags[tag] || '#61dafb';
      return `<span class="tag" style="background-color: ${color}; color: ${getContrastColor(color)}">${tag}</span>`;
    }).join('');
    
    card.innerHTML = `
      <input type="checkbox" class="checkbox" ${selectedConversations.has(conv.id) ? 'checked' : ''} 
             data-conv-id="${conv.id}">
      <div class="title">${conv.title}</div>
      <div class="meta">${conv.updatedAt || 'No date'}</div>
      <div class="tags">${tagHtml}</div>
      <div class="notes">${conv.notes || ''}</div>
      <div class="actions">
        <button class="edit-btn" data-conv-id="${conv.id}">Edit</button>
        <button class="view-btn" data-conv-id="${conv.id}">View</button>
        <button class="export-btn" data-conv-id="${conv.id}">Export</button>
        <div class="delete-options">
          <button class="delete-local-btn" data-conv-id="${conv.id}" title="Remove from library (can re-sync)">Remove</button>
          <button class="delete-web-btn" data-conv-id="${conv.id}" title="Delete from Claude.ai permanently">Delete</button>
        </div>
      </div>
    `;
    
    // Add event listeners to the card elements
    const checkbox = card.querySelector('.checkbox');

    // Handle click event for shift-click range selection
    checkbox.addEventListener('click', (e) => {
      if (e.shiftKey && lastSelectedId) {
        // Prevent default checkbox behavior
        e.preventDefault();

        // Range selection with shift-click
        const lastIndex = filteredConversationsList.indexOf(lastSelectedId);
        const currentIndex = filteredConversationsList.indexOf(conv.id);
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);

        for (let i = start; i <= end; i++) {
          selectedConversations.add(filteredConversationsList[i]);
        }

        lastSelectedId = conv.id;
        renderConversations();
      }
    });

    checkbox.addEventListener('change', (e) => {
      // Normal checkbox toggle (not shift-click)
      if (!e.shiftKey) {
        toggleSelection(conv.id, e.target.checked);
        lastSelectedId = conv.id;
        renderConversations();
      }
    });
    
    const editBtn = card.querySelector('.edit-btn');
    editBtn.addEventListener('click', () => editConversation(conv.id));
    
    const viewBtn = card.querySelector('.view-btn');  
    viewBtn.addEventListener('click', () => viewConversation(conv.id));
    
    const exportBtn = card.querySelector('.export-btn');
    exportBtn.addEventListener('click', () => exportConversation(conv.id));
    
    const deleteLocalBtn = card.querySelector('.delete-local-btn');
    deleteLocalBtn.addEventListener('click', () => deleteConversationLocal(conv.id));
    
    const deleteWebBtn = card.querySelector('.delete-web-btn');
    deleteWebBtn.addEventListener('click', () => deleteConversationWeb(conv.id));

    // Add drag event handlers
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', conv.id);

      // Create custom drag image - small folder icon
      const dragImage = document.createElement('div');
      dragImage.style.width = '32px';
      dragImage.style.height = '32px';
      dragImage.style.borderRadius = '8px';
      dragImage.style.background = 'var(--accent)';
      dragImage.style.display = 'flex';
      dragImage.style.alignItems = 'center';
      dragImage.style.justifyContent = 'center';
      dragImage.style.fontSize = '16px';
      dragImage.style.color = '#000';
      dragImage.textContent = '📁';
      dragImage.style.position = 'fixed';
      dragImage.style.pointerEvents = 'none';
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 16, 16);
      setTimeout(() => dragImage.remove(), 0);
    });

    card.addEventListener('dragend', (e) => {
      card.classList.remove('dragging');
    });

    // Add click handler to card for selection (outside of buttons)
    card.addEventListener('click', (e) => {
      // Don't select if clicking on buttons or checkbox
      const clickedElement = e.target;
      const isButton = clickedElement.closest('button') || clickedElement.classList.contains('checkbox');
      if (isButton) return;

      // Shift-click for range selection
      if (e.shiftKey && lastSelectedId) {
        const lastIndex = filteredConversationsList.indexOf(lastSelectedId);
        const currentIndex = filteredConversationsList.indexOf(conv.id);
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);

        for (let i = start; i <= end; i++) {
          selectedConversations.add(filteredConversationsList[i]);
        }
      } else {
        // Normal toggle
        if (selectedConversations.has(conv.id)) {
          selectedConversations.delete(conv.id);
        } else {
          selectedConversations.add(conv.id);
        }
      }

      lastSelectedId = conv.id;
      renderConversations();
    });

    container.appendChild(card);
  });
}

function getContrastColor(bgColor) {
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return brightness > 128 ? '#000000' : '#ffffff';
}

// Event handlers
function selectFolder(path, event) {
  currentFolder = path;
  document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
  event.target.closest('.tree-item').classList.add('selected');
  selectedConversations.clear();
  renderConversations();
}

function toggleSelection(id, checked) {
  if (checked) {
    selectedConversations.add(id);
  } else {
    selectedConversations.delete(id);
  }
  renderConversations();
}

function addSubfolder(parentPath) {
  // Check depth limit (max 3 levels)
  const depth = parentPath === 'Inbox' ? 1 : parentPath.split('/').length + 1;
  if (depth > 3) {
    alert('Maximum folder nesting level (3) reached. Cannot create subfolders deeper than this.');
    return;
  }

  const name = prompt('Folder name:');
  if (!name) return;

  // Validate folder name
  if (name.trim().length === 0) {
    alert('Folder name cannot be empty');
    return;
  }
  if (name.length > 100) {
    alert('Folder name is too long (max 100 characters)');
    return;
  }
  if (/[<>:"|?*\/\\]/.test(name)) {
    alert('Folder name contains invalid characters: < > : " | ? * / \\');
    return;
  }

  const fullPath = parentPath === 'Inbox' ? name : `${parentPath}/${name}`;
  if (getAllFolderPaths().includes(fullPath)) {
    alert('Folder already exists');
    return;
  }

  createFolder(name, parentPath === 'Inbox' ? null : parentPath);
  saveData();
  renderFolderTree();
}

function renameFolder(path) {
  const newName = prompt(`Rename folder "${path}" to:`, path.split('/').pop());
  if (!newName) return;

  // Validate folder name
  if (newName.trim().length === 0) {
    alert('Folder name cannot be empty');
    return;
  }
  if (newName.length > 100) {
    alert('Folder name is too long (max 100 characters)');
    return;
  }
  if (/[<>:"|?*\/\\]/.test(newName)) {
    alert('Folder name contains invalid characters: < > : " | ? * / \\');
    return;
  }

  if (newName === path.split('/').pop()) return; // No change

  // Check if new name already exists at this level
  const parts = path.split('/');
  const parentPath = parts.length === 1 ? 'Inbox' : parts.slice(0, -1).join('/');
  const allFolderPaths = getAllFolderPaths();

  const newPath = parentPath === 'Inbox' ? newName : `${parentPath}/${newName}`;
  if (allFolderPaths.includes(newPath)) {
    alert('Folder with this name already exists');
    return;
  }

  // Update folder structure
  if (parts.length === 1) {
    // Root level folder
    if (folders[path]) {
      folders[newName] = folders[path];
      delete folders[path];
    }
  } else {
    // Nested folder
    let current = folders;
    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]].children;
    }
    if (current[parts[parts.length - 1]]) {
      current[newName] = current[parts[parts.length - 1]];
      delete current[parts[parts.length - 1]];
    }
  }

  // Update all conversations with old path to new path
  conversations.forEach(conv => {
    if (conv.folder === path) {
      conv.folder = newPath;
    } else if (conv.folder?.startsWith(path + '/')) {
      // Use slice instead of replace to avoid substring matching issues
      // e.g., renaming "Work" to "Working" shouldn't affect "Working/Projects"
      conv.folder = newPath + conv.folder.slice(path.length);
    }
  });

  // Update currentFolder if we're viewing the renamed folder
  if (currentFolder === path) {
    currentFolder = newPath;
  }

  saveData();
  renderFolderTree();
  renderConversations();
}

function deleteFolder(path) {
  if (!confirm(`Delete folder "${path}"? Conversations will be moved to Inbox.`)) return;

  // Move conversations to Inbox
  conversations.forEach(conv => {
    if (conv.folder === path || conv.folder?.startsWith(path + '/')) {
      conv.folder = 'Inbox';
    }
  });
  
  // Remove folder from structure
  const parts = path.split('/');
  if (parts.length === 1) {
    delete folders[parts[0]];
  } else {
    let current = folders;
    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]].children;
    }
    delete current[parts[parts.length - 1]];
  }
  
  if (currentFolder === path || currentFolder?.startsWith(path + '/')) {
    currentFolder = 'Inbox';
  }
  
  saveData();
  renderFolderTree();
  renderConversations();
}

async function editConversation(id) {
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Edit Conversation</h3>
      <label>Folder:</label>
      <select id="editFolder">
        ${getAllFolderPaths().map(path => 
          `<option value="${path}" ${conv.folder === path ? 'selected' : ''}>${path}</option>`
        ).join('')}
      </select>
      <label>Tags (comma-separated):</label>
      <input id="editTags" value="${(conv.tags || []).join(', ')}" />
      <label>Notes:</label>
      <textarea id="editNotes">${conv.notes || ''}</textarea>
      <div style="margin-top: 16px;">
        <button class="save-conversation-btn" data-conv-id="${id}">Save</button>
        <button class="cancel-modal-btn">Cancel</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners to modal buttons
  const saveBtn = modal.querySelector('.save-conversation-btn');
  saveBtn.addEventListener('click', () => saveConversationEdit(id));
  
  const cancelBtn = modal.querySelector('.cancel-modal-btn');
  cancelBtn.addEventListener('click', closeModal);
}

async function saveConversationEdit(id) {
  try {
    const newFolder = document.getElementById('editFolder').value;
    const newTags = document.getElementById('editTags').value.split(',').map(s => s.trim()).filter(Boolean);
    const newNotes = document.getElementById('editNotes').value;
    
    // Update via background script
    const res = await chrome.runtime.sendMessage({ 
      type: 'UPDATE_META', 
      id, 
      payload: { 
        folder: newFolder,
        tags: newTags, 
        notes: newNotes 
      } 
    });
    
    if (res?.ok === false) {
      alert(res.error || 'Failed to save');
      return;
    }
    
    // Update local data
    const conv = conversations.find(c => c.id === id);
    if (conv) {
      conv.folder = newFolder;
      conv.tags = newTags;
      conv.notes = newNotes;
      
      // Add new tags to tag registry
      newTags.forEach(tag => {
        if (!tags[tag]) {
          tags[tag] = '#61dafb';
        }
      });
    }
    
    await saveData();
    closeModal();
    renderFolderTree();
    renderConversations();
  } catch (e) {
    console.error('Save conversation error:', e);
    alert('Save failed. Check if extension is properly loaded.');
  }
}

// Modal viewer state
let modalState = {
  isOpen: false,
  currentConversationId: null,
  currentIndex: 0,
  filteredConversations: [],
  isFullscreen: false
};

function viewConversation(id) {
  openConversationModal(id);
}

async function openConversationModal(conversationId) {
  // Get current filtered conversations for navigation
  modalState.filteredConversations = getFilteredConversations();
  modalState.currentIndex = modalState.filteredConversations.findIndex(c => c.id === conversationId);
  modalState.currentConversationId = conversationId;
  modalState.isOpen = true;
  
  // Show modal
  const modal = document.getElementById('conversationModal');
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('show'), 10);
  
  // Load conversation content
  await loadConversationInModal(conversationId);
  updateModalNavigation();
  
  // Focus management
  document.getElementById('closeConversationModal').focus();
}

async function loadConversationInModal(conversationId) {
  try {
    // Load both markdown and raw view
    const [mdResponse, rawResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_CONVERSATION_MD', id: conversationId }),
      chrome.runtime.sendMessage({ type: 'GET_CONVERSATION_RAW', id: conversationId })
    ]);
    
    if (mdResponse.md && rawResponse.html) {
      // Populate content
      document.getElementById('modalMarkdown').value = mdResponse.md;
      document.getElementById('modalRendered').innerHTML = renderHtmlFromMd(mdResponse.md);
      document.getElementById('modalRaw').innerHTML = rawResponse.html;
      
      // Update title
      const conversation = modalState.filteredConversations[modalState.currentIndex];
      document.getElementById('modalConversationTitle').textContent = conversation?.title || 'Conversation';
    }
  } catch (error) {
    console.error('Failed to load conversation:', error);
    document.getElementById('modalRaw').innerHTML = `<div class="error">Failed to load conversation: ${error.message}</div>`;
  }
}

function updateModalNavigation() {
  const total = modalState.filteredConversations.length;
  const current = modalState.currentIndex + 1;
  
  // Update position indicator
  document.getElementById('conversationPosition').textContent = `${current} of ${total}`;
  
  // Update navigation buttons
  document.getElementById('prevConversation').disabled = modalState.currentIndex <= 0;
  document.getElementById('nextConversation').disabled = modalState.currentIndex >= total - 1;
}

function getFilteredConversations() {
  // Get current search/filter state
  const query = document.getElementById('q').value.toLowerCase();
  const sortBy = document.getElementById('sortBy').value;
  
  let filtered = conversations.filter(conv => {
    // Apply folder filter
    if (currentFolder && conv.folder !== currentFolder) return false;
    
    // Apply search filter
    if (query && rank(conv, query) === 0) return false;
    
    return true;
  });
  
  // Apply sorting
  if (sortBy === 'updated-desc') {
    filtered.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  } else if (sortBy === 'updated-asc') {
    filtered.sort((a, b) => (a.updatedAt || "").localeCompare(b.updatedAt || ""));
  } else if (sortBy === 'title-asc') {
    filtered.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else if (sortBy === 'title-desc') {
    filtered.sort((a, b) => (b.title || "").localeCompare(a.title || ""));
  }
  
  return filtered;
}

function closeConversationModal() {
  const modal = document.getElementById('conversationModal');
  modal.classList.remove('show');
  
  setTimeout(() => {
    modal.style.display = 'none';
    modalState.isOpen = false;
    modalState.currentConversationId = null;
  }, 200);
}

async function navigateConversation(direction) {
  const newIndex = modalState.currentIndex + direction;
  const total = modalState.filteredConversations.length;
  
  if (newIndex >= 0 && newIndex < total) {
    modalState.currentIndex = newIndex;
    const newConversation = modalState.filteredConversations[newIndex];
    modalState.currentConversationId = newConversation.id;
    
    await loadConversationInModal(newConversation.id);
    updateModalNavigation();
  }
}

function toggleModalFullscreen() {
  const modalContent = document.querySelector('.conversation-modal-content');
  modalState.isFullscreen = !modalState.isFullscreen;
  
  if (modalState.isFullscreen) {
    modalContent.classList.add('fullscreen');
  } else {
    modalContent.classList.remove('fullscreen');
  }
}

function switchModalViewMode(mode) {
  // Hide all views
  document.getElementById('modalRaw').style.display = 'none';
  document.getElementById('modalRendered').style.display = 'none';
  document.getElementById('modalMarkdown').style.display = 'none';
  
  // Show selected view
  const targetElement = mode === 'raw' ? 'modalRaw' : 
                       mode === 'rendered' ? 'modalRendered' : 'modalMarkdown';
  document.getElementById(targetElement).style.display = 'block';
}

// Utility function from viewer.js
function renderHtmlFromMd(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let inCode = false;
  for (let line of lines) {
    if (line.startsWith('```')) {
      inCode = !inCode;
      out.push(inCode ? '<pre><code>' : '</code></pre>');
      continue;
    }
    if (inCode) { 
      out.push(line.replace(/</g, '&lt;').replace(/>/g, '&gt;')); 
      continue; 
    }
    if (line.startsWith('# ')) out.push(`<h1>${line.slice(2).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>`);
    else if (line.startsWith('## ')) out.push(`<h2>${line.slice(3).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h2>`);
    else if (line.startsWith('### ')) out.push(`<h3>${line.slice(4).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h3>`);
    else if (line.trim().length === 0) out.push('<br/>');
    else out.push(`<p>${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`);
  }
  return out.join('\n');
}

async function exportConversation(id) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'EXPORT_CONVERSATION_MD', id });
    if (res?.ok === false) alert(res.error || 'Export failed');
  } catch (e) {
    console.error('Export error:', e);
    alert('Export failed. Check if extension is properly loaded.');
  }
}

async function deleteConversationLocal(id) {
  const conversation = conversations.find(c => c.id === id);
  const title = conversation?.title || 'conversation';
  
  if (!confirm(`Remove "${title}" from library?\n\nThis will only remove it locally. You can re-sync from Claude.ai to restore it.`)) {
    return;
  }
  
  try {
    const res = await chrome.runtime.sendMessage({ 
      type: 'DELETE_CONVERSATION', 
      id,
      options: { deleteFromWeb: false }
    });
    
    if (res?.ok) {
      await loadData();
      renderFolderTree();
      renderConversations();
    } else {
      alert(res.error || 'Failed to remove conversation');
    }
  } catch (e) {
    alert('Delete failed. Check if extension is properly loaded.');
  }
}

async function deleteConversationWeb(id) {
  const conversation = conversations.find(c => c.id === id);
  const title = conversation?.title || 'conversation';
  
  // Get settings to check for export reminder
  try {
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    
    if (settings.showExportReminder) {
      const exportFirst = confirm(`⚠️ About to permanently delete "${title}" from Claude.ai\n\nThis action cannot be undone! Would you like to export it first?`);
      if (exportFirst) {
        await exportConversation(id);
        // Give user time to see export initiated
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const confirmDelete = confirm(`🗑️ Permanently delete "${title}" from Claude.ai?\n\nThis will remove it from Claude.ai entirely and cannot be undone.`);
    if (!confirmDelete) return;
    
    const res = await chrome.runtime.sendMessage({ 
      type: 'DELETE_CONVERSATION', 
      id,
      options: { deleteFromWeb: true }
    });
    
    if (res?.ok) {
      await loadData();
      renderFolderTree();
      renderConversations();
    } else {
      alert(res.error || 'Failed to delete conversation from Claude.ai');
    }
  } catch (e) {
    alert('Delete failed. Check if extension is properly loaded.');
  }
}

function closeModal() {
  document.querySelectorAll('.modal').forEach(modal => modal.remove());
}

// Drag and drop move function
async function moveConversationToFolder(convId, targetFolderPath) {
  const conversation = conversations.find(c => c.id === convId);
  if (!conversation) return;

  // Don't move if it's already in the target folder
  if (conversation.folder === targetFolderPath) return;

  // Update conversation folder
  const oldFolder = conversation.folder;
  conversation.folder = targetFolderPath;

  // Update in background via message
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'UPDATE_META',
      id: convId,
      payload: { folder: targetFolderPath }
    });

    if (res?.ok === false) {
      // Revert on error
      conversation.folder = oldFolder;
      alert(res.error || 'Failed to move conversation');
      return;
    }

    // Save locally
    await saveData();

    // Find and fade out the card if we're in a filtered view
    const card = document.querySelector(`[data-conv-id="${convId}"]`);
    if (card && currentFolder !== null && currentFolder !== targetFolderPath) {
      // We're viewing a specific folder and the conversation moved away
      card.classList.add('fade-out');
      setTimeout(() => {
        renderFolderTree();
        renderConversations();
      }, 300);
    } else {
      // Card stays visible (viewing "All" or destination folder), just refresh
      renderFolderTree();
      renderConversations();
    }
  } catch (e) {
    // Revert on error
    conversation.folder = oldFolder;
    console.error('Move conversation error:', e);
    alert('Failed to move conversation. Check if extension is properly loaded.');
  }
}

// Folder context menu functions
function showFolderContextMenu(x, y, folderPath) {
  // Remove any existing context menu
  const existingMenu = document.querySelector('.folder-context-menu');
  if (existingMenu) existingMenu.remove();

  const menu = document.createElement('div');
  menu.className = 'folder-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const items = [];

  // Color option
  items.push({
    icon: '🎨',
    label: 'Change Color',
    action: () => changeFolderColor(folderPath),
  });

  // Rename option (for non-Inbox folders)
  if (folderPath !== 'Inbox') {
    items.push({
      icon: '✎',
      label: 'Rename',
      action: () => renameFolder(folderPath),
    });

    // Delete option (for non-Inbox folders)
    items.push({
      icon: '🗑️',
      label: 'Delete',
      action: () => deleteFolder(folderPath),
      danger: true,
    });
  }

  items.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = `folder-context-menu-item ${item.danger ? 'danger' : ''}`;
    itemEl.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
    itemEl.addEventListener('click', () => {
      menu.remove();
      item.action();
    });
    menu.appendChild(itemEl);
  });

  document.body.appendChild(menu);

  // Close menu on click outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  document.addEventListener('click', closeMenu);
}

function changeFolderColor(folderPath) {
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  const folderObj = folderPath === 'Inbox' ? folders.Inbox : getFolder(folderPath);
  if (folderObj) {
    colorInput.value = folderObj.color || '#61dafb';
  }

  colorInput.addEventListener('change', (e) => {
    const newColor = e.target.value;
    if (folderPath === 'Inbox') {
      folders.Inbox.color = newColor;
    } else {
      const folderObj = getFolder(folderPath);
      if (folderObj) {
        folderObj.color = newColor;
      }
    }
    saveData();
    renderFolderTree();
  });

  // Trigger the color picker
  colorInput.click();
}

// Progress indicator helpers
function showProgress(statusText, current, total) {
  const progressSection = document.getElementById('syncProgress');
  const statusTextEl = document.getElementById('syncStatusText');
  const progressTextEl = document.getElementById('syncProgressText');
  const progressFill = document.getElementById('progressFill');

  progressSection.style.display = 'block';
  statusTextEl.textContent = statusText;

  if (total > 0) {
    const percentage = Math.round((current / total) * 100);
    progressTextEl.textContent = `${current}/${total} (${percentage}%)`;
    progressFill.style.width = `${percentage}%`;
  } else {
    progressTextEl.textContent = 'Preparing...';
    progressFill.style.width = '0%';
  }
}

function hideProgress(delay = 2000) {
  setTimeout(() => {
    const progressSection = document.getElementById('syncProgress');
    progressSection.style.display = 'none';
  }, delay);
}

// Quick bulk delete function
async function quickDeleteSelected() {
  const count = selectedConversations.size;

  // Get user's delete settings
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

  let deleteFromWeb = false;

  // Determine delete mode based on settings
  if (settings.deleteMode === 'web-default') {
    deleteFromWeb = true;
    if (!confirm(`Permanently delete ${count} conversation${count > 1 ? 's' : ''} from Claude.ai?\n\nThis cannot be undone.`)) {
      return;
    }
  } else if (settings.deleteMode === 'web-confirm') {
    // Ask user which mode
    const result = confirm(
      `Delete ${count} conversation${count > 1 ? 's' : ''}?\n\n` +
      `OK = Delete from Claude.ai permanently ⚠️\n` +
      `Cancel = Remove from library only (can re-sync)`
    );
    deleteFromWeb = result;
  } else {
    // local-only mode
    if (!confirm(`Remove ${count} conversation${count > 1 ? 's' : ''} from library?\n\nYou can re-sync from Claude.ai to restore.`)) {
      return;
    }
  }

  // Show export reminder if deleting from web
  if (deleteFromWeb && settings.showExportReminder) {
    const exportFirst = confirm(
      `Would you like to export these ${count} conversations before permanently deleting them?`
    );
    if (exportFirst) {
      showProgress('Exporting conversations...', 0, count);
      let exported = 0;
      for (const id of selectedConversations) {
        await exportConversation(id);
        exported++;
        showProgress('Exporting conversations...', exported, count);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Show initial progress
  const actionText = deleteFromWeb ? 'Deleting from Claude.ai' : 'Removing from library';
  showProgress(`${actionText}...`, 0, count);

  // Perform deletion
  let successCount = 0;
  let errorCount = 0;
  let current = 0;

  for (const id of selectedConversations) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'DELETE_CONVERSATION',
        id,
        options: { deleteFromWeb }
      });
      if (res?.ok) {
        successCount++;
      } else {
        errorCount++;
      }
    } catch (e) {
      errorCount++;
    }

    // Update progress after each deletion
    current++;
    showProgress(`${actionText}...`, current, count);
  }

  await loadData();
  selectedConversations.clear();
  renderFolderTree();
  renderConversations();

  // Show completion
  const action = deleteFromWeb ? 'deleted from Claude.ai' : 'removed from library';
  showProgress(`Complete! ${successCount} ${action}`, count, count);

  // Hide progress bar after showing completion
  hideProgress(3000);

  // Show summary if there were errors
  if (errorCount > 0) {
    setTimeout(() => {
      alert(`${successCount} conversations ${action}\n${errorCount} failed`);
    }, 3000);
  }
}

// Progress handling
function updateSyncProgress(progress) {
  const progressSection = document.getElementById('syncProgress');
  const statusText = document.getElementById('syncStatusText');
  const progressText = document.getElementById('syncProgressText');
  const progressFill = document.getElementById('progressFill');
  const detailsDiv = document.getElementById('syncDetails');
  
  if (progress.phase === 'starting' || progress.phase === 'fetching' || progress.phase === 'downloading') {
    progressSection.style.display = 'block';
    statusText.textContent = progress.message;
    
    if (progress.total > 0) {
      const percentage = Math.round((progress.current / progress.total) * 100);
      progressText.textContent = `${progress.current}/${progress.total} (${percentage}%)`;
      progressFill.style.width = `${percentage}%`;
      
      if (progress.currentItem) {
        const detailLine = document.createElement('div');
        detailLine.className = 'detail-line';
        detailLine.textContent = `${progress.current}/${progress.total}: ${progress.currentItem}`;
        detailsDiv.appendChild(detailLine);
        
        // Keep only last 5 details
        while (detailsDiv.children.length > 5) {
          detailsDiv.removeChild(detailsDiv.firstChild);
        }
        
        // Auto-scroll to bottom
        detailsDiv.scrollTop = detailsDiv.scrollHeight;
      }
    } else {
      progressText.textContent = 'Preparing...';
      progressFill.style.width = '0%';
    }
  } else if (progress.phase === 'completed') {
    statusText.textContent = progress.message;
    progressText.textContent = 'Complete!';
    progressFill.style.width = '100%';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      progressSection.style.display = 'none';
      detailsDiv.innerHTML = '';
      
      // Refresh the conversation list
      loadData().then(() => {
        renderFolderTree();
        renderConversations();
      });
    }, 3000);
  } else if (progress.phase === 'error') {
    statusText.textContent = progress.message;
    progressText.textContent = 'Error';
    progressFill.style.width = '0%';
    progressFill.style.background = '#e74c3c';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      progressSection.style.display = 'none';
      detailsDiv.innerHTML = '';
      progressFill.style.background = 'linear-gradient(90deg, var(--accent), #4ecdc4)';
    }, 5000);
  }
}

// Listen for progress messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_PROGRESS') {
    updateSyncProgress(message.progress);
  }
});

// Context detection
function detectDisplayMode() {
  // Check URL parameters first for explicit mode
  const urlParams = new URLSearchParams(window.location.search);
  const explicitMode = urlParams.get('mode');
  
  if (explicitMode === 'popup' || explicitMode === 'full') {
    return explicitMode;
  }
  
  // Check if we're in a popup (small constrained window)
  const isPopup = window.outerWidth <= 500 || window.outerHeight <= 700;
  return isPopup ? 'popup' : 'full';
}

function applyDisplayMode(mode) {
  document.body.classList.remove('popup-mode', 'full-mode');
  document.body.classList.add(mode + '-mode');
  
  // Store mode for potential use
  document.body.dataset.displayMode = mode;
}

// Handle focus parameter for search
function handleSearchFocus() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('focus') === 'search') {
    setTimeout(() => {
      const searchInput = document.getElementById('q');
      if (searchInput) {
        searchInput.focus();
        searchInput.scrollIntoView();
      }
    }, 100);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Detect and apply display mode first
  const displayMode = detectDisplayMode();
  applyDisplayMode(displayMode);
  
  await loadData();
  
  // Handle search focus if needed
  handleSearchFocus();
  
  // Set default folder
  currentFolder = 'Inbox';
  
  renderFolderTree();
  renderConversations();
  
  // Check for any ongoing sync progress
  try {
    const { syncProgress } = await chrome.storage.local.get(['syncProgress']);
    if (syncProgress && !syncProgress.completed && !syncProgress.error) {
      updateSyncProgress(syncProgress);
    }
  } catch (_) {
    // Ignore storage errors
  }
  
  // Event listeners
  // Debounce search input to avoid re-rendering on every keystroke
  let searchTimeout;
  document.getElementById('q').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => renderConversations(), 150);
  });
  document.getElementById('sortBy').addEventListener('change', renderConversations);
  
  document.getElementById('addFolder').addEventListener('click', () => {
    addSubfolder('Inbox');
  });
  
  document.getElementById('selectAll').addEventListener('click', () => {
    const filtered = conversations.filter(c => currentFolder === null || c.folder === currentFolder);
    const allSelected = filtered.every(c => selectedConversations.has(c.id));

    if (allSelected) {
      filtered.forEach(c => selectedConversations.delete(c.id));
    } else {
      filtered.forEach(c => selectedConversations.add(c.id));
    }
    renderConversations();
  });

  // Quick action buttons (confirmation handled in function based on settings)
  document.getElementById('quickDelete')?.addEventListener('click', async () => {
    await quickDeleteSelected();
  });

  document.getElementById('clearSelection')?.addEventListener('click', () => {
    selectedConversations.clear();
    renderConversations();
  });

  // Legacy sync buttons with error handling
  document.getElementById('syncInc')?.addEventListener('click', async () => {
    try {
      // Clear any previous progress
      document.getElementById('syncProgress').style.display = 'none';
      document.getElementById('syncDetails').innerHTML = '';
      
      const response = await chrome.runtime.sendMessage({ type: 'SYNC_INCREMENTAL' });
      if (response?.ok === false) {
        alert(`Sync error: ${response.error}`);
      }
    } catch (e) {
      console.error('Sync error:', e);
      alert('Sync failed. Check if extension is properly loaded.');
    }
  });
  
  document.getElementById('syncFull')?.addEventListener('click', async () => {
    try {
      // Clear any previous progress
      document.getElementById('syncProgress').style.display = 'none';
      document.getElementById('syncDetails').innerHTML = '';
      
      const response = await chrome.runtime.sendMessage({ type: 'SYNC_FULL' });
      if (response?.ok === false) {
        alert(`Sync error: ${response.error}`);
      }
    } catch (e) {
      console.error('Sync error:', e);
      alert('Sync failed. Check if extension is properly loaded.');
    }
  });
  
  document.getElementById('syncTest')?.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SYNC_TEST' });
      if (response?.ok === false) {
        alert(`Test error: ${response.error}`);
      } else {
        alert('Test successful!');
      }
    } catch (e) {
      console.error('Test error:', e);
      alert('Test failed. Check if extension is properly loaded.');
    }
  });
  
  document.getElementById('syncStop')?.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'SYNC_STOP' });
      if (response?.ok === false) {
        alert(`Stop error: ${response.error}`);
      } else {
        alert('Sync stopped');
      }
    } catch (e) {
      console.error('Stop error:', e);
      alert('Stop failed. Check if extension is properly loaded.');
    }
  });
  
  document.getElementById('exportIndex')?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'EXPORT_INDEX' });
  });
  
  document.getElementById('exportCsv')?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'EXPORT_INDEX_CSV' });
  });
  
  document.getElementById('refreshLibrary')?.addEventListener('click', async () => {
    try {
      // Show a brief loading state
      const refreshBtn = document.getElementById('refreshLibrary');
      const originalText = refreshBtn.textContent;
      refreshBtn.textContent = 'Refreshing...';
      refreshBtn.disabled = true;
      
      // Reload data and refresh UI
      await loadData();
      renderFolderTree();
      renderConversations();
      
      // Reset button
      refreshBtn.textContent = originalText;
      refreshBtn.disabled = false;
      
      // Optional: Show a brief success indicator
      refreshBtn.textContent = '✓ Refreshed';
      setTimeout(() => {
        refreshBtn.textContent = originalText;
      }, 1000);
      
    } catch (e) {
      console.error('Refresh error:', e);
      alert('Refresh failed. Check console for details.');
      
      // Reset button on error
      const refreshBtn = document.getElementById('refreshLibrary');
      refreshBtn.textContent = 'Refresh';
      refreshBtn.disabled = false;
    }
  });

  document.getElementById('sqlQuery')?.addEventListener('click', () => {
    window.location.href = 'query.html';
  });

  document.getElementById('deleteSettings')?.addEventListener('click', openDeleteSettingsModal);
  
  document.getElementById('popOutLibrary')?.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'POP_OUT_LIBRARY' });
      // Close popup after opening full window
      if (document.body.dataset.displayMode === 'popup') {
        window.close();
      }
    } catch (e) {
      console.error('Pop out error:', e);
      alert('Failed to pop out library. Check if extension is properly loaded.');
    }
  });

  // Modal conversation viewer controls
  document.getElementById('closeConversationModal')?.addEventListener('click', closeConversationModal);
  document.getElementById('prevConversation')?.addEventListener('click', () => navigateConversation(-1));
  document.getElementById('nextConversation')?.addEventListener('click', () => navigateConversation(1));
  document.getElementById('toggleFullscreen')?.addEventListener('click', toggleModalFullscreen);
  
  document.getElementById('modalViewMode')?.addEventListener('change', (e) => {
    switchModalViewMode(e.target.value);
  });
  
  document.getElementById('modalExportMd')?.addEventListener('click', async () => {
    if (modalState.currentConversationId) {
      try {
        const res = await chrome.runtime.sendMessage({ 
          type: 'EXPORT_CONVERSATION_MD', 
          id: modalState.currentConversationId 
        });
        if (res?.ok === false) {
          alert(res.error || 'Export failed');
        }
      } catch (error) {
        alert('Export failed: ' + error.message);
      }
    }
  });

  // Bulk selection keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape: Clear selections
    if (e.key === 'Escape' && selectedConversations.size > 0 && !modalState.isOpen) {
      selectedConversations.clear();
      renderConversations();
      return;
    }

    // Ctrl+A / Cmd+A: Select all visible
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !modalState.isOpen) {
      e.preventDefault();
      const filtered = filteredConversationsList;
      filtered.forEach(id => selectedConversations.add(id));
      renderConversations();
      return;
    }

    // Delete: Quick delete selected (confirmation handled in function based on settings)
    if (e.key === 'Delete' && selectedConversations.size > 0 && !modalState.isOpen) {
      e.preventDefault();
      quickDeleteSelected();
      return;
    }
  });

  // Modal keyboard shortcuts (only when modal is open)
  document.addEventListener('keydown', (e) => {
    if (!modalState.isOpen) return;
    
    switch (e.key) {
      case 'Escape':
        closeConversationModal();
        break;
      case 'ArrowLeft':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          navigateConversation(-1);
        }
        break;
      case 'ArrowRight':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          navigateConversation(1);
        }
        break;
      case 'F11':
        e.preventDefault();
        toggleModalFullscreen();
        break;
    }
  });

  // Modal backdrop click to close
  document.querySelector('.modal-backdrop')?.addEventListener('click', closeConversationModal);
  
  // Bulk operations
  document.getElementById('bulkOperations')?.addEventListener('click', () => {
    if (selectedConversations.size === 0) {
      alert('Please select conversations first');
      return;
    }
    document.getElementById('bulkModal').style.display = 'flex';
  });
  
  document.getElementById('closeBulkModal')?.addEventListener('click', () => {
    document.getElementById('bulkModal').style.display = 'none';
  });
  
  document.getElementById('bulkMoveToFolder')?.addEventListener('click', async () => {
    const folderPath = prompt('Move to folder:', 'Inbox');
    if (!folderPath) return;

    showProgress('Moving conversations...', 0, selectedConversations.size);
    let successCount = 0;
    let current = 0;

    for (const id of selectedConversations) {
      try {
        // Use UPDATE_META to persist changes to background
        const res = await chrome.runtime.sendMessage({
          type: 'UPDATE_META',
          id,
          payload: { folder: folderPath }
        });

        if (res?.ok) {
          successCount++;
          const conv = conversations.find(c => c.id === id);
          if (conv) conv.folder = folderPath;
        }
      } catch (e) {
        console.error('Error moving conversation:', e);
      }

      current++;
      showProgress('Moving conversations...', current, selectedConversations.size);
    }

    await saveData();
    selectedConversations.clear();
    hideProgress(2000);
    document.getElementById('bulkModal').style.display = 'none';
    renderFolderTree();
    renderConversations();

    alert(`${successCount}/${selectedConversations.size} conversations moved to ${folderPath}`);
  });
  
  document.getElementById('bulkAddTags')?.addEventListener('click', async () => {
    const newTags = prompt('Add tags (comma-separated):');
    if (!newTags) return;

    const tagsToAdd = newTags.split(',').map(s => s.trim()).filter(Boolean);
    showProgress('Adding tags to conversations...', 0, selectedConversations.size);
    let successCount = 0;
    let current = 0;

    for (const id of selectedConversations) {
      try {
        const conv = conversations.find(c => c.id === id);
        if (conv) {
          conv.tags = conv.tags || [];
          tagsToAdd.forEach(tag => {
            if (!conv.tags.includes(tag)) conv.tags.push(tag);
            if (!tags[tag]) tags[tag] = '#61dafb';
          });

          // Use UPDATE_META to persist tag changes
          const res = await chrome.runtime.sendMessage({
            type: 'UPDATE_META',
            id,
            payload: { tags: conv.tags }
          });

          if (res?.ok) {
            successCount++;
          }
        }
      } catch (e) {
        console.error('Error adding tags:', e);
      }

      current++;
      showProgress('Adding tags to conversations...', current, selectedConversations.size);
    }

    await saveData();
    selectedConversations.clear();
    hideProgress(2000);
    document.getElementById('bulkModal').style.display = 'none';
    renderConversations();

    alert(`Tags added to ${successCount}/${selectedConversations.size} conversations`);
  });
  
  document.getElementById('bulkExport')?.addEventListener('click', async () => {
    for (const id of selectedConversations) {
      await exportConversation(id);
    }
    selectedConversations.clear();
    document.getElementById('bulkModal').style.display = 'none';
    renderConversations();
  });
  
  document.getElementById('bulkDeleteExecute')?.addEventListener('click', async () => {
    const deleteMode = document.querySelector('input[name="bulkDeleteMode"]:checked')?.value;
    const isWebDelete = deleteMode === 'web';
    const count = selectedConversations.size;
    
    // Different confirmations based on delete mode
    let confirmMessage;
    if (isWebDelete) {
      confirmMessage = `⚠️ PERMANENTLY DELETE ${count} conversations from Claude.ai?\n\nThis action cannot be undone and will remove them from Claude.ai entirely.`;
    } else {
      confirmMessage = `Remove ${count} conversations from library?\n\nThey will only be removed locally and can be restored by re-syncing.`;
    }
    
    if (!confirm(confirmMessage)) return;
    
    try {
      const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      
      // Show export reminder for web deletions
      if (isWebDelete && settings.showExportReminder) {
        const exportFirst = confirm(`Would you like to export these ${count} conversations before deleting them permanently?`);
        if (exportFirst) {
          for (const id of selectedConversations) {
            await exportConversation(id);
          }
          await new Promise(resolve => setTimeout(resolve, 2000)); // Give time for exports
        }
      }
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const id of selectedConversations) {
        try {
          const res = await chrome.runtime.sendMessage({ 
            type: 'DELETE_CONVERSATION', 
            id,
            options: { deleteFromWeb: isWebDelete }
          });
          if (res?.ok) {
            successCount++;
          } else {
            console.error(`Failed to delete ${id}:`, res.error);
            errorCount++;
          }
        } catch (e) {
          console.error(`Error deleting ${id}:`, e);
          errorCount++;
        }
      }
      
      await loadData();
      selectedConversations.clear();
      document.getElementById('bulkModal').style.display = 'none';
      renderFolderTree();
      renderConversations();
      
      // Show result summary
      let message = `${successCount} conversations ${isWebDelete ? 'deleted' : 'removed'} successfully`;
      if (errorCount > 0) {
        message += `\n${errorCount} failed (check console for details)`;
      }
      alert(message);
      
    } catch (e) {
      console.error('Bulk delete error:', e);
      alert('Bulk delete failed. Check if extension is properly loaded.');
    }
  });

  // Delete settings modal
  document.getElementById('closeDeleteSettings')?.addEventListener('click', () => {
    document.getElementById('deleteSettingsModal').style.display = 'none';
  });

  document.getElementById('saveDeleteSettings')?.addEventListener('click', saveDeleteSettings);
});

async function openDeleteSettingsModal() {
  try {
    // Load current settings
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    
    // Populate form
    document.querySelector(`input[name="deleteMode"][value="${settings.deleteMode}"]`).checked = true;
    document.getElementById('showExportReminder').checked = settings.showExportReminder;
    document.getElementById('confirmBulkDeletes').checked = settings.confirmBulkDeletes;
    
    // Show modal
    document.getElementById('deleteSettingsModal').style.display = 'flex';
  } catch (e) {
    alert('Failed to load settings. Check if extension is properly loaded.');
  }
}

async function saveDeleteSettings() {
  try {
    const deleteMode = document.querySelector('input[name="deleteMode"]:checked')?.value;
    const showExportReminder = document.getElementById('showExportReminder').checked;
    const confirmBulkDeletes = document.getElementById('confirmBulkDeletes').checked;
    
    await chrome.runtime.sendMessage({ 
      type: 'SET_SETTINGS', 
      settings: { 
        deleteMode,
        showExportReminder,
        confirmBulkDeletes
      }
    });
    
    document.getElementById('deleteSettingsModal').style.display = 'none';
    alert('Delete settings saved successfully!');
  } catch (e) {
    alert('Failed to save settings. Check if extension is properly loaded.');
  }
}

// No longer need global functions since we removed inline handlers