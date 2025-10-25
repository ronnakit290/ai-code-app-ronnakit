import * as vscode from "vscode";
import * as path from "path";

import { getGlobalAI } from "../config/ai.js";
import {
	parsePlaceholders,
	fillPlaceholders,
	parseChoicePlaceholders,
	fillChoicePlaceholders,
} from "./promptUtils.js";
import {
	buildExistingPathsSummary,
	requestPathPlan,
	coerceGeneratedPaths,
	normalizeSegments,
} from "./generatePaths.js";
import { extractCodeFromText } from "./createProjectByAI.js";

const PROMPT_STORAGE_KEY = "extension.promptTemplates";
const FALLBACK_MODEL = "gpt-4.1-mini";

/**
 * แปลงผลลัพธ์แผน path ของ AI ให้เป็นรายการไฟล์เท่านั้น
 * ใช้ร่วมกับ coerceGeneratedPaths เพื่อ normalize path ก่อน
 * @param {any} planPayload
 * @returns {Array<{ path: string; pathKind: string } & Record<string, any>>}
 */
function extractFileItemsFromPlan(planPayload) {
	const items = coerceGeneratedPaths(planPayload);
	return items.filter((item) => item.pathKind === "file");
}

/**
 * Utility: serialize arbitrary data to base64 with explicit UTF-8 encoding.
 * Ensures non-ASCII input remains intact when injected into HTML templates.
 * @param {any} data
 */
function utf8JsonToBase64(data) {
	return Buffer.from(JSON.stringify(data), "utf8").toString("base64");
}

/**
 * @typedef {Object} PromptTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} content
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Entry point for the Store Prompt command. Provides CRUD operations plus template execution.
 * @param {vscode.ExtensionContext} context
 */
