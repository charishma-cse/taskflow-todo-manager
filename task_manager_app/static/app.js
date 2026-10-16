(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    tasks: [], stats: { total: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0 },
    activeTab: 'all', page: 1, rowsPerPage: 10, selectedTaskId: null, deleteTaskId: null,
    query: '', statusFilter: 'all', priorityFilter: 'all', deadlineFilter: '',
  };

  const statusLabels = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' };
  const priorityLabels = { low: 'Low', medium: 'Medium', high: 'High' };
  const icons = {
    task: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20H7z"/><path d="M14 3.5V8h4M10 12h5M10 15.5h5"/></svg>',
    view: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z"/></svg>',
    delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
    empty: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10l3 3v13H4V4z"/><path d="M8 11h8M8 15h5M14 4v4h6"/></svg>',
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function prettyDate(value) {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) return '—';
    return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function prettyTimestamp(value) {
    if (!value) return '—';
    return prettyDate(value.slice(0, 10));
  }
  function toast(message, kind = 'success') {
    const element = document.createElement('div');
    element.className = `toast ${kind === 'error' ? 'toast-error' : 'toast-success'}`;
    element.textContent = message;
    $('#toastRegion').append(element);
    window.setTimeout(() => element.remove(), 3600);
  }
  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* non-JSON response */ }
    if (!response.ok) {
      const details = payload.details ? Object.values(payload.details).join(' ') : '';
      throw new Error(details || payload.error || `Request failed (${response.status})`);
    }
    return payload;
  }

  function currentParams() {
    const params = new URLSearchParams();
    const effectiveStatus = state.activeTab === 'all' ? state.statusFilter : state.activeTab;
    if (effectiveStatus !== 'all') params.set('status', effectiveStatus);
    if (state.priorityFilter !== 'all') params.set('priority', state.priorityFilter);
    if (state.query.trim()) params.set('q', state.query.trim());
    if (state.deadlineFilter) params.set('deadline', state.deadlineFilter);
    return params.toString();
  }

  async function loadStats() {
    try {
      state.stats = await api('/api/stats');
      $('#totalCount').textContent = state.stats.total;
      $('#pendingCount').textContent = state.stats.pending + state.stats.in_progress;
      $('#completedCount').textContent = state.stats.completed;
      $('#overdueCount').textContent = state.stats.overdue;
      $('#allTabCount').textContent = state.stats.total;
    } catch (error) {
      toast(`Couldn't load summary: ${error.message}`, 'error');
    }
  }

  async function loadTasks() {
    $('#taskTableBody').innerHTML = `<tr><td colspan="7"><div class="loading-state"><span class="spinner"></span>Loading your tasks...</div></td></tr>`;
    try {
      const query = currentParams();
      const payload = await api(`/api/tasks${query ? `?${query}` : ''}`);
      state.tasks = payload.tasks || [];
      const maxPage = Math.max(1, Math.ceil(state.tasks.length / state.rowsPerPage));
      state.page = Math.min(state.page, maxPage);
      renderTasks();
      await loadStats();
    } catch (error) {
      $('#taskTableBody').innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-illustration">!</div><strong>Couldn't load tasks</strong><p>${escapeHtml(error.message)}</p><button class="secondary-button" type="button" id="retryLoad">Try again</button></div></td></tr>`;
      $('#retryLoad')?.addEventListener('click', loadTasks);
    }
  }

  function renderTasks() {
    const total = state.tasks.length;
    const start = (state.page - 1) * state.rowsPerPage;
    const pageTasks = state.tasks.slice(start, start + state.rowsPerPage);
    $('#tableResultLabel').textContent = total ? `${total} ${total === 1 ? 'task' : 'tasks'} found` : 'Your tasks, all in one place';
    $('#footerNote').textContent = total ? 'Your changes are saved automatically' : 'Create a task to get your list started';
    $('#paginationLabel').textContent = total ? `${start + 1}–${Math.min(start + state.rowsPerPage, total)} of ${total}` : '0–0 of 0';
    $('#prevPage').disabled = state.page <= 1;
    $('#nextPage').disabled = state.page >= Math.ceil(total / state.rowsPerPage);

    if (!pageTasks.length) {
      const searching = Boolean(state.query || state.statusFilter !== 'all' || state.activeTab !== 'all' || state.priorityFilter !== 'all' || state.deadlineFilter);
      $('#taskTableBody').innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-illustration">${icons.empty}</div><strong>${searching ? 'No matching tasks' : 'Your task list is a fresh start'}</strong><p>${searching ? 'Try changing your search or clearing one of the filters.' : 'Capture your next task, set a priority, and keep moving forward.'}</p>${searching ? '<button class="secondary-button" type="button" id="emptyClearFilters">Clear filters</button>' : '<button class="primary-button" type="button" id="emptyCreateTask">＋ Create your first task</button>'}</div></td></tr>`;
      $('#emptyClearFilters')?.addEventListener('click', clearFilters);
      $('#emptyCreateTask')?.addEventListener('click', () => openTaskModal());
      return;
    }

    $('#taskTableBody').innerHTML = pageTasks.map(task => {
      const status = statusLabels[task.status] || 'Pending';
      const priority = priorityLabels[task.priority] || 'Medium';
      const markerClass = task.status === 'completed' ? 'marker-green' : task.status === 'in_progress' ? 'marker-blue' : '';
      return `<tr data-task-row="${task.id}">
        <td><div class="task-title-cell"><span class="task-marker ${markerClass}">${icons.task}</span><div class="task-name"><strong title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</strong><small>${escapeHtml(task.description || 'No description added')}</small></div></div></td>
        <td><span class="priority-pill priority-${task.priority}">${priority}</span></td>
        <td><button class="status-pill status-${task.status}" type="button" data-action="toggle-status" data-id="${task.id}" title="Click to mark this task ${task.status === 'completed' ? 'pending' : 'completed'}">${status}</button></td>
        <td>${escapeHtml(task.created_by || 'You')}</td>
        <td class="date-cell">${prettyTimestamp(task.created_at)}</td>
        <td class="date-cell ${task.overdue ? 'overdue-date' : ''}">${prettyDate(task.deadline)}${task.overdue ? '<span class="overdue-label">Overdue</span>' : ''}</td>
        <td><div class="actions-cell">
          <button class="action-icon view-action" type="button" data-action="view" data-id="${task.id}" aria-label="View ${escapeHtml(task.title)}" title="View details">${icons.view}</button>
          <button class="action-icon" type="button" data-action="edit" data-id="${task.id}" aria-label="Edit ${escapeHtml(task.title)}" title="Edit task">${icons.edit}</button>
          <button class="action-icon delete-action" type="button" data-action="delete" data-id="${task.id}" aria-label="Delete ${escapeHtml(task.title)}" title="Delete task">${icons.delete}</button>
          <span class="action-wrap"><button class="action-icon more-action" type="button" data-action="more" data-id="${task.id}" aria-label="More actions" title="More actions">${icons.more}</button></span>
        </div></td>
      </tr>`;
    }).join('');
  }

  function setTab(tab) {
    state.activeTab = tab;
    state.page = 1;
    $$('.tab').forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    // Tabs represent the primary view; reset the extra status filter to avoid conflicting filters.
    state.statusFilter = 'all';
    $('#statusFilter').value = 'all';
    $$('.nav-icon[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === tab));
    loadTasks();
  }

  function clearFilters() {
    state.query = '';
    state.statusFilter = 'all';
    state.priorityFilter = 'all';
    state.deadlineFilter = '';
    state.activeTab = 'all';
    state.page = 1;
    $('#searchInput').value = '';
    $('#statusFilter').value = 'all';
    $('#priorityFilter').value = 'all';
    $('#deadlineFilter').value = '';
    $$('.tab').forEach(button => {
      const active = button.dataset.tab === 'all';
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('.nav-icon[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === 'all'));
    loadTasks();
  }

  function showModal(backdrop) {
    backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function hideModal(backdrop) {
    backdrop.hidden = true;
    if ($('#taskModalBackdrop').hidden && $('#detailModalBackdrop').hidden && $('#confirmBackdrop').hidden) document.body.style.overflow = '';
  }

  function openTaskModal(task = null) {
    $('#taskForm').reset();
    $('#titleError').textContent = '';
    $('#taskId').value = task ? task.id : '';
    $('#modalTitle').textContent = task ? 'Edit task' : 'Create a task';
    $('#modalEyebrow').textContent = task ? 'UPDATE TASK' : 'TASK DETAILS';
    $('#saveTaskButton').innerHTML = task ? 'Save changes <span aria-hidden="true">→</span>' : 'Save task <span aria-hidden="true">→</span>';
    $('#taskTitle').value = task?.title || '';
    $('#taskDescription').value = task?.description || '';
    $('#taskDeadline').value = task?.deadline || '';
    $('#taskPriority').value = task?.priority || 'medium';
    $('#taskStatus').value = task?.status || 'pending';
    state.selectedTaskId = task?.id || null;
    showModal($('#taskModalBackdrop'));
    window.setTimeout(() => $('#taskTitle').focus(), 30);
  }

  async function viewTask(id) {
    try {
      const result = await api(`/api/tasks/${id}`);
      const task = result.task;
      state.selectedTaskId = task.id;
      $('#detailTitle').textContent = task.title;
      $('#detailContent').innerHTML = `<p class="detail-description">${escapeHtml(task.description || 'No description has been added to this task.')}</p><div class="detail-grid">
        <div class="detail-item"><span>Priority</span><strong><span class="priority-pill priority-${task.priority}">${priorityLabels[task.priority]}</span></strong></div>
        <div class="detail-item"><span>Status</span><strong><span class="status-pill status-${task.status}">${statusLabels[task.status]}</span></strong></div>
        <div class="detail-item"><span>Date assigned</span><strong>${prettyTimestamp(task.created_at)}</strong></div>
        <div class="detail-item"><span>Due date</span><strong class="${task.overdue ? 'detail-overdue' : ''}">${prettyDate(task.deadline)}${task.overdue ? ' · Overdue' : ''}</strong></div>
        <div class="detail-item"><span>Created by</span><strong>${escapeHtml(task.created_by || 'You')}</strong></div>
        <div class="detail-item"><span>Last updated</span><strong>${prettyTimestamp(task.updated_at)}</strong></div>
      </div>`;
      showModal($('#detailModalBackdrop'));
    } catch (error) { toast(error.message, 'error'); }
  }

  async function editTask(id) {
    try {
      const result = await api(`/api/tasks/${id}`);
      hideModal($('#detailModalBackdrop'));
      openTaskModal(result.task);
    } catch (error) { toast(error.message, 'error'); }
  }

  function openDeleteConfirmation(id) {
    state.deleteTaskId = Number(id);
    showModal($('#confirmBackdrop'));
  }

  async function deleteTask() {
    if (!state.deleteTaskId) return;
    try {
      await api(`/api/tasks/${state.deleteTaskId}`, { method: 'DELETE' });
      hideModal($('#confirmBackdrop'));
      toast('Task deleted successfully.');
      state.deleteTaskId = null;
      state.page = 1;
      await loadTasks();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function toggleTaskStatus(id) {
    const task = state.tasks.find(item => item.id === Number(id));
    if (!task) return;
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    try {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
      toast(newStatus === 'completed' ? 'Nice work — task completed!' : 'Task moved back to pending.');
      await loadTasks();
    } catch (error) { toast(error.message, 'error'); }
  }

  $('#taskTableBody').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      $$('.more-menu').forEach(menu => menu.remove());
      return;
    }
    event.stopPropagation();
    const { action, id } = button.dataset;
    if (action !== 'more') $$('.more-menu').forEach(menu => menu.remove());
    if (action === 'view') viewTask(id);
    if (action === 'edit') editTask(id);
    if (action === 'delete') openDeleteConfirmation(id);
    if (action === 'toggle-status') toggleTaskStatus(id);
    if (action === 'more') {
      const wrap = button.closest('.action-wrap');
      const existing = $('.more-menu', wrap);
      $$('.more-menu').forEach(menu => menu.remove());
      if (!existing) {
        const task = state.tasks.find(item => item.id === Number(id));
        const menu = document.createElement('div');
        menu.className = 'more-menu';
        menu.innerHTML = `<button type="button" data-menu-action="toggle">Mark ${task?.status === 'completed' ? 'pending' : 'completed'}</button><button type="button" data-menu-action="view">View task details</button><button type="button" data-menu-action="edit">Edit task</button>`;
        wrap.append(menu);
        menu.addEventListener('click', menuEvent => {
          const menuButton = menuEvent.target.closest('button[data-menu-action]');
          if (!menuButton) return;
          menu.remove();
          if (menuButton.dataset.menuAction === 'toggle') toggleTaskStatus(id);
          if (menuButton.dataset.menuAction === 'view') viewTask(id);
          if (menuButton.dataset.menuAction === 'edit') editTask(id);
        });
      }
    }
  });

  $('#taskForm').addEventListener('submit', async event => {
    event.preventDefault();
    const title = $('#taskTitle').value.trim();
    $('#titleError').textContent = '';
    if (!title) {
      $('#titleError').textContent = 'Task title is required.';
      $('#taskTitle').focus();
      return;
    }
    const id = $('#taskId').value;
    const body = {
      title,
      description: $('#taskDescription').value.trim(),
      deadline: $('#taskDeadline').value || null,
      priority: $('#taskPriority').value,
      status: $('#taskStatus').value,
    };
    const saveButton = $('#saveTaskButton');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    try {
      await api(id ? `/api/tasks/${id}` : '/api/tasks', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      hideModal($('#taskModalBackdrop'));
      toast(id ? 'Task updated successfully.' : 'Task created successfully.');
      // A newly created or edited task should not disappear because an old search remains active.
      if (!id) {
        state.query = '';
        $('#searchInput').value = '';
      }
      state.page = 1;
      await loadTasks();
    } catch (error) {
      $('#titleError').textContent = error.message.includes('title') ? error.message : '';
      toast(error.message, 'error');
    } finally {
      saveButton.disabled = false;
      saveButton.innerHTML = id ? 'Save changes <span aria-hidden="true">→</span>' : 'Save task <span aria-hidden="true">→</span>';
    }
  });

  $$('.tab').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
  $$('.nav-icon[data-nav]').forEach(button => button.addEventListener('click', () => setTab(button.dataset.nav)));
  $('#createTaskButton').addEventListener('click', () => openTaskModal());
  $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => hideModal($('#taskModalBackdrop'))));
  $$('[data-close-detail]').forEach(button => button.addEventListener('click', () => hideModal($('#detailModalBackdrop'))));
  $('#editFromDetails').addEventListener('click', () => { if (state.selectedTaskId) editTask(state.selectedTaskId); });
  $('#cancelDelete').addEventListener('click', () => { hideModal($('#confirmBackdrop')); state.deleteTaskId = null; });
  $('#confirmDelete').addEventListener('click', deleteTask);
  $('#applyFiltersButton').addEventListener('click', () => {
    state.statusFilter = $('#statusFilter').value;
    state.priorityFilter = $('#priorityFilter').value;
    state.deadlineFilter = $('#deadlineFilter').value;
    state.page = 1;
    // Selecting an explicit status dropdown should use the all-tasks tab, with the dropdown as the filter.
    state.activeTab = 'all';
    $$('.tab').forEach(button => { const active = button.dataset.tab === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
    loadTasks();
  });
  $('#clearFiltersButton').addEventListener('click', clearFilters);
  $('#rowsPerPage').addEventListener('change', event => { state.rowsPerPage = Number(event.target.value); state.page = 1; renderTasks(); });
  $('#prevPage').addEventListener('click', () => { if (state.page > 1) { state.page--; renderTasks(); } });
  $('#nextPage').addEventListener('click', () => { if (state.page < Math.ceil(state.tasks.length / state.rowsPerPage)) { state.page++; renderTasks(); } });

  let searchTimer;
  $('#searchInput').addEventListener('input', event => {
    window.clearTimeout(searchTimer);
    state.query = event.target.value;
    state.page = 1;
    searchTimer = window.setTimeout(loadTasks, 220);
  });
  $('#topSearchWrap').addEventListener('click', () => {
    $('#topSearchWrap').classList.add('open');
    $('#searchInput').focus();
  });
  document.addEventListener('click', event => {
    if (!$('#topSearchWrap').contains(event.target) && !$('#searchInput').value) $('#topSearchWrap').classList.remove('open');
    if (!event.target.closest('.action-wrap')) $$('.more-menu').forEach(menu => menu.remove());
  });
  $('#calendarNav').addEventListener('click', () => {
    $('#deadlineFilter').focus();
    $('#deadlineFilter').showPicker?.();
  });
  $('#themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const dark = document.body.classList.contains('dark-mode');
    $('#themeToggle').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Toggle dark mode');
    toast(dark ? 'Dark theme enabled.' : 'Light theme enabled.');
  });
  $('#settingsButton').addEventListener('click', () => toast('Tip: use the moon icon to switch between light and dark themes.'));
  $('#notificationsButton').addEventListener('click', () => toast('You’re all caught up — task updates appear here as you work.'));
  $('#profileButton').addEventListener('click', () => toast('You’re working in your personal task workspace.'));
  $('#taskModalBackdrop').addEventListener('click', event => { if (event.target === event.currentTarget) hideModal(event.currentTarget); });
  $('#detailModalBackdrop').addEventListener('click', event => { if (event.target === event.currentTarget) hideModal(event.currentTarget); });
  $('#confirmBackdrop').addEventListener('click', event => { if (event.target === event.currentTarget) hideModal(event.currentTarget); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hideModal($('#taskModalBackdrop'));
      hideModal($('#detailModalBackdrop'));
      hideModal($('#confirmBackdrop'));
      $$('.more-menu').forEach(menu => menu.remove());
    }
  });

  loadTasks();
})();
