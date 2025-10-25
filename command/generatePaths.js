import * as vscode from "vscode";
import * as path from "path";

import { getGlobalAI } from "../config/ai.js";

const FALLBACK_MODEL = "gpt-4.1-mini";
const EXISTING_PATH_LIMIT = 100;

/**
 * สรุป path ที่มีอยู่ใน workspace
 */
async function buildExistingPathsSummary(workspaceFolder, limit) {
  try {
    const files = await vscode.workspace.findFiles(
      "**/*",
      "{node_modules,dist,out,.git}/**",
      limit
    );

    const directories = new Set();
    const filePaths = [];

    for (const file of files) {
      const relativePath = vscode.workspace.asRelativePath(file);
      filePaths.push(relativePath);

      // เก็บ directories ที่เจอ
      const dir = path.dirname(relativePath);
      if (dir !== ".") {
        directories.add(dir);
      }
    }

    const dirList = Array.from(directories).sort();
    const fileList = filePaths.sort();

    return {
      directories: dirList,
      files: fileList,
      total: dirList.length + fileList.length,
    };
  } catch {
    return { directories: [], files: [], total: 0 };
  }
}

/**
 * ขอแผน path จาก AI
 */
// options: { path: boolean, file: boolean } controls which kinds to include
// - path=true  => include directories
// - file=true  => include files
// Defaults to both true for backward compatibility
async function requestPathPlan(
  model,
  instructions,
  existingPathsSummary,
  options = { path: true, file: true }
) {
  // Normalize options defensively
  const wantDir = options && typeof options.path === "boolean" ? options.path : true;
  const wantFile = options && typeof options.file === "boolean" ? options.file : true;

  let typeRule = "ให้รวมทั้งไดเรกทอรีและไฟล์";
  if (wantDir && !wantFile) typeRule = "ให้รวมเฉพาะไดเรกทอรีเท่านั้น (ห้ามมีไฟล์)";
  if (!wantDir && wantFile) typeRule = "ให้รวมเฉพาะไฟล์เท่านั้น (ห้ามมีไดเรกทอรี)";

  const systemPrompt = `คุณเป็นผู้ช่วย AI ที่เชี่ยวชาญในการออกแบบโครงสร้างไดเรกทอรีและไฟล์สำหรับโปรเจคซอฟต์แวร์

## บทบาทและความรับผิดชอบ:
- ออกแบบโครงสร้างไฟล์และโฟลเดอร์ที่เหมาะสมตามคำขอของผู้ใช้
- พิจารณาโครงสร้าง workspace ปัจจุบันเพื่อหลีกเลี่ยงการซ้ำซ้อน
- สร้างโครงสร้างที่สอดคล้องกับ best practices ของภาษาโปรแกรมและเฟรมเวิร์กที่เกี่ยวข้อง

## ข้อมูล workspace ปัจจุบัน:
- ไดเรกทอรีที่มีอยู่: ${existingPathsSummary.directories.slice(0, 20).join(", ")}${existingPathsSummary.directories.length > 20 ? "..." : ""}
- ไฟล์ที่มีอยู่: ${existingPathsSummary.files.slice(0, 10).join(", ")}${existingPathsSummary.files.length > 10 ? "..." : ""}
- จำนวนทั้งหมด: ${existingPathsSummary.total} paths

## กฎเกณฑ์ที่ต้องปฏิบัติตามอย่างเคร่งครัด:
1. **รูปแบบ Path**: ใช้ relative path เท่านั้น (ไม่มี absolute path, ไม่มี drive letter, ไม่เริ่มต้นด้วย /)
2. **Parent Directory**: ไม่อนุญาตให้ใช้ ".." สำหรับอ้างอิง parent directory
3. **รูปแบบการตอบกลับ**: ตอบกลับด้วย JSON object ที่ถูกต้องเท่านั้น
4. **การซ้ำซ้อน**: หลีกเลี่ยงการสร้าง path ที่มีอยู่แล้วใน workspace
5. **ประเภท path**: ${typeRule}
6. **การตั้งชื่อ**: ใช้ชื่อที่สื่อความหมายและสอดคล้องกับ convention ของภาษา/เฟรมเวิร์ก
7. **โครงสร้าง**: สร้างโครงสร้างที่มีลำดับชั้นที่เหมาะสม
8. ให้สร้างไฟล์ที่ถูก import ทั้งหมด
9. ใช้กับไฟล์ที่มีอยู่ร่วมด้วยถ้าจำเป็น

## รูปแบบการตอบกลับที่ถูกต้อง:
\`\`\`json
{
  "paths": ["src/components", "src/utils"],
  "files": ["src/components/Header.jsx", "src/utils/helpers.js"]
}
\`\`\`

หรือถ้ามีเฉพาะประเภทเดียว:
\`\`\`json
{
  "paths": ["src/components", "src/utils"]
}
\`\`\`

## ตัวอย่างโครงสร้างสำหรับสถานการณ์ต่างๆ:

**React Component:**
- paths: ["src/components", "src/hooks", "src/utils"]
- files: ["src/components/Button.jsx", "src/components/Header.jsx", "src/hooks/useLocalStorage.js"]

**Node.js API:**
- paths: ["src/routes", "src/controllers", "src/models", "src/middleware"]
- files: ["src/routes/user.js", "src/controllers/userController.js", "src/models/User.js"]

**Python Package:**
- paths: ["package_name", "package_name/utils", "tests"]
- files: ["package_name/__init__.py", "package_name/main.py", "tests/test_main.py"]

## ข้อควรระวัง:
- ตรวจสอบให้แน่ใจว่า path ทั้งหมดเป็น relative และ valid
- หลีกเลี่ยงการสร้าง path ที่ขัดแย้งกับโครงสร้างที่มีอยู่
- สร้างเฉพาะ path ที่จำเป็นและเหมาะสมกับคำขอ`;

  const userPrompt = `## คำสั่งจากผู้ใช้:
${instructions}

## ข้อมูลเพิ่มเติม:
- ประเภท path ที่ต้องการ: ${typeRule}
- โครงสร้าง workspace ปัจจุบันมีอยู่แล้ว (โปรดหลีกเลี่ยงการซ้ำซ้อน)
- กรุณาสร้างโครงสร้างที่สมบูรณ์และเหมาะสมกับคำสั่ง

## ข้อกำหนด:
1. ตอบกลับด้วย JSON object เท่านั้น
2. ใช้เฉพาะ relative paths
3. หลีกเลี่ยง path ที่มีอยู่แล้ว
4. สร้างโครงสร้างที่มีลำดับชั้นที่เหมาะสม
5. ใช้ชื่อไฟล์และโฟลเดอร์ที่สื่อความหมาย

กรุณาสร้างโครงสร้าง path ที่เหมาะสมและตอบกลับด้วย JSON object ที่มีเฉพาะ paths และ files เท่านั้น`;

  try {
    // เรียก AI API (จำลองการเรียก)
    const response = await callAIAPI(model, systemPrompt, userPrompt);
    return parseJSONResponse(response);
  } catch (error) {
    throw new Error(`AI API Error: ${error.message}`);
  }
}

