// AETHERPLAY_WOLF_READBACK_REPORT_V1
export interface WolfReadbackValue {
  variable: string;
  address: number;
  expected: number;
  actual: number | null;
  matches: boolean;
}

export interface WolfReadbackRecord {
  id: string;
  capturedAt: string;
  gameId: string;
  gameTitle: string;
  kind: "WOLF" | "Sys";
  source: string;
  base: number;
  count: number;
  success: boolean;
  values: WolfReadbackValue[];
  reason: string | null;
}

export type NewWolfReadbackRecord = Omit<WolfReadbackRecord, "id" | "capturedAt" | "gameId" | "gameTitle">;

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function addressHex(address: number): string {
  return "0x" + address.toString(16).toUpperCase().padStart(8, "0");
}

export function buildWolfReadbackReportJson(records: WolfReadbackRecord[], exportedAt: string): string {
  return JSON.stringify({
    format: "aetherplay-wolf-readback-verification",
    schemaVersion: 1,
    exportedAt,
    recordCount: records.length,
    passedCount: records.filter((record) => record.success).length,
    failedCount: records.filter((record) => !record.success).length,
    records,
    notes: [
      "该文件记录 WOLF V16–V19 或 Sys 连续特征的扫描值与复读值。",
      "基址只对当前游戏运行实例有效；重载或重启后需要重新定位。",
      "匹配特征仅证明本次复读与扫描期值一致，不会自动证明所有槽位的语义。",
    ],
  }, null, 2) + "\n";
}