export async function storePrompt(context) {
	const action = await vscode.window.showQuickPick(
	  [
	    { label: "🚀 Run prompt", value: "run", description: "Run a saved template" },
	    { label: "➕ Create prompt", value: "create", description: "Create new template" },
	    { label: "✏️ Update prompt", value: "update", description: "Edit existing template" },
	    { label: "🗑️ Delete prompt", value: "delete", description: "Delete templates" },
	    { label: "📋 Duplicate prompt", value: "duplicate", description: "Duplicate existing template" },
	    { label: "🔍 Search prompts", value: "search", description: "Search through templates" },
	  ],
	  {
	    placeHolder: "เลือกการทำงานสำหรับ prompt template",
	    ignoreFocusOut: true,
	  }
	);

	if (!action) {
		return;
	}

	try {
		switch (action.value) {
			case "create":
				await handleCreatePrompt(context);
				break;
			case "update":
				await handleUpdatePrompt(context);
				break;
			case "delete":
				await handleDeletePrompt(context);
				break;
			case "run":
			default:
			  await handleRunPrompt(context);
			  break;
			case "duplicate":
			  await handleDuplicatePrompt(context);
			  break;
			case "search":
			  await handleSearchPrompts(context);
			  break;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Store Prompt failed: ${message}`);
	}
}

/**
 * Load templates from global state.
 * @param {vscode.ExtensionContext} context
 * @returns {PromptTemplate[]}
 */
function loadTemplates(context) {
	/** @type {PromptTemplate[] | undefined} */
	const existing = context.globalState.get(PROMPT_STORAGE_KEY);
	return Array.isArray(existing) ? existing : [];
}

/**
 * Persist templates to global state.
 * @param {vscode.ExtensionContext} context
 * @param {PromptTemplate[]} templates
 */
async function saveTemplates(context, templates) {
	await context.globalState.update(PROMPT_STORAGE_KEY, templates);
}

function createId() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function handleCreatePrompt(context) {
	const templates = loadTemplates(context);

	const name = await vscode.window.showInputBox({
		prompt: "ตั้งชื่อ prompt template",
		placeHolder: "เช่น Create dashboard components",
		ignoreFocusOut: true,
		validateInput: (value) => {
			if (!value.trim()) {
				return "Name is required";
			}
			if (templates.some((tpl) => tpl.name.toLowerCase() === value.trim().toLowerCase())) {
				return "A template with this name already exists";
			}
			return undefined;
		},
	});
	if (name === undefined) {
		return;
	}

	const description = await vscode.window.showInputBox({
		prompt: "คำอธิบาย (ใส่หรือเว้นว่างได้)",
		placeHolder: "ใช้สำหรับสร้างไฟล์ component หลัก",
		ignoreFocusOut: true,
	});
	if (description === undefined) {
		return;
	}

	const content = await openContentEditor(context, "", {
		title: `Template: ${name.trim()}`,
		instruction: "ระบุ prompt template (รองรับ {{placeholders}})",
	});
	if (content === undefined || !content.trim()) {
		if (content !== undefined) {
			void vscode.window.showWarningMessage("Prompt template content is required");
		}
		return;
	}

	const now = new Date().toISOString();
	const newTemplate = {
		id: createId(),
		name: name.trim(),
		description: description?.trim() || "",
		content,
		createdAt: now,
		updatedAt: now,
	};

	templates.push(newTemplate);
	await saveTemplates(context, templates);
	void vscode.window.showInformationMessage(`บันทึก template "${newTemplate.name}" แล้ว`);
}

async function handleUpdatePrompt(context) {
	const templates = loadTemplates(context);
	if (!templates.length) {
		void vscode.window.showInformationMessage("ยังไม่มี prompt template ให้แก้ไข");
		return;
	}

	const selection = await pickTemplateQuickPick(templates, {
		placeHolder: "เลือก template ที่ต้องการแก้ไข",
	});
	if (!selection) {
		return;
	}

	const template = templates.find((tpl) => tpl.id === selection.id);
	if (!template) {
		void vscode.window.showErrorMessage("Template ไม่พบแล้ว");
		return;
	}

	const newName = await vscode.window.showInputBox({
		prompt: "ปรับชื่อ template",
		value: template.name,
		ignoreFocusOut: true,
		validateInput: (value) => {
			if (!value.trim()) {
				return "Name is required";
			}
			const clash = templates.some(
				(tpl) => tpl.id !== template.id && tpl.name.toLowerCase() === value.trim().toLowerCase()
			);
			return clash ? "Another template already uses this name" : undefined;
		},
	});
	if (newName === undefined) {
		return;
	}

	const newDescription = await vscode.window.showInputBox({
		prompt: "ปรับคำอธิบาย (เว้นว่างได้)",
		value: template.description,
		ignoreFocusOut: true,
	});
	if (newDescription === undefined) {
		return;
	}

	const newContent = await openContentEditor(context, template.content, {
		title: `Template: ${template.name}`,
		instruction: "แก้ไข prompt template",
	});
	if (newContent === undefined || !newContent.trim()) {
		if (newContent !== undefined) {
			void vscode.window.showWarningMessage("Prompt template content is required");
		}
		return;
	}

	template.name = newName.trim();
	template.description = newDescription?.trim() || "";
	template.content = newContent;
	template.updatedAt = new Date().toISOString();

	await saveTemplates(context, templates);
	void vscode.window.showInformationMessage(`อัปเดต template "${template.name}" แล้ว`);
}

async function handleDeletePrompt(context) {
	const templates = loadTemplates(context);
	if (!templates.length) {
		void vscode.window.showInformationMessage("ยังไม่มี prompt template ให้ลบ");
		return;
	}

	const picks = await pickTemplateQuickPick(templates, {
		placeHolder: "เลือก template ที่ต้องการลบ",
		canPickMany: true,
	});

	if (!picks || (Array.isArray(picks) && picks.length === 0)) {
		return;
	}

	const selections = Array.isArray(picks) ? picks : [picks];
	const names = selections.map((item) => item.label).join(", ");
	const confirm = await vscode.window.showWarningMessage(
		`ยืนยันการลบ template: ${names}`,
		{ modal: true },
		"Delete"
	);
	if (confirm !== "Delete") {
		return;
	}

	const idsToDelete = new Set(selections.map((item) => item.id));
	const remaining = templates.filter((tpl) => !idsToDelete.has(tpl.id));
	await saveTemplates(context, remaining);
	void vscode.window.showInformationMessage("ลบ template ที่เลือกแล้ว");
}

/**
* Duplicate an existing prompt template
* @param {vscode.ExtensionContext} context
*/
async function handleDuplicatePrompt(context) {
	const templates = loadTemplates(context);
	if (!templates.length) {
	  void vscode.window.showInformationMessage("ยังไม่มี prompt template ให้ทำซ้ำ");
	  return;
	}

	const selection = await pickTemplateQuickPick(templates, {
	  placeHolder: "เลือก template ที่ต้องการทำซ้ำ",
	});
	if (!selection) {
	  return;
	}

	const template = templates.find((tpl) => tpl.id === selection.id);
	if (!template) {
	  void vscode.window.showErrorMessage("Template ไม่พบแล้ว");
	  return;
	}

	const newName = await vscode.window.showInputBox({
	  prompt: "ตั้งชื่อ template ใหม่",
	  value: `${template.name} (Copy)`,
	  ignoreFocusOut: true,
	  validateInput: (value) => {
	    if (!value.trim()) {
	      return "Name is required";
	    }
	    if (templates.some((tpl) => tpl.name.toLowerCase() === value.trim().toLowerCase())) {
	      return "A template with this name already exists";
	    }
	    return undefined;
	  },
	});
	if (newName === undefined) {
	  return;
	}

	const now = new Date().toISOString();
	const duplicatedTemplate = {
	  id: createId(),
	  name: newName.trim(),
	  description: template.description,
	  content: template.content,
	  createdAt: now,
	  updatedAt: now,
	};

	templates.push(duplicatedTemplate);
	await saveTemplates(context, templates);
	void vscode.window.showInformationMessage(`ทำซ้ำ template "${template.name}" เป็น "${newName}" แล้ว`);
}

/**
* Search through prompt templates
* @param {vscode.ExtensionContext} context
*/
async function handleSearchPrompts(context) {
	const templates = loadTemplates(context);
	if (!templates.length) {
	  void vscode.window.showInformationMessage("ยังไม่มี prompt template ให้ค้นหา");
	  return;
	}

	const searchTerm = await vscode.window.showInputBox({
	  prompt: "ค้นหา template (ชื่อ, คำอธิบาย, หรือเนื้อหา)",
	  placeHolder: "พิมพ์คำค้นหา...",
	  ignoreFocusOut: true,
	});
	if (searchTerm === undefined || !searchTerm.trim()) {
	  return;
	}

	const term = searchTerm.trim().toLowerCase();
	const filteredTemplates = templates.filter(tpl =>
	  tpl.name.toLowerCase().includes(term) ||
	  tpl.description.toLowerCase().includes(term) ||
	  tpl.content.toLowerCase().includes(term)
	);

	if (!filteredTemplates.length) {
	  void vscode.window.showInformationMessage("ไม่พบ template ที่ตรงกับการค้นหา");
	  return;
	}

	const selection = await pickTemplateQuickPick(filteredTemplates, {
	  placeHolder: `ผลการค้นหา: "${searchTerm}"`,
	});
	if (!selection) {
	  return;
	}

	const template = filteredTemplates.find((tpl) => tpl.id === selection.id);
	if (!template) {
	  void vscode.window.showErrorMessage("Template ไม่พบแล้ว");
	  return;
	}

	// Show options for the found template
	const action = await vscode.window.showQuickPick(
	  [
	    { label: "🚀 Run template", value: "run" },
	    { label: "✏️ Edit template", value: "edit" },
	    { label: "👁️ Preview template", value: "preview" },
	    { label: "❌ Cancel", value: "cancel" },
	  ],
	  {
	    placeHolder: `Template: ${template.name}`,
	    ignoreFocusOut: true,
	  }
	);

	if (!action || action.value === "cancel") {
	  return;
	}

	switch (action.value) {
	  case "run":
	    const filledPrompt = await collectPromptValues(context, template.content);
	    if (filledPrompt) {
	      await runPromptExecution(filledPrompt, template.name);
	    }
	    break;
	  case "edit":
	    const templatesForEdit = loadTemplates(context);
	    const templateToEdit = templatesForEdit.find((tpl) => tpl.id === template.id);
	    if (templateToEdit) {
	      await handleUpdatePrompt(context);
	    }
	    break;
	  case "preview":
	    await vscode.window.showInformationMessage(
	      `Template Preview: ${template.name}\n\n${template.content.slice(0, 200)}${template.content.length > 200 ? '...' : ''}`,
	      { modal: true }
	    );
	    break;
	}
}

/**
 * Quick pick helper for selecting templates.
 * @param {PromptTemplate[]} templates
 * @param {vscode.QuickPickOptions} options
 * @returns {Promise<any>}
 */
async function pickTemplateQuickPick(templates, options) {
  const items = templates.map((tpl) => ({
    label: tpl.name,
    description: tpl.description,
    id: tpl.id,
  }));
  
  return /** @type {any} */ (
    await vscode.window.showQuickPick(items, {
      ignoreFocusOut: true,
      ...options,
    })
  );
}

async function handleRunPrompt(context) {
  const templates = loadTemplates(context);
  if (!templates.length) {
    void vscode.window.showInformationMessage("ยังไม่มี prompt template ให้รัน");
    return;
  }

  const selection = await pickTemplateQuickPick(templates, {
    placeHolder: "เลือก prompt template เพื่อรัน",
  });
	if (!selection) {
		return;
	}

	const template = templates.find((tpl) => tpl.id === selection.id);
	if (!template) {
	  void vscode.window.showErrorMessage("Template ไม่พบแล้ว");
	  return;
	}

	// Show template preview option
	const action = await vscode.window.showQuickPick(
		[
			{ label: "🚀 Run template", value: "run" },
			{ label: "👁️ Preview template", value: "preview" },
			{ label: "❌ Cancel", value: "cancel" },
		],
		{
			placeHolder: `Template: ${template.name}`,
			ignoreFocusOut: true,
		}
	);

	if (!action || action.value === "cancel") {
		return;
	}

	if (action.value === "preview") {
		await vscode.window.showInformationMessage(
			`Template Preview: ${template.name}\n\n${template.content.slice(0, 200)}${template.content.length > 200 ? '...' : ''}`,
			{ modal: true }
		);
		return await handleRunPrompt(context); // Return to selection
	}

	const filledPrompt = await collectPromptValues(context, template.content);
	if (!filledPrompt) {
		return;
	}

	await runPromptExecution(filledPrompt, template.name);
}

/**
 * Collect placeholder values, returning the filled prompt string.
 * @param {string} templateContent
 */
async function collectPromptValues(context, templateContent) {
	const choiceTokens = parseChoicePlaceholders(templateContent);
	const templateWithoutChoices = fillChoicePlaceholders(
		templateContent,
		choiceTokens.map(() => "")
	);
	const simplePlaceholders = parsePlaceholders(templateWithoutChoices);

	if (!choiceTokens.length && !simplePlaceholders.length) {
		return templateContent;
	}

	const formResult = await openPromptForm(context, simplePlaceholders, choiceTokens, templateContent);
	if (!formResult) {
		return undefined;
	}

	const choiceSelections = choiceTokens.map((token, index) => {
		const picks = formResult.choiceSelections?.[index] ?? [];
		if (Array.isArray(picks) && picks.length > 0) {
			return picks.join(", ");
		}
		return token.default || "";
	});

	const afterChoiceFilled = fillChoicePlaceholders(templateContent, choiceSelections);
	return fillPlaceholders(afterChoiceFilled, formResult.simpleValues || {});
}

async function runPromptExecution(finalPrompt, templateName) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		void vscode.window.showErrorMessage("No workspace folder is open");
		return;
	}

	const workspaceFolder = workspaceFolders[0];

	const existingSummary = await buildExistingPathsSummary(workspaceFolder, 100);

	let planPayload;
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `วางแผนไฟล์จาก template ${templateName}...`,
			cancellable: false,
		},
		async (progress) => {
			progress.report({ increment: 0 });

			const config = vscode.workspace.getConfiguration();
			const model = config.get("ai.model") || FALLBACK_MODEL;
			planPayload = await requestPathPlan(
				model,
				finalPrompt,
				existingSummary
			);

			progress.report({ increment: 100 });
		}
	);

	const generated = extractFileItemsFromPlan(planPayload);

	if (!generated.length) {
		void vscode.window.showInformationMessage("AI ไม่ได้เสนอไฟล์ให้สร้าง");
		return;
	}

	const fileChoices = generated.map((item) => ({
		label: item.path,
		description: "📄 File",
		picked: true,
		path: item.path,
	}));

	const selected = await vscode.window.showQuickPick(fileChoices, {
		canPickMany: true,
		placeHolder: "เลือกไฟล์ที่จะสร้าง",
		ignoreFocusOut: true,
	});

	if (!selected || selected.length === 0) {
		void vscode.window.showInformationMessage("ไม่มีไฟล์ถูกเลือก");
		return;
	}

	const editedSelections = [];
	for (const choice of selected) {
		const updated = await promptForPathAdjustment(choice.path, templateName);
		if (!updated) {
			return; // ผู้ใช้ยกเลิก
		}
		editedSelections.push(updated);
	}

	const dedupedSelections = Array.from(
		editedSelections.reduce((map, item) => {
			map.set(item.path, item);
			return map;
		}, new Map())
	).map(([, value]) => value);

	const overwriteChoice = await vscode.window.showQuickPick(
		[
			{ label: "Skip existing files", value: "skip" },
			{ label: "Overwrite existing files", value: "overwrite" },
		],
		{
			placeHolder: "หากมีไฟล์ชื่อซ้ำ ต้องการทำอย่างไร",
			ignoreFocusOut: true,
		}
	);

	if (!overwriteChoice) {
		return;
	}

	const overwriteAll = overwriteChoice.value === "overwrite";
	await generateFilesFromPrompt(
		workspaceFolder,
		finalPrompt,
		dedupedSelections.map((item) => item.path),
		overwriteAll,
		templateName,
		existingSummary
	);
}

async function promptForPathAdjustment(initialPath, templateName) {
	try {
		const value = await vscode.window.showInputBox({
			prompt: `กำหนด path/ไฟล์สำหรับ ${templateName}`,
			value: initialPath,
			valueSelection: [initialPath.length, initialPath.length], // Cursor at the end
			ignoreFocusOut: true,
			validateInput: (input) => {
				if (!input.trim()) {
					return "Path is required";
				}
				try {
					normalizeSegments(input.trim());
					return undefined;
				} catch (error) {
					return error instanceof Error ? error.message : String(error);
				}
			},
		});

		if (value === undefined) {
			return undefined;
		}

		const normalized = normalizeSegments(value.trim());
		return { path: normalized };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(message);
		return undefined;
	}
}

async function generateFilesFromPrompt(
	workspaceFolder,
	finalPrompt,
	filePaths,
	overwriteAll,
	templateName,
	existingSummary
) {
	const config = vscode.workspace.getConfiguration();
	const model = config.get("ai.model") || FALLBACK_MODEL;

	const created = [];
	const overwritten = [];
	const skipped = [];
	const failures = [];

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `สร้างไฟล์จาก ${templateName}`,
			cancellable: false,
		},
		async (progress) => {
			const total = filePaths.length;
			let done = 0;

			for (const relativePath of filePaths) {
				const targetUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
				let message = `ประมวลผล ${relativePath}`;

				try {
					await ensureParentDir(targetUri);

					const fileExists = await exists(targetUri);
					if (fileExists && !overwriteAll) {
						skipped.push(relativePath);
						message = `ข้าม ${relativePath}`;
					} else {
						const content = await requestFileContentForPrompt(
							model,
							finalPrompt,
							existingSummary,
							filePaths,
							relativePath
						);

						const buffer = Buffer.from(content, "utf8");
						await vscode.workspace.fs.writeFile(targetUri, buffer);

						if (fileExists) {
							overwritten.push(relativePath);
							message = `เขียนทับ ${relativePath}`;
						} else {
							created.push(relativePath);
							message = `สร้างใหม่ ${relativePath}`;
						}

						try {
							const doc = await vscode.workspace.openTextDocument(targetUri);
							await vscode.window.showTextDocument(doc, {
								preview: false,
							});
						} catch (error) {
							failures.push({
								path: relativePath,
								error: `เปิดไฟล์ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`,
							});
						}
					}
				} catch (error) {
					failures.push({
						path: relativePath,
						error: error instanceof Error ? error.message : String(error),
					});
					message = `ผิดพลาด ${relativePath}`;
				}

				done += 1;
				progress.report({
					increment: Math.round((done / total) * 100),
					message,
				});
			}
		}
	);

	const parts = [];
	if (created.length) parts.push(`สร้างใหม่ ${created.length}`);
	if (overwritten.length) parts.push(`เขียนทับ ${overwritten.length}`);
	if (skipped.length) parts.push(`ข้าม ${skipped.length}`);

	const summary = parts.length ? parts.join(", ") : "ไม่มีการเปลี่ยนแปลง";

	if (failures.length) {
		const details = failures
			.map((f) => `${f.path}: ${f.error}`)
			.join("\n");
		void vscode.window.showErrorMessage(`มีข้อผิดพลาดบางส่วน: ${summary}\n${details}`);
	} else {
		void vscode.window.showInformationMessage(`เสร็จสิ้น: ${summary}`);
	}
}

async function requestFileContentForPrompt(
	model,
	finalPrompt,
	existingSummary,
	allFilePaths,
	targetPath
) {
	const ext = path.extname(targetPath).replace(/^\./, "") || "plain";
	const otherFiles = allFilePaths.filter((p) => p !== targetPath);

	const systemPrompt = `คุณเป็นผู้ช่วย AI สำหรับสร้างไฟล์โค้ดให้สอดคล้องกับ prompt ที่กำหนดและไฟล์อื่นๆ ในชุดเดียวกัน

ข้อกำหนด:
- ส่งคืนเนื้อหาไฟล์เดียวสำหรับ path ที่ร้องขอเท่านั้น
- ใส่โค้ดเต็มทั้งไฟล์ พร้อม import/function ที่จำเป็น
- ถ้ารู้ภาษาจากนามสกุลไฟล์ (.${ext}) ให้ใช้ภาษานั้น
- ไม่ใส่คำอธิบายเพิ่มเติมหรือข้อความประกอบอื่น ๆ นอกเหนือจากเนื้อหาไฟล์
- หากใช้ code fence ให้ใช้ภาษาให้ตรงกับชนิดไฟล์`;

	const relatedListing = otherFiles.length
		? otherFiles.map((file) => `- ${file}`).join("\n")
		: "- (ไม่มี)";

	const userPrompt = `Prompt หลัก:
${finalPrompt}

ไฟล์ทั้งหมดที่ต้องสร้าง:
${allFilePaths.map((file) => `- ${file}`).join("\n")}

ไฟล์อื่นที่เกี่ยวข้องกับไฟล์เป้าหมาย:
${relatedListing}

สร้างไฟล์สำหรับ path: ${targetPath}
โครงสร้างที่มีอยู่ใน workspace (บางส่วน):
- ไดเรกทอรี: ${existingSummary.directories
	.slice(0, 20)
	.join(", ")}${
	existingSummary.directories.length > 20 ? "..." : ""
}
- ไฟล์ที่พบ: ${existingSummary.files.slice(0, 20).join(", ")}${
	existingSummary.files.length > 20 ? "..." : ""
}

ส่งคืนเฉพาะเนื้อหาไฟล์`;

	try {
		const client = getGlobalAI();
		const response = await client.chat.completions.create({
			model,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			]
		});

		const content = response.choices?.[0]?.message?.content || "";
		const extracted = extractCodeFromText(content);
		return extracted || content || "";
	} catch {
		const header = `// Generated fallback for ${targetPath}\n// Template: ${templateNameFromPrompt(finalPrompt)}\n// Prompt snippet: ${finalPrompt.slice(0, 120)}...\n\n`;
		return header;
	}
}

function templateNameFromPrompt(prompt) {
	return prompt.split("\n")[0]?.slice(0, 40) || "prompt";
}

/**
 * Opens a webview panel for editing prompt content.
 * @param {string} initialContent
 * @param {{ title: string; instruction: string }} options
 * @returns {Promise<string | undefined>}
 */
function openContentEditor(context, initialContent, options) {
	return new Promise((resolve) => {
		const panel = vscode.window.createWebviewPanel(
			"promptContentEditor",
			options.title,
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
			}
		);

		let settled = false;
		const dispose = () => panel.dispose();
		const finalize = (value) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(value);
		};

		panel.onDidDispose(() => finalize(undefined));
		panel.webview.onDidReceiveMessage((message) => {
			if (message?.type === "save") {
				finalize(message.value ?? "");
				dispose();
			} else if (message?.type === "cancel") {
				finalize(undefined);
				dispose();
			}
		});

		void (async () => {
				const html = await loadHtmlTemplate(context, panel.webview, 'media/prompt-content-editor.html', {
					INITIAL_DATA: utf8JsonToBase64({ initialContent, instruction: options.instruction || '' }),
				});
			panel.webview.html = html;
		})();
	});
}

