// utils/aiClient.js
"use strict";

const logger = require("./logger"); // Import the logger
const {
  HarmCategory,
  HarmBlockThreshold,
  GoogleGenerativeAI,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const fileManager = new GoogleAIFileManager(process.env.API_KEY);

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

const getAIModel = (systemInstruction) => {
  logger.info("Initializing AI model");
  return genAI.getGenerativeModel({
    model: "gemini-1.5-pro", // Use a model that supports longer outputs
    safetySettings: safetySettings,
    generationConfig: { maxOutputTokens: 100000 }, // Adjusted maxOutputTokens
    systemInstruction,
  });
};

const uploadFileToAI = async (filePath, mimeType, displayName) => {
  logger.info(`Uploading file to AI: ${filePath}`);
  const uploadResponse = await fileManager.uploadFile(filePath, {
    mimeType,
    displayName,
  });
  logger.info(`File uploaded: ${uploadResponse.file.uri}`);
  return uploadResponse.file;
};

const deleteAIFile = async (fileName) => {
  logger.info(`Deleting file from AI: ${fileName}`);
  await fileManager.deleteFile(fileName);
};

module.exports = {
  getAIModel,
  uploadFileToAI,
  deleteAIFile,
};