export function buildWolfReadbackReportHtml(records: WolfReadbackRecord[], exportedAt: string): string {
  const passed = records.filter((record) => record.success).length;
  const failed = records.length - passed;
  const gameTitle = records.length > 0 ? records[records.length - 1].gameTitle : "WOLF 游戏";
  const cards = records.slice().reverse().map((record) => {
    const rows = record.values.map((value) => {
      return "<tr class=\"" + (value.matches ? "passed-row" : "failed-row") + "\"><td>" + htmlEscape(value.variable) +
        "</td><td><code>" + addressHex(value.address) + "</code></td><td class=\"num\">" + htmlEscape(value.expected) + "</td><td class=\"num\">" +
        htmlEscape(value.actual === null ? "未读到" : value.actual) + "</td><td><span class=\"pill " +
        (value.matches ? "ok" : "bad") + "\">" + (value.matches ? "一致" : "不一致") + "</span></td></tr>";
    }).join("");
    const reason = record.reason ? "<p class=\"reason\"><strong>说明：</strong>" + htmlEscape(record.reason) + "</p>" : "";
    const statusClass = record.success ? "ok" : "bad";
    const statusText = record.success ? "复读通过" : "复读失败";
    const baseAndCount = "<p class=\"meta\">基址 <code>" + addressHex(record.base) + "</code>　·　读取 " +
      htmlEscape(record.count) + " 项　·　" + htmlEscape(new Date(record.capturedAt).toLocaleString()) + "</p>";
    return "<article class=\"record\" data-status=\"" + (record.success ? "passed" : "failed") + "\"><div class=\"record-head\"><div><div class=\"kind\">" +
      htmlEscape(record.kind) + " · " + htmlEscape(record.source) + "</div><div class=\"meta\">游戏：" + htmlEscape(record.gameTitle) +
      "</div></div><span class=\"pill " + statusClass + "\">" + statusText + "</span></div>" + baseAndCount +
      "<div class=\"table-wrap\"><table><thead><tr><th>特征</th><th>槽位地址</th><th>扫描期望值</th><th>复读实际值</th><th>验证</th></tr></thead><tbody>" + rows +
      "</tbody></table></div>" + reason + "<details><summary>完整记录 JSON</summary><pre>" + htmlEscape(JSON.stringify(record, null, 2)) + "</pre></details></article>";
  }).join("\n");
  const css = [
    ":root{color-scheme:dark;background:#0b1018;color:#edf3fc;font:14px/1.55 system-ui,-apple-system,sans-serif}",
    "body{margin:0;padding:16px;max-width:1000px;margin-inline:auto}",
    "h1{font-size:22px;margin:0 0 5px}h2{font-size:17px;margin:0}",
    ".muted,.meta{color:#9eacc1;font-size:12px;overflow-wrap:anywhere}",
    ".summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:9px;margin:16px 0}",
    ".tile,.record{background:#111a27;border:1px solid #2b3a50;border-radius:12px;padding:12px}",
    ".tile strong{display:block;font-size:22px;margin-top:3px}",
    ".record{margin:12px 0}.record-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}",
    ".kind{font-weight:750;font-size:14px}.pill{display:inline-block;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:750;white-space:nowrap}",
    ".ok{background:#163b31;color:#b8f3da}.bad{background:#4a262b;color:#ffd4dc}",
    ".table-wrap{overflow:auto;margin-top:10px}table{border-collapse:collapse;width:100%;min-width:470px}",
    "th,td{padding:8px;border-bottom:1px solid #293549;text-align:left;vertical-align:top}th{color:#aebed4;font-size:12px;background:#0e1621}",
    "td code,code{color:#9fc6ff;overflow-wrap:anywhere}.num{font-variant-numeric:tabular-nums;font-weight:700}",
    ".reason{border-left:3px solid #a97848;padding-left:9px;color:#ffd28a;font-size:12px}details{margin-top:9px}summary{cursor:pointer;color:#9eacc1;font-size:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#080d14;padding:10px;border-radius:8px;font-size:11px}",
    ".tools{display:grid;grid-template-columns:minmax(0,2fr) minmax(130px,1fr);gap:8px;margin:12px 0}.tools input,.tools select{min-width:0;border:1px solid #41516a;border-radius:8px;padding:9px;background:#080d14;color:#edf3fc;font:inherit}",
    "@media(max-width:560px){body{padding:10px}.tools{grid-template-columns:1fr}h1{font-size:19px}}",
  ].join("");
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>WOLF 复读验证报告</title><style>" + css + "</style></head><body>",
    "<h1>WOLF 复读验证报告</h1><div class=\"muted\">游戏：" + htmlEscape(gameTitle) + "　·　导出时间：" + htmlEscape(exportedAt) + "</div>",
    "<section class=\"summary\"><div class=\"tile\">验证记录<strong>" + records.length + "</strong></div><div class=\"tile\">复读通过<strong>" + passed + "</strong></div><div class=\"tile\">复读失败<strong>" + failed + "</strong></div></section>",
    "<p class=\"muted\">期望值来自候选扫描时的连续特征；实际值来自候选地址的立即复读。复读相同代表本轮特征吻合，不代表所有相邻变量的语义都已确认。</p>",
    "<div class=\"tools\"><input id=\"query\" type=\"search\" placeholder=\"搜索变量、地址、数值或错误原因\"><select id=\"status\"><option value=\"all\">全部记录</option><option value=\"passed\">只看通过</option><option value=\"failed\">只看失败</option></select></div>",
    "<div id=\"visible-count\" class=\"muted\"></div><main id=\"records\">" + cards + "</main>",
    "<script>(function(){var q=document.getElementById('query');var s=document.getElementById('status');var cards=Array.prototype.slice.call(document.querySelectorAll('.record'));var count=document.getElementById('visible-count');function apply(){var query=q.value.toLowerCase();var status=s.value;var shown=0;cards.forEach(function(card){var text=card.textContent.toLowerCase();var ok=(query===''||text.indexOf(query)!==-1)&&(status==='all'||card.getAttribute('data-status')===status);card.hidden=!ok;if(ok)shown++;});count.textContent='显示 '+shown+' / '+cards.length+' 条记录';}q.addEventListener('input',apply);s.addEventListener('change',apply);apply();})();</script>",
    "</body></html>",
  ].join("\n");
}
