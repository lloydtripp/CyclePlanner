/* Cycling structured-workout builder.
   Data model: workout = ordered array of "blocks".
   Block types: warmup, cooldown, steady, ramp, freeride, repeat.
   Power is always stored internally as absolute watts.
   A "repeat" block holds an array of child blocks (steady/ramp only) + reps count. */

(() => {
  "use strict";

  const state = {
    ftp: 250,
    powerUnit: "watts", // 'watts' | 'pct'
    blocks: [],
  };

  let uid = 1;
  const nextId = () => uid++;

  function newBlock(type) {
    const base = { id: nextId(), type };
    switch (type) {
      case "warmup":
        return { ...base, duration: 600, powerLow: 100, powerHigh: 180 };
      case "cooldown":
        return { ...base, duration: 480, powerLow: 150, powerHigh: 90 };
      case "ramp":
        return { ...base, duration: 300, powerLow: 150, powerHigh: 250 };
      case "steady":
        return { ...base, duration: 300, power: 200 };
      case "freeride":
        return { ...base, duration: 300 };
      case "repeat":
        return {
          ...base,
          reps: 4,
          children: [
            { id: nextId(), type: "steady", duration: 180, power: 280, label: "Work" },
            { id: nextId(), type: "steady", duration: 60, power: 130, label: "Rest" },
          ],
        };
      default:
        throw new Error("unknown block type " + type);
    }
  }

  // ---------- helpers ----------

  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function parseDur(str, fallback) {
    if (!str) return fallback;
    str = str.trim();
    if (str.includes(":")) {
      const [m, s] = str.split(":").map((x) => parseInt(x, 10) || 0);
      return m * 60 + s;
    }
    const n = parseInt(str, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function zoneOf(pct) {
    // pct = power / ftp * 100
    if (pct < 55) return 1;
    if (pct < 76) return 2;
    if (pct < 91) return 3;
    if (pct < 106) return 4;
    if (pct < 121) return 5;
    if (pct < 151) return 6;
    return 7;
  }
  const zoneColor = { 1: "#7c8794", 2: "#4c8bf5", 3: "#34a853", 4: "#fbbc04", 5: "#f2830a", 6: "#e5484d", 7: "#b23dc0" };
  const zoneLabel = { 1: "Z1 Recovery", 2: "Z2 Endurance", 3: "Z3 Tempo", 4: "Z4 Threshold", 5: "Z5 VO2max", 6: "Z6 Anaerobic", 7: "Z7 Neuromuscular" };

  // Flatten blocks into a list of {durationSec, low, high} steps in watts,
  // expanding repeat blocks by their rep count (for graphing / TSS / ZWO fallback).
  function expandSteps(blocks) {
    const out = [];
    for (const b of blocks) {
      if (b.type === "repeat") {
        for (let r = 0; r < b.reps; r++) {
          for (const c of b.children) out.push(stepOf(c));
        }
      } else {
        out.push(stepOf(b));
      }
    }
    return out;
  }

  function stepOf(b) {
    if (b.type === "steady") return { duration: b.duration, low: b.power, high: b.power, kind: "steady" };
    if (b.type === "ramp" || b.type === "warmup" || b.type === "cooldown")
      return { duration: b.duration, low: b.powerLow, high: b.powerHigh, kind: b.type };
    if (b.type === "freeride") return { duration: b.duration, low: 0, high: 0, kind: "freeride" };
    throw new Error("bad step " + b.type);
  }

  function totalDuration(blocks) {
    return expandSteps(blocks).reduce((s, st) => s + st.duration, 0);
  }

  function estimateTSS(blocks, ftp) {
    const steps = expandSteps(blocks);
    let tssSum = 0;
    let kj = 0;
    for (const st of steps) {
      const avg = (st.low + st.high) / 2;
      const ifactor = ftp > 0 ? avg / ftp : 0;
      tssSum += ifactor * ifactor * (st.duration / 3600) * 100;
      kj += (avg * st.duration) / 1000;
    }
    return { tss: tssSum, kj };
  }

  // ---------- rendering ----------

  const timelineEl = document.getElementById("timeline");
  const summaryEl = document.getElementById("summary");
  const zoneKeyEl = document.getElementById("zone-key");
  const graphLegendEl = document.getElementById("graph-legend");
  const canvas = document.getElementById("graph");
  const ctx = canvas.getContext("2d");

  function renderZoneKey() {
    zoneKeyEl.innerHTML = Object.keys(zoneLabel)
      .map((z) => `<li><span class="swatch" style="background:${zoneColor[z]}"></span>${zoneLabel[z]}</li>`)
      .join("");
  }

  function powerDisplay(watts) {
    if (state.powerUnit === "pct") return Math.round((watts / state.ftp) * 100) + "%";
    return Math.round(watts) + "W";
  }

  function renderSummary() {
    const { tss, kj } = estimateTSS(state.blocks, state.ftp);
    const dur = totalDuration(state.blocks);
    summaryEl.innerHTML = `
      <span>Duration <b>${fmtDur(dur)}</b></span>
      <span>Est. Work <b>${Math.round(kj)} kJ</b></span>
      <span>Est. TSS <b>${Math.round(tss)}</b></span>
    `;
  }

  function renderGraph() {
    const steps = expandSteps(state.blocks);
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#232833";
    ctx.fillRect(0, 0, w, h);
    if (!steps.length) {
      graphLegendEl.textContent = "";
      return;
    }
    const total = steps.reduce((s, st) => s + st.duration, 0) || 1;
    const maxPower = Math.max(state.ftp * 1.3, ...steps.map((s) => Math.max(s.low, s.high))) * 1.05;
    const padL = 4, padR = 4, padT = 8, padB = 4;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    // FTP reference line
    const ftpY = padT + plotH - (state.ftp / maxPower) * plotH;
    ctx.strokeStyle = "#5a6472";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, ftpY);
    ctx.lineTo(w - padR, ftpY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#9aa4b2";
    ctx.font = "10px sans-serif";
    ctx.fillText("FTP", padL + 4, ftpY - 3);

    let x = padL;
    for (const st of steps) {
      const segW = (st.duration / total) * plotW;
      const yLow = padT + plotH - (st.low / maxPower) * plotH;
      const yHigh = padT + plotH - (st.high / maxPower) * plotH;
      const avgPct = ((st.low + st.high) / 2 / state.ftp) * 100;
      ctx.fillStyle = zoneColor[zoneOf(avgPct)];
      ctx.beginPath();
      ctx.moveTo(x, padT + plotH);
      ctx.lineTo(x, yLow);
      ctx.lineTo(x + segW, yHigh);
      ctx.lineTo(x + segW, padT + plotH);
      ctx.closePath();
      ctx.fill();
      x += segW;
    }
    graphLegendEl.textContent = `Peak ${Math.round(Math.max(...steps.map((s) => Math.max(s.low, s.high))))}W · dashed line = FTP (${state.ftp}W)`;
  }

  function renderTimeline() {
    timelineEl.classList.toggle("empty", state.blocks.length === 0);
    timelineEl.innerHTML = "";
    for (const b of state.blocks) timelineEl.appendChild(renderBlock(b));
  }

  function powerInputHTML(label, valueWatts, key) {
    if (state.powerUnit === "pct") {
      const pct = Math.round((valueWatts / state.ftp) * 100);
      return `<label>${label}<input type="number" data-key="${key}" data-mode="pct" value="${pct}">%</label>`;
    }
    return `<label>${label}<input type="number" data-key="${key}" data-mode="watts" value="${Math.round(valueWatts)}">W</label>`;
  }

  function renderBlock(b, opts = {}) {
    const isChild = !!opts.parent;
    const el = document.createElement("div");
    el.className = "block-card" + (b.type === "repeat" ? " repeat-block" : "");
    el.dataset.id = b.id;
    if (!isChild) el.draggable = true;

    if (b.type === "repeat") {
      el.innerHTML = `
        <div class="repeat-header">
          <span class="block-handle">⠿</span>
          <span class="block-title">Interval</span>
          <label>Sets<input type="number" min="1" max="99" data-key="reps" class="dur" value="${b.reps}"></label>
          <span class="block-fields repeat-total">≈ ${fmtDur(repeatTotal(b))} total</span>
          <div class="block-actions">
            <button class="small danger remove-btn">Remove</button>
          </div>
        </div>
        <div class="repeat-children"></div>
        <button class="small add-child-btn">+ Add step</button>
      `;
      const childWrap = el.querySelector(".repeat-children");
      b.children.forEach((c, idx) => childWrap.appendChild(renderChild(b, c, idx)));
      el.querySelector(".add-child-btn").addEventListener("click", () => {
        b.children.push({ id: nextId(), type: "steady", duration: 60, power: 200, label: "Step" });
        update();
      });
      el.querySelector(".remove-btn").addEventListener("click", () => {
        state.blocks = state.blocks.filter((x) => x.id !== b.id);
        update();
      });
      el.querySelector('[data-key="reps"]').addEventListener("input", (e) => {
        b.reps = Math.max(1, parseInt(e.target.value, 10) || 1);
        refresh();
      });
    } else {
      const titleMap = { warmup: "Warm Up", cooldown: "Cool Down", ramp: "Ramp", steady: "Steady", freeride: "Free Ride" };
      let fields = `<label>Time<input class="dur" type="text" data-key="duration" value="${fmtDur(b.duration)}"></label>`;
      if (b.type === "steady") {
        fields += powerInputHTML("Power", b.power, "power");
      } else if (b.type === "ramp" || b.type === "warmup" || b.type === "cooldown") {
        fields += powerInputHTML("From", b.powerLow, "powerLow");
        fields += powerInputHTML("To", b.powerHigh, "powerHigh");
      }
      el.innerHTML = `
        <span class="block-handle">⠿</span>
        <span class="block-title">${titleMap[b.type]}</span>
        <span class="block-fields">${fields}</span>
        <div class="block-actions"><button class="small danger remove-btn">✕</button></div>
      `;
      el.querySelector(".remove-btn").addEventListener("click", () => {
        state.blocks = state.blocks.filter((x) => x.id !== b.id);
        update();
      });
      wireFieldInputs(el, b);
    }

    if (!isChild) wireBlockDrag(el, b);
    return el;
  }

  function renderChild(parentBlock, c, idx) {
    const row = document.createElement("div");
    row.className = "child-row";
    row.innerHTML = `
      <select data-key="type">
        <option value="steady" ${c.type === "steady" ? "selected" : ""}>Steady</option>
        <option value="ramp" ${c.type === "ramp" ? "selected" : ""}>Ramp</option>
      </select>
      <input type="text" data-key="label" value="${c.label || ""}" placeholder="Label" style="width:70px">
      <label>Time<input class="dur" type="text" data-key="duration" value="${fmtDur(c.duration)}"></label>
      <span class="power-fields"></span>
      <button class="small danger remove-child">✕</button>
    `;
    const powerFieldsEl = row.querySelector(".power-fields");
    function paintPowerFields() {
      powerFieldsEl.innerHTML = c.type === "steady"
        ? powerInputHTML("Power", c.power ?? 200, "power")
        : powerInputHTML("From", c.powerLow ?? 150, "powerLow") + powerInputHTML("To", c.powerHigh ?? 250, "powerHigh");
      powerFieldsEl.querySelectorAll("input").forEach((inp) => {
        inp.addEventListener("input", () => {
          const key = inp.dataset.key;
          const mode = inp.dataset.mode;
          const val = parseFloat(inp.value) || 0;
          c[key] = mode === "pct" ? Math.round((val / 100) * state.ftp) : Math.round(val);
          refresh();
        });
      });
    }
    paintPowerFields();

    row.querySelector('[data-key="type"]').addEventListener("change", (e) => {
      const t = e.target.value;
      if (t === "steady" && c.type !== "steady") {
        c.power = Math.round(((c.powerLow ?? 150) + (c.powerHigh ?? 250)) / 2);
        delete c.powerLow; delete c.powerHigh;
      } else if (t === "ramp" && c.type !== "ramp") {
        c.powerLow = c.power ?? 150; c.powerHigh = (c.power ?? 250) + 50;
        delete c.power;
      }
      c.type = t;
      update();
    });
    row.querySelector('[data-key="label"]').addEventListener("input", (e) => { c.label = e.target.value; });
    row.querySelector('[data-key="duration"]').addEventListener("input", (e) => {
      c.duration = parseDur(e.target.value, c.duration);
      refresh();
    });
    row.querySelector('[data-key="duration"]').addEventListener("change", (e) => { e.target.value = fmtDur(c.duration); });
    row.querySelector(".remove-child").addEventListener("click", () => {
      parentBlock.children.splice(idx, 1);
      update();
    });
    return row;
  }

  function wireFieldInputs(el, b) {
    el.querySelectorAll("input[data-key]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const key = inp.dataset.key;
        if (key === "duration") {
          b.duration = parseDur(inp.value, b.duration);
        } else {
          const mode = inp.dataset.mode;
          const val = parseFloat(inp.value) || 0;
          b[key] = mode === "pct" ? Math.round((val / 100) * state.ftp) : Math.round(val);
        }
        refresh();
      });
      if (inp.dataset.key === "duration") {
        inp.addEventListener("change", () => { inp.value = fmtDur(b.duration); });
      }
    });
  }

  // ---------- drag & drop: palette -> timeline, and reordering ----------

  document.querySelectorAll(".palette-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/x-block-type", card.dataset.type);
      e.dataTransfer.effectAllowed = "copy";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });

  timelineEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    timelineEl.classList.add("dragover");
  });
  timelineEl.addEventListener("dragleave", () => timelineEl.classList.remove("dragover"));
  timelineEl.addEventListener("drop", (e) => {
    e.preventDefault();
    timelineEl.classList.remove("dragover");
    const type = e.dataTransfer.getData("text/x-block-type");
    if (type) {
      state.blocks.push(newBlock(type));
      update();
    }
  });

  let dragSourceId = null;
  function wireBlockDrag(el, b) {
    el.addEventListener("dragstart", (e) => {
      dragSourceId = b.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/x-reorder", String(b.id));
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/x-reorder")) return; // let block-type drops bubble to timeline
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;
      el.classList.toggle("drag-over-top", before);
      el.classList.toggle("drag-over-bottom", !before);
    });
    el.addEventListener("dragleave", () => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
    el.addEventListener("drop", (e) => {
      const reorderId = e.dataTransfer.getData("text/x-reorder");
      if (!reorderId) return; // block-type drop; let it bubble
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("drag-over-top", "drag-over-bottom");
      const srcId = parseInt(reorderId, 10);
      if (srcId === b.id) return;
      const rect = el.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;
      const srcIdx = state.blocks.findIndex((x) => x.id === srcId);
      if (srcIdx === -1) return;
      const [moved] = state.blocks.splice(srcIdx, 1);
      let destIdx = state.blocks.findIndex((x) => x.id === b.id);
      if (!before) destIdx += 1;
      state.blocks.splice(destIdx, 0, moved);
      update();
    });
  }

  // ---------- top bar wiring ----------

  document.getElementById("ftp").addEventListener("input", (e) => {
    state.ftp = Math.max(1, parseInt(e.target.value, 10) || state.ftp);
    update();
  });
  document.getElementById("power-unit").addEventListener("change", (e) => {
    state.powerUnit = e.target.value;
    update();
  });
  document.getElementById("clear-all").addEventListener("click", () => {
    if (state.blocks.length && !confirm("Clear the whole workout?")) return;
    state.blocks = [];
    update();
  });

  function update() {
    renderTimeline();
    refresh();
  }

  // Redraws everything except the timeline, so inputs keep focus while typing.
  function refresh() {
    renderSummary();
    renderGraph();
    for (const b of state.blocks) {
      if (b.type !== "repeat") continue;
      const span = timelineEl.querySelector(`[data-id="${b.id}"] .repeat-total`);
      if (span) span.textContent = `≈ ${fmtDur(repeatTotal(b))} total`;
    }
  }

  function repeatTotal(b) {
    return b.children.reduce((s, c) => s + c.duration, 0) * b.reps;
  }

  renderZoneKey();
  update();

  // ---------- ZWO export ----------

  function xmlEscape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  }

  function buildZWO() {
    const name = document.getElementById("wkt-name").value || "Workout";
    const ftp = state.ftp;
    const frac = (w) => (w / ftp).toFixed(3);
    const lines = [];
    for (const b of state.blocks) {
      if (b.type === "warmup") lines.push(`<Warmup Duration="${b.duration}" PowerLow="${frac(b.powerLow)}" PowerHigh="${frac(b.powerHigh)}"/>`);
      else if (b.type === "cooldown") lines.push(`<Cooldown Duration="${b.duration}" PowerLow="${frac(b.powerLow)}" PowerHigh="${frac(b.powerHigh)}"/>`);
      else if (b.type === "ramp") lines.push(`<Ramp Duration="${b.duration}" PowerLow="${frac(b.powerLow)}" PowerHigh="${frac(b.powerHigh)}"/>`);
      else if (b.type === "steady") lines.push(`<SteadyState Duration="${b.duration}" Power="${frac(b.power)}"/>`);
      else if (b.type === "freeride") lines.push(`<FreeRide Duration="${b.duration}"/>`);
      else if (b.type === "repeat") {
        if (b.children.length === 2 && b.children.every((c) => c.type === "steady")) {
          const [on, off] = b.children;
          lines.push(`<IntervalsT Repeat="${b.reps}" OnDuration="${on.duration}" OffDuration="${off.duration}" OnPower="${frac(on.power)}" OffPower="${frac(off.power)}"/>`);
        } else {
          for (let r = 0; r < b.reps; r++) {
            for (const c of b.children) {
              if (c.type === "steady") lines.push(`<SteadyState Duration="${c.duration}" Power="${frac(c.power)}"/>`);
              else lines.push(`<Ramp Duration="${c.duration}" PowerLow="${frac(c.powerLow)}" PowerHigh="${frac(c.powerHigh)}"/>`);
            }
          }
        }
      }
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>Workout Builder</author>
  <name>${xmlEscape(name)}</name>
  <description>Created in Workout Builder. FTP ${ftp}W.</description>
  <sportType>bike</sportType>
  <tags/>
  <workout>
    ${lines.join("\n    ")}
  </workout>
</workout_file>
`;
  }

  function download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  document.getElementById("export-zwo").addEventListener("click", () => {
    if (!state.blocks.length) { alert("Add at least one block first."); return; }
    const name = (document.getElementById("wkt-name").value || "workout").replace(/[^\w\- ]+/g, "").trim() || "workout";
    download(name + ".zwo", new Blob([buildZWO()], { type: "application/xml" }));
  });

  // ---------- MRC export ----------
  // Text format (MINUTES PERCENT of FTP) read from the ELEMNT's `plans` folder.
  // Each step is written as a start and end point so ramps interpolate linearly.
  // MRC has no free-ride segment; free ride is written as 0% FTP.

  function buildMRC() {
    const name = document.getElementById("wkt-name").value || "Workout";
    const ftp = state.ftp;
    const pct = (w) => ((w / ftp) * 100).toFixed(1);
    const rows = [];
    let t = 0;
    for (const st of expandSteps(state.blocks)) {
      rows.push(`${(t / 60).toFixed(2)}\t${pct(st.low)}`);
      t += st.duration;
      rows.push(`${(t / 60).toFixed(2)}\t${pct(st.high)}`);
    }
    return [
      "[COURSE HEADER]",
      "VERSION = 2",
      "UNITS = ENGLISH",
      `DESCRIPTION = ${name}`,
      `FILE NAME = ${name}`,
      "MINUTES PERCENT",
      "[END COURSE HEADER]",
      "[COURSE DATA]",
      ...rows,
      "[END COURSE DATA]",
      "",
    ].join("\r\n");
  }

  document.getElementById("export-mrc").addEventListener("click", () => {
    if (!state.blocks.length) { alert("Add at least one block first."); return; }
    const name = (document.getElementById("wkt-name").value || "workout").replace(/[^\w\- ]+/g, "").trim() || "workout";
    download(name + ".mrc", new Blob([buildMRC()], { type: "text/plain" }));
  });

  // ---------- FIT export ----------
  // Minimal FIT binary encoder for workout / workout_step messages.
  // Reference layout: 12-byte header (no header CRC), record stream, 2-byte file CRC.

  const FIT_EPOCH_OFFSET = 631065600; // seconds between Unix epoch and FIT epoch (1989-12-31 UTC)

  const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
                     0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

  function fitCrc16(bytes, crc = 0) {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      let tmp = CRC_TABLE[crc & 0xf];
      crc = (crc >> 4) & 0x0fff;
      crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
      tmp = CRC_TABLE[crc & 0xf];
      crc = (crc >> 4) & 0x0fff;
      crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
    }
    return crc & 0xffff;
  }

  class ByteWriter {
    constructor() { this.chunks = []; this.length = 0; }
    push(arr) { this.chunks.push(arr); this.length += arr.length; }
    u8(v) { this.push(new Uint8Array([v & 0xff])); }
    u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v & 0xffff, true); this.push(b); }
    u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.push(b); }
    str(s, len) {
      const b = new Uint8Array(len);
      const enc = new TextEncoder().encode(s || "");
      b.set(enc.subarray(0, len - 1));
      this.push(b);
    }
    toBytes() {
      const out = new Uint8Array(this.length);
      let off = 0;
      for (const c of this.chunks) { out.set(c, off); off += c.length; }
      return out;
    }
  }

  const STEP_NAME_LEN = 16;

  function defineMessage(w, localType, globalMesgNum, fields) {
    // record header: definition message, bit6 set
    w.u8(0x40 | (localType & 0x0f));
    w.u8(0); // reserved
    w.u8(0); // architecture: 0 = little endian
    w.u16(globalMesgNum);
    w.u8(fields.length);
    for (const f of fields) { w.u8(f.num); w.u8(f.size); w.u8(f.base); }
  }

  function dataHeader(w, localType) { w.u8(localType & 0x0f); }

  // FIT target_type enum values (wkt_step_target)
  const TARGET_OPEN = 2;
  const TARGET_POWER = 4;
  // FIT duration_type enum values (wkt_step_duration)
  const DURATION_TIME = 0;
  const DURATION_OPEN = 5;
  const DURATION_REPEAT_UNTIL_STEPS_CMPLT = 6;
  // intensity enum
  const INTENSITY = { active: 0, rest: 1, warmup: 2, cooldown: 3 };

  function powerTargetBytes(lowWatts, highWatts) {
    // FIT convention: values < 1000 = %FTP, values >= 1000 = watts + 1000 offset.
    return { low: Math.round(lowWatts) + 1000, high: Math.round(highWatts) + 1000 };
  }

  function buildFIT() {
    const name = document.getElementById("wkt-name").value || "Workout";

    // Flatten blocks -> FIT steps, tracking repeat loop points.
    const fitSteps = []; // {name, durationType, durationValue, targetType, targetValue, low, high, intensity}
    for (const b of state.blocks) {
      if (b.type === "repeat") {
        const loopStartIdx = fitSteps.length;
        b.children.forEach((c) => {
          const st = stepOf(c);
          const t = powerTargetBytes(st.low, st.high);
          fitSteps.push({
            name: c.label || (c.type === "ramp" ? "Ramp" : "Work"),
            durationType: DURATION_TIME,
            durationValue: Math.round(st.duration * 1000),
            targetType: TARGET_POWER,
            targetValue: 0,
            low: t.low, high: t.high,
            intensity: INTENSITY.active,
          });
        });
        fitSteps.push({
          name: "Repeat",
          durationType: DURATION_REPEAT_UNTIL_STEPS_CMPLT,
          durationValue: loopStartIdx, // message_index of first step to repeat from
          targetType: TARGET_OPEN,
          targetValue: b.reps, // number of times to execute the loop
          low: 0, high: 0,
          intensity: INTENSITY.active,
        });
      } else if (b.type === "freeride") {
        fitSteps.push({
          name: "Free Ride",
          durationType: DURATION_OPEN,
          durationValue: 0,
          targetType: TARGET_OPEN,
          targetValue: 0,
          low: 0, high: 0,
          intensity: INTENSITY.active,
        });
      } else {
        const st = stepOf(b);
        const t = powerTargetBytes(st.low, st.high);
        const intensity = b.type === "warmup" ? INTENSITY.warmup : b.type === "cooldown" ? INTENSITY.cooldown : INTENSITY.active;
        fitSteps.push({
          name: b.type === "warmup" ? "Warm Up" : b.type === "cooldown" ? "Cool Down" : b.type === "ramp" ? "Ramp" : "Steady",
          durationType: DURATION_TIME,
          durationValue: Math.round(st.duration * 1000),
          targetType: TARGET_POWER,
          targetValue: 0,
          low: t.low, high: t.high,
          intensity,
        });
      }
    }

    const records = new ByteWriter();

    // --- file_id (local type 0) ---
    defineMessage(records, 0, 0, [
      { num: 0, size: 1, base: 0x00 }, // type, enum
      { num: 1, size: 2, base: 0x84 }, // manufacturer, uint16
      { num: 2, size: 2, base: 0x84 }, // product, uint16
      { num: 3, size: 4, base: 0x8c }, // serial_number, uint32z
      { num: 4, size: 4, base: 0x86 }, // time_created, uint32
    ]);
    dataHeader(records, 0);
    records.u8(5); // type = workout
    records.u16(255); // manufacturer = development
    records.u16(0); // product
    records.u32(1); // serial_number
    records.u32(Math.floor(Date.now() / 1000) - FIT_EPOCH_OFFSET);

    // --- workout (local type 1) ---
    defineMessage(records, 1, 26, [
      { num: 4, size: 1, base: 0x00 },  // sport, enum
      { num: 5, size: 4, base: 0x8c },  // capabilities, uint32z
      { num: 6, size: 2, base: 0x84 },  // num_valid_steps, uint16
      { num: 8, size: STEP_NAME_LEN, base: 0x07 }, // wkt_name, string
    ]);
    dataHeader(records, 1);
    records.u8(2); // sport = cycling
    records.u32(0); // capabilities
    records.u16(fitSteps.length);
    records.str(name, STEP_NAME_LEN);

    // --- workout_step (local type 2), defined once, reused for every step ---
    defineMessage(records, 2, 27, [
      { num: 254, size: 2, base: 0x84 },            // message_index, uint16
      { num: 0, size: STEP_NAME_LEN, base: 0x07 },  // wkt_step_name, string
      { num: 1, size: 1, base: 0x00 },              // duration_type, enum
      { num: 2, size: 4, base: 0x86 },              // duration_value, uint32
      { num: 3, size: 1, base: 0x00 },              // target_type, enum
      { num: 4, size: 4, base: 0x86 },              // target_value, uint32
      { num: 5, size: 4, base: 0x86 },              // custom_target_value_low, uint32
      { num: 6, size: 4, base: 0x86 },              // custom_target_value_high, uint32
      { num: 7, size: 1, base: 0x00 },              // intensity, enum
    ]);
    fitSteps.forEach((st, idx) => {
      dataHeader(records, 2);
      records.u16(idx);
      records.str(st.name, STEP_NAME_LEN);
      records.u8(st.durationType);
      records.u32(st.durationValue);
      records.u8(st.targetType);
      records.u32(st.targetValue);
      records.u32(st.low);
      records.u32(st.high);
      records.u8(st.intensity);
    });

    const recordBytes = records.toBytes();

    // --- header (12 bytes, no header CRC) ---
    const header = new ByteWriter();
    header.u8(12); // header size
    header.u8(0x10); // protocol version 1.0
    header.u16(2158); // profile version (arbitrary plausible value)
    header.u32(recordBytes.length); // data size
    header.push(new TextEncoder().encode(".FIT"));
    const headerBytes = header.toBytes();

    const bodyCrc = fitCrc16(recordBytes, fitCrc16(headerBytes));
    const crcBytes = new Uint8Array(2);
    new DataView(crcBytes.buffer).setUint16(0, bodyCrc, true);

    const out = new Uint8Array(headerBytes.length + recordBytes.length + 2);
    out.set(headerBytes, 0);
    out.set(recordBytes, headerBytes.length);
    out.set(crcBytes, headerBytes.length + recordBytes.length);
    return out;
  }

  document.getElementById("export-fit").addEventListener("click", () => {
    if (!state.blocks.length) { alert("Add at least one block first."); return; }
    const name = (document.getElementById("wkt-name").value || "workout").replace(/[^\w\- ]+/g, "").trim() || "workout";
    const bytes = buildFIT();
    download(name + ".fit", new Blob([bytes], { type: "application/octet-stream" }));
  });
})();
