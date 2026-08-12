import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REVIEW_PATHS = ["ios", "packages", "mac"];

async function currentDiff(root) {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "origin/main", "--", ...REVIEW_PATHS], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    });
    return String(stdout || "");
  } catch {
    return null;
  }
}

export default function reviewGate(pi) {
  pi.on("session_stop", async (_event, ctx) => {
    const diff = await currentDiff(ctx.cwd);
    if (diff === null || diff.length === 0) return;

    const signature = crypto.createHash("sha1").update(diff).digest("hex");
    let reviewed = "";
    try { reviewed = fs.readFileSync(path.join(ctx.cwd, ".omp/.review-sig"), "utf8").trim(); } catch { /* not reviewed */ }
    if (signature === reviewed) return;

    return {
      decision: "block",
      reason: `REVIEW GATE — ios/ packages/ mac/ 中有尚未对当前 diff 完成独立审查的改动。先用 OMP 的独立 task/code-reviewer 审查 git diff origin/main -- ios packages mac，修复或解释每个真实问题，然后运行 .omp/hooks/mark-reviewed.sh，再结束任务。`,
    };
  });
}
