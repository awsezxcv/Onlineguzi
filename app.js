const storageKey = "online-chaigu-tool-v2";
const legacyStorageKey = "online-chaigu-tool-v1";
const palette = ["#F7235F", "#ED38AA", "#1F4EEA", "#7394FF", "#2FE1C3", "#50DB7A", "#5BD939", "#E5DA0E", "#F0CF2D", "#ED9333", "#FF6969", "#DC2424"];

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createPlan(title = "今天拆哪一谷？") {
  return {
    id: createId(),
    title,
    noRepeat: false,
    colors: palette.slice(0, 6),
    options: [
      { id: createId(), name: "徽章", weight: 35, selected: false },
      { id: createId(), name: "立牌", weight: 25, selected: false },
      { id: createId(), name: "色纸", weight: 20, selected: false },
      { id: createId(), name: "挂件", weight: 12, selected: false },
      { id: createId(), name: "明信片", weight: 6, selected: false },
      { id: createId(), name: "隐藏款", weight: 2, selected: false }
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
      return { plans, activePlanId };
    }
    const legacy = JSON.parse(localStorage.getItem(legacyStorageKey));
    if (legacy && legacy.options && legacy.options.length) {
      const plan = normalizePlan(legacy);
      return { plans: [plan], activePlanId: plan.id };
    }
  } catch {}
  const plan = createPlan();
  return { plans: [plan], activePlanId: plan.id };
}

let workspace = loadWorkspace();
let state = workspace.plans.find(plan => plan.id === workspace.activePlanId);
let hasResult = false;
let drawCycle = 0;

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
  schemeName: document.querySelector("#schemeNameInput"),
  noRepeat: document.querySelector("#noRepeatToggle"),
  totalWeight: document.querySelector("#totalWeight"),
  options: document.querySelector("#optionList"),
  addOption: document.querySelector("#addOption"),
  validation: document.querySelector("#validationMessage")
};

function save() {
  localStorage.setItem(storageKey, JSON.stringify(workspace));
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

function renderOptions() {
  const total = state.options.reduce((sum, option) => sum + (option.name.trim() ? Number(option.weight) || 0 : 0), 0);
  el.totalWeight.textContent = `总权重 ${total}`;
  el.options.innerHTML = "";
  state.options.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "option-row";
    row.innerHTML = `<input class="option-name" data-id="${option.id}" aria-label="选项内容" maxlength="30" value="${escapeHtml(option.name)}" placeholder="选项内容" /><input class="option-weight" data-id="${option.id}" aria-label="权重" type="number" min="1" max="9999" value="${option.weight}" /><span class="probability">${formatProbability(option.weight, total)}</span><button class="delete-option" data-id="${option.id}" type="button" aria-label="删除 ${index + 1}">×</button>`;
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

function restartFlipFromCurrentAngle() {
  el.cardInner.style.setProperty("--redraw-start", `${cardRotation()}deg`);
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

function resetCard() {
  drawCycle += 1;
  el.drawCard.classList.add("is-resetting");
  el.drawCard.classList.remove("is-flipped", "is-redrawing");
  void el.cardInner.offsetWidth;
  el.drawCard.classList.remove("is-resetting");
  el.resultText.textContent = "准备好了";
  hasResult = false;
}

function draw() {
  const picked = chooseOption();
  if (!picked) {
    el.drawHint.textContent = "请先在设置中补充至少 2 个有效选项";
    openPanel();
    return;
  }
  randomizeCardColor();
  const wasRevealed = hasResult;
  el.resultText.textContent = picked.name;
  if (state.noRepeat) picked.selected = true;
  hasResult = true;
  el.drawHint.textContent = state.noRepeat ? "结果已从后续抽取中移除" : "再次点击卡片，重新随机抽取";
  save();
  renderStage();
  renderPlans();
  renderOptions();
  if (wasRevealed) restartFlipFromCurrentAngle();
  else el.drawCard.classList.add("is-flipped");
  const cycle = ++drawCycle;
  window.setTimeout(() => {
    if (cycle === drawCycle) el.drawCard.classList.remove("is-redrawing");
  }, 740);
}

function shuffleColors() {
  randomizeCardColor();
  resetCard();
  renderStage();
  save();
}

function showPlanList() {
  el.planListView.hidden = false;
  el.planEditorView.hidden = true;
  renderPlans();
}

function showPlanEditor() {
  el.planListView.hidden = true;
  el.planEditorView.hidden = false;
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
  if (edit) showPlanEditor();
  else closePanel();
}

function openPanel() {
  el.settingsPanel.classList.add("is-open");
  el.settingsPanel.setAttribute("aria-hidden", "false");
  showPlanList();
}

function closePanel() {
  el.settingsPanel.classList.remove("is-open");
  el.settingsPanel.setAttribute("aria-hidden", "true");
}

el.drawCard.addEventListener("click", draw);
el.shuffle.addEventListener("click", shuffleColors);
el.settingsButton.addEventListener("click", openPanel);
el.closeSettings.addEventListener("click", closePanel);
el.panelScrim.addEventListener("click", closePanel);
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
  showPlanEditor();
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
  if (!event.target.classList.contains("delete-option") || state.options.length <= 2) return;
  state.options = state.options.filter(option => option.id !== event.target.dataset.id);
  save();
  renderAll();
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
