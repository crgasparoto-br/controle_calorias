import fs from "node:fs/promises";
import path from "node:path";
import { delay, openBrowserHarness } from "./billing-admin-browser-driver.mjs";

const [url, outputPath] = process.argv.slice(2);
if (!url || !outputPath) throw new Error("usage: node check-billing-admin-browser-evidence.mjs <url> <output>");

const browser = await openBrowserHarness();
const { call, close, evaluate, pressKey, click, focus, setValue, navigate, runtimeEvents, sessionId } = browser;

const readState = () => evaluate(`(() => { const text=document.body?.innerText??''; return { title:text.includes('Planos, assinaturas e acesso'), overview:text.includes('Distribuição por plano e ciclo'), access:text.includes('Usuários e origem do acesso'), catalog:text.includes('Catálogo e versões'), campaigns:text.includes('Campanhas e entregas'), economics:text.includes('Economia por identidade comercial'), rollout:text.includes('Rollout comercial'), overflow:document.documentElement.scrollWidth>innerWidth||(document.body?.scrollWidth??0)>innerWidth, tabs:Array.from(document.querySelectorAll('[role="tab"]')).map(el=>({text:(el.textContent||'').trim(),selected:el.getAttribute('aria-selected')})), queries:globalThis.__billingQueryCalls??{}, mutations:globalThis.__billingMutationCalls??{} }; })()`);
const waitFor = async (predicate, label) => {
  let value;
  for (let attempt = 0; attempt < 120; attempt += 1) { value = await readState(); if (value && predicate(value)) return value; await delay(100); }
  throw new Error(`${label}: condition not reached; state=${JSON.stringify(value)} runtime=${JSON.stringify(runtimeEvents.slice(-10))}`);
};

const inactiveQueryPaths = [
  "billing.adminSearchUsers", "billing.adminCatalogVersions", "billing.adminCoupons", "billing.adminNotifications",
  "usageGovernance.analytics", "usageGovernance.adminOverview", "usageGovernance.adminEconomicRows",
  "usageGovernance.consumptionChargingAuthorizations", "billing.adminRolloutOverview",
];
const expectedTabs = ["Visão geral", "Acessos", "Comercial", "Governança", "Rollout", "Manual"];

