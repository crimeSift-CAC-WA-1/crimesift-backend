// routes/analyzeDiscord.js
"use strict";

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger"); // Import the logger
const { getAIModel, uploadFileToAI, deleteAIFile } = require("../utils/aiClient");

module.exports = async function (fastify, opts) {
  fastify.register(require("@fastify/multipart"));

  fastify.post("/analyzeDiscord", async (req, reply) => {
    logger.info("Received /analyzeDiscord request");
    try {
      const data = await req.file();
      const { time, prompt } = data.fields;

      if (!time || !prompt || !data) {
        logger.error("Missing required fields");
        return reply.badRequest("Missing required fields");
      }

      const timestamp = parseInt(time.value);
      const userPrompt = prompt.value;
      logger.debug(`Timestamp: ${timestamp}, Prompt: ${userPrompt}`);

      // Save uploaded file temporarily
      const uploadDir = path.join(__dirname, "./uploads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir);
      }

      const originalFilePath = path.join(
        uploadDir,
        `${Date.now()}_${data.filename}`
      );
      const writeStream = fs.createWriteStream(originalFilePath);

      await new Promise((resolve, reject) => {
        data.file.pipe(writeStream);
        data.file.on("end", resolve);
        data.file.on("error", reject);
      });
      logger.info(`File saved to ${originalFilePath}`);

      // Read chat data
      const chatData = fs.readFileSync(originalFilePath, "utf-8");
      logger.debug(`Chat data length: ${chatData.length}`);

      // Convert chat data to a format suitable for the AI model
      // Assuming the Discord chat data is in JSON format
      // Wrap the JSON content in <content> tags
      const wrappedContent = `<content>\n${chatData}\n</content>`;
      logger.debug(`Wrapped content length: ${wrappedContent.length}`);

      // Save the wrapped content into a .txt file
      const txtFilePath = path.join(
        uploadDir,
        `${Date.now()}_wrapped_chat.txt`
      );
      fs.writeFileSync(txtFilePath, wrappedContent, "utf-8");
      logger.info(`Wrapped content saved to ${txtFilePath}`);

      // Prepare AI prompt
      const systemInstruction = `
You are a professional detective's assistant. You will be given Discord chat data in a text file containing JSON content wrapped within <content> tags.

Your task is to analyze the chat data based on the following prompt:

"${userPrompt}"

**IMPORTANT INSTRUCTIONS:**

- **ONLY OUTPUT THE JSON ARRAY** containing your findings based on the analysis of the provided chat data.
- Do **NOT** include any sample data, code fences, headers, footers, explanations, or any additional text.
- **Do NOT include any of the sample data provided below in your output.**
- **Limit the number of messages in "context-before" and "context-after" to between 3 and 10 messages each.**
- **The MAXIMUM NUMBER OF INSTANCES YOU ARE ALLOWED TO LIST IS 10.**
- Ensure that your response is **valid JSON** and follows the exact structure provided.
- If a message has an attachment (e.g., image, file), describe the attachment in the "message" field.

**Output Format (Do NOT include this in your output, it's for reference only):**

[
  {
    "instance_ID": 1,
    "context-before": [
      // Up to 10 messages before the flagged instance
      {
        "time": timestamp,
        "author": "username",
        "message": "message content"
      }
      // ... up to 10 messages
    ],
    "flagged": [
      // The message that meets the criteria specified in the user prompt
      {
        "time": timestamp,
        "author": "username",
        "message": "message content"
      },
      // ONLY ONE FLAGGED MESSAGE
      {
        "time": 0,
        "author": "AI-ANALYZER",
        "message": "Explanation of why this message is flagged"
      }
    ],
    "context-after": [
      // Up to 10 messages after the flagged instance
      {
        "time": timestamp,
        "author": "username",
        "message": "message content"
      }
      // ... up to 10 messages
    ]
  }
  // ... up to 10 instances
]

**Remember:**

- Do **NOT** include any sample data in your output.
- **ONLY OUTPUT THE JSON ARRAY** containing your findings.
`;

      const model = getAIModel(systemInstruction);
      logger.info("AI model initialized");

      // Upload the .txt file to AI
      const uploadedFile = await uploadFileToAI(
        txtFilePath,
        "text/plain",
        "Discord Chat Data"
      );
      logger.info(`File uploaded to AI: ${uploadedFile.uri}`);

      // Generate content
      let result;
      try {
        result = await model.generateContent([
          {
            fileData: {
              mimeType: uploadedFile.mimeType,
              fileUri: uploadedFile.uri,
            },
          },
          { text: userPrompt },
        ]);
        logger.info("AI content generation completed");
      } catch (aiError) {
        logger.error("Error during AI content generation:", aiError);
        logger.error(
          "AI Error Details:",
          JSON.stringify(aiError, Object.getOwnPropertyNames(aiError), 2)
        );
        throw aiError;
      }

      // Parse AI response
      const aiResponse = await result.response.text();
      logger.info("Raw AI Response:");
      logger.info(aiResponse);

      // Sanitize the AI response
      let jsonString = aiResponse.trim();

      // Remove any code fences or extraneous text
      jsonString = jsonString.replace(/```json/g, "").replace(/```/g, "").trim();

      // Extract JSON content
      const jsonStart = jsonString.indexOf("[");
      const jsonEnd = jsonString.lastIndexOf("]") + 1;
      jsonString = jsonString.substring(jsonStart, jsonEnd);

      let analysisResults;
      try {
        analysisResults = JSON.parse(jsonString);
        logger.info("AI response parsed successfully");
      } catch (parseError) {
        logger.error("JSON Parsing Error:", parseError);
        logger.error("Sanitized AI Response:", jsonString);
        throw new Error("Failed to parse AI response as JSON.");
      }

      // Enforce context message limits
      const MAX_CONTEXT_MESSAGES = 10;

      analysisResults = analysisResults.map((instance) => {
        instance["context-before"] = instance["context-before"].slice(-MAX_CONTEXT_MESSAGES);
        instance["context-after"] = instance["context-after"].slice(0, MAX_CONTEXT_MESSAGES);
        return instance;
      });

      // Delete uploaded file
      await deleteAIFile(uploadedFile.name);
      logger.info("Uploaded file deleted from AI");

      // Clean up local files
      fs.unlinkSync(originalFilePath);
      fs.unlinkSync(txtFilePath);
      logger.info("Temporary files deleted");

      // Send response
      reply.send(analysisResults);
    } catch (error) {
      logger.error("Error in /analyzeDiscord:", error);
      logger.error(
        "Error Details:",
        JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
      );
      reply.internalServerError("An error occurred during analysis.");
    }
  });
};
