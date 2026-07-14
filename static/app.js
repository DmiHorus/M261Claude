(() => {
  const REFRESH_MS = 60_000;

  const state = {
    rates: [],
    selectedCode: null,
    days: 30,
  };

  const els = {
    asOf: document.getElementById("asOf"),
    liveDot: document.getElementById("liveDot"),
    liveLabel: document.getElementById("liveLabel"),
    themeToggle: document.getElementById("themeToggle"),
    search: document.getElementById("search"),
    ratesBody: document.getElementById("ratesBody"),
    chartTitle: document.getElementById("chartTitle"),
    chartSub: document.getElementById("chartSub"),
    rangePresets: document.getElementById("rangePresets"),
    chart: document.getElementById("chart"),
    tooltip: document.getElementById("tooltip"),
  };

  // ---------- theme ----------
  function initTheme() {
    const saved = localStorage.getItem("theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    els.themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme")
        || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
    });
  }

  // ---------- formatting ----------
  const numFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const pctFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" });

  function fmtDateShort(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
  }

  // ---------- table ----------
  function renderTable() {
    const q = els.search.value.trim().toLowerCase();
    const rows = state.rates.filter(r =>
      !q || r.char_code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    );

    els.ratesBody.textContent = "";

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.className = "empty-state";
      td.textContent = "Ничего не найдено";
      tr.appendChild(td);
      els.ratesBody.appendChild(tr);
      return;
    }

    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.dataset.code = r.char_code;
      if (r.char_code === state.selectedCode) tr.classList.add("is-selected");

      const tdCode = document.createElement("td");
      tdCode.className = "code-cell";
      tdCode.textContent = r.char_code;

      const tdName = document.createElement("td");
      tdName.textContent = r.name;

      const tdValue = document.createElement("td");
      tdValue.className = "num";
      tdValue.textContent = numFmt.format(r.value);

      const tdDelta = document.createElement("td");
      tdDelta.className = "num";
      const span = document.createElement("span");
      const dir = r.delta > 0.0001 ? "up" : r.delta < -0.0001 ? "down" : "flat";
      span.className = "delta " + dir;
      const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
      span.textContent = `${arrow} ${pctFmt.format(r.delta_pct)}%`;
      tdDelta.appendChild(span);

      tr.append(tdCode, tdName, tdValue, tdDelta);
      tr.addEventListener("click", () => selectCurrency(r.char_code));
      els.ratesBody.appendChild(tr);
    }
  }

  // ---------- rates polling ----------
  async function loadRates() {
    try {
      const res = await fetch("/api/rates");
      if (!res.ok) throw new Error("bad status " + res.status);
      const data = await res.json();
      state.rates = data.rates;
      if (!state.selectedCode && state.rates.length) {
        state.selectedCode = state.rates[0].char_code;
      }
      const latestDate = state.rates[0] ? fmtDateShort(state.rates[0].date) : "";
      els.asOf.textContent = latestDate ? `Официальный курс на ${latestDate}` : "Нет данных";
      els.liveDot.classList.remove("is-stale");
      els.liveLabel.textContent = "Обновлено " + new Date().toLocaleTimeString("ru-RU");
      renderTable();
      if (state.selectedCode) loadHistory(state.selectedCode, state.days);
    } catch (err) {
      els.liveDot.classList.add("is-stale");
      els.liveLabel.textContent = "Нет соединения";
    }
  }

  function selectCurrency(code) {
    state.selectedCode = code;
    renderTable();
    loadHistory(code, state.days);
  }

  // ---------- chart ----------
  async function loadHistory(code, days) {
    try {
      const res = await fetch(`/api/history/${code}?days=${days}`);
      if (!res.ok) throw new Error("bad status " + res.status);
      const data = await res.json();
      els.chartTitle.textContent = `${data.name} (${data.char_code})`;
      els.chartSub.textContent = "История курса, ₽ за единицу";
      drawChart(data.points);
    } catch (err) {
      els.chartTitle.textContent = "Нет данных";
    }
  }

  function drawChart(points) {
    const svg = els.chart;
    svg.textContent = "";
    if (!points || points.length < 2) return;

    const W = 720, H = 320;
    const padL = 56, padR = 16, padT = 16, padB = 32;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const values = points.map(p => p.value);
    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    min -= pad; max += pad;

    const x = i => padL + (i / (points.length - 1)) * plotW;
    const y = v => padT + plotH - ((v - min) / (max - min)) * plotH;

    const ns = "http://www.w3.org/2000/svg";
    const styles = getComputedStyle(document.documentElement);
    const gridColor = styles.getPropertyValue("--gridline").trim();
    const baselineColor = styles.getPropertyValue("--baseline").trim();
    const mutedColor = styles.getPropertyValue("--text-muted").trim();
    const seriesColor = styles.getPropertyValue("--series-1").trim();
    const washColor = styles.getPropertyValue("--series-1-wash").trim();
    const surfaceColor = styles.getPropertyValue("--surface-1").trim();

    // y gridlines (4 steps) with value labels
    const steps = 4;
    for (let s = 0; s <= steps; s++) {
      const v = min + ((max - min) * s) / steps;
      const yy = y(v);
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", padL);
      line.setAttribute("x2", W - padR);
      line.setAttribute("y1", yy);
      line.setAttribute("y2", yy);
      line.setAttribute("stroke", gridColor);
      line.setAttribute("stroke-width", "1");
      svg.appendChild(line);

      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", padL - 8);
      label.setAttribute("y", yy + 4);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("font-size", "11");
      label.setAttribute("fill", mutedColor);
      label.textContent = numFmt.format(v);
      svg.appendChild(label);
    }

    // x-axis date ticks (start, middle, end)
    const tickIdxs = [0, Math.floor((points.length - 1) / 2), points.length - 1];
    for (const idx of new Set(tickIdxs)) {
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", x(idx));
      label.setAttribute("y", H - padB + 18);
      label.setAttribute("text-anchor", idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle");
      label.setAttribute("font-size", "11");
      label.setAttribute("fill", mutedColor);
      label.textContent = fmtDateShort(points[idx].date);
      svg.appendChild(label);
    }

    // baseline
    const baseline = document.createElementNS(ns, "line");
    baseline.setAttribute("x1", padL);
    baseline.setAttribute("x2", W - padR);
    baseline.setAttribute("y1", H - padB);
    baseline.setAttribute("y2", H - padB);
    baseline.setAttribute("stroke", baselineColor);
    baseline.setAttribute("stroke-width", "1");
    svg.appendChild(baseline);

    // area fill
    let areaD = `M ${x(0)} ${y(values[0])}`;
    points.forEach((p, i) => { if (i > 0) areaD += ` L ${x(i)} ${y(p.value)}`; });
    areaD += ` L ${x(points.length - 1)} ${H - padB} L ${x(0)} ${H - padB} Z`;
    const area = document.createElementNS(ns, "path");
    area.setAttribute("d", areaD);
    area.setAttribute("fill", washColor);
    svg.appendChild(area);

    // line
    let lineD = `M ${x(0)} ${y(values[0])}`;
    points.forEach((p, i) => { if (i > 0) lineD += ` L ${x(i)} ${y(p.value)}`; });
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", lineD);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", seriesColor);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);

    // end marker + direct label
    const lastIdx = points.length - 1;
    const endDot = document.createElementNS(ns, "circle");
    endDot.setAttribute("cx", x(lastIdx));
    endDot.setAttribute("cy", y(values[lastIdx]));
    endDot.setAttribute("r", "5");
    endDot.setAttribute("fill", seriesColor);
    endDot.setAttribute("stroke", surfaceColor);
    endDot.setAttribute("stroke-width", "2");
    svg.appendChild(endDot);

    const endLabel = document.createElementNS(ns, "text");
    endLabel.setAttribute("x", x(lastIdx) - 8);
    endLabel.setAttribute("y", y(values[lastIdx]) - 10);
    endLabel.setAttribute("text-anchor", "end");
    endLabel.setAttribute("font-size", "12");
    endLabel.setAttribute("font-weight", "700");
    const primaryColor = styles.getPropertyValue("--text-primary").trim();
    endLabel.setAttribute("fill", primaryColor);
    endLabel.textContent = numFmt.format(values[lastIdx]);
    svg.appendChild(endLabel);

    // crosshair (hidden until hover)
    const crosshair = document.createElementNS(ns, "line");
    crosshair.setAttribute("y1", padT);
    crosshair.setAttribute("y2", H - padB);
    crosshair.setAttribute("stroke", baselineColor);
    crosshair.setAttribute("stroke-width", "1");
    crosshair.setAttribute("visibility", "hidden");
    svg.appendChild(crosshair);

    const hoverDot = document.createElementNS(ns, "circle");
    hoverDot.setAttribute("r", "5");
    hoverDot.setAttribute("fill", seriesColor);
    hoverDot.setAttribute("stroke", surfaceColor);
    hoverDot.setAttribute("stroke-width", "2");
    hoverDot.setAttribute("visibility", "hidden");
    svg.appendChild(hoverDot);

    // hit layer
    const hit = document.createElementNS(ns, "rect");
    hit.setAttribute("x", padL);
    hit.setAttribute("y", padT);
    hit.setAttribute("width", plotW);
    hit.setAttribute("height", plotH);
    hit.setAttribute("fill", "transparent");
    svg.appendChild(hit);

    function pointerToIndex(evt) {
      const rect = svg.getBoundingClientRect();
      const clientX = (evt.touches ? evt.touches[0].clientX : evt.clientX);
      const svgX = ((clientX - rect.left) / rect.width) * W;
      const ratio = Math.min(1, Math.max(0, (svgX - padL) / plotW));
      return Math.round(ratio * (points.length - 1));
    }

    function showTooltip(evt) {
      const idx = pointerToIndex(evt);
      const p = points[idx];
      const px = x(idx), py = y(p.value);

      crosshair.setAttribute("x1", px);
      crosshair.setAttribute("x2", px);
      crosshair.setAttribute("visibility", "visible");
      hoverDot.setAttribute("cx", px);
      hoverDot.setAttribute("cy", py);
      hoverDot.setAttribute("visibility", "visible");

      const rect = svg.getBoundingClientRect();
      const screenX = rect.left + (px / W) * rect.width;
      const screenY = rect.top + (py / H) * rect.height;
      els.tooltip.hidden = false;
      els.tooltip.style.left = (screenX - rect.left) + "px";
      els.tooltip.style.top = (screenY - rect.top) + "px";
      els.tooltip.textContent = "";

      const valueEl = document.createElement("div");
      valueEl.className = "tooltip-value";
      valueEl.textContent = numFmt.format(p.value) + " ₽";
      const dateEl = document.createElement("div");
      dateEl.className = "tooltip-date";
      dateEl.textContent = fmtDateShort(p.date);
      els.tooltip.append(valueEl, dateEl);
    }

    function hideTooltip() {
      crosshair.setAttribute("visibility", "hidden");
      hoverDot.setAttribute("visibility", "hidden");
      els.tooltip.hidden = true;
    }

    hit.addEventListener("pointermove", showTooltip);
    hit.addEventListener("pointerleave", hideTooltip);
    hit.addEventListener("pointerdown", showTooltip);
  }

  // ---------- range presets ----------
  function initPresets() {
    els.rangePresets.addEventListener("click", (evt) => {
      const btn = evt.target.closest(".preset");
      if (!btn) return;
      state.days = parseInt(btn.dataset.days, 10);
      for (const b of els.rangePresets.querySelectorAll(".preset")) {
        b.classList.toggle("is-active", b === btn);
      }
      if (state.selectedCode) loadHistory(state.selectedCode, state.days);
    });
  }

  // ---------- init ----------
  initTheme();
  initPresets();
  els.search.addEventListener("input", renderTable);
  loadRates();
  setInterval(loadRates, REFRESH_MS);
})();