try {
  const viewportEvidence = [];
  for (const viewport of [{ name: "desktop-wide", width: 1440, height: 900 }, { name: "desktop-low", width: 1366, height: 768 }, { name: "mobile", width: 390, height: 844 }]) {
    await navigate(url, viewport.width, viewport.height);
    const initial = await waitFor(state => state.title && state.overview, `${viewport.name}: initial overview`);
    if (initial.overflow) throw new Error(`${viewport.name}: root horizontal overflow detected`);
    if (initial.tabs.length !== expectedTabs.length || initial.tabs[0]?.selected !== "true" || initial.tabs.some((tab, index) => tab.text !== expectedTabs[index])) throw new Error(`${viewport.name}: expected tabs ${expectedTabs.join(', ')} with Visão geral selected`);
    const mountedTooEarly = inactiveQueryPaths.filter(queryPath => (initial.queries[queryPath] ?? 0) > 0);
    if (mountedTooEarly.length) throw new Error(`${viewport.name}: inactive areas queried on initial render: ${mountedTooEarly.join(', ')}`);
    if ((initial.queries["billing.adminAnalytics"] ?? 0) < 1) throw new Error(`${viewport.name}: adminAnalytics was not used by overview`);
    viewportEvidence.push({ ...viewport, tabs: initial.tabs, initialQueries: initial.queries });
  }

  await navigate(url, 1366, 768);
  await waitFor(state => state.title && state.overview, "interaction baseline");
  await focus("Visão geral");
  await pressKey("ArrowRight", "ArrowRight");
  const accessByKeyboard = await waitFor(state => state.access && state.tabs.find(tab => tab.text === "Acessos")?.selected === "true", "keyboard access tab");
  await pressKey("ArrowLeft", "ArrowLeft");
  await waitFor(state => state.overview, "keyboard overview return");

  await click("Acessos");
  const accessState = await waitFor(state => state.access && (state.queries["billing.adminSearchUsers"] ?? 0) > 0, "access tab");
  if (accessState.overview) throw new Error("Visão geral remained mounted after activating Acessos");

  await click("Comercial");
  const commercialState = await waitFor(state => state.catalog && state.campaigns && (state.queries["billing.adminCatalogVersions"] ?? 0) > 0 && (state.queries["billing.adminNotifications"] ?? 0) > 0, "commercial tab");
  if (commercialState.access) throw new Error("Acessos remained mounted after activating Comercial");

  await setValue("catalog-action-reason", "publicação validada pela operação");
  const publishBefore = commercialState.mutations["billing.adminPublishCatalogVersion"] ?? 0;
  await focus("Publicar");
  await pressKey("Enter", "Enter");
  const confirmDialog = await evaluate(`(() => { const dialog=document.querySelector('[role="alertdialog"]'); return { open:Boolean(dialog), text:dialog?.textContent??'', labelled:Boolean(dialog?.getAttribute('aria-labelledby')), described:Boolean(dialog?.getAttribute('aria-describedby')), focusInside:Boolean(dialog&&dialog.contains(document.activeElement)) }; })()`);
  if (!confirmDialog.open || !confirmDialog.text.includes("professional-v2") || !confirmDialog.text.includes("Publicar versão") || !confirmDialog.labelled || !confirmDialog.described || !confirmDialog.focusInside) throw new Error(`publish confirmation is incomplete: ${JSON.stringify(confirmDialog)}`);
  await pressKey("Escape", "Escape");
  const afterCancel = await readState();
  if ((afterCancel.mutations["billing.adminPublishCatalogVersion"] ?? 0) !== publishBefore) throw new Error("canceling publish confirmation executed a mutation");
  await focus("Publicar"); await pressKey("Enter", "Enter"); await focus("Publicar versão"); await pressKey("Enter", "Enter");
  const afterConfirm = await readState();
  if ((afterConfirm.mutations["billing.adminPublishCatalogVersion"] ?? 0) !== publishBefore + 1) throw new Error("confirming publish did not execute exactly one mutation");

  await click("Novo produto");
  const creationDialog = await evaluate(`(() => { const dialog=document.querySelector('[role="dialog"]'); return { open:Boolean(dialog), labelled:Boolean(dialog?.getAttribute('aria-labelledby')), described:Boolean(dialog?.getAttribute('aria-describedby')), focusInside:Boolean(dialog&&dialog.contains(document.activeElement)) }; })()`);
  if (!creationDialog.open || !creationDialog.labelled || !creationDialog.described || !creationDialog.focusInside) throw new Error(`creation dialog accessibility contract failed: ${JSON.stringify(creationDialog)}`);
  await setValue("product-code", "pro"); await setValue("product-name", "Produto visual"); await setValue("product-reason", "validação de persistência do formulário"); await click("Criar produto"); await delay(150);
  const preservedForm = await evaluate(`(() => { const dialog=document.querySelector('[role="dialog"]'); const text=dialog?.textContent??''; return { dialogOpen:Boolean(dialog), code:document.getElementById('product-code')?.value??null, name:document.getElementById('product-name')?.value??null, reason:document.getElementById('product-reason')?.value??null, attempts:globalThis.__billingCreateProductAttempts??0, localizedError:text.includes('Não foi possível criar o produto.'), rawErrorLeaked:text.includes('synthetic catalog validation failure'), focusInside:Boolean(dialog&&dialog.contains(document.activeElement)) }; })()`);
  if (!preservedForm.dialogOpen || preservedForm.attempts !== 1 || preservedForm.code !== "pro" || preservedForm.name !== "Produto visual" || !String(preservedForm.reason).includes("persistência") || !preservedForm.localizedError || preservedForm.rawErrorLeaked || !preservedForm.focusInside) throw new Error(`creation form error-state contract failed: ${JSON.stringify(preservedForm)}`);
  await pressKey("Escape", "Escape");
  const closeFocus = await evaluate(`(() => ({ dialogOpen:Boolean(document.querySelector('[role="dialog"]')), activeText:(document.activeElement?.textContent||document.activeElement?.getAttribute('aria-label')||'').trim() }))()`);
  if (closeFocus.dialogOpen || !closeFocus.activeText.includes("Novo produto")) throw new Error(`creation dialog focus restoration failed: ${JSON.stringify(closeFocus)}`);

  await setValue("campaign-reason", "retry audit evidence");
  const retryIdentity = await evaluate(`(() => { const button=Array.from(document.querySelectorAll('button')).find(el=>el.textContent?.includes('Retry WhatsApp')); if(!button)return {ok:false}; button.click(); button.click(); const attempts=globalThis.__billingRetryAttempts??[]; return {ok:true,attempts,sameRequestId:attempts.length===2&&attempts[0].requestId===attempts[1].requestId}; })()`);
  if (!retryIdentity?.sameRequestId) throw new Error(`retry identity was not stable: ${JSON.stringify(retryIdentity)}`);

  await click("Governança");
  const governanceState = await waitFor(state => (state.queries["usageGovernance.analytics"] ?? 0) > 0 && (state.queries["usageGovernance.adminOverview"] ?? 0) > 0, "governance tab");
  if (governanceState.catalog || governanceState.campaigns) throw new Error("Comercial remained mounted after activating Governança");
  await click("Rollout");
  const rolloutState = await waitFor(state => state.rollout && (state.queries["billing.adminRolloutOverview"] ?? 0) > 0, "rollout tab");

  await click("Visão geral"); await waitFor(state => state.overview, "overview return");
  await evaluate("document.body.tabIndex=-1; document.body.focus();");
  const keyboardSequence = [];
  const uniqueFocus = new Set();
  let visitedTab = false;
  let visitedAdminAction = false;
  for (let index = 0; index < 40; index += 1) {
    await pressKey("Tab", "Tab");
    const item = await evaluate(`(() => { const e=document.activeElement; return {tag:e?.tagName??'',role:e?.getAttribute('role')??'',text:(e?.getAttribute('aria-label')||e?.textContent||e?.getAttribute('placeholder')||'').trim().slice(0,120)}; })()`);
    keyboardSequence.push(item);
    const focusKey = `${item.tag}:${item.role}:${item.text}`;
    if (!focusKey.startsWith("BODY:") && !focusKey.startsWith("HTML:")) uniqueFocus.add(focusKey);
    if (item.role === "tab") visitedTab = true;
    if (item.text.includes("Operação da plataforma")) visitedAdminAction = true;
    if (uniqueFocus.size >= 2 && visitedTab && visitedAdminAction) break;
  }
  if (uniqueFocus.size < 2 || !visitedTab || !visitedAdminAction) throw new Error(`keyboard navigation missed semantic controls: ${JSON.stringify({ keyboardSequence, uniqueFocusCount: uniqueFocus.size, visitedTab, visitedAdminAction })}`);

  const ax = await call("Accessibility.getFullAXTree", {}, sessionId);
  const roles = new Map(); const names = [];
  for (const node of ax.nodes ?? []) { const role=node.role?.value; if(role)roles.set(role,(roles.get(role)??0)+1); const name=node.name?.value; if(name)names.push(name); }
  for (const requiredRole of ["heading", "button", "tab"]) if (!roles.get(requiredRole)) throw new Error(`accessibility tree lacks role ${requiredRole}`);
  if (!names.some(name => String(name).includes("Planos, assinaturas e acesso"))) throw new Error("accessibility tree lacks the page heading");

  await evaluate("document.body.style.zoom='200%'"); await delay(200);
  const zoomResult = await evaluate(`(() => ({ zoom:getComputedStyle(document.body).zoom||document.body.style.zoom, overflow:document.documentElement.scrollWidth>innerWidth||(document.body?.scrollWidth??0)>innerWidth, scrollWidth:document.documentElement.scrollWidth, innerWidth }))()`);
  if (zoomResult.overflow) throw new Error(`200% zoom caused root horizontal overflow: ${JSON.stringify(zoomResult)}`);

  const evidence = { schemaVersion: 3, route: "/admin/billing", viewports: viewportEvidence, lazyMount: { initialForbiddenQueryPaths: inactiveQueryPaths, accessQueries: accessState.queries, commercialQueries: commercialState.queries, governanceQueries: governanceState.queries, rolloutQueries: rolloutState.queries }, keyboardTabs: { accessSelected: accessByKeyboard.tabs.find(tab => tab.text === "Acessos")?.selected === "true" }, sensitiveConfirmation: { dialog: confirmDialog, cancelMutationCount: afterCancel.mutations["billing.adminPublishCatalogVersion"] ?? 0, confirmMutationCount: afterConfirm.mutations["billing.adminPublishCatalogVersion"] ?? 0 }, creationDialog, formErrorPersistence: preservedForm, focusAfterDialogClose: closeFocus, retryIdentity, keyboard: { sequence: keyboardSequence, uniqueFocusCount: uniqueFocus.size, visitedTab, visitedAdminAction }, accessibility: { roleCounts: Object.fromEntries(roles), pageHeadingObserved: true }, zoom200: zoomResult };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} finally {
  await close();
}