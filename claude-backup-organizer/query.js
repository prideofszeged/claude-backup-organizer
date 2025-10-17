// Simple SQL query engine for Claude conversations

class QueryEngine {
  constructor() {
    this.tables = {};
    this.queryHistory = [];
  }

  // Initialize data from storage and IndexedDB
  async initialize() {
    await this.loadConversations();
    await this.loadQueryHistory();
  }

  async loadConversations() {
    try {
      // Get metadata from Chrome storage
      const { index = [] } = await chrome.storage.local.get(['index']);
      
      // Get full conversation data from IndexedDB
      const db = await this.openIndexedDB();
      const conversations = await this.getAllConversations(db);
      
      // Build virtual tables
      this.buildVirtualTables(index, conversations);
    } catch (error) {
      console.error('Failed to load conversations:', error);
      throw error;
    }
  }

  async openIndexedDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('claudeCache', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async getAllConversations(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readonly');
      const store = tx.objectStore('conversations');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error('IndexedDB getAll failed'));
    });
  }

  buildVirtualTables(metadata, fullConversations) {
    const conversationsTable = [];
    const messagesTable = [];
    const thinkingTable = [];
    const toolsTable = [];

    // Create lookup map for full conversation data
    const fullConvMap = new Map();
    fullConversations.forEach(conv => {
      if (conv && conv.data) {
        fullConvMap.set(conv.id, conv.data);
      }
    });

    // Build conversations table
    metadata.forEach(meta => {
      const fullConv = fullConvMap.get(meta.id);
      const messages = fullConv?.chat_messages || [];
      
      conversationsTable.push({
        id: meta.id,
        title: meta.title || '',
        updatedAt: meta.updatedAt || '',
        createdAt: fullConv?.created_at || '',
        model: fullConv?.model || '',
        tags: (meta.tags || []).join(', '),
        notes: meta.notes || '',
        folder: meta.folder || 'Inbox',
        messageCount: messages.length,
        content: this.extractAllText(messages)
      });

      // Build messages table
      messages.forEach((msg, index) => {
        const textContent = this.extractTextFromMessage(msg);
        messagesTable.push({
          conversationId: meta.id,
          messageId: msg.uuid || `msg_${index}`,
          sender: msg.sender || 'unknown',
          content: textContent,
          createdAt: msg.created_at || '',
          index: index
        });

        // Build thinking table
        const thinkingContent = this.extractThinkingFromMessage(msg);
        if (thinkingContent) {
          thinkingTable.push({
            conversationId: meta.id,
            messageId: msg.uuid || `msg_${index}`,
            content: thinkingContent,
            length: thinkingContent.length
          });
        }

        // Build tools table
        const toolUsage = this.extractToolsFromMessage(msg);
        toolUsage.forEach(tool => {
          toolsTable.push({
            conversationId: meta.id,
            messageId: msg.uuid || `msg_${index}`,
            toolType: tool.type,
            toolData: JSON.stringify(tool.data)
          });
        });
      });
    });

    this.tables = {
      conversations: conversationsTable,
      messages: messagesTable,
      thinking: thinkingTable,
      tools: toolsTable
    };
  }

  extractAllText(messages) {
    return messages.map(msg => this.extractTextFromMessage(msg)).join(' ');
  }

  extractTextFromMessage(message) {
    const content = message.content || [];
    const textParts = content.filter(part => part.type === 'text');
    return textParts.map(part => part.text || '').join(' ');
  }

  extractThinkingFromMessage(message) {
    const content = message.content || [];
    const thinkingPart = content.find(part => part.type === 'thinking');
    return thinkingPart?.thinking || null;
  }

  extractToolsFromMessage(message) {
    const content = message.content || [];
    return content
      .filter(part => part.type && part.type !== 'text' && part.type !== 'thinking')
      .map(part => ({ type: part.type, data: part }));
  }

  // Simple SQL parser and executor
  executeQuery(sql) {
    try {
      const query = this.parseSQL(sql);
      const result = this.runQuery(query);
      this.addToHistory(sql);
      return { success: true, data: result, query };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  parseSQL(sql) {
    sql = sql.trim().replace(/;$/, '');
    const tokens = sql.split(/\s+/);
    
    if (tokens[0].toUpperCase() !== 'SELECT') {
      throw new Error('Only SELECT queries are supported');
    }

    const query = {
      type: 'SELECT',
      select: [],
      from: '',
      joins: [],
      where: null,
      groupBy: [],
      orderBy: [],
      limit: null
    };

    let i = 1;
    
    // Parse SELECT clause
    const selectEnd = this.findKeyword(tokens, i, ['FROM']);
    if (selectEnd === -1) throw new Error('FROM clause required');
    
    const selectClause = tokens.slice(i, selectEnd).join(' ');
    query.select = this.parseSelectClause(selectClause);
    
    i = selectEnd + 1;
    
    // Parse FROM clause
    if (i >= tokens.length) throw new Error('Table name required after FROM');
    const fromClause = this.parseFromClause(tokens, i);
    query.from = fromClause.table;
    i = fromClause.nextIndex;
    
    // Parse JOIN clauses
    while (i < tokens.length) {
      const keyword = tokens[i].toUpperCase();
      
      if (keyword === 'JOIN' || keyword === 'INNER' || keyword === 'LEFT') {
        const joinClause = this.parseJoinClause(tokens, i);
        query.joins.push(joinClause.join);
        i = joinClause.nextIndex;
      } else if (keyword === 'WHERE') {
        const whereEnd = this.findKeyword(tokens, i + 1, ['GROUP', 'ORDER', 'LIMIT']);
        const whereEnd2 = whereEnd === -1 ? tokens.length : whereEnd;
        query.where = tokens.slice(i + 1, whereEnd2).join(' ');
        i = whereEnd2;
      } else if (keyword === 'GROUP' && tokens[i + 1]?.toUpperCase() === 'BY') {
        const groupEnd = this.findKeyword(tokens, i + 2, ['ORDER', 'LIMIT']);
        const groupEnd2 = groupEnd === -1 ? tokens.length : groupEnd;
        query.groupBy = tokens.slice(i + 2, groupEnd2);
        i = groupEnd2;
      } else if (keyword === 'ORDER' && tokens[i + 1]?.toUpperCase() === 'BY') {
        const orderEnd = this.findKeyword(tokens, i + 2, ['LIMIT']);
        const orderEnd2 = orderEnd === -1 ? tokens.length : orderEnd;
        query.orderBy = this.parseOrderBy(tokens.slice(i + 2, orderEnd2));
        i = orderEnd2;
      } else if (keyword === 'LIMIT') {
        query.limit = parseInt(tokens[i + 1]) || null;
        i += 2;
      } else {
        i++;
      }
    }
    
    return query;
  }

  parseFromClause(tokens, start) {
    // Support: FROM table [alias]
    let table = tokens[start];
    let alias = null;
    let nextIndex = start + 1;
    
    // Check for alias
    if (nextIndex < tokens.length && 
        !['JOIN', 'INNER', 'LEFT', 'WHERE', 'GROUP', 'ORDER', 'LIMIT'].includes(tokens[nextIndex].toUpperCase())) {
      alias = tokens[nextIndex];
      nextIndex++;
    }
    
    return { table, alias, nextIndex };
  }

  parseJoinClause(tokens, start) {
    let joinType = 'INNER';
    let i = start;
    
    // Parse join type
    if (tokens[i].toUpperCase() === 'LEFT') {
      joinType = 'LEFT';
      i++;
      if (tokens[i]?.toUpperCase() === 'JOIN') i++;
    } else if (tokens[i].toUpperCase() === 'INNER') {
      joinType = 'INNER';
      i++;
      if (tokens[i]?.toUpperCase() === 'JOIN') i++;
    } else if (tokens[i].toUpperCase() === 'JOIN') {
      i++;
    }
    
    // Parse table name and alias
    if (i >= tokens.length) throw new Error('Table name required after JOIN');
    const table = tokens[i++];
    let alias = null;
    
    // Check for alias
    if (i < tokens.length && tokens[i].toUpperCase() !== 'ON') {
      alias = tokens[i++];
    }
    
    // Parse ON condition
    if (i >= tokens.length || tokens[i].toUpperCase() !== 'ON') {
      throw new Error('ON clause required after JOIN table');
    }
    i++; // Skip 'ON'
    
    const conditionEnd = this.findKeyword(tokens, i, ['JOIN', 'INNER', 'LEFT', 'WHERE', 'GROUP', 'ORDER', 'LIMIT']);
    const conditionEnd2 = conditionEnd === -1 ? tokens.length : conditionEnd;
    const condition = tokens.slice(i, conditionEnd2).join(' ');
    
    return {
      join: { type: joinType, table, alias, condition },
      nextIndex: conditionEnd2
    };
  }

  findKeyword(tokens, start, keywords) {
    for (let i = start; i < tokens.length; i++) {
      if (keywords.includes(tokens[i].toUpperCase())) {
        return i;
      }
    }
    return -1;
  }

  parseSelectClause(selectClause) {
    return selectClause.split(',').map(col => col.trim());
  }

  parseOrderBy(tokens) {
    const result = [];
    for (let i = 0; i < tokens.length; i += 2) {
      const column = tokens[i];
      const direction = tokens[i + 1]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      result.push({ column, direction });
      if (tokens[i + 1]?.toUpperCase() !== 'DESC' && tokens[i + 1]?.toUpperCase() !== 'ASC') {
        i--; // No direction specified, backtrack
      }
    }
    return result;
  }

  runQuery(query) {
    let data = this.tables[query.from];
    if (!data) {
      throw new Error(`Table '${query.from}' not found`);
    }

    // Apply JOINs
    if (query.joins.length > 0) {
      data = this.executeJoins(data, query.joins, query.from);
    }

    // Apply WHERE clause
    if (query.where) {
      data = data.filter(row => this.evaluateWhere(row, query.where));
    }

    // Apply GROUP BY
    if (query.groupBy.length > 0) {
      data = this.applyGroupBy(data, query.groupBy, query.select);
    } else {
      // Apply SELECT (projection)
      data = data.map(row => this.projectRow(row, query.select));
    }

    // Apply ORDER BY
    if (query.orderBy.length > 0) {
      data = this.applySorting(data, query.orderBy);
    }

    // Apply LIMIT
    if (query.limit) {
      data = data.slice(0, query.limit);
    }

    return data;
  }

  executeJoins(leftData, joins, leftTableName) {
    let result = leftData.map(row => ({ [`${leftTableName}`]: row }));
    
    for (const join of joins) {
      const rightData = this.tables[join.table];
      if (!rightData) {
        throw new Error(`Table '${join.table}' not found in JOIN`);
      }
      
      result = this.performJoin(result, rightData, join, leftTableName);
    }
    
    // Flatten the nested structure for easier column access
    return result.map(row => this.flattenJoinedRow(row));
  }

  performJoin(leftRows, rightTable, joinSpec, leftTableName) {
    const joinResults = [];
    
    // Create lookup map for faster joins on common patterns
    const rightLookup = this.createJoinLookup(rightTable, joinSpec);
    
    for (const leftRow of leftRows) {
      const matches = this.findJoinMatches(leftRow, rightTable, joinSpec, leftTableName, rightLookup);
      
      if (matches.length > 0) {
        // INNER/LEFT JOIN: create row for each match
        for (const rightRow of matches) {
          const joinedRow = { ...leftRow };
          joinedRow[joinSpec.alias || joinSpec.table] = rightRow;
          joinResults.push(joinedRow);
        }
      } else if (joinSpec.type === 'LEFT') {
        // LEFT JOIN: keep left row with null right side
        const joinedRow = { ...leftRow };
        joinedRow[joinSpec.alias || joinSpec.table] = null;
        joinResults.push(joinedRow);
      }
      // INNER JOIN with no matches: row is excluded
    }
    
    return joinResults;
  }

  createJoinLookup(rightTable, joinSpec) {
    // Optimize common foreign key patterns
    const lookup = new Map();
    
    // Try to detect simple equality conditions like "table1.id = table2.foreignId"
    const eqMatch = joinSpec.condition.match(/(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/);
    if (eqMatch) {
      const [, leftTable, leftCol, rightTable, rightCol] = eqMatch;
      
      // Group right table by the join column for fast lookup
      rightTable.forEach(row => {
        const key = row[rightCol];
        if (!lookup.has(key)) {
          lookup.set(key, []);
        }
        lookup.get(key).push(row);
      });
    }
    
    return lookup;
  }

  findJoinMatches(leftRow, rightTable, joinSpec, leftTableName, rightLookup) {
    // Try optimized lookup first
    const eqMatch = joinSpec.condition.match(/(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/);
    if (eqMatch && rightLookup.size > 0) {
      const [, leftTable, leftCol, rightTable, rightCol] = eqMatch;
      
      // Get the left value
      const leftValue = this.getColumnValue(leftRow, leftTable, leftCol, leftTableName);
      return rightLookup.get(leftValue) || [];
    }
    
    // Fallback: evaluate condition for each right row
    return rightTable.filter(rightRow => {
      return this.evaluateJoinCondition(leftRow, rightRow, joinSpec.condition, leftTableName, joinSpec.table);
    });
  }

  getColumnValue(joinedRow, tableName, columnName, defaultTable) {
    // Handle prefixed columns like "c.id" or "conversations.id"
    if (joinedRow[tableName]) {
      return joinedRow[tableName][columnName];
    }
    
    // Try default table
    if (joinedRow[defaultTable]) {
      return joinedRow[defaultTable][columnName];
    }
    
    // Direct column access (fallback)
    return joinedRow[columnName];
  }

  evaluateJoinCondition(leftRow, rightRow, condition, leftTableName, rightTableName) {
    // Simple equality condition: table1.col = table2.col
    const eqMatch = condition.match(/(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/);
    if (eqMatch) {
      const [, leftTable, leftCol, rightTable, rightCol] = eqMatch;
      
      const leftValue = this.getColumnValue(leftRow, leftTable, leftCol, leftTableName);
      const rightValue = rightRow[rightCol];
      
      return leftValue === rightValue;
    }
    
    // More complex conditions can be added here
    return false;
  }

  flattenJoinedRow(joinedRow) {
    const flattened = {};
    
    for (const [tableName, tableData] of Object.entries(joinedRow)) {
      if (tableData && typeof tableData === 'object') {
        // Add columns with table prefix
        for (const [column, value] of Object.entries(tableData)) {
          flattened[`${tableName}.${column}`] = value;
          // Also add without prefix for backward compatibility
          if (!flattened[column]) {
            flattened[column] = value;
          }
        }
      }
    }
    
    return flattened;
  }

  evaluateWhere(row, whereClause) {
    // Simple WHERE clause evaluation
    // Support: column = 'value', column LIKE '%value%', column > value, etc.
    
    if (whereClause.includes(' LIKE ')) {
      const [column, pattern] = whereClause.split(' LIKE ').map(s => s.trim());
      const cleanColumn = column.replace(/['"]/g, '');
      const cleanPattern = pattern.replace(/['"]/g, '').replace(/%/g, '');
      const value = String(row[cleanColumn] || '').toLowerCase();
      return value.includes(cleanPattern.toLowerCase());
    }
    
    if (whereClause.includes(' = ')) {
      const [column, value] = whereClause.split(' = ').map(s => s.trim());
      const cleanColumn = column.replace(/['"]/g, '');
      const cleanValue = value.replace(/['"]/g, '');
      return String(row[cleanColumn] || '') === cleanValue;
    }
    
    if (whereClause.includes(' > ')) {
      const [column, value] = whereClause.split(' > ').map(s => s.trim());
      const cleanColumn = column.replace(/['"]/g, '');
      const cleanValue = value.replace(/['"]/g, '');
      return new Date(row[cleanColumn] || 0) > new Date(cleanValue);
    }
    
    return true; // Default to true for unsupported WHERE clauses
  }

  projectRow(row, selectColumns) {
    if (selectColumns.includes('*')) {
      return row;
    }
    
    const result = {};
    selectColumns.forEach(col => {
      col = col.trim();
      if (col.startsWith('COUNT(')) {
        result['count'] = 1; // Will be aggregated later if needed
      } else if (col.startsWith('DATE(')) {
        const column = col.match(/DATE\(([^)]+)\)/)?.[1];
        if (column && row[column]) {
          result[`date_${column}`] = new Date(row[column]).toISOString().split('T')[0];
        }
      } else {
        result[col] = row[col];
      }
    });
    return result;
  }

  applyGroupBy(data, groupColumns, selectColumns) {
    const groups = new Map();
    
    data.forEach(row => {
      const key = groupColumns.map(col => row[col]).join('|');
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(row);
    });
    
    const result = [];
    groups.forEach((groupRows, key) => {
      const groupResult = {};
      
      // Add group columns
      groupColumns.forEach((col, i) => {
        groupResult[col] = key.split('|')[i];
      });
      
      // Calculate aggregates
      selectColumns.forEach(col => {
        col = col.trim();
        if (col.startsWith('COUNT(')) {
          groupResult['count'] = groupRows.length;
        } else if (col.includes(' as ')) {
          const [expr, alias] = col.split(' as ').map(s => s.trim());
          if (expr.startsWith('COUNT(')) {
            groupResult[alias] = groupRows.length;
          }
        } else if (!groupColumns.includes(col) && col !== '*') {
          groupResult[col] = groupRows[0][col]; // Take first value
        }
      });
      
      result.push(groupResult);
    });
    
    return result;
  }

  applySorting(data, orderBy) {
    return data.sort((a, b) => {
      for (const { column, direction } of orderBy) {
        const aVal = a[column];
        const bVal = b[column];
        
        let comparison = 0;
        if (aVal < bVal) comparison = -1;
        else if (aVal > bVal) comparison = 1;
        
        if (comparison !== 0) {
          return direction === 'DESC' ? -comparison : comparison;
        }
      }
      return 0;
    });
  }

  addToHistory(sql) {
    this.queryHistory.unshift({
      sql,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 50 queries
    if (this.queryHistory.length > 50) {
      this.queryHistory = this.queryHistory.slice(0, 50);
    }
    
    this.saveQueryHistory();
  }

  async saveQueryHistory() {
    try {
      await chrome.storage.local.set({ queryHistory: this.queryHistory });
    } catch (error) {
      console.warn('Failed to save query history:', error);
    }
  }

  async loadQueryHistory() {
    try {
      const { queryHistory = [] } = await chrome.storage.local.get(['queryHistory']);
      this.queryHistory = queryHistory;
    } catch (error) {
      console.warn('Failed to load query history:', error);
      this.queryHistory = [];
    }
  }
}

// UI Management
class QueryUI {
  constructor() {
    this.engine = new QueryEngine();
    this.currentResults = null;
  }

  async initialize() {
    await this.engine.initialize();
    this.setupEventListeners();
    this.renderQueryHistory();
    this.showStatus('Ready', 'ok');
  }

  setupEventListeners() {
    // Navigation
    document.getElementById('backToLibrary').onclick = () => {
      window.location.href = 'options.html';
    };

    // Query execution
    document.getElementById('runQuery').onclick = () => this.runQuery();
    document.getElementById('runQueryBtn').onclick = () => this.runQuery();
    document.getElementById('queryInput').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.runQuery();
      }
    });

    // Query templates
    document.querySelectorAll('.template-btn').forEach(btn => {
      btn.onclick = () => {
        document.getElementById('queryInput').value = btn.dataset.query;
      };
    });

    // Editor actions
    document.getElementById('clearQuery').onclick = () => {
      document.getElementById('queryInput').value = '';
    };

    // Results export
    document.getElementById('exportResults').onclick = () => this.exportResults();
    document.getElementById('copyResults').onclick = () => this.copyResults();
  }

  async runQuery() {
    const sql = document.getElementById('queryInput').value.trim();
    if (!sql) {
      this.showStatus('Please enter a query', 'err');
      return;
    }

    this.showStatus('Executing query...', 'ok');
    
    try {
      const result = this.engine.executeQuery(sql);
      
      if (result.success) {
        this.currentResults = result.data;
        this.displayResults(result.data);
        this.renderQueryHistory();
        this.showStatus(`Query executed successfully. ${result.data.length} rows returned.`, 'ok');
      } else {
        this.showStatus(`Query error: ${result.error}`, 'err');
        this.displayError(result.error);
      }
    } catch (error) {
      this.showStatus(`Execution error: ${error.message}`, 'err');
      this.displayError(error.message);
    }
  }

  displayResults(data) {
    const container = document.getElementById('resultsContainer');
    const count = document.getElementById('resultsCount');
    
    count.textContent = `Results (${data.length} rows)`;
    
    if (data.length === 0) {
      container.innerHTML = '<div class="results-placeholder">No results found</div>';
      return;
    }

    // Create scrollable table container
    const tableContainer = document.createElement('div');
    tableContainer.className = 'results-table-container';
    
    // Create table
    const table = document.createElement('table');
    table.className = 'results-table';
    
    // Headers
    const headers = Object.keys(data[0]);
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      th.title = header; // Tooltip for long header names
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Body
    const tbody = document.createElement('tbody');
    data.forEach(row => {
      const tr = document.createElement('tr');
      headers.forEach(header => {
        const td = document.createElement('td');
        const value = row[header];
        const displayValue = value != null ? String(value) : '';
        td.textContent = displayValue;
        td.title = displayValue; // Tooltip for truncated text
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    
    tableContainer.appendChild(table);
    container.innerHTML = '';
    container.appendChild(tableContainer);
  }

  displayError(error) {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = `<div class="results-error">Error: ${error}</div>`;
  }

  exportResults() {
    if (!this.currentResults || this.currentResults.length === 0) {
      this.showStatus('No results to export', 'err');
      return;
    }

    const format = document.getElementById('exportFormat').value;
    let content, mimeType, extension;

    switch (format) {
      case 'json':
        content = JSON.stringify(this.currentResults, null, 2);
        mimeType = 'application/json';
        extension = 'json';
        break;
      case 'csv':
        content = this.convertToCSV(this.currentResults);
        mimeType = 'text/csv';
        extension = 'csv';
        break;
      case 'markdown':
        content = this.convertToMarkdown(this.currentResults);
        mimeType = 'text/markdown';
        extension = 'md';
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const filename = `query-results-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${extension}`;
    
    chrome.downloads.download({
      url,
      filename: `claude-backup/query-results/${filename}`,
      saveAs: false
    });

    this.showStatus(`Results exported as ${format.toUpperCase()}`, 'ok');
  }

  convertToCSV(data) {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];
    
    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        const stringValue = value != null ? String(value) : '';
        return `"${stringValue.replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(','));
    });
    
    return csvRows.join('\n');
  }

  convertToMarkdown(data) {
    if (data.length === 0) return 'No data';
    
    const headers = Object.keys(data[0]);
    let md = '| ' + headers.join(' | ') + ' |\n';
    md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
    
    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        return value != null ? String(value) : '';
      });
      md += '| ' + values.join(' | ') + ' |\n';
    });
    
    return md;
  }

  copyResults() {
    if (!this.currentResults || this.currentResults.length === 0) {
      this.showStatus('No results to copy', 'err');
      return;
    }

    const text = JSON.stringify(this.currentResults, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      this.showStatus('Results copied to clipboard', 'ok');
    }).catch(() => {
      this.showStatus('Failed to copy results', 'err');
    });
  }

  renderQueryHistory() {
    const container = document.getElementById('queryHistory');
    container.innerHTML = '';
    
    this.engine.queryHistory.slice(0, 10).forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `
        <div class="history-sql">${item.sql.substring(0, 50)}${item.sql.length > 50 ? '...' : ''}</div>
        <div class="history-time">${new Date(item.timestamp).toLocaleString()}</div>
      `;
      div.onclick = () => {
        document.getElementById('queryInput').value = item.sql;
      };
      container.appendChild(div);
    });
  }

  showStatus(message, type = 'ok') {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
    
    setTimeout(() => {
      status.style.display = 'none';
    }, 3000);
  }
}

// Initialize when page loads
(async function init() {
  try {
    const ui = new QueryUI();
    await ui.initialize();
  } catch (error) {
    console.error('Failed to initialize query interface:', error);
    document.getElementById('status').textContent = `Initialization failed: ${error.message}`;
    document.getElementById('status').className = 'status err';
    document.getElementById('status').style.display = 'block';
  }
})();