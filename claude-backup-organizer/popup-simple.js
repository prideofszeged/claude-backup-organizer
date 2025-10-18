// Load and display library stats
async function loadLibraryStats() {
  try {
    const { index = [], folderStructure = {}, lastSyncTime } = await chrome.storage.local.get(['index', 'folderStructure', 'lastSyncTime']);
    
    // Update conversation count
    document.getElementById('conversationCount').textContent = index.length;
    
    // Count folders (excluding Inbox)
    const folderCount = countFolders(folderStructure);
    document.getElementById('folderCount').textContent = folderCount;
    
    // Format last sync time
    const lastSyncEl = document.getElementById('lastSync');
    if (lastSyncTime) {
      const syncDate = new Date(lastSyncTime);
      const today = new Date();
      const isToday = syncDate.toDateString() === today.toDateString();
      
      if (isToday) {
        lastSyncEl.textContent = syncDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        lastSyncEl.textContent = syncDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
    } else {
      lastSyncEl.textContent = 'Never';
    }
  } catch (e) {
    console.error('Failed to load library stats:', e);
    document.getElementById('conversationCount').textContent = '0';
    document.getElementById('folderCount').textContent = '0';
    document.getElementById('lastSync').textContent = 'Error';
  }
}

function countFolders(folderStructure) {
  let count = 0;
  
  function traverse(obj) {
    Object.keys(obj).forEach(key => {
      if (key !== 'Inbox') {
        count++;
      }
      if (obj[key]?.children) {
        traverse(obj[key].children);
      }
    });
  }
  
  // Count folders in Inbox children
  if (folderStructure.Inbox?.children) {
    traverse(folderStructure.Inbox.children);
  }
  
  // Count top-level folders (excluding Inbox)
  Object.keys(folderStructure).forEach(key => {
    if (key !== 'Inbox') {
      count++;
      if (folderStructure[key]?.children) {
        traverse(folderStructure[key].children);
      }
    }
  });
  
  return count;
}

// Sync progress handling
function showSyncOverlay() {
  document.getElementById('syncOverlay').style.display = 'flex';
}

function hideSyncOverlay() {
  document.getElementById('syncOverlay').style.display = 'none';
}

function updateSyncProgress(progress) {
  const statusEl = document.getElementById('syncStatus');
  const fillEl = document.getElementById('syncProgressFill');
  const detailsEl = document.getElementById('syncDetails');
  
  if (progress.phase === 'starting' || progress.phase === 'fetching' || progress.phase === 'downloading') {
    statusEl.textContent = progress.message || 'Syncing...';
    
    if (progress.total > 0) {
      const percentage = Math.round((progress.current / progress.total) * 100);
      fillEl.style.width = `${percentage}%`;
      detailsEl.textContent = `${progress.current}/${progress.total} (${percentage}%)`;
    } else {
      fillEl.style.width = '0%';
      detailsEl.textContent = 'Preparing...';
    }
  } else if (progress.phase === 'completed') {
    statusEl.textContent = 'Sync Complete!';
    fillEl.style.width = '100%';
    detailsEl.textContent = progress.message || 'All conversations updated';
    
    // Auto-hide after 2 seconds and refresh stats
    setTimeout(() => {
      hideSyncOverlay();
      loadLibraryStats();
    }, 2000);
  } else if (progress.phase === 'error') {
    statusEl.textContent = 'Sync Failed';
    fillEl.style.width = '0%';
    fillEl.style.background = '#e74c3c';
    detailsEl.textContent = progress.message || 'An error occurred';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      hideSyncOverlay();
      fillEl.style.background = 'linear-gradient(90deg, var(--accent), #4ecdc4)';
    }, 3000);
  }
}

// Card click handlers
async function handleQuickSearchCard() {
  try {
    // Open full library with search focused
    const tab = await chrome.tabs.create({ 
      url: chrome.runtime.getURL('options.html?focus=search')
    });
    window.close();
  } catch (e) {
    console.error('Failed to open search:', e);
  }
}

async function handleSyncCard() {
  try {
    showSyncOverlay();
    
    // Start incremental sync
    const response = await chrome.runtime.sendMessage({ type: 'SYNC_INCREMENTAL' });
    
    if (response?.ok === false) {
      updateSyncProgress({
        phase: 'error',
        message: response.error || 'Sync failed'
      });
    }
  } catch (e) {
    console.error('Sync error:', e);
    updateSyncProgress({
      phase: 'error',
      message: 'Failed to start sync'
    });
  }
}

async function handleFullLibraryCard() {
  try {
    // Open full library in new tab
    await chrome.tabs.create({ 
      url: chrome.runtime.getURL('options.html')
    });
    window.close();
  } catch (e) {
    console.error('Failed to open library:', e);
  }
}

// Listen for sync progress messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYNC_PROGRESS') {
    updateSyncProgress(message.progress);
  }
});

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Load initial stats
  await loadLibraryStats();
  
  // Add card click handlers
  document.getElementById('quickSearchCard').addEventListener('click', handleQuickSearchCard);
  document.getElementById('syncCard').addEventListener('click', handleSyncCard);
  document.getElementById('fullLibraryCard').addEventListener('click', handleFullLibraryCard);
  
  // Add sync stop handler
  document.getElementById('syncStop').addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'SYNC_STOP' });
      hideSyncOverlay();
    } catch (e) {
      console.error('Failed to stop sync:', e);
    }
  });
  
  // Check for any ongoing sync progress
  try {
    const { syncProgress } = await chrome.storage.local.get(['syncProgress']);
    if (syncProgress && !syncProgress.completed && !syncProgress.error) {
      showSyncOverlay();
      updateSyncProgress(syncProgress);
    }
  } catch (_) {
    // Ignore storage errors
  }
});