// Removed inline HTML generator for content editor; now using external template.

/**
 * Opens a webview panel to collect placeholder and choice selections in a single view.
 * @param {string[]} placeholders
 * @param {ReturnType<typeof parseChoicePlaceholders>} choiceTokens
 * @returns {Promise<{
 *   simpleValues: Record<string, string>;
 *   choiceSelections: Record<number, string[]>;
 * } | undefined>}
 */
function openPromptForm(context, placeholders, choiceTokens, templateContent) {
	return new Promise((resolve) => {
		const panel = vscode.window.createWebviewPanel(
			"promptInputForm",
			"กรอกค่าจาก template",
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
			}
		);

		let settled = false;
		const dispose = () => panel.dispose();
		const finalize = (value) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(value);
		};

		panel.onDidDispose(() => finalize(undefined));
		panel.webview.onDidReceiveMessage(async (message) => {
		  if (message?.type === "save") {
		    finalize({
		      simpleValues: message.simpleValues || {},
		      choiceSelections: message.choiceSelections || {},
		    });
		    dispose();
		  } else if (message?.type === "cancel") {
		    finalize(undefined);
		    dispose();
		  } else if (message?.type === "callAI") {
		    // Handle AI call request from the webview
		    try {
		      const client = getGlobalAI();
		      const config = vscode.workspace.getConfiguration();
		      const model = config.get("ai.model") || FALLBACK_MODEL;
		      
		      const response = await client.chat.completions.create({
		        model,
		        messages: [
		          { role: "system", content: "คุณเป็นผู้ช่วย AI ที่ช่วยตอบคำถามและสร้างเนื้อหาตามที่ร้องขอ" },
		          { role: "user", content: message.prompt }
		        ]
		      });

		      const aiResponse = response.choices?.[0]?.message?.content || message.default || "";
		      
		      // Send response back to webview
		      panel.webview.postMessage({
		        type: "aiResponse",
		        index: message.index,
		        response: aiResponse,
		        default: message.default
		      });
		    } catch (error) {
		      panel.webview.postMessage({
		        type: "aiError",
		        index: message.index,
		        error: error instanceof Error ? error.message : String(error)
		      });
		    }
		  }
		});

		void (async () => {
			// Create ordered form fields based on template appearance
			const orderedFields = [];
			
			// Find positions of all tokens in the template
			const tokenPositions = [];
			
			// Add choice tokens with their positions
			choiceTokens.forEach((token, index) => {
				const pos = templateContent.indexOf(token.raw);
				if (pos !== -1) {
					tokenPositions.push({
						type: 'choice',
						index,
						position: pos,
						token
					});
				}
			});
			
			// Add simple placeholders with their positions
			placeholders.forEach((name) => {
				const placeholderText = `{{${name}}}`;
				let pos = -1;
				let searchFrom = 0;
				
				// Find all occurrences of this placeholder
				while ((pos = templateContent.indexOf(placeholderText, searchFrom)) !== -1) {
					tokenPositions.push({
						type: 'placeholder',
						name,
						position: pos,
						placeholderText
					});
					searchFrom = pos + placeholderText.length;
				}
			});
			
			// Sort by position in template
			tokenPositions.sort((a, b) => a.position - b.position);
			
			// Create ordered list of field types
			const fieldOrder = tokenPositions.map(item =>
				item.type === 'choice'
					? { type: 'choice', index: item.index }
					: { type: 'placeholder', name: item.name }
			);
			
			// Remove duplicates while preserving order
			const uniqueFieldOrder = [];
			const seen = new Set();
			for (const field of fieldOrder) {
				const key = field.type === 'choice' ? `choice_${field.index}` : `placeholder_${field.name}`;
				if (!seen.has(key)) {
					seen.add(key);
					uniqueFieldOrder.push(field);
				}
			}

			const payload = {
				placeholders,
				choiceTokens,
				templateContent,
				title: "กรอกค่าจาก template",
				fieldOrder: uniqueFieldOrder
			};
			const html = await loadHtmlTemplate(context, panel.webview, 'media/prompt-input-form.html', {
				INITIAL_DATA: utf8JsonToBase64(payload),
			});
			panel.webview.html = html;
		})();
	});
}

