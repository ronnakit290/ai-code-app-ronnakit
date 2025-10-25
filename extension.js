import * as vscode from "vscode";

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  // Dynamic imports for ES modules
  const { getGlobalAI } = await import("./config/ai.js");
  const { generatePaths } = await import("./command/generatePaths.js");
  const { createProjectByAI } = await import(
    "./command/createProjectByAI.js"
  );
  const { storePrompt } = await import("./command/storePrompt.js");
  const setAiConfig = vscode.commands.registerCommand(
    "extension.setAiConfig",
    async () => {
      const configList = [
        { label: "API Key", value: "api" },
        { label: "URL", value: "url" },
        { label: "Model", value: "model" },
      ];
      const selectedConfig = await vscode.window.showQuickPick(configList, {
        placeHolder: "Select AI configuration to set",
        ignoreFocusOut: true,
      });
      if (!selectedConfig) {
        return;
      }

      const aiConfig = vscode.workspace.getConfiguration("ai");
      if (selectedConfig.value === "api") {
        const oldApiKey = aiConfig.get("apiKey", "");
        const apiKey = await vscode.window.showInputBox({
          prompt: "Enter your AI API Key",
          value: oldApiKey,
          ignoreFocusOut: true,
        });
        if (apiKey === undefined) {
          return;
        } else {
          await aiConfig.update(
            "apiKey",
            apiKey,
            vscode.ConfigurationTarget.Global
          );
        }
      } else if (selectedConfig.value === "url") {
        const oldApiUrl = aiConfig.get("apiUrl", "");
        const apiUrl = await vscode.window.showInputBox({
          prompt: "Enter your AI API URL",
          value: oldApiUrl,
          ignoreFocusOut: true,
        });
        if (apiUrl === undefined) {
          return;
        } else {
          await aiConfig.update(
            "apiUrl",
            apiUrl,
            vscode.ConfigurationTarget.Global
          );
        }
  } else if (selectedConfig.value === "model") {
        try {
          const client = getGlobalAI();
          const modelsResponse = await client.models.list();
          const modelItems = modelsResponse.data
            .map((model) => ({ label: model.id }))
            .sort((a, b) => a.label.localeCompare(b.label));
          if (!modelItems.length) {
            void vscode.window.showInformationMessage(
              "No models available from the AI provider."
            );
            return;
          }

          const aiModel = await vscode.window.showQuickPick(modelItems, {
            placeHolder: "Select AI Model",
            ignoreFocusOut: true,
          });
          if (!aiModel) {
            return;
          }

          // Persist only the model id/label as string
          /** @type {any} */
          const modelPick = aiModel;
          const modelId = typeof modelPick === "string" ? modelPick : (modelPick && modelPick.label) || "";
          await aiConfig.update(
            "model",
            modelId,
            vscode.ConfigurationTarget.Global
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(
            `Failed to fetch models: ${message}`
          );
        }
      }
    }
  );

  // Register generatePaths command
  const generatePathsCommand = vscode.commands.registerCommand(
    "extension.generatePaths",
    generatePaths
  );

  // Register createProjectByAI command
  const createProjectByAICommand = vscode.commands.registerCommand(
    "extension.createProjectByAI",
    createProjectByAI
  );

  // Register storePrompt command (CRUD + Run for prompt templates)
  const storePromptCommand = vscode.commands.registerCommand(
    "extension.storePrompt",
    () => storePrompt(context)
  );

  context.subscriptions.push(
    setAiConfig,
    generatePathsCommand,
    createProjectByAICommand,
    storePromptCommand
  );
}

function deactivate() {}

export { activate, deactivate };
