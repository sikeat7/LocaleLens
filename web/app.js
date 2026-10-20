const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
let token;
let page = 1;
let total = 0;
let selectedId;
let deleteId;
let snapshot = '';
let detailSnapshot = '';
let loading = false;
let searchTimer;
let ready = false;
let pipelineId;
let pipelineSnapshot = '';

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function notify(message, error = false) {
  const box = $('#feedback');
  box.textContent = message;
  box.classList.toggle('error', error);
  box.hidden = false;
}
async function api(url, method = 'GET', payload) {
  const response = await fetch(url, {
    method,
    headers: {
      'X-LocaleLens-Token': token,
      ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method !== 'GET' ? { body: JSON.stringify(payload ?? {}) } : {}),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    if (response.status === 403) ready = false;
    const error = new Error(result.error ?? `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}
async function connect() {
  const response = await fetch('/api/session');
  if (!response.ok) throw new Error('Could not connect to the local panel.');
  const session = await response.json();
  token = session.token;
  $('#version').textContent = `v${session.version}`;
  ready = true;
}
const isActive = (scan) => ['queued', 'running'].includes(scan.status);
const date = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
const checked = (name) => all(`input[name="${name}"]:checked`).map((input) => input.value);
const lines = (id) =>
  $(id)
    .value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
function estimate() {
  const devices = checked('viewport').length;
  const modes = checked('mode').length + 1;
  const routes = lines('#routes').length || 1;
  $('#estimate').textContent =
    `${devices * modes * routes} scenarios · ${devices} device${devices === 1 ? '' : 's'} · ${routes} page${routes === 1 ? '' : 's'}`;
}
function settingsFromForm() {
  const settings = {
    label: $('#label').value.trim(),
    url: $('#url').value.trim(),
    viewports: checked('viewport'),
    modes: ['baseline', ...checked('mode')],
    expansion: Number($('#expansion').value),
    locale: $('#locale').value.trim(),
    timeout: Number($('#timeout').value) * 1000,
    settle: Number($('#settle').value),
    ignore: lines('#ignore'),
    mask: lines('#mask'),
    screenshots: $('#screenshots').checked,
  };
  const routes = lines('#routes');
  if (routes.length) settings.routes = routes;
  if ($('#wait-for').value.trim()) settings.waitFor = $('#wait-for').value.trim();
  return settings;
}
all('input[name="preset"]').forEach((input) =>
  input.addEventListener('change', () => {
    const devices =
      input.value === 'quick'
        ? ['desktop']
        : input.value === 'thorough'
          ? ['desktop', 'mobile', 'tablet']
          : ['desktop', 'mobile'];
    const modes = input.value === 'quick' ? ['expanded'] : ['expanded', 'rtl', 'expanded-rtl'];
    all('input[name="viewport"]').forEach((field) => {
      field.checked = devices.includes(field.value);
    });
    all('input[name="mode"]').forEach((field) => {
      field.checked = modes.includes(field.value);
    });
    estimate();
  }),
);
all('input[name="viewport"],input[name="mode"],#routes').forEach((input) =>
  input.addEventListener('input', () => {
    all('input[name="preset"]').forEach((radio) => {
      radio.checked = false;
    });
    estimate();
  }),
);
$('#scan-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#start');
  button.disabled = true;
  try {
    if (!ready) await connect();
    const settings = settingsFromForm();
    if (!settings.viewports.length)
      throw new Error('Choose at least one device under Fine-tune your scan.');
    const scan = await api('/api/scans', 'POST', settings);
    pipelineId = scan.id;
    renderLivePipeline(scan, [scan]);
    page = 1;
    $('#search').value = '';
    $('#status').value = '';
    notify('Scan added. You can follow its progress in your history below.');
    await refresh();
    $('#pipeline-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});
function action(label, handler, className = 'button subtle') {
  const button = node('button', label, className);
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await handler();
    } catch (error) {
      notify(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
function reportLink(scan, format, label, className = 'button primary') {
  const link = node('a', label, className);
  link.href = `/reports/${scan.id}/${format}`;
  if (format === 'html') {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  return link;
}
async function rerun(scan) {
  const next = await api(`/api/scans/${scan.id}/rerun`, 'POST');
  pipelineId = next.id;
  renderLivePipeline(next, [next]);
  page = 1;
  $('#status').value = '';
  $('#search').value = '';
  notify('A new scan is queued with the same settings.');
  await refresh();
}
async function cancel(scan) {
  await api(`/api/scans/${scan.id}/cancel`, 'POST');
  notify('Scan cancelled. Its history has been kept.');
  await refresh();
}
function confirmDelete(scan) {
  deleteId = scan.id;
  $('#confirm-delete').showModal();
}
function renderRows(scans) {
  const list = $('#history-list');
  const fragment = document.createDocumentFragment();
  if (!scans.length) {
    const empty = node('div', undefined, 'empty');
    empty.append(
      node('span', '↗', 'empty-icon'),
      node(
        'h3',
        total
          ? 'No scans on this page'
          : $('#search').value || $('#status').value
            ? 'No matching scans'
            : 'Your first scan starts here',
      ),
      node(
        'p',
        $('#search').value || $('#status').value
          ? 'Try another search or choose all statuses.'
          : 'Paste a URL above. Every scan you run will appear here, ready to revisit whenever you need it.',
      ),
    );
    fragment.append(empty);
  }
  for (const scan of scans) {
    const row = $('#scan-row').content.cloneNode(true);
    const title = row.querySelector('.scan-title');
    title.textContent = scan.label || new URL(scan.url).hostname;
    title.addEventListener('click', () => showDetail(scan.id));
    row.querySelector('.scan-url').textContent = scan.url;
    row.querySelector('.scan-meta').textContent =
      `${date(scan.createdAt)} · ${scan.settings.viewports.length} device${scan.settings.viewports.length === 1 ? '' : 's'} · ${scan.settings.routes.length} page${scan.settings.routes.length === 1 ? '' : 's'}`;
    const badge = row.querySelector('.status-badge');
    badge.textContent = scan.status;
    badge.classList.add(scan.status);
    const result = row.querySelector('.result-summary');
    if (isActive(scan)) {
      result.textContent = `${scan.completed}/${scan.total} scenarios`;
      const progress = row.querySelector('progress');
      progress.hidden = false;
      progress.max = scan.total;
      progress.value = scan.completed;
      progress.setAttribute('aria-label', `Scan progress for ${title.textContent}`);
      const current = row.querySelector('.current');
      current.hidden = false;
      current.textContent =
        scan.current ||
        (scan.status === 'running' ? 'Starting the scan browser…' : 'Waiting for a free browser…');
    } else if (scan.hasReport && scan.error?.includes('Cloudflare')) {
      result.textContent = 'Access blocked · verification required';
      result.classList.add('issues');
    } else if (scan.summary) {
      result.textContent = `${scan.summary.errors} errors · ${scan.summary.warnings} warnings`;
      result.classList.toggle('issues', Boolean(scan.summary.errors || scan.summary.warnings));
    } else {
      result.textContent = scan.status === 'failed' ? 'Open details to troubleshoot' : '';
    }
    const actions = row.querySelector('.row-actions');
    if (isActive(scan)) actions.append(action('Cancel', () => cancel(scan)));
    else {
      if (scan.hasReport) actions.append(reportLink(scan, 'html', 'View report ↗'));
      actions.append(action('Run again', () => rerun(scan)));
      const remove = action('×', () => confirmDelete(scan), 'icon-button');
      remove.setAttribute('aria-label', `Delete ${scan.label || new URL(scan.url).hostname} scan`);
      actions.append(remove);
    }
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}
function detailField(grid, title, value) {
  const cell = node('div');
  cell.append(node('dt', title), node('dd', value));
  grid.append(cell);
}
const pipelineStages = [
  ['queued', 'Queued'],
  ['preparing', 'Preparing'],
  ['launching', 'Browser'],
  ['scanning', 'Scenarios'],
  ['reporting', 'Saving report'],
  ['finished', 'Ready'],
];
function pipelineView(scan) {
  const box = node('div', undefined, 'pipeline-view');
  const events = scan.pipeline ?? [];
  const reached = events.filter((event) => pipelineStages.some(([stage]) => stage === event.stage));
  if (!reached.length) {
    box.append(
      node('p', 'Detailed pipeline stages were not recorded for this older scan.', 'pipeline-hint'),
    );
    return box;
  }
  const last = events.at(-1);
  const stopped = ['failed', 'cancelled', 'interrupted'].includes(last.stage);
  const lastReached = reached.at(-1).stage;
  const steps = node('ol', undefined, 'pipeline-steps');
  steps.setAttribute('aria-label', 'Scan pipeline stages');
  for (const [index, [stage, label]] of pipelineStages.entries()) {
    const event = events.find((entry) => entry.stage === stage);
    const isCurrent = stage === lastReached && stage !== 'finished';
    const state = !event ? 'pending' : isCurrent ? (stopped ? 'stopped' : 'active') : 'done';
    const step = node('li', undefined, `pipeline-step ${state}`);
    const marker = node(
      'span',
      state === 'done' ? '✓' : state === 'stopped' ? '!' : String(index + 1),
      'pipeline-marker',
    );
    marker.setAttribute('aria-hidden', 'true');
    step.append(
      marker,
      node('strong', label),
      node(
        'small',
        state === 'done'
          ? 'Done'
          : state === 'stopped'
            ? scan.status
            : state === 'active'
              ? stage === 'queued'
                ? 'Waiting'
                : 'In progress'
              : 'Waiting',
      ),
    );
    if (isCurrent && !stopped) step.setAttribute('aria-current', 'step');
    steps.append(step);
  }
  box.append(steps);
  const activity = node('div', undefined, 'pipeline-activity');
  activity.append(
    node(
      'span',
      stopped ? 'Scan stopped' : last.stage === 'finished' ? 'Report ready' : 'Current activity',
      'pipeline-caption',
    ),
    node('p', scan.current || last.detail),
  );
  box.append(activity);
  const progress = node('div', undefined, 'pipeline-progress');
  progress.append(
    node('span', `Scenarios completed: ${scan.completed} / ${scan.total}`),
    node(
      'strong',
      `${Math.min(100, Math.round((scan.completed / Math.max(1, scan.total)) * 100))}%`,
    ),
  );
  const bar = node('progress');
  bar.max = Math.max(1, scan.total);
  bar.value = scan.completed;
  bar.setAttribute('aria-label', 'Scenarios completed');
  progress.append(bar);
  box.append(progress);
  const log = node('details', undefined, 'pipeline-log');
  log.append(node('summary', 'Stage timestamps'));
  const list = node('ol');
  for (const event of events) {
    const item = node('li');
    const time = node('time', new Date(event.at).toLocaleTimeString());
    time.dateTime = event.at;
    item.append(time, node('span', event.detail));
    list.append(item);
  }
  log.append(list);
  box.append(log);
  return box;
}
function renderLivePipeline(scan, choices) {
  const card = $('#pipeline-card');
  card.hidden = !scan || !scan.pipeline?.length;
  if (card.hidden) return;
  const selector = $('#pipeline-scan');
  const options = [...new Map([scan, ...choices].map((item) => [item.id, item])).values()];
  const optionsKey = JSON.stringify(
    options.map((item) => [item.id, item.label, item.url, item.status]),
  );
  if (selector.dataset.options !== optionsKey) {
    selector.replaceChildren(
      ...options.map((item) => {
        const option = node(
          'option',
          `${item.label || new URL(item.url).hostname} · ${item.status}`,
        );
        option.value = item.id;
        return option;
      }),
    );
    selector.dataset.options = optionsKey;
  }
  selector.value = scan.id;
  const state = JSON.stringify(scan);
  if (state !== pipelineSnapshot) {
    const openLog = $('#pipeline-body details')?.open;
    const focusedLog = document.activeElement === $('#pipeline-body summary');
    $('#pipeline-title').textContent = scan.label || scan.url;
    $('#pipeline-body').replaceChildren(pipelineView(scan));
    if (openLog && $('#pipeline-body details')) $('#pipeline-body details').open = true;
    if (focusedLog && $('#pipeline-body summary'))
      $('#pipeline-body summary').focus({ preventScroll: true });
    const actions = $('#pipeline-actions');
    const actionsKey = `${scan.id}:${scan.status}:${scan.hasReport}`;
    if (actions.dataset.state !== actionsKey) {
      actions.replaceChildren(action('Scan details', () => showDetail(scan.id)));
      if (scan.hasReport) actions.append(reportLink(scan, 'html', 'View report ↗'));
      if (isActive(scan)) actions.append(action('Cancel scan', () => cancel(scan)));
      actions.dataset.state = actionsKey;
    }
    pipelineSnapshot = state;
  }
  const start = Date.parse(scan.startedAt || scan.createdAt);
  const end = scan.finishedAt ? Date.parse(scan.finishedAt) : Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  $('#pipeline-elapsed').textContent =
    `${Math.floor(seconds / 60)}m ${seconds % 60}s ${isActive(scan) ? 'elapsed' : 'total'}`;
}
$('#pipeline-scan').addEventListener('change', () => {
  pipelineId = $('#pipeline-scan').value;
  pipelineSnapshot = '';
  refresh();
});
function renderDetail(scan) {
  $('#detail-title').textContent = scan.label || new URL(scan.url).hostname;
  const content = $('#detail-content');
  const badge = node('span', scan.status, `status-badge ${scan.status}`);
  const url = node('p', scan.url, 'detail-url');
  const grid = node('dl', undefined, 'detail-grid');
  detailField(grid, 'Created', date(scan.createdAt));
  detailField(grid, 'Finished', date(scan.finishedAt));
  detailField(grid, 'Devices', scan.settings.viewports.map((vp) => vp.name).join(', '));
  detailField(grid, 'Modes', scan.settings.modes.join(', '));
  detailField(grid, 'Page paths', scan.settings.routes.join(', '));
  detailField(grid, 'Expansion / locale', `${scan.settings.expansion}% / ${scan.settings.locale}`);
  if (scan.summary) {
    detailField(
      grid,
      'Findings',
      `${scan.summary.errors} errors, ${scan.summary.warnings} warnings`,
    );
    detailField(grid, 'Introduced by stress test', `${scan.summary.introduced} findings`);
    detailField(grid, 'Scenarios', `${scan.summary.passed} passed, ${scan.summary.failed} failed`);
    detailField(grid, 'Findings omitted by limit', String(scan.summary.omitted));
  }
  const fragment = document.createDocumentFragment();
  fragment.append(badge, url, grid);
  fragment.append(pipelineView(scan));
  if (isActive(scan)) {
    const progressBox = node('div', undefined, 'detail-progress');
    progressBox.append(
      node(
        'span',
        `${scan.completed}/${scan.total} scenarios · ${scan.current || 'Waiting for the browser'}`,
      ),
    );
    const progress = node('progress');
    progress.max = scan.total;
    progress.value = scan.completed;
    progress.setAttribute('aria-label', 'Scan progress');
    progressBox.append(progress);
    fragment.append(progressBox);
  }
  if (scan.error) {
    if (scan.error.includes('Could not launch Chromium')) {
      fragment.append(
        node(
          'div',
          scan.error.includes('macOS denied browser startup')
            ? 'macOS blocked the scan browser because this panel was started in a restricted environment. Close it and reopen LocaleLens from your normal Terminal or the project launcher. Chromium is already installed.'
            : 'The scan browser could not start. Reopen LocaleLens with the project launcher to check its browser setup. If you are running in a restricted environment, try your normal terminal.',
          'detail-error',
        ),
      );
      const diagnostic = node('details');
      diagnostic.append(
        node('summary', 'Technical details'),
        node('div', scan.error, 'detail-error'),
      );
      fragment.append(diagnostic);
    } else fragment.append(node('div', scan.error, 'detail-error'));
  }
  if (scan.status === 'failed' && scan.hasReport)
    fragment.append(
      node('p', 'Some pages could not be scanned. Open the report for the failure details.'),
    );
  const actions = node('div', undefined, 'detail-actions');
  if (scan.hasReport)
    actions.append(
      reportLink(scan, 'html', 'Open report ↗'),
      reportLink(scan, 'json', 'Download JSON', 'button subtle'),
    );
  if (isActive(scan)) actions.append(action('Cancel scan', () => cancel(scan)));
  else
    actions.append(
      action('Run again', () => rerun(scan)),
      action('Delete scan', () => confirmDelete(scan)),
    );
  fragment.append(actions);
  content.replaceChildren(fragment);
}
async function showDetail(id) {
  try {
    const scan = await api(`/api/scans/${id}`);
    selectedId = id;
    detailSnapshot = JSON.stringify(scan);
    renderDetail(scan);
    if (!$('#scan-detail').open) $('#scan-detail').showModal();
  } catch (error) {
    notify(error.message, true);
  }
}
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    if (!ready) await connect();
    const query = new URLSearchParams({
      page: String(page),
      q: $('#search').value,
      status: $('#status').value,
    });
    const result = await api(`/api/scans?${query}`);
    const activeScans = result.activeScans ?? [];
    let liveScan = [...activeScans, ...result.scans].find((item) => item.id === pipelineId);
    if (pipelineId && !liveScan) {
      try {
        liveScan = await api(`/api/scans/${pipelineId}`);
      } catch (error) {
        if (error.status !== 404) throw error;
        pipelineId = undefined;
      }
    }
    liveScan ??= activeScans[0] ?? result.scans[0];
    pipelineId = liveScan?.id;
    renderLivePipeline(liveScan, activeScans);
    total = result.total;
    if (page > 1 && !result.scans.length) {
      page--;
      snapshot = '';
      return;
    }
    const state = JSON.stringify(result.scans);
    if (state !== snapshot) {
      renderRows(result.scans);
      snapshot = state;
    }
    for (const key of ['total', 'active', 'completed', 'failed'])
      $(`#stat-${key}`).textContent = result.stats[key];
    $('#nav-count').textContent = result.stats.total;
    $('#history-count').textContent = result.total;
    $('#pagination').hidden = total <= result.pageSize;
    $('#page-label').textContent =
      `Page ${page} of ${Math.max(1, Math.ceil(total / result.pageSize))}`;
    $('#previous').disabled = page === 1;
    $('#next').disabled = page * result.pageSize >= total;
    $('#connection').hidden = true;
    if ($('#scan-detail').open && selectedId) {
      const scan = await api(`/api/scans/${selectedId}`);
      const state = JSON.stringify(scan);
      if (state !== detailSnapshot) {
        renderDetail(scan);
        detailSnapshot = state;
      }
    }
  } catch (error) {
    const box = $('#connection');
    box.textContent = `${error.message} Reconnecting automatically; your current view has been kept.`;
    box.classList.add('error');
    box.hidden = false;
  } finally {
    loading = false;
  }
}
$('#keep-scan').addEventListener('click', () => $('#confirm-delete').close());
$('#delete-scan').addEventListener('click', async () => {
  const button = $('#delete-scan');
  button.disabled = true;
  try {
    await api(`/api/scans/${deleteId}`, 'DELETE');
    if (pipelineId === deleteId) {
      pipelineId = undefined;
      pipelineSnapshot = '';
    }
    $('#confirm-delete').close();
    if (selectedId === deleteId) {
      $('#scan-detail').close();
      selectedId = undefined;
    }
    notify('Scan and saved reports deleted.');
    await refresh();
  } catch (error) {
    $('#confirm-delete').close();
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});
$('#close-detail').addEventListener('click', () => $('#scan-detail').close());
$('#scan-detail').addEventListener('close', () => {
  selectedId = undefined;
});
$('#help-button').addEventListener('click', () => $('#help').showModal());
$('#close-help').addEventListener('click', () => $('#help').close());
$('#refresh').addEventListener('click', refresh);
$('#status').addEventListener('change', () => {
  page = 1;
  refresh();
});
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page = 1;
    refresh();
  }, 250);
});
$('#previous').addEventListener('click', () => {
  page = Math.max(1, page - 1);
  refresh();
});
$('#next').addEventListener('click', () => {
  page++;
  refresh();
});
all('nav a').forEach((link) =>
  link.addEventListener('click', () => {
    all('nav a').forEach((item) => item.classList.toggle('active', item === link));
  }),
);
estimate();
refresh();
setInterval(() => {
  if (!document.hidden) refresh();
}, 2000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});
