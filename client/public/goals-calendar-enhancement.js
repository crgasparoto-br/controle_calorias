(() => {
  const STYLE_ID = "goals-calendar-enhancement-style";
  const MARKER = "data-goals-calendar-enhanced";

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .goals-calendar-board {
        overflow-x: auto;
        border: 1px solid hsl(var(--border));
        border-radius: 24px;
        background: hsl(var(--background));
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
      }
      .goals-calendar-grid {
        min-width: 1060px;
        display: grid;
        grid-template-columns: repeat(7, minmax(118px, 1fr)) 190px;
      }
      .goals-calendar-head {
        border-bottom: 1px solid hsl(var(--border));
        background: hsl(var(--muted) / 0.55);
        color: hsl(var(--foreground));
        font-size: 12px;
        font-weight: 700;
        text-align: center;
      }
      .goals-calendar-head > div {
        padding: 10px 8px;
        border-right: 1px solid hsl(var(--border));
      }
      .goals-calendar-head > div:last-child {
        border-right: 0;
        background: hsl(var(--foreground) / 0.72);
        color: hsl(var(--background));
      }
      .goals-calendar-body > div {
        min-height: 245px;
        border-right: 1px solid hsl(var(--border));
        padding: 8px;
      }
      .goals-calendar-body > div:last-child {
        border-right: 0;
      }
      .goals-calendar-day {
        background: hsl(var(--muted) / 0.22);
      }
      .goals-calendar-day.is-exception {
        background: rgba(255, 237, 213, 0.55);
      }
      .goals-calendar-day-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }
      .goals-calendar-day-title strong {
        display: block;
        font-size: 13px;
        line-height: 1.2;
      }
      .goals-calendar-day-title span {
        border-radius: 999px;
        background: hsl(var(--background));
        color: hsl(var(--muted-foreground));
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
      }
      .goals-calendar-event {
        border: 1px solid hsl(var(--border));
        border-left: 4px solid #10b981;
        border-radius: 12px;
        background: hsl(var(--background) / 0.92);
        padding: 9px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
      }
      .goals-calendar-day.is-exception .goals-calendar-event {
        border-left-color: #f97316;
      }
      .goals-calendar-event p {
        margin: 0;
      }
      .goals-calendar-source {
        margin-bottom: 8px !important;
        color: hsl(var(--muted-foreground));
        font-size: 12px;
        line-height: 1.35;
      }
      .goals-calendar-values {
        color: hsl(var(--foreground));
        font-size: 12px;
        line-height: 1.5;
      }
      .goals-calendar-totals {
        background: hsl(var(--foreground) / 0.72);
        color: hsl(var(--background));
      }
      .goals-calendar-totals h4 {
        margin: 0 0 14px;
        font-size: 14px;
        font-weight: 700;
      }
      .goals-calendar-total-item {
        margin-bottom: 12px;
        border-bottom: 1px solid hsl(var(--background) / 0.22);
        padding-bottom: 10px;
      }
      .goals-calendar-total-item:last-child {
        margin-bottom: 0;
        border-bottom: 0;
        padding-bottom: 0;
      }
      .goals-calendar-total-item p {
        margin: 0;
      }
      .goals-calendar-total-label {
        color: hsl(var(--background) / 0.76);
        font-size: 12px;
        font-weight: 700;
      }
      .goals-calendar-total-value {
        margin-top: 3px !important;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.35;
      }
      @media (max-width: 768px) {
        .goals-calendar-grid {
          min-width: 980px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function findCardFromTitle(titleText) {
    const title = Array.from(document.querySelectorAll('[data-slot="card-title"]'))
      .find(element => element.textContent?.trim() === titleText);
    return title?.closest('[data-slot="card"]') ?? null;
  }

  function buildDayCell(dayCard) {
    const label = dayCard.querySelector("p")?.textContent?.trim() || "Dia";
    const source = Array.from(dayCard.querySelectorAll("p"))[1]?.textContent?.trim() || "Usando a meta geral.";
    const values = Array.from(dayCard.querySelectorAll("p"))[2]?.textContent?.trim() || "";
    const shortLabel = dayCard.querySelector("span")?.textContent?.trim() || "";
    const isException = /exceção/i.test(source);

    const cell = document.createElement("div");
    cell.className = `goals-calendar-day${isException ? " is-exception" : ""}`;
    cell.innerHTML = `
      <div class="goals-calendar-day-title">
        <strong>${label}</strong>
        <span>${shortLabel}</span>
      </div>
      <div class="goals-calendar-event">
        <p class="goals-calendar-source">${source}</p>
        <p class="goals-calendar-values">${values.replaceAll(" · ", "<br />")}</p>
      </div>
    `;
    return cell;
  }

  function buildTotalCell(summaryGrid) {
    const totalCell = document.createElement("div");
    totalCell.className = "goals-calendar-totals";
    const items = Array.from(summaryGrid.children).map(item => {
      const label = item.querySelector("p")?.textContent?.trim() || "Total";
      const value = Array.from(item.querySelectorAll("p"))[1]?.textContent?.trim() || "-";
      return `
        <div class="goals-calendar-total-item">
          <p class="goals-calendar-total-label">${label}:</p>
          <p class="goals-calendar-total-value">${value}</p>
        </div>
      `;
    }).join("");

    totalCell.innerHTML = `<h4>Totais semanais</h4>${items}`;
    return totalCell;
  }

  function enhanceGoalsCalendar() {
    ensureStyles();

    const card = findCardFromTitle("Soma planejada da semana");
    if (!card || card.hasAttribute(MARKER)) return;

    const content = card.querySelector('[data-slot="card-content"]');
    if (!content) return;

    const directGrids = Array.from(content.children).filter(child => child.classList?.contains("grid"));
    const dayGrid = directGrids[0];
    const summaryGrid = directGrids[1];
    if (!dayGrid || !summaryGrid || dayGrid.children.length < 7) return;

    const head = document.createElement("div");
    head.className = "goals-calendar-grid goals-calendar-head";
    ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo", "Totais semanais"]
      .forEach(label => {
        const item = document.createElement("div");
        item.textContent = label;
        head.appendChild(item);
      });

    const body = document.createElement("div");
    body.className = "goals-calendar-grid goals-calendar-body";
    Array.from(dayGrid.children).slice(0, 7).forEach(dayCard => body.appendChild(buildDayCell(dayCard)));
    body.appendChild(buildTotalCell(summaryGrid));

    const board = document.createElement("div");
    board.className = "goals-calendar-board";
    board.appendChild(head);
    board.appendChild(body);

    content.replaceChildren(board);
    card.setAttribute(MARKER, "true");
  }

  const observer = new MutationObserver(() => enhanceGoalsCalendar());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhanceGoalsCalendar);
  } else {
    enhanceGoalsCalendar();
  }
})();
