import { toolStatuses } from "./tools";

for (const tool of toolStatuses()) {
  const mark = tool.found ? "ok " : tool.required ? "FALTA" : "opcional";
  console.log(`[${mark}] ${tool.name.padEnd(8)} ${tool.purpose}`);
  if (!tool.found) console.log(`         instalar: ${tool.install}`);
}
