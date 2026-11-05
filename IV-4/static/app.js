const state = {
  participantCode: '',
  order: [],
  index: 0,
  episodeMap: {},
  episodeStartTs: null,
  currentEpisodeId: null,
};

const chartEl = document.getElementById('wind-chart');
const progressPill = document.getElementById('progress-pill');
const episodeLabel = document.getElementById('episode-label');
const participantLabel = document.getElementById('participant-label');
const introPanel = document.getElementById('intro-panel');
const startButton = document.getElementById('start-button');
const studyPanel = document.getElementById('study-panel');
const summaryPanel = document.getElementById('summary-panel');
const totalCostEl = document.getElementById('total-cost');
const perfectCostEl = document.getElementById('perfect-cost');
const correctCountEl = document.getElementById('correct-count');
const summaryTableBody = document.getElementById('summary-table-body');

function formatCurrency(value) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  return `${seconds}s`;
}

async function loadEpisodeMap() {
  const response = await fetch('/api/episode-data');
  state.episodeMap = await response.json();
}

async function startStudy() {
  const response = await fetch('/api/session/new', { method: 'POST' });
  const json = await response.json();
  state.participantCode = json.participant_code;
  state.order = json.order;
  state.index = 0;
  introPanel.classList.add('hidden');
  studyPanel.classList.remove('hidden');
  participantLabel.textContent = `Participant: ${state.participantCode}`;
  renderCurrentEpisode();
}

function renderCurrentEpisode() {
  const total = state.order.length;
  const episodeId = state.order[state.index];
  state.currentEpisodeId = episodeId;
  state.episodeStartTs = Date.now();
  const episode = state.episodeMap[episodeId];

  episodeLabel.textContent = `Episode ${state.index + 1} / ${total}`;
  progressPill.textContent = `${state.index + 1} / ${total}`;

  const points = episode.points || [];
  drawWindChart(points, episode.threshold || 5);
}

function drawWindChart(points, threshold) {
  const width = 920;
  const height = 360;
  const margin = { top: 20, right: 30, bottom: 46, left: 54 };
  const xMin = 0;
  const lastDataStep = points.length > 0 ? Math.max(...points.map((p) => Number(p.step))) : 0;
  // Reserve one empty 3-hour interval after the last data point for the decision window.
  const xMax = lastDataStep + 1;
  const yMin = 0;
  const yMax = 12;

  const xScale = (step) => margin.left + ((step - xMin) / Math.max(1, xMax - xMin)) * (width - margin.left - margin.right);
  const yScale = (wind) => height - margin.bottom - ((wind - yMin) / Math.max(1, yMax - yMin)) * (height - margin.top - margin.bottom);

  const axisColor = '#cbd5e1';
  const gridColor = '#334155';
  const thresholdColor = '#f87171';
  const windowColor = '#60a5fa';

  const windowSteps = points
    .filter((point) => Number(point.in_window) === 1)
    .map((point) => Number(point.step));
  const windowStartStep = windowSteps.length > 0 ? Math.min(...windowSteps) : 0;
  const windowEndStep = windowSteps.length > 0 ? Math.max(...windowSteps) + 1 : 1;
  const windowStartX = xScale(windowStartStep);
  const windowEndX = xScale(windowEndStep);
  const windowX = windowStartX;
  const windowWidth = Math.max(12, windowEndX - windowStartX);
  const windowCenter = windowX + windowWidth / 2;

  const gridLines = [];
  for (let tick = 0; tick <= 12; tick += 2) {
    const yValue = yScale(tick);
    gridLines.push(`<line x1="${margin.left}" y1="${yValue}" x2="${width - margin.right}" y2="${yValue}" stroke="${gridColor}" stroke-width="1" />`);
    gridLines.push(`<text x="${margin.left - 10}" y="${yValue + 4}" text-anchor="end" font-size="11" fill="${axisColor}">${tick}</text>`);
  }

  const xAxisTicks = [];
  for (let tick = 0; tick <= xMax; tick += 4) {
    xAxisTicks.push(tick);
  }
  if (xAxisTicks[xAxisTicks.length - 1] !== xMax) {
    xAxisTicks.push(xMax);
  }
  xAxisTicks.forEach((tick) => {
    const xValue = xScale(tick);
    gridLines.push(`<line x1="${xValue}" y1="${margin.top}" x2="${xValue}" y2="${height - margin.bottom}" stroke="${gridColor}" stroke-width="1" />`);
    gridLines.push(`<text x="${xValue}" y="${height - margin.bottom + 18}" text-anchor="middle" font-size="11" fill="${axisColor}">${tick * 3}h</text>`);
  });

  const contextCircles = (points || [])
    .filter((point) => Number(point.in_window) !== 1)
    .map((point) => {
    const x = xScale(Number(point.step));
    const y = yScale(Number(point.wind_speed_100m));
    return `<circle cx="${x}" cy="${y}" r="5.6" fill="#e0f2fe" stroke="#60a5fa" stroke-width="1" opacity="0.98" />`;
  }).join('');

  const decisionPoints = (points || []).filter((point) => Number(point.in_window) === 1);
  const decisionSteps = decisionPoints.map((point) => Number(point.step));
  const decisionStepMin = decisionSteps.length > 0 ? Math.min(...decisionSteps) : 0;
  const decisionStepMax = decisionSteps.length > 0 ? Math.max(...decisionSteps) : 1;
  const decisionCircles = decisionPoints.map((point) => {
    const step = Number(point.step);
    const member = Number(point.member);
    const timePosition = decisionStepMax === decisionStepMin
      ? 0.5
      : (step - decisionStepMin) / (decisionStepMax - decisionStepMin);
    const memberJitter = decisionStepMax === decisionStepMin
      ? ((member - 1) / 9 - 0.5) * Math.min(windowWidth * 0.8, 10)
      : 0;
    const x = windowX + windowWidth * Math.max(0.08, Math.min(0.92, timePosition)) + memberJitter;
    const y = yScale(Number(point.wind_speed_100m));
    return `<circle cx="${x}" cy="${y}" r="5.6" fill="#e0f2fe" stroke="#60a5fa" stroke-width="1" opacity="0.98" />`;
  }).join('');

  const thresholdY = yScale(threshold);
  const thresholdLine = `<line x1="${margin.left}" y1="${thresholdY}" x2="${width - margin.right}" y2="${thresholdY}" stroke="${thresholdColor}" stroke-width="4" stroke-dasharray="6 6" />`;
  const thresholdWindowLine = `<line x1="${windowX}" y1="${thresholdY}" x2="${windowX + windowWidth}" y2="${thresholdY}" stroke="${thresholdColor}" stroke-width="5" stroke-dasharray="6 6" />`;
  const thresholdLabel = `<text x="${margin.left + 12}" y="${thresholdY - 8}" text-anchor="start" font-size="12" fill="${thresholdColor}" font-weight="700">5 m/s</text>`;
  const decisionWindow = `
    <rect x="${windowX}" y="${margin.top}" width="${windowWidth}" height="${height - margin.top - margin.bottom}"
      fill="${windowColor}" fill-opacity="0.16" stroke="${windowColor}" stroke-width="2" stroke-dasharray="5 4" />
    <rect x="${Math.max(margin.left, windowCenter - 74)}" y="${margin.top + 8}" width="148" height="24" rx="12"
      fill="#1e3a8a" fill-opacity="0.96" />
    <text x="${windowCenter}" y="${margin.top + 24}" text-anchor="middle" font-size="12" fill="#eff6ff" font-weight="700">
      3-hour decision window
    </text>
    <line x1="${windowX}" y1="${height - margin.bottom - 8}" x2="${windowX}" y2="${height - margin.bottom + 8}"
      stroke="${windowColor}" stroke-width="3" />
    <line x1="${xScale(windowEndStep)}" y1="${height - margin.bottom - 8}" x2="${xScale(windowEndStep)}" y2="${height - margin.bottom + 8}"
      stroke="${windowColor}" stroke-width="3" />
  `;

  chartEl.innerHTML = `
    <g>
      ${gridLines.join('')}
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="${axisColor}" stroke-width="1.2" />
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="${axisColor}" stroke-width="1.2" />
      <text x="${(margin.left + width - margin.right) / 2}" y="${height - 8}" text-anchor="middle" font-size="12" fill="${axisColor}">Time from episode start</text>
      <text x="14" y="${height / 2}" text-anchor="middle" font-size="12" fill="${axisColor}" transform="rotate(-90 14 ${height / 2})">Wind speed at 100 m (m/s)</text>
      ${decisionWindow}
      ${contextCircles}
      ${decisionCircles}
      ${thresholdLine}
      ${thresholdWindowLine}
      ${thresholdLabel}
    </g>
  `;
}

