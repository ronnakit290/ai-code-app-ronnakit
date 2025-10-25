import * as vscode from "vscode";
import OpenAI from "openai";

let cachedClient;

const resolveConfig = () => {
  const config = vscode.workspace.getConfiguration("ai");
  const apiKey = config.get("apiKey")?.trim() ?? "";
  const apiUrl = config.get("apiUrl")?.trim() ?? "";

  if (!apiKey) {
    throw new Error(
      "AI API Key is not set. Run the AI: Set Config command first."
    );
  }

  return { apiKey, apiUrl };
};

export const getGlobalAI = () => {
  const { apiKey, apiUrl } = resolveConfig();

  if (
    !cachedClient ||
    cachedClient.apiKey !== apiKey ||
    cachedClient.apiUrl !== apiUrl
  ) {
    cachedClient = {
      client: new OpenAI({
        apiKey,
        baseURL: apiUrl || undefined,
      }),
      apiKey,
      apiUrl,
    };
  }

  return cachedClient.client;
};

export const resetGlobalAI = () => {
  cachedClient = undefined;
};

export const registerAiConfigWatcher = () =>
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("ai")) {
      resetGlobalAI();
    }
  });

export default getGlobalAI;