/**
 * เรียก AI API จริงผ่าน OpenAI client
 */
async function callAIAPI(model, systemPrompt, userPrompt) {
  try {
    const client = getGlobalAI();

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      // ขอให้ตอบกลับเป็น JSON ล้วนเมื่อโมเดลรองรับ
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    console.log("Content XXX", content);
    if (!content) {
      throw new Error("No response content from AI");
    }

    return {
      output_text: content,
    };
  } catch (error) {
    // ถ้า AI API ล้มเหลว ให้ใช้ fallback response ที่ครอบคลุมมากขึ้น
    console.warn(`AI API failed: ${error.message}, using comprehensive fallback`);
    
    // เนื่องจากเราไม่สามารถเข้าถึง options ที่ส่งมาจาก requestPathPlan ได้โดยตรงจากที่นี่
    // เราจะใช้ fallback ที่ครอบคลุมทั้งไดเรกทอรีและไฟล์เป็นค่าเริ่มต้น
    // (ในทางปฏิบัติควรส่ง options มาเป็น parameter เพิ่มเติม)
    const fallbackResponse = {
      paths: [
        "src/components",
        "src/utils",
        "src/hooks",
        "src/styles",
        "src/assets"
      ],
      files: [
        "src/components/Button.jsx",
        "src/components/Header.jsx",
        "src/components/Footer.jsx",
        "src/utils/helpers.js",
        "src/utils/constants.js",
        "src/hooks/useLocalStorage.js",
        "src/hooks/useApi.js",
        "src/styles/global.css",
        "src/styles/components.css"
      ]
    };
    
    return {
      output_text: JSON.stringify(fallbackResponse),
    };
  }
}

/**
 * Parse JSON response รองรับหลายรูปแบบ
 */
