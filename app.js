const storageKey = "online-chaigu-tool-v2";
const legacyStorageKey = "online-chaigu-tool-v1";
const flipSoundEnabled = false;
const palette = ["#F7235F", "#ED38AA", "#1F4EEA", "#7394FF", "#2FE1C3", "#50DB7A", "#B6825D", "#1EF61A", "#F0CF2D", "#ED9333", "#FF6969", "#DC2424"];
const optionNameCollator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createPlan(title = "点我打开方案配置") {
  return {
    id: createId(),
    title,
    noRepeat: false,
    colors: palette.slice(0, 6),
    options: [
      { id: createId(), name: "徽章", weight: 1, selected: false },
      { id: createId(), name: "立牌", weight: 1, selected: false },
      { id: createId(), name: "色纸", weight: 1, selected: false },
      { id: createId(), name: "挂件", weight: 1, selected: false },
      { id: createId(), name: "明信片", weight: 1, selected: false },
      { id: createId(), name: "隐藏款", weight: 1, selected: false }
    ]
  };
}

function normalizePlan(plan) {
  const fallback = createPlan();
  return {
    ...fallback,
    ...plan,
    id: plan.id || createId(),
    options: plan.options && plan.options.length ? plan.options : fallback.options,
    colors: plan.colors && plan.colors.length ? plan.colors : fallback.colors
  };
}

function loadWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && saved.plans && saved.plans.length) {
      const plans = saved.plans.map(normalizePlan);
      const activePlanId = plans.some(plan => plan.id === saved.activePlanId) ? saved.activePlanId : plans[0].id;
      const history = Array.isArray(saved.history) ? saved.history.filter(item => item && item.result).slice(0, 100) : [];
      return { plans, activePlanId, history };
    }
    const legacy = JSON.parse(localStorage.getItem(legacyStorageKey));
    if (legacy && legacy.options && legacy.options.length) {
      const plan = normalizePlan(legacy);
      return { plans: [plan], activePlanId: plan.id, history: [] };
    }
  } catch {}
  const plan = createPlan();
  return { plans: [plan], activePlanId: plan.id, history: [] };
}

function formatHistoryTime(timestamp) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

let workspace = loadWorkspace();
let state = workspace.plans.find(plan => plan.id === workspace.activePlanId);
let hasResult = false;
let drawCycle = 0;
let shakeCycle = 0;
let shuffleAudioContext;
let shuffleAudioBuffer;

const el = {
  drawCard: document.querySelector("#drawCard"),
  cardInner: document.querySelector("#cardInner"),
  cardFront: document.querySelector("#cardFront"),
  cardBack: document.querySelector("#cardBack"),
  resultText: document.querySelector("#resultText"),
  drawHint: document.querySelector("#drawHint"),
  title: document.querySelector("#schemeTitle"),
  meta: document.querySelector("#schemeMeta"),
  shuffle: document.querySelector("#shuffleButton"),
  shuffleSound: document.querySelector("#shuffleSound"),
  flipSound: document.querySelector("#flipSound"),
  historyButton: document.querySelector("#historyButton"),
  historyPanel: document.querySelector("#historyPanel"),
  historyPanelScrim: document.querySelector("#historyPanelScrim"),
  closeHistory: document.querySelector("#closeHistory"),
  historySummary: document.querySelector("#historySummary"),
  historyList: document.querySelector("#historyList"),
  historyEmpty: document.querySelector("#historyEmpty"),
  settingsPanel: document.querySelector("#settingsPanel"),
  settingsButton: document.querySelector("#settingsButton"),
  closeSettings: document.querySelector("#closeSettings"),
  panelScrim: document.querySelector("#panelScrim"),
  planListView: document.querySelector("#planListView"),
  planEditorView: document.querySelector("#planEditorView"),
  schemeList: document.querySelector("#schemeList"),
  createPlan: document.querySelector("#createPlanButton"),
  backToPlans: document.querySelector("#backToPlans"),
  deletePlan: document.querySelector("#deletePlanButton"),
  panelKicker: document.querySelector("#panelKicker"),
  panelTitle: document.querySelector("#panelTitle"),
  schemeName: document.querySelector("#schemeNameInput"),
  noRepeat: document.querySelector("#noRepeatToggle"),
  totalWeight: document.querySelector("#totalWeight"),
  options: document.querySelector("#optionList"),
  sortOptions: document.querySelector("#sortOptions"),
  addOption: document.querySelector("#addOption"),
  validation: document.querySelector("#validationMessage")
};

function save() {
  localStorage.setItem(storageKey, JSON.stringify(workspace));
}

function unlockShuffleSound() {
  if (shuffleAudioContext && shuffleAudioContext.state === "suspended") {
    shuffleAudioContext.resume().catch(() => {});
  }
}

function prepareShuffleSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || !window.fetch) return;
  try {
    shuffleAudioContext = new AudioContextClass({ latencyHint: "interactive" });
    fetch("assets/audio/daluan.mp3")
      .then(response => response.arrayBuffer())
      .then(buffer => shuffleAudioContext.decodeAudioData(buffer))
      .then(buffer => { shuffleAudioBuffer = buffer; })
      .catch(() => {});
  } catch {}
}

function playShuffleSound() {
  if (shuffleAudioContext && shuffleAudioBuffer && shuffleAudioContext.state === "running") {
    const source = shuffleAudioContext.createBufferSource();
    source.buffer = shuffleAudioBuffer;
    source.connect(shuffleAudioContext.destination);
    source.start();
    return;
  }
  el.shuffleSound.currentTime = 0;
  el.shuffleSound.play().catch(() => {});
}

function activeOptions() {
  return state.options.filter(option => option.name.trim() && option.weight > 0 && (!state.noRepeat || !option.selected));
}

function formatProbability(weight, total) {
  const value = total ? (weight / total) * 100 : 0;
  return `${value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function tintColor(hex, ratio = 0.16) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = offset => Math.round(255 - (255 - ((value >> offset) & 255)) * ratio);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function applyCardColor(color) {
  el.cardFront.style.backgroundColor = color;
  el.cardBack.style.backgroundColor = tintColor(color);
}

function renderStage() {
  const active = activeOptions();
  el.title.textContent = state.title || "未命名方案";
  el.meta.textContent = `当前方案 · ${active.length} 个可选结果`;
  if (!hasResult) el.drawHint.textContent = active.length >= 2 ? "点击卡片，随机揭晓一个结果" : "请在设置中保留至少 2 个有效选项";
  applyCardColor(state.colors[0] || palette[0]);
}

function renderPlans() {
  el.schemeList.innerHTML = "";
  workspace.plans.forEach(plan => {
    const count = plan.options.filter(option => option.name.trim() && option.weight > 0).length;
    const item = document.createElement("div");
    item.className = `scheme-item${plan.id === state.id ? " is-active" : ""}`;
    item.innerHTML = `<button class="scheme-select" data-id="${plan.id}" type="button"><strong>${escapeHtml(plan.title || "未命名方案")}</strong><span>${count} 个选项</span></button><button class="scheme-edit" data-id="${plan.id}" type="button" aria-label="编辑方案">编辑</button>`;
    el.schemeList.append(item);
  });
}

function renderHistory() {
  const history = workspace.history || [];
  el.historySummary.textContent = `最近 ${history.length} 条 · 最多保留 100 条`;
  el.historyList.innerHTML = "";
  el.historyEmpty.hidden = history.length > 0;
  history.forEach(item => {
    const row = document.createElement("div");
    row.className = "history-item";
    row.innerHTML = `<div class="history-main"><strong>${escapeHtml(item.result)}</strong><span>${escapeHtml(item.planTitle || "未命名方案")}</span></div><time>${formatHistoryTime(item.timestamp)}</time>`;
    el.historyList.append(row);
  });
}

function renderOptions() {
  const total = state.options.reduce((sum, option) => sum + (option.name.trim() ? Number(option.weight) || 0 : 0), 0);
  el.totalWeight.textContent = `总权重 ${total}`;
  el.options.innerHTML = "";
  state.options.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "option-row";
    row.innerHTML = `<input class="option-name" data-id="${option.id}" aria-label="选项内容" maxlength="30" value="${escapeHtml(option.name)}" placeholder="选项内容" /><input class="option-weight" data-id="${option.id}" aria-label="权重" type="number" min="1" max="9999" value="${option.weight}" /><span class="probability">${formatProbability(option.weight, total)}</span><button class="delete-option" data-id="${option.id}" type="button" aria-label="删除 ${index + 1}"><img class="delete-icon" src="assets/close-line.svg" alt="" /></button>`;
    el.options.append(row);
  });
  validate();
}

function updateOptionSummaries() {
  const total = state.options.reduce((sum, option) => sum + (option.name.trim() ? Number(option.weight) || 0 : 0), 0);
  el.totalWeight.textContent = `总权重 ${total}`;
  state.options.forEach((option, index) => {
    const row = el.options.children[index];
    const probability = row ? row.querySelector(".probability") : null;
    if (probability) probability.textContent = formatProbability(option.weight, total);
  });
  validate();
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function validate() {
  el.validation.textContent = activeOptions().length < 2 ? "至少保留 2 个名称和权重均有效的选项。" : "";
}

function renderAll() {
  el.schemeName.value = state.title;
  el.noRepeat.checked = state.noRepeat;
  el.deletePlan.disabled = workspace.plans.length === 1;
  renderStage();
  renderPlans();
  renderOptions();
  renderHistory();
}

function secureRandom(max) {
  if (!window.crypto || !window.crypto.getRandomValues) return Math.floor(Math.random() * max);
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer); while (buffer[0] >= limit);
  return buffer[0] % max;
}

function chooseOption() {
  const candidates = activeOptions();
  const total = candidates.reduce((sum, option) => sum + Number(option.weight), 0);
  if (candidates.length < 2 || !total) return null;
  let cursor = secureRandom(total);
  return candidates.find(option => (cursor -= Number(option.weight)) < 0) || candidates[candidates.length - 1];
}

function cardRotation() {
  const transform = getComputedStyle(el.cardInner).transform;
  if (transform === "none") return hasResult ? 180 : 0;
  const matrix3d = transform.match(/matrix3d\((.+)\)/);
  if (matrix3d) {
    const values = matrix3d[1].split(",").map(Number);
    if (values.length === 16) return Math.atan2(-values[2], values[0]) * 180 / Math.PI;
  }
  const matrix = transform.match(/matrix\((.+)\)/);
  if (matrix) {
    const values = matrix[1].split(",").map(Number);
    if (values.length === 6) return Math.atan2(values[1], values[0]) * 180 / Math.PI;
  }
  return hasResult ? 180 : 0;
}

function restartFlipFromCurrentAngle(startAngle = cardRotation()) {
  el.cardInner.style.setProperty("--redraw-start", `${startAngle}deg`);
  el.cardInner.style.setProperty("--redraw-end", "540deg");
  el.drawCard.classList.remove("is-redrawing");
  void el.cardInner.offsetWidth;
  el.drawCard.classList.add("is-redrawing");
}

function randomizeCardColor() {
  const current = state.colors[0] || palette[0];
  const choices = palette.filter(color => color !== current);
  const nextColor = choices[secureRandom(choices.length)];
  state.colors = [nextColor, ...palette.filter(color => color !== nextColor)].slice(0, state.options.length);
  applyCardColor(nextColor);
}

function shuffleOptions() {
  const original = state.options.slice();
  for (let index = state.options.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandom(index + 1);
    [state.options[index], state.options[swapIndex]] = [state.options[swapIndex], state.options[index]];
  }
  if (state.options.length > 1 && state.options.every((option, index) => option.id === original[index].id)) {
    state.options.push(state.options.shift());
  }
}

function resetCard() {
  drawCycle += 1;
  el.drawCard.classList.add("is-resetting");
  el.drawCard.classList.remove("is-flipped", "is-redrawing");
  void el.cardInner.offsetWidth;
  el.drawCard.classList.remove("is-resetting");
  el.resultText.textContent = "准备好了";
  hasResult = false;
}

function recordHistory(result) {
  workspace.history.unshift({ id: createId(), result, planTitle: state.title || "未命名方案", timestamp: Date.now() });
  if (workspace.history.length > 100) workspace.history.length = 100;
  renderHistory();
  save();
}

function draw() {
  const picked = chooseOption();
  if (!picked) {
    el.drawHint.textContent = "请先在设置中补充至少 2 个有效选项";
    openPanel();
    return;
  }
  if (flipSoundEnabled) {
    el.flipSound.currentTime = 0;
    el.flipSound.play().catch(() => {});
  }
  randomizeCardColor();
  const wasRevealed = hasResult;
  el.resultText.textContent = picked.name;
  if (state.noRepeat) picked.selected = true;
  hasResult = true;
  el.drawHint.textContent = state.noRepeat ? "结果已从后续抽取中移除" : "再次点击卡片，重新随机抽取";
  if (!wasRevealed) el.drawCard.classList.add("is-flipped");
  restartFlipFromCurrentAngle(wasRevealed ? cardRotation() : 0);
  const cycle = ++drawCycle;
  window.requestAnimationFrame(() => {
    if (cycle !== drawCycle) return;
    save();
    renderStage();
  });
  window.setTimeout(() => {
    if (cycle !== drawCycle) return;
    recordHistory(picked.name);
  }, 760);
  window.setTimeout(() => {
    if (cycle === drawCycle) el.drawCard.classList.remove("is-redrawing");
  }, 740);
}

function shuffleColors() {
  playShuffleSound();
  shuffleOptions();
  randomizeCardColor();
  resetCard();
  const cycle = ++shakeCycle;
  el.drawCard.classList.remove("is-shaking");
  void el.drawCard.offsetWidth;
  el.drawCard.classList.add("is-shaking");
  window.setTimeout(() => {
    if (cycle === shakeCycle) el.drawCard.classList.remove("is-shaking");
  }, 320);
  renderStage();
  renderOptions();
  save();
}

function showPlanList() {
  el.planListView.hidden = false;
  el.planEditorView.hidden = true;
  el.panelKicker.textContent = "方案管理";
  el.panelTitle.textContent = "我的方案";
  renderPlans();
}

function showPlanEditor(canManagePlans = false) {
  el.planListView.hidden = true;
  el.planEditorView.hidden = false;
  el.backToPlans.hidden = !canManagePlans;
  el.deletePlan.hidden = !canManagePlans;
  el.panelKicker.textContent = "方案设置";
  el.panelTitle.textContent = "编辑选项";
  renderAll();
}

function selectPlan(id, edit = false) {
  const plan = workspace.plans.find(item => item.id === id);
  if (!plan) return;
  workspace.activePlanId = id;
  state = plan;
  resetCard();
  save();
  renderAll();
  if (edit) showPlanEditor(true);
  else closePanel();
}

function openPanel() {
  el.settingsPanel.classList.add("is-open");
  el.settingsPanel.setAttribute("aria-hidden", "false");
  showPlanEditor();
}

function openPlanManager() {
  el.settingsPanel.classList.add("is-open");
  el.settingsPanel.setAttribute("aria-hidden", "false");
  showPlanList();
}

function closePanel() {
  el.settingsPanel.classList.remove("is-open");
  el.settingsPanel.setAttribute("aria-hidden", "true");
}

function openHistory() {
  el.historyPanel.classList.add("is-open");
  el.historyPanel.setAttribute("aria-hidden", "false");
  renderHistory();
}

function closeHistory() {
  el.historyPanel.classList.remove("is-open");
  el.historyPanel.setAttribute("aria-hidden", "true");
}

el.drawCard.addEventListener("click", draw);
el.shuffle.addEventListener("click", shuffleColors);
prepareShuffleSound();
document.addEventListener("pointerdown", unlockShuffleSound, { once: true });
el.historyButton.addEventListener("click", openHistory);
el.settingsButton.addEventListener("click", openPanel);
el.title.addEventListener("click", openPlanManager);
el.closeSettings.addEventListener("click", closePanel);
el.panelScrim.addEventListener("click", closePanel);
el.closeHistory.addEventListener("click", closeHistory);
el.historyPanelScrim.addEventListener("click", closeHistory);
el.backToPlans.addEventListener("click", showPlanList);

el.schemeList.addEventListener("click", event => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  selectPlan(button.dataset.id, button.classList.contains("scheme-edit"));
});

el.createPlan.addEventListener("click", () => {
  const plan = createPlan("新方案");
  workspace.plans.push(plan);
  workspace.activePlanId = plan.id;
  state = plan;
  resetCard();
  save();
  showPlanEditor(true);
  el.schemeName.focus();
  el.schemeName.select();
});

el.deletePlan.addEventListener("click", () => {
  if (workspace.plans.length === 1 || !window.confirm(`删除方案“${state.title || "未命名方案"}”？`)) return;
  workspace.plans = workspace.plans.filter(plan => plan.id !== state.id);
  state = workspace.plans[0];
  workspace.activePlanId = state.id;
  resetCard();
  save();
  renderAll();
  showPlanList();
});

el.schemeName.addEventListener("input", event => {
  state.title = event.target.value;
  save();
  renderStage();
  renderPlans();
});

el.noRepeat.addEventListener("change", event => {
  state.noRepeat = event.target.checked;
  if (!state.noRepeat) state.options.forEach(option => { option.selected = false; });
  save();
  renderAll();
});

el.options.addEventListener("input", event => {
  const option = state.options.find(item => item.id === event.target.dataset.id);
  if (!option) return;
  if (event.target.classList.contains("option-name")) option.name = event.target.value;
  if (event.target.classList.contains("option-weight")) option.weight = Math.max(1, Math.min(9999, Number(event.target.value) || 1));
  save();
  renderStage();
  renderPlans();
  updateOptionSummaries();
});

el.options.addEventListener("click", event => {
  const button = event.target.closest(".delete-option");
  if (!button || state.options.length <= 2) return;
  state.options = state.options.filter(option => option.id !== button.dataset.id);
  save();
  renderAll();
});

el.sortOptions.addEventListener("click", () => {
  state.options.sort((left, right) => {
    const leftName = left.name.trim();
    const rightName = right.name.trim();
    if (!leftName) return 1;
    if (!rightName) return -1;
    return optionNameCollator.compare(leftName, rightName);
  });
  save();
  renderOptions();
});

el.addOption.addEventListener("click", () => {
  state.options.push({ id: createId(), name: "", weight: 1, selected: false });
  state.colors.push(palette[state.colors.length % palette.length]);
  save();
  renderAll();
  const lastOption = el.options.lastElementChild;
  if (lastOption) lastOption.querySelector(".option-name").focus();
});

renderAll();
