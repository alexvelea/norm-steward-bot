import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAN, type PlanNode } from "../src/bot/plan/graph.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");

function escapeCell(value: string): string {
  return value.replaceAll("|","\\|").replaceAll("\n"," ");
}

function thresholds(node: PlanNode): string {
  return node.thresholds
    ? Object.entries(node.thresholds).map(([key,value])=>`${key}=${value}`).join(", ")
    : "—";
}

export function renderPlanDoc(): string {
  const ids=new Map(PLAN.nodes.map((node,index)=>[node.key,`n${index}`]));
  const lines=[
    "# Bot plan",
    "",
    "Generated from `src/bot/plan/graph.ts` by `npm run plan:doc`.",
    "",
    "## Changing the plan",
    "",
    "Propose changes as edits to the nodes and edges in `src/bot/plan/graph.ts`. Update the diagram first by running `npm run plan:doc`, then make advisors and the evaluator match the graph.",
    "",
    "Node kinds: objective is the top-level outcome; mission is durable strategic intent; group organizes work; task is continuous actionable work; milestone is a measured goal; policy describes a decision rule; capability marks supported or unavailable behavior.",
    "",
    "Within a world, a milestone stays done once reached. A task with a replacement stays live until a task that requires it, or its group, is done; then it stays done and its work goes to the replacement. Other tasks are live and act again when their goal regresses.",
    "",
    "Edges: contains organizes the plan tree; requires gates a dependent on a prerequisite and points from prerequisite (`from`) to dependent (`to`); contributesTo links work that contributes to an outcome without defining containment or a gate.",
    "",
    "```mermaid",
    "flowchart TD",
  ];
  for(const [kind,color] of [
    ["objective","#dbeafe"],["mission","#e0e7ff"],["group","#f3e8ff"],
    ["task","#dcfce7"],["milestone","#fef3c7"],["policy","#ffedd5"],
    ["capability","#fee2e2"],
  ] as const)lines.push(`  classDef ${kind} fill:${color},stroke:#475569,color:#0f172a;`);
  for(const node of PLAN.nodes){
    const id=ids.get(node.key)!;
    const label=`${node.title}<br/><small>${node.key} · ${node.kind}</small>`.replaceAll('"',"&quot;");
    lines.push(`  ${id}["${label}"]`);
  }
  for(const edge of PLAN.edges){
    const connector=edge.kind==="contains"?"-->":edge.kind==="requires"?"-.->":"==>";
    lines.push(`  ${ids.get(edge.from)} ${connector}|${edge.kind}| ${ids.get(edge.to)}`);
  }
  for(const kind of ["objective","mission","group","task","milestone","policy","capability"] as const){
    const nodes=PLAN.nodes.filter(node=>node.kind===kind).map(node=>ids.get(node.key)!);
    if(nodes.length)lines.push(`  class ${nodes.join(",")} ${kind};`);
  }
  for(const [index,edge] of PLAN.edges.entries()){
    const color=edge.kind==="contains"?"#2563eb":edge.kind==="requires"?"#dc2626":"#7c3aed";
    const dash=edge.kind==="requires"||edge.kind==="contributesTo"?",stroke-dasharray:5 5":"";
    lines.push(`  linkStyle ${index} stroke:${color},stroke-width:2px${dash};`);
  }
  lines.push(
    "```",
    "",
    "Contains edges are solid blue, requires edges are dashed red, and contributesTo edges are dashed purple.",
    "",
    "| Key | Kind | Title | Summary | Gating thresholds | Requires | Replaced by |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for(const node of PLAN.nodes){
    const prerequisites=PLAN.edges.filter(edge=>edge.kind==="requires"&&edge.to===node.key).map(edge=>edge.from).join(", ")||"—";
    lines.push(`| ${escapeCell(node.key)} | ${node.kind} | ${escapeCell(node.title)} | ${escapeCell(node.summary)} | ${escapeCell(thresholds(node))} | ${escapeCell(prerequisites)} | ${escapeCell((node as PlanNode).replacedBy??"—")} |`);
  }
  return `${lines.join("\n")}\n`;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await writeFile(resolve(root,"docs/plan.md"),renderPlanDoc());
}