// Removed inline HTML generator for prompt input form; now using external template.

/**
 * Load an HTML template file from the extension's media folder and inject data + CSP nonce.
 * @param {vscode.ExtensionContext} context
 * @param {vscode.Webview} webview
 * @param {string} relativePath e.g. 'media/prompt-input-form.html'
 * @param {{ [key: string]: string }} replacements Additional replacement tokens
 */
async function loadHtmlTemplate(context, webview, relativePath, replacements = {}) {
	const onDisk = vscode.Uri.joinPath(context.extensionUri, relativePath);
	const bytes = await vscode.workspace.fs.readFile(onDisk);
	let html = Buffer.from(bytes).toString('utf8');
	const nonce = generateNonce();
	html = html.replace(/%NONCE%/g, nonce);
	for (const [key, value] of Object.entries(replacements)) {
		// Use a function replacer to avoid special replacement sequences in strings
		const token = new RegExp(`%${key}%`, 'g');
		html = html.replace(token, () => String(value));
	}
	return html;
}

function generateNonce() {
	return Math.random().toString(36).slice(2, 10);
}

async function ensureParentDir(uri) {
	const parent = vscode.Uri.joinPath(uri, "..");
	await vscode.workspace.fs.createDirectory(parent);
}

async function exists(uri) {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

export default storePrompt;