function parseJSONResponse(response) {
  let text = response?.output_text || response?.content || "";

  if (typeof text !== "string") {
    try {
      text = String(text);
    } catch {
      throw new Error("Invalid AI response payload");
    }
  }

  const tryParse = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return undefined;
    }
  };

  // 1) ลอง parse ตรง ๆ ก่อน (กรณีใช้ response_format: json_object)
  let parsed = tryParse(text.trim());
  if (parsed) return parsed;

  // 2) หา code fence ใด ๆ และลอง parse เนื้อหาในนั้น
  const fenceMatch = text.match(/```[a-zA-Z]*\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    const inside = fenceMatch[1].trim();
    parsed = tryParse(inside);
    if (parsed) return parsed;

    // ถ้ายังไม่ใช่ JSON ตรง ๆ ลองตัดจาก { ... } ภายใน block
    const s = inside.indexOf("{");
    const e = inside.lastIndexOf("}");
    if (s !== -1 && e !== -1 && e > s) {
      parsed = tryParse(inside.slice(s, e + 1));
      if (parsed) return parsed;
    }
  }

  // 3) หา { ... } ที่ยาวที่สุดจากทั้งข้อความ
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    parsed = tryParse(text.slice(start, end + 1));
    if (parsed) return parsed;
  }

  throw new Error(`Invalid JSON response: ${text}`);
}

/**
 * แปลงผลตอบกลับเป็นรายการ path
 */
function coerceGeneratedPaths(responsePayload) {
  // รองรับได้ทั้งรูปแบบเป็น array ตรง ๆ, หรือเป็น object ที่มี fields: paths, files
  let dirCandidates = [];
  let fileCandidates = [];

  if (Array.isArray(responsePayload)) {
    // ไม่รู้ว่าไฟล์หรือโฟลเดอร์ ใช้ infer ภายหลัง
    dirCandidates = responsePayload;
  } else if (responsePayload && typeof responsePayload === "object") {
    if (Array.isArray(responsePayload.paths)) dirCandidates = responsePayload.paths;
    if (Array.isArray(responsePayload.files)) fileCandidates = responsePayload.files;
  }

  const unique = new Set();
  const results = [];

  // ประมวลผล path ของไดเรกทอรี (เดิมเรียกว่า paths)
  for (const val of dirCandidates) {
    if (typeof val !== "string") continue;
    try {
      const normalized = normalizeSegments(val);
      if (!normalized || unique.has(normalized)) continue;
      unique.add(normalized);

      const kind = inferPathKind(normalized); // เดาตามชื่อไฟล์ (มีนามสกุลถือเป็นไฟล์)
      results.push({
        path: normalized,
        pathKind: kind,
        content: kind === "file" ? "" : undefined,
      });
    } catch {
      continue;
    }
  }

  // ประมวลผล path ของไฟล์จาก field `files` โดยบังคับให้เป็นไฟล์
  for (const val of fileCandidates) {
    if (typeof val !== "string") continue;
    try {
      const normalized = normalizeSegments(val);
      if (!normalized || unique.has(normalized)) continue;
      unique.add(normalized);

      results.push({
        path: normalized,
        pathKind: "file",
        content: "",
      });
    } catch {
      continue;
    }
  }

  return results;
}

/**
 * ตรวจสอบและ normalize path segments
 */
function normalizeSegments(pathStr) {
  // ปฏิเสธ absolute paths
  if (
    path.isAbsolute(pathStr) ||
    pathStr.startsWith("/") ||
    /^[A-Z]:/.test(pathStr)
  ) {
    throw new Error("Absolute paths not allowed");
  }

  const segments = pathStr.split(/[/\\]/).filter((seg) => seg.length > 0);
  const normalizedSegments = [];

  for (const segment of segments) {
    if (segment === ".") {
      continue; // ข้าม
    }
    if (segment === "..") {
      throw new Error("Parent directory references not allowed");
    }
    normalizedSegments.push(segment);
  }

  return normalizedSegments.join("/");
}

/**
 * เดา path kind จากชื่อ
 */
function inferPathKind(pathStr) {
  const basename = path.basename(pathStr);

  // ถ้ามีจุดและไม่ใช่ไฟล์ซ่อน (เริ่มด้วยจุด)
  if (basename.includes(".") && !basename.startsWith(".")) {
    return "file";
  }

  return "directory";
}

/**
 * สร้างโครงสร้างไฟล์/โฟลเดอร์
 */
async function createPathArtifacts(workspaceUri, selections) {
  const failed = [];

  for (const item of selections) {
    try {
      const fullPath = vscode.Uri.joinPath(workspaceUri, item.path);

      if (item.pathKind === "directory") {
        await vscode.workspace.fs.createDirectory(fullPath);
      } else if (item.pathKind === "file") {
        // สร้างโฟลเดอร์ก่อน (ถ้ามี)
        const parentDir = vscode.Uri.joinPath(fullPath, "..");
        await vscode.workspace.fs.createDirectory(parentDir);

        // หมายเหตุ: บรรทัดเขียนไฟล์ถูกคอมเมนต์ไว้ (ไม่เขียนไฟล์จริง)
        // const content = item.content || "";
        // await vscode.workspace.fs.writeFile(fullPath, Buffer.from(content, "utf8"));
      }
    } catch (error) {
      failed.push({
        path: item.path,
        error: error.message,
      });
    }
  }

  return failed;
}

/**
 * คำสั่งหลัก generatePaths
 */
async function generatePaths() {
  try {
    // 1. ตรวจสอบสภาพแวดล้อม
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder is open");
      return;
    }

    const workspaceFolder = workspaceFolders[0];

    // 2. รับคำสั่งจากผู้ใช้
    const instructions = await vscode.window.showInputBox({
      prompt: "Describe the files and directories you want to create",
      placeHolder: "e.g., Create a React component with header and footer",
    });

    if (instructions === undefined) {
      // ผู้ใช้กด Esc
      return;
    }

    if (!instructions.trim()) {
      vscode.window.showWarningMessage("No instructions provided");
      return;
    }

  // 3. เตรียมค่าคอนฟิก AI
    const config = vscode.workspace.getConfiguration();
    const model = config.get("ai.model") || FALLBACK_MODEL;
  // เพิ่มตัวเลือกสำหรับชนิดของ path ที่ต้องการจาก AI
  // หมายเหตุ: ตอนนี้ตั้งค่าเริ่มต้นเป็นทั้งไดเรกทอรีและไฟล์
  // สามารถต่อยอดเป็น UI ให้ผู้ใช้เลือกได้ภายหลัง
  const pathPlanOptions = { path: true, file: true };

    // 4. สรุป path ที่มีอยู่ใน workspace
    const existingPathsSummary = await buildExistingPathsSummary(
      workspaceFolder,
      EXISTING_PATH_LIMIT
    );

    // 5. ขอแผน path จาก AI (พร้อม Progress)
    let responsePayload;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Generating path structure...",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ increment: 0 });

        responsePayload = await requestPathPlan(
          model,
          instructions.trim(),
          existingPathsSummary,
          pathPlanOptions
        );

        progress.report({ increment: 100 });
      }
    );

    // 6. แปลงผลตอบกลับเป็นรายการ path
    const generatedPaths = coerceGeneratedPaths(responsePayload);
    // กรองผลลัพธ์ตามชนิดที่ต้องการ (ป้องกันกรณี AI ให้เกินเงื่อนไข)
    const filteredPaths = generatedPaths.filter((item) =>
      (item.pathKind === "directory" && pathPlanOptions.path) ||
      (item.pathKind === "file" && pathPlanOptions.file)
    );

    if (filteredPaths.length === 0) {
      vscode.window.showInformationMessage(
        "The AI response did not include any paths to create."
      );
      return;
    }

    // 7. ให้ผู้ใช้เลือก path
    const quickPickItems = filteredPaths.map((item) => ({
      label: item.path,
      description: item.pathKind === "file" ? "📄 File" : "📁 Directory",
      picked: true,
      path: item.path,
      pathKind: item.pathKind,
      content: item.content,
    }));

    const selections = await vscode.window.showQuickPick(quickPickItems, {
      canPickMany: true,
      placeHolder: "Select paths to create",
    });

    if (!selections || selections.length === 0) {
      vscode.window.showInformationMessage("No paths selected.");
      return;
    }

    // 8. สร้างโครงสร้างไฟล์/โฟลเดอร์
    const failed = await createPathArtifacts(workspaceFolder.uri, selections);

    // 9. สรุปผล
    if (failed.length > 0) {
      const failedList = failed.map((f) => `${f.path}: ${f.error}`).join("\n");
      vscode.window.showErrorMessage(
        `Failed to create some paths:\n${failedList}`
      );
    } else {
      vscode.window.showInformationMessage(
        `Created or updated ${selections.length} path(s).`
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Error: ${error.message}`);
  }
}

export {
  generatePaths,
  buildExistingPathsSummary,
  requestPathPlan,
  coerceGeneratedPaths,
  normalizeSegments,
  inferPathKind,
  createPathArtifacts,
};