function handleDecision(choice) {
  const episodeId = state.currentEpisodeId;
  const elapsedMs = Date.now() - state.episodeStartTs;

  fetch(`/api/session/${state.participantCode}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      episode_id: episodeId,
      choice,
      elapsed_ms: elapsedMs,
      started_at: new Date(state.episodeStartTs).toISOString(),
      submitted_at: new Date().toISOString(),
    }),
  })
    .then((response) => response.json())
    .then(() => {
      state.index += 1;
      if (state.index >= state.order.length) {
        showSummary();
      } else {
        renderCurrentEpisode();
      }
    })
    .catch((error) => {
      console.error('Decision submission failed.', error);
      state.index += 1;
      if (state.index >= state.order.length) {
        showSummary();
      } else {
        renderCurrentEpisode();
      }
    });
}

function showSummary() {
  studyPanel.classList.add('hidden');
  summaryPanel.classList.remove('hidden');

  fetch(`/api/session/${state.participantCode}/summary`)
    .then((response) => response.json())
    .then((data) => {
      totalCostEl.textContent = formatCurrency(data.total_cost || 0);
      perfectCostEl.textContent = formatCurrency(data.perfect_cost || 0);
      correctCountEl.textContent = `${data.correct_count || 0} / ${data.episode_count || 0}`;

      summaryTableBody.innerHTML = (data.episodes || []).map((entry) => {
        const decisionLabel = entry.choice === 'send' ? 'Send crew' : 'Do not send';
        const correctClass = entry.correct ? 'correct-true' : 'correct-false';
        return `
          <tr>
            <td>${entry.episode_id}</td>
            <td>${decisionLabel}</td>
            <td class="${correctClass}">${entry.correct ? 'Yes' : 'No'}</td>
            <td>${formatDuration(entry.elapsed_ms)}</td>
            <td>${formatCurrency(entry.cost)}</td>
          </tr>
        `;
      }).join('');
    })
    .catch((error) => {
      console.error('Loading final summary failed.', error);
    });
}

document.querySelectorAll('button[data-choice]').forEach((button) => {
  button.addEventListener('click', () => handleDecision(button.dataset.choice));
});

(async function init() {
  studyPanel.classList.add('hidden');
  summaryPanel.classList.add('hidden');
  progressPill.classList.add('hidden');
  await loadEpisodeMap();
})();

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  startButton.textContent = 'Starting...';
  try {
    progressPill.classList.remove('hidden');
    await startStudy();
  } catch (error) {
    console.error('Could not start the study.', error);
    startButton.disabled = false;
    startButton.textContent = 'Start study';
    progressPill.classList.add('hidden');
  }
});